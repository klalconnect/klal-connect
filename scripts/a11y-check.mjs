// Every control a person can operate has a name.
//
// usage: node scripts/a11y-check.mjs [baseUrl]
//
// An icon is not a name. A button whose only content is an SVG is announced as
// just "button" by a screen reader, and a row of them — call, text, share,
// remove — is announced as four identical anonymous controls. This walks the
// pages a visitor can reach without signing in and reports any interactive
// element with no accessible name at all.
//
// The name is computed the way assistive technology does, in order:
// aria-label, aria-labelledby, visible text, title, an image's alt, and for
// form fields the associated <label> or placeholder. Only visible, enabled
// controls count — a hidden menu's buttons are not on screen to be operated.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromePath, debugTarget } from './lib/chrome.mjs';

// CHROME_PATH so these can run somewhere other than a Mac. They were written
// for one laptop, which is why the UI checks never ran in CI — and the UI is
// exactly what the other checks cannot see.
const CHROME = chromePath();
const PORT = 9243;
const BASE = process.argv[2] || 'https://klalconnect.org';
const ROUTES = ['', 'directory', 'browse', 'feed', 'people', 'companies', 'saved', 'jobs'];

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=/tmp/kc-a11y-${Date.now()}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
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

// Deliberately no backslashes in this expression: escaping through a template
// literal into the page has caused more than one wrong result already.
const FIND_UNNAMED = `(() => {
  const named = (el) => {
    const aria = (el.getAttribute('aria-label') || '').trim();
    if (aria) return aria;
    const ref = el.getAttribute('aria-labelledby');
    if (ref) {
      const parts = ref.split(' ').map((x) => document.getElementById(x)).filter(Boolean);
      const text = parts.map((p) => (p.innerText || '').trim()).join(' ').trim();
      if (text) return text;
    }
    const own = (el.innerText || el.textContent || '').trim();
    if (own) return own;
    const title = (el.getAttribute('title') || '').trim();
    if (title) return title;
    const img = el.querySelector('img[alt]');
    if (img && (img.getAttribute('alt') || '').trim()) return img.getAttribute('alt').trim();
    if (el.id) {
      const lab = document.querySelector('label[for="' + el.id + '"]');
      if (lab && (lab.innerText || '').trim()) return lab.innerText.trim();
    }
    const wrapping = el.closest('label');
    if (wrapping && (wrapping.innerText || '').trim()) return wrapping.innerText.trim();
    const ph = (el.getAttribute('placeholder') || '').trim();
    if (ph) return ph;
    const vt = (el.getAttribute('value') || '').trim();
    if (vt && el.tagName === 'INPUT') return vt;
    return '';
  };
  const visible = (el) => {
    if (el.disabled) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
  };
  const describe = (el) => {
    const icon = el.querySelector('svg');
    const cls = (el.getAttribute('class') || '').split(' ').slice(0, 3).join('.');
    const where = (el.closest('section, nav, header, footer, article, aside') || {}).tagName || 'body';
    return el.tagName.toLowerCase() + (cls ? '.' + cls : '') + (icon ? ' [icon-only]' : '') + ' in ' + where;
  };
  const controls = [...document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button]')];
  return controls.filter((el) => visible(el) && !named(el)).map(describe);
})()`;

let total = 0;
console.log(`\naccessible-name check against ${BASE}\n`);

for (const route of ROUTES) {
  await send('Page.navigate', { url: `${BASE}/${route}` });
  await sleep(4000);
  const unnamed = (await ev(FIND_UNNAMED)) || [];
  total += unnamed.length;
  const label = `/${route}`.padEnd(12);
  if (!unnamed.length) {
    console.log(`  ok    ${label} every control has a name`);
  } else {
    console.log(`  FAIL  ${label} ${unnamed.length} unnamed control(s)`);
    // Grouped: the same component repeated down a list is one defect, not ten.
    const counts = unnamed.reduce((a, d) => ({ ...a, [d]: (a[d] || 0) + 1 }), {});
    for (const [d, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
      console.log(`          ${String(n).padStart(3)}×  ${d}`);
    }
  }
}

// --- signed in ------------------------------------------------------------
// The walk above only sees what a guest sees, and a guest gets GuestPrompt
// where the saved list, messages and the listing form would be — so the pages
// with the most icon-only controls were never reached. Passing on guest routes
// alone would have been a reassuring result that checked almost nothing.
//
// This part registers a member and saves a listing, so it runs on a local stack
// only: it must never put test rows in a real directory.
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE);
const AUTH_ROUTES = ['saved', 'messages', 'profile', 'settings', 'add'];

