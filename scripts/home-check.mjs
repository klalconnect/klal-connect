// The homepage does its job: search first, a community you can choose, and a
// choice that is still there when you come back.
//
// usage: node scripts/home-check.mjs [baseUrl]
//
// Unlike no-login-check this one listens to CDP *events*, not just replies —
// Runtime.exceptionThrown and console errors. A React page that throws during
// render still answers navigation happily, so without these a white screen
// looks identical to a healthy one.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromePath, debugTarget } from './lib/chrome.mjs';

// CHROME_PATH so these can run somewhere other than a Mac. They were written
// for one laptop, which is why the UI checks never ran in CI — and the UI is
// exactly what the other checks cannot see.
const CHROME = chromePath();
const PORT = 9237;
const BASE = process.argv[2] || 'http://localhost:5200';

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=/tmp/kc-home-${Date.now()}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
process.on('exit', () => { try { chrome.kill('SIGKILL'); } catch {} });

const target = () => debugTarget(PORT, chrome);

const ws = new WebSocket(await target());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const pend = new Map();
const pageErrors = [];
const text = (arg) => arg?.value ?? arg?.description ?? '';

ws.onmessage = (m) => {
  const x = JSON.parse(m.data);
  // Events carry no id. These are the ones that matter.
  if (x.method === 'Runtime.exceptionThrown') {
    const d = x.params?.exceptionDetails;
    pageErrors.push(d?.exception?.description || d?.text || 'uncaught exception');
  }
  if (x.method === 'Runtime.consoleAPICalled' && x.params?.type === 'error') {
    pageErrors.push((x.params.args || []).map(text).join(' ').slice(0, 300));
  }
  if (pend.has(x.id)) {
    const { res, rej } = pend.get(x.id);
    pend.delete(x.id);
    x.error ? rej(new Error(x.error.message)) : res(x.result);
  }
};

