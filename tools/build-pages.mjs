// Builds dist/ for Cloudflare Pages: only the files the site needs, plus _headers. The app itself has no build step.
import { rmSync, mkdirSync, cpSync } from 'node:fs';
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });
for (const f of ['index.html', 'style.css']) cpSync(f, `dist/${f}`);
cpSync('src', 'dist/src', { recursive: true });
cpSync('fonts', 'dist/fonts', { recursive: true });
cpSync('cloudflare/_headers', 'dist/_headers');
console.log('dist/ ready');
