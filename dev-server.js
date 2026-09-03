/* Dev static server — zero dependency. Jalankan: node dev-server.js [port]
   Menyajikan folder ini di http://localhost:5173 (default). */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = Number(process.argv[2]) || 8787;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico':  'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';

  // cegah path traversal
  const filePath = path.join(ROOT, path.normalize(urlPath));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 Not Found: ' + urlPath);
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store', // selalu ambil versi terbaru saat dev
    });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log(`\n  Assesment 5R - DEV server`);
  console.log(`  -> http://localhost:${PORT}\n`);
  console.log(`  Opsional set backend dev di Console browser:`);
  console.log(`     localStorage.setItem('dev_sync_url','<URL /exec Apps Script dev>')`);
  console.log(`  Tanpa itu, app memakai backend PRODUKSI (data masuk Sheet asli!).\n`);
});
