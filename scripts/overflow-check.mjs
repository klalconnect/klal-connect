// Nothing is wider than the phone it is being read on.
//
// usage: node scripts/overflow-check.mjs [baseUrl]
//
// A box that runs past the edge of the screen means pinching out to read it and
// pinching back to carry on — which is how someone looking up a phone number
// gives up. This measures, at phone width, whether the page scrolls sideways at
// all and which elements stick out, so the answer is a list of components rather
// than a guess.
//
// Tables, code blocks and the odd deliberate carousel are allowed to be wider
// than the screen inside their own scroller; those show up as scrollable
// ancestors and are reported separately from real overflow.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromePath, debugTarget } from './lib/chrome.mjs';

// CHROME_PATH so these can run somewhere other than a Mac. They were written
// for one laptop, which is why the UI checks never ran in CI — and the UI is
// exactly what the other checks cannot see.
const CHROME = chromePath();
const PORT = 9244;
const BASE = process.argv[2] || 'https://klalconnect.org';
// 390 is an iPhone 14/15, 360 the common Android width, 320 the narrowest
// phone still in use. 320 is included because it is where min-content bugs
// actually show: the bottom bar fitted 390 and 360 and ran off 320.
const WIDTHS = [390, 360, 320];
const ROUTES = ['', 'directory', 'browse', 'feed', 'people', 'companies'];
// Signed-in pages are where the dense rows are — the saved list's four icon
// buttons beside a title, the listing form, settings. A guest sees GuestPrompt
// instead of all of them, so a guest-only sweep reported those pages clean
// while two of them overflowed. Checked on a local stack only, since it signs
// in and saves a listing.
const AUTH_ROUTES = ['saved', 'settings', 'profile', 'messages', 'add'];

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=/tmp/kc-of-${Date.now()}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
process.on('exit', () => { try { chrome.kill('SIGKILL'); } catch {} });

const target = () => debugTarget(PORT, chrome);

