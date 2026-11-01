# 🌀 WormHole
> **Instant, zero-config localhost tunneling & preview engine for developers.**  
> Share your local projects (`localhost:3000`, `localhost:5173`, etc.) with friends and clients anywhere in the world without deploying.

---

## ⚡ Why WormHole?

- **Zero account needed**: No tokens, no auth keys, no sign-ups.
- **No session time limits**: Keep your tunnel running as long as you want.
- **No warning intercept screens**: Direct, clean HTTP and JSON API proxying.
- **Live Terminal Telemetry**: Real-time HTTP method, path, response codes, and roundtrip latency logs in your terminal.
- **Binary & Media Safe**: Accurately streams base64-buffered images, assets, and JSON bodies.
- **SPA & Referer Smart Routing**: Works seamlessly with modern React, Vite, and Next.js SPAs.

---

## 🏗️ Architecture

```
[ Developer Laptop: localhost:3000 ]
                 │
                 ▼
     [ WormHole Client (CLI) ]
                 │  (Bidirectional WebSocket)
                 ▼
     [ WormHole Relay Server ]  ◄──── [ Remote Friend / Mobile Phone ]
```

1. **Relay Server (`server.js`)**: Runs on a public server or host. Manages incoming HTTP requests and assigns tunnels.
2. **Client CLI (`client.js`)**: Connects to the relay via WebSocket. Forwards requests directly to your local port and returns the response.
3. **Demo App (`demo-app.js`)**: A built-in test server with real-time UI & API endpoints to verify tunnels.

---

## 🚀 How to Run Locally

### 1. Start the Relay Server
```bash
npm run server
```
Relay dashboard will be live at: `http://localhost:8080/`

### 2. Start Your Local Project
*(Or run our built-in demo server)*:
```bash
npm run demo
```
Running on `http://localhost:3000`

### 3. Open the Tunnel
```bash
npm run tunnel -- --port 3000
```
Or specify a custom tunnel name:
```bash
node client.js --port 3000 --name my-project
```

Your tunnel is instantly live at:
`http://localhost:8080/t/my-project/`

---

## 📦 Instant npm Usage (Zero Installation)

Expose any local development server to the world with 1 command:
```bash
npx wormhole-tunnel 5173
```

### 📱 Instant Mobile Camera Preview (--qr)
Generate a camera-scannable ASCII QR code in your terminal:
```bash
npx wormhole-tunnel 5173 --qr
```
*(Or press `q` + Enter anytime while the tunnel is running to view the QR code!)*

### 🔒 Cyberpunk 4-Digit PIN Protection
Lock your preview behind a security keypad:
```bash
npx wormhole-tunnel 3000 --pin 1234
```

---

## 🌐 Deploying Relay to the Internet (For Worldwide Access)

To let friends on external Wi-Fi networks access your links:
1. Deploy `server.js` to any free cloud host like **Render**:
   - Web Service, Runtime: `Node`
   - Build Command: `npm install`
   - Start Command: `node server.js`
2. On your laptop, point the client to your deployed relay:
   ```bash
   node client.js --port 3000 --server https://your-wormhole.onrender.com --name my-project
   ```
3. Share the generated link `https://your-wormhole.onrender.com/t/my-project/` with anyone in the world!
