const http = require('http');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080;
const tunnels = new Map(); // tunnelId -> { ws, stats: { requests: 0, bytes: 0 }, createdAt, isAlive: true }
const pendingRequests = new Map(); // requestId -> { res, timeout }

const ADJECTIVES = ['swift', 'silent', 'cosmic', 'hyper', 'shadow', 'neon', 'cyber', 'quantum', 'wild', 'stealth'];
const NOUNS = ['fox', 'lynx', 'falcon', 'ghost', 'titan', 'wolf', 'viper', 'matrix', 'beacon', 'drifter'];
function generateSlug() {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const num = Math.floor(10 + Math.random() * 90);
  return `${adj}-${noun}-${num}`;
}

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const host = req.headers.host || '';

  // 1. API Endpoint: Terminate / Delete an Instance
  if (parsedUrl.pathname.startsWith('/api/terminate/')) {
    const toDeleteId = parsedUrl.pathname.replace('/api/terminate/', '').trim();
    if (tunnels.has(toDeleteId)) {
      const t = tunnels.get(toDeleteId);
      try { t.ws.close(); } catch (e) {}
      tunnels.delete(toDeleteId);
      console.log(`[!] Instance forcefully terminated: ${toDeleteId}`);
    }
    // Redirect back to dashboard
    res.writeHead(302, { Location: '/' });
    return res.end();
  }

  // 1.5 API Endpoint: Verify PIN Passcode
  if (parsedUrl.pathname.startsWith('/api/verify-pin/')) {
    const targetTunnelId = parsedUrl.pathname.replace('/api/verify-pin/', '').trim();
    const tunnel = tunnels.get(targetTunnelId);

    if (!tunnel) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, message: 'Tunnel not found or expired' }));
    }

    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try {
        const { pin: enteredPin } = JSON.parse(Buffer.concat(chunks).toString() || '{}');
        if (enteredPin && tunnel.pin && enteredPin.toString() === tunnel.pin.toString()) {
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Set-Cookie': `wormhole_pin_${targetTunnelId}=authorized; Path=/; SameSite=Lax; Max-Age=86400`,
          });
          return res.end(JSON.stringify({ success: true, redirect: `/t/${targetTunnelId}/` }));
        } else {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, message: 'Access Denied: Invalid Passcode' }));
        }
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, message: 'Malformed verification payload' }));
      }
    });
    return;
  }

  // 2. Dashboard Homepage
  if (parsedUrl.pathname === '/' || parsedUrl.pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    const activeList = Array.from(tunnels.entries()).map(([id, t]) => {
      const liveUrl = `/t/${id}/`;
      return `
        <li style="margin: 12px 0; padding: 16px; background: #18181b; border: 1px solid #27272a; border-radius: 10px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
          <div>
            <strong style="color: #22c55e; font-size: 16px;">${id}</strong>
            ${t.targetPort ? `<span style="background: #27272a; color: #38bdf8; padding: 2px 8px; border-radius: 4px; font-size: 12px; margin-left: 8px; font-family: monospace;">&rarr; localhost:${t.targetPort}</span>` : ''}
            <span style="color: #71717a; margin-left: 10px; font-size: 12px;">Active since ${new Date(t.createdAt).toLocaleTimeString()}</span>
            <div style="color: #a1a1aa; font-size: 13px; margin-top: 4px;">Served ${t.stats.requests} requests (${(t.stats.bytes / 1024).toFixed(1)} KB)</div>
          </div>
          <div style="display: flex; gap: 8px;">
            <a href="${liveUrl}" target="_blank" style="background: #3b82f6; color: white; text-decoration: none; padding: 8px 16px; border-radius: 6px; font-weight: bold; font-size: 13px;">Open Tunnel &rarr;</a>
            <a href="/api/terminate/${id}" style="background: #ef444420; color: #ef4444; border: 1px solid #ef444450; text-decoration: none; padding: 8px 14px; border-radius: 6px; font-weight: bold; font-size: 13px;" onclick="return confirm('Terminate this tunnel instance?')">✕ Delete</a>
          </div>
        </li>
      `;
    }).join('') || '<p style="color: #71717a; font-style: italic;">No active tunnels yet. Connect a client using: <code style="color: #38bdf8;">node client.js --port 3000</code></p>';

    return res.end(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>WormHole | Public Relay Hub</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #09090b; color: #f4f4f5; margin: 0; padding: 40px 20px; }
          .container { max-width: 720px; margin: 0 auto; }
          h1 { font-size: 32px; font-weight: 800; margin-bottom: 4px; display: flex; align-items: center; gap: 10px; }
          .badge { background: #22c55e20; color: #4ade80; border: 1px solid #22c55e40; padding: 2px 8px; font-size: 12px; border-radius: 999px; }
          .subtitle { color: #a1a1aa; margin-bottom: 30px; font-size: 15px; }
          .card { background: #121214; border: 1px solid #27272a; border-radius: 12px; padding: 24px; margin-bottom: 24px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
          code { font-family: monospace; background: #27272a; padding: 2px 6px; border-radius: 4px; color: #e4e4e7; }
          ul { list-style: none; padding: 0; margin: 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🌀 WormHole <span class="badge">Relay Online</span></h1>
          <div class="subtitle">Next-Gen Localhost Tunneling & Remote Preview Engine</div>
          
          <div class="card">
            <h3 style="margin-top:0; color: #f4f4f5;">⚡ Quick Start</h3>
            <p style="color: #a1a1aa; font-size: 14px; line-height: 1.6;">
              Start any local project on your laptop (e.g. port 3000, 5173), then run:
            </p>
            <div style="background: #000; padding: 12px 16px; border-radius: 6px; border: 1px solid #27272a; font-family: monospace; color: #38bdf8; font-size: 14px;">
              node client.js --port 5173
            </div>
          </div>

          <div class="card">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
              <h3 style="margin:0;">📡 Active Tunnels (${tunnels.size})</h3>
              <span style="font-size: 12px; color: #71717a;">Auto-cleans on disconnect</span>
            </div>
            <ul>${activeList}</ul>
          </div>
        </div>
      </body>
      </html>
    `);
  }

  // 3. Identify Tunnel from Request
  let tunnelId = null;
  let targetPath = parsedUrl.pathname + parsedUrl.search;

  const pathMatch = parsedUrl.pathname.match(/^\/t\/([a-zA-Z0-9_-]+)(\/.*)?$/);
  if (pathMatch) {
    tunnelId = pathMatch[1];
    targetPath = (pathMatch[2] || '/') + parsedUrl.search;
  } else {
    // Subdomain format
    const parts = host.split('.');
    if (parts.length > 2 && tunnels.has(parts[0])) {
      tunnelId = parts[0];
    }
  }

  // Smart Cookie Fallback: When React lazy-loaded screens, dynamic imports, or fetch()
  // request root paths (e.g. /src/screens/LoginPage.jsx), the browser sends the session cookie!
  if (!tunnelId && req.headers.cookie) {
    const cookieMatch = req.headers.cookie.match(/wormhole_active_tunnel=([a-zA-Z0-9_-]+)/);
    if (cookieMatch && tunnels.has(cookieMatch[1])) {
      tunnelId = cookieMatch[1];
      targetPath = parsedUrl.pathname + parsedUrl.search;
    }
  }

  // Smart Referer Fallback: When Vite or React requests root scripts like "/src/main.jsx",
  // the browser sends "Referer: .../t/tunnelId/". We catch it and route it to the right tunnel!
  if (!tunnelId && req.headers.referer) {
    try {
      const refUrl = new URL(req.headers.referer);
      const refMatch = refUrl.pathname.match(/^\/t\/([a-zA-Z0-9_-]+)/);
      if (refMatch && tunnels.has(refMatch[1])) {
        tunnelId = refMatch[1];
        targetPath = parsedUrl.pathname + parsedUrl.search;
      }
    } catch (e) {}
  }

  if (!tunnelId) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('WormHole: 404 Not Found. Use /t/<tunnelId>/ to access a tunnel.');
  }

  const tunnel = tunnels.get(tunnelId);
  if (!tunnel || tunnel.ws.readyState !== 1 /* WebSocket.OPEN */) {
    tunnels.delete(tunnelId); // Auto-cleanup dead instance
    res.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(`
      <div style="font-family: sans-serif; background: #09090b; color: #f4f4f5; height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; margin:0;">
        <h2 style="color: #ef4444; margin-bottom: 8px;">👻 502 Bad Gateway</h2>
        <p style="color: #a1a1aa;">Tunnel <strong>${tunnelId}</strong> is offline or disconnected.</p>
        <p style="color: #71717a; font-size: 13px;">This tunnel instance has been automatically removed.</p>
        <a href="/" style="color: #3b82f6; margin-top: 16px;">&larr; Back to Dashboard</a>
      </div>
    `);
  }

  // 3.5 PIN Protection Gate
  if (tunnel.pin) {
    const authCookie = `wormhole_pin_${tunnelId}=authorized`;
    const hasPinAuth = req.headers.cookie && req.headers.cookie.includes(authCookie);

    if (!hasPinAuth) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(renderCyberpunkKeypad(tunnelId));
    }
  }

  // 4. Collect Incoming Request Body
  const bodyChunks = [];
  req.on('data', chunk => bodyChunks.push(chunk));
  req.on('end', () => {
    const rawBody = Buffer.concat(bodyChunks);
    const requestId = crypto.randomUUID();

    tunnel.stats.requests++;

    const packet = {
      type: 'request',
      requestId,
      method: req.method,
      url: targetPath,
      headers: req.headers,
      body: rawBody.toString('base64'),
    };

    const timeout = setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        pendingRequests.delete(requestId);
        if (!res.headersSent) {
          res.writeHead(504, { 'Content-Type': 'text/plain' });
          res.end('WormHole: 504 Gateway Timeout (Local server took too long to reply)');
        }
      }
    }, 30000);

    pendingRequests.set(requestId, { res, timeout, tunnelId });

    try {
      tunnel.ws.send(JSON.stringify(packet));
    } catch (err) {
      clearTimeout(timeout);
      pendingRequests.delete(requestId);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('WormHole: Error forwarding request to client');
    }
  });
});

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (parsed.pathname === '/tunnel-connect') {
    wss.handleUpgrade(req, socket, head, ws => {
      wss.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', (ws, req) => {
  const parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let requestedName = parsed.searchParams.get('name') || '';
  const targetPort = parsed.searchParams.get('targetPort') || '';
  const pin = parsed.searchParams.get('pin') || '';
  
  requestedName = requestedName.toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (!requestedName) {
    requestedName = generateSlug();
  }

  // If tunnel already exists (e.g. client reconnected or restarted),
  // kick the old stale socket and reclaim the same link cleanly!
  if (tunnels.has(requestedName)) {
    const oldTunnel = tunnels.get(requestedName);
    try { oldTunnel.ws.terminate(); } catch (e) {}
    tunnels.delete(requestedName);
    console.log(`[~] Reclaimed existing tunnel session: ${requestedName}`);
  }

  const tunnelId = requestedName;
  const tunnelData = {
    ws,
    targetPort,
    pin,
    stats: { requests: 0, bytes: 0 },
    createdAt: Date.now(),
    isAlive: true,
  };

  tunnels.set(tunnelId, tunnelData);
  console.log(`[+] Tunnel Established: ${tunnelId} (Active: ${tunnels.size})`);

  ws.send(JSON.stringify({
    type: 'welcome',
    tunnelId,
    publicPath: `/t/${tunnelId}/`,
  }));

  ws.on('pong', () => {
    tunnelData.isAlive = true;
  });

  ws.on('message', data => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.type === 'response') {
        const pending = pendingRequests.get(msg.requestId);
        if (!pending) return;

        clearTimeout(pending.timeout);
        pendingRequests.delete(msg.requestId);

        const { res } = pending;
        if (res.headersSent) return;

        const headers = { ...msg.headers };
        delete headers['content-length'];

        let bodyBuffer = msg.body ? Buffer.from(msg.body, 'base64') : Buffer.alloc(0);
        tunnelData.stats.bytes += bodyBuffer.length;

        // Smart HTML rewriting for Vite / React root paths:
        const contentType = headers['content-type'] || '';
        if (contentType.includes('text/html')) {
          let html = bodyBuffer.toString('utf-8');

          // Inject <base> tag so relative paths work automatically
          if (html.includes('<head>')) {
            html = html.replace('<head>', `<head><base href="/t/${tunnelId}/">`);
          } else if (html.includes('<head ')) {
            html = html.replace(/<head([^>]*)>/i, `<head$1><base href="/t/${tunnelId}/">`);
          }

          // Rewrite root paths in scripts, links, and Vite endpoints
          html = html.replace(/(src|href)=["']\/(?!\/|t\/)/gi, `$1="/t/${tunnelId}/`);

          bodyBuffer = Buffer.from(html, 'utf-8');
        }

        // Set tunnel session cookie so all lazy-loaded routes and dynamic imports know their tunnel
        headers['set-cookie'] = `wormhole_active_tunnel=${pending.tunnelId || tunnelId}; Path=/; SameSite=Lax`;

        res.writeHead(msg.statusCode || 200, headers);
        res.end(bodyBuffer);
      } else if (msg.type === 'close') {
        // Explicit client disconnect
        console.log(`[-] Client requested disconnect: ${tunnelId}`);
        tunnels.delete(tunnelId);
        try { ws.close(); } catch (e) {}
      }
    } catch (err) {
      console.error('Error handling WebSocket message:', err.message);
    }
  });

  ws.on('close', () => {
    console.log(`[-] Tunnel Closed & Auto-Deleted: ${tunnelId}`);
    tunnels.delete(tunnelId);
  });

  ws.on('error', err => {
    console.error(`[!] WebSocket Error (${tunnelId}):`, err.message);
    tunnels.delete(tunnelId);
  });
});

