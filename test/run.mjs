// Dependency-free tests. Run: npm test  (node test/run.mjs)
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import {
  createNight, defaultRounds, varietyReport, statsFromRounds, activeIds, pairKey, splitNames, cleanNames, pairMexicano,
  addPlayer, removePlayer, remakeFutureRounds, extendRounds, roundComplete, courtsUsed,
} from '../src/schedule.js';
import { computeStandings, rankOrder, progress } from '../src/standings.js';
import { validateScores, parseScoreText } from '../src/validate.js';
import { snapshotFromNight, encodeSnapshot, decodeSnapshot, standingsText, snapshotUrl, tokenFromHash } from '../src/share.js';
import { saveNight, loadNight, clearNight, isNight, KEY } from '../src/storage.js';
import { exampleNight, EXAMPLE_NAMES } from '../src/example.js';

let passed = 0; const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (e) { failures.push(name); console.log(`  FAIL ${name}\n       ${e.message}`); }
}
const names = (n) => Array.from({ length: n }, (_, i) => `P${String(i).padStart(2, '0')}`);
const mk = (n, courts, extra = {}) => createNight({ names: names(n), courts, points: 24, format: 'americano', ...extra });
const allIds = (night) => night.players.map((p) => p.id);

console.log('Scheduler: structure and fairness');
for (const [n, courts] of [[8, 2], [10, 2], [12, 3], [13, 3], [16, 4], [20, 5], [24, 6], [24, 4], [9, 2], [4, 1]]) {
  await test(`${n} players, ${courts} courts: nobody is on two courts, courts and sit-outs add up, players only appear once per round`, () => {
    const night = mk(n, courts);
    assert.ok(night.rounds.length >= 1);
    night.rounds.forEach((rd, r) => {
      const seen = [...rd.sitting, ...rd.matches.flatMap((m) => [...m.t1, ...m.t2])];
      assert.equal(new Set(seen).size, seen.length, `round ${r + 1}: a player appears twice`);
      assert.equal(seen.length, n, `round ${r + 1}: everyone is either playing or sitting out`);
      assert.equal(rd.matches.length, courtsUsed(n, courts));
      assert.equal(rd.sitting.length, n - 4 * courtsUsed(n, courts));
      assert.deepEqual(rd.matches.map((m) => m.court), rd.matches.map((_, i) => i + 1));
    });
  });
}
for (const [n, courts] of [[8, 2], [12, 3], [16, 4], [20, 5], [24, 6]]) {
  await test(`${n} players, ${courts} courts: everyone plays exactly the same number of matches`, () => {
    const v = varietyReport(mk(n, courts));
    const g = Object.values(v.games); assert.equal(Math.min(...g), Math.max(...g)); assert.ok(g[0] > 0);
    assert.ok(Object.values(v.sits).every((s) => s === 0));
  });
}
for (const [n, courts] of [[10, 2], [13, 3], [14, 3], [11, 2], [9, 2], [24, 4]]) {
  await test(`${n} players, ${courts} courts: sit-outs are fair (nobody sits twice before everyone has sat once) and games differ by at most 1`, () => {
    const night = mk(n, courts, { rounds: n * 2 > 26 ? 26 : n * 2 });
    const sit = new Map(allIds(night).map((id) => [id, 0]));
    night.rounds.forEach((rd, r) => {
      const min = Math.min(...sit.values());
      for (const id of rd.sitting) {
        assert.ok(sit.get(id) - min <= 1, `round ${r + 1}: player ${id} sits with ${sit.get(id)} sit-outs while someone has ${min}`);
        if (sit.get(id) > min) assert.ok(allIds(night).filter((x) => sit.get(x) === min).every((x) => rd.sitting.includes(x)), `round ${r + 1}: someone with fewer sit-outs is playing`);
      }
      rd.sitting.forEach((id) => sit.set(id, sit.get(id) + 1));
    });
    const v = varietyReport(night), s = Object.values(v.sits), g = Object.values(v.games);
    assert.ok(Math.max(...s) - Math.min(...s) <= 1, 'sit-outs differ by more than 1');
    assert.ok(Math.max(...g) - Math.min(...g) <= 1, 'games differ by more than 1');
  });
}
await test('10 players, 2 courts, 10 rounds: everyone sits out exactly twice and plays 8', () => {
  const v = varietyReport(mk(10, 2, { rounds: 10 }));
  assert.ok(Object.values(v.sits).every((s) => s === 2)); assert.ok(Object.values(v.games).every((g) => g === 8));
});
await test('13 players, 3 courts, 13 rounds: everyone sits out exactly once', () => {
  const v = varietyReport(mk(13, 3, { rounds: 13 }));
  assert.ok(Object.values(v.sits).every((s) => s === 1));
});
await test('fewer courts than players/4: 16 players on 2 courts rotate 8 sit-outs per round fairly', () => {
  const night = mk(16, 2, { rounds: 8 });
  night.rounds.forEach((rd) => assert.equal(rd.sitting.length, 8));
  const v = varietyReport(night); assert.ok(Object.values(v.sits).every((s) => s === 4));
});

