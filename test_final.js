const https = require('https');
const fs = require('fs');

async function testUrl(url, method) {
  return new Promise((resolve) => {
    const req = https.request(url, { method }, (res) => {
      resolve(`${method} ${url} -> ${res.statusCode} ${res.statusMessage}`);
    });
    req.on('error', (e) => {
      resolve(`${method} ${url} -> ERROR: ${e.message}`);
    });
    req.end();
  });
}

const base = 'https://adventurous-octopus-651.convex.site/api/auth';
async function run() {
  const results = [];
  results.push(await testUrl(`${base}/sign-in/email`, 'POST'));
  results.push(await testUrl(`${base}/session`, 'GET'));
  results.push(await testUrl(`${base}/get-session`, 'GET'));
  results.push(await testUrl(`${base}/session-refresh`, 'POST'));
  results.push(await testUrl(`${base}/refresh-session`, 'POST'));
  
  const output = results.join('\n');
  console.log(output);
  fs.writeFileSync('test_results.txt', output, 'utf8');
}

run();
