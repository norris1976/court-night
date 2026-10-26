// Court Night UI. Everything runs in the browser. The only storage is one saved entry, handled in storage.js. Nothing is sent anywhere.
import { MIN_PLAYERS, MAX_PLAYERS, MAX_COURTS, MAX_ROUNDS, courtsUsed, defaultRounds, cleanNames, splitNames, createNight, extendRounds,
  roundComplete, addPlayer, removePlayer, remakeFutureRounds, lastScoredRound, isActive } from './schedule.js';
import { parseScoreText, validateScores } from './validate.js';
import { computeStandings, rankOrder, progress } from './standings.js';
import { FORMAT_LABEL, snapshotFromNight, encodeSnapshot, decodeSnapshot, snapshotUrl, tokenFromHash, roundLabel, standingsText } from './share.js';
import { saveNight, loadNight, clearNight } from './storage.js';
import { exampleNight } from './example.js';
import { drawStandingsCard, loadCardFonts, canvasToBlob } from './card.js';

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined) n.append(c);
  return n;
};
const signed = (n) => (n > 0 ? `+${n}` : String(n));
const show = (id, on) => { $(id).hidden = !on; };

let night = null;      // the night in progress
let view = 0;          // round index being shown
let shownSnap = null;  // snapshot opened from a link
const setup = { names: [], courtsTouched: false, points: 24, custom: false, format: 'americano' };

/* ---------- small helpers ---------- */
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* try the old way */ }
  try {
    const t = el('textarea', { 'aria-hidden': 'true', readonly: true }); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.append(t); t.select(); const ok = document.execCommand('copy'); t.remove(); return ok;
  } catch { return false; }
}
async function downloadCard(canvas, snap, statusEl) {
  const blob = await canvasToBlob(canvas);
  if (!blob) { statusEl.textContent = 'Could not make the image on this browser.'; return; }
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: `court-night-standings${snap.r ? '-round-' + snap.r : ''}.png` });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
  statusEl.textContent = 'Card downloaded. It is a snapshot of the standings right now.';
}
function persist() {
  const ok = saveNight(night);
  $('save-note').textContent = ok ? 'Saved on this device as you go. Nothing is sent anywhere.' : 'This browser would not let Court Night save, so a refresh will lose the night. Take a screenshot or share the standings as you go.';
}

/* ---------- standings table (used by the night and by snapshots) ---------- */
function fillTable(table, rows, { hideLeft = false } = {}) {
  table.tHead.replaceChildren(el('tr', {}, el('th', { class: 'rank', scope: 'col', text: '#' }), el('th', { scope: 'col', text: 'Player' }),
    ...[['Pts', 'Points won'], ['W', 'Wins'], ['P', 'Matches played'], ['+/-', 'Points difference']].map(([t, d]) => el('th', { scope: 'col', title: d, text: t, 'aria-label': d }))));
  table.tBodies[0].replaceChildren(...rows.map((r, i) => el('tr', { class: i === 0 && r.played > 0 ? 'top1' : '' },
    el('td', { class: 'rank' }, el('span', { class: 'rk', text: String(i + 1) })),
    el('td', { class: 'name' }, r.name, r.left && !hideLeft ? el('span', { class: 'left', text: 'left' }) : null),
    el('td', { class: 'pts', text: String(r.points) }), el('td', { text: String(r.wins) }), el('td', { text: String(r.played) }), el('td', { text: signed(r.diff) }))));
}

/* ---------- views ---------- */
function showView(name) { show('view-setup', name === 'setup'); show('view-night', name === 'night'); show('view-snapshot', name === 'snapshot'); }

async function route() {
  const token = tokenFromHash(location.hash);
  if (token || /^#s=/.test(location.hash)) {
    showView('snapshot');
    try { shownSnap = await decodeSnapshot(token || ''); renderSnapshot(); }
    catch (e) {
      shownSnap = null;
      $('snap-sub').textContent = e.message; $('snap-note').textContent = 'Ask the organiser to send the link again, or open Court Night to run your own night.';
      $('snap-table').tHead.replaceChildren(); $('snap-table').tBodies[0].replaceChildren();
      $('snap-copy').disabled = true; $('snap-download').disabled = true; $('snap-card').hidden = true;
    }
    return;
  }
  night = loadNight();
  if (night) { view = firstOpenRound(); showView('night'); renderNight(); } else { showView('setup'); renderSetup(); }
}
const firstOpenRound = () => { const i = night.rounds.findIndex((_, r) => !roundComplete(night, r)); return i < 0 ? Math.max(0, night.rounds.length - 1) : i; };

