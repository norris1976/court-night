// Court Night scheduler. Pure functions, no DOM, no storage, so Node can test them.
//
// A "night" is plain JSON:
//   { v, title, format: 'americano'|'mexicano', courts, points, roundsTotal, seed, nextId,
//     players: [{ id, name, from, to }],          // active in round r when from <= r and (to === null or r < to)
//     rounds:  [{ sitting: [id], matches: [{ court, t1:[id,id], t2:[id,id], a:null|n, b:null|n, auto:null|'a'|'b' }] }] }

export const MIN_PLAYERS = 4, MAX_PLAYERS = 24, MAX_COURTS = 8, MAX_ROUNDS = 30;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function hashString(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

export const pairKey = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);
export const isActive = (p, r) => p.from <= r && (p.to === null || r < p.to);
export const activeIds = (night, r) => night.players.filter((p) => isActive(p, r)).map((p) => p.id);
export const courtsUsed = (nActive, courts) => Math.min(courts, Math.floor(nActive / 4));

/** Normalise and validate a list of typed names. Returns { names, errors }. */
export function cleanNames(list) {
  const names = [], errors = [], seen = new Set();
  for (let raw of list) {
    const n = String(raw).replace(/\s+/g, ' ').trim().slice(0, 24);
    if (!n) continue;
    const k = n.toLowerCase();
    if (seen.has(k)) { errors.push(`"${n}" is listed twice. Add a surname initial to tell them apart.`); continue; }
    seen.add(k); names.push(n);
  }
  return { names, errors };
}
/** Split pasted text (newlines, commas, semicolons, tabs) into raw names; strips list numbering and bullets. */
export function splitNames(text) {
  return String(text).split(/[\n\r,;\t]+/).map((s) => s.replace(/^\s*(?:\d+[.)]|[-*\u2022])\s*/, '').trim()).filter(Boolean);
}

/** A sensible default number of rounds: ideally everyone sits out equally often, near 7 rounds. */
export function defaultRounds(n, courts) {
  const k = courtsUsed(n, courts), S = n - 4 * k;
  if (k < 1) return 1;
  if (S === 0) return Math.max(3, Math.min(n - 1, 7));
  let best = 7, bestScore = Infinity;
  for (let r = 4; r <= 10; r++) {
    const spread = ((r * S) % n === 0) ? 0 : 1;      // 0 = everyone sits out the same number of times
    const score = spread * 10 + Math.abs(r - 7);
    if (score < bestScore) { bestScore = score; best = r; }
  }
  return best;
}

/** Counts from rounds [0, upto): partners, opponents, sit-outs, games, last sit-out round, court usage. */
export function statsFromRounds(night, upto = night.rounds.length) {
  const partner = new Map(), opp = new Map(), sit = new Map(), games = new Map(), lastSat = new Map(), court = new Map();
  const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
  for (let r = 0; r < upto && r < night.rounds.length; r++) {
    const rd = night.rounds[r];
    for (const id of rd.sitting) { bump(sit, id); lastSat.set(id, r); }
    for (const m of rd.matches) {
      bump(partner, pairKey(m.t1[0], m.t1[1])); bump(partner, pairKey(m.t2[0], m.t2[1]));
      for (const x of m.t1) for (const y of m.t2) bump(opp, pairKey(x, y));
      for (const id of [...m.t1, ...m.t2]) { bump(games, id); bump(court, `${id}@${m.court}`); }
    }
  }
  return { partner, opp, sit, games, lastSat, court };
}

/** Choose who sits out this round: fewest sit-outs so far, then most games played, then sat out longest ago, then list order. */
export function chooseSitters(night, r, stats, ids, count) {
  if (count <= 0) return [];
  const sitMax = Math.max(0, ...ids.map((id) => stats.sit.get(id) || 0));
  const pl = new Map(night.players.map((p) => [p.id, p]));
  // A player who joined late is treated as having sat out as often as the most, so they are not benched straight away.
  const sitOf = (id) => (pl.get(id).from > 0 && !(stats.games.get(id) > 0) ? sitMax : (stats.sit.get(id) || 0));
  return [...ids].sort((x, y) =>
    sitOf(x) - sitOf(y) ||
    (stats.games.get(y) || 0) - (stats.games.get(x) || 0) ||
    (stats.lastSat.has(x) ? stats.lastSat.get(x) : -1) - (stats.lastSat.has(y) ? stats.lastSat.get(y) : -1) ||
    x - y).slice(0, count).sort((a, b) => a - b);
}

