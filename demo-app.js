const http = require('http');

const PORT = 3000;

const server = http.createServer((req, res) => {
  if (req.url === '/api/hello') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      message: 'Hello from your private local machine via PortGhost!',
      timestamp: new Date().toISOString(),
      status: 'success',
      developer: 'MERN Prodigy',
    }));
  }

  // Serve demo web page
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>My Secret Project (Live on PortGhost)</title>
      <style>
        * { box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          background: #09090b;
          color: #f4f4f5;
          margin: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          padding: 20px;
        }
        .card {
          background: #18181b;
          border: 1px solid #27272a;
          border-radius: 16px;
          padding: 40px;
          max-width: 500px;
          width: 100%;
          text-align: center;
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.7);
        }
        .badge {
          background: #22c55e20;
          color: #4ade80;
          border: 1px solid #22c55e40;
          padding: 4px 12px;
          font-size: 13px;
          border-radius: 999px;
          display: inline-block;
          margin-bottom: 16px;
        }
        h1 { margin: 0 0 10px 0; font-size: 26px; }
        p { color: #a1a1aa; font-size: 15px; line-height: 1.6; margin-bottom: 24px; }
        .counter-box {
          background: #09090b;
          border: 1px solid #27272a;
          border-radius: 12px;
          padding: 20px;
          margin-bottom: 24px;
        }
        .count-val { font-size: 48px; font-weight: 800; color: #38bdf8; }
        .btn-group { display: flex; gap: 12px; justify-content: center; }
        button {
          background: #3b82f6;
          color: white;
          border: none;
          padding: 12px 24px;
          border-radius: 8px;
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
        }
        button:hover { background: #2563eb; transform: translateY(-2px); }
        .btn-secondary {
          background: #27272a;
          color: #f4f4f5;
        }
        .btn-secondary:hover { background: #3f3f46; }
        #apiResult {
          margin-top: 20px;
          font-family: monospace;
          font-size: 12px;
          color: #a1a1aa;
          background: #000;
          padding: 12px;
          border-radius: 8px;
          text-align: left;
          display: none;
          overflow-x: auto;
        }
      </style>
    </head>
    <body>
      <div class="card">
        <span class="badge">● Live Tunnel Active</span>
        <h1>🔥 It Works!</h1>
        <p>This page is running on <strong>localhost:3000</strong> on your friend's laptop, forwarded securely through <strong>PortGhost</strong>.</p>
        
        <div class="counter-box">
          <div class="count-val" id="counter">0</div>
          <div style="color: #71717a; font-size: 13px; margin-top: 4px;">Interactive State</div>
        </div>

        <div class="btn-group">
          <button onclick="increment()">Click Me +1</button>
          <button class="btn-secondary" onclick="fetchApi()">Call API</button>
        </div>

        <pre id="apiResult"></pre>
      </div>

      <script>
        let count = 0;
        function increment() {
          count++;
          document.getElementById('counter').innerText = count;
        }

        async function fetchApi() {
          const res = await fetch('./api/hello');
          const data = await res.json();
          const pre = document.getElementById('apiResult');
          pre.style.display = 'block';
          pre.innerText = JSON.stringify(data, null, 2);
        }
      </script>
    </body>
    </html>
  `);
});

server.listen(PORT, () => {
  console.log(`Demo app running on http://localhost:${PORT}`);
});