/* ---------- snapshot view ---------- */
async function renderSnapshot() {
  const s = shownSnap;
  $('snap-h').textContent = s.t || 'Standings';
  $('snap-sub').textContent = `${FORMAT_LABEL[s.f === 'M' ? 'mexicano' : 'americano']} · ${s.p} points a match · standings ${roundLabel(s)} · snapshot from ${s.d}`;
  fillTable($('snap-table'), s.s.map(([name, points, wins, played, diff]) => ({ name, points, wins, played, diff })), { hideLeft: true });
  $('snap-copy').disabled = false; $('snap-download').disabled = false; $('snap-card').hidden = false;
  await loadCardFonts(); drawStandingsCard($('snap-card'), s);
}

/* ---------- setup ---------- */
function renderSetup() {
  const sel = $('courts');
  if (!sel.options.length) for (let i = 1; i <= MAX_COURTS; i++) sel.append(el('option', { value: i, text: `${i} court${i > 1 ? 's' : ''}` }));
  if (!$('points-seg').children.length) {
    for (const p of [24, 21, 16, 32, 'custom']) {
      $('points-seg').append(el('label', {}, el('input', { type: 'radio', name: 'points', value: p, checked: p === setup.points && !setup.custom }), el('span', { text: p === 'custom' ? 'Custom' : String(p) })));
    }
    for (const [v, t, d] of [['americano', 'Americano', 'Fixed schedule, partners rotate'], ['mexicano', 'Mexicano', 'Pairs follow the standings']]) {
      $('format-seg').append(el('label', {}, el('input', { type: 'radio', name: 'format', value: v, checked: v === setup.format }), el('span', {}, t, el('small', { text: d }))));
    }
  }
  renderChips(); updateHints();
}
function renderChips() {
  $('player-list').replaceChildren(...setup.names.map((name, i) => el('li', {}, name,
    el('button', { type: 'button', 'aria-label': `Remove ${name}`, onclick: () => { setup.names.splice(i, 1); renderChips(); updateHints(); } }, '\u00d7'))));
}
function readPoints() { return setup.custom ? parseScoreText($('points-custom').value) : setup.points; }
function updateHints() {
  const n = setup.names.length;
  $('count-hint').textContent = n ? `${n} added · ${MIN_PLAYERS} to ${MAX_PLAYERS}` : `${MIN_PLAYERS} to ${MAX_PLAYERS}`;
  if (!setup.courtsTouched && n >= MIN_PLAYERS) $('courts').value = String(Math.min(MAX_COURTS, Math.max(1, Math.floor(n / 4))));
  const courts = Number($('courts').value) || 1;
  if (n >= MIN_PLAYERS) {
    const used = courtsUsed(n, courts), sit = n - used * 4;
    $('courts-hint').textContent = used < courts ? `Only ${used} court${used > 1 ? 's' : ''} can be used with ${n} players.` + (sit ? ` ${sit} sit out each round.` : '')
      : sit ? `${sit} player${sit > 1 ? 's' : ''} sit out each round, in turn.` : `Everyone plays every round.`;
    const d = defaultRounds(n, courts); $('rounds').placeholder = String(d); $('rounds-hint').textContent = `Suggested: ${d}.`;
  } else { $('courts-hint').textContent = ''; $('rounds-hint').textContent = ''; $('rounds').placeholder = '7'; }
  $('format-hint').textContent = (document.querySelector('input[name=format]:checked')?.value ?? setup.format) === 'mexicano'
    ? 'Round 1 is mixed. After that, each round pairs players by the current standings, so close games are more likely. The next round is made when the last one is scored.'
    : 'The whole schedule is made now. Every round mixes partners and opponents as much as possible.';
}
function addNames() {
  const items = splitNames($('names-in').value);
  if (!items.length) { setupMsg('Type a name, or paste a list.'); return; }
  const { names, errors } = cleanNames([...setup.names, ...items]);
  if (errors.length) { setupMsg(errors[0]); return; }
  if (names.length > MAX_PLAYERS) { setupMsg(`The most players is ${MAX_PLAYERS}.`); return; }
  setup.names = names; $('names-in').value = ''; setupMsg(''); renderChips(); updateHints(); $('names-in').focus();
}
function setupMsg(t) { $('setup-msg').textContent = t; show('setup-msg', !!t); }

