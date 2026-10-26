// Standings. Rank by total points won, then wins, then points difference, then head-to-head (points difference in
// matches between the tied players only), then alphabetical. Pure.
import { validateScores } from './validate.js';

export function countedMatches(night) {
  const out = [];
  night.rounds.forEach((rd, r) => rd.matches.forEach((m) => { if (validateScores(m.a, m.b, night.points).counted) out.push({ r, m }); }));
  return out;
}

export function computeStandings(night) {
  const rows = new Map(night.players.map((p) => [p.id, { id: p.id, name: p.name, points: 0, wins: 0, draws: 0, losses: 0, played: 0, against: 0, diff: 0, left: p.to !== null }]));
  const cm = countedMatches(night);
  for (const { m } of cm) {
    for (const [team, own, other] of [[m.t1, m.a, m.b], [m.t2, m.b, m.a]]) {
      for (const id of team) {
        const row = rows.get(id); if (!row) continue;
        row.points += own; row.against += other; row.diff += own - other; row.played += 1;
        if (own > other) row.wins += 1; else if (own === other) row.draws += 1; else row.losses += 1;
      }
    }
  }
  const list = [...rows.values()];
  // Head-to-head: for players tied on points, wins and difference, the points difference in matches where they faced each other.
  const key = (x) => `${x.points}|${x.wins}|${x.diff}`;
  const byId = new Map(list.map((x) => [x.id, x]));
  const h2h = new Map(list.map((x) => [x.id, 0]));
  for (const { m } of cm) for (const [team, other, own, oth] of [[m.t1, m.t2, m.a, m.b], [m.t2, m.t1, m.b, m.a]])
    for (const id of team) for (const o of other)
      if (byId.has(id) && byId.has(o) && key(byId.get(id)) === key(byId.get(o))) h2h.set(id, h2h.get(id) + (own - oth));
  const collator = new Intl.Collator('en', { sensitivity: 'base' });
  list.sort((x, y) => y.points - x.points || y.wins - x.wins || y.diff - x.diff || h2h.get(y.id) - h2h.get(x.id) || collator.compare(x.name, y.name) || x.id - y.id);
  list.forEach((x, i) => { x.rank = i + 1; });
  return list;
}
export const rankOrder = (night) => computeStandings(night).map((x) => x.id);

/** How far through the night: the latest round with any counted score, and whether that round is complete. */
export function progress(night) {
  let last = -1;
  night.rounds.forEach((rd, r) => { if (rd.matches.some((m) => validateScores(m.a, m.b, night.points).counted)) last = r; });
  if (last < 0) return { round: 0, complete: false, total: night.roundsTotal };
  const complete = night.rounds[last].matches.every((m) => validateScores(m.a, m.b, night.points).counted);
  return { round: last + 1, complete, total: night.roundsTotal };
}
