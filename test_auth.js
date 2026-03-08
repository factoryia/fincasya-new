const https = require('https');

const baseUrl = 'https://adventurous-octopus-651.convex.site/api/auth';
const endpoints = [
  { path: '/session', method: 'GET' },
  { path: '/session', method: 'POST' },
  { path: '/refresh-session', method: 'POST' },
  { path: '/get-session', method: 'GET' },
  { path: '/session-refresh', method: 'POST' }
];

async function test() {
  for (const ep of endpoints) {
    console.log(`Testing ${ep.method} ${baseUrl}${ep.path}...`);
    try {
      const res = await new Promise((resolve, reject) => {
        const req = https.request(baseUrl + ep.path, { method: ep.method }, (res) => {
          resolve(res);
        });
        req.on('error', reject);
        req.end();
      });
      console.log(`Result: ${res.statusCode} ${res.statusMessage}`);
    } catch (e) {
      console.log(`Error: ${e.message}`);
    }
  }
}

test();