function startFromForm(e) {
  e.preventDefault();
  if ($('names-in').value.trim()) { addNames(); if (!$('setup-msg').hidden) return; }
  const points = readPoints(), r = $('rounds').value.trim();
  try {
    night = createNight({ title: $('title').value, names: setup.names, courts: Number($('courts').value), points,
      format: document.querySelector('input[name=format]:checked').value, rounds: r === '' ? undefined : Number(r), seed: Math.floor(Math.random() * 2 ** 31) });
  } catch (err) { night = null; setupMsg(err.message); return; }
  setupMsg(''); view = 0; showView('night'); persist(); renderNight(); window.scrollTo(0, 0);
}
function startExample() {
  night = exampleNight(document.querySelector('input[name=format]:checked')?.value ?? 'americano');
  view = firstOpenRound(); showView('night'); persist(); renderNight(); window.scrollTo(0, 0);
}

/* ---------- the night ---------- */
const nameOf = (id) => night.players.find((p) => p.id === id)?.name ?? '?';
const teamText = (t) => `${nameOf(t[0])} & ${nameOf(t[1])}`;

function renderNight() {
  $('night-h').textContent = night.title || 'Court Night';
  renderTabs(); renderRound(); renderStandings(); refreshShare(); renderPlayers();
}
function renderTabs() {
  const total = night.roundsTotal;
  $('night-meta').textContent = `${FORMAT_LABEL[night.format]} · ${night.points} points a match · ${night.players.filter((p) => p.to === null).length} players · ${night.courts} court${night.courts > 1 ? 's' : ''}`;
  $('round-tabs').replaceChildren(...Array.from({ length: total }, (_, r) => {
    const made = r < night.rounds.length, done = made && roundComplete(night, r);
    return el('button', { type: 'button', class: made ? '' : 'todo', 'aria-current': r === view ? 'true' : null, disabled: !made,
      'aria-label': `Round ${r + 1}${done ? ', complete' : made ? '' : ', not made yet'}`, onclick: () => { view = r; renderTabs(); renderRound(); } }, done ? `${r + 1} \u2713` : String(r + 1));
  }));
  const cur = $('round-tabs').querySelector('[aria-current]'); if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest', inline: 'center' });
}
function renderRound() {
  const rd = night.rounds[view];
  $('round-h').textContent = `Round ${view + 1} of ${night.roundsTotal}`;
  if (!rd) { $('sitting').hidden = true; $('matches').replaceChildren(); $('round-actions').replaceChildren(); return; }
  $('sitting').hidden = false;
  $('sitting').textContent = rd.sitting.length ? `Sitting out: ${rd.sitting.map(nameOf).join(', ')}` : 'Nobody sits out this round.';
  $('matches').replaceChildren(...rd.matches.map((m) => matchCard(m)));
  renderRoundActions();
}
function matchCard(m) {
  const msg = el('p', { class: 'match-msg', role: 'status' });
  const card = el('div', { class: 'match', role: 'group', 'aria-label': `Court ${m.court}` });
  const mk = (team, side) => {
    const input = el('input', { class: 'score', type: 'text', inputmode: 'numeric', pattern: '[0-9]*', maxlength: 2, autocomplete: 'off', enterkeyhint: 'next',
      'aria-label': `Court ${m.court}: points for ${teamText(team)}`, value: m[side] ?? '' });
    input.addEventListener('input', () => onScore(m, side, input, card));
    input.addEventListener('focus', () => input.select());
    return { input, row: el('div', { class: 'team' }, el('span', { class: 'names' }, teamText(team), el('span', { class: 'badge', hidden: true, text: 'Win' })), input) };
  };
  const t1 = mk(m.t1, 'a'), t2 = mk(m.t2, 'b');
  card.append(el('h3', { text: `Court ${m.court}` }), t1.row, el('div', { class: 'vs', text: 'vs' }), t2.row, msg);
  card._refs = { t1, t2, msg };
  paintMatch(card, m);
  return card;
}
function paintMatch(card, m) {
  const v = validateScores(m.a, m.b, night.points), { t1, t2, msg } = card._refs;
  t1.row.querySelector('.badge').hidden = !(v.counted && m.a > m.b); t2.row.querySelector('.badge').hidden = !(v.counted && m.b > m.a);
  msg.textContent = v.message; msg.className = `match-msg ${v.status === 'invalid' ? 'error' : v.status === 'warn' || v.status === 'incomplete' ? 'warn' : ''}`;
  for (const [i, side] of [[t1.input, 'a'], [t2.input, 'b']]) i.setAttribute('aria-invalid', v.status === 'invalid' ? 'true' : 'false');
}
function onScore(m, side, input, card) {
  const other = side === 'a' ? 'b' : 'a', v = parseScoreText(input.value);
  input.value = v === null ? '' : String(v);
  const wasComplement = m[side] !== null && m[other] !== null && m[side] + m[other] === night.points;   // a normal score: correcting one side re-balances the other
  m[side] = v;
  const otherInput = card._refs[other === 'a' ? 't1' : 't2'].input;
  if (v === null) { if (m.auto === other) { m[other] = null; m.auto = null; otherInput.value = ''; } else if (m.auto === side) m.auto = null; }
  else if (v <= night.points && (m[other] === null || m.auto === other || wasComplement)) { m[other] = night.points - v; m.auto = other; otherInput.value = String(m[other]); }
  else if (m.auto === side) m.auto = null;
  paintMatch(card, m); afterScoreChange();
}
let shareTimer = 0;
function afterScoreChange() {
  persist(); renderStandings(); renderTabs(); renderRoundActions();
  clearTimeout(shareTimer); shareTimer = setTimeout(refreshShare, 200);
}
function renderRoundActions() {
  const box = $('round-actions'), last = night.rounds.length - 1, done = roundComplete(night, view);
  const kids = [];
  if (view > 0) kids.push(el('button', { type: 'button', onclick: () => { view -= 1; renderTabs(); renderRound(); } }, `\u2190 Round ${view}`));
  if (view < last) kids.push(el('button', { type: 'button', class: 'primary', onclick: () => { view += 1; renderTabs(); renderRound(); window.scrollTo(0, 0); } }, `Round ${view + 2} \u2192`));
  else if (done && night.rounds.length < night.roundsTotal) {
    if (night.format === 'mexicano') kids.push(el('button', { type: 'button', class: 'primary', onclick: makeNextRound }, `Make round ${night.rounds.length + 1} from the standings`));
    else kids.push(el('p', { class: 'detail', text: 'No more rounds can be made with the players left. Add a player below, or share the standings.' }));
  } else if (done && view === last && night.rounds.length >= night.roundsTotal) kids.push(el('p', { class: 'detail', text: 'That was the last round. Share the final standings below.' }));
  if (night.format === 'mexicano' && view < last) kids.push(el('p', { class: 'detail', text: 'Changing a score here updates the standings. Rounds already made keep their pairs; use "Re-make unscored rounds" below to re-pair the next ones.' }));
  box.replaceChildren(...kids);
}
function makeNextRound() {
  extendRounds(night, rankOrder(night));
  if (night.rounds.length) view = night.rounds.length - 1;
  persist(); renderNight(); window.scrollTo(0, 0);
}
function renderStandings() {
  const pr = progress(night);
  $('standings-sub').textContent = pr.round === 0 ? 'Enter scores and the standings fill in as you go.' : `${pr.complete ? 'After' : 'During'} round ${pr.round} of ${night.roundsTotal}`;
  fillTable($('standings'), computeStandings(night));
}

