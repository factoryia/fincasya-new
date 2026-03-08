const https = require('https');

const baseUrl = 'https://adventurous-octopus-651.convex.site/api/auth';
const endpoints = [
  { path: '/session', method: 'GET' },
  { path: '/session', method: 'POST' },
  { path: '/refresh-session', method: 'POST' },
  { path: '/get-session', method: 'GET' },
  { path: '/session-refresh', method: 'POST' },
  { path: '/callback/email', method: 'GET' } // just to check if /api/auth/* works
];

async function check(ep) {
  return new Promise((resolve) => {
    const fullUrl = baseUrl + ep.path;
    console.log(`Checking ${ep.method} ${fullUrl}...`);
    const req = https.request(fullUrl, { method: ep.method }, (res) => {
      console.log(`  -> ${res.statusCode} ${res.statusMessage}`);
      resolve();
    });
    req.on('error', (e) => {
      console.log(`  -> Error: ${e.message}`);
      resolve();
    });
    req.end();
  });
}

async function run() {
  for (const ep of endpoints) {
    await check(ep);
  }
}

run();
