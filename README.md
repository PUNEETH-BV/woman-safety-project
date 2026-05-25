# 🛡️ SafeGuard – Women Safety Demo

WebRTC-based real-time safety monitoring demo.
Phone → Laptop over hotspot. No internet. No USB.

---

## 📦 Setup (One Time)

```bash
cd safety-demo
npm install
```

---

## 🚀 Run the Demo

### Step 1 – Enable Phone Hotspot
- On your phone: Settings → Hotspot → Turn ON
- Connect your **laptop** to that hotspot WiFi

### Step 2 – Find Your Laptop's IP
```bash
# Windows
ipconfig
# Look for "IPv4 Address" under your WiFi adapter (e.g. 192.168.43.xxx)

# Mac / Linux
ifconfig | grep inet
```

### Step 3 – Start the Server (on Laptop)
```bash
npm start
```
You'll see:
```
✅ Safety Demo Server running!
📊 Dashboard  → http://localhost:3000/dashboard
📱 Phone URL  → http://<YOUR_LAPTOP_IP>:3000/phone
```

### Step 4 – Open Dashboard (on Laptop)
Open browser → `http://localhost:3000/dashboard`

### Step 5 – Open Phone Page (on Phone)
Open browser on phone → `http://192.168.43.xxx:3000/phone`
(replace with your actual laptop IP from Step 2)

### Step 6 – Start Streaming
Tap **▶ Start Streaming** on the phone.
Allow camera + microphone permissions.
Dashboard will show LIVE feed + sensor data!

---

## 📡 What Gets Streamed

| Data | Method |
|------|--------|
| Live Video | WebRTC |
| Live Audio | WebRTC |
| Audio Level (dB) | Socket.IO |
| Accelerometer (motion) | Socket.IO |
| Gyroscope | Socket.IO |

---

## 🚨 Alert Triggers

| Alert | Condition |
|-------|-----------|
| 🔊 SOUND | Audio > 78 dB |
| 🏃 MOTION | Motion spike > 22 m/s² |
| ⚡ AUTO | Loud sound + sudden motion together |
| 🚨 PANIC | Manual panic button pressed on phone |

---

## 🎬 Demo Script (for client)

1. Open dashboard on laptop (show it on projector/screen)
2. Walk normally → all metrics green
3. Sudden movement → MOTION alert fires
4. Shout or clap loud → SOUND alert fires
5. Do both → AUTO alert + screen flash
6. Press PANIC button → full red alert

---

## 🛠 Tech Stack
- Node.js + Socket.IO (signaling)
- WebRTC (video/audio stream)
- DeviceMotion API (accelerometer/gyro)
- Web Audio API (audio analysis)
- Vanilla HTML/CSS/JS (no frameworks needed)
