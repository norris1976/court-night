// Score validation. Pure. A score is a whole number from 0 to the points per match, or empty.

/** Keep digits only (max 3), return a whole number or null for empty. */
export function parseScoreText(text) {
  const d = String(text ?? '').replace(/\D+/g, '').slice(0, 3);
  return d === '' ? null : Number(d);
}

/** status: 'empty' | 'incomplete' | 'invalid' | 'warn' | 'ok'. `counted` = used in the standings. */
export function validateScores(a, b, points) {
  const bad = (v) => v !== null && (!Number.isInteger(v) || v < 0);
  if (a === null && b === null) return { status: 'empty', counted: false, message: '' };
  if (bad(a) || bad(b)) return { status: 'invalid', counted: false, message: 'Scores must be whole numbers, 0 or more.' };
  if ((a !== null && a > points) || (b !== null && b > points)) return { status: 'invalid', counted: false, message: `A score can't be more than ${points}.` };
  if (a === null || b === null) return { status: 'incomplete', counted: false, message: 'Add the other score. Not counted yet.' };
  if (a + b !== points) return { status: 'warn', counted: true, message: `Scores usually add up to ${points} (these add up to ${a + b}). Counted as entered.` };
  return { status: 'ok', counted: true, message: '' };
}
