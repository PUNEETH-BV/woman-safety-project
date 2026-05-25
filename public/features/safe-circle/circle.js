/**
 * SafeGuard — Feature 3: Safe-Circle Monitoring
 * Join a named circle, share "I'm walking home" status,
 * see real-time member list, AI nudge on stale GPS.
 */
(() => {
  // ── State ──
  let circleName = null;
  let isWalking = false;
  let myGps = { lat: 12.9716, lng: 77.5946 }; // default Bangalore
  let lastGps = null;
  let lastMoveTime = Date.now();
  let members = [];
  let map = null;
  let markers = {};
  let myMarker = null;
  let gpsWatchId = null;
  let memberUpdateInterval = null;
  let staleCheckInterval = null;

  // Mock member names for demo
  const MOCK_NAMES = ['Priya S.', 'Ananya R.', 'Kavya M.', 'Deepa K.', 'Sneha T.'];
  const MOCK_STATUSES = ['Online', 'Walking home', 'At destination', 'Walking home', 'Online'];

  // ── DOM ──
  const $ = (sel) => document.querySelector(sel);
  const circleInput = $('#circle-input');
  const joinBtn = $('#join-btn');
  const joinSection = $('#join-section');
  const activeSection = $('#active-section');
  const circleBannerName = $('#circle-banner-name');
  const circleBannerCount = $('#circle-banner-count');
  const leaveBtn = $('#leave-btn');
  const walkingToggle = $('#walking-toggle');
  const walkingSwitch = $('#walking-switch');
  const memberList = $('#member-list');
  const mapContainer = $('#map-container');

  // ── Init ──
  function init() {
    joinBtn.addEventListener('click', joinCircle);
    circleInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') joinCircle(); });
    leaveBtn.addEventListener('click', leaveCircle);
    walkingToggle.addEventListener('click', toggleWalking);

    // Check if was in a circle
    const saved = localStorage.getItem('sg_circle');
    if (saved) {
      circleInput.value = saved;
      joinCircle();
    }
  }

  // ── Circle Management ──
  function joinCircle() {
    const name = circleInput.value.trim();
    if (!name) {
      showToast('⚠ Enter a circle name');
      return;
    }

    circleName = name;
    localStorage.setItem('sg_circle', name);

    joinSection.classList.add('sg-hidden');
    activeSection.classList.remove('sg-hidden');
    circleBannerName.textContent = circleName;

    // Start GPS
    startGPS();

    // Init map
    initMap();

    // Start mock members
    generateMockMembers();
    memberUpdateInterval = setInterval(updateMockMembers, 5000);

    // Stale check every 30s
    staleCheckInterval = setInterval(checkStalePosition, 30000);

    showToast(`Joined circle: ${circleName}`);
  }

  function leaveCircle() {
    circleName = null;
    localStorage.removeItem('sg_circle');

    joinSection.classList.remove('sg-hidden');
    activeSection.classList.add('sg-hidden');

    if (gpsWatchId) navigator.geolocation.clearWatch(gpsWatchId);
    if (memberUpdateInterval) clearInterval(memberUpdateInterval);
    if (staleCheckInterval) clearInterval(staleCheckInterval);
    if (map) { map.remove(); map = null; }
    members = [];
    markers = {};

    showToast('Left the circle');
  }

  function toggleWalking() {
    isWalking = !isWalking;
    walkingToggle.classList.toggle('active', isWalking);
    walkingSwitch.classList.toggle('on', isWalking);

    if (isWalking) {
      showToast('🚶‍♀️ Status: Walking home');
    } else {
      showToast('Status: Online');
    }
    renderMembers();
  }

  // ── GPS ──
  function startGPS() {
    if (!navigator.geolocation) {
      showToast('⚠ GPS not available');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        myGps = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        lastGps = { ...myGps };
        lastMoveTime = Date.now();
        if (map) updateMapView();
      },
      (err) => console.warn('GPS error:', err.message),
      { enableHighAccuracy: true }
    );

    gpsWatchId = navigator.geolocation.watchPosition(
      (pos) => {
        const newGps = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        const dist = haversine(myGps, newGps);
        myGps = newGps;

        if (dist > 10) { // moved > 10 meters
          lastGps = { ...newGps };
          lastMoveTime = Date.now();
        }

        if (map) updateMapView();
      },
      (err) => console.warn('GPS watch error:', err.message),
      { enableHighAccuracy: true, maximumAge: 5000 }
    );
  }

  function haversine(a, b) {
    const R = 6371000;
    const dLat = (b.lat - a.lat) * Math.PI / 180;
    const dLng = (b.lng - a.lng) * Math.PI / 180;
    const lat1 = a.lat * Math.PI / 180;
    const lat2 = b.lat * Math.PI / 180;
    const s = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng/2) * Math.sin(dLng/2);
    return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1-s));
  }

  // ── Stale Check ──
  function checkStalePosition() {
    if (!isWalking) return;
    const elapsed = Date.now() - lastMoveTime;
    if (elapsed > 5 * 60 * 1000) { // 5 minutes
      showStaleAlert();
    }
  }

  function showStaleAlert() {
    // Remove existing
    const existing = document.querySelector('.stale-alert');
    if (existing) existing.remove();

    const alert = document.createElement('div');
    alert.className = 'stale-alert';
    alert.innerHTML = `
      <div class="stale-title">⚠ No Movement Detected</div>
      <div class="stale-body">You haven't moved in over 5 minutes while "Walking Home" is active. Are you okay?</div>
      <button class="stale-dismiss" onclick="this.parentElement.remove()">I'm OK, Dismiss</button>
    `;
    document.body.appendChild(alert);

    // Auto-dismiss after 30s
    setTimeout(() => { if (alert.parentElement) alert.remove(); }, 30000);
  }

  // ── Map ──
  function initMap() {
    if (typeof L === 'undefined') {
      console.warn('Leaflet not loaded');
      return;
    }

    map = L.map('map-container', {
      center: [myGps.lat, myGps.lng],
      zoom: 15,
      zoomControl: false,
      attributionControl: false
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19
    }).addTo(map);

    // My marker
    myMarker = L.circleMarker([myGps.lat, myGps.lng], {
      radius: 8,
      color: '#22c55e',
      fillColor: '#22c55e',
      fillOpacity: 0.8,
      weight: 2
    }).addTo(map);

    myMarker.bindPopup('<strong>You</strong>');
  }

  function updateMapView() {
    if (!map || !myMarker) return;
    myMarker.setLatLng([myGps.lat, myGps.lng]);

    // Update mock member markers
    members.forEach((m, i) => {
      if (markers[m.id]) {
        markers[m.id].setLatLng([m.lat, m.lng]);
      } else {
        const color = m.walking ? '#f59e0b' : '#3b82f6';
        markers[m.id] = L.circleMarker([m.lat, m.lng], {
          radius: 6,
          color: color,
          fillColor: color,
          fillOpacity: 0.7,
          weight: 2
        }).addTo(map);
        markers[m.id].bindPopup(`<strong>${m.name}</strong><br>${m.walking ? '🚶 Walking' : '📍 Online'}`);
      }
    });
  }

  // ── Mock Members ──
  function generateMockMembers() {
    members = MOCK_NAMES.map((name, i) => ({
      id: 'mock_' + i,
      name,
      status: MOCK_STATUSES[i],
      walking: MOCK_STATUSES[i] === 'Walking home',
      lat: myGps.lat + (Math.random() - 0.5) * 0.01,
      lng: myGps.lng + (Math.random() - 0.5) * 0.01,
      lastUpdate: Date.now() - Math.random() * 300000
    }));
    renderMembers();
    circleBannerCount.textContent = `${members.length + 1} members`;
  }

  function updateMockMembers() {
    members.forEach(m => {
      // Simulate movement
      if (m.walking) {
        m.lat += (Math.random() - 0.5) * 0.0003;
        m.lng += (Math.random() - 0.5) * 0.0003;
      }
      // Random status changes
      if (Math.random() < 0.1) {
        m.walking = !m.walking;
        m.status = m.walking ? 'Walking home' : 'Online';
      }
      m.lastUpdate = Date.now();
    });

    // Occasionally add/remove member
    if (Math.random() < 0.05 && members.length < 8) {
      const newName = 'User_' + Math.floor(Math.random() * 100);
      members.push({
        id: 'mock_new_' + Date.now(),
        name: newName,
        status: 'Just joined',
        walking: false,
        lat: myGps.lat + (Math.random() - 0.5) * 0.01,
        lng: myGps.lng + (Math.random() - 0.5) * 0.01,
        lastUpdate: Date.now()
      });
    }

    renderMembers();
    updateMapView();
    circleBannerCount.textContent = `${members.length + 1} members`;
  }

  function renderMembers() {
    // Add "You" at top
    const you = {
      id: 'self',
      name: 'You',
      status: isWalking ? '🚶‍♀️ Walking home' : '📍 Online',
      walking: isWalking,
      isSelf: true
    };

    const allMembers = [you, ...members];

    memberList.innerHTML = allMembers.map((m, i) => {
      const avatarColor = m.isSelf ? 'var(--green)' : (m.walking ? 'var(--amber)' : 'var(--blue)');
      const avatarBg = m.isSelf ? 'rgba(34,197,94,0.15)' : (m.walking ? 'rgba(245,158,11,0.15)' : 'rgba(59,130,246,0.15)');
      const timeAgo = m.lastUpdate ? formatTimeAgo(m.lastUpdate) : '';

      return `
        <div class="member-card ${m.walking ? 'member-walking' : ''}" style="animation-delay:${i * 40}ms">
          <div class="member-avatar" style="background:${avatarBg}; color:${avatarColor};">
            ${m.isSelf ? '👤' : m.name.charAt(0)}
          </div>
          <div class="member-info">
            <div class="member-name">${m.name}${m.isSelf ? ' (You)' : ''}</div>
            <div class="member-status">${m.status}${timeAgo ? ' • ' + timeAgo : ''}</div>
          </div>
          <div class="member-dot" style="background:${m.walking ? 'var(--amber)' : 'var(--green)'}"></div>
        </div>
      `;
    }).join('');
  }

  // ── Utilities ──
  function formatTimeAgo(timestamp) {
    const diff = Date.now() - timestamp;
    if (diff < 60000) return 'now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    return Math.floor(diff / 3600000) + 'h ago';
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
