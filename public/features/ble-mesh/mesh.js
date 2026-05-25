/**
 * SafeGuard — Feature 5: BLE Mesh Network (Simulated)
 * Web Bluetooth scanning + simulated mesh node graph.
 * Uses SubtleCrypto for SOS packet encryption.
 */
(() => {
  // ── State ──
  let scanning = false;
  let bleSupported = false;
  let peers = [];
  let animationFrame = null;
  const CUSTOM_SERVICE_UUID = '12345678-1234-5678-1234-56789abcdef0';

  // Simulated peer data
  const SIM_PEERS = [
    { id: 'peer_1', name: 'SG-Node-A7F2', signal: 4, type: 'peer', distance: '~8m', x: 0, y: 0 },
    { id: 'peer_2', name: 'SG-Node-B3D1', signal: 3, type: 'peer', distance: '~15m', x: 0, y: 0 },
    { id: 'peer_3', name: 'SG-Relay-C9E4', signal: 2, type: 'relay', distance: '~25m', x: 0, y: 0 },
    { id: 'peer_4', name: 'SG-Node-D5A8', signal: 1, type: 'peer', distance: '~40m', x: 0, y: 0 },
    { id: 'peer_5', name: 'SG-Relay-E2F6', signal: 3, type: 'relay', distance: '~12m', x: 0, y: 0 },
  ];

  // ── DOM ──
  const $ = (sel) => document.querySelector(sel);
  const meshStatusIcon = $('#mesh-status-icon');
  const meshStatusLabel = $('#mesh-status-label');
  const meshStatusDesc = $('#mesh-status-desc');
  const graphSvg = $('#mesh-graph');
  const peerList = $('#peer-list');
  const scanBtn = $('#scan-btn');
  const sosBtn = $('#mesh-sos-btn');
  const peerCountBadge = $('#peer-count');

  // ── Init ──
  function init() {
    bleSupported = !!navigator.bluetooth;
    scanBtn.addEventListener('click', toggleScan);
    sosBtn.addEventListener('click', sendSOSViaMesh);

    updateMeshStatus('idle');
    drawGraph([]);

    // Listen for SOS from other features
    window.addEventListener('safeguard:SOS_TRIGGERED', () => {
      if (peers.length > 0) sendSOSViaMesh();
    });
  }

  // ── Scanning ──
  function toggleScan() {
    if (scanning) {
      stopScan();
    } else {
      startScan();
    }
  }

  async function startScan() {
    scanning = true;
    scanBtn.textContent = '⏹ Stop Scan';
    scanBtn.classList.remove('sg-btn-primary');
    scanBtn.classList.add('sg-btn-outline');
    updateMeshStatus('scanning');
    peers = [];

    // Attempt real BLE scan
    if (bleSupported) {
      try {
        showToast('📡 Scanning for BLE peers...');
        // This will show the browser's BLE picker
        const device = await navigator.bluetooth.requestDevice({
          filters: [{ services: [CUSTOM_SERVICE_UUID] }],
          optionalServices: [CUSTOM_SERVICE_UUID]
        });
        if (device) {
          showToast(`Found real device: ${device.name || device.id}`);
        }
      } catch (e) {
        // User cancelled or no devices found — fall back to simulation
        console.log('BLE scan cancelled or failed, using simulation');
      }
    }

    // Start simulation regardless
    simulatePeerDiscovery();
  }

  function stopScan() {
    scanning = false;
    scanBtn.textContent = '📡 Start Scan';
    scanBtn.classList.remove('sg-btn-outline');
    scanBtn.classList.add('sg-btn-primary');

    if (peers.length > 0) {
      updateMeshStatus('connected');
    } else {
      updateMeshStatus('idle');
    }
  }

  function simulatePeerDiscovery() {
    let discovered = 0;
    const interval = setInterval(() => {
      if (!scanning || discovered >= SIM_PEERS.length) {
        clearInterval(interval);
        if (scanning) stopScan();
        return;
      }

      const peer = { ...SIM_PEERS[discovered] };
      peers.push(peer);
      discovered++;

      renderPeers();
      drawGraph(peers);
      peerCountBadge.textContent = peers.length;
      updateMeshStatus('scanning');
      showToast(`Found: ${peer.name} (${peer.distance})`);
    }, 800 + Math.random() * 600);
  }

  // ── Mesh Status ──
  function updateMeshStatus(state) {
    const configs = {
      idle: { icon: '📡', label: 'Mesh Idle', desc: 'Start scanning to find peers', bg: 'rgba(100,116,139,0.15)' },
      scanning: { icon: '🔍', label: `Scanning... (${peers.length} found)`, desc: 'Looking for SafeGuard peers nearby', bg: 'rgba(59,130,246,0.15)' },
      connected: { icon: '🟢', label: `${peers.length} Peers Connected`, desc: 'Mesh network ready for SOS relay', bg: 'rgba(34,197,94,0.15)' },
      relaying: { icon: '🚨', label: 'Relaying SOS...', desc: 'Encrypted SOS packet hopping through mesh', bg: 'rgba(239,68,68,0.15)' }
    };
    const c = configs[state] || configs.idle;
    meshStatusIcon.textContent = c.icon;
    meshStatusIcon.style.background = c.bg;
    meshStatusLabel.textContent = c.label;
    meshStatusDesc.textContent = c.desc;
  }

  // ── SOS via Mesh ──
  async function sendSOSViaMesh() {
    if (peers.length === 0) {
      showToast('⚠ No peers found — scan first');
      return;
    }

    updateMeshStatus('relaying');
    sosBtn.disabled = true;
    sosBtn.textContent = '📡 Relaying...';

    // Get GPS
    let gps = { lat: 12.9716, lng: 77.5946 };
    try {
      const pos = await new Promise((res, rej) =>
        navigator.geolocation.getCurrentPosition(res, rej, { timeout: 3000 })
      );
      gps = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    } catch (e) {}

    // Build SOS packet
    const packet = {
      sosType: 'EMERGENCY',
      gpsLat: gps.lat,
      gpsLng: gps.lng,
      timestamp: Date.now(),
      userId: await hashUserId()
    };

    // Encrypt with SubtleCrypto
    const encrypted = await encryptPacket(packet);
    showToast(`🔐 Encrypted packet (${encrypted.length} bytes)`);

    // Animate signal hops
    await animateSignalHops();

    updateMeshStatus('connected');
    sosBtn.disabled = false;
    sosBtn.textContent = '🚨 Send SOS via Mesh';
    showToast('✅ SOS relayed through mesh!');
  }

  async function hashUserId() {
    const data = new TextEncoder().encode('safeguard-user-' + Date.now());
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
  }

  async function encryptPacket(packet) {
    try {
      const key = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt']
      );
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encoded = new TextEncoder().encode(JSON.stringify(packet));
      const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        encoded
      );
      return new Uint8Array(encrypted);
    } catch (e) {
      console.warn('Encryption failed:', e);
      return new Uint8Array(0);
    }
  }

  // ── SVG Graph ──
  function drawGraph(activePeers) {
    const width = graphSvg.clientWidth || 350;
    const height = graphSvg.clientHeight || 350;
    const cx = width / 2;
    const cy = height / 2;

    // Position "You" at center
    const youNode = { id: 'you', name: 'You', x: cx, y: cy, type: 'you' };

    // Position peers in a circle around center
    const angleStep = (2 * Math.PI) / Math.max(activePeers.length, 1);
    activePeers.forEach((p, i) => {
      const radius = 80 + Math.random() * 40;
      p.x = cx + radius * Math.cos(angleStep * i - Math.PI / 2);
      p.y = cy + radius * Math.sin(angleStep * i - Math.PI / 2);
    });

    let svgContent = '';

    // Draw edges
    activePeers.forEach(p => {
      svgContent += `<line class="mesh-edge active" x1="${cx}" y1="${cy}" x2="${p.x}" y2="${p.y}"/>`;
    });

    // Draw inter-peer edges (some)
    for (let i = 0; i < activePeers.length - 1; i++) {
      if (Math.random() > 0.5) {
        svgContent += `<line class="mesh-edge" x1="${activePeers[i].x}" y1="${activePeers[i].y}" x2="${activePeers[i+1].x}" y2="${activePeers[i+1].y}"/>`;
      }
    }

    // Draw peer nodes
    activePeers.forEach(p => {
      const nodeClass = p.type === 'relay' ? 'mesh-node-relay' : 'mesh-node-peer';
      svgContent += `
        <g class="mesh-node ${nodeClass}" transform="translate(${p.x},${p.y})">
          <circle class="mesh-node-circle" cx="0" cy="0" r="12"/>
          <text class="mesh-node-label" dy="28">${p.name.split('-').pop()}</text>
        </g>
      `;
    });

    // Draw "You" node (on top)
    svgContent += `
      <g class="mesh-node mesh-node-you" transform="translate(${cx},${cy})">
        <circle class="mesh-node-circle" cx="0" cy="0" r="18" opacity="0.2"/>
        <circle class="mesh-node-circle" cx="0" cy="0" r="14"/>
        <text class="mesh-node-label" dy="32" style="font-weight:700; fill:var(--text);">YOU</text>
      </g>
    `;

    graphSvg.innerHTML = svgContent;
  }

  async function animateSignalHops() {
    const width = graphSvg.clientWidth || 350;
    const height = graphSvg.clientHeight || 350;
    const cx = width / 2;
    const cy = height / 2;

    for (const peer of peers) {
      // Create signal packet dot
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('class', 'signal-packet signal-animate');
      circle.setAttribute('cx', cx);
      circle.setAttribute('cy', cy);
      circle.setAttribute('r', '4');
      graphSvg.appendChild(circle);

      // Animate from center to peer
      const duration = 600;
      const startTime = performance.now();
      await new Promise(resolve => {
        function animate(now) {
          const t = Math.min((now - startTime) / duration, 1);
          const eased = t * (2 - t); // ease-out
          circle.setAttribute('cx', cx + (peer.x - cx) * eased);
          circle.setAttribute('cy', cy + (peer.y - cy) * eased);
          if (t < 1) {
            requestAnimationFrame(animate);
          } else {
            setTimeout(() => {
              circle.remove();
              resolve();
            }, 200);
          }
        }
        requestAnimationFrame(animate);
      });
    }
  }

  // ── Render Peers ──
  function renderPeers() {
    if (peers.length === 0) {
      peerList.innerHTML = `
        <div style="text-align:center; padding:20px; color:var(--text-muted); font-size:0.875rem;">
          No peers discovered yet. Start a scan.
        </div>
      `;
      return;
    }

    peerList.innerHTML = peers.map((p, i) => {
      const color = p.type === 'relay' ? 'var(--amber)' : 'var(--blue)';
      const bg = p.type === 'relay' ? 'rgba(245,158,11,0.15)' : 'rgba(59,130,246,0.15)';
      const signalBars = [1,2,3,4].map(n =>
        `<div class="peer-signal-bar ${n <= p.signal ? 'active' : ''}" style="height:${4 + n * 3}px;"></div>`
      ).join('');

      return `
        <div class="peer-card" style="animation-delay:${i * 60}ms">
          <div class="peer-icon" style="background:${bg}; color:${color};">
            ${p.type === 'relay' ? '📡' : '📱'}
          </div>
          <div class="peer-info">
            <div class="peer-name">${p.name}</div>
            <div class="peer-meta">${p.type === 'relay' ? 'Relay Node' : 'Peer Device'} • ${p.distance}</div>
          </div>
          <div class="peer-signal">${signalBars}</div>
        </div>
      `;
    }).join('');
  }

  // ── Utilities ──
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