console.log('Scheduler: partner and opponent variety');
for (const [n, courts] of [[8, 2], [10, 2], [12, 3], [13, 3], [16, 4], [20, 5], [24, 6]]) {
  await test(`${n} players, ${courts} courts, default rounds: no partner repeats, opponents repeat at most twice`, () => {
    const night = mk(n, courts, { rounds: defaultRounds(n, courts) }), v = varietyReport(night);
    assert.ok(v.maxPartner <= 1, `partner repeated ${v.maxPartner} times`);
    assert.ok(v.maxOpponent <= 2, `opponents met ${v.maxOpponent} times`);
  });
}
await test('8 players, 7 rounds: a perfect Americano, everyone partners everyone else exactly once', () => {
  const v = varietyReport(mk(8, 2)); assert.equal(v.partnerPairs, 28); assert.equal(v.maxPartner, 1);
});
await test('the schedule is deterministic for the same inputs (same names, courts, seed)', () => {
  assert.deepEqual(mk(13, 3).rounds, mk(13, 3).rounds);
  assert.notDeepEqual(mk(13, 3, { seed: 1 }).rounds, mk(13, 3, { seed: 2 }).rounds);
});
await test('default rounds: even numbers get n-1 up to 7; uneven numbers get a round count that is fair when one exists', () => {
  assert.equal(defaultRounds(8, 2), 7); assert.equal(defaultRounds(4, 1), 3); assert.equal(defaultRounds(12, 3), 7);
  assert.equal(defaultRounds(10, 2), 5); assert.equal(defaultRounds(13, 3), 7);
  for (let n = 4; n <= 24; n++) for (let c = 1; c <= 6; c++) { const r = defaultRounds(n, c); assert.ok(r >= 1 && r <= 10); }
});

