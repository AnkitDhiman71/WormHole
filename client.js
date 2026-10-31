#!/usr/bin/env node
const WebSocket = require('ws');
const http = require('http');

// Parse CLI flags
const args = process.argv.slice(2);
let targetPort = 3000;
let serverUrl = process.env.WORMHOLE_SERVER || 'https://wormhole-c66l.onrender.com';
let requestedName = '';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port' || args[i] === '-p') {
    targetPort = parseInt(args[++i], 10) || 3000;
  } else if (args[i] === '--server' || args[i] === '-s') {
    serverUrl = args[++i];
  } else if (args[i] === '--name' || args[i] === '-n') {
    requestedName = args[++i];
  } else if (!isNaN(parseInt(args[i], 10))) {
    targetPort = parseInt(args[i], 10);
  }
}

// Generate a stable session slug if no name provided
const ADJECTIVES = ['swift', 'silent', 'cosmic', 'hyper', 'shadow', 'neon', 'cyber', 'quantum', 'wild', 'stealth'];
const NOUNS = ['fox', 'lynx', 'falcon', 'ghost', 'titan', 'wolf', 'viper', 'matrix', 'beacon', 'drifter'];
function generateSlug() {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const num = Math.floor(10 + Math.random() * 90);
  return `${adj}-${noun}-${num}`;
}

const sessionName = (requestedName || generateSlug()).toLowerCase().replace(/[^a-z0-9_-]/g, '');

// Convert HTTP server URL to WebSocket URL with sticky session name & port metadata
const wsServerUrl = serverUrl.replace(/^http/, 'ws') + 
  `/tunnel-connect?name=${encodeURIComponent(sessionName)}&targetPort=${targetPort}`;

// ANSI Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
};

function formatStatus(code) {
  if (code >= 200 && code < 300) return `${colors.green}${code} OK${colors.reset}`;
  if (code >= 300 && code < 400) return `${colors.cyan}${code} REDIRECT${colors.reset}`;
  if (code >= 400 && code < 500) return `${colors.yellow}${code} CLIENT ERR${colors.reset}`;
  return `${colors.red}${code} SERVER ERR${colors.reset}`;
}

console.clear();
console.log(`
${colors.cyan}${colors.bright}
  ██████╗  ██████╗ ██████╗ ████████╗ ██████╗ ██╗  ██╗ ██████╗ ███████╗████████╗
  ██╔══██╗██╔═══██╗██╔══██╗╚══██╔══╝██╔════╝ ██║  ██║██╔═══██╗██╔════╝╚══██╔══╝
  ██████╔╝██║   ██║██████╔╝   ██║   ██║  ███╗███████║██║   ██║███████╗   ██║   
  ██╔═══╝ ██║   ██║██╔══██╗   ██║   ██║   ██║██╔══██║██║   ██║╚════██║   ██║   
  ██║     ╚██████╔╝██║  ██║   ██║   ╚██████╔╝██║  ██║╚██████╔╝███████║   ██║   
  ╚═╝      ╚═════╝ ╚═╝  ╚═╝   ╚═╝    ╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ╚══════╝   ╚═╝   
${colors.reset}
  ${colors.dim}>> Establishing secure WebSocket tunnel to relay...${colors.reset}
`);