/* ---------- share ---------- */
let cardReady = false;
async function refreshShare() {
  const snap = snapshotFromNight(night);
  $('share-text').value = standingsText(snap);
  if (!cardReady) { await loadCardFonts(); cardReady = true; }
  drawStandingsCard($('card'), snapshotFromNight(night));
}
async function shareLink() {
  const snap = snapshotFromNight(night), token = await encodeSnapshot(snap), url = snapshotUrl(location.href, token);
  $('share-url').value = url; show('share-url', true);
  const ok = await copyText(url);
  $('share-status').textContent = (ok ? 'Link copied. ' : 'Copy the link from the box below. ') + `It shows the standings ${roundLabel(snap)} and will not change. Share a new link after the next round.` + (url.length > 2000 ? ' It is a long link; some apps may cut it, so the text version is safer for them.' : '');
}
async function shareText() {
  const snap = snapshotFromNight(night), ok = await copyText(standingsText(snap));
  $('share-status').textContent = ok ? 'Copied. Paste it into your group chat.' : 'Copy it from the box below.';
}

/* ---------- late arrivals and leavers ---------- */
function renderPlayers() {
  const last = lastScoredRound(night);
  $('players-now').replaceChildren(...night.players.map((p) => {
    const gone = p.to !== null;
    return el('li', { class: gone ? 'gone' : '' }, gone ? `${p.name} (left)` : p.name,
      gone ? null : el('button', { type: 'button', 'aria-label': `${p.name} is leaving`, onclick: () => changePlayers(() => removePlayer(night, p.id), `${p.name} is out of the next rounds.`) }, 'Leaves'));
  }));
  $('remake').disabled = false;
  void last;
}
function changePlayers(fn, okMsg) {
  const before = JSON.stringify(night);
  try { fn(); } catch (e) { night = JSON.parse(before); $('players-msg').textContent = e.message; return; }
  remakeFutureRounds(night, rankOrder(night));
  const start = lastScoredRound(night) + 1, playing = night.players.filter((p) => isActive(p, start)).length;
  let msg = okMsg;
  if (playing < MIN_PLAYERS) msg += ` Only ${playing} left, so no more rounds can be made until someone is added.`;
  else if (night.rounds.length < night.roundsTotal && night.format === 'mexicano') msg += ' The next round is made from the standings once this one is scored.';
  else msg += ` Rounds ${start + 1} onward were re-made.`;
  $('players-msg').textContent = msg;
  view = Math.min(view, Math.max(0, night.rounds.length - 1)); if (view < start && night.rounds[start]) view = start;
  persist(); renderNight();
}