if (!LOCAL) {
  console.log(`\n  info  signed-in pages were not checked — ${BASE} is not a local stack.`);
  console.log('        Run against http://localhost:5200 to cover saved, messages, profile,');
  console.log('        settings and the listing form, which is where icon-only controls live.');
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

  const email = `a11y${Date.now()}@example.com`;
  const reg = await api('POST', '/auth/register', { body: { email, password: 'password123' } });
  const ver = await api('POST', '/auth/verify-otp', { body: { email, otpCode: reg.data?.dev_code } });
  const token = ver.data?.access_token;

  if (!token) {
    console.log('\n  FAIL  could not sign in to check the signed-in pages');
    total += 1;
  } else {
    await api('PUT', '/auth/me', { token, body: { full_name: 'Avi Checker' } });
    // A saved listing, so /saved renders its rows rather than its empty state —
    // those rows are where the unnamed call/text/share/remove controls were.
    const listings = (await api('GET', '/entities/Provider?limit=1', { token })).data || [];
    const saved = listings[0]
      ? await api('POST', '/functions/toggleCommunityActivity', { token, body: { providerId: listings[0].id, activity: 'save' } })
      : { status: 0 };
    console.log(`\nsigned in as a member${listings[0] ? ` with 1 saved listing (${saved.status})` : ''}\n`);

    await send('Page.navigate', { url: `${BASE}/` });
    await sleep(2000);
    await ev(`localStorage.setItem('kc_access_token', ${JSON.stringify(token)})`);

    // A listing of their own and the staff queues: the owner panel's buttons
    // and the claim card's controls were never reached by this sweep.
    // Adding a listing does not make it yours; the claim the team accepts does.
    const ownListing = await api('POST', '/functions/createListing', { token, body: { name: 'A11y Check Plumbing', category: 'Home Services', short_description: 'A listing to render the owner panel.', description: 'Measured, not imagined.', city: 'Lakewood', claim_as_owner: true } });
    const ownAdmin = (await api('POST', '/auth/login', { body: { email: 'demo@klal.app', password: 'demo1234' } })).data?.access_token;
    if (ownListing.data?.claim && ownAdmin) await api('POST', '/functions/resolveClaim', { token: ownAdmin, body: { claim_id: ownListing.data.claim.id, approve: true } });
    const staffTok = (await api('POST', '/auth/login', { body: { email: 'demo@klal.app', password: 'demo1234' } })).data?.access_token;
    if (staffTok && listings[0]) await api('POST', '/functions/createClaim', { token, body: { provider_id: listings[0].id, provider_name: listings[0].name, relationship: 'owner', verification_details: 'Our sign and our phone number say so.' } });
    const routes = [...AUTH_ROUTES, ...(listings[0] ? [`provider/${listings[0].id}`] : [])];
    for (const route of routes) {
      await send('Page.navigate', { url: `${BASE}/${route}` });
      await sleep(4500);
      const unnamed = (await ev(FIND_UNNAMED)) || [];
      total += unnamed.length;
      const label = `/${route}`.slice(0, 26).padEnd(28);
      if (!unnamed.length) {
        console.log(`  ok    ${label} every control has a name`);
      } else {
        console.log(`  FAIL  ${label} ${unnamed.length} unnamed control(s)`);
        const counts = unnamed.reduce((a, d) => ({ ...a, [d]: (a[d] || 0) + 1 }), {});
        for (const [d, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
          console.log(`          ${String(n).padStart(3)}×  ${d}`);
        }
      }
    }

    // The queues, as an administrator. Their controls — Approve / resolve,
    // Reject, the queue switcher — had never been read by this sweep.
    if (staffTok) {
      await send('Page.navigate', { url: `${BASE}/` });
      await sleep(1500);
      await ev(`localStorage.setItem('kc_access_token', ${JSON.stringify(staffTok)})`);
      await send('Page.navigate', { url: `${BASE}/admin` });
      await sleep(4500);
      await ev(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('Claim requests'))?.click()`);
      // Queue rows are collapsed to one line; open them so the card is measured.
      await sleep(300);
      await ev(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Expand all')?.click()`);
      await sleep(900);
      const text = (await ev('document.body.innerText')) || '';
      if (!text.includes('Filed by') && !text.includes('Queue is clear')) {
        total += 1;
        console.log('  FAIL  /admin                      the claim queue did not render, so nothing was read');
      } else {
        const unnamed = (await ev(FIND_UNNAMED)) || [];
        total += unnamed.length;
        if (!unnamed.length) console.log('  ok    /admin (claim queue)        every control has a name');
        else {
          console.log(`  FAIL  /admin (claim queue)        ${unnamed.length} unnamed control(s)`);
          const counts = unnamed.reduce((acc, d) => ({ ...acc, [d]: (acc[d] || 0) + 1 }), {});
          for (const [d, n] of Object.entries(counts).sort((x, y) => y[1] - x[1])) console.log(`          ${String(n).padStart(3)}×  ${d}`);
        }
      }
    }
  }
}

console.log(total ? `\n${total} control(s) a screen reader would announce without a name` : '\naccessible names: all checks passed');
ws.close();
process.exit(total ? 1 : 0);