console.log('Mexicano pairing');
await test('round 1 is a normal Americano round; round 2 is only made once round 1 is complete', () => {
  const night = createNight({ names: names(8), courts: 2, points: 24, format: 'mexicano' });
  assert.equal(night.rounds.length, 1);
  extendRounds(night, rankOrder(night)); assert.equal(night.rounds.length, 1, 'must not make round 2 early');
  night.rounds[0].matches.forEach((m, i) => { m.a = 14 + i; m.b = 10 - i; });
  extendRounds(night, rankOrder(night)); assert.equal(night.rounds.length, 2);
});
await test('top four on court 1, next four on court 2; 1st+4th v 2nd+3rd inside a group when nobody has partnered yet', () => {
  const stats = statsFromRounds({ rounds: [] }, 0);
  const m = pairMexicano([10, 11, 12, 13, 14, 15, 16, 17], stats);
  assert.deepEqual(m[0].t1, [10, 13]); assert.deepEqual(m[0].t2, [11, 12]);
  assert.deepEqual(m[1].t1, [14, 17]); assert.deepEqual(m[1].t2, [15, 16]);
});
await test('a repeated 1st+4th partnership is swapped for another split inside the group', () => {
  const night = { rounds: [{ sitting: [], matches: [{ court: 1, t1: [10, 13], t2: [11, 12] }] }] };
  const m = pairMexicano([10, 11, 12, 13], statsFromRounds(night));
  assert.notDeepEqual([...m[0].t1].sort(), [10, 13]); assert.notDeepEqual([...m[0].t2].sort(), [10, 13]);
});
await test('after round 1 courts are filled by current standings (best four share court 1), sit-outs rotate fairly', () => {
  const night = createNight({ names: names(10), courts: 2, points: 24, format: 'mexicano', rounds: 5 });
  night.rounds[0].matches.forEach((m, i) => { m.a = i === 0 ? 20 : 12; m.b = i === 0 ? 4 : 12; });
  extendRounds(night, rankOrder(night));
  const r2 = night.rounds[1], rank = rankOrder(night);
  const playing = rank.filter((id) => !r2.sitting.includes(id));
  const court1 = new Set([...r2.matches[0].t1, ...r2.matches[0].t2]);
  assert.deepEqual([...court1].sort((a, b) => a - b), playing.slice(0, 4).sort((a, b) => a - b));
  assert.equal(r2.sitting.length, 2);
  assert.ok(r2.sitting.every((id) => !night.rounds[0].sitting.includes(id)), 'nobody sits out twice in a row');
});
await test('a full 8-player Mexicano night plays out: nobody twice in a round, everyone same games', () => {
  const night = createNight({ names: names(8), courts: 2, points: 24, format: 'mexicano', rounds: 5 });
  for (let r = 0; r < 5; r++) {
    assert.equal(night.rounds.length, r + 1);
    night.rounds[r].matches.forEach((m, i) => { m.a = 10 + ((r + i) % 8); m.b = 24 - m.a; });
    extendRounds(night, rankOrder(night));
  }
  const v = varietyReport(night); assert.ok(Object.values(v.games).every((g) => g === 5));
  night.rounds.forEach((rd) => { const s = rd.matches.flatMap((m) => [...m.t1, ...m.t2]); assert.equal(new Set(s).size, 8); });
});

console.log('Editing: late arrivals and early leavers');
await test('a late arrival joins from the first round with no scores; earlier rounds are untouched', () => {
  const night = mk(8, 2, { rounds: 6 });
  night.rounds[0].matches.forEach((m) => { m.a = 12; m.b = 12; });
  night.rounds[1].matches.forEach((m) => { m.a = 13; m.b = 11; });
  const before = JSON.stringify(night.rounds.slice(0, 2));
  addPlayer(night, 'Late Larry'); remakeFutureRounds(night);
  assert.equal(JSON.stringify(night.rounds.slice(0, 2)), before);
  assert.equal(night.rounds.length, 6);
  assert.ok(night.players[8].from === 2);
  const ids = new Set(night.rounds[2].matches.flatMap((m) => [...m.t1, ...m.t2]).concat(night.rounds[2].sitting));
  assert.ok(ids.has(8), 'late arrival is in round 3');
  assert.equal(night.rounds[2].sitting.length, 1);
  assert.ok(!night.rounds[2].sitting.includes(8), 'the late arrival is not benched straight away');
  assert.ok(!night.rounds.slice(0, 2).some((rd) => rd.sitting.includes(8) || rd.matches.some((m) => [...m.t1, ...m.t2].includes(8))));
});
await test('an early leaver is dropped from future rounds but keeps their points in the standings', () => {
  const night = mk(12, 3, { rounds: 6 });
  night.rounds[0].matches.forEach((m) => { m.a = 15; m.b = 9; });
  const leaver = night.rounds[0].matches[0].t1[0];
  removePlayer(night, leaver); remakeFutureRounds(night);
  for (let r = 1; r < night.rounds.length; r++) { const s = [...night.rounds[r].sitting, ...night.rounds[r].matches.flatMap((m) => [...m.t1, ...m.t2])]; assert.ok(!s.includes(leaver)); assert.equal(s.length, 11); }
  const row = computeStandings(night).find((x) => x.id === leaver); assert.equal(row.points, 15); assert.equal(row.left, true);
});
await test('a leaver brings the night below 4 players: no rounds are made and nothing throws', () => {
  const night = mk(4, 1, { rounds: 3 });
  night.rounds[0].matches[0].a = 12; night.rounds[0].matches[0].b = 12;
  removePlayer(night, 0); remakeFutureRounds(night);
  assert.equal(night.rounds.length, 1);
});
await test('duplicate names are refused, case-insensitively; pasted lists are split and cleaned', () => {
  assert.throws(() => createNight({ names: ['Alex', 'alex', 'B', 'C', 'D'], courts: 1, points: 24, format: 'americano' }), /listed twice/);
  assert.throws(() => addPlayer(mk(8, 2), 'p01'), /already playing/);
  assert.deepEqual(splitNames('1. Alex\n2) Sam, Jo;Priya\t- Marco\n\n  \u2022 Lena'), ['Alex', 'Sam', 'Jo', 'Priya', 'Marco', 'Lena']);
  assert.deepEqual(cleanNames(['  Al   ex ', '', 'x'.repeat(40)]).names, ['Al ex', 'x'.repeat(24)]);
  assert.throws(() => createNight({ names: names(3), courts: 1, points: 24, format: 'americano' }), /between 4 and 24/);
  assert.throws(() => createNight({ names: names(25), courts: 1, points: 24, format: 'americano' }), /between 4 and 24/);
  assert.throws(() => createNight({ names: names(8), courts: 0, points: 24, format: 'americano' }), /Courts/);
});

