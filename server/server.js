require('dotenv').config();
const http = require("http");
const fs = require("fs");
const path = require("path");
const { Server } = require("socket.io");
const { GoogleGenerativeAI } = require('@google/generative-ai');
const PDFDocument = require('pdfkit');
const archiver = require('archiver');
const sharp = require('sharp');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || 'dummy');

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/socket.io/')) return;

  // ── Download ZIP ──────────────────────────────────────────
  if (req.url.startsWith('/download/')) {
    const parts = req.url.split('/');
    if (parts.length >= 3) {
      const deviceId = parts[2];
      const roomData = Array.from(rooms.values()).find(r => r.phones.has(deviceId));
      if (!roomData) return res.end("User not found");
      const pData = roomData.phones.get(deviceId);
      const sessionDir = pData.currentSessionId || "latest";

      // FIX: Use pData.name (not deviceId) — matches where captures are saved
      const captureDir = path.join(__dirname, "../safeguard-captures", pData.name, sessionDir);
      if (!fs.existsSync(captureDir)) {
        res.writeHead(404);
        return res.end("No evidence found");
      }
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename=SafeGuard_${pData.name}_${sessionDir}.zip`
      });
      const archive = archiver('zip', { zlib: { level: 9 } });
      archive.pipe(res);
      archive.directory(captureDir, false);

      const summary = `SafeGuard Incident Report\nUser: ${pData.name}\nSession: ${sessionDir}\nTrigger: ${pData.triggerType || 'MANUAL'}\nGPS: ${JSON.stringify(pData.latestGps)}\nFaces Detected: ${pData.knownFaces ? pData.knownFaces.size : 0}`;
      archive.append(summary, { name: 'incident_summary.txt' });
      archive.finalize();
      return;
    }
  }

  const urlWithoutQuery = req.url.split('?')[0];
  let filePath = path.join(__dirname, "../public", urlWithoutQuery === "/" ? "/dashboard.html" : urlWithoutQuery);
  if (urlWithoutQuery === "/phone") filePath = path.join(__dirname, "../public/phone.html");
  if (urlWithoutQuery === "/dashboard") filePath = path.join(__dirname, "../public/dashboard.html");

  const ext = path.extname(filePath);
  const mime = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css" };

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end("Not Found"); return; }
    res.writeHead(200, { "Content-Type": mime[ext] || "text/plain" });
    res.end(data);
  });
});

const io = new Server(server, {
  cors: { origin: "*" },
  maxHttpBufferSize: 20e6
});

const rooms = new Map();

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, { dashboards: new Set(), phones: new Map() });
  }
  return rooms.get(roomId);
}

function emitRoomUsers(roomId) {
  const roomData = rooms.get(roomId);
  if (!roomData) return;
  const users = Array.from(roomData.phones.entries()).map(([id, p]) => ({
    deviceId: id,
    name: p.name,
    faceRegistered: !!p.faceProfile
  }));
  roomData.dashboards.forEach(d => d.emit("room-users", users));
}

io.on("connection", (socket) => {
  console.log("🔌 Connected:", socket.id);
  let currentRoom = null;
  let clientRole = null;
  let clientDeviceId = null;

  socket.on("register", (data) => {
    const role = typeof data === 'string' ? data : data.role;
    const roomId = data.room || 'DEFAULT';
    currentRoom = roomId;
    clientRole = role;

    socket.join(roomId);
    const roomData = getRoom(roomId);

    if (role === "dashboard") {
      roomData.dashboards.add(socket);
      console.log(`📊 Dashboard registered in room: ${roomId}`);
      socket.emit("status", { message: `Dashboard ready. Room: ${roomId}` });
      emitRoomUsers(roomId);
      roomData.phones.forEach(p => p.socket.emit("dashboard-connected"));
    }

    if (role === "phone") {
      clientDeviceId = data.deviceId || socket.id;
      roomData.phones.set(clientDeviceId, {
        socket,
        name: data.name || 'Unknown User',
        sensorHistory: [],
        lastScore: 0,
        aiCooldownUntil: 0,
        captureActive: false,
        captures: [],
        knownFaces: new Map(),
        latestGps: null,
        faceProfile: null
      });
      console.log(`📱 Phone registered in room: ${roomId} as ${data.name}`);
      socket.emit("status", { message: `Connected to room: ${roomId}` });
      emitRoomUsers(roomId);
    }
  });

  socket.on("offer", (data) => {
    const roomData = rooms.get(currentRoom);
    if (roomData) {
      const payload = { ...data, deviceId: clientDeviceId };
      roomData.dashboards.forEach(d => d.emit("offer", payload));
    }
  });

  socket.on("answer", (data) => {
    const roomData = rooms.get(currentRoom);
    if (roomData && data.targetDeviceId) {
      const targetPhone = roomData.phones.get(data.targetDeviceId);
      if (targetPhone) targetPhone.socket.emit("answer", data);
    }
  });

  socket.on("ice-candidate", (data) => {
    const roomData = rooms.get(currentRoom);
    if (!roomData) return;
    if (data.target === "dashboard") {
      const payload = { ...data, deviceId: clientDeviceId };
      roomData.dashboards.forEach(d => d.emit("ice-candidate", payload));
    } else if (data.target === "phone" && data.targetDeviceId) {
      const targetPhone = roomData.phones.get(data.targetDeviceId);
      if (targetPhone) targetPhone.socket.emit("ice-candidate", data);
    }
  });

  const relayToDashboards = (event, data) => {
    const roomData = rooms.get(currentRoom);
    if (roomData) {
      const payload = { ...data, deviceId: clientDeviceId };
      roomData.dashboards.forEach(d => d.emit(event, payload));
    }
  };

  socket.on("sensor-data", (data) => {
    relayToDashboards("sensor-data", data);
    const roomData = rooms.get(currentRoom);
    if (roomData && clientRole === "phone") {
      const pData = roomData.phones.get(clientDeviceId);
      if (pData) {
        pData.sensorHistory.push(data);
        if (pData.sensorHistory.length > 25) pData.sensorHistory.shift();
      }
    }
  });

  socket.on("gps-update", (data) => {
    relayToDashboards("gps-update", data);
    const roomData = rooms.get(currentRoom);
    if (roomData && clientRole === "phone") {
      const pData = roomData.phones.get(clientDeviceId);
      if (pData) pData.latestGps = data;
    }
  });

  socket.on("video-frame", (data) => relayToDashboards("video-frame", { frame: data }));
  // Also handle when phone sends raw string (canvas fallback)
  // The phone emits: socket.emit('video-frame', frameString)
  // So 'data' here IS the raw base64 string, not an object

  // ── FIX 5: Alert handler — relay AFTER patching aiInsight ──
  socket.on("alert", (data) => {
    if (!data) return; // safety check
    const roomData = rooms.get(currentRoom);
    if (roomData && clientRole === "phone") {
      // Ensure data.data exists with a timestamp for all alert types
      if (!data.data) data.data = {};
      if (!data.data.timestamp) data.data.timestamp = Date.now();

      if (data.type === "PANIC") {
        const pData = roomData.phones.get(clientDeviceId);
        if (pData && !pData.captureActive) {
          pData.captureActive = true;
          pData.triggerType = "MANUAL";
          pData.currentSessionId = new Date().toISOString().replace(/[:.]/g, "-");
          pData.knownFaces = new Map();
          socket.emit("START_FACE_CAPTURE", { faceProfile: pData.faceProfile });
        }
        // Always inject aiInsight so dashboard shows the SOS overlay
        if (!data.aiInsight) {
          data.aiInsight = "Manual panic button pressed by user. Face capture activated silently.";
        }
      }
    }
    // Relay AFTER modification
    relayToDashboards("alert", data);
  });

  // ── Face Registration ─────────────────────────────────────
  socket.on("register-face", async (data) => {
    const roomData = rooms.get(currentRoom);
    if (!roomData || clientRole !== "phone") return;
    const phoneData = roomData.phones.get(clientDeviceId);
    if (!phoneData || !process.env.GEMINI_API_KEY) return;

    try {
      // ✅ Fix 1: Updated model name
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
      const prompt = "Extract the key facial features from these 3 images of the same person. Return ONLY a JSON object (no markdown) with keys: face_shape, skin_tone, hair_color, hair_style, distinctive_features, approximate_age_range, gender_presentation, glasses (boolean), beard (boolean), face_embedding_description.";

      // ✅ Fix 2: Robust base64 extraction for any image type
      const imageParts = data.images.map(img => {
        const match = img.match(/^data:(image\/[a-zA-Z]+);base64,/); // handles jpeg, png, jpg, webp
        const mimeType = match ? match[1] : "image/jpeg";
        const base64Data = img.replace(/^data:image\/[a-zA-Z]+;base64,/, ""); // ✅ strips any type

        return {
          inlineData: {
            data: base64Data,
            mimeType: mimeType
          }
        };
      });

      // ✅ Fix 3: Actually call the model
      const result = await model.generateContent([prompt, ...imageParts]);
      const text = result.response.text();

      // ✅ Fix 4: Safely parse JSON (Gemini sometimes adds backticks anyway)
      const cleaned = text.replace(/```json|```/gi, "").trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        phoneData.faceProfile = JSON.parse(jsonMatch[0]);

        const profileDir = path.join(__dirname, "../safeguard-data", "users", clientDeviceId);
        if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir, { recursive: true });
        fs.writeFileSync(path.join(profileDir, "face_profile.json"), JSON.stringify(phoneData.faceProfile, null, 2));

        const regDir = path.join(profileDir, "registration");
        if (!fs.existsSync(regDir)) fs.mkdirSync(regDir, { recursive: true });
        data.images.forEach((img, i) => {
          const angle = ["front", "left", "right"][i] || `img_${i}`;
          // Also apply robust base64 stripping when saving to disk
          const b64 = img.replace(/^data:image\/[a-zA-Z]+;base64,/, "");
          fs.writeFileSync(path.join(regDir, `face_${angle}.jpg`), Buffer.from(b64, "base64"));
        });

        console.log(`✅ Face registered for ${phoneData.name}`);
        socket.emit("face-registered", { success: true, profile: phoneData.faceProfile });
        emitRoomUsers(currentRoom);
      } else {
        throw new Error("Could not parse face profile JSON from AI response");
      }
    } catch (e) {
      console.error("Face registration error:", e.message);
      socket.emit("face-registered", { success: false, error: e.message });
    }
  });

  // ── Scan Frame (Vision AI) ────────────────────────────────
  socket.on("scan-frame", async (data) => {
    const roomData = rooms.get(currentRoom);
    if (!roomData || clientRole !== "phone") return;
    const phoneData = roomData.phones.get(clientDeviceId);
    if (!phoneData || !process.env.GEMINI_API_KEY) return;

    if (phoneData._scanBusy) return;
    phoneData._scanBusy = true;

    try {
      const match = data.frame.match(/^data:(image\/[a-zA-Z]+);base64,/);
      if (!match) { phoneData._scanBusy = false; return; }
      const mimeType = match[1] || "image/jpeg";
      const base64Data = data.frame.replace(/^data:image\/[a-zA-Z]+;base64,/, "");
      console.log(`🔍 Scanning frame for ${phoneData.name}...`);

      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
      const profileString = JSON.stringify(phoneData.faceProfile || {});
      const prompt = `Detect all faces in this image. For each face return bounding box coordinates (x, y, width, height as percentages of image 0-100). Compare each face to this registered user profile: ${profileString}. Return ONLY valid JSON (no markdown) with a single key 'faces' containing an array of objects. Each object must have keys: id (number), bbox (object with x, y, w, h), is_registered_user (boolean), confidence (number 0-1), gender (string: Male or Female), estimated_age (string like '25-30'), and description (string with brief appearance notes).`;

      const result = await model.generateContent([prompt, { inlineData: { data: base64Data, mimeType } }]);
      const responseText = result.response.text();
      const cleaned = responseText.replace(/```json|```/gi, "").trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);

      let faces = [];
      if (jsonMatch) {
        const analysis = JSON.parse(jsonMatch[0]);
        faces = analysis.faces || [];
        console.log(`✅ Found ${faces.length} face(s)`);

        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const sessionDirName = phoneData.currentSessionId || timestamp;
        // FIX: Use phoneData.name for directory
        const captureDir = path.join(__dirname, "../safeguard-captures", phoneData.name, sessionDirName);
        if (!fs.existsSync(captureDir)) fs.mkdirSync(captureDir, { recursive: true });

        const buffer = Buffer.from(base64Data, "base64");
        const metadata = await sharp(buffer).metadata();
        const imgWidth = metadata.width;
        const imgHeight = metadata.height;

        for (let i = 0; i < faces.length; i++) {
          const face = faces[i];
          if (!face.is_registered_user && face.confidence > 0.7) {
            const left = Math.max(0, Math.round((face.bbox.x / 100) * imgWidth));
            const top = Math.max(0, Math.round((face.bbox.y / 100) * imgHeight));
            let w = Math.round((face.bbox.w / 100) * imgWidth);
            let h = Math.round((face.bbox.h / 100) * imgHeight);
            if (left + w > imgWidth) w = imgWidth - left;
            if (top + h > imgHeight) h = imgHeight - top;

            if (w > 20 && h > 20) {
              const faceId = face.id ? `unknown_${face.id}` : `unknown_${i + 1}`;

              if (!phoneData.knownFaces.has(faceId)) {
                phoneData.knownFaces.set(faceId, {
                  frames: [],
                  meta: {
                    first_seen: new Date().toLocaleTimeString(),
                    id: faceId,
                    gender: face.gender || "Unknown",
                    estimated_age: face.estimated_age || "?",
                    description: face.description
                  }
                });
              }
              const faceEntry = phoneData.knownFaces.get(faceId);

              if (faceEntry.frames.length < 3) {
                const timeStr = new Date().toTimeString().split(' ')[0].replace(/:/g, "-");
                const imgName = `${faceId}_${timeStr}.jpg`;
                const imgPath = path.join(captureDir, imgName);

                // FIX: Crop first, convert to base64, then save — one sharp call
                const croppedBuffer = await sharp(buffer)
                  .extract({ left, top, width: w, height: h })
                  .jpeg({ quality: 85 })
                  .toBuffer();

                fs.writeFileSync(imgPath, croppedBuffer);
                faceEntry.frames.push({ path: imgPath, name: imgName, confidence: face.confidence });

                // FIX: Send cropped face base64 (not full frame) as thumbnail
                const croppedBase64 = "data:image/jpeg;base64," + croppedBuffer.toString("base64");

                // Update metadata.json
                const metaPath = path.join(captureDir, "metadata.json");
                const incidentMeta = {
                  incident_time: new Date().toISOString(),
                  user: phoneData.name,
                  trigger_type: phoneData.triggerType || "MANUAL",
                  gps: phoneData.latestGps,
                  faces_captured: Array.from(phoneData.knownFaces.entries()).map(([id, fd]) => ({
                    id,
                    first_seen: fd.meta.first_seen,
                    last_seen: new Date().toLocaleTimeString(),
                    total_frames: fd.frames.length,
                    gender: fd.meta.gender,
                    estimated_age: fd.meta.estimated_age,
                    ai_description: fd.meta.description,
                    best_frame: (fd.frames.sort((a, b) => b.confidence - a.confidence)[0] || {}).name || ""
                  }))
                };
                fs.writeFileSync(metaPath, JSON.stringify(incidentMeta, null, 2));

                roomData.dashboards.forEach(d => d.emit("new-capture", {
                  deviceId: clientDeviceId,
                  frame: croppedBase64,  // FIX: cropped face thumbnail
                  faceId,
                  isNewPerson: faceEntry.frames.length === 1,
                  gender: faceEntry.meta.gender,
                  estimatedAge: faceEntry.meta.estimated_age,
                  aiDescription: faceEntry.meta.description,
                  firstSeen: faceEntry.meta.first_seen
                }));
              }
            }
          }
        }
      }

      roomData.dashboards.forEach(d => d.emit("annotated-frame", {
        deviceId: clientDeviceId,
        frame: data.frame,
        faces
      }));

    } catch (e) {
      console.error("Vision Error:", e.message);
    } finally {
      phoneData._scanBusy = false;
    }
  });

  // ── Resolve SOS + Generate PDF ────────────────────────────
  socket.on("resolve-sos", (data) => {
    if (!data) return;
    const targetDeviceId = data.deviceId;
    const roomData = rooms.get(currentRoom);
    if (!roomData) return;
    const phoneData = roomData.phones.get(targetDeviceId);
    if (!phoneData) return;

    phoneData.captureActive = false;
    if (phoneData.socket) phoneData.socket.emit("STOP_CAPTURE");

    try {
      const doc = new PDFDocument();
      // FIX: Use phoneData.name, not targetDeviceId
      const captureDir = path.join(__dirname, "../safeguard-captures", phoneData.name);
      if (!fs.existsSync(captureDir)) fs.mkdirSync(captureDir, { recursive: true });
      const pdfPath = path.join(captureDir, `incident_report_${Date.now()}.pdf`);

      doc.pipe(fs.createWriteStream(pdfPath));

      // Header
      doc.fontSize(22).text("SAFEGUARD INCIDENT REPORT", { align: "center" });
      doc.moveDown(0.5);
      doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
      doc.moveDown(0.5);

      // Details
      doc.fontSize(13).text(`User: ${phoneData.name}`);
      doc.text(`Incident Time: ${new Date().toLocaleString()}`);
      doc.text(`Trigger Type: ${phoneData.triggerType || "MANUAL"}`);
      if (phoneData.latestGps) {
        doc.text(`GPS: ${phoneData.latestGps.lat}, ${phoneData.latestGps.lng}`);
      }
      doc.moveDown();

      // Session ID
      doc.fontSize(11).fillColor("gray").text(`Session ID: ${phoneData.currentSessionId || "N/A"}`);
      doc.fillColor("black");
      doc.moveDown();

      // Evidence section
      doc.fontSize(16).text("CAPTURED EVIDENCE", { underline: true });
      doc.moveDown(0.5);

      // FIX: Use knownFaces, not captures
      let embeddedCount = 0;
      if (phoneData.knownFaces && phoneData.knownFaces.size > 0) {
        for (const [faceId, faceEntry] of phoneData.knownFaces.entries()) {
          if (embeddedCount >= 3) break;

          doc.fontSize(13).text(`Captured Person: ${faceId}`, { underline: true });
          doc.fontSize(10).text(`Description: ${faceEntry.meta.description || 'N/A'}`);
          doc.text(`First seen: ${faceEntry.meta.first_seen}`);
          doc.text(`Total frames captured: ${faceEntry.frames.length}`);
          doc.moveDown(0.5);

          // Best frame = highest confidence
          const bestFrame = [...faceEntry.frames].sort((a, b) => b.confidence - a.confidence)[0];
          if (bestFrame && fs.existsSync(bestFrame.path)) {
            try {
              doc.image(bestFrame.path, {
                fit: [250, 250],
                align: 'center',
                valign: 'center'
              });
            } catch (imgErr) {
              doc.text('[Image could not be embedded]');
            }
          }
          doc.moveDown();
          embeddedCount++;
        }
      } else {
        doc.fontSize(11).text('No faces were captured during this incident.');
      }

      doc.end();
      console.log(`📄 PDF saved: ${pdfPath}`);
      socket.emit("status", { message: `Incident resolved. Report saved to ${pdfPath}` });

    } catch (e) {
      console.error("PDF generation error:", e);
    }
  });

  socket.on("disconnect", () => {
    console.log("❌ Disconnected:", socket.id);
    if (currentRoom) {
      const roomData = rooms.get(currentRoom);
      if (roomData) {
        if (clientRole === "dashboard") roomData.dashboards.delete(socket);
        else if (clientRole === "phone") {
          roomData.phones.delete(clientDeviceId);
          emitRoomUsers(currentRoom);
        }
        if (roomData.dashboards.size === 0 && roomData.phones.size === 0) rooms.delete(currentRoom);
      }
    }
  });
});

// ── AI Scoring Loop (every 5s) ────────────────────────────
setInterval(async () => {
  for (const [roomId, roomData] of rooms.entries()) {
    for (const [deviceId, phoneData] of roomData.phones.entries()) {
      if (!phoneData.sensorHistory || phoneData.sensorHistory.length === 0) continue;

      let maxDb = 0, maxGyro = 0, maxMag = 0;
      phoneData.sensorHistory.slice(-10).forEach(r => {
        if (r.audio.db > maxDb) maxDb = r.audio.db;
        if (r.motion.magnitude > maxMag) maxMag = r.motion.magnitude;
        const g = Math.sqrt(Math.pow(r.motion.gx, 2) + Math.pow(r.motion.gy, 2) + Math.pow(r.motion.gz, 2));
        if (g > maxGyro) maxGyro = g;
      });

      let baseScore = 0;
      if (maxDb > 85) baseScore += 0.4;
      else if (maxDb > 70) baseScore += 0.2;
      if (maxMag > 25) baseScore += 0.4;
      else if (maxMag > 15) baseScore += 0.2;
      if (maxGyro > 180) baseScore += 0.4;
      else if (maxGyro > 90) baseScore += 0.2;

      let scoreToEmit = Math.min(1.0, baseScore);
      roomData.dashboards.forEach(d => d.emit("ai-score-update", { deviceId, score: scoreToEmit }));

      if (baseScore >= 0.5 && Date.now() > phoneData.aiCooldownUntil && process.env.GEMINI_API_KEY) {
        try {
          const prompt = `You are an AI SOS agent monitoring telemetry for a women's safety app. Analyze this sensor data for user ${phoneData.name}. 
Max DB: ${maxDb.toFixed(1)}, Max Motion Magnitude: ${maxMag.toFixed(1)}, Max Gyro: ${maxGyro.toFixed(1)}.
Return ONLY valid JSON (no markdown) with keys: decision (SAFE, WARNING, or SOS), reason (string), and score (number between 0.0 and 1.0).`;

          const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
          const result = await model.generateContent(prompt);
          const responseText = result.response.text();
          const cleaned = responseText.replace(/```json|```/gi, "").trim();
          const jsonMatch = cleaned.match(/\{[\s\S]*\}/);

          if (jsonMatch) {
            const aiDecision = JSON.parse(jsonMatch[0]);
            scoreToEmit = aiDecision.score || scoreToEmit;
            roomData.dashboards.forEach(d => d.emit("ai-score-update", { deviceId, score: scoreToEmit }));

            if (aiDecision.decision === "SOS" || scoreToEmit > 0.90) {
              phoneData.aiCooldownUntil = Date.now() + 60000;

              roomData.dashboards.forEach(d => d.emit("alert", {
                type: "PANIC",
                reason: `🤖 AI TRIGGER: ${aiDecision.reason}`,
                data: { timestamp: Date.now() },
                deviceId,
                aiInsight: aiDecision.reason
              }));

              if (!phoneData.captureActive) {
                phoneData.captureActive = true;
                phoneData.triggerType = "AI_AUTO";
                phoneData.currentSessionId = new Date().toISOString().replace(/[:.]/g, "-");
                phoneData.knownFaces = new Map();
                if (phoneData.socket) {
                  phoneData.socket.emit("START_FACE_CAPTURE", { faceProfile: phoneData.faceProfile });
                }
              }
            }
          }
        } catch (e) {
          console.error("AI Eval Error:", e.message);
        }
      }
    }
  }
}, 5000);

server.listen(PORT, () => {
  console.log(`\n✅ SafeGuard Server running on port ${PORT}`);
});