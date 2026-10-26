// Tiny static server for local use and screenshots. Usage: node tools/serve.mjs [dir] [port]
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, normalize, resolve, sep } from 'node:path';
const dir = process.argv[2] ?? '.', port = Number(process.argv[3] ?? 5175);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.woff2': 'font/woff2', '.png': 'image/png', '.txt': 'text/plain' };
const csp = readFileSync(join(dir === '.' ? 'cloudflare' : dir, '_headers'), 'utf8').match(/Content-Security-Policy: (.*)/)[1];
createServer((req, res) => {
  let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  if (p.endsWith('/')) p += 'index.html';
  const root = resolve(dir), f = resolve(root, '.' + sep + p);
  if (!f.startsWith(root + sep) || !existsSync(f) || !statSync(f).isFile() || /[\\/](node_modules|\.git|\.wrangler)[\\/]/.test(f)) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': types[extname(f)] ?? 'application/octet-stream', 'Content-Security-Policy': csp, 'Cache-Control': 'no-store' });
  res.end(readFileSync(f));
}).listen(port, () => console.log(`http://localhost:${port}/`));
