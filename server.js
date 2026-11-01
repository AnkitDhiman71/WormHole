const http = require('http');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin_Ankit@1320';
const startTime = Date.now();
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
  const isAdmin = req.headers.cookie && req.headers.cookie.includes('wormhole_admin_session=authorized');

  // 1. API Endpoint: Admin Login
  if (parsedUrl.pathname === '/api/admin-login' && req.method === 'POST') {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try {
        const { password } = JSON.parse(Buffer.concat(chunks).toString() || '{}');
        if (password === ADMIN_PASSWORD) {
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Set-Cookie': `wormhole_admin_session=authorized; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`,
          });
          return res.end(JSON.stringify({ success: true, redirect: '/admin' }));
        } else {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, message: 'Access Denied: Invalid Master Password' }));
        }
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, message: 'Invalid payload' }));
      }
    });
    return;
  }

  // 1.1 API Endpoint: Admin Logout
  if (parsedUrl.pathname === '/api/admin-logout') {
    res.writeHead(302, {
      'Set-Cookie': 'wormhole_admin_session=; Path=/; Max-Age=0',
      'Location': '/',
    });
    return res.end();
  }

  // 1.2 API Endpoint: Terminate / Delete an Instance (Admin Only!)
  if (parsedUrl.pathname.startsWith('/api/terminate/')) {
    if (!isAdmin) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      return res.end('403 Forbidden: Only Master Admin can terminate tunnel instances.');
    }

    const toDeleteId = parsedUrl.pathname.replace('/api/terminate/', '').trim();
    if (tunnels.has(toDeleteId)) {
      const t = tunnels.get(toDeleteId);
      try { t.ws.close(); } catch (e) {}
      tunnels.delete(toDeleteId);
      console.log(`[!] Instance forcefully terminated by Admin: ${toDeleteId}`);
    }
    // Redirect back to admin deck
    res.writeHead(302, { Location: '/admin' });
    return res.end();
  }

  // 1.3 API Endpoint: Swarm Broadcaster (Superpower 1)
  if (parsedUrl.pathname === '/api/admin/broadcast' && req.method === 'POST') {
    if (!isAdmin) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, message: '403 Forbidden: Only Master Admin can broadcast.' }));
    }

    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try {
        const { message, target } = JSON.parse(Buffer.concat(chunks).toString() || '{}');
        if (!message || !message.trim()) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, message: 'Broadcast message cannot be empty' }));
        }

        const alertPacket = {
          type: 'broadcast',
          message: message.trim(),
          sender: 'Master Admin (Ankit)',
          timestamp: new Date().toLocaleTimeString(),
        };

        let dispatched = 0;
        if (!target || target === 'all') {
          for (const [id, t] of tunnels.entries()) {
            if (t.ws && t.ws.readyState === 1) {
              try {
                t.ws.send(JSON.stringify(alertPacket));
                dispatched++;
              } catch (e) {}
            }
          }
        } else if (tunnels.has(target)) {
          const t = tunnels.get(target);
          if (t.ws && t.ws.readyState === 1) {
            try {
              t.ws.send(JSON.stringify(alertPacket));
              dispatched++;
            } catch (e) {}
          }
        }

        console.log(`[📢] Broadcast dispatched by Master Admin to ${dispatched} tunnel(s): "${message.trim()}"`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, count: dispatched, timestamp: alertPacket.timestamp }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, message: 'Invalid payload' }));
      }
    });
    return;
  }

  // 1.4 API Endpoint: DEFCON 1 Nuclear Kill Switch (Superpower 4)
  if (parsedUrl.pathname === '/api/admin/nuke') {
    if (!isAdmin) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, message: '403 Forbidden: Only Master Admin can trigger DEFCON 1.' }));
    }

    let nukedCount = 0;
    const nukePacket = {
      type: 'nuke',
      message: 'DEFCON 1 NUCLEAR RESET: All tunnels terminated worldwide by Master Admin (Ankit).',
      timestamp: new Date().toLocaleTimeString(),
    };

    for (const [id, t] of tunnels.entries()) {
      nukedCount++;
      try {
        if (t.ws && t.ws.readyState === 1) {
          t.ws.send(JSON.stringify(nukePacket));
        }
      } catch (e) {}
      try {
        t.ws.terminate();
      } catch (e) {}
    }

    tunnels.clear();

    // Cancel all pending requests
    for (const [reqId, pending] of pendingRequests.entries()) {
      clearTimeout(pending.timeout);
      if (pending.res && !pending.res.headersSent) {
        try {
          pending.res.writeHead(503, { 'Content-Type': 'text/plain' });
          pending.res.end('WormHole: 503 Service Unavailable (DEFCON 1 Nuclear Reset by Admin)');
        } catch (e) {}
      }
    }
    pendingRequests.clear();

    console.log(`[☢️] DEFCON 1 TRIGGERED: All ${nukedCount} tunnels wiped clean by Master Admin!`);

    if (req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, count: nukedCount }));
    } else {
      res.writeHead(302, { Location: '/admin' });
      return res.end();
    }
  }

  // 1.45 API Endpoint: Live Traffic Stream Inspector (Superpower 2)
  if (parsedUrl.pathname === '/api/admin/traffic') {
    if (!isAdmin) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, message: '403 Forbidden: Admin Only' }));
    }

    const targetId = parsedUrl.searchParams.get('tunnelId');
    if (targetId && tunnels.has(targetId)) {
      const t = tunnels.get(targetId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        success: true,
        tunnelId: targetId,
        stats: t.stats,
        targetPort: t.targetPort,
        pin: t.pin,
        logs: t.logs || []
      }));
    }

    // Return list of all active tunnels with their latest 5 logs
    const allLogs = [];
    for (const [id, t] of tunnels.entries()) {
      if (t.logs) {
        allLogs.push(...t.logs.map(l => ({ ...l, tunnelId: id })));
      }
    }
    allLogs.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true, logs: allLogs.slice(0, 50) }));
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

  // 1.6 API Endpoint: Receive Visual Sticky Note Feedback
  if (parsedUrl.pathname.startsWith('/api/feedback/')) {
    const targetTunnelId = parsedUrl.pathname.replace('/api/feedback/', '').trim();
    const tunnel = tunnels.get(targetTunnelId);

    if (!tunnel || tunnel.ws.readyState !== 1) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, message: 'Tunnel client offline' }));
    }

    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try {
        const payload = JSON.parse(Buffer.concat(chunks).toString() || '{}');
        tunnel.ws.send(JSON.stringify({
          type: 'feedback',
          data: payload,
        }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, message: 'Feedback delivered to developer!' }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, message: 'Invalid payload' }));
      }
    });
    return;
  }

  // 2. Private Master Admin Command Deck (/admin)
  if (parsedUrl.pathname === '/admin' || parsedUrl.pathname === '/admin/') {
    if (!isAdmin) {
      // Show Cyberpunk Admin Login Page
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(renderAdminLoginPage());
    }

    // Show Master Admin Command Deck
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    let totalRequests = 0;
    let totalBytes = 0;
    for (const t of tunnels.values()) {
      totalRequests += t.stats.requests;
      totalBytes += t.stats.bytes;
    }

    const activeList = Array.from(tunnels.entries()).map(([id, t]) => {
      const liveUrl = `/t/${id}/`;
      return `
        <li style="margin: 12px 0; padding: 18px; background: #18181b; border: 1px solid #27272a; border-radius: 12px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
          <div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <strong style="color: #22c55e; font-size: 16px;">${id}</strong>
              ${t.targetPort ? `<span style="background: #27272a; color: #38bdf8; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-family: monospace;">&rarr; localhost:${t.targetPort}</span>` : ''}
              ${t.pin ? `<span style="background: #eab30820; color: #facc15; border: 1px solid #eab30840; padding: 2px 8px; border-radius: 4px; font-size: 11px;">🔒 PIN: ${t.pin}</span>` : `<span style="background: #27272a; color: #a1a1aa; padding: 2px 8px; border-radius: 4px; font-size: 11px;">🔓 Public</span>`}
            </div>
            <div style="color: #a1a1aa; font-size: 13px; margin-top: 6px;">
              Active since ${new Date(t.createdAt).toLocaleTimeString()} &bull; 
              <span style="color: #f4f4f5; font-weight: 500;">${t.stats.requests} requests</span> &bull; 
              ${(t.stats.bytes / 1024).toFixed(1)} KB transferred
            </div>
          </div>
          <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
            <button onclick="openMirrorModal('${id}')" style="background: #8b5cf620; color: #a78bfa; border: 1px solid #8b5cf650; padding: 7px 11px; border-radius: 6px; font-weight: 600; font-size: 12px; cursor: pointer;">🪞 Mirror (SP7)</button>
            <button onclick="openTrafficModal('${id}')" style="background: #10b98120; color: #34d399; border: 1px solid #10b98150; padding: 7px 11px; border-radius: 6px; font-weight: 600; font-size: 12px; cursor: pointer;">📊 Inspect (SP2)</button>
            <button onclick="targetBroadcast('${id}')" style="background: #0284c720; color: #38bdf8; border: 1px solid #0284c750; padding: 7px 11px; border-radius: 6px; font-weight: 600; font-size: 12px; cursor: pointer;">📢 Alert (SP1)</button>
            <a href="${liveUrl}" target="_blank" style="background: #3b82f6; color: white; text-decoration: none; padding: 7px 13px; border-radius: 6px; font-weight: 600; font-size: 12px;">Open &rarr;</a>
            <a href="/api/terminate/${id}" style="background: #ef444420; color: #ef4444; border: 1px solid #ef444450; text-decoration: none; padding: 7px 11px; border-radius: 6px; font-weight: 600; font-size: 12px;" onclick="return confirm('Force terminate tunnel ${id}?')">✕ Kill</a>
          </div>
        </li>
      `;
    }).join('') || '<p style="color: #71717a; font-style: italic; text-align: center; padding: 30px 0;">No active tunnel swarms running right now.</p>';

    const uptimeHrs = ((Date.now() - startTime) / (1000 * 60 * 60)).toFixed(1);

    const tunnelOptions = Array.from(tunnels.keys())
      .map(id => `<option value="${id}">🎯 Tunnel: ${id}</option>`)
      .join('');

    return res.end(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>WormHole | Master Admin Command Deck</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #09090b; color: #f4f4f5; margin: 0; padding: 40px 20px; }
          .container { max-width: 860px; margin: 0 auto; }
          .top-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid #27272a; flex-wrap: wrap; gap: 12px; }
          .admin-badge { background: #ef444420; color: #f87171; border: 1px solid #ef444440; padding: 3px 10px; font-size: 12px; border-radius: 999px; font-weight: bold; }
          .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 24px; }
          .metric-card { background: #121214; border: 1px solid #27272a; border-radius: 12px; padding: 18px; }
          .metric-val { font-size: 26px; font-weight: 800; color: #22c55e; margin-top: 4px; }
          .metric-lbl { font-size: 12px; color: #71717a; text-transform: uppercase; font-weight: 600; letter-spacing: 0.5px; }
          .card { background: #121214; border: 1px solid #27272a; border-radius: 12px; padding: 24px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
          ul { list-style: none; padding: 0; margin: 0; }
          .btn-logout { background: #27272a; color: #f4f4f5; text-decoration: none; padding: 7px 14px; border-radius: 6px; font-size: 13px; font-weight: 500; }
          .btn-logout:hover { background: #3f3f46; }
          .btn-nuke { background: #dc2626; color: white; border: 1px solid #ef4444; padding: 7px 16px; border-radius: 6px; font-size: 13px; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 6px; box-shadow: 0 0 14px rgba(220, 38, 38, 0.45); transition: all 0.2s; }
          .btn-nuke:hover { background: #b91c1c; box-shadow: 0 0 20px rgba(220, 38, 38, 0.7); }
          .preset-pill { background: #18181b; border: 1px solid #27272a; color: #a1a1aa; padding: 5px 10px; border-radius: 6px; font-size: 12px; cursor: pointer; transition: all 0.2s; }
          .preset-pill:hover { background: #27272a; color: #f4f4f5; border-color: #3f3f46; }
          .toast { position: fixed; bottom: 24px; right: 24px; padding: 14px 20px; border-radius: 8px; font-size: 14px; font-weight: 500; z-index: 3000; box-shadow: 0 10px 30px rgba(0,0,0,0.8); display: none; }
          .modal-overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.85); backdrop-filter: blur(8px); z-index: 2000; display: none; align-items: center; justify-content: center; padding: 20px; }
          .modal-content { background: #121214; border: 1px solid #27272a; border-radius: 16px; width: 100%; max-width: 1050px; max-height: 92vh; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 25px 60px rgba(0,0,0,0.9); }
          .modal-header { padding: 14px 20px; border-bottom: 1px solid #27272a; display: flex; justify-content: space-between; align-items: center; background: #18181b; flex-wrap: wrap; gap: 10px; }
          .modal-body { padding: 20px; overflow-y: auto; flex: 1; background: #0c0c0e; }
          .device-btn { background: #27272a; color: #a1a1aa; border: 1px solid #3f3f46; padding: 6px 12px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.2s; }
          .device-btn.active { background: #8b5cf6; color: white; border-color: #8b5cf6; }
          .phone-frame { width: 390px; height: 680px; margin: 0 auto; border: 10px solid #27272a; border-radius: 40px; overflow: hidden; position: relative; box-shadow: 0 10px 40px rgba(0,0,0,0.7); background: #000; transition: all 0.3s; }
          .desktop-frame { width: 100%; height: 680px; border: 1px solid #27272a; border-radius: 10px; overflow: hidden; background: #000; transition: all 0.3s; }
          .traffic-table { width: 100%; border-collapse: collapse; font-family: monospace; font-size: 13px; }
          .traffic-table th { text-align: left; padding: 10px 12px; background: #18181b; color: #71717a; border-bottom: 1px solid #27272a; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
          .traffic-table td { padding: 10px 12px; border-bottom: 1px solid #222225; }
          .traffic-table tr:hover td { background: #18181b80; }
          .badge-method { padding: 2px 7px; border-radius: 4px; font-weight: bold; font-size: 11px; }
          .method-GET { background: #10b98120; color: #34d399; border: 1px solid #10b98140; }
          .method-POST { background: #3b82f620; color: #60a5fa; border: 1px solid #3b82f640; }
          .method-PUT { background: #f59e0b20; color: #fbbf24; border: 1px solid #f59e0b40; }
          .method-DELETE { background: #ef444420; color: #f87171; border: 1px solid #ef444440; }
          .badge-status { padding: 2px 7px; border-radius: 4px; font-weight: bold; font-size: 11px; }
          .status-2xx { background: #10b98120; color: #34d399; }
          .status-3xx { background: #38bdf820; color: #38bdf8; }
          .status-4xx { background: #f59e0b20; color: #fbbf24; }
          .status-5xx { background: #ef444420; color: #f87171; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="top-bar">
            <div style="display: flex; align-items: center; gap: 12px;">
              <h2 style="margin: 0; font-size: 22px;">🌀 WormHole Command Deck</h2>
              <span class="admin-badge">Admin: Ankit</span>
            </div>
            <div style="display: flex; gap: 10px; align-items: center;">
              <button onclick="triggerNuclearNuke()" class="btn-nuke">☢️ DEFCON 1: Kill All</button>
              <a href="/" class="btn-logout">&larr; Public Home</a>
              <a href="/api/admin-logout" class="btn-logout" style="color: #ef4444;">Logout</a>
            </div>
          </div>

          <div class="grid">
            <div class="metric-card">
              <div class="metric-lbl">Active Tunnels</div>
              <div class="metric-val">${tunnels.size}</div>
            </div>
            <div class="metric-card">
              <div class="metric-lbl">Total Requests</div>
              <div class="metric-val" style="color: #38bdf8;">${totalRequests}</div>
            </div>
            <div class="metric-card">
              <div class="metric-lbl">Bandwidth Streamed</div>
              <div class="metric-val" style="color: #a855f7;">${(totalBytes / 1024).toFixed(1)} <span style="font-size: 14px;">KB</span></div>
            </div>
            <div class="metric-card">
              <div class="metric-lbl">Relay Uptime</div>
              <div class="metric-val" style="color: #f59e0b;">${uptimeHrs} <span style="font-size: 14px;">hrs</span></div>
            </div>
          </div>

          <!-- Superpower 1: Swarm Broadcaster Card -->
          <div class="card" id="broadcasterCard" style="margin-bottom: 24px; border: 1px solid #0284c740; background: linear-gradient(180deg, #0c1929 0%, #121214 100%);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 8px;">
              <div style="display: flex; align-items: center; gap: 10px;">
                <h3 style="margin: 0; font-size: 18px; color: #38bdf8;">📢 Swarm Broadcaster</h3>
                <span style="background: #38bdf820; color: #38bdf8; border: 1px solid #38bdf840; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 700;">Superpower 1</span>
              </div>
              <span style="font-size: 12px; color: #71717a;">Pushes instant audio alert to developer terminals</span>
            </div>

            <div style="display: flex; flex-direction: column; gap: 12px;">
              <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                <select id="broadcastTarget" style="background: #18181b; border: 1px solid #27272a; color: #f4f4f5; padding: 9px 12px; border-radius: 6px; font-size: 13px; outline: none; flex: 1; min-width: 220px;">
                  <option value="all">🌐 Broadcast to ALL Active Tunnels (${tunnels.size})</option>
                  ${tunnelOptions}
                </select>
                <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                  <button type="button" onclick="setBroadcastPreset('⚡ Relay maintenance scheduled in 5 minutes. Please save work.')" class="preset-pill">⚡ Maint 5m</button>
                  <button type="button" onclick="setBroadcastPreset('🔥 High performance update deployed to WormHole relay!')" class="preset-pill">🔥 Relay Updated</button>
                  <button type="button" onclick="setBroadcastPreset('⚠️ High bandwidth usage detected on this tunnel.')" class="preset-pill">⚠️ High Traffic</button>
                  <button type="button" onclick="setBroadcastPreset('💬 Hello developer! Testing direct admin communication.')" class="preset-pill">💬 Hello Dev</button>
                </div>
              </div>

              <div style="display: flex; gap: 10px;">
                <input id="broadcastMsg" type="text" placeholder="Type announcement to broadcast live into client terminals..." style="flex: 1; background: #09090b; border: 1px solid #27272a; color: #f4f4f5; padding: 12px 14px; border-radius: 8px; font-size: 14px; outline: none;" onkeydown="if(event.key==='Enter') dispatchBroadcast()" />
                <button id="btnDispatch" onclick="dispatchBroadcast()" style="background: #0284c7; color: white; border: none; padding: 12px 22px; border-radius: 8px; font-weight: 700; font-size: 14px; cursor: pointer; white-space: nowrap; transition: background 0.2s;">
                  🚀 Dispatch Alert
                </button>
              </div>
            </div>
          </div>

          <!-- Active Tunnel Swarm Card -->
          <div class="card">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 8px;">
              <div style="display: flex; align-items: center; gap: 10px;">
                <h3 style="margin: 0;">🌐 Active Tunnel Swarm (${tunnels.size})</h3>
                <span style="font-size: 12px; color: #71717a;">Protected by Master Kill Switch</span>
              </div>
              ${tunnels.size > 0 ? `
                <button onclick="triggerNuclearNuke()" style="background: #ef444415; color: #f87171; border: 1px solid #ef444440; padding: 5px 12px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer;">
                  ☢️ DEFCON 1 Nuclear Strike (${tunnels.size} active)
                </button>
              ` : ''}
            </div>
            <ul>${activeList}</ul>
          </div>
        </div>

        <div id="toastBox" class="toast"></div>

        <!-- Superpower 7: Shadow Preview Deck Modal -->
        <div id="mirrorModal" class="modal-overlay">
          <div class="modal-content">
            <div class="modal-header">
              <div style="display: flex; align-items: center; gap: 10px;">
                <h3 style="margin: 0; font-size: 16px; color: #a78bfa;">🪞 Shadow Preview Deck</h3>
                <span id="mirrorTunnelBadge" style="background: #8b5cf620; color: #a78bfa; border: 1px solid #8b5cf640; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 700;"></span>
              </div>
              <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                <button type="button" id="btnPhone" onclick="setDeviceMode('phone')" class="device-btn active">📱 Mobile</button>
                <button type="button" id="btnDesktop" onclick="setDeviceMode('desktop')" class="device-btn">💻 Desktop</button>
                <button type="button" onclick="refreshMirrorFrame()" class="preset-pill" style="padding: 6px 10px;">🔄 Refresh</button>
                <a id="mirrorExternalLink" href="#" target="_blank" class="preset-pill" style="padding: 6px 10px; text-decoration: none;">🔗 New Tab</a>
                <button type="button" onclick="closeMirrorModal()" style="background: #ef444420; color: #f87171; border: 1px solid #ef444440; padding: 6px 10px; border-radius: 6px; cursor: pointer;">✕ Close</button>
              </div>
            </div>
            <div class="modal-body" style="display: flex; justify-content: center; align-items: center; min-height: 400px;">
              <div id="mirrorFrameContainer" class="phone-frame">
                <iframe id="mirrorIframe" style="width: 100%; height: 100%; border: none; background: white;" src="about:blank"></iframe>
              </div>
            </div>
          </div>
        </div>

        <!-- Superpower 2: Live Traffic Matrix & Stream Inspector Modal -->
        <div id="trafficModal" class="modal-overlay">
          <div class="modal-content">
            <div class="modal-header">
              <div style="display: flex; align-items: center; gap: 10px;">
                <h3 style="margin: 0; font-size: 16px; color: #34d399;">📊 Live Traffic Matrix & Stream Inspector</h3>
                <span id="trafficTunnelBadge" style="background: #10b98120; color: #34d399; border: 1px solid #10b98140; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 700;"></span>
                <span style="background: #22c55e20; color: #4ade80; border: 1px solid #22c55e40; padding: 2px 8px; border-radius: 999px; font-size: 10px; font-weight: 700;">● STREAMING LIVE</span>
              </div>
              <div style="display: flex; gap: 8px; align-items: center;">
                <button type="button" onclick="fetchTrafficData()" class="preset-pill" style="padding: 6px 10px;">⚡ Pull Now</button>
                <button type="button" onclick="closeTrafficModal()" style="background: #ef444420; color: #f87171; border: 1px solid #ef444440; padding: 6px 10px; border-radius: 6px; cursor: pointer;">✕ Close</button>
              </div>
            </div>
            <div class="modal-body">
              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: 16px;">
                <div style="background: #18181b; border: 1px solid #27272a; padding: 12px; border-radius: 8px;">
                  <div style="font-size: 11px; color: #71717a; text-transform: uppercase;">Requests</div>
                  <div id="trafficTotalReq" style="font-size: 20px; font-weight: 700; color: #38bdf8;">0</div>
                </div>
                <div style="background: #18181b; border: 1px solid #27272a; padding: 12px; border-radius: 8px;">
                  <div style="font-size: 11px; color: #71717a; text-transform: uppercase;">Transferred</div>
                  <div id="trafficTotalBytes" style="font-size: 20px; font-weight: 700; color: #a855f7;">0 KB</div>
                </div>
                <div style="background: #18181b; border: 1px solid #27272a; padding: 12px; border-radius: 8px;">
                  <div style="font-size: 11px; color: #71717a; text-transform: uppercase;">Avg Latency</div>
                  <div id="trafficAvgLatency" style="font-size: 20px; font-weight: 700; color: #22c55e;">0 ms</div>
                </div>
              </div>

              <div style="background: #18181b; border: 1px solid #27272a; border-radius: 10px; overflow: hidden;">
                <table class="traffic-table">
                  <thead>
                    <tr>
                      <th style="width: 100px;">Time</th>
                      <th style="width: 80px;">Method</th>
                      <th>Path</th>
                      <th style="width: 90px;">Status</th>
                      <th style="width: 90px;">Latency</th>
                      <th style="width: 90px;">Size</th>
                    </tr>
                  </thead>
                  <tbody id="trafficTableBody">
                    <tr>
                      <td colspan="6" style="text-align: center; color: #71717a; padding: 30px;">
                        Listening for packets... Open the tunnel in your browser to see requests stream live here.
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        <script>
          function showToast(text, isError = false) {
            const toast = document.getElementById('toastBox');
            toast.textContent = text;
            toast.style.background = isError ? '#ef4444' : '#22c55e';
            toast.style.color = '#fff';
            toast.style.display = 'block';
            setTimeout(() => { toast.style.display = 'none'; }, 4000);
          }

          function setBroadcastPreset(msg) {
            const input = document.getElementById('broadcastMsg');
            input.value = msg;
            input.focus();
          }

          function targetBroadcast(id) {
            const targetSelect = document.getElementById('broadcastTarget');
            targetSelect.value = id;
            const card = document.getElementById('broadcasterCard');
            card.scrollIntoView({ behavior: 'smooth' });
            document.getElementById('broadcastMsg').focus();
          }

          async function dispatchBroadcast() {
            const msgInput = document.getElementById('broadcastMsg');
            const targetSelect = document.getElementById('broadcastTarget');
            const btn = document.getElementById('btnDispatch');

            const message = msgInput.value.trim();
            const target = targetSelect.value;

            if (!message) {
              showToast('Please type a broadcast message first!', true);
              msgInput.focus();
              return;
            }

            btn.disabled = true;
            btn.textContent = 'Dispatching...';

            try {
              const res = await fetch('/api/admin/broadcast', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message, target })
              });
              const data = await res.json();
              if (data.success) {
                showToast('📢 Dispatched to ' + data.count + ' active tunnel terminal(s)!');
                msgInput.value = '';
              } else {
                showToast(data.message || 'Error sending broadcast', true);
              }
            } catch (e) {
              showToast('Network error while dispatching broadcast', true);
            } finally {
              btn.disabled = false;
              btn.textContent = '🚀 Dispatch Alert';
            }
          }

          async function triggerNuclearNuke() {
            const confirmed = confirm(
              '☢️ DEFCON 1 NUCLEAR STRIKE CONFIRMATION\\n\\n' +
              'Are you sure you want to FORCEFULLY TERMINATE and SEVER ALL active tunnels worldwide?\\n\\n' +
              'Every connected client terminal will be permanently disconnected.\\n\\n' +
              'Click OK to initiate full reset.'
            );

            if (!confirmed) return;

            try {
              const res = await fetch('/api/admin/nuke', { method: 'POST' });
              const data = await res.json();
              if (data.success) {
                showToast('☢️ DEFCON 1 EXECUTED: Terminated ' + data.count + ' tunnel(s)!');
                setTimeout(() => { window.location.reload(); }, 1200);
              } else {
                showToast(data.message || 'Error triggering DEFCON 1', true);
              }
            } catch (e) {
              showToast('DEFCON 1 network error', true);
            }
          }

          // Superpower 7: Mirror Deck
          let currentMirrorId = null;
          function openMirrorModal(id) {
            currentMirrorId = id;
            document.getElementById('mirrorTunnelBadge').textContent = id;
            document.getElementById('mirrorExternalLink').href = '/t/' + id + '/';
            document.getElementById('mirrorIframe').src = '/t/' + id + '/';
            setDeviceMode('phone');
            document.getElementById('mirrorModal').style.display = 'flex';
          }

          function closeMirrorModal() {
            document.getElementById('mirrorModal').style.display = 'none';
            document.getElementById('mirrorIframe').src = 'about:blank';
            currentMirrorId = null;
          }

          function setDeviceMode(mode) {
            const container = document.getElementById('mirrorFrameContainer');
            const btnPhone = document.getElementById('btnPhone');
            const btnDesktop = document.getElementById('btnDesktop');

            if (mode === 'phone') {
              container.className = 'phone-frame';
              btnPhone.classList.add('active');
              btnDesktop.classList.remove('active');
            } else {
              container.className = 'desktop-frame';
              btnDesktop.classList.add('active');
              btnPhone.classList.remove('active');
            }
          }

          function refreshMirrorFrame() {
            if (currentMirrorId) {
              document.getElementById('mirrorIframe').src = '/t/' + currentMirrorId + '/';
            }
          }

          // Superpower 2: Traffic Matrix Inspector
          let currentTrafficId = null;
          let trafficPollTimer = null;

          function openTrafficModal(id) {
            currentTrafficId = id;
            document.getElementById('trafficTunnelBadge').textContent = id;
            document.getElementById('trafficModal').style.display = 'flex';
            fetchTrafficData();
            if (trafficPollTimer) clearInterval(trafficPollTimer);
            trafficPollTimer = setInterval(fetchTrafficData, 1500);
          }

          function closeTrafficModal() {
            if (trafficPollTimer) clearInterval(trafficPollTimer);
            document.getElementById('trafficModal').style.display = 'none';
            currentTrafficId = null;
          }

          async function fetchTrafficData() {
            if (!currentTrafficId) return;
            try {
              const res = await fetch('/api/admin/traffic?tunnelId=' + encodeURIComponent(currentTrafficId));
              const data = await res.json();
              if (data.success) {
                renderTrafficLogs(data.logs || [], data.stats || {});
              }
            } catch (e) {}
          }

          function renderTrafficLogs(logs, stats) {
            document.getElementById('trafficTotalReq').textContent = stats.requests || 0;
            document.getElementById('trafficTotalBytes').textContent = ((stats.bytes || 0) / 1024).toFixed(1) + ' KB';

            let avgLat = 0;
            if (logs.length > 0) {
              const totalLat = logs.reduce((acc, l) => acc + (l.duration || 0), 0);
              avgLat = Math.round(totalLat / logs.length);
            }
            document.getElementById('trafficAvgLatency').textContent = avgLat + ' ms';

            const tbody = document.getElementById('trafficTableBody');
            if (!logs || logs.length === 0) {
              tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #71717a; padding: 30px;">Listening for packets... Open the tunnel in your browser to see requests stream live here.</td></tr>';
              return;
            }

            tbody.innerHTML = logs.map(l => {
              const methodClass = 'method-' + (l.method || 'GET');
              let statusClass = 'status-2xx';
              if (l.status >= 500) statusClass = 'status-5xx';
              else if (l.status >= 400) statusClass = 'status-4xx';
              else if (l.status >= 300) statusClass = 'status-3xx';

              return '<tr>' +
                '<td style="color: #71717a;">' + (l.timestamp || '') + '</td>' +
                '<td><span class="badge-method ' + methodClass + '">' + (l.method || 'GET') + '</span></td>' +
                '<td style="color: #f4f4f5; font-weight: 500;">' + escapeHtml(l.path || '/') + '</td>' +
                '<td><span class="badge-status ' + statusClass + '">' + (l.status || 200) + '</span></td>' +
                '<td style="color: #a1a1aa;">' + (l.duration || 0) + ' ms</td>' +
                '<td style="color: #a1a1aa;">' + ((l.bytes || 0) / 1024).toFixed(1) + ' KB</td>' +
              '</tr>';
            }).join('');
          }

          function escapeHtml(str) {
            return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
          }
        </script>
      </body>
      </html>
    `);
  }

  // 3. Public Landing Homepage (ZERO Active Tunnels Exposed!)
  if (parsedUrl.pathname === '/' || parsedUrl.pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>WormHole | Instant Localhost Tunneling</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #09090b; color: #f4f4f5; margin: 0; padding: 40px 20px; }
          .container { max-width: 740px; margin: 0 auto; }
          .nav { display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; }
          .badge { background: #22c55e20; color: #4ade80; border: 1px solid #22c55e40; padding: 3px 10px; font-size: 12px; border-radius: 999px; }
          .hero h1 { font-size: 34px; font-weight: 800; margin: 0 0 8px 0; letter-spacing: -0.5px; }
          .hero p { color: #a1a1aa; font-size: 16px; line-height: 1.6; margin-bottom: 28px; }
          .card { background: #121214; border: 1px solid #27272a; border-radius: 14px; padding: 24px; margin-bottom: 24px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
          .code-box { background: #000; padding: 14px 18px; border-radius: 8px; border: 1px solid #27272a; font-family: monospace; color: #38bdf8; font-size: 15px; margin-top: 10px; display: flex; justify-content: space-between; align-items: center; }
          .features { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-top: 24px; }
          .feat-box { background: #18181b; border: 1px solid #27272a; border-radius: 10px; padding: 16px; }
          .feat-box h4 { margin: 0 0 6px 0; font-size: 15px; color: #f4f4f5; display: flex; align-items: center; gap: 8px; }
          .feat-box p { margin: 0; color: #a1a1aa; font-size: 13px; line-height: 1.5; }
          .admin-link { color: #71717a; text-decoration: none; font-size: 13px; transition: color 0.2s; }
          .admin-link:hover { color: #f4f4f5; }
          .npm-badge { background: #cb383720; color: #ff6b6b; border: 1px solid #cb383740; padding: 4px 10px; font-size: 12px; border-radius: 6px; font-weight: 600; text-decoration: none; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="nav">
            <span class="badge">● Cloud Relay Operational</span>
            <div style="display: flex; gap: 12px; align-items: center;">
              <a href="https://www.npmjs.com/package/wormhole-tunnel" target="_blank" class="npm-badge">📦 npm v1.0.0</a>
              <a href="/admin" class="admin-link">Admin Deck 🔒</a>
            </div>
          </div>

          <div class="hero">
            <h1>🌀 WormHole</h1>
            <p>Next-gen zero-config localhost tunneling & remote preview engine. Share any local development port with friends and clients across the world in 1 second.</p>
          </div>

          <div class="card">
            <h3 style="margin-top:0; font-size: 17px;">⚡ Instant Usage (No Sign-Up Needed)</h3>
            <div style="color: #a1a1aa; font-size: 14px;">Open your terminal in any project and run:</div>
            <div class="code-box">
              <span>npx wormhole-tunnel 5173</span>
            </div>
            <div style="color: #71717a; font-size: 12px; margin-top: 8px;">Supports Vite, React, Next.js, Express, Django, Flask, or any local port.</div>
          </div>

          <div class="features">
            <div class="feat-box">
              <h4>🔒 Passcode Gate</h4>
              <p>Add <code>--pin 1234</code> to lock your tunnel behind a sleek cyberpunk 4-digit security keypad.</p>
            </div>
            <div class="feat-box">
              <h4>📌 Visual Bug Notes</h4>
              <p>Visitors can tap any element on screen to drop comments that chime live in your laptop terminal.</p>
            </div>
            <div class="feat-box">
              <h4>📋 PDF Report Export</h4>
              <p>Download professional project evaluation reports with 1-click printable PDF layouts for professors.</p>
            </div>
          </div>

          <div style="margin-top: 40px; text-align: center; color: #52525b; font-size: 13px;">
            WormHole Engine &bull; Developed by Ankit Dhiman &bull; MIT License
          </div>
        </div>
      </body>
      </html>
    `);
  }

  // 4. Identify Tunnel from Request (Subpath /t/:id/ or Subdomain)
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

    // Master Admin bypasses PIN gate automatically (Superpower 7 God-Mode Preview)
    if (!hasPinAuth && !isAdmin) {
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

    pendingRequests.set(requestId, {
      res,
      timeout,
      tunnelId,
      method: req.method,
      path: targetPath,
      startTime: Date.now()
    });

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
    logs: [],
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

          // Inject Live Visual Feedback & Sticky Notes Tool
          const feedbackSnippet = getFeedbackOverlayScript(tunnelId);
          if (html.includes('</body>')) {
            html = html.replace('</body>', `${feedbackSnippet}</body>`);
          } else {
            html += feedbackSnippet;
          }

          bodyBuffer = Buffer.from(html, 'utf-8');
        }

        // Record real-time packet log for Superpower 2 (Live Traffic Matrix)
        const duration = Date.now() - (pending.startTime || Date.now());
        tunnelData.logs = tunnelData.logs || [];
        tunnelData.logs.unshift({
          id: msg.requestId,
          method: pending.method || 'GET',
          path: pending.path || '/',
          status: msg.statusCode || 200,
          duration,
          bytes: bodyBuffer.length,
          timestamp: new Date().toLocaleTimeString(),
        });
        if (tunnelData.logs.length > 50) tunnelData.logs.pop();

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


function getFeedbackOverlayScript(tunnelId) {
  return `
<script>
(function() {
  if (window.__WORMHOLE_FEEDBACK_INSTALLED__) return;
  window.__WORMHOLE_FEEDBACK_INSTALLED__ = true;

  const tunnelId = "${tunnelId}";
  const host = document.createElement('div');
  host.id = "__wormhole_feedback_host__";
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = \`
    <style>
      * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
      .pill-container {
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 2147483647;
        display: flex;
        gap: 8px;
        align-items: center;
        user-select: none;
      }
      .pill {
        background: #18181b;
        color: #f4f4f5;
        border: 1px solid #22c55e80;
        box-shadow: 0 8px 32px rgba(0,0,0,0.5), 0 0 15px rgba(34,197,94,0.3);
        border-radius: 9999px;
        padding: 10px 16px;
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s cubic-bezier(0.4,0,0.2,1);
      }
      .pill:hover {
        transform: translateY(-2px);
        background: #27272a;
        box-shadow: 0 12px 36px rgba(0,0,0,0.6), 0 0 22px rgba(34,197,94,0.5);
      }
      .pill.active {
        background: #22c55e;
        color: #09090b;
        border-color: #22c55e;
        box-shadow: 0 0 25px rgba(34,197,94,0.8);
      }
      .pill-export {
        border-color: #38bdf880;
        box-shadow: 0 8px 32px rgba(0,0,0,0.5), 0 0 15px rgba(56,189,248,0.3);
      }
      .pill-export:hover {
        box-shadow: 0 12px 36px rgba(0,0,0,0.6), 0 0 22px rgba(56,189,248,0.5);
      }
      .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #22c55e;
      }
      .pill.active .dot {
        background: #09090b;
        animation: pulse 1s infinite;
      }
      @keyframes pulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.5; transform: scale(1.4); }
      }
      .count-badge {
        background: #22c55e20;
        color: #4ade80;
        border: 1px solid #22c55e40;
        border-radius: 999px;
        font-size: 11px;
        padding: 1px 6px;
        margin-left: 2px;
      }
      .modal {
        display: none;
        position: fixed;
        bottom: 80px;
        right: 24px;
        z-index: 2147483647;
        width: 330px;
        background: #18181b;
        border: 1px solid #27272a;
        border-radius: 14px;
        padding: 18px;
        box-shadow: 0 20px 45px rgba(0,0,0,0.7);
        color: #f4f4f5;
        animation: slideUp 0.2s ease-out;
      }
      @keyframes slideUp {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .modal h4 {
        margin: 0 0 4px 0;
        font-size: 14px;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .target-box {
        background: #09090b;
        border: 1px solid #27272a;
        border-radius: 6px;
        padding: 6px 10px;
        font-family: monospace;
        font-size: 11px;
        color: #38bdf8;
        margin-bottom: 12px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      textarea {
        width: 100%;
        height: 80px;
        background: #09090b;
        border: 1px solid #3f3f46;
        border-radius: 8px;
        color: #f4f4f5;
        padding: 10px;
        font-size: 13px;
        resize: none;
        outline: none;
        margin-bottom: 12px;
      }
      textarea:focus {
        border-color: #22c55e;
      }
      .btn-row {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
      }
      button {
        border: none;
        padding: 8px 14px;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: 0.15s;
      }
      .btn-cancel {
        background: #27272a;
        color: #a1a1aa;
      }
      .btn-send {
        background: #22c55e;
        color: #09090b;
      }
      .btn-send:hover {
        background: #16a34a;
      }
      .success-toast {
        color: #22c55e;
        font-size: 12px;
        text-align: center;
        padding: 8px 0;
        display: none;
        font-weight: 500;
      }
    </style>
    <div class="pill-container">
      <div class="pill" id="fbPill">
        <div class="dot"></div>
        <span id="pillLabel">📌 Bug Report</span>
        <span class="count-badge" id="reportCountBadge" style="display:none;">0</span>
      </div>
      <div class="pill pill-export" id="exportBtn" style="display:none;">
        <span>📥 Download Report</span>
      </div>
    </div>
    <div class="modal" id="fbModal">
      <h4>📌 Report Issue / Evaluation</h4>
      <div class="target-box" id="targetInfo">Select any element</div>
      <textarea id="fbText" placeholder="Describe issue, feedback, or grading remarks..."></textarea>
      <div class="btn-row" id="btnRow">
        <button class="btn-cancel" id="btnCancel">Cancel</button>
        <button class="btn-send" id="btnSend">Send ➔</button>
      </div>
      <div class="success-toast" id="successToast">✔ Recorded & sent to developer!</div>
    </div>
  \`;

  let isInspectMode = false;
  let hoveredEl = null;
  let selectedTarget = null;

  // Stored reports in this evaluation session
  let reports = [];
  try {
    const saved = localStorage.getItem('wormhole_eval_reports_' + tunnelId);
    if (saved) reports = JSON.parse(saved);
  } catch (e) {}

  const pill = shadow.getElementById('fbPill');
  const pillLabel = shadow.getElementById('pillLabel');
  const exportBtn = shadow.getElementById('exportBtn');
  const reportCountBadge = shadow.getElementById('reportCountBadge');
  const modal = shadow.getElementById('fbModal');
  const targetInfo = shadow.getElementById('targetInfo');
  const fbText = shadow.getElementById('fbText');
  const btnCancel = shadow.getElementById('btnCancel');
  const btnSend = shadow.getElementById('btnSend');
  const btnRow = shadow.getElementById('btnRow');
  const successToast = shadow.getElementById('successToast');

  function updateExportButton() {
    if (reports.length > 0) {
      exportBtn.style.display = 'flex';
      reportCountBadge.style.display = 'inline-block';
      reportCountBadge.innerText = reports.length;
    } else {
      exportBtn.style.display = 'none';
      reportCountBadge.style.display = 'none';
    }
  }

  updateExportButton();

  const highlighter = document.createElement('div');
  highlighter.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483646;border:2px dashed #22c55e;box-shadow:0 0 12px rgba(34,197,94,0.5);border-radius:4px;display:none;transition:all 0.05s ease-out;';
  document.body.appendChild(highlighter);

  function toggleInspect() {
    isInspectMode = !isInspectMode;
    if (isInspectMode) {
      pill.classList.add('active');
      pillLabel.innerText = '🎯 Tap Any Element';
      document.body.style.cursor = 'crosshair';
      modal.style.display = 'none';
    } else {
      pill.classList.remove('active');
      pillLabel.innerText = '📌 Bug Report';
      document.body.style.cursor = '';
      highlighter.style.display = 'none';
    }
  }

  pill.addEventListener('click', toggleInspect);

  document.addEventListener('mouseover', e => {
    if (!isInspectMode) return;
    if (e.target === host || host.contains(e.target)) return;

    hoveredEl = e.target;
    const rect = hoveredEl.getBoundingClientRect();
    highlighter.style.display = 'block';
    highlighter.style.top = rect.top + 'px';
    highlighter.style.left = rect.left + 'px';
    highlighter.style.width = rect.width + 'px';
    highlighter.style.height = rect.height + 'px';
  }, true);

  document.addEventListener('click', e => {
    if (!isInspectMode) return;
    if (e.target === host || host.contains(e.target)) return;

    e.preventDefault();
    e.stopPropagation();

    const target = e.target;
    const tag = target.tagName.toLowerCase();
    const id = target.id ? '#' + target.id : '';
    const cls = target.className && typeof target.className === 'string' ? '.' + target.className.trim().split(/\\s+/).slice(0, 2).join('.') : '';
    const selector = tag + id + cls;
    const textSnippet = (target.innerText || target.value || target.alt || '').trim().slice(0, 30);

    selectedTarget = {
      selector: selector,
      tag: tag,
      text: textSnippet,
      screen: window.innerWidth + 'x' + window.innerHeight + (window.innerWidth < 768 ? ' (Mobile)' : ' (Desktop)'),
      userAgent: navigator.userAgent
    };

    targetInfo.innerText = selector + (textSnippet ? ' ("' + textSnippet + '")' : '');
    modal.style.display = 'block';
    btnRow.style.display = 'flex';
    successToast.style.display = 'none';
    fbText.value = '';
    fbText.focus();

    toggleInspect();
  }, true);

  btnCancel.addEventListener('click', () => {
    modal.style.display = 'none';
    highlighter.style.display = 'none';
  });

  btnSend.addEventListener('click', async () => {
    const comment = fbText.value.trim();
    if (!comment) return;

    btnSend.disabled = true;
    btnSend.innerText = 'Sending...';

    const reportEntry = {
      id: reports.length + 1,
      ...selectedTarget,
      comment: comment,
      timestamp: new Date().toLocaleTimeString(),
      date: new Date().toLocaleDateString()
    };

    reports.push(reportEntry);
    try {
      localStorage.setItem('wormhole_eval_reports_' + tunnelId, JSON.stringify(reports));
    } catch (e) {}

    updateExportButton();

    try {
      await fetch('/api/feedback/' + tunnelId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reportEntry)
      });

      btnRow.style.display = 'none';
      successToast.style.display = 'block';
      setTimeout(() => {
        modal.style.display = 'none';
        highlighter.style.display = 'none';
        btnSend.disabled = false;
        btnSend.innerText = 'Send ➔';
      }, 1200);
    } catch (err) {
      alert('Sent locally, but terminal ping failed: ' + err.message);
      modal.style.display = 'none';
      btnSend.disabled = false;
    }
  });

  // Export & Download Formal Evaluation Report (HTML / Printable PDF)
  exportBtn.addEventListener('click', () => {
    if (reports.length === 0) return;

    const rowsHtml = reports.map(r => \`
      <tr>
        <td style="padding: 12px; border-bottom: 1px solid #e2e8f0; font-weight: bold; color: #475569;">#\${r.id}</td>
        <td style="padding: 12px; border-bottom: 1px solid #e2e8f0; font-family: monospace; color: #0284c7; font-size: 13px;">
          \${r.selector} \${r.text ? '<div style="color: #64748b; font-size: 11px;">("' + r.text + '")</div>' : ''}
        </td>
        <td style="padding: 12px; border-bottom: 1px solid #e2e8f0; color: #1e293b; font-size: 14px; font-weight: 500;">
          \${r.comment}
        </td>
        <td style="padding: 12px; border-bottom: 1px solid #e2e8f0; color: #64748b; font-size: 12px;">\${r.screen}</td>
        <td style="padding: 12px; border-bottom: 1px solid #e2e8f0; color: #64748b; font-size: 12px;">\${r.timestamp}</td>
      </tr>
    \`).join('');

    const fullReportHtml = \`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>WormHole Project Evaluation Report - \${tunnelId}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f8fafc; color: #0f172a; margin: 0; padding: 40px 20px; }
    .container { max-width: 900px; margin: 0 auto; background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 36px; box-shadow: 0 10px 25px rgba(0,0,0,0.05); }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0f172a; padding-bottom: 20px; margin-bottom: 24px; }
    h1 { font-size: 26px; margin: 0 0 6px 0; color: #0f172a; }
    .badge { background: #22c55e20; color: #15803d; border: 1px solid #22c55e40; padding: 4px 10px; font-size: 12px; font-weight: bold; border-radius: 99px; }
    .meta-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; background: #f1f5f9; padding: 18px; border-radius: 8px; margin-bottom: 28px; font-size: 13px; }
    .meta-item strong { display: block; color: #64748b; margin-bottom: 4px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
    table { width: 100%; border-collapse: collapse; text-align: left; }
    th { background: #f8fafc; padding: 12px; border-bottom: 2px solid #cbd5e1; font-size: 12px; text-transform: uppercase; color: #475569; letter-spacing: 0.5px; }
    .btn-print { background: #0f172a; color: white; border: none; padding: 10px 20px; border-radius: 6px; font-weight: 600; cursor: pointer; font-size: 13px; transition: 0.2s; }
    .btn-print:hover { background: #334155; }
    @media print {
      body { background: white; padding: 0; }
      .container { border: none; box-shadow: none; padding: 0; }
      .btn-print { display: none; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div>
        <h1>📋 Project Evaluation & Bug Report</h1>
        <div style="color: #64748b; font-size: 14px;">Generated via <strong>WormHole Preview Engine</strong></div>
      </div>
      <button class="btn-print" onclick="window.print()">🖨️ Print / Save as PDF</button>
    </div>

    <div class="meta-grid">
      <div class="meta-item">
        <strong>Target Tunnel</strong>
        \${tunnelId}
      </div>
      <div class="meta-item">
        <strong>Total Remarks / Issues</strong>
        <span class="badge">\${reports.length} Findings</span>
      </div>
      <div class="meta-item">
        <strong>Evaluation Date</strong>
        \${new Date().toLocaleDateString()}
      </div>
      <div class="meta-item">
        <strong>Evaluator Device</strong>
        \${navigator.userAgent.slice(0, 40)}...
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Inspected Element</th>
          <th>Evaluator Remarks / Bug Description</th>
          <th>Device Viewport</th>
          <th>Time</th>
        </tr>
      </thead>
      <tbody>
        \${rowsHtml}
      </tbody>
    </table>

    <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; color: #94a3b8; font-size: 12px;">
      <span>Verified by WormHole Audit Engine</span>
      <span>Official Evaluation Document</span>
    </div>
  </div>
</body>
</html>\`;

    const blob = new Blob([fullReportHtml], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'WormHole-Evaluation-Report-' + tunnelId + '.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });
})();
</script>
  `;
}


function renderAdminLoginPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Admin Login | WormHole Master Command</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #09090b;
      color: #f4f4f5;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .grid-bg {
      position: fixed;
      inset: 0;
      background-image: 
        linear-gradient(rgba(239, 68, 68, 0.05) 1px, transparent 1px),
        linear-gradient(90deg, rgba(239, 68, 68, 0.05) 1px, transparent 1px);
      background-size: 32px 32px;
      z-index: 0;
    }
    .card {
      position: relative;
      z-index: 10;
      background: #121214;
      border: 1px solid #27272a;
      border-radius: 16px;
      padding: 36px 32px;
      max-width: 380px;
      width: 100%;
      text-align: center;
      box-shadow: 0 20px 45px rgba(0, 0, 0, 0.8);
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
    .badge {
      background: #ef444420;
      color: #f87171;
      border: 1px solid #ef444440;
      padding: 3px 10px;
      font-size: 11px;
      border-radius: 999px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      display: inline-block;
      margin-bottom: 12px;
    }
    h2 { font-size: 22px; font-weight: 800; margin-bottom: 6px; }
    p { color: #a1a1aa; font-size: 13px; line-height: 1.5; margin-bottom: 24px; }
    input {
      width: 100%;
      background: #09090b;
      border: 1px solid #3f3f46;
      border-radius: 8px;
      color: #f4f4f5;
      padding: 12px 14px;
      font-size: 15px;
      outline: none;
      margin-bottom: 14px;
      transition: border-color 0.2s;
    }
    input:focus { border-color: #ef4444; }
    button {
      width: 100%;
      background: #ef4444;
      color: white;
      border: none;
      padding: 12px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      transition: background 0.2s;
    }
    button:hover { background: #dc2626; }
    .err-box {
      color: #ef4444;
      font-size: 13px;
      margin-top: 12px;
      min-height: 18px;
      font-weight: 500;
    }
    .home-link {
      display: inline-block;
      margin-top: 20px;
      color: #71717a;
      text-decoration: none;
      font-size: 12px;
    }
    .home-link:hover { color: #f4f4f5; }
  </style>
</head>
<body>
  <div class="grid-bg"></div>
  <div class="card" id="loginCard">
    <span class="badge">Master Command</span>
    <h2>Admin Authentication</h2>
    <p>Enter your secret master password to access the WormHole control deck.</p>
    <form id="adminForm">
      <input type="password" id="adminPass" placeholder="Enter master password..." autocomplete="current-password" autofocus required />
      <button type="submit" id="btnSubmit">Unlock Command Deck &rarr;</button>
    </form>
    <div class="err-box" id="errBox"></div>
    <a href="/" class="home-link">&larr; Return to Public Home</a>
  </div>

  <script>
    document.getElementById('adminForm').addEventListener('submit', async e => {
      e.preventDefault();
      const pass = document.getElementById('adminPass').value;
      const btn = document.getElementById('btnSubmit');
      const errBox = document.getElementById('errBox');
      const card = document.getElementById('loginCard');

      btn.disabled = true;
      btn.innerText = 'Verifying...';
      errBox.innerText = '';

      try {
        const res = await fetch('/api/admin-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pass })
        });
        const data = await res.json();
        if (data.success) {
          window.location.href = data.redirect || '/admin';
        } else {
          card.classList.add('shake');
          setTimeout(() => card.classList.remove('shake'), 450);
          errBox.innerText = data.message || 'Invalid Master Password';
          btn.disabled = false;
          btn.innerText = 'Unlock Command Deck →';
        }
      } catch (err) {
        errBox.innerText = 'Network error connecting to auth server';
        btn.disabled = false;
        btn.innerText = 'Unlock Command Deck →';
      }
    });
  </script>
</body>
</html>`;
}