// Auto-cleanup heartbeat every 15s (deletes dead instances immediately)
const heartbeatInterval = setInterval(() => {
  for (const [id, tunnel] of tunnels.entries()) {
    if (tunnel.isAlive === false) {
      console.log(`[!] Heartbeat timeout. Auto-deleting dead instance: ${id}`);
      try { tunnel.ws.terminate(); } catch (e) {}
      tunnels.delete(id);
      continue;
    }
    tunnel.isAlive = false;
    try {
      tunnel.ws.ping();
    } catch (e) {
      tunnels.delete(id);
    }
  }
}, 15000);

server.on('close', () => clearInterval(heartbeatInterval));

server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`  🌀 WormHole Relay Server running on port ${PORT}`);
  console.log(`  Dashboard: http://localhost:${PORT}/`);
  console.log(`====================================================`);
});


function renderCyberpunkKeypad(tunnelId) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>🔒 Security Gateway | WormHole</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; user-select: none; }
    body {
      background: #09090b;
      color: #f4f4f5;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      overflow: hidden;
    }
    .grid-bg {
      position: fixed;
      inset: 0;
      background-image: 
        linear-gradient(rgba(34, 197, 94, 0.05) 1px, transparent 1px),
        linear-gradient(90deg, rgba(34, 197, 94, 0.05) 1px, transparent 1px);
      background-size: 32px 32px;
      z-index: 0;
    }
    .card {
      position: relative;
      z-index: 10;
      background: rgba(18, 18, 20, 0.85);
      backdrop-filter: blur(16px);
      border: 1px solid rgba(39, 39, 42, 0.8);
      box-shadow: 0 0 50px rgba(34, 197, 94, 0.1), 0 25px 50px rgba(0, 0, 0, 0.8);
      border-radius: 20px;
      padding: 36px 32px;
      max-width: 380px;
      width: 100%;
      text-align: center;
      transition: transform 0.2s;
    }
    .shake {
      animation: shake 0.4s cubic-bezier(.36,.07,.19,.97) both;
    }
    @keyframes shake {
      10%, 90% { transform: translate3d(-2px, 0, 0); }
      20%, 80% { transform: translate3d(4px, 0, 0); }
      30%, 50%, 70% { transform: translate3d(-6px, 0, 0); }
      40%, 60% { transform: translate3d(6px, 0, 0); }
    }
    .icon-badge {
      width: 56px;
      height: 56px;
      margin: 0 auto 16px;
      border-radius: 50%;
      background: rgba(34, 197, 94, 0.1);
      border: 1px solid rgba(34, 197, 94, 0.3);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 24px;
      box-shadow: 0 0 20px rgba(34, 197, 94, 0.2);
    }
    h2 { font-size: 20px; font-weight: 700; letter-spacing: -0.5px; margin-bottom: 6px; }
    .tunnel-badge {
      font-size: 13px;
      color: #38bdf8;
      background: #27272a;
      padding: 4px 10px;
      border-radius: 6px;
      display: inline-block;
      margin-bottom: 24px;
      font-family: monospace;
    }
    .dots-container {
      display: flex;
      justify-content: center;
      gap: 16px;
      margin-bottom: 28px;
    }
    .dot {
      width: 16px;
      height: 16px;
      border-radius: 50%;
      border: 2px solid #3f3f46;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .dot.filled {
      background: #22c55e;
      border-color: #22c55e;
      box-shadow: 0 0 12px #22c55e;
      transform: scale(1.15);
    }
    .keypad {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
      margin-bottom: 16px;
    }
    .key {
      background: #18181b;
      border: 1px solid #27272a;
      color: #f4f4f5;
      font-size: 20px;
      font-weight: 600;
      padding: 16px 0;
      border-radius: 12px;
      cursor: pointer;
      transition: all 0.15s;
    }
    .key:hover {
      background: #27272a;
      border-color: #3f3f46;
      transform: translateY(-2px);
    }
    .key:active {
      transform: scale(0.95);
      background: rgba(34, 197, 94, 0.15);
      border-color: #22c55e;
    }
    .key-action {
      font-size: 14px;
      color: #a1a1aa;
    }
    .error-msg {
      color: #ef4444;
      font-size: 13px;
      font-weight: 500;
      min-height: 20px;
      margin-top: 10px;
    }
  </style>
