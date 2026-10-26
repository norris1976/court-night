// Draws the shareable standings card onto a canvas (1080 wide). Works from a snapshot, so the same code serves the organiser and a shared link.
import { FORMAT_LABEL, roundLabel } from './share.js';

const GOLD = '#f4c430', INK = '#f4f1e8', MUTED = '#b9b4a4';
const DISPLAY = '"Barlow Condensed", "Arial Narrow", Impact, sans-serif', BODY = 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif';
const signed = (n) => (n > 0 ? `+${n}` : String(n));

export async function loadCardFonts() {
  try { await Promise.all([document.fonts.load(`800 60px ${DISPLAY}`), document.fonts.load(`600 30px ${BODY}`), document.fonts.load(`800 30px ${BODY}`)]); } catch { /* fall back to system fonts */ }
}

function fit(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text; while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

export function drawStandingsCard(canvas, snap) {
  const W = 1080, rows = snap.s, rowH = rows.length > 16 ? 56 : 68, top = 400, bottom = 150;
  const H = Math.max(1000, top + 70 + rows.length * rowH + bottom);
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#0c0c0b'); g.addColorStop(1, '#1d1c18');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = GOLD; ctx.fillRect(0, 0, W, 14);

  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  ctx.fillStyle = GOLD; ctx.font = `700 28px ${BODY}`; ctx.fillText('SPORT BUILDS', 70, 90);
  ctx.fillStyle = INK; ctx.font = `800 150px ${DISPLAY}`; ctx.fillText('COURT', 70, 235);
  const cw = ctx.measureText('COURT ').width; ctx.fillStyle = GOLD; ctx.fillText('NIGHT', 70 + cw, 235);
  ctx.fillStyle = INK; ctx.font = `600 36px ${BODY}`; ctx.fillText(fit(ctx, snap.t || 'Standings', W - 140), 70, 300);
  ctx.fillStyle = MUTED; ctx.font = `500 28px ${BODY}`;
  ctx.fillText(`${FORMAT_LABEL[snap.f === 'M' ? 'mexicano' : 'americano']} · ${snap.p} points a match · ${roundLabel(snap)}`, 70, 346);

  // header
  const x = { rank: 70, name: 140, pts: 690, w: 800, p: 910, d: 1010 };
  const y0 = top + 24;
  ctx.font = `700 24px ${BODY}`; ctx.fillStyle = MUTED; ctx.textAlign = 'left'; ctx.fillText('PLAYER', x.name, y0);
  ctx.textAlign = 'right';
  for (const [k, t] of [['pts', 'PTS'], ['w', 'W'], ['p', 'P'], ['d', '+/-']]) ctx.fillText(t, x[k], y0);
  ctx.fillStyle = GOLD; ctx.fillRect(70, y0 + 14, W - 140, 3);

  rows.forEach((r, i) => {
    const y = top + 70 + i * rowH, mid = y + rowH * 0.66;
    if (i === 0) { ctx.fillStyle = GOLD; ctx.fillRect(56, y, W - 112, rowH - 6); }
    else if (i % 2 === 0) { ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fillRect(56, y, W - 112, rowH - 6); }
    const fg = i === 0 ? '#1a1500' : INK;
    ctx.fillStyle = fg; ctx.textAlign = 'left';
    ctx.font = `800 34px ${DISPLAY}`; ctx.fillText(String(i + 1), x.rank, mid);
    ctx.font = `700 ${rowH > 60 ? 32 : 28}px ${BODY}`; ctx.fillText(fit(ctx, r[0], 520), x.name, mid);
    ctx.textAlign = 'right';
    ctx.font = `800 ${rowH > 60 ? 36 : 32}px ${BODY}`; ctx.fillText(String(r[1]), x.pts, mid);
    ctx.font = `600 ${rowH > 60 ? 30 : 28}px ${BODY}`;
    ctx.fillText(String(r[2]), x.w, mid); ctx.fillText(String(r[3]), x.p, mid); ctx.fillText(signed(r[4]), x.d, mid);
  });

  ctx.textAlign = 'left'; ctx.fillStyle = MUTED; ctx.font = `500 24px ${BODY}`;
  ctx.fillText('Pts = points won · W = wins · P = matches played · +/- = points difference', 70, H - 92);
  ctx.fillStyle = GOLD; ctx.font = `700 26px ${BODY}`; ctx.fillText('court.sportbuilds.co', 70, H - 46);
  ctx.textAlign = 'right'; ctx.fillStyle = MUTED; ctx.font = `500 24px ${BODY}`; ctx.fillText(`Snapshot, ${snap.d}`, W - 70, H - 46);
  ctx.textAlign = 'left';
}

export function canvasToBlob(canvas) { return new Promise((resolve) => canvas.toBlob(resolve, 'image/png')); }
