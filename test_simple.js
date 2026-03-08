const https = require('https');

async function testUrl(url, method) {
  return new Promise((resolve) => {
    const req = https.request(url, { method }, (res) => {
      console.log(`${method} ${url} -> ${res.statusCode}`);
      resolve();
    });
    req.on('error', () => {
      console.log(`${method} ${url} -> ERROR`);
      resolve();
    });
    req.end();
  });
}

const base = 'https://adventurous-octopus-651.convex.site/api/auth';
async function run() {
  await testUrl(`${base}/session`, 'GET');
  await testUrl(`${base}/get-session`, 'GET');
  await testUrl(`${base}/refresh-session`, 'POST');
  await testUrl(`${base}/session-refresh`, 'POST');
  await testUrl(`${base}/session/refresh`, 'POST');
}

run();
