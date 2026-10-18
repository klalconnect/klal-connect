// Text is readable in both themes.
//
// usage: node scripts/contrast-check.mjs [baseUrl]
//
// Contrast is measured the way a reader meets it: the text's computed colour
// against the first ancestor that actually paints a background, judged by WCAG
// AA — 4.5:1 for body text, 3:1 for large or bold text.
//
// This exists because one token serving two roles is easy to miss by eye.
// --brand-teal is dark in light mode and light in dark mode, so white text on
// it measured 5.1 in one theme and 2.79 in the other, and the Sign up button —
// the most important button in the app — failed only for people using dark
// mode. Nothing in the suite would have caught that.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

// CHROME_PATH so these can run somewhere other than a Mac. They were written
// for one laptop, which is why the UI checks never ran in CI — and the UI is
// exactly what the other checks cannot see.
const CHROME = chromePath();
const PORT = 9246;
const BASE = process.argv[2] || 'https://klalconnect.org';
const ROUTES = ['', 'directory', 'browse', 'feed', 'people', 'companies'];

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=/tmp/kc-ct-${Date.now()}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
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

// Only a character class needs escaping here, and it is written so the template
// does not have to carry a backslash at all.
import { CONTRAST } from './lib/contrast-expression.mjs';
import { chromePath, debugTarget } from './lib/chrome.mjs';

let fails = 0;
console.log(`\ncontrast check against ${BASE}\n`);

for (const theme of ['light', 'dark']) {
  console.log(`  ${theme} mode`);
  for (const route of ROUTES) {
    await send('Page.navigate', { url: `${BASE}/${route}` });
    await sleep(4000);
    // The theme is a class on the root element (darkMode: ["class"]), set here
    // directly so the result does not depend on the machine's own preference.
    await ev(`document.documentElement.classList.${theme === 'dark' ? 'add' : 'remove'}('dark')`);
    await sleep(600);
    const bad = (await ev(CONTRAST)) || [];
    fails += bad.length;
    console.log(`    ${bad.length ? 'FAIL' : 'ok  '} /${route.padEnd(11)} ${bad.length ? `${bad.length} below AA` : 'all text meets AA'}`);
    const seen = new Set();
    for (const b of bad) {
      const key = b.cls + b.ratio;
      if (seen.has(key)) continue;
      seen.add(key);
      console.log(`           ${b.ratio}:1 (needs ${b.need})  ${b.cls || '(no class)'}  "${b.text}"`);
    }
  }
  console.log('');
}

// --- signed in -----------------------------------------------------------
// The guest walk above never reaches the pages with the most chrome on them —
// the listing form, settings, the profile editor. A guest sees GuestPrompt
// instead. That is how the add-listing tabs went unmeasured: "List or Claim Your
// Business" was reported unreadable in dark mode while every check here passed.
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE);
const AUTH_ROUTES = ['add', 'settings', 'profile', 'saved', 'messages'];
// Measured as an administrator, separately, because the queues are a page
// somebody uses every day and no sweep had ever opened one. Every time a
// signed-out-only sweep came back clean, a signed-in page turned out to be
// broken — accessible names, then overflow, then dark-mode contrast. The
// claim queue card is the newest markup in the app.
const STAFF_ROUTES = ['admin'];
// Text that must be on the page for the reading to mean anything.
const MARKERS = {
  settings: ['Manage my listings', 'Edit all details'],
  // The card, not just the tab: /admin opens on "Pending listings", so the
  // claim card had to be clicked into view to be measured at all.
  admin: ['Claim requests', 'How to check', 'Filed by'],
};

