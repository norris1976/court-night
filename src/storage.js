// The only storage Court Night uses: one localStorage entry holding the current night, on this device. Nothing is sent anywhere.
export const KEY = 'court-night:v1';

export function saveNight(night, store = globalThis.localStorage) {
  try { store.setItem(KEY, JSON.stringify(night)); return true; } catch { return false; }
}
export function loadNight(store = globalThis.localStorage) {
  try {
    const raw = store.getItem(KEY); if (!raw) return null;
    const n = JSON.parse(raw);
    return isNight(n) ? n : null;
  } catch { return null; }
}
export function clearNight(store = globalThis.localStorage) { try { store.removeItem(KEY); return true; } catch { return false; } }

/** Shape check so a damaged or old entry never breaks the page. */
export function isNight(n) {
  const int = Number.isInteger;
  return !!n && n.v === 1 && (n.format === 'americano' || n.format === 'mexicano') && int(n.courts) && int(n.points) && int(n.roundsTotal) && int(n.seed) && int(n.nextId) && typeof n.title === 'string'
    && Array.isArray(n.players) && n.players.every((p) => p && int(p.id) && typeof p.name === 'string' && int(p.from) && (p.to === null || int(p.to)))
    && Array.isArray(n.rounds) && n.rounds.every((rd) => rd && Array.isArray(rd.sitting) && Array.isArray(rd.matches) && rd.matches.every((m) => m && int(m.court) && Array.isArray(m.t1) && m.t1.length === 2 && Array.isArray(m.t2) && m.t2.length === 2
      && (m.a === null || int(m.a)) && (m.b === null || int(m.b))));
}