let ws;
function connect() {
  ws = new WebSocket(wsServerUrl);

  ws.on('open', () => {
    // Connected to relay
  });

  ws.on('message', data => {
    try {
      const msg = JSON.parse(data.toString());

      // 1. Welcome handshake
      if (msg.type === 'welcome') {
        const publicUrl = `${serverUrl}${msg.publicPath}`;
        console.log(`  ${colors.green}${colors.bright}✔ TUNNEL ONLINE!${colors.reset}`);
        console.log(`  -------------------------------------------------------------`);
        console.log(`  ${colors.bright}Local Target:${colors.reset}  ${colors.yellow}http://localhost:${targetPort}${colors.reset}`);
        console.log(`  ${colors.bright}Public URL:${colors.reset}    ${colors.cyan}${colors.bright}${publicUrl}${colors.reset}`);
        console.log(`  ${colors.bright}Relay Server:${colors.reset}  ${serverUrl}`);
        console.log(`  -------------------------------------------------------------`);
        console.log(`  ${colors.dim}Forwarding live requests to localhost:${targetPort}...${colors.reset}\n`);
        return;
      }

      // 2. Incoming HTTP Request to forward
      if (msg.type === 'request') {
        const startTime = Date.now();
        const { requestId, method, url: reqPath, headers, body } = msg;

        // Strip hop-by-hop headers and fix host
        const cleanHeaders = { ...headers };
        cleanHeaders['host'] = `localhost:${targetPort}`;
        delete cleanHeaders['connection'];

        function attemptRequest(targetHost) {
          const localReqOptions = {
            hostname: targetHost,
            port: targetPort,
            path: reqPath,
            method: method,
            headers: cleanHeaders,
          };

          const localReq = http.request(localReqOptions, localRes => {
            const resChunks = [];
            localRes.on('data', chunk => resChunks.push(chunk));
            localRes.on('end', () => {
              const duration = Date.now() - startTime;
              const resBody = Buffer.concat(resChunks);

              // Log activity to terminal
              const timestamp = new Date().toLocaleTimeString();
              console.log(
                `  [${colors.dim}${timestamp}${colors.reset}] ` +
                `${colors.bright}${method.padEnd(6)}${colors.reset} ` +
                `${reqPath.padEnd(25)} ` +
                `${formatStatus(localRes.statusCode)} ` +
                `${colors.dim}(${duration}ms, ${resBody.length} bytes)${colors.reset}`
              );

              // Reply back to relay
              ws.send(JSON.stringify({
                type: 'response',
                requestId,
                statusCode: localRes.statusCode,
                headers: localRes.headers,
                body: resBody.toString('base64'),
              }));
            });
          });

          localReq.on('error', err => {
            if (targetHost === 'localhost' && err.code === 'ECONNREFUSED') {
              // Try IPv4 127.0.0.1 fallback
              return attemptRequest('127.0.0.1');
            }

            const duration = Date.now() - startTime;
            console.log(
              `  [${colors.dim}${new Date().toLocaleTimeString()}${colors.reset}] ` +
              `${colors.red}${method.padEnd(6)}${colors.reset} ` +
              `${reqPath.padEnd(25)} ` +
              `${colors.red}502 Bad Gateway (${err.code || err.message})${colors.reset} ` +
              `${colors.dim}(${duration}ms)${colors.reset}`
            );

            const errorHtml = `
              <!DOCTYPE html>
              <html>
              <body style="font-family: sans-serif; background: #09090b; color: #f4f4f5; padding: 40px; text-align: center;">
                <h2 style="color: #ef4444;">👻 502 Bad Gateway: Local Server Unreachable</h2>
                <p>WormHole could not connect to <code>http://localhost:${targetPort}</code>.</p>
                <p style="color: #a1a1aa; font-size: 14px;">Error: <code>${err.message}</code></p>
                <p style="color: #71717a; font-size: 13px;">Make sure your local development server is running on port ${targetPort}!</p>
              </body>
              </html>
            `;

            ws.send(JSON.stringify({
              type: 'response',
              requestId,
              statusCode: 502,
              headers: { 'content-type': 'text/html; charset=utf-8' },
              body: Buffer.from(errorHtml).toString('base64'),
            }));
          });

          // If request has a body (e.g. POST/PUT), write it
          if (body) {
            localReq.write(Buffer.from(body, 'base64'));
          }
          localReq.end();
        }

        attemptRequest('localhost');
      }
    } catch (err) {
      console.error('Error handling message from relay:', err);
    }
  });

  ws.on('close', () => {
    console.log(`\n  ${colors.red}[!] Disconnected from relay server. Reconnecting in 3s...${colors.reset}`);
    setTimeout(connect, 3000);
  });

  ws.on('error', err => {
    // Suppress unhandled crash, close event handles reconnect
  });
}

function cleanup() {
  console.log(`\n  ${colors.yellow}Shutting down tunnel & cleaning up instance on relay...${colors.reset}`);
  if (ws && ws.readyState === 1 /* WebSocket.OPEN */) {
    try {
      ws.send(JSON.stringify({ type: 'close' }));
      ws.close();
    } catch (e) {}
  }
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

connect();