if (!LOCAL) {
  console.log(`  info  signed-in pages not measured — ${BASE} is not a local stack.`);
} else {
  const api = async (method, path, o = {}) => {
    const r = await fetch(`${BASE}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(o.token ? { Authorization: 'Bearer ' + o.token } : {}) },
      body: o.body ? JSON.stringify(o.body) : undefined,
    });
    let d = null; try { d = await r.json(); } catch { /* empty */ }
    return { status: r.status, data: d };
  };
  // With a listing of their own, so "Manage my listings" renders its panel
  // instead of "You do not have a submitted listing yet" — which is how the
  // whole of that section stayed unmeasured.
  const email = `contrast${Date.now()}@example.com`;
  const reg = await api('POST', '/auth/register', { body: { email, password: 'password123' } });
  const ver = await api('POST', '/auth/verify-otp', { body: { email, otpCode: reg.data?.dev_code } });
  const token = ver.data?.access_token;
  if (!token) {
    console.log('  FAIL  could not sign in to measure the signed-in pages');
    fails += 1;
  } else {
    await send('Page.navigate', { url: `${BASE}/` });
    await sleep(2000);
    await ev(`localStorage.setItem('kc_access_token', ${JSON.stringify(token)})`);
    // Adding a listing does not make it yours; the claim the team accepts does.
    const ownListing = await api('POST', '/functions/createListing', { token, body: { name: 'Contrast Check Listing', category: 'Home Services', short_description: 'A listing to render the owner panel.', description: 'Measured, not imagined.', city: 'Lakewood', tagline: 'Measured in both themes', claim_as_owner: true } });
    const ownAdmin = (await api('POST', '/auth/login', { body: { email: 'demo@klal.app', password: 'demo1234' } })).data?.access_token;
    if (ownListing.data?.claim && ownAdmin) await api('POST', '/functions/resolveClaim', { token: ownAdmin, body: { claim_id: ownListing.data.claim.id, approve: true } });
    for (const theme of ['light', 'dark']) {
      console.log(`  ${theme} mode, signed in`);
      for (const route of AUTH_ROUTES) {
        await send('Page.navigate', { url: `${BASE}/${route}` });
        await sleep(4500);
        await ev(`document.documentElement.classList.${theme === 'dark' ? 'add' : 'remove'}('dark')`);
        await sleep(600);
        const bad = (await ev(CONTRAST)) || [];
        fails += bad.length;
        console.log(`    ${bad.length ? 'FAIL' : 'ok  '} /${route.padEnd(10)} ${bad.length ? `${bad.length} below AA` : 'all text meets AA'}`);
        // A pass over a panel that did not render is the failure mode this
        // whole section exists to prevent, so the markers are checked here.
        if (MARKERS[route]) {
          const text = (await ev('document.body.innerText')) || '';
          const missing = MARKERS[route].filter((m) => !text.includes(m));
          if (missing.length) { fails += 1; console.log(`           FAIL  nothing measured for: ${missing.join(', ')}`); }
        }
        const seen = new Set();
        for (const b of bad) {
          const key = b.cls + b.ratio;
          if (seen.has(key)) continue;
          seen.add(key);
          console.log(`           ${b.ratio}:1 (needs ${b.need})  ${b.cls || '(no class)'}  "${b.text}"`);
        }
      }
      console.log('');
    }
  }
}

if (LOCAL) {
  const api2 = async (method, path, o = {}) => {
    const r = await fetch(`${BASE}/api${path}`, { method, headers: { 'Content-Type': 'application/json', ...(o.token ? { Authorization: 'Bearer ' + o.token } : {}) }, body: o.body ? JSON.stringify(o.body) : undefined });
    let d = null; try { d = await r.json(); } catch { /* empty */ }
    return { status: r.status, data: d };
  };
  const staff = (await api2('POST', '/auth/login', { body: { email: 'demo@klal.app', password: 'demo1234' } })).data?.access_token;
  if (!staff) {
    console.log('  info  staff pages not measured — the demo administrator could not sign in.');
  } else {
    // A pending claim, so the queue has a card to measure rather than
    // "Queue is clear."
    const member = `queue${Date.now()}@example.com`;
    const mreg = await api2('POST', '/auth/register', { body: { email: member, password: 'password123' } });
    const mtok = (await api2('POST', '/auth/verify-otp', { body: { email: member, otpCode: mreg.data?.dev_code } })).data?.access_token;
    // One nobody owns yet: a claim on an owned listing is refused, and the
    // signed-in pass above hands its own listing to its member.
    const target = ((await api2('GET', '/entities/Provider?status=published&limit=50')).data || []).find((p) => !p.owner_id);
    if (mtok && target) {
      await api2('POST', '/functions/createClaim', { token: mtok, body: { provider_id: target.id, provider_name: target.name, relationship: 'I am the owner', verification_details: 'Our sign, our phone number, our website.' } });
    }
    await send('Page.navigate', { url: `${BASE}/` });
    await sleep(1500);
    await ev(`localStorage.setItem('kc_access_token', ${JSON.stringify(staff)})`);
    for (const theme of ['light', 'dark']) {
      console.log(`  ${theme} mode, as staff`);
      for (const route of STAFF_ROUTES) {
        await send('Page.navigate', { url: `${BASE}/${route}` });
        await sleep(4500);
        await ev(`document.documentElement.classList.${theme === 'dark' ? 'add' : 'remove'}('dark')`);
        await sleep(600);
        if (route === 'admin') {
          await ev(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('Claim requests'))?.click()`);
          // Queue rows are collapsed to one line; open them so the card is measured.
          await sleep(300);
          await ev(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Expand all')?.click()`);
          await sleep(900);
        }
        const bad = (await ev(CONTRAST)) || [];
        fails += bad.length;
        console.log(`    ${bad.length ? 'FAIL' : 'ok  '} /${route.padEnd(10)} ${bad.length ? `${bad.length} below AA` : 'all text meets AA'}`);
        // A pass over a panel that did not render is the failure mode this
        // whole section exists to prevent, so the markers are checked here.
        if (MARKERS[route]) {
          const text = (await ev('document.body.innerText')) || '';
          const missing = MARKERS[route].filter((m) => !text.includes(m));
          if (missing.length) { fails += 1; console.log(`           FAIL  nothing measured for: ${missing.join(', ')}`); }
        }
        const seen = new Set();
        for (const b of bad) {
          const key = b.cls + b.ratio;
          if (seen.has(key)) continue;
          seen.add(key);
          console.log(`           ${b.ratio}:1 (needs ${b.need})  ${b.cls || '(no class)'}  "${b.text}"`);
        }
      }
      console.log('');
    }
  }
}

console.log(fails ? `${fails} text node(s) below WCAG AA` : 'contrast: all text meets WCAG AA in both themes');
ws.close();
process.exit(fails ? 1 : 0);
