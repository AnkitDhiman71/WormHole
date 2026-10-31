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