/* ---------- start over / clear ---------- */
function newNight() {
  if (!confirm('Start a new night? The current night, its scores and standings will be removed from this device. Share the standings first if you want to keep them. The player names are kept for the new setup.')) return;
  setup.names = night ? night.players.filter((p) => p.to === null).map((p) => p.name) : [];
  night = null; clearNight(); showView('setup'); resetForm(); renderSetup(); window.scrollTo(0, 0);
}
function clearSaved() {
  if (!confirm('Clear the saved night from this device? Scores, standings and players will be deleted. This cannot be undone.')) return;
  setup.names = []; night = null; clearNight(); history.replaceState(null, '', location.pathname); showView('setup'); resetForm(); renderSetup(); window.scrollTo(0, 0);
}
function resetForm() { $('title').value = ''; $('rounds').value = ''; $('names-in').value = ''; setupMsg(''); setup.courtsTouched = false; }

/* ---------- wire up ---------- */
$('setup').addEventListener('submit', startFromForm);
$('add-names').addEventListener('click', addNames);
$('clear-names').addEventListener('click', () => { setup.names = []; renderChips(); updateHints(); });
$('names-in').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addNames(); } });
$('courts').addEventListener('change', () => { setup.courtsTouched = true; updateHints(); });
$('points-seg').addEventListener('change', (e) => {
  setup.custom = e.target.value === 'custom'; if (!setup.custom) setup.points = Number(e.target.value);
  show('custom-wrap', setup.custom); if (setup.custom) $('points-custom').focus();
});
$('format-seg').addEventListener('change', (e) => { setup.format = e.target.value; updateHints(); });
$('example').addEventListener('click', startExample);
$('share-link').addEventListener('click', shareLink);
$('share-text-btn').addEventListener('click', shareText);
$('share-download').addEventListener('click', () => downloadCard($('card'), snapshotFromNight(night), $('share-status')));
$('snap-copy').addEventListener('click', async () => { $('snap-status').textContent = (await copyText(standingsText(shownSnap))) ? 'Copied. Paste it into your group chat.' : 'Could not copy on this browser.'; });
$('snap-download').addEventListener('click', () => downloadCard($('snap-card'), shownSnap, $('snap-status')));
$('late-add').addEventListener('click', () => { const v = $('late-name').value; changePlayers(() => addPlayer(night, v), `${v.trim()} is in from the next round.`); if (!/is already|Type a name|most players/.test($('players-msg').textContent)) $('late-name').value = ''; });
$('late-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('late-add').click(); } });
$('remake').addEventListener('click', () => changePlayers(() => {}, 'Unscored rounds re-made.'));
$('new-night').addEventListener('click', newNight);
$('clear-saved').addEventListener('click', clearSaved);
addEventListener('hashchange', route);
route();
