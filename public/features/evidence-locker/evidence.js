/**
 * SafeGuard — Feature 4: Digital Witness Evidence Locker
 * On SOS trigger, auto-starts audio/video recording.
 * Stores evidence in IndexedDB with GPS + timestamp.
 * Mock cloud upload with progress tracking.
 */
(() => {
  // ── State ──
  let isRecording = false;
  let audioRecorder = null;
  let videoRecorder = null;
  let audioChunks = [];
  let videoChunks = [];
  let recordingStart = 0;
  let timerInterval = null;
  let evidenceItems = [];
  let db = null;
  const DB_NAME = 'SafeGuardEvidence';
  const STORE_NAME = 'evidence';

  // ── DOM ──
  const $ = (sel) => document.querySelector(sel);
  const recIndicator = $('#rec-indicator');
  const recLabel = $('#rec-label');
  const recDetail = $('#rec-detail');
  const recTimer = $('#rec-timer');
  const recBanner = $('#rec-banner');
  const startBtn = $('#start-btn');
  const stopBtn = $('#stop-btn');
  const uploadAllBtn = $('#upload-all-btn');
  const evidenceList = $('#evidence-list');
  const statTotal = $('#stat-total');
  const statSynced = $('#stat-synced');
  const statPending = $('#stat-pending');

  // ── Init ──
  async function init() {
    await openDB();
    await loadEvidence();
    renderEvidence();
    updateStats();

    startBtn.addEventListener('click', startRecording);
    stopBtn.addEventListener('click', stopRecording);
    uploadAllBtn.addEventListener('click', uploadAllPending);

    // Listen for SOS events from other features
    window.addEventListener('safeguard:SOS_TRIGGERED', (e) => {
      if (!isRecording) {
        showToast('🔴 SOS detected — auto-recording started');
        startRecording();
      }
    });
  }

  // ── IndexedDB ──
  function openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = (e) => {
        const database = e.target.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        }
      };
      request.onsuccess = (e) => {
        db = e.target.result;
        resolve();
      };
      request.onerror = (e) => {
        console.error('IndexedDB error:', e);
        reject(e);
      };
    });
  }

  function saveToDB(item) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.add(item);
      req.onsuccess = () => resolve(req.result);
      req.onerror = (e) => reject(e);
    });
  }

  function updateInDB(item) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(item);
      req.onsuccess = () => resolve();
      req.onerror = (e) => reject(e);
    });
  }

  function loadEvidence() {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        evidenceItems = req.result.sort((a, b) => b.timestamp - a.timestamp);
        resolve();
      };
      req.onerror = (e) => reject(e);
    });
  }

  // ── Recording ──
  async function startRecording() {
    if (isRecording) return;
    isRecording = true;
    audioChunks = [];
    videoChunks = [];
    recordingStart = Date.now();

    // Update UI
    recBanner.classList.remove('idle');
    recBanner.classList.add('active');
    recIndicator.classList.remove('idle');
    recIndicator.classList.add('active');
    recLabel.textContent = 'Recording Active';
    startBtn.classList.add('sg-hidden');
    stopBtn.classList.remove('sg-hidden');

    // Timer
    timerInterval = setInterval(() => {
      const elapsed = Date.now() - recordingStart;
      const mins = Math.floor(elapsed / 60000).toString().padStart(2, '0');
      const secs = Math.floor((elapsed % 60000) / 1000).toString().padStart(2, '0');
      recTimer.textContent = `${mins}:${secs}`;
    }, 1000);

    // Audio recording
    try {
      const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioRecorder = new MediaRecorder(audioStream, { mimeType: getSupportedMime('audio') });
      audioRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.push(e.data); };
      audioRecorder.start(1000);
      recDetail.textContent = '🎤 Audio capturing';
    } catch (e) {
      console.warn('Audio permission denied:', e.message);
      recDetail.textContent = '⚠ Audio denied';
    }

    // Video recording
    try {
      const videoStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      videoRecorder = new MediaRecorder(videoStream, { mimeType: getSupportedMime('video') });
      videoRecorder.ondataavailable = (e) => { if (e.data.size > 0) videoChunks.push(e.data); };
      videoRecorder.start(1000);
      recDetail.textContent = '🎤 Audio + 📹 Video capturing';
    } catch (e) {
      console.warn('Video permission denied:', e.message);
      if (audioRecorder) recDetail.textContent = '🎤 Audio only (camera denied)';
    }
  }

  async function stopRecording() {
    if (!isRecording) return;
    isRecording = false;
    clearInterval(timerInterval);

    // Update UI
    recBanner.classList.remove('active');
    recBanner.classList.add('idle');
    recIndicator.classList.remove('active');
    recIndicator.classList.add('idle');
    recLabel.textContent = 'Not Recording';
    recDetail.textContent = 'Press Start or trigger SOS to begin';
    recTimer.textContent = '00:00';
    startBtn.classList.remove('sg-hidden');
    stopBtn.classList.add('sg-hidden');

    // Get GPS
    let gps = { lat: 0, lng: 0 };
    try {
      const pos = await new Promise((res, rej) =>
        navigator.geolocation.getCurrentPosition(res, rej, { timeout: 5000 })
      );
      gps = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    } catch (e) {}

    const timestamp = Date.now();
    const duration = timestamp - recordingStart;

    // Stop recorders and save blobs
    if (audioRecorder && audioRecorder.state !== 'inactive') {
      await new Promise(resolve => {
        audioRecorder.onstop = resolve;
        audioRecorder.stop();
      });
      audioRecorder.stream.getTracks().forEach(t => t.stop());
      const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
      const audioItem = {
        type: 'audio',
        blob: audioBlob,
        size: audioBlob.size,
        timestamp,
        duration,
        gps,
        synced: false
      };
      const id = await saveToDB(audioItem);
      audioItem.id = id;
      evidenceItems.unshift(audioItem);
    }

    if (videoRecorder && videoRecorder.state !== 'inactive') {
      await new Promise(resolve => {
        videoRecorder.onstop = resolve;
        videoRecorder.stop();
      });
      videoRecorder.stream.getTracks().forEach(t => t.stop());
      const videoBlob = new Blob(videoChunks, { type: 'video/webm' });
      const videoItem = {
        type: 'video',
        blob: videoBlob,
        size: videoBlob.size,
        timestamp,
        duration,
        gps,
        synced: false
      };
      const id = await saveToDB(videoItem);
      videoItem.id = id;
      evidenceItems.unshift(videoItem);
    }

    audioRecorder = null;
    videoRecorder = null;
    renderEvidence();
    updateStats();
    showToast('✅ Evidence saved locally');
  }

  function getSupportedMime(type) {
    if (type === 'audio') {
      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus';
      if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm';
      return '';
    }
    if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) return 'video/webm;codecs=vp9';
    if (MediaRecorder.isTypeSupported('video/webm')) return 'video/webm';
    return '';
  }

  // ── Mock Upload ──
  async function mockUpload(item) {
    return new Promise((resolve) => {
      let progress = 0;
      const uploadEl = document.getElementById(`upload-${item.id}`);
      const interval = setInterval(() => {
        progress += Math.random() * 20 + 5;
        if (progress >= 100) {
          progress = 100;
          clearInterval(interval);
          item.synced = true;
          updateInDB(item);
          if (uploadEl) {
            uploadEl.querySelector('.upload-progress-fill').style.width = '100%';
            uploadEl.querySelector('.sg-badge').className = 'sg-badge sg-badge-green';
            uploadEl.querySelector('.sg-badge').textContent = '✅ Synced';
          }
          resolve();
        } else {
          if (uploadEl) {
            uploadEl.querySelector('.upload-progress-fill').style.width = progress + '%';
          }
        }
      }, 200 + Math.random() * 300);
    });
  }

  async function uploadAllPending() {
    const pending = evidenceItems.filter(i => !i.synced);
    if (pending.length === 0) {
      showToast('All evidence already synced!');
      return;
    }

    showToast(`📤 Uploading ${pending.length} item(s)...`);
    for (const item of pending) {
      await mockUpload(item);
    }
    updateStats();
    renderEvidence();
    showToast('✅ All evidence uploaded!');
  }

  // ── Render ──
  function renderEvidence() {
    if (evidenceItems.length === 0) {
      evidenceList.innerHTML = `
        <div class="evidence-empty">
          <div class="icon">🔒</div>
          <div class="text">No evidence recorded yet.<br>Trigger SOS or press Start to begin.</div>
        </div>
      `;
      return;
    }

    evidenceList.innerHTML = evidenceItems.map((item, i) => {
      const date = new Date(item.timestamp);
      const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const dateStr = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
      const sizeStr = formatSize(item.size);
      const durationStr = formatDuration(item.duration);
      const syncBadge = item.synced
        ? '<span class="sg-badge sg-badge-green">✅ Synced</span>'
        : '<span class="sg-badge sg-badge-amber">⏳ Pending</span>';

      return `
        <div id="upload-${item.id}" class="evidence-item" style="animation-delay:${i * 40}ms">
          <div class="evidence-type-bar ${item.type}"></div>
          <div class="evidence-content">
            <div class="evidence-header">
              <div class="evidence-title">
                <span class="evidence-type-icon">${item.type === 'audio' ? '🎤' : '📹'}</span>
                ${item.type === 'audio' ? 'Audio' : 'Video'} Recording
              </div>
              ${syncBadge}
            </div>
            <div class="evidence-meta">
              <span class="evidence-meta-item">📅 ${dateStr} ${timeStr}</span>
              <span class="evidence-meta-item">⏱ ${durationStr}</span>
              <span class="evidence-meta-item">💾 ${sizeStr}</span>
            </div>
            <div class="evidence-meta">
              <span class="evidence-meta-item">📍 ${item.gps.lat.toFixed(4)}, ${item.gps.lng.toFixed(4)}</span>
            </div>
            ${!item.synced ? `
              <div style="margin-top:6px;">
                <div class="upload-progress-bar"><div class="upload-progress-fill" style="width:0%"></div></div>
              </div>
            ` : ''}
          </div>
          <div class="evidence-actions">
            <button class="evidence-play-btn" onclick="playEvidence(${item.id})" aria-label="Play recording">▶</button>
          </div>
        </div>
      `;
    }).join('');
  }

  function updateStats() {
    const total = evidenceItems.length;
    const synced = evidenceItems.filter(i => i.synced).length;
    const pending = total - synced;
    statTotal.textContent = total;
    statSynced.textContent = synced;
    statPending.textContent = pending;
  }

  // ── Play Evidence ──
  window.playEvidence = function(id) {
    const item = evidenceItems.find(i => i.id === id);
    if (!item || !item.blob) {
      showToast('⚠ Evidence data not available');
      return;
    }

    const url = URL.createObjectURL(item.blob);
    const overlay = document.createElement('div');
    overlay.className = 'audio-player-overlay';
    overlay.onclick = (e) => { if (e.target === overlay) { overlay.remove(); URL.revokeObjectURL(url); } };

    const mediaTag = item.type === 'audio' ? 'audio' : 'video';
    overlay.innerHTML = `
      <div class="audio-player-modal">
        <h3 style="font-size:1rem; font-weight:700; margin-bottom:4px;">${item.type === 'audio' ? '🎤 Audio' : '📹 Video'} Playback</h3>
        <p style="font-size:0.75rem; color:var(--text-dim);">${new Date(item.timestamp).toLocaleString()}</p>
        <${mediaTag} controls autoplay style="width:100%; border-radius:var(--radius); margin:12px 0;">
          <source src="${url}" type="${item.type}/webm">
        </${mediaTag}>
        <button class="sg-btn sg-btn-outline sg-btn-sm sg-btn-full" onclick="this.closest('.audio-player-overlay').remove()">Close</button>
      </div>
    `;
    document.body.appendChild(overlay);
  };

  // ── Utilities ──
  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  function formatDuration(ms) {
    const secs = Math.floor(ms / 1000);
    const mins = Math.floor(secs / 60);
    const remSecs = secs % 60;
    return `${mins}:${remSecs.toString().padStart(2, '0')}`;
  }

  function showToast(msg) {
    let toast = document.querySelector('.sg-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'sg-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2500);
  }

  init();
})();
