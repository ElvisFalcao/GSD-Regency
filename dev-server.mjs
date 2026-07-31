// Static file server for local development.
//
// Node rather than Python: the project already requires Node for `node --test`,
// and Windows ships a Microsoft Store alias stub named python.exe that exits
// with "Python was not found" instead of running anything. The old launcher
// fell through to that stub and left nothing listening, which looked exactly
// like a crashed server.
//
// Opening index.html directly still will not work — browsers refuse ES module
// imports over file:// — so this exists to give the page a real origin.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve(import.meta.dirname);
const port = Number(process.env.PORT || process.argv[2] || 4173);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const server = createServer(async (request, response) => {
  const path = decodeURIComponent(request.url.split('?')[0]);
  const file = join(root, normalize(path === '/' ? '/index.html' : path));
  // normalize() collapses ../ before this check, so a traversal attempt lands
  // outside root and is refused rather than served.
  if (!file.startsWith(root)) { response.writeHead(403).end('forbidden'); return; }
  try {
    const body = await readFile(file);
    response.writeHead(200, { 'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream' });
    response.end(body);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. Close the other server, or run: node dev-server.mjs 4174`);
    process.exit(1);
  }
  throw error;
});

server.listen(port, () => console.log(`Regency Project Manager → http://localhost:${port}`));