console.log('Score validation');
await test('score text keeps digits only; whole numbers 0..points; empty is null', () => {
  assert.equal(parseScoreText(''), null); assert.equal(parseScoreText('14'), 14); assert.equal(parseScoreText('1a4'), 14); assert.equal(parseScoreText('-3'), 3); assert.equal(parseScoreText('9999'), 999);
});
await test('empty, incomplete, invalid, warn and ok states', () => {
  assert.equal(validateScores(null, null, 24).status, 'empty');
  assert.deepEqual([validateScores(14, null, 24).status, validateScores(14, null, 24).counted], ['incomplete', false]);
  assert.equal(validateScores(25, 0, 24).status, 'invalid'); assert.equal(validateScores(-1, 5, 24).status, 'invalid'); assert.equal(validateScores(1.5, 5, 24).status, 'invalid');
  const w = validateScores(14, 8, 24); assert.deepEqual([w.status, w.counted], ['warn', true]); assert.match(w.message, /add up to 24/);
  assert.deepEqual([validateScores(14, 10, 24).status, validateScores(14, 10, 24).counted], ['ok', true]);
  assert.equal(validateScores(12, 12, 24).status, 'ok'); assert.equal(validateScores(24, 0, 24).status, 'ok');
});

console.log('Standings');
function manual(rows) { // rows: [[names...], [a, b]] build a night with hand-made matches
  const n = { v: 1, title: '', format: 'americano', courts: 1, points: 24, roundsTotal: 9, seed: 1, nextId: 8, players: names(8).map((name, id) => ({ id, name, from: 0, to: null })), rounds: [] };
  for (const [t1, t2, a, b] of rows) n.rounds.push({ sitting: [], matches: [{ court: 1, t1, t2, a, b, auto: null }] });
  return n;
}
await test('ranks by total points, not wins: 3 narrow wins lose to 2 big wins', () => {
  const n = manual([[[0, 1], [2, 3], 13, 11], [[0, 1], [4, 5], 13, 11], [[0, 1], [6, 7], 13, 11], [[2, 3], [4, 5], 24, 0], [[2, 3], [6, 7], 24, 0]]);
  const s = computeStandings(n), a = s.find((x) => x.id === 0), b = s.find((x) => x.id === 2);
  assert.deepEqual([a.wins, a.points], [3, 39]); assert.deepEqual([b.wins, b.points], [2, 59]);
  assert.ok(s.indexOf(b) < s.indexOf(a), 'more points outranks more wins');
});
await test('totals: points, wins, played and difference add up; unscored, incomplete and invalid matches are ignored', () => {
  const n = manual([[[0, 1], [2, 3], 14, 10], [[4, 5], [6, 7], 8, 16], [[0, 2], [1, 3], 30, 0], [[0, 4], [1, 5], 5, null], [[0, 4], [1, 5], null, null]]);
  const s = computeStandings(n), g = (id) => s.find((x) => x.id === id);
  assert.deepEqual([g(0).points, g(0).wins, g(0).played, g(0).diff], [14, 1, 1, 4]);
  assert.deepEqual([g(2).points, g(2).wins, g(2).played, g(2).diff], [10, 0, 1, -4]);
  assert.deepEqual([g(6).points, g(6).wins, g(6).played, g(6).diff], [16, 1, 1, 8]);
  assert.equal(s.reduce((t, x) => t + x.diff, 0), 0, 'differences sum to zero');
});
await test('a draw gives both teams the points, no wins, and is counted as played', () => {
  const s = computeStandings(manual([[[0, 1], [2, 3], 12, 12]])), g = (id) => s.find((x) => x.id === id);
  assert.deepEqual([g(0).points, g(0).wins, g(0).draws, g(0).played, g(0).diff], [12, 0, 1, 1, 0]);
});
await test('tie-breaks 1 and 2: equal points go to the player with more wins; equal points and wins go to the bigger difference', () => {
  // Same points (20): 4 has two wins, 0 has one.
  let n = manual([[[0, 1], [2, 3], 20, 4], [[4, 5], [6, 7], 10, 9], [[4, 5], [6, 7], 10, 9]]);
  let s = computeStandings(n); assert.ok(s.findIndex((x) => x.id === 4) < s.findIndex((x) => x.id === 0), 'more wins first');
  // Same points and wins: bigger difference first.
  n = manual([[[0, 1], [2, 3], 13, 11], [[4, 5], [6, 7], 13, 1]]);
  s = computeStandings(n); assert.ok(s.findIndex((x) => x.id === 4) < s.findIndex((x) => x.id === 0), 'bigger difference first');
});
await test('tie-break 3: head-to-head decides between players level on points, wins and difference', () => {
  // 0 and 1 both finish on 36 points, 1 win, 1 draw, difference 0. 0 beat 1 when they faced each other.
  const mkH = (headToHead) => manual([[[0, 2], [1, 3], headToHead[0], headToHead[1]], [[1, 4], [5, 6], 13, 11], [[0, 6], [4, 7], 11, 13], [[1, 4], [0, 5], 12, 12]]);
  const ahead = (n, x, y) => { const s = computeStandings(n); return s.findIndex((r) => r.id === x) < s.findIndex((r) => r.id === y); };
  let n = mkH([13, 11]);     // 0: 13+11+12 = 36, diff +2-2+0 = 0.  1: 11+13+12 = 36, diff -2+2+0 = 0
  const s = computeStandings(n); assert.deepEqual([s.find((r) => r.id === 0).points, s.find((r) => r.id === 1).points], [36, 36]);
  assert.equal(s.find((r) => r.id === 0).diff, s.find((r) => r.id === 1).diff);
  assert.ok(ahead(n, 0, 1), '0 beat 1 head to head: 0 is ahead');
  n = manual([[[1, 2], [0, 3], 13, 11], [[0, 4], [5, 6], 13, 11], [[1, 6], [4, 7], 11, 13], [[1, 4], [0, 5], 12, 12]]);
  assert.ok(ahead(n, 1, 0), '1 beat 0 head to head: 1 is ahead even though P00 sorts first alphabetically');
});
await test('tie-break 4: all else equal, alphabetical (case-insensitive)', () => {
  const n = manual([[[0, 1], [2, 3], 12, 12]]); n.players[0].name = 'zed'; n.players[1].name = 'Amy';
  assert.deepEqual(computeStandings(n).slice(0, 4).map((x) => x.name), ['Amy', 'P02', 'P03', 'zed']);
});
await test('standings are available from the first score and rank numbers run 1..n; progress reports round and completeness', () => {
  const n = exampleNight(); const s = computeStandings(n);
  assert.deepEqual(s.map((x) => x.rank), s.map((_, i) => i + 1)); assert.equal(s.length, 10);
  assert.deepEqual(progress(n), { round: 3, complete: true, total: 5 });
  n.rounds[3].matches[0].a = 10; n.rounds[3].matches[0].b = 14; assert.deepEqual(progress(n), { round: 4, complete: false, total: 5 });
});