const ws = new WebSocket(await target());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0;
const pend = new Map();
ws.onmessage = (m) => {
  const x = JSON.parse(m.data);
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
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result?.value;

await send('Page.enable');
await send('Runtime.enable');

// No backslashes in this expression on purpose.
const MEASURE = `(() => {
  const vw = document.documentElement.clientWidth;
  const pageScrolls = document.documentElement.scrollWidth > vw + 1;
  const out = [];
  const seen = new Set();
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const overhang = Math.round(r.right - vw);
    const startsOff = Math.round(r.left);
    if (overhang < 2 && startsOff > -2) continue;
    // Containers with nothing in them to read. An empty overlay wrapper — the
    // toast viewport is one, and is vendored — can sit a little wide without
    // anything becoming unreadable or the page scrolling. What matters is
    // content pushed off screen, so this keeps the signal on real defects.
    if (!(el.innerText || '').trim() && !el.querySelector('img, svg')) continue;
    // Inside something that scrolls sideways on purpose? Then it is contained.
    let contained = false;
    for (let p = el.parentElement; p; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.overflowX === 'auto' || s.overflowX === 'scroll') { contained = true; break; }
    }
    const cls = (el.getAttribute('class') || '').split(' ').filter(Boolean).slice(0, 4).join('.');
    const key = el.tagName + '.' + cls + ':' + contained;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      tag: el.tagName.toLowerCase(),
      cls,
      width: Math.round(r.width),
      overhang,
      left: startsOff,
      contained,
      text: (el.innerText || '').trim().slice(0, 40).replace(/\\s+/g, ' '),
    });
  }
  return { vw, pageScrolls, out };
})()`;

let fails = 0;
console.log(`\noverflow check against ${BASE}\n`);

for (const width of WIDTHS) {
  console.log(`  ${width}px wide`);
  await send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 2, mobile: true });
  for (const route of ROUTES) {
    await send('Page.navigate', { url: `${BASE}/${route}` });
    await sleep(4000);
    const { vw, pageScrolls, out } = (await ev(MEASURE)) || { out: [] };
    const real = (out || []).filter((o) => !o.contained);
    const bad = pageScrolls || real.length > 0;
    if (bad) fails++;
    const label = `/${route}`.padEnd(12);
    console.log(`    ${bad ? 'FAIL' : 'ok  '} ${label} ${pageScrolls ? 'page scrolls sideways' : 'no sideways scroll'}${real.length ? ` · ${real.length} element(s) past the edge` : ''}`);
    for (const o of real.slice(0, 6)) {
      console.log(`           ${o.tag}${o.cls ? '.' + o.cls : ''}  w=${o.width} overhang=${o.overhang}px${o.text ? `  "${o.text}"` : ''}`);
    }
  }
  console.log('');
}
// --- signed in -----------------------------------------------------------
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE);
if (!LOCAL) {
  console.log(`  info  signed-in pages not measured — ${BASE} is not a local stack.`);
  console.log('        Run against http://localhost:5200 to cover saved, settings, profile,');
  console.log('        messages and the listing form, where the dense rows are.');
} else {
  async function api(method, path, { body, token } = {}) {
    const res = await fetch(`${BASE}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null; try { data = await res.json(); } catch { /* empty */ }
    return { status: res.status, data };
  }

  const email = `overflow${Date.now()}@example.com`;
  const reg = await api('POST', '/auth/register', { body: { email, password: 'password123' } });
  const ver = await api('POST', '/auth/verify-otp', { body: { email, otpCode: reg.data?.dev_code } });
  const token = ver.data?.access_token;

  if (!token) {
    console.log('  FAIL  could not sign in to measure the signed-in pages');
    fails += 1;
  } else {
    await api('PUT', '/auth/me', { token, body: { full_name: 'Avi Overflow' } });
    // A saved listing, so the saved list renders its rows: a long title beside
    // four icon buttons is the densest row in the app and the one that broke.
    const listings = (await api('GET', '/entities/Provider?limit=1', { token })).data || [];
    if (listings[0]) await api('POST', '/functions/toggleCommunityActivity', { token, body: { providerId: listings[0].id, activity: 'save' } });
    // And a listing of their own, so "Manage my listings" renders its rows —
    // a name, a status, two buttons and a completeness ring on one line at
    // 320px, which is the shape that breaks.
    // Adding a listing does not make it yours; the claim the team accepts does.
    const ownListing = await api('POST', '/functions/createListing', { token, body: { name: 'Overflow Check Plumbing and Heating Services', category: 'Home Services', short_description: 'A listing long enough to test the row.', description: 'Measured, not imagined.', city: 'Lakewood', claim_as_owner: true } });
    const ownAdmin = (await api('POST', '/auth/login', { body: { email: 'demo@klal.app', password: 'demo1234' } })).data?.access_token;
    if (ownListing.data?.claim && ownAdmin) await api('POST', '/functions/resolveClaim', { token: ownAdmin, body: { claim_id: ownListing.data.claim.id, approve: true } });
    // The administrator's claim queue, which no sweep had ever opened. Its
    // cards are definition lists of free text a claimant typed.
    const staff = (await api('POST', '/auth/login', { body: { email: 'demo@klal.app', password: 'demo1234' } })).data?.access_token;
    if (staff && listings[0]) {
      await api('POST', '/functions/createClaim', { token, body: { provider_id: listings[0].id, provider_name: listings[0].name, relationship: 'I am the owner of this business', verification_details: 'Our sign, our phone number and our website all say so.' } });
    }

    await send('Page.navigate', { url: `${BASE}/` });
    await sleep(2000);
    await ev(`localStorage.setItem('kc_access_token', ${JSON.stringify(token)})`);

    const routes = [...AUTH_ROUTES, ...(listings[0] ? [`provider/${listings[0].id}`] : [])];
    for (const width of WIDTHS) {
      console.log(`  ${width}px wide, signed in`);
      await send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 2, mobile: true });
      for (const route of routes) {
        await send('Page.navigate', { url: `${BASE}/${route}` });
        await sleep(4000);
        const { vw, pageScrolls, out } = (await ev(MEASURE)) || { out: [] };
        const real = (out || []).filter((o) => !o.contained);
        const bad = pageScrolls || real.length > 0;
        if (bad) fails++;
        console.log(`    ${bad ? 'FAIL' : 'ok  '} ${`/${route}`.slice(0, 24).padEnd(26)} ${pageScrolls ? 'page scrolls sideways' : 'no sideways scroll'}${real.length ? ` · ${real.length} past the edge` : ''}`);
        for (const o of real.slice(0, 5)) {
          console.log(`           ${o.tag}${o.cls ? '.' + o.cls : ''}  w=${o.width} overhang=${o.overhang}px${o.text ? `  "${o.text}"` : ''}`);
        }
      }
      console.log('');
    }

    if (staff) {
      await send('Page.navigate', { url: `${BASE}/` });
      await sleep(1500);
      await ev(`localStorage.setItem('kc_access_token', ${JSON.stringify(staff)})`);
      for (const width of WIDTHS) {
        await send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 2, mobile: true });
        await send('Page.navigate', { url: `${BASE}/admin` });
        await sleep(4000);
        await ev(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('Claim requests'))?.click()`);
        // Queue rows are collapsed to one line; open them so the card is measured.
        await sleep(300);
        await ev(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Expand all')?.click()`);
        await sleep(900);
        const text = (await ev('document.body.innerText')) || '';
        const rendered = text.includes('Filed by') || text.includes('Queue is clear');
        const { pageScrolls, out } = (await ev(MEASURE)) || { out: [] };
        const real = (out || []).filter((x) => !x.contained);
        const bad = pageScrolls || real.length > 0 || !rendered;
        if (bad) fails++;
        console.log(`    ${bad ? 'FAIL' : 'ok  '} ${`/admin at ${width}px`.padEnd(26)} ${!rendered ? 'the claim queue did not render' : pageScrolls ? 'page scrolls sideways' : 'no sideways scroll'}${real.length ? ` · ${real.length} past the edge` : ''}`);
        for (const x of real.slice(0, 5)) {
          console.log(`           ${x.tag}${x.cls ? '.' + x.cls : ''}  w=${x.width} overhang=${x.overhang}px${x.text ? `  "${x.text}"` : ''}`);
        }
      }
      console.log('');
    }
  }
}
await send('Emulation.clearDeviceMetricsOverride');

console.log(fails ? `${fails} page/width combination(s) overflow the screen` : 'nothing overflows the screen');
ws.close();
process.exit(fails ? 1 : 0);