function courtCost(arr, c, stats) {
  const o = c * 4, a = arr[o], b = arr[o + 1], x = arr[o + 2], y = arr[o + 3];
  const pc = (i, j) => { const n = stats.partner.get(pairKey(i, j)) || 0; return n * n * 30; };
  const oc = (i, j) => { const n = stats.opp.get(pairKey(i, j)) || 0; return n * n * 8; };
  const cc = (i) => (stats.court.get(`${i}@${c + 1}`) || 0);
  return pc(a, b) + pc(x, y) + oc(a, x) + oc(a, y) + oc(b, x) + oc(b, y) + cc(a) + cc(b) + cc(x) + cc(y);
}

/** Pair a set of playing players (a multiple of 4) for one round, minimising repeated partners and opponents. Deterministic for a seed. */
export function pairAmericano(playing, stats, seed) {
  const n = playing.length, k = n / 4, rng = mulberry32(seed);
  let best = null, bestCost = Infinity;
  const restarts = 40;
  for (let t = 0; t < restarts; t++) {
    const arr = [...playing];
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    const cc = Array.from({ length: k }, (_, c) => courtCost(arr, c, stats));
    let improved = true, guard = 0;
    while (improved && guard++ < 60) {
      improved = false;
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        const ci = i >> 2, cj = j >> 2;
        if (ci === cj && ((i >> 1) === (j >> 1))) continue;      // swapping the two partners changes nothing
        [arr[i], arr[j]] = [arr[j], arr[i]];
        const ni = courtCost(arr, ci, stats), nj = ci === cj ? 0 : courtCost(arr, cj, stats);
        const delta = ci === cj ? ni - cc[ci] : ni + nj - cc[ci] - cc[cj];
        if (delta < 0) { cc[ci] = ni; if (ci !== cj) cc[cj] = nj; improved = true; }
        else [arr[i], arr[j]] = [arr[j], arr[i]];
      }
    }
    const total = cc.reduce((s, v) => s + v, 0);
    if (total < bestCost) { bestCost = total; best = arr; if (total === 0) break; }
  }
  const matches = [];
  for (let c = 0; c < k; c++) matches.push({ court: c + 1, t1: [best[c * 4], best[c * 4 + 1]], t2: [best[c * 4 + 2], best[c * 4 + 3]], a: null, b: null, auto: null });
  return matches;
}

/** Mexicano: rank the players on court, top four on court 1 and so on. Inside a group the default is 1st+4th v 2nd+3rd,
 *  switched to another split only if that stops a repeat partnership. `order` is player ids best first. */
export function pairMexicano(order, stats) {
  const matches = [];
  for (let c = 0; c * 4 < order.length; c++) {
    const [a, b, x, y] = order.slice(c * 4, c * 4 + 4);
    const options = [[[a, y], [b, x]], [[a, x], [b, y]], [[a, b], [x, y]]];
    const rep = (o) => o.reduce((s, p) => s + (stats.partner.get(pairKey(p[0], p[1])) || 0), 0);
    let pick = options[0], pr = rep(pick);
    for (const o of options.slice(1)) if (rep(o) < pr) { pick = o; pr = rep(o); }
    matches.push({ court: c + 1, t1: pick[0], t2: pick[1], a: null, b: null, auto: null });
  }
  return matches;
}

/** Generate round r (0-based). `rankOrder` (ids best first) is needed for Mexicano rounds after the first. Returns a round or null. */
export function generateRound(night, r, rankOrder = null) {
  const ids = activeIds(night, r), k = courtsUsed(ids.length, night.courts);
  if (k < 1) return null;
  const stats = statsFromRounds(night, r);
  const sitting = chooseSitters(night, r, stats, ids, ids.length - 4 * k);
  const playing = ids.filter((id) => !sitting.includes(id));
  let matches;
  if (night.format === 'mexicano' && r > 0 && rankOrder) {
    const rank = new Map(rankOrder.map((id, i) => [id, i]));
    matches = pairMexicano([...playing].sort((x, y) => (rank.get(x) ?? 999) - (rank.get(y) ?? 999) || x - y), stats);
  } else {
    matches = pairAmericano(playing, stats, (night.seed + r * 7919) >>> 0);
  }
  return { sitting, matches };
}

