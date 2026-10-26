# Court Night

A free, no-account organiser for a social padel night: americano or mexicano. Add the players, say how many courts you have, and it runs the night: who partners and plays whom on which court, who sits out, a score entry for every match and live standings. Built for a phone held courtside, and fine on a laptop. The same format works for tennis, badminton and pickleball social nights.

**Live: https://court.sportbuilds.co** (also at court-night.pages.dev)

Part of **Sport Builds**, one sports app a week, built with AI. Build notes and the honest failure log: [docs/BUILD_LOG.md](docs/BUILD_LOG.md).

## What it does

1. **Setup**: 4 to 24 names (paste a list or add one by one), 1 to 8 courts, points per match (24, 21, 16, 32 or your own number), Americano or Mexicano, and the number of rounds (blank uses a sensible default).
2. **Rounds**: each round shows court-by-court pairings ("Court 1: A and B vs C and D") and who is sitting out. Enter the real points for each side. Typing one side fills in the other as points per match minus the score; both are editable. Impossible scores (above the points per match, not a whole number) are rejected, and scores that do not add up to the points per match are counted but flagged.
3. **Standings** update as you type and are shown beside every round: points won, wins, matches played and points difference.
4. **Fix things**: any earlier score can be corrected. A late arrival or an early leaver re-makes only the rounds that have no scores yet; scored rounds are never changed and a leaver keeps their points.
5. **Share**: a snapshot link (the standings are compressed into the URL hash and open as a clean read-only view), "Copy as text" for a group chat, and a PNG standings card.
6. **Save on this device**: a refresh or an accidental close does not lose the night. "Start a new night" (with a confirm) and "Clear saved night" wipe it.
7. **Example**: "Try an example night" fills ten invented first names, 2 courts and a few rounds of made-up scores.

## How the rotation works

**Americano.** Every round is built by a small search: random pairings from a seeded generator, improved by swapping players between slots, scored by a cost that penalises repeating a partner (weight 30 per repeat, squared), repeating an opponent (weight 8, squared) and playing the same court number again (weight 1). Rounds are made one after another so each round sees what already happened. With 8 players and 2 courts, 7 rounds give every player every other player as a partner exactly once.

**Sit-outs.** When players do not divide into 4 per court, or there are fewer courts than players / 4, the people who sit out are chosen by: fewest sit-outs so far, then most games played, then sat out longest ago, then list order. Nobody sits out twice before everyone has sat once. The default number of rounds is picked so sit-outs come out level when possible.

**Mexicano.** Round 1 is a mixed Americano round. After that each round is made from the standings once the previous round is fully scored: the playing players are ranked, the top four go to court 1, the next four to court 2, and so on. Inside a group of four, the standard split is 1st and 4th against 2nd and 3rd. One of the other two splits is used instead only if it avoids repeating a partnership. Sit-outs use the same fair rule as above.

**Ranking.** Total points won, then wins, then points difference, then head-to-head (among players still level, the points difference in matches between them), then alphabetical.

Measured on a default night (Americano, 24 points; `varietyReport` in `src/schedule.js`):

| Players | Courts | Rounds | Most times with the same partner | Most times against the same opponent | Games per player | Sit-outs per player |
|---|---|---|---|---|---|---|
| 8 | 2 | 7 | 1 | 2 | 7 | 0 |
| 10 | 2 | 5 | 1 | 2 | 4 | 1 |
| 12 | 3 | 7 | 1 | 2 | 7 | 0 |
| 13 | 3 | 7 | 1 | 2 | 6 to 7 | 0 to 1 |
| 16 | 4 | 7 | 1 | 2 | 7 | 0 |
| 20 | 5 | 7 | 1 | 1 | 7 | 0 |
| 24 | 6 | 7 | 1 | 1 | 7 | 0 |

## Privacy: what is stored, and where

- **On your device only.** The current night (names, courts, points, pairings, scores) is saved in this browser's local storage under one key, `court-night:v1`, so a refresh does not lose it. Nothing else is stored. No cookies, no analytics, no account, no server. Nothing is sent anywhere: the page is served with a Content-Security-Policy of `connect-src 'none'`, `script-src 'self'`, `form-action 'none'`, with no inline script or style and no third-party requests (`cloudflare/_headers`).
- **Snapshot links** hold the standings (names, points, wins, games, difference) inside the URL after the `#`. Browsers do not send the part after `#` to the server, but anyone you give the link to can read it, so only share it with people who should see the names. Opening a snapshot saves nothing.
- **All example data is invented.** The example night uses made-up first names and made-up scores.

## Run it

No build step. It is plain HTML, CSS and ES modules, with self-hosted fonts (see `fonts/LICENSE.txt`).

```bash
npm start                 # http://localhost:5175
npm test                  # unit tests and repo guards (node, no dependencies)
npm run screenshots -- http://localhost:5175/ docs/screenshots   # browser checks and screenshots; needs playwright-core and Chrome
npm run build:pages       # copies the site into dist/ with _headers
```

Tests cover the scheduler (equal games when the numbers divide, fair sit-outs, nobody on two courts, partner and opponent variety for 8, 9, 10, 11, 12, 13, 14, 16, 20 and 24 players, the Mexicano pairing rules), standings and tie-breaks, score validation, the snapshot encode and decode round trip, storage, and guards for the CSP, inline code, colours, forbidden words and external requests.

## Possible next step

Live multi-device sync (everyone on their own phone sees the same night) is out of scope for v1, because it needs a server. The snapshot link is the no-server stand-in: share it again after each round.

## Licence

MIT, see [LICENSE](LICENSE). Fonts: Barlow Condensed and Inter, SIL Open Font License (`fonts/LICENSE.txt`).
