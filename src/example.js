// Example night: ten invented first names, two courts, a few rounds of made-up scores.
import { createNight, extendRounds } from './schedule.js';
import { rankOrder } from './standings.js';

export const EXAMPLE_NAMES = ['Alex', 'Sam', 'Jo', 'Priya', 'Marco', 'Lena', 'Tom', 'Aisha', 'Ben', 'Noor'];

export function exampleNight(format = 'americano') {
  const night = createNight({ title: 'Example night', names: EXAMPLE_NAMES, courts: 2, points: 24, format, rounds: 5, seed: 20261026 });
  // Made-up scores, deterministic: the stronger-sounding pairs win a little more often.
  const pattern = [[14, 10], [13, 11], [15, 9], [12, 12], [16, 8], [11, 13], [14, 10], [17, 7]];
  let k = 0;
  for (let r = 0; r < 3; r++) {
    for (const m of night.rounds[r].matches) { const [a, b] = pattern[(k++ + r) % pattern.length]; m.a = a; m.b = b; m.auto = 'b'; }
    if (format === 'mexicano') extendRounds(night, rankOrder(night));
  }
  return night;
}
