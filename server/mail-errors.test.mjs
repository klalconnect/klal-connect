// Sign-up, sign-in and reset never show the mail provider's raw error. Runs
// the app with "real" email against a stand-in for Resend that refuses some
// addresses, so nothing is ever actually sent. Run with `npm test`.
process.env.KC_DEMO_MODE = '1';
process.env.KC_STORE = 'memory';
process.env.KC_EMAIL_DELIVERY = 'real';
process.env.RESEND_API_KEY = 'test-only';
process.env.KC_MAIL_FROM = 'Klal Connect <hello@klalconnect.org>';
process.env.KC_GEOCODER = 'none';
process.env.KC_CENSUS_GEOCODER = '0';
delete process.env.NODE_ENV;

import { suggestEmail, isUndeliverableEmail } from '../src/lib/emailCheck.js';

// Resend refuses "bounce@" addresses with its real 422 shape, and is "down"
// for "down@" ones. Everything else is accepted without leaving the process.
const realFetch = globalThis.fetch;
let sent = 0;
globalThis.fetch = async (url, opts) => {
  if (String(url).startsWith('https://api.resend.com/')) {
    const to = JSON.parse(opts.body).to[0];
    if (to.startsWith('bounce')) return new Response(JSON.stringify({ statusCode: 422, message: 'Invalid `to` field. Please use our testing email address instead of domains like `example.com`.', name: 'validation_error' }), { status: 422 });
    if (to.startsWith('down')) return new Response('upstream connect error', { status: 502 });
    sent++;
    return new Response(JSON.stringify({ id: 'test' }), { status: 200 });
  }
  return realFetch(url, opts);
};

const { default: app } = await import('./app.js');
const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const API = `http://127.0.0.1:${server.address().port}/api`;

let fails = 0;
const ok = (cond, label, extra = '') => { console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${!cond && extra ? ' — ' + extra : ''}`); if (!cond) fails++; };
const post = async (path, body) => {
  const res = await realFetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, data: await res.json().catch(() => null) };
};
const log = console.log; console.log = (...a) => { if (typeof a[0] === 'string' && /^\s*(ok {2}|FAIL)/.test(a[0])) log(...a); };
const errors = []; console.error = (...a) => errors.push(a.join(' ')); console.warn = () => {};
const technical = /Email send failed|Invalid `to`|statusCode|validation_error|upstream|\(\d{3}\)/;

const FRIENDLY = "We couldn't send a verification email to that address. Please check it and try again.";

// ---- refused address -----------------------------------------------------
const refused = await post('/auth/register', { email: 'bounce@klal-test-domain.org', password: 'longenough1' });
ok(refused.status === 422 && refused.data?.error === FRIENDLY, 'refused address gets the plain sentence', JSON.stringify(refused));
ok(errors.some((e) => e.includes('Invalid `to`')), 'provider details are logged on the server');
const again = await post('/auth/register', { email: 'bounce@klal-test-domain.org', password: 'longenough1' });
ok(again.status === 422, 'a refused sign-up leaves no account behind (no "already registered")', JSON.stringify(again));

// ---- reserved domains never reach the provider ---------------------------
const before = sent;
const reserved = await post('/auth/register', { email: 'someone@example.com', password: 'longenough1' });
ok(reserved.status === 422 && reserved.data?.error === FRIENDLY && sent === before, 'example.com is refused before sending', JSON.stringify(reserved));

// ---- provider down -------------------------------------------------------
const down = await post('/auth/register', { email: 'down@klal-test-domain.org', password: 'longenough1' });
ok(down.status === 503 && !technical.test(down.data?.error || ''), 'provider outage gets a plain sentence', JSON.stringify(down));

// ---- reset request -------------------------------------------------------
const good = await post('/auth/register', { email: 'fine@klal-test-domain.org', password: 'longenough1' });
ok(good.status === 201 && good.data?.otp_sent === true, 'a normal address still signs up', JSON.stringify(good));
const login = await post('/auth/login', { email: 'fine@klal-test-domain.org', password: 'longenough1' });
ok(login.status === 403 && !technical.test(login.data?.error || ''), 'unverified login message is plain', JSON.stringify(login));

ok(![refused, again, reserved, down, login].some((r) => technical.test(JSON.stringify(r.data))), 'no response carries provider text');

// ---- typo suggestions ----------------------------------------------------
ok(suggestEmail('Eli@Gmial.com') === 'eli@gmail.com', 'gmial.com suggests gmail.com');
ok(suggestEmail('a@yahoo.con') === 'a@yahoo.com', 'yahoo.con suggests yahoo.com');
ok(suggestEmail('a@shul.con') === 'a@shul.com', 'any .con suggests .com');
ok(suggestEmail('a@gmail.com') === null && suggestEmail('a@company.co.il') === null && suggestEmail('a@x.om') === null, 'real addresses get no suggestion');
ok(isUndeliverableEmail('a@example.com') && isUndeliverableEmail('a@mail.test') && isUndeliverableEmail('a@@b.com') && !isUndeliverableEmail('a@klalconnect.org'), 'undeliverable addresses are spotted');

server.close();
console.log = log;
if (fails) { console.log(`\n${fails} mail error check(s) failed`); process.exit(1); }
console.log('\nmail error checks passed');
process.exit(0);
