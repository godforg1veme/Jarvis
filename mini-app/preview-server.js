// Loopback-only design preview. No production APIs, cookies or user data.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = path.dirname(fileURLToPath(import.meta.url));
const importMapHash = createHash('sha256').update('{"imports":{"three":"/vendor/three.module.js"}}').digest('base64');
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['src/app.js', 'text/javascript; charset=utf-8']],
  ['/core.js', ['src/core.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['src/style.css', 'text/css; charset=utf-8']],
  ['/vendor/three.module.js', ['node_modules/three/build/three.module.js', 'text/javascript; charset=utf-8']],
  ['/vendor/three.core.js', ['node_modules/three/build/three.core.js', 'text/javascript; charset=utf-8']],
  ['/vendor/RoomEnvironment.js', ['node_modules/three/examples/jsm/environments/RoomEnvironment.js', 'text/javascript; charset=utf-8']],
]);

const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
  const file = files.get(pathname);
  const headers = { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
    'Content-Security-Policy': `default-src 'self'; script-src 'self' 'sha256-${importMapHash}'; style-src 'self'; img-src 'self' data:; connect-src 'none'; frame-ancestors 'none'; base-uri 'none'` };
  if (!file || !['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(404, headers).end(); return;
  }
  try {
    const data = await readFile(path.join(root, file[0]));
    response.writeHead(200, { ...headers, 'Content-Type': file[1] });
    response.end(request.method === 'HEAD' ? undefined : data);
  } catch {
    response.writeHead(503, headers).end('Preview asset unavailable');
  }
});
server.listen(5187, '127.0.0.1', () => console.log('Jarvis design preview: http://127.0.0.1:5187'));