</head>
<body>
  <div class="grid-bg"></div>
  <div class="card" id="card">
    <div class="icon-badge">🔒</div>
    <h2>Passcode Protected</h2>
    <div class="tunnel-badge">/${tunnelId}/</div>
    <div class="dots-container">
      <div class="dot" id="dot0"></div>
      <div class="dot" id="dot1"></div>
      <div class="dot" id="dot2"></div>
      <div class="dot" id="dot3"></div>
    </div>
    <div class="keypad">
      <button class="key" onclick="press('1')">1</button>
      <button class="key" onclick="press('2')">2</button>
      <button class="key" onclick="press('3')">3</button>
      <button class="key" onclick="press('4')">4</button>
      <button class="key" onclick="press('5')">5</button>
      <button class="key" onclick="press('6')">6</button>
      <button class="key" onclick="press('7')">7</button>
      <button class="key" onclick="press('8')">8</button>
      <button class="key" onclick="press('9')">9</button>
      <button class="key key-action" onclick="clearPin()">CLR</button>
      <button class="key" onclick="press('0')">0</button>
      <button class="key key-action" onclick="backspace()">⌫</button>
    </div>
    <div class="error-msg" id="errorMsg"></div>
  </div>
  <script>
    let currentPin = '';
    const tunnelId = '${tunnelId}';

    function updateDots() {
      for (let i = 0; i < 4; i++) {
        const dot = document.getElementById('dot' + i);
        if (i < currentPin.length) {
          dot.classList.add('filled');
        } else {
          dot.classList.remove('filled');
        }
      }
    }

    async function press(num) {
      if (currentPin.length >= 4) return;
      currentPin += num;
      updateDots();
      document.getElementById('errorMsg').innerText = '';

      if (currentPin.length === 4) {
        verifyPin();
      }
    }

    function clearPin() {
      currentPin = '';
      updateDots();
      document.getElementById('errorMsg').innerText = '';
    }

    function backspace() {
      if (currentPin.length > 0) {
        currentPin = currentPin.slice(0, -1);
        updateDots();
        document.getElementById('errorMsg').innerText = '';
      }
    }

    async function verifyPin() {
      try {
        const res = await fetch('/api/verify-pin/' + tunnelId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pin: currentPin })
        });
        const data = await res.json();
        if (data.success) {
          window.location.reload();
        } else {
          showError(data.message || 'Access Denied: Invalid Passcode');
        }
      } catch (err) {
        showError('Network Error verifying passcode');
      }
    }

    function showError(msg) {
      const card = document.getElementById('card');
      card.classList.add('shake');
      setTimeout(() => card.classList.remove('shake'), 450);
      document.getElementById('errorMsg').innerText = msg;
      currentPin = '';
      updateDots();
    }

    window.addEventListener('keydown', e => {
      if (e.key >= '0' && e.key <= '9') press(e.key);
      else if (e.key === 'Backspace') backspace();
      else if (e.key === 'Escape') clearPin();
    });
  </script>
</body>
</html>`;
}