console.log('Example night');
await test('example night: ten invented first names, 2 courts, 24 points, 3 rounds scored, in both formats', () => {
  assert.equal(EXAMPLE_NAMES.length, 10); const n = exampleNight();
  assert.deepEqual([n.players.length, n.courts, n.points], [10, 2, 24]);
  assert.ok([0, 1, 2].every((r) => roundComplete(n, r))); assert.ok(!roundComplete(n, 3));
  const m = exampleNight('mexicano'); assert.equal(m.rounds.length, 4); assert.ok([0, 1, 2].every((r) => roundComplete(m, r)));
  assert.ok(isNight(n) && isNight(m));
});

console.log('Share snapshot');
await test('snapshot encode/decode round trip, in the URL hash, for 4 to 24 players', async () => {
  for (const nPlayers of [4, 10, 24]) {
    const night = mk(nPlayers, Math.max(1, Math.floor(nPlayers / 4)), { rounds: 3, title: 'Tuesday padel' });
    night.rounds.forEach((rd, r) => rd.matches.forEach((m, i) => { m.a = 8 + ((r * 3 + i) % 14); m.b = 24 - m.a; }));
    const snap = snapshotFromNight(night, new Date('2026-10-26T20:00:00Z'));
    const token = await encodeSnapshot(snap);
    assert.match(token, /^[cu][A-Za-z0-9_-]+$/); assert.ok(token.length < 3000, `token ${token.length}`);
    const url = snapshotUrl('https://court.sportbuilds.co/', token); assert.equal(tokenFromHash(url.slice(url.indexOf('#'))), token);
    assert.deepEqual(await decodeSnapshot(token), snap);
  }
});
await test('snapshot keeps unusual names intact (accents, apostrophes, emoji) and decoding is strict', async () => {
  const snap = { v: 1, t: 'Café night', f: 'M', p: 21, r: 2, c: 0, n: 6, d: '2026-10-26', s: [['Zoë <b>', 30, 2, 2, 5], ["O'Neil 🎾", 20, 1, 2, -3]] };
  assert.deepEqual(await decodeSnapshot(await encodeSnapshot(snap)), snap);
  for (const bad of ['', 'x', 'cAAAA', 'c!!!', 'u' + 'A'.repeat(7000), 'ubm90anNvbg', 'u' + Buffer.from(JSON.stringify({ v: 2 })).toString('base64url'),
    'u' + Buffer.from(JSON.stringify({ ...snap, s: [['x', '1', 1, 1, 1]] })).toString('base64url'), 'u' + Buffer.from(JSON.stringify({ ...snap, s: [] })).toString('base64url'),
    'u' + Buffer.from(JSON.stringify({ ...snap, t: 'x'.repeat(41) })).toString('base64url')]) await assert.rejects(() => decodeSnapshot(bad), /snapshot|Court Night/, `should reject ${bad.slice(0, 12)}`);
  assert.equal(tokenFromHash('#s=abc"><script>'), null); assert.equal(tokenFromHash('#other'), null);
});
await test('copy-as-text: a tidy table with the round number and a legend', () => {
  const night = exampleNight(); const txt = standingsText(snapshotFromNight(night, new Date('2026-10-26T20:00:00Z')));
  const lines = txt.split('\n');
  assert.equal(lines[0], 'Court Night: Example night'); assert.equal(lines[1], 'Standings after round 3 of 5');
  assert.equal(lines[2], '```'); assert.match(lines[3], /^ #\s+Player\s+Pts\s+W\/P\s+\+\/-$/);
  assert.equal(lines.filter((l) => /^\s?\d+ /.test(l)).length, 10);
  assert.ok(lines.includes('```', 3)); assert.ok(txt.endsWith('2026-10-26'));
  const widths = new Set(lines.slice(3, 14).map((l) => l.length)); assert.equal(widths.size, 1, 'rows line up');
});

console.log('Storage (localStorage on this device only)');
await test('save, load, clear; a damaged or foreign entry is ignored, not trusted', () => {
  const store = new Map(); const ls = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  const night = exampleNight(); assert.equal(saveNight(night, ls), true);
  assert.deepEqual(loadNight(ls), night); assert.deepEqual([...store.keys()], [KEY]);
  clearNight(ls); assert.equal(loadNight(ls), null);
  store.set(KEY, '{not json'); assert.equal(loadNight(ls), null);
  store.set(KEY, JSON.stringify({ v: 1, players: 'x' })); assert.equal(loadNight(ls), null);
  assert.equal(saveNight(night, { setItem() { throw new Error('quota'); } }), false);
});

console.log('Repo guards: CSP, no inline code, no green, forbidden words, nothing external');
const root = new URL('..', import.meta.url).pathname;
const walk = (d, out = []) => { for (const f of readdirSync(d)) { if (['node_modules', '.git', 'dist', '.wrangler'].includes(f)) continue; const p = join(d, f); statSync(p).isDirectory() ? walk(p, out) : out.push(p); } return out; };
const files = walk(root), textFiles = files.filter((f) => /\.(html|css|js|mjs|md|json|txt|toml)$|_headers$|LICENSE$/.test(f) && !f.endsWith('package-lock.json'));
const read = (f) => readFileSync(f, 'utf8');
await test('_headers: strict CSP (script-src self, connect-src none, form-action none, no unsafe-inline), nosniff, no-referrer, no-transform', () => {
  const h = read(join(root, 'cloudflare/_headers'));
  const csp = /Content-Security-Policy: (.*)/.exec(h)[1];
  for (const d of ["default-src 'self'", "script-src 'self'", "style-src 'self'", "connect-src 'none'", "form-action 'none'", "base-uri 'none'", "frame-ancestors 'none'", "object-src 'none'"]) assert.ok(csp.includes(d), d);
  assert.doesNotMatch(csp, /unsafe-|https?:|\*/); assert.match(h, /X-Content-Type-Options: nosniff/); assert.match(h, /Referrer-Policy: no-referrer/); assert.match(h, /no-transform/);
  assert.match(h, /Permissions-Policy: .*camera=\(\)/);
});
await test('index.html: no inline script, no inline style or style attribute, no inline event handlers, no external URLs except the two footer links', () => {
  const html = read(join(root, 'index.html'));
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, 'inline script'); assert.doesNotMatch(html, /<style/i); assert.doesNotMatch(html, /\sstyle\s*=/i); assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
  const urls = [...html.matchAll(/(?:href|src|action)="(https?:[^"]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(urls, ['https://github.com/norris1976/court-night', 'https://nozza.co/']);
  assert.match(html, /<a href="https:\/\/nozza\.co\/" target="_blank" rel="noopener">Nozza\.co<\/a>/); assert.match(html, /Built by Tim @ /);
  assert.match(html, /<a href="https:\/\/github\.com\/norris1976\/court-night"[^>]*rel="noopener"[^>]*>source on GitHub<\/a>/);
  assert.doesNotMatch(html, /<form[^>]*\saction=/i);
});
await test('JS and CSS make no network calls, load nothing external, set no cookies, use only the one storage key', () => {
  for (const f of files.filter((f) => /^src\/|style\.css$/.test(f.slice(root.length)))) {
    const t = read(f);
    assert.doesNotMatch(t, /\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|importScripts|document\.cookie|sessionStorage|indexedDB|@import|https?:\/\//, f);
  }
  const uses = files.filter((f) => f.startsWith(root + 'src/')).filter((f) => /localStorage/.test(read(f))).map((f) => f.slice(root.length));
  assert.deepEqual(uses, ['src/storage.js']);
});
await test('no green anywhere: every colour in CSS, JS and HTML is not in the green hue range', () => {
  const bad = [];
  const hsl = (r, g, b) => { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (!d) return [0, 0, (mx + mn) / 2]; let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h = (h * 60 + 360) % 360; return [h, d / (1 - Math.abs(mx + mn - 1)), (mx + mn) / 2]; };
  for (const f of textFiles.filter((f) => /\.(css|js|mjs|html)$/.test(f) && !f.includes('/test/'))) {
    const t = read(f);
    for (const m of t.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) { let x = m[1]; if (x.length === 3) x = [...x].map((c) => c + c).join(''); const [h, s] = hsl(parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4), 16)); if (h >= 70 && h <= 175 && s > 0.12) bad.push(`${f}: #${m[1]}`); }
    for (const m of t.matchAll(/rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/g)) { const [h, s] = hsl(+m[1], +m[2], +m[3]); if (h >= 70 && h <= 175 && s > 0.12) bad.push(`${f}: ${m[0]}`); }
    assert.doesNotMatch(t, /\b(green|lime|emerald|teal|mint|chartreuse)\b/i, `${f} names a green colour`);
  }
  assert.deepEqual(bad, []);
});
await test('guard: never the phrase vibe-coding in any file; no brand, club, league or employer names in the tool', () => {
  const forbidden = [/vibe/i, /statsports/i, /parkrun/i, /whatsapp/i, /playtomic/i, /padel\s*mates/i, /sliceWin/i, /padelution/i, /americano-padel/i, /world padel tour|premier padel|\bfip\b/i, /excel/i, /nozza\.co\/(?!")/i];
  const self = read(join(root, 'test/run.mjs'));
  for (const f of textFiles) { const t = f.endsWith('test/run.mjs') ? '' : read(f); for (const re of forbidden) if (re.test(t) && !/nozza/i.test(re.source)) assert.fail(`${f.slice(root.length)} matches ${re}`); }
  assert.ok(self.length > 0);
});
await test('sport names are plain: the page says padel, and that it also suits tennis, badminton and pickleball', () => {
  const html = read(join(root, 'index.html')); assert.match(html, /padel/i); assert.match(html, /tennis, badminton and pickleball/i);
});
await test('fonts are self-hosted with their licence, preloaded; title and description are present; no claim of being first or best', () => {
  assert.ok(existsSync(join(root, 'fonts/barlow-condensed-800.woff2')) && existsSync(join(root, 'fonts/inter-var.woff2')) && existsSync(join(root, 'fonts/LICENSE.txt')));
  const html = read(join(root, 'index.html'));
  assert.match(html, /<title>Court Night[^<]*<\/title>/); assert.match(html, /<meta name="description" content="[^"]{60,}">/);
  assert.match(html, /rel="preload" href="fonts\/inter-var\.woff2"/);
  assert.doesNotMatch(html + read(join(root, 'README.md')), /\b(the first|the best|first ever|number one|#1 )\b/i);
});
await test('every input has a label; score inputs use a numeric keypad; viewport allows zoom', () => {
  const app = read(join(root, 'src/app.js')), html = read(join(root, 'index.html'));
  assert.match(app, /inputmode['"]?\s*[:,=]\s*['"]numeric/); assert.doesNotMatch(html, /user-scalable=no|maximum-scale/);
  assert.match(app, /aria-label/); assert.match(read(join(root, 'style.css')), /prefers-reduced-motion/);
});

console.log(`\n${passed} passed${failures.length ? `, ${failures.length} FAILED: ${failures.join('; ')}` : ''}`);
process.exit(failures.length ? 1 : 0);
