# 👻 PortGhost
> **Instant, zero-config localhost tunneling & preview engine for developers.**  
> Share your local projects (`localhost:3000`, `localhost:5173`, etc.) with friends and clients anywhere in the world without deploying.

---

## ⚡ Why PortGhost?

- **No account needed**: No tokens, no auth keys, no sign-ups.
- **No session time limits**: Keep your tunnel running as long as you want.
- **No warning intercept screens**: Direct, clean HTTP and JSON API proxying.
- **Live Terminal Telemetry**: Real-time HTTP method, path, response codes, and roundtrip latency logs in your terminal.
- **Binary & Media Safe**: Accurately streams base64-buffered images, assets, and JSON bodies.

---

## 🏗️ Architecture

```
[ Developer Laptop: localhost:3000 ]
                 │
                 ▼
     [ PortGhost Client (CLI) ]
                 │  (Bidirectional WebSocket)
                 ▼
     [ PortGhost Relay Server ]  ◄──── [ Remote Friend / Mobile Phone ]
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

## 🌐 Deploying Relay to the Internet (For Worldwide Access)

To let friends on external Wi-Fi networks access your links:
1. Deploy `server.js` to any free cloud host:
   - **Render** (Web Service, `npm run server`)
   - **Railway** / **Fly.io** / **VPS**
2. On your laptop, point the client to your deployed relay:
   ```bash
   node client.js --port 3000 --server https://your-relay.onrender.com
   ```
3. Share the generated link `https://your-relay.onrender.com/t/<tunnel-id>/` with anyone in the world!

