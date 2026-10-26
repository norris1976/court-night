// Drives the app in headless Chrome: a full night flow, checks, and the screenshots (example night).
// Usage: node tools/screenshots.mjs <url> [outDir]    Needs playwright-core and Chrome at CHROME_PATH (default /usr/bin/google-chrome).
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const url = process.argv[2] ?? 'http://localhost:5175/';
const out = process.argv[3] ?? 'docs/screenshots';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const origin = new URL(url).origin;
const problems = [], external = [];

async function open(width, height = 900, scale = 2) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  page.on('request', (r) => { if (!r.url().startsWith('data:') && !r.url().startsWith('blob:') && new URL(r.url()).origin !== origin) external.push(r.url()); });
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push('console: ' + m.text()); });
  return { ctx, page };
}
const overflow = (page) => page.evaluate(() => ({ doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  wide: [...document.querySelectorAll('body *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > innerWidth + 1) && !e.closest('.table-wrap, .tabs'); }).map((e) => e.tagName + '.' + e.className).slice(0, 5) }));
const small = (page) => page.evaluate(() => [...document.querySelectorAll('button, input:not([type=radio]), select, .seg span, summary')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.height < 43.5 || r.width < 43.5) && getComputedStyle(e).visibility !== 'hidden'; }).map((e) => `${e.tagName}#${e.id}.${e.className}:${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`));

/* ---- 360px: layout checks through the whole flow ---- */
{
  const { ctx, page } = await open(360, 740);
  await page.goto(url, { waitUntil: 'networkidle' });
  let o = await overflow(page); assert.equal(o.doc, 0, 'no horizontal scroll at 360 (setup)'); assert.deepEqual(o.wide, []);
  assert.deepEqual(await small(page), [], 'tap targets at least 44px (setup)');
  // build a night by hand: paste a list, 13 players, 3 courts, custom points
  await page.fill('#names-in', 'Alex, Sam, Jo\nPriya\nMarco\nLena\nTom\nAisha\nBen\nNoor\nKit\nMia\nRaf');
  await page.click('#add-names');
  assert.equal(await page.locator('#player-list li').count(), 13);
  await page.fill('#names-in', 'alex'); await page.click('#add-names');
  assert.match(await page.textContent('#setup-msg'), /twice|already/i);
  await page.fill('#names-in', '');
  await page.click('#points-seg label:last-child'); await page.fill('#points-custom', '28');
  await page.fill('#title', 'Thursday social');
  await page.click('#setup button.primary');
  await page.waitForSelector('#view-night:not([hidden])');
  assert.equal(await page.textContent('#round-h'), 'Round 1 of 7');
  assert.equal(await page.locator('.match').count(), 3);
  assert.match(await page.textContent('#sitting'), /Sitting out: .+/);
  // quick entry
  const inputs = page.locator('.match input.score');
  assert.equal(await inputs.first().getAttribute('inputmode'), 'numeric');
  await inputs.nth(0).fill('17'); assert.equal(await inputs.nth(1).inputValue(), '11', 'other side auto-fills as 28 - 17');
  await inputs.nth(1).fill(''); await inputs.nth(1).fill('10'); assert.match(await page.locator('.match-msg').first().textContent(), /add up to 28/);
  await inputs.nth(0).fill('30'); assert.match(await page.locator('.match-msg').first().textContent(), /more than 28/);
  await inputs.nth(0).fill('17'); await inputs.nth(1).fill('11');
  await page.locator('.match').nth(1).locator('input.score').first().fill('9');
  await page.locator('.match').nth(2).locator('input.score').first().fill('14');
  assert.equal(await page.locator('#standings tbody tr').count(), 13);
  const top = await page.locator('#standings tbody tr').first().innerText(); assert.match(top, /\d+/);
  o = await overflow(page); assert.equal(o.doc, 0, 'no horizontal scroll at 360 (night)'); assert.deepEqual(o.wide, []);
  assert.deepEqual(await small(page), [], 'tap targets (night)');
  // persistence: reload keeps the night
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await page.locator('#view-night:not([hidden])').count(), 1); assert.equal(await page.textContent('#round-h'), 'Round 2 of 7', 'reopens on the first unfinished round');
  await page.locator('#round-tabs button').first().click(); assert.equal(await page.inputValue('.match input.score'), '17');
  const saved = await page.evaluate(() => Object.keys(localStorage)); assert.deepEqual(saved, ['court-night:v1']);
  assert.equal((await ctx.cookies()).length, 0, 'no cookies');
  // late arrival: from next unscored round
  await page.fill('#late-name', 'Zoe'); await page.click('#late-add');
  assert.match(await page.textContent('#players-msg'), /Zoe/); assert.equal(await page.locator('#players-now li').count(), 14);
  await page.locator('#round-tabs button').first().click(); assert.equal(await page.inputValue('.match input.score'), '17', 'scored round untouched');
  // earlier round score correction
  await page.locator('#round-tabs button').nth(1).click(); assert.equal(await page.textContent('#round-h'), 'Round 2 of 7');
  await page.locator('#round-tabs button').first().click();
  await page.locator('.match input.score').first().fill('20'); assert.equal(await page.locator('.match input.score').nth(1).inputValue(), '8');
  // share
  await page.click('#share-link'); await page.waitForFunction(() => document.getElementById('share-url').value.includes('#s='));
  const link = await page.inputValue('#share-url'); assert.match(await page.textContent('#share-status'), /snapshot|will not change/i);
  await page.click('#share-text-btn');
  const clip = await page.evaluate(() => navigator.clipboard.readText()); assert.match(clip, /Standings after round 1|round 1 of 7/); assert.match(clip, /Thursday social/);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#share-download')]);
  await dl.saveAs(`${out}/_tmp-card.png`); assert.equal(readFileSync(`${out}/_tmp-card.png`).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  // the link opens a clean read-only standings view in a fresh browser context (nothing saved there)
  const other = await open(360, 740); await other.page.goto(link, { waitUntil: 'networkidle' });
  await other.page.waitForSelector('#snap-table tbody tr');
  assert.equal(await other.page.locator('#view-night:not([hidden])').count(), 0); assert.equal(await other.page.locator('#view-setup:not([hidden])').count(), 0);
  assert.equal(await other.page.locator('#snap-table tbody tr').count(), 14); assert.match(await other.page.textContent('#snap-note'), /does not update/);
  o = await overflow(other.page); assert.equal(o.doc, 0, 'no horizontal scroll at 360 (snapshot)');
  assert.deepEqual(await other.page.evaluate(() => Object.keys(localStorage)), [], 'opening a snapshot saves nothing');
  await other.page.goto(url + '#s=cnotavalidtoken', { waitUntil: 'networkidle' });
  assert.match(await other.page.textContent('#snap-sub'), /damaged|not valid|not a Court Night/); await other.ctx.close();
  // new night: cancel keeps, accept wipes but keeps the names
  page.once('dialog', (d) => d.dismiss()); await page.click('#new-night'); assert.equal(await page.locator('#view-night:not([hidden])').count(), 1);
  page.once('dialog', (d) => d.accept()); await page.click('#new-night');
  await page.waitForSelector('#view-setup:not([hidden])'); assert.equal(await page.evaluate(() => localStorage.length), 0); assert.equal(await page.locator('#player-list li').count(), 14);
  page.once('dialog', (d) => d.accept()); await page.reload({ waitUntil: 'networkidle' });
  // mexicano flow with 8 players, one court-pair
  await page.fill('#names-in', 'A1, A2, A3, A4, B1, B2, B3, B4'); await page.click('#add-names');
  await page.click('#format-seg label:nth-child(2)'); await page.fill('#rounds', '3'); await page.click('#setup button.primary');
  await page.waitForSelector('#view-night:not([hidden])');
  assert.equal(await page.locator('#round-tabs button:not([disabled])').count(), 1, 'mexicano makes one round at a time');
  for (let i = 0; i < 2; i++) await page.locator('.match input.score').nth(i * 2).fill(String(14 + i));
  await page.click('#round-actions button.primary'); assert.equal(await page.textContent('#round-h'), 'Round 2 of 3');
  assert.match(await page.textContent('#sitting'), /Nobody sits out/);
  assert.deepEqual(await overflow(page).then((x) => x.doc), 0);
  await ctx.close();
}

/* ---- Screenshots from the example night: desktop 1280 and phone 390 ---- */
for (const [label, width, height] of [['desktop', 1280, 900], ['phone', 390, 844]]) {
  const { ctx, page } = await open(width, height);
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${out}/${label}-1-setup.png` });
  await page.click('#example'); await page.waitForSelector('#view-night:not([hidden])');
  await page.waitForFunction(() => document.fonts.status === 'loaded');
  assert.equal(await page.locator('#standings tbody tr').count(), 10);
  assert.match(await page.textContent('#round-h'), /Round 4 of 5/);
  await page.locator('.match input.score').first().fill('15');   // shows the quick entry
  await page.evaluate(() => scrollTo(0, 0));
  await page.locator('#round-card').screenshot({ path: `${out}/${label}-2-round-score-entry.png` });
  await page.locator('#standings-card').screenshot({ path: `${out}/${label}-3-standings.png` });
  await page.locator('#card').screenshot({ path: `${out}/${label}-4-share-card.png` });
  await page.screenshot({ path: `${out}/${label}-5-full-page.png`, fullPage: true });
  await ctx.close();
}
await browser.close();
try { (await import('node:fs')).unlinkSync(`${out}/_tmp-card.png`); } catch {}
console.log('external requests:', external.length ? external : 'none');
console.log('console problems:', problems.length ? problems : 'none');
assert.equal(external.length, 0); assert.equal(problems.length, 0);
console.log('UI checks passed; screenshots in', out);