const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id; pend.set(i, { res, rej });
  ws.send(JSON.stringify({ id: i, method, params }));
});
const ev = async (expression) =>
  (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.value;

await send('Page.enable');
await send('Runtime.enable');

let fails = 0;
const ok = (cond, label, extra = '') => {
  if (!cond) fails++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${label}${extra ? `  ${extra}` : ''}`);
};

const go = async (url) => { await send('Page.navigate', { url }); await sleep(3500); };

console.log(`\nhomepage checks against ${BASE}\n`);
await go(`${BASE}/`);

// --- the page rendered at all -------------------------------------------
const h1 = await ev(`document.querySelector('h1')?.textContent?.trim() || ''`);
// Pinned to the shape, not the words: the headline should name what people
// come here to find, and it has changed once already without this check
// needing to know the exact sentence.
ok(/plumber|gemach|shul/i.test(h1) && h1.length > 20, 'headline says what the site is for', JSON.stringify(h1));
ok(!(await ev(`!!document.querySelector('#root')?.children?.length === false`)), 'root is not empty');

// --- search is above the fold -------------------------------------------
// The whole point of dropping the hero band. Measured, not assumed: on a
// phone-height viewport the search input must be visible without scrolling.
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await sleep(600);
const searchTop = await ev(`(()=>{const i=[...document.querySelectorAll('input')].find(x=>/plumber/i.test(x.placeholder||''));return i?Math.round(i.getBoundingClientRect().top):-1})()`);
ok(searchTop > 0 && searchTop < 844, 'search box is above the fold on a phone', `top=${searchTop}px`);
const goldButton = await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Search');return b?getComputedStyle(b).backgroundColor:''})()`);
ok(/^rgb/.test(goldButton), 'Search button is styled', goldButton);
await send('Emulation.clearDeviceMetricsOverride');
await sleep(400);

// --- quick links ---------------------------------------------------------
const quick = await ev(`[...document.querySelectorAll('a[href*="/browse?q="]')].map(a=>a.textContent.trim())`);
ok(Array.isArray(quick) && quick.length >= 6, 'quick links are present', `${quick?.length} links`);

// Home shows no listing counts: each one measured something slightly
// different and they disagreed with each other and with the results a tap
// opened. The numbers that stay are on the results page itself.
ok(!/\d+ listed/.test(await ev(`document.body.innerText`)), 'no "N listed" counts on Home');
ok(!(quick || []).some((t) => /\d/.test(t)), 'quick links carry no counts', JSON.stringify(quick));

// --- category tiles, with an invitation where a category is empty -------
const tiles = await ev(`[...document.querySelectorAll('a[href*="/browse?category="], a[href*="/add?category="]')].map(a=>a.textContent.trim())`);
const addFirst = (tiles || []).filter((t) => /Add the first/.test(t)).length;
console.log(`  info  ${tiles?.length || 0} category tiles — ${addFirst} inviting the first listing`);
ok((tiles?.length || 0) > 0, 'category tiles rendered');
ok(!(tiles || []).some((t) => /Coming soon/.test(t)), 'no tile promises "coming soon"');

// --- a community can be chosen, and it sticks ---------------------------
const chips = await ev(`(()=>{const l=[...document.querySelectorAll('span')].find(s=>s.textContent.trim()==='Community');return l?[...l.parentElement.querySelectorAll('button')].map(b=>b.textContent.trim()):[]})()`);
ok(Array.isArray(chips) && chips.length > 0, 'community chips are present', JSON.stringify(chips));
ok(!(chips || []).some((t) => /\d/.test(t)), 'community chips carry no counts', JSON.stringify(chips));

// Named explicitly, not left to "no page errors" to catch as a React warning:
// the launch community and the chosen community were deduped against the listed
// cities but not against each other, so picking Boca Raton while it had no
// listings rendered the same chip twice.
const dupeChips = await ev(`(() => {
  const label = [...document.querySelectorAll('span')].find((s) => s.textContent.trim() === 'Community');
  if (!label) return [];
  const names = [...label.parentElement.querySelectorAll('button')].map((b) => b.textContent.replace(/[0-9]+$/, '').trim());
  return names.filter((n, i) => n && names.indexOf(n) !== i);
})()`);
ok((dupeChips || []).length === 0, 'no community is offered twice', JSON.stringify(dupeChips));

let picked = '';
if (chips?.length) {
  picked = await ev(`(()=>{const l=[...document.querySelectorAll('span')].find(s=>s.textContent.trim()==='Community');const b=l.parentElement.querySelectorAll('button')[0];b.click();return b.textContent.trim()})()`);
  await sleep(1200);
  // The label may carry a trailing count; the city is the leading text.
  const city = String(picked || '').replace(/\d+$/, '').trim();
  // Read through URLSearchParams rather than matching the raw string: a space
  // is encoded as "+", which decodeURIComponent does not turn back into a
  // space, so this passed only while the first chip happened to be a
  // single-word city and failed the moment it was "Boca Raton".
  const inUrl = await ev(`new URLSearchParams(location.search).get('community') || ''`);
  const stored = await ev(`localStorage.getItem('kc_community')`);
  ok(inUrl === city, 'choosing a community lands in the URL', JSON.stringify(inUrl));
  ok(stored === city, 'choosing a community is remembered', JSON.stringify(stored));

  // Come back with no query string at all: the choice must survive.
  await go(`${BASE}/`);
  const stillStored = await ev(`localStorage.getItem('kc_community')`);
  const heading = await ev(`(()=>{const h=[...document.querySelectorAll('h2')].find(x=>/Help that serves/.test(x.textContent));return h?h.textContent.trim():''})()`);
  ok(stillStored === city, 'the community survives a fresh visit', JSON.stringify(stillStored));
  ok(heading.includes(city), 'the local section names the remembered community', JSON.stringify(heading));

  // The real test of a persistent community: it has to carry to another page,
  // not merely survive a reload of the one that set it. Arriving at the
  // directory to an empty search box is how a site says it was not listening.
  await go(`${BASE}/directory`);
  const prefilled = await ev(`(()=>{const i=[...document.querySelectorAll('input')].find(x=>/city, neighborhood/i.test(x.placeholder||''));return i?i.value:null})()`);
  ok(prefilled === city, 'the directory search opens on the remembered community', JSON.stringify(prefilled));
}

// --- the phone's bottom bar is what we intend ---------------------------
// Messaging earns a thumb target because it is a place you return to and reply
// from; notifications moved to the header next to settings. Asserted so the
// slot cannot quietly go back to being an alerts sheet.
{
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await go(`${BASE}/`);
  const bar = await ev(`(() => {
    const nav = [...document.querySelectorAll('nav')].filter((n) => getComputedStyle(n).position === 'fixed').pop();
    if (!nav) return null;
    const items = [...nav.querySelectorAll('a, button')].map((el) => ({
      label: (el.innerText || '').trim(),
      href: el.getAttribute('href') || '',
    }));
    return items;
  })()`);
  ok(Array.isArray(bar) && bar.length > 0, 'the phone has a bottom bar', `${bar?.length} items`);
  const last = bar?.[bar.length - 1];
  ok(last?.href === '/messages', 'the bottom-right slot is Messages', JSON.stringify(last));
  ok(!(bar || []).some((i) => /alert/i.test(i.label)), 'the alerts sheet is no longer in the bottom bar');
  await send('Emulation.clearDeviceMetricsOverride');
  await sleep(400);
}

// --- a page does not inherit another page's share card -------------------
// useMetaTags restored only the title, so og:title, og:description and
// og:image went on describing the last listing viewed. Navigating here has to
// be client-side: a full page load would rebuild the head from index.html and
// prove nothing about the cleanup this is checking.
{
  const listingId = await ev(`(async()=>{const r=await fetch('/api/entities/Provider?limit=1');const j=await r.json();return (j[0]&&j[0].id)||''})()`);
  const ogTitle = `document.querySelector('meta[property="og:title"]')?.getAttribute('content') || ''`;
  if (!listingId) {
    console.log('  info  no listings available to check share-card restoration');
  } else {
    await go(`${BASE}/provider/${listingId}`);
    const onListing = await ev(ogTitle);
    ok(!!onListing, 'a listing page sets its own og:title', JSON.stringify(onListing));
    // Client-side navigation away, via the link the page already offers.
    const left = await ev(`(()=>{const a=[...document.querySelectorAll('a')].find(x=>/Back to browse/i.test(x.textContent));if(!a)return false;a.click();return true})()`);
    await sleep(2500);
    if (!left) {
      console.log('  info  no in-page link to navigate away with; skipped');
    } else {
      const afterLeaving = await ev(ogTitle);
      ok(afterLeaving !== onListing, 'leaving the listing drops its og:title',
        `was ${JSON.stringify(onListing)}, now ${JSON.stringify(afterLeaving)}`);
    }
  }
}

// --- nothing threw -------------------------------------------------------
// Vite's dev client and a missing favicon are noise, not defects.
const real = pageErrors.filter((e) => !/favicon|\[vite\]|manifest|sw\.js/i.test(e));
ok(real.length === 0, 'no page errors', real.slice(0, 3).join(' | '));

console.log(fails ? `\n${fails} homepage check(s) failed` : '\nhomepage: all checks passed');
ws.close();
process.exit(fails ? 1 : 0);
