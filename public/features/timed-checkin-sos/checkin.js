/**
 * SafeGuard — Feature 1: Timed Check-In SOS
 * If the user doesn't press "I'm Safe" before the timer expires,
 * an automatic SOS alert is dispatched with GPS.
 */
(() => {
  // ── Constants ──
  const STORAGE_KEY_CONTACTS = 'sg_checkin_contacts';
  const STORAGE_KEY_INTERVAL = 'sg_checkin_interval';
  const CIRCUMFERENCE = 2 * Math.PI * 115; // SVG circle radius=115

  // ── State ──
  let timerInterval = null;
  let totalSeconds = 180; // default 3 minutes
  let remainingSeconds = 0;
  let isRunning = false;
  let contacts = [];

  // ── DOM ──
  const $ = (sel) => document.querySelector(sel);
  const ringProgress = $('#ring-progress');
  const timerTime = $('#timer-time');
  const timerLabel = $('#timer-label');
  const safeBtn = $('#safe-btn');
  const startStopBtn = $('#start-stop-btn');
  const statusStrip = $('#status-strip');
  const statusText = $('#status-text');
  const contactList = $('#contact-list');
  const contactNameInput = $('#contact-name');
  const contactPhoneInput = $('#contact-phone');
  const addContactBtn = $('#add-contact-btn');
  const sosOverlay = $('#sos-overlay');
  const sosCancel = $('#sos-cancel');

  // ── Init ──
  function init() {
    loadContacts();
    loadInterval();
    renderContacts();
    updateTimerDisplay(totalSeconds);
    setRingProgress(1);

    // Interval selector buttons
    document.querySelectorAll('.interval-option').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.interval-option').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        totalSeconds = parseInt(btn.dataset.seconds);
        localStorage.setItem(STORAGE_KEY_INTERVAL, totalSeconds);
        if (!isRunning) {
          updateTimerDisplay(totalSeconds);
          setRingProgress(1);
        }
      });
    });

    safeBtn.addEventListener('click', handleSafePress);
    startStopBtn.addEventListener('click', toggleTimer);
    addContactBtn.addEventListener('click', handleAddContact);
    sosCancel.addEventListener('click', cancelSOS);
  }

  // ── Timer Logic ──
  function toggleTimer() {
    if (isRunning) {
      stopTimer();
    } else {
      startTimer();
    }
  }

  function startTimer() {
    remainingSeconds = totalSeconds;
    isRunning = true;
    safeBtn.classList.remove('disabled');
    startStopBtn.textContent = '⏹ Stop Timer';
    startStopBtn.classList.remove('sg-btn-primary');
    startStopBtn.classList.add('sg-btn-outline');
    setStatus('active', '● Timer Active — Check In Required');

    timerInterval = setInterval(() => {
      remainingSeconds--;
      const fraction = remainingSeconds / totalSeconds;
      updateTimerDisplay(remainingSeconds);
      setRingProgress(fraction);

      // Warnings
      if (remainingSeconds <= 0) {
        clearInterval(timerInterval);
        triggerSOS();
      } else if (fraction <= 0.2) {
        setStatus('alert', '🚨 CRITICAL — Check In NOW!');
      } else if (fraction <= 0.4) {
        setStatus('warning', '⚠ Running Low — Please Check In');
      }
    }, 1000);
  }

  function stopTimer() {
    clearInterval(timerInterval);
    isRunning = false;
    safeBtn.classList.add('disabled');
    startStopBtn.textContent = '▶ Start Timer';
    startStopBtn.classList.remove('sg-btn-outline');
    startStopBtn.classList.add('sg-btn-primary');
    setStatus('idle', '○ Timer Inactive');
    updateTimerDisplay(totalSeconds);
    setRingProgress(1);
  }

  function handleSafePress() {
    if (!isRunning) return;
    clearInterval(timerInterval);
    showToast('✅ Check-in confirmed! Timer reset.');
    remainingSeconds = totalSeconds;
    updateTimerDisplay(totalSeconds);
    setRingProgress(1);
    setStatus('active', '● Timer Active — Check In Required');

    // Restart
    timerInterval = setInterval(() => {
      remainingSeconds--;
      const fraction = remainingSeconds / totalSeconds;
      updateTimerDisplay(remainingSeconds);
      setRingProgress(fraction);
      if (remainingSeconds <= 0) {
        clearInterval(timerInterval);
        triggerSOS();
      } else if (fraction <= 0.2) {
        setStatus('alert', '🚨 CRITICAL — Check In NOW!');
      } else if (fraction <= 0.4) {
        setStatus('warning', '⚠ Running Low — Please Check In');
      }
    }, 1000);
  }

  // ── SOS ──
  async function triggerSOS() {
    isRunning = false;
    safeBtn.classList.add('disabled');

    // Get GPS
    let gps = { lat: 0, lng: 0 };
    try {
      const pos = await new Promise((res, rej) =>
        navigator.geolocation.getCurrentPosition(res, rej, { timeout: 5000 })
      );
      gps = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    } catch (e) {
      console.warn('GPS unavailable:', e.message);
    }

    // Show overlay
    sosOverlay.classList.remove('sg-hidden');

    // Emit via event bus
    if (window.SafeGuardBus) {
      window.SafeGuardBus.emit('SOS_TRIGGERED', {
        type: 'CHECKIN_EXPIRED',
        gps,
        timestamp: Date.now(),
        contacts: contacts,
        source: 'timed-checkin-sos'
      });
    }

    // Also dispatch on window for Evidence Locker
    window.dispatchEvent(new CustomEvent('safeguard:SOS_TRIGGERED', {
      detail: { type: 'CHECKIN_EXPIRED', gps, timestamp: Date.now() }
    }));

    // Browser notification
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('🚨 SafeGuard SOS', {
        body: `Check-in timer expired! Location: ${gps.lat.toFixed(4)}, ${gps.lng.toFixed(4)}`,
        icon: '🚨',
        tag: 'safeguard-sos'
      });
    }

    showToast('🚨 SOS Alert Sent!');
  }

  function cancelSOS() {
    sosOverlay.classList.add('sg-hidden');
    stopTimer();
  }

  // ── UI Helpers ──
  function updateTimerDisplay(seconds) {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    timerTime.textContent = `${m}:${s}`;

    const fraction = seconds / totalSeconds;
    timerTime.className = 'timer-time';
    if (fraction <= 0.2) timerTime.classList.add('critical');
    else if (fraction <= 0.4) timerTime.classList.add('warning');
  }

  function setRingProgress(fraction) {
    const offset = CIRCUMFERENCE * (1 - fraction);
    ringProgress.style.strokeDasharray = CIRCUMFERENCE;
    ringProgress.style.strokeDashoffset = offset;

    ringProgress.classList.remove('warning', 'critical');
    if (fraction <= 0.2) ringProgress.classList.add('critical');
    else if (fraction <= 0.4) ringProgress.classList.add('warning');
  }

  function setStatus(type, text) {
    statusStrip.className = 'status-strip ' + type;
    statusText.textContent = text;
  }

  // ── Contacts ──
  function loadContacts() {
    try {
      contacts = JSON.parse(localStorage.getItem(STORAGE_KEY_CONTACTS)) || [];
    } catch { contacts = []; }
  }

  function saveContacts() {
    localStorage.setItem(STORAGE_KEY_CONTACTS, JSON.stringify(contacts));
  }

  function loadInterval() {
    const saved = parseInt(localStorage.getItem(STORAGE_KEY_INTERVAL));
    if (saved && saved > 0) {
      totalSeconds = saved;
      document.querySelectorAll('.interval-option').forEach(btn => {
        btn.classList.toggle('selected', parseInt(btn.dataset.seconds) === saved);
      });
    }
  }

  function renderContacts() {
    if (contacts.length === 0) {
      contactList.innerHTML = '<p style="color:var(--text-muted); font-size:0.8125rem; text-align:center; padding:12px;">No emergency contacts added yet</p>';
      return;
    }
    contactList.innerHTML = contacts.map((c, i) => `
      <div class="contact-item" style="animation-delay:${i * 50}ms">
        <div class="contact-info">
          <span class="contact-name">${escapeHtml(c.name)}</span>
          <span class="contact-phone">${escapeHtml(c.phone)}</span>
        </div>
        <button class="contact-remove" onclick="removeContact(${i})" aria-label="Remove ${escapeHtml(c.name)}">×</button>
      </div>
    `).join('');
  }

  function handleAddContact() {
    const name = contactNameInput.value.trim();
    const phone = contactPhoneInput.value.trim();
    if (!name || !phone) {
      showToast('⚠ Please enter both name and phone');
      return;
    }
    contacts.push({ name, phone });
    saveContacts();
    renderContacts();
    contactNameInput.value = '';
    contactPhoneInput.value = '';
    showToast(`✅ ${name} added`);
  }

  window.removeContact = function(index) {
    const removed = contacts.splice(index, 1);
    saveContacts();
    renderContacts();
    if (removed[0]) showToast(`Removed ${removed[0].name}`);
  };

  // ── Utilities ──
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
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

  // Request notification permission
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }

  // Boot
  init();
})();
