// Share helpers. A snapshot is a small read-only copy of the standings, compressed into the URL hash. No server.
import { computeStandings, progress } from './standings.js';

export const FORMAT_LABEL = { americano: 'Americano', mexicano: 'Mexicano' };
const MAX_TOKEN = 6000;   // characters in the hash we are willing to read

export function snapshotFromNight(night, now = new Date()) {
  const rows = computeStandings(night), pr = progress(night);
  return { v: 1, t: night.title || '', f: night.format === 'mexicano' ? 'M' : 'A', p: night.points, r: pr.round, c: pr.complete ? 1 : 0, n: night.roundsTotal,
    d: now.toISOString().slice(0, 10), s: rows.map((x) => [x.name, x.points, x.wins, x.played, x.diff]) };
}

const toB64 = (bytes) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const fromB64 = (t) => { const s = atob(t.replace(/-/g, '+').replace(/_/g, '/')); const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; };
async function pipe(bytes, stream) { const r = new Response(new Blob([bytes]).stream().pipeThrough(stream)); return new Uint8Array(await r.arrayBuffer()); }

/** Token = 'c' + base64url(deflate(json)) where the browser can compress, else 'u' + base64url(json). */
export async function encodeSnapshot(snap) {
  const json = new TextEncoder().encode(JSON.stringify(snap));
  if (typeof CompressionStream === 'function') return 'c' + toB64(await pipe(json, new CompressionStream('deflate-raw')));
  return 'u' + toB64(json);
}

/** Decode and strictly validate. Throws Error('...') on anything unexpected. Never trusts the content. */
export async function decodeSnapshot(token) {
  if (typeof token !== 'string' || token.length < 2 || token.length > MAX_TOKEN || !/^[cu][A-Za-z0-9_-]+$/.test(token)) throw new Error('This link is not a Court Night snapshot.');
  let json;
  try {
    const raw = fromB64(token.slice(1));
    if (token[0] === 'c') { if (typeof DecompressionStream !== 'function') throw new Error('no decompress'); json = new TextDecoder().decode(await pipe(raw, new DecompressionStream('deflate-raw'))); }
    else json = new TextDecoder().decode(raw);
  } catch { throw new Error('This snapshot link is damaged or incomplete.'); }
  let o; try { o = JSON.parse(json); } catch { throw new Error('This snapshot link is damaged or incomplete.'); }
  const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  if (!o || o.v !== 1 || typeof o.t !== 'string' || o.t.length > 40 || (o.f !== 'A' && o.f !== 'M') || !int(o.p, 2, 99) || !int(o.r, 0, 30) || !int(o.n, 1, 30) || !(o.c === 0 || o.c === 1)
    || typeof o.d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.d) || !Array.isArray(o.s) || o.s.length < 1 || o.s.length > 40) throw new Error('This snapshot link is not valid.');
  const s = o.s.map((row) => {
    if (!Array.isArray(row) || row.length !== 5 || typeof row[0] !== 'string' || row[0].length < 1 || row[0].length > 24 || !int(row[1], 0, 9999) || !int(row[2], 0, 99) || !int(row[3], 0, 99) || !int(row[4], -9999, 9999)) throw new Error('This snapshot link is not valid.');
    return [row[0], row[1], row[2], row[3], row[4]];
  });
  return { v: 1, t: o.t, f: o.f, p: o.p, r: o.r, c: o.c, n: o.n, d: o.d, s };
}

export const snapshotUrl = (base, token) => `${base.split('#')[0]}#s=${token}`;
export const tokenFromHash = (hash) => { const m = /^#s=([A-Za-z0-9_-]+)$/.exec(hash || ''); return m ? m[1] : null; };

export const roundLabel = (snap) => (snap.r === 0 ? 'before round 1' : snap.c ? `after round ${snap.r} of ${snap.n}` : `round ${snap.r} of ${snap.n} in progress`);
const signed = (n) => (n > 0 ? `+${n}` : String(n));

/** Neat plain-text table for a group chat. Wrapped in backticks so chat apps show it in a fixed-width font. */
export function standingsText(snap) {
  const w = Math.max(...snap.s.map((r) => r[0].length), 6);
  const lines = snap.s.map((r, i) => `${String(i + 1).padStart(2)} ${r[0].padEnd(w)} ${String(r[1]).padStart(3)} ${String(r[2]).padStart(2)}/${String(r[3]).padEnd(2)} ${signed(r[4]).padStart(4)}`);
  const head = `${'#'.padStart(2)} ${'Player'.padEnd(w)} ${'Pts'.padStart(3)} ${'W/P'.padEnd(5)} ${'+/-'.padStart(4)}`;
  return [`Court Night${snap.t ? `: ${snap.t}` : ''}`, `Standings ${roundLabel(snap)}`, '```', head, ...lines, '```', 'Pts = points won, W/P = wins/matches played, +/- = points difference', snap.d].join('\n');
}
