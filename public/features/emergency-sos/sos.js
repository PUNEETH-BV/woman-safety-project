/**
 * SafeGuard — Feature 2: Emergency SOS
 * One-tap SOS with 3-second cancellable countdown.
 * Supports: tap, shake detection, voice trigger.
 */
(() => {
  // ── State ──
  let sosState = 'READY'; // READY | COUNTDOWN | SENDING | SENT | CONFIRMED
  let countdownTimer = null;
  let countdownValue = 3;
  let shakeEnabled = false;
  let voiceEnabled = false;
  let recognition = null;

  // ── DOM ──
  const $ = (sel) => document.querySelector(sel);
  const sosBtn = $('#sos-btn');
  const countdownOverlay = $('#countdown-overlay');
  const countdownNumber = $('#countdown-number');
  const countdownCancel = $('#countdown-cancel');
  const sentOverlay = $('#sent-overlay');
  const sentDismiss = $('#sent-dismiss');
  const shakeToggle = $('#shake-toggle');
  const voiceToggle = $('#voice-toggle');
  const statusIcon = $('#current-status-icon');
  const statusLabel = $('#current-status-label');
  const statusDesc = $('#current-status-desc');
  const pulse1 = $('#pulse-1');
  const pulse2 = $('#pulse-2');
  const pulse3 = $('#pulse-3');

  // ── Init ──
  function init() {
    sosBtn.addEventListener('click', startCountdown);
    countdownCancel.addEventListener('click', cancelCountdown);
    sentDismiss.addEventListener('click', resetToReady);
    shakeToggle.addEventListener('click', toggleShake);
    voiceToggle.addEventListener('click', toggleVoice);

    updateStatus('READY');
  }

  // ── Countdown ──
  function startCountdown() {
    if (sosState !== 'READY') return;
    sosState = 'COUNTDOWN';
    countdownValue = 3;
    countdownNumber.textContent = countdownValue;
    countdownOverlay.classList.remove('sg-hidden');

    countdownTimer = setInterval(() => {
      countdownValue--;
      if (countdownValue <= 0) {
        clearInterval(countdownTimer);
        countdownOverlay.classList.add('sg-hidden');
        fireSOS();
      } else {
        countdownNumber.textContent = countdownValue;
      }
    }, 1000);
  }

  function cancelCountdown() {
    clearInterval(countdownTimer);
    countdownOverlay.classList.add('sg-hidden');
    sosState = 'READY';
    updateStatus('READY');
    showToast('SOS cancelled');
  }

  // ── Fire SOS ──
  async function fireSOS() {
    sosState = 'SENDING';
    updateStatus('SENDING');
    sentOverlay.classList.remove('sg-hidden');

    // Step 1: Get GPS
    let gps = { lat: 0, lng: 0 };
    try {
      const pos = await new Promise((res, rej) =>
        navigator.geolocation.getCurrentPosition(res, rej, { timeout: 5000 })
      );
      gps = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    } catch (e) {
      console.warn('GPS unavailable');
    }
    markStep('step-gps');

    // Step 2: Browser notification
    await sleep(400);
    if ('Notification' in window) {
      if (Notification.permission === 'default') await Notification.requestPermission();
      if (Notification.permission === 'granted') {
        new Notification('🚨 SafeGuard EMERGENCY SOS', {
          body: `Emergency SOS triggered! Location: ${gps.lat.toFixed(4)}, ${gps.lng.toFixed(4)}`,
          tag: 'safeguard-emergency'
        });
      }
    }
    markStep('step-notify');

    // Step 3: Emit event bus
    await sleep(400);
    if (window.SafeGuardBus) {
      window.SafeGuardBus.emit('SOS_TRIGGERED', {
        type: 'EMERGENCY',
        gps,
        timestamp: Date.now(),
        source: 'emergency-sos'
      });
    }
    window.dispatchEvent(new CustomEvent('safeguard:SOS_TRIGGERED', {
      detail: { type: 'EMERGENCY', gps, timestamp: Date.now() }
    }));
    markStep('step-relay');

    // Step 4: Done
    await sleep(500);
    markStep('step-done');
    sosState = 'SENT';
    updateStatus('SENT');
  }

  function markStep(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('done');
  }

  function resetToReady() {
    sentOverlay.classList.add('sg-hidden');
    // Reset step indicators
    document.querySelectorAll('.sent-step').forEach(s => s.classList.remove('done'));
    sosState = 'READY';
    updateStatus('READY');
  }

  // ── Status Display ──
  function updateStatus(state) {
    const configs = {
      READY: { icon: '🟢', label: 'Ready', desc: 'Press SOS to send emergency alert', iconBg: 'rgba(34,197,94,0.15)', pulses: true },
      COUNTDOWN: { icon: '🟡', label: 'Countdown', desc: 'Cancel within 3 seconds...', iconBg: 'rgba(245,158,11,0.15)', pulses: false },
      SENDING: { icon: '🔴', label: 'Sending...', desc: 'Dispatching SOS to all channels', iconBg: 'rgba(239,68,68,0.15)', pulses: false },
      SENT: { icon: '✅', label: 'Alert Sent', desc: 'SOS was dispatched successfully', iconBg: 'rgba(34,197,94,0.15)', pulses: false },
    };
    const c = configs[state] || configs.READY;
    statusIcon.textContent = c.icon;
    statusIcon.style.background = c.iconBg;
    statusLabel.textContent = c.label;
    statusDesc.textContent = c.desc;

    [pulse1, pulse2, pulse3].forEach(p => p.classList.toggle('active', c.pulses));
  }

  // ── Shake Detection ──
  function toggleShake() {
    shakeEnabled = !shakeEnabled;
    shakeToggle.classList.toggle('active', shakeEnabled);

    if (shakeEnabled) {
      let lastShake = 0;
      window._shakeHandler = (e) => {
        const acc = e.accelerationIncludingGravity;
        if (!acc) return;
        const magnitude = Math.sqrt(acc.x * acc.x + acc.y * acc.y + acc.z * acc.z);
        if (magnitude > 30 && Date.now() - lastShake > 3000) {
          lastShake = Date.now();
          if (sosState === 'READY') {
            showToast('📳 Shake detected! Triggering SOS...');
            startCountdown();
          }
        }
      };
      window.addEventListener('devicemotion', window._shakeHandler);
      showToast('📳 Shake detection ON');
    } else {
      if (window._shakeHandler) {
        window.removeEventListener('devicemotion', window._shakeHandler);
        window._shakeHandler = null;
      }
      showToast('Shake detection OFF');
    }
  }

  // ── Voice Trigger ──
  function toggleVoice() {
    voiceEnabled = !voiceEnabled;
    voiceToggle.classList.toggle('active', voiceEnabled);

    if (voiceEnabled) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) {
        showToast('⚠ Voice not supported in this browser');
        voiceEnabled = false;
        voiceToggle.classList.remove('active');
        return;
      }

      recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript.toLowerCase().trim();
          if (transcript.includes('hey sos') || transcript.includes('help me') || transcript.includes('emergency')) {
            if (sosState === 'READY') {
              showToast('🎙 Voice trigger detected!');
              startCountdown();
            }
          }
        }
      };

      recognition.onerror = (e) => {
        console.warn('Speech recognition error:', e.error);
        if (e.error === 'not-allowed') {
          showToast('⚠ Microphone access denied');
          voiceEnabled = false;
          voiceToggle.classList.remove('active');
        }
      };

      recognition.onend = () => {
        if (voiceEnabled) {
          try { recognition.start(); } catch (e) { /* restarting */ }
        }
      };

      try {
        recognition.start();
        showToast('🎙 Voice trigger ON — say "Hey SOS"');
      } catch (e) {
        showToast('⚠ Could not start voice recognition');
        voiceEnabled = false;
        voiceToggle.classList.remove('active');
      }
    } else {
      if (recognition) {
        try { recognition.stop(); } catch (e) {}
        recognition = null;
      }
      showToast('Voice trigger OFF');
    }
  }

  // ── Utilities ──
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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

  // Request notification permission
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }

  init();
})();