/** Build a new night. Americano rounds are all made now; Mexicano makes round 1 and the rest as each round is finished. */
export function createNight({ title = '', names, courts, points, format, rounds, seed }) {
  const { names: clean, errors } = cleanNames(names);
  if (errors.length) throw new Error(errors[0]);
  if (clean.length < MIN_PLAYERS || clean.length > MAX_PLAYERS) throw new Error(`Add between ${MIN_PLAYERS} and ${MAX_PLAYERS} players.`);
  if (!Number.isInteger(courts) || courts < 1 || courts > MAX_COURTS) throw new Error(`Courts must be a whole number from 1 to ${MAX_COURTS}.`);
  if (!Number.isInteger(points) || points < 2 || points > 99) throw new Error('Points per match must be a whole number from 2 to 99.');
  if (format !== 'americano' && format !== 'mexicano') throw new Error('Pick Americano or Mexicano.');
  const total = rounds ?? defaultRounds(clean.length, courts);
  if (!Number.isInteger(total) || total < 1 || total > MAX_ROUNDS) throw new Error(`Rounds must be a whole number from 1 to ${MAX_ROUNDS}.`);
  const night = { v: 1, title: String(title).trim().slice(0, 40), format, courts, points, roundsTotal: total,
    seed: seed ?? hashString(clean.join('|') + courts + format), nextId: clean.length,
    players: clean.map((name, id) => ({ id, name, from: 0, to: null })), rounds: [] };
  extendRounds(night, null);
  return night;
}

/** Add rounds up to roundsTotal (Americano) or one more round if the last is complete (Mexicano). `rankOrder` for Mexicano. */
export function extendRounds(night, rankOrder) {
  if (night.format === 'americano') {
    while (night.rounds.length < night.roundsTotal) { const rd = generateRound(night, night.rounds.length); if (!rd) break; night.rounds.push(rd); }
  } else if (night.rounds.length < night.roundsTotal) {
    const r = night.rounds.length;
    if (r === 0 || (rankOrder && roundComplete(night, r - 1))) { const rd = generateRound(night, r, rankOrder); if (rd) night.rounds.push(rd); }
  }
  return night;
}

export const matchHasScore = (m) => m.a !== null || m.b !== null;
export const roundComplete = (night, r) => !!night.rounds[r] && night.rounds[r].matches.every((m) => m.a !== null && m.b !== null);
/** Index of the last round with any score entered, or -1. */
export function lastScoredRound(night) { let l = -1; night.rounds.forEach((rd, i) => { if (rd.matches.some(matchHasScore)) l = i; }); return l; }

/** Late arrival: joins from the first round that has no scores. */
export function addPlayer(night, name) {
  const { names, errors } = cleanNames([name, ...night.players.map((p) => p.name)]);
  if (errors.length) throw new Error(errors[0].replace(/is listed twice.*/, 'is already playing tonight.'));
  if (!names.length) throw new Error('Type a name first.');
  if (night.players.filter((p) => p.to === null).length >= MAX_PLAYERS) throw new Error(`The most players is ${MAX_PLAYERS}.`);
  const from = lastScoredRound(night) + 1;
  night.players.push({ id: night.nextId++, name: names[0], from, to: null });
  return night;
}
/** Early leaver: sits out of every round from the first one without scores. Their points stay in the standings. */
export function removePlayer(night, id) {
  const p = night.players.find((x) => x.id === id); if (!p) return night;
  p.to = lastScoredRound(night) + 1;
  return night;
}
/** Re-make only the rounds that have no scores yet. Rounds with any score are kept exactly as they are. */
export function remakeFutureRounds(night, rankOrder = null) {
  night.rounds = night.rounds.slice(0, lastScoredRound(night) + 1);
  return extendRounds(night, rankOrder);
}

/** Variety measures for a schedule, used by the tests and shown in the README. */
export function varietyReport(night) {
  const st = statsFromRounds(night);
  const maxOf = (m) => Math.max(0, ...m.values());
  return { maxPartner: maxOf(st.partner), maxOpponent: maxOf(st.opp), partnerPairs: st.partner.size, oppPairs: st.opp.size,
    games: Object.fromEntries(night.players.map((p) => [p.id, st.games.get(p.id) || 0])),
    sits: Object.fromEntries(night.players.map((p) => [p.id, st.sit.get(p.id) || 0])) };
}
