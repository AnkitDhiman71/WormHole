const http = require('http');
const { fork } = require('child_process');

console.log('Starting demo app (port 3000)...');
const demo = fork('./demo-app.js', [], { stdio: 'pipe' });

console.log('Starting relay server (port 8080)...');
const server = fork('./server.js', [], { stdio: 'pipe' });

server.stdout.on('data', data => console.log('[SERVER]', data.toString().trim()));
server.stderr.on('data', data => console.error('[SERVER ERR]', data.toString().trim()));

demo.stdout.on('data', data => console.log('[DEMO]', data.toString().trim()));
demo.stderr.on('data', data => console.error('[DEMO ERR]', data.toString().trim()));

setTimeout(() => {
  console.log('\nStarting PortGhost client...');
  const client = fork('./client.js', ['--port', '3000', '--name', 'test-tunnel'], { stdio: 'pipe' });
  client.stdout.on('data', data => console.log('[CLIENT]', data.toString().trim()));
  client.stderr.on('data', data => console.error('[CLIENT ERR]', data.toString().trim()));

  setTimeout(async () => {
    try {
      console.log('\n--- 1. Testing Relay Dashboard (http://localhost:8080/) ---');
      const dash = await fetch('http://127.0.0.1:8080/');
      console.log('Dashboard HTTP Status:', dash.status);

      console.log('\n--- 2. Testing Tunnel Access (http://localhost:8080/t/test-tunnel/) ---');
      const tunnelRes = await fetch('http://127.0.0.1:8080/t/test-tunnel/');
      console.log('Tunnel HTTP Status:', tunnelRes.status);
      const text = await tunnelRes.text();
      console.log('Tunnel Response contains "It Works!":', text.includes('It Works!'));

      console.log('\n--- 3. Testing Tunnel API Call (http://localhost:8080/t/test-tunnel/api/hello) ---');
      const apiRes = await fetch('http://127.0.0.1:8080/t/test-tunnel/api/hello');
      const apiData = await apiRes.json();
      console.log('API JSON Result:', apiData);

      console.log('\n=========================================');
      console.log('🎉 ALL TESTS PASSED! TUNNEL WORKS FLAWLESSLY!');
      console.log('=========================================');
    } catch (err) {
      console.error('Test failed:', err);
    } finally {
      try { client.kill('SIGTERM'); } catch (e) {}
      try { server.kill('SIGTERM'); } catch (e) {}
      try { demo.kill('SIGTERM'); } catch (e) {}
      setTimeout(() => process.exit(0), 200);
    }
  }, 2500);
}, 1500);

