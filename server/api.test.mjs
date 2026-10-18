// End-to-end checks of the API's access rules, against the in-memory store.
//
// Boots the Express app in this process on an ephemeral port and drives it
// the way the client does. Every rule in README.md's "Access rules" that has
// bitten once is pinned here: the guest mask, the login verification gate,
// reactions, recipient-only patches, safe creates, personal rows, and the
// read-time shaping of rows. Run with `npm test`.
process.env.KC_DEMO_MODE = '1';
process.env.KC_STORE = 'memory';
process.env.KC_GUEST_READONLY = '1';
process.env.KC_EMAIL_DELIVERY = 'dev';
// Saving a listing looks up its pin; without a provider that is answered
// from the curated towns alone, so the checks never reach the network.
process.env.KC_GEOCODER = 'none';
// The keyless Census lookup for street addresses is a network call too.
// geocode.test.mjs covers it against a recorded response.
process.env.KC_CENSUS_GEOCODER = '0';
delete process.env.NODE_ENV;
// Uploads go to a throwaway directory, not server/uploads: the storage layer
// reads this at import, and a test run must not leave files behind.
import { mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const uploadDir = mkdtempSync(join(tmpdir(), 'kc-test-uploads-'));
process.env.KC_UPLOAD_DIR = uploadDir;

const { default: app } = await import('./app.js');
const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const API = `http://127.0.0.1:${server.address().port}/api`;

let fails = 0;
const ok = (cond, label, extra = '') => { console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${!cond && extra ? ' — ' + extra : ''}`); if (!cond) fails++; };
async function call(method, path, { body, token } = {}) {
  const res = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch { /* empty body */ }
  return { status: res.status, data };
}
// Quiet: the app logs verification codes and the seed; the test output is the assertions.
const log = console.log; console.log = (...a) => { if (typeof a[0] === 'string' && /^\s*(ok {2}|FAIL)/.test(a[0])) log(...a); };
console.warn = () => {};

// ---- guest masking ------------------------------------------------------
const demo = await call('POST', '/auth/demo-session');
const guest = demo.data.access_token;
ok(demo.data.user.guest === true && demo.data.user.full_name === 'Guest', 'guest session is masked', JSON.stringify(demo.data.user));
// Admin writes a "leak" onto the guest row, the way it happened in production.
const admin = (await call('POST', '/auth/login', { body: { email: 'demo@klal.app', password: 'demo1234' } })).data.access_token;
// Adding a listing does not make it yours to edit: only an owner the team has
// accepted may. Most checks below are about what an owner may do, so they
// start from a listing an admin has already handed to whoever added it. The
// path that gets an owner there for real is pinned under "editing a listing".
async function createOwned(token, body) {
  const r = await call('POST', '/functions/createListing', { token, body });
  const id = r.data?.provider?.id;
  if (!id) return r;
  const me = (await call('GET', '/auth/me', { token })).data;
  const handed = await call('PUT', `/entities/Provider/${id}`, { token: admin, body: { owner_id: me.id, claimed: true } });
  return { ...r, data: { ...r.data, provider: handed.data } };
}
const guestId = demo.data.user.id;
const leak = await call('PUT', `/users/${guestId}`, { token: admin, body: { full_name: 'Eli Epstein', phone: '555-0100', headline: 'Real person', bio: 'private', banner_url: 'https://x/y.png' } });
ok(leak.status === 200 && leak.data.full_name === 'Eli Epstein', 'admin can write the guest row (to scrub it)');
const me = await call('GET', '/auth/me', { token: guest });
ok(me.data.full_name === 'Guest' && !me.data.phone && !me.data.bio && !me.data.banner_url, 'guest /auth/me hides whatever is on the row', JSON.stringify(me.data));
const members = await call('GET', '/users', { token: guest });
ok(!members.data.some((u) => u.id === guestId), 'guest absent from members list');
ok(members.data.every((u) => u.phone === undefined), 'members list carries no phone numbers');
const prof = await call('GET', `/users/${guestId}`, { token: guest });
ok(prof.status === 404, 'guest profile route is 404 for non-admins', String(prof.status));
const adminView = await call('GET', `/users/${guestId}`, { token: admin });
ok(adminView.status === 200 && adminView.data.full_name === 'Eli Epstein', 'admin still sees the raw row');
const edit = await call('PUT', '/auth/me', { token: guest, body: { full_name: 'Hacker' } });
ok(edit.status === 403, 'guest cannot edit its profile', JSON.stringify(edit.data));

// ---- registration + login verification gate -----------------------------
const email = `t${Date.now()}@example.com`;
const reg = await call('POST', '/auth/register', { body: { email, password: 'password123' } });
ok(reg.status === 201 && reg.data.otp_sent === true && !reg.data.access_token, 'register sends a code and no session', JSON.stringify(reg.data));
const gated = await call('POST', '/auth/login', { body: { email, password: 'password123' } });
ok(gated.status === 403 && gated.data.verification_required === true && gated.data.dev_code, 'login before verifying is gated with a new code', JSON.stringify(gated.data));
const bad = await call('POST', '/auth/verify-otp', { body: { email, otpCode: '000000' } });
ok(bad.status === 400, 'wrong code rejected');
const ver = await call('POST', '/auth/verify-otp', { body: { email, otpCode: gated.data.dev_code } });
ok(ver.status === 200 && ver.data.access_token, 'right code signs in');
const login2 = await call('POST', '/auth/login', { body: { email, password: 'password123' } });
ok(login2.status === 200 && login2.data.access_token, 'login works once verified');
const userA = login2.data.access_token, idA = login2.data.user.id;

// ---- reactions ------------------------------------------------------------
await call('PUT', '/auth/me', { token: userA, body: { full_name: 'Tester A' } });
const post = (await call('POST', '/functions/createPost', { token: userA, body: { body: 'hello', post_type: 'update' } })).data.post;
ok(post.post_type === 'post', 'update is stored as post', post.post_type);
const emailB = `b${Date.now()}@example.com`;
const regB = await call('POST', '/auth/register', { body: { email: emailB, password: 'password123' } });
const verB = await call('POST', '/auth/verify-otp', { body: { email: emailB, otpCode: regB.data.dev_code } });
const userB = verB.data.access_token, idB = verB.data.user.id;
await call('PUT', '/auth/me', { token: userB, body: { full_name: 'Tester B' } });
let r = await call('POST', '/functions/toggleLike', { token: userB, body: { post_id: post.id, reaction: 'mazel_tov' } });
ok(r.data.liked && r.data.reaction === 'mazel_tov' && r.data.like_count === 1 && r.data.reaction_counts.mazel_tov === 1, 'react mazel tov', JSON.stringify(r.data));
r = await call('POST', '/functions/toggleLike', { token: userB, body: { post_id: post.id, reaction: 'like' } });
ok(r.data.liked && r.data.reaction === 'like' && r.data.like_count === 1 && !r.data.reaction_counts.mazel_tov && r.data.reaction_counts.like === 1, 'change to like keeps count at 1', JSON.stringify(r.data));
r = await call('POST', '/functions/toggleLike', { token: userB, body: { post_id: post.id } });
ok(!r.data.liked && r.data.like_count === 0, 'plain toggle removes it', JSON.stringify(r.data));
r = await call('POST', '/functions/toggleLike', { token: userB, body: { post_id: post.id, reaction: 'bogus' } });
ok(r.status === 400, 'unknown reaction refused');
const notes = await call('GET', '/entities/Notification', { token: userA });
ok(notes.data.filter((n) => n.type === 'like').length === 1, 'author notified once, not on every change', String(notes.data.filter((n) => n.type === 'like').length));
r = await call('POST', '/functions/toggleLike', { token: guest, body: { post_id: post.id } });
ok(r.status === 403 && r.data.guest, 'guest cannot react');

// ---- scheduled posts: the author's alone until their time ----------------
{
  const later = new Date(Date.now() + 2 * 86_400_000).toISOString();
  const made = await call('POST', '/functions/createPost', { token: userA, body: { body: 'scheduled hello', publish_at: later } });
  const sp = made.data?.post;
  ok(made.status === 200 && sp?.publish_at === later, 'a post can be scheduled', JSON.stringify(made.data));
  const seen = async (token) => (await call('GET', '/entities/FeedPost?sort=-created_date', { token })).data.some((p) => p.id === sp.id);
  ok(await seen(userA), 'the author sees their scheduled post in the feed');
  ok(!(await seen(userB)) && !(await seen(guest)) && !(await seen(admin)) && !(await seen(undefined)), 'nobody else sees it, an admin included');
  ok((await call('GET', `/entities/FeedPost/${sp.id}`, { token: userB })).status === 403, 'nor opens it by its link');
  for (const [fn, body] of [['toggleLike', { post_id: sp.id }], ['createComment', { post_id: sp.id, body: 'hi' }], ['repostPost', { post_id: sp.id }], ['toggleSavePost', { post_id: sp.id }]]) {
    const res = await call('POST', `/functions/${fn}`, { token: userB, body });
    ok(res.status === 404, `${fn} on a scheduled post answers as missing`, `${res.status} ${JSON.stringify(res.data)}`);
  }
  const past = await call('POST', '/functions/createPost', { token: userA, body: { body: 'x', publish_at: new Date(Date.now() - 60_000).toISOString() } });
  ok(past.status === 400, 'a time already gone is refused', JSON.stringify(past.data));
  const far = await call('POST', '/functions/createPost', { token: userA, body: { body: 'x', publish_at: new Date(Date.now() + 400 * 86_400_000).toISOString() } });
  ok(far.status === 400, 'more than a year ahead is refused', JSON.stringify(far.data));
  const other = await call('POST', '/functions/updateScheduledPost', { token: userB, body: { post_id: sp.id, body: 'hijack' } });
  ok(other.status === 403, 'only the author can change it', String(other.status));
  const moved = new Date(Date.now() + 3 * 86_400_000).toISOString();
  const edited = await call('POST', '/functions/updateScheduledPost', { token: userA, body: { post_id: sp.id, body: 'edited hello', publish_at: moved } });
  ok(edited.status === 200 && edited.data.post.body === 'edited hello' && edited.data.post.publish_at === moved, 'the author can change its words and time', JSON.stringify(edited.data));
  const direct = await call('PUT', `/entities/FeedPost/${sp.id}`, { token: userA, body: { publish_at: new Date().toISOString() } });
  ok(direct.status === 403, 'the time cannot be set around the checks', String(direct.status));
  const now = await call('POST', '/functions/updateScheduledPost', { token: userA, body: { post_id: sp.id, post_now: true } });
  ok(now.status === 200 && Date.parse(now.data.post.publish_at) <= Date.now(), 'Post now puts it live', JSON.stringify(now.data));
  ok(await seen(userB), 'once live, everyone sees it');
  const feed = (await call('GET', '/entities/FeedPost?sort=-created_date', { token: userB })).data;
  ok(feed[0]?.id === sp.id, 'and it sits at the top, by when it went live', feed[0]?.id);
  const again = await call('POST', '/functions/updateScheduledPost', { token: userA, body: { post_id: sp.id, body: 'too late' } });
  ok(again.status === 400, 'a live post is no longer a scheduled one to edit', JSON.stringify(again.data));
  // Nothing goes live on Shabbos. A member in New York, the coming Saturday at noon there.
  const emailS = `s${Date.now()}@example.com`;
  const regS = await call('POST', '/auth/register', { body: { email: emailS, password: 'password123' } });
  const userS = (await call('POST', '/auth/verify-otp', { body: { email: emailS, otpCode: regS.data.dev_code } })).data.access_token;
  await call('PUT', '/auth/me', { token: userS, body: { latitude: 40.7128, longitude: -74.006, timezone: 'America/New_York', city: 'New York' } });
  const sat = new Date(); sat.setUTCDate(sat.getUTCDate() + ((6 - sat.getUTCDay() + 7) % 7 || 7)); sat.setUTCHours(16, 0, 0, 0);
  const shab = await call('POST', '/functions/createPost', { token: userS, body: { body: 'x', publish_at: sat.toISOString() } });
  // (423 if the run itself happens on Shabbos in New York: refused either way.)
  ok([400, 423].includes(shab.status) && /Shabbos/.test(shab.data?.error || ''), 'a time on Shabbos is refused', `${sat.toISOString()} ${JSON.stringify(shab.data)}`);
}

// ---- messages: read receipt + reaction -----------------------------------
const emailC0 = `c0${Date.now()}@example.com`;
const regC0 = await call('POST', '/auth/register', { body: { email: emailC0, password: 'password123' } });
const userC0 = (await call('POST', '/auth/verify-otp', { body: { email: emailC0, otpCode: regC0.data.dev_code } })).data.access_token;
const conn = (await call('POST', '/entities/Connection', { token: userA, body: { requester_id: idA, recipient_id: idB, status: 'pending' } })).data;
let acc = await call('PUT', `/entities/Connection/${conn.id}`, { token: userC0, body: { status: 'accepted' } });
ok(acc.status === 403, 'a third party cannot accept someone else\'s request', String(acc.status));
acc = await call('PUT', `/entities/Connection/${conn.id}`, { token: userB, body: { status: 'accepted', requester_id: 'spoof' } });
ok(acc.status === 200 && acc.data.status === 'accepted' && acc.data.requester_id === idA, 'recipient accepts; other fields untouched', JSON.stringify(acc.data));
acc = await call('PUT', `/entities/Connection/${conn.id}`, { token: userB, body: { status: 'blocked' } });
ok(acc.status === 403, 'recipient cannot set an arbitrary status', String(acc.status));
const sent = await call('POST', '/functions/sendMessage', { token: userA, body: { recipient_id: idB, body: 'hi B' } });
const msg = sent.data?.message;
ok(!!msg?.id, 'message sent', JSON.stringify(sent.data));
let rr = await call('PUT', `/entities/Message/${msg.id}`, { token: userB, body: { read: true, body: 'tampered' } });
ok(rr.status === 200 && rr.data.read === true && rr.data.body === 'hi B', 'recipient marks read; body untouched', JSON.stringify(rr.data));
rr = await call('PUT', `/entities/Message/${msg.id}`, { token: userA, body: { body: 'edited' } });
ok(rr.status === 403, 'sender cannot edit a message', String(rr.status));
const emailC = `c${Date.now()}@example.com`;
const regC = await call('POST', '/auth/register', { body: { email: emailC, password: 'password123' } });
const verC = await call('POST', '/auth/verify-otp', { body: { email: emailC, otpCode: regC.data.dev_code } });
const userC = verC.data.access_token, idC = verC.data.user.id;
rr = await call('PUT', `/entities/Message/${msg.id}`, { token: userC, body: { read: true } });
ok(rr.status === 403, 'a stranger cannot touch the message', String(rr.status));
let mr = await call('POST', '/functions/reactToMessage', { token: userB, body: { message_id: msg.id, reaction: 'thanks' } });
ok(mr.status === 200 && mr.data.message.reactions[idB] === 'thanks', 'recipient reacts to a message', JSON.stringify(mr.data));
mr = await call('POST', '/functions/reactToMessage', { token: userA, body: { message_id: msg.id, reaction: 'love' } });
ok(mr.status === 200 && mr.data.message.reactions[idA] === 'love' && mr.data.message.reactions[idB] === 'thanks', 'sender reacts too; both kept');
mr = await call('POST', '/functions/reactToMessage', { token: userB, body: { message_id: msg.id, reaction: 'thanks' } });
ok(mr.status === 200 && !mr.data.message.reactions[idB], 'same reaction again removes it');
mr = await call('POST', '/functions/reactToMessage', { token: userC, body: { message_id: msg.id, reaction: 'like' } });
ok(mr.status === 403, 'stranger cannot react to a message', String(mr.status));


// ---- second review round ------------------------------------------------
// Forged creates
let forged = await call('POST', '/entities/Connection', { token: userC, body: { requester_id: 'someone-else', recipient_id: idA, status: 'accepted', created_by_id: idB, id: 'chosen-id' } });
ok(forged.status === 201 && forged.data.status === 'pending' && forged.data.requester_id !== 'someone-else' && forged.data.created_by_id !== idB && forged.data.id !== 'chosen-id', 'connection create: status pinned to pending, creator and id not forgeable', JSON.stringify(forged.data));
forged = await call('POST', '/entities/Connection', { token: userC, body: { recipient_id: guestId } });
ok(forged.status === 400, 'no connection requests to the guest', String(forged.status));
forged = await call('POST', '/entities/Provider', { token: userC, body: { name: 'Sneaky', category: 'x', status: 'published', verified: true } });
ok(forged.status === 201 && forged.data.status === 'pending' && !forged.data.verified, 'direct listing create goes to review, unverified', JSON.stringify(forged.data));
forged = await call('POST', '/entities/Category', { token: userC, body: { name: 'Junk' } });
ok(forged.status === 403, 'members cannot create categories', String(forged.status));
// view_count only for the author
const listA = await call('GET', '/entities/FeedPost', { token: userA });
const listB = await call('GET', '/entities/FeedPost', { token: userB });
const pa = listA.data.find((p) => p.id === post.id), pb = listB.data.find((p) => p.id === post.id);
ok(pa && 'view_count' in pa, 'author sees view_count');
ok(pb && !('view_count' in pb), 'others do not see view_count', JSON.stringify(Object.keys(pb || {})));
const one = await call('GET', `/entities/FeedPost/${post.id}`, { token: userB });
ok(!('view_count' in (one.data || {})), 'single-row read also drops view_count');
const rv = await call('POST', '/functions/recordPostView', { token: userB, body: { postId: post.id } });
ok(rv.status === 200 && rv.data.count === undefined, 'recordPostView returns no count', JSON.stringify(rv.data));
// Private analytics: profile views counted once a day per viewer, numbers only
await call('POST', '/functions/recordProfileView', { token: userB, body: { userId: idA } });
await call('POST', '/functions/recordProfileView', { token: userB, body: { userId: idA } });
await call('POST', '/functions/recordProfileView', { token: userC, body: { userId: idA } });
await call('POST', '/functions/recordProfileView', { token: userA, body: { userId: idA } });
await call('POST', '/functions/recordProfileView', { token: guest, body: { userId: idA } });
const an = await call('POST', '/functions/myAnalytics', { token: userA, body: { days: 7, tzOffset: 300 } });
ok(an.status === 200 && an.data.totals.profile_views.count === 2, 'profile views: once per viewer per day, not your own, not the guest', JSON.stringify(an.data?.totals));
ok(an.data.totals.impressions.count >= 1 && an.data.buckets.length === 7 && an.data.top_posts.some((p) => p.id === post.id), 'post views reach the author\'s analytics', JSON.stringify(an.data));
ok(!JSON.stringify(an.data).includes(idB), 'analytics never names a viewer');
const an90 = await call('POST', '/functions/myAnalytics', { token: userA, body: { days: 90 } });
ok(an90.data.days === 90 && an90.data.buckets.length >= 13 && an90.data.buckets.length <= 14, '90 days come in weekly bars', String(an90.data.buckets.length));
const anB = await call('POST', '/functions/myAnalytics', { token: userB, body: { days: 30 } });
ok(anB.data.totals.profile_views.count === 0, 'nobody else\'s views land in your box');
const evs = await call('GET', '/entities/ActivityEvent', { token: userA });
ok(!evs.data.some((e) => e.type === 'member_profile_view' && e.created_by_id !== idA), 'the profile owner cannot list who viewed them');
const forgedView = await call('POST', '/entities/ActivityEvent', { token: userC, body: { type: 'member_profile_view', target_id: idA } });
ok(forgedView.status === 400, 'profile views cannot be written directly', String(forgedView.status));
const anG = await call('POST', '/functions/myAnalytics', { token: guest, body: {} });
ok(anG.status === 403, 'the guest has no analytics', String(anG.status));
// Rows the guest wrote earlier read as Guest
const tainted = await call('POST', '/entities/FeedPost', { token: admin, body: { body: 'old guest post', post_type: 'post', author_name: 'Eli Epstein', author_headline: 'Real headline', author_avatar_url: 'https://x/e.png', created_by: 'guest@klal.app', created_by_id: guestId } });
ok(tainted.status === 201, 'admin planted a guest-authored row for the test');
const readBack = (await call('GET', `/entities/FeedPost/${tainted.data.id}`, { token: userB })).data;
ok(readBack.author_name === 'Guest' && readBack.author_headline !== 'Real headline' && !readBack.author_avatar_url, 'guest-authored post reads as Guest', JSON.stringify({ n: readBack.author_name, h: readBack.author_headline }));
const listG = (await call('GET', '/entities/FeedPost', { token: guest })).data.find((p) => p.id === tainted.data.id);
ok(listG.author_name === 'Guest', 'also in the list, also for the guest itself');
// guest reads no private rows; nobody can message the guest
const gm = await call('GET', '/entities/Message', { token: guest });
ok(gm.status === 200 && gm.data.length === 0, 'guest reads no messages');
const gn = await call('GET', '/entities/Notification', { token: guest });
ok(gn.status === 200 && gn.data.length === 0, 'guest reads no notifications');
const toGuest = await call('POST', '/functions/sendMessage', { token: admin, body: { recipient_id: guestId, body: 'hi guest' } });
ok(toGuest.status === 400, 'nobody can message the guest', JSON.stringify(toGuest.data));
// reactions: prototype keys refused, notification dedupe
r = await call('POST', '/functions/toggleLike', { token: userB, body: { post_id: post.id, reaction: 'constructor' } });
ok(r.status === 400, 'prototype-key reaction refused', String(r.status));
r = await call('POST', '/functions/toggleLike', { token: userB, body: { post_id: post.id, reaction: 'like' } });
r = await call('POST', '/functions/toggleLike', { token: userB, body: { post_id: post.id, reaction: 'like' } });
r = await call('POST', '/functions/toggleLike', { token: userB, body: { post_id: post.id, reaction: 'love' } });
const notes2 = await call('GET', '/entities/Notification', { token: userA });
ok(notes2.data.filter((n) => n.type === 'like' && n.target_id === post.id).length === 1, 'like → unlike → love still one notification', String(notes2.data.filter((n) => n.type === 'like').length));
// admin can mark verified
const emailD = `d${Date.now()}@example.com`;
await call('POST', '/auth/register', { body: { email: emailD, password: 'password123' } });
const allUsers = (await call('GET', '/users', { token: admin })).data;
const dRow = allUsers.find((u) => u.email === emailD);
ok(dRow && dRow.verified === false, 'fresh registration is unverified while mail is on');
const mark = await call('PUT', `/users/${dRow.id}`, { token: admin, body: { verified: true } });
ok(mark.status === 200 && mark.data.verified === true, 'admin marks verified');
const dLogin = await call('POST', '/auth/login', { body: { email: emailD, password: 'password123' } });
ok(dLogin.status === 200 && dLogin.data.access_token, 'and that account logs straight in');


// guest's seeded connections are invisible to members (the seed connects the guest to everyone)
const connsAsMember = (await call('GET', '/entities/Connection', { token: userB })).data;
ok(connsAsMember.every((c) => c.requester_id !== guestId && c.recipient_id !== guestId) && connsAsMember.length > 0, 'members never see connections involving the guest', String(connsAsMember.length));
const connsAsAdmin = (await call('GET', '/entities/Connection', { token: admin })).data;
ok(connsAsAdmin.length > 0 && connsAsAdmin.every((c) => c.requester_id !== guestId && c.recipient_id !== guestId), 'admin does not see the seeded guest connections either');


// ---- payment links: an external doorway, never Klal-handled money ---------
// A listing/company owner can paste a Stripe Payment Link, PayPal.me, Venmo
// or Zelle URL; it must be a real http(s) link (never javascript:) and only
// the owner or an admin can set it.
const payEmail = `pay${Date.now()}@example.com`;
const payReg = await call('POST', '/auth/register', { body: { email: payEmail, password: 'password123' } });
const payVer = await call('POST', '/auth/verify-otp', { body: { email: payEmail, otpCode: payReg.data.dev_code } });
const payTok = payVer.data.access_token;
const payListing = await createOwned(payTok, { name: 'Pay Test Biz', category: 'Food', short_description: 'x' });
const payProviderId = payListing.data.provider.id;

let payR = await call('POST', '/functions/updateListingPaymentLink', { token: payTok, body: { provider_id: payProviderId, payment_link_url: 'javascript:alert(1)' } });
ok(payR.status === 400, 'a javascript: payment link is refused');
payR = await call('POST', '/functions/updateListingPaymentLink', { token: payTok, body: { provider_id: payProviderId, payment_link_url: 'https://buy.stripe.com/test_abc' } });
ok(payR.status === 200 && payR.data.provider.payment_link_url === 'https://buy.stripe.com/test_abc', 'a real payment link saves');
payR = await call('POST', '/functions/updateListingPaymentLink', { token: userB, body: { provider_id: payProviderId, payment_link_url: 'https://venmo.com/u/someone' } });
ok(payR.status === 403, 'a non-owner cannot set another listing\'s payment link');
const payCompany = await call('POST', '/entities/Company', { token: payTok, body: { name: 'Pay Test Co', payment_link_url: 'javascript:x()' } });
ok(payCompany.status === 400, 'creating a company with a javascript: payment link is refused');
const payCompanyOk = await call('POST', '/entities/Company', { token: payTok, body: { name: 'Pay Test Co' } });
const payCompanyPatch = await call('PUT', `/entities/Company/${payCompanyOk.data.id}`, { token: payTok, body: { payment_link_url: 'https://paypal.me/paytestco' } });
ok(payCompanyPatch.status === 200 && payCompanyPatch.data.payment_link_url === 'https://paypal.me/paytestco', 'a company\'s payment link can be set through the generic PUT route');
const payClick = await call('POST', '/entities/ActivityEvent', { token: payTok, body: { type: 'payment_link_click', provider_id: payProviderId } });
ok(payClick.status === 201, 'a payment_link_click event is recorded');


// ---- skills & endorsements -------------------------------------------------
const skillOwnerEmail = `skillowner${Date.now()}@example.com`;
const skillOwnerReg = await call('POST', '/auth/register', { body: { email: skillOwnerEmail, password: 'password123' } });
const skillOwnerTok = (await call('POST', '/auth/verify-otp', { body: { email: skillOwnerEmail, otpCode: skillOwnerReg.data.dev_code } })).data.access_token;
const skillOwnerId = (await call('GET', '/auth/me', { token: skillOwnerTok })).data.id;

const dupeSkills = await call('PUT', '/auth/me', { token: skillOwnerTok, body: { skills: ['Bookkeeping', 'bookkeeping', '  Excel  ', ''] } });
ok(JSON.stringify(dupeSkills.data.skills) === JSON.stringify(['Bookkeeping', 'Excel']), 'skills are trimmed and case-insensitively de-duplicated', JSON.stringify(dupeSkills.data.skills));

const selfEndorse = await call('POST', '/functions/toggleSkillEndorsement', { token: skillOwnerTok, body: { user_id: skillOwnerId, skill: 'Excel' } });
ok(selfEndorse.status === 400, 'cannot endorse your own skill');

const unlistedEndorse = await call('POST', '/functions/toggleSkillEndorsement', { token: userB, body: { user_id: skillOwnerId, skill: 'Welding' } });
ok(unlistedEndorse.status === 400, 'cannot endorse a skill they did not list');

let endorseR = await call('POST', '/functions/toggleSkillEndorsement', { token: userB, body: { user_id: skillOwnerId, skill: 'excel' } });
ok(endorseR.status === 200 && endorseR.data.endorsed === true && endorseR.data.count === 1, 'endorsement is case-insensitive and counts', JSON.stringify(endorseR.data));

const endorseAgain = await call('POST', '/functions/toggleSkillEndorsement', { token: userB, body: { user_id: skillOwnerId, skill: 'Excel' } });
ok(endorseAgain.status === 200 && endorseAgain.data.endorsed === false && endorseAgain.data.count === 0, 'endorsing again removes it (toggle)', JSON.stringify(endorseAgain.data));

await call('POST', '/functions/toggleSkillEndorsement', { token: userB, body: { user_id: skillOwnerId, skill: 'Excel' } });
const endorsementsPublic = await call('GET', `/entities/SkillEndorsement?query=${encodeURIComponent(JSON.stringify({ user_id: skillOwnerId }))}`);
ok(endorsementsPublic.status === 200 && endorsementsPublic.data.length === 1, 'endorsements are readable without auth, like a vouch count', JSON.stringify(endorsementsPublic.data));

const skillGuestEndorse = await call('POST', '/functions/toggleSkillEndorsement', { token: guest, body: { user_id: skillOwnerId, skill: 'Excel' } });
ok(skillGuestEndorse.status === 403, 'the shared guest cannot endorse');


// ---- recommendations: written testimonials, subject approves before it's public ----
const recSubjEmail = `recsubject${Date.now()}@example.com`;
const recSubjReg = await call('POST', '/auth/register', { body: { email: recSubjEmail, password: 'password123' } });
const recSubjTok = (await call('POST', '/auth/verify-otp', { body: { email: recSubjEmail, otpCode: recSubjReg.data.dev_code } })).data.access_token;
const recSubjId = (await call('GET', '/auth/me', { token: recSubjTok })).data.id;

const selfRec = await call('POST', '/entities/Recommendation', { token: recSubjTok, body: { recipient_id: recSubjId, body: 'x'.repeat(30) } });
ok(selfRec.status === 400, 'cannot recommend yourself');

const shortRec = await call('POST', '/entities/Recommendation', { token: userB, body: { recipient_id: recSubjId, body: 'too short' } });
ok(shortRec.status === 400, 'a recommendation under 20 characters is refused');

const recCreate = await call('POST', '/entities/Recommendation', { token: userB, body: { recipient_id: recSubjId, body: 'Worked with them for two years — reliable, thorough, and easy to reach.' } });
ok(recCreate.status === 201 && recCreate.data.status === 'pending', 'a recommendation starts pending, whatever status was sent', JSON.stringify(recCreate.data));
const recId = recCreate.data.id;

const recPublicBeforeAccept = await call('GET', `/entities/Recommendation?query=${encodeURIComponent(JSON.stringify({ recipient_id: recSubjId }))}`);
ok(recPublicBeforeAccept.status === 200 && recPublicBeforeAccept.data.length === 0, 'a pending recommendation is invisible to the public', JSON.stringify(recPublicBeforeAccept.data));

const recVisibleToSubject = await call('GET', `/entities/Recommendation?query=${encodeURIComponent(JSON.stringify({ recipient_id: recSubjId }))}`, { token: recSubjTok });
ok(recVisibleToSubject.status === 200 && recVisibleToSubject.data.length === 1, 'the pending recommendation is visible to its subject', JSON.stringify(recVisibleToSubject.data));

const recAuthorEdit = await call('PUT', `/entities/Recommendation/${recId}`, { token: userB, body: { status: 'accepted' } });
ok(recAuthorEdit.status === 200 && recAuthorEdit.data.status === 'pending', 'the author cannot accept their own recommendation on the subject\'s behalf', JSON.stringify(recAuthorEdit.data));

const recAccept = await call('PUT', `/entities/Recommendation/${recId}`, { token: recSubjTok, body: { status: 'accepted', body: 'rewritten by the subject' } });
ok(recAccept.status === 200 && recAccept.data.status === 'accepted' && recAccept.data.body !== 'rewritten by the subject', 'the subject can only change status, not the wording', JSON.stringify(recAccept.data));

const recPublicAfterAccept = await call('GET', `/entities/Recommendation?query=${encodeURIComponent(JSON.stringify({ recipient_id: recSubjId }))}`);
ok(recPublicAfterAccept.status === 200 && recPublicAfterAccept.data.length === 1, 'an accepted recommendation is publicly visible, like a vouch');


// ---- jobs: post, browse, apply, and the messaging door it opens -----------
const posterEmail = `poster${Date.now()}@example.com`;
const posterReg = await call('POST', '/auth/register', { body: { email: posterEmail, password: 'password123' } });
const posterTok = (await call('POST', '/auth/verify-otp', { body: { email: posterEmail, otpCode: posterReg.data.dev_code } })).data.access_token;
const posterId = (await call('GET', '/auth/me', { token: posterTok })).data.id;

const shortJob = await call('POST', '/functions/createJob', { token: posterTok, body: { title: 'Bookkeeper', category: 'Business', description: 'too short' } });
ok(shortJob.status === 400, 'a job description under 30 characters is refused');

const jobR = await call('POST', '/functions/createJob', { token: posterTok, body: { title: 'Part-time bookkeeper', category: 'Business', employment_type: 'part_time', location: 'Lakewood, NJ', description: 'Looking for a detail-oriented bookkeeper for a growing local business, a few hours a week.' } });
ok(jobR.status === 200 && jobR.data.job.status === 'published' && jobR.data.job.open === true, 'a job posts published and open', JSON.stringify(jobR.data));
const jobId = jobR.data.job.id;

const jobPublic = await call('GET', `/entities/Job?query=${encodeURIComponent(JSON.stringify({ status: 'published' }))}`);
ok(jobPublic.status === 200 && jobPublic.data.some((j) => j.id === jobId), 'a published job is publicly browsable without auth');

const selfApply = await call('POST', '/functions/applyToJob', { token: posterTok, body: { job_id: jobId, note: 'hi' } });
ok(selfApply.status === 400, 'a poster cannot apply to their own job');

const cantMessageYet = await call('POST', '/functions/sendMessage', { token: userB, body: { recipient_id: posterId, body: 'hello' } });
ok(cantMessageYet.status === 403, 'a stranger cannot message the poster before applying');

const applyR = await call('POST', '/functions/applyToJob', { token: userB, body: { job_id: jobId, note: 'I have three years of bookkeeping experience.' } });
ok(applyR.status === 200 && applyR.data.application.poster_id === posterId, 'applying creates an application addressed to the poster', JSON.stringify(applyR.data));

const dupeApply = await call('POST', '/functions/applyToJob', { token: userB, body: { job_id: jobId, note: 'again' } });
ok(dupeApply.status === 400, 'cannot apply twice to the same job');

const nowCanMessage = await call('POST', '/functions/sendMessage', { token: userB, body: { recipient_id: posterId, body: 'Following up on my application' } });
ok(nowCanMessage.status === 200, 'applying opens a messaging door to the poster, like an accepted connection');
const posterCanReply = await call('POST', '/functions/sendMessage', { token: posterTok, body: { recipient_id: idB, body: 'Thanks for applying!' } });
ok(posterCanReply.status === 200, 'and the poster can message the applicant back');

const appsAsPoster = await call('GET', `/entities/JobApplication?query=${encodeURIComponent(JSON.stringify({ job_id: jobId }))}`, { token: posterTok });
ok(appsAsPoster.status === 200 && appsAsPoster.data.length === 1, 'the poster sees applications to their job');
const appsAsStranger = await call('GET', `/entities/JobApplication?query=${encodeURIComponent(JSON.stringify({ job_id: jobId }))}`, { token: userC });
ok(appsAsStranger.status === 200 && appsAsStranger.data.length === 0, 'nobody else sees who applied');

const closeR = await call('PUT', `/entities/Job/${jobId}`, { token: posterTok, body: { open: false } });
ok(closeR.status === 200 && closeR.data.open === false, 'the poster can mark their job filled');
const applyToClosedR = await call('POST', '/functions/applyToJob', { token: userC, body: { job_id: jobId, note: 'x' } });
ok(applyToClosedR.status === 400, 'cannot apply once a job is marked filled');

const statusEscapeR = await call('PUT', `/entities/Job/${jobId}`, { token: posterTok, body: { status: 'pending' } });
ok(statusEscapeR.status === 200 && statusEscapeR.data.status === 'published', 'an owner cannot change their own job\'s moderation status');


// ---- the holes found in the code audit, pinned so they cannot reopen -----

// update-many was the way around every single-row field guard: scoping to
// your own rows still let you set the fields the PUT route strips.
const ownConn = await call('POST', '/entities/Connection', { token: userA, body: { recipient_id: idB } });
ok(ownConn.data.status === 'pending', 'a connection request starts pending');
const selfAccept = await call('POST', '/entities/Connection/update-many', { token: userA, body: { query: { id: ownConn.data.id }, update: { status: 'accepted' } } });
const connAfter = (await call('GET', `/entities/Connection/${ownConn.data.id}`, { token: userA })).data;
ok(connAfter.status === 'pending', 'update-many cannot accept a connection request you sent yourself', JSON.stringify({ selfAccept: selfAccept.data, status: connAfter.status }));

const ownListing = await createOwned(userA, { name: 'Audit Listing', category: 'Business', short_description: 'x' });
const selfPublish = await call('POST', '/entities/Provider/update-many', { token: userA, body: { query: { id: ownListing.data.provider.id }, update: { verified: true, vouch_count: 999 } } });
const listingAfter = (await call('GET', `/entities/Provider/${ownListing.data.provider.id}`, { token: userA })).data;
ok(listingAfter.verified !== true && listingAfter.vouch_count !== 999, 'update-many cannot verify your own listing or inflate its counters', JSON.stringify({ selfPublish: selfPublish.data, verified: listingAfter.verified, vouches: listingAfter.vouch_count }));

// A Job created through the generic route used to land with no status at all,
// which reads as published — skipping createJob's link validation entirely.
const rawJob = await call('POST', '/entities/Job', { token: userA, body: { title: 'Raw Job', category: 'Business', description: 'x'.repeat(40) } });
ok(rawJob.status === 201 && rawJob.data.status === 'pending', 'a job created through the generic route is pending, not silently public', JSON.stringify(rawJob.data));
const jsUrlJob = await call('POST', '/entities/Job', { token: userA, body: { title: 'XSS Job', category: 'Business', description: 'x'.repeat(40), apply_url: 'javascript:alert(1)' } });
ok(jsUrlJob.status === 400, 'a javascript: apply link is refused on the generic route too', String(jsUrlJob.status));

// Notification is client-writable, so the actor and the type are the server's
// to decide — otherwise it is a phishing primitive.
const forgedNotif = await call('POST', '/entities/Notification', { token: userA, body: { recipient_id: idB, type: 'admin_notice', message: 'Klal admin: verify at example.com' } });
ok(forgedNotif.status === 400, 'an unknown notification type is refused', String(forgedNotif.status));
const realNotif = await call('POST', '/entities/Notification', { token: userA, body: { recipient_id: idB, type: 'connection_request', actor_id: idB, actor_name: 'Somebody Else', message: 'hello' } });
ok(realNotif.status === 201 && realNotif.data.actor_id === idA && realNotif.data.actor_name !== 'Somebody Else', 'the notification actor is the caller, not whoever they claim', JSON.stringify(realNotif.data));

// A row written by the server has no author; that never meant "anyone's".
const victimNotif = (await call('GET', '/entities/Notification', { token: userB })).data.find((n) => !n.created_by_id);
if (victimNotif) {
  const hijack = await call('PUT', `/entities/Notification/${victimNotif.id}`, { token: userA, body: { message: 'rewritten' } });
  ok(hijack.status === 403, 'a member cannot rewrite a server-written notification addressed to someone else', String(hijack.status));
} else {
  ok(true, 'no server-written notification to test rewriting against (skipped)');
}

// Deactivation has to revoke access, not just hide the profile.
const deadEmail = `dead${Date.now()}@example.com`;
const deadReg = await call('POST', '/auth/register', { body: { email: deadEmail, password: 'password123' } });
const deadTok = (await call('POST', '/auth/verify-otp', { body: { email: deadEmail, otpCode: deadReg.data.dev_code } })).data.access_token;
const deadId = (await call('GET', '/auth/me', { token: deadTok })).data.id;
await call('PUT', `/users/${deadId}`, { token: admin, body: { disabled: true } });
const deadMe = await call('GET', '/auth/me', { token: deadTok });
ok(deadMe.status === 401, 'a deactivated account\'s existing token stops working', String(deadMe.status));
const deadLogin = await call('POST', '/auth/login', { body: { email: deadEmail, password: 'password123' } });
ok(deadLogin.status === 403, 'a deactivated account cannot sign back in', String(deadLogin.status));

// Codes are six digits with a fifteen-minute window, so guessing has to stop.
const lockEmail = `lock${Date.now()}@example.com`;
const lockReg = await call('POST', '/auth/register', { body: { email: lockEmail, password: 'password123' } });
const realCode = lockReg.data.dev_code;
let lockedAt = 0;
for (let i = 1; i <= 12; i++) {
  const attempt = await call('POST', '/auth/verify-otp', { body: { email: lockEmail, otpCode: '000000' } });
  if (attempt.status === 429) { lockedAt = i; break; }
}
ok(lockedAt > 0 && lockedAt <= 10, `guessing a code is cut off after a few tries (locked on attempt ${lockedAt || 'never'})`);
const afterLock = await call('POST', '/auth/verify-otp', { body: { email: lockEmail, otpCode: realCode } });
ok(afterLock.status === 429, 'even the correct code is refused while locked out', String(afterLock.status));

// ...and a wrong guess or two must not lock a real person out for good.
const okEmail = `okcode${Date.now()}@example.com`;
const okReg = await call('POST', '/auth/register', { body: { email: okEmail, password: 'password123' } });
await call('POST', '/auth/verify-otp', { body: { email: okEmail, otpCode: '111111' } });
await call('POST', '/auth/verify-otp', { body: { email: okEmail, otpCode: '222222' } });
const recovered = await call('POST', '/auth/verify-otp', { body: { email: okEmail, otpCode: okReg.data.dev_code } });
ok(recovered.status === 200 && recovered.data.access_token, 'the right code still works after a couple of wrong ones', String(recovered.status));

// /api/functions/:name is a lookup on an object, so it answered to inherited keys.
const proto = await call('POST', '/functions/constructor', { token: userA, body: {} });
ok(proto.status === 404, 'an inherited property is not callable as a function', String(proto.status));

// ---- prominence is not self-assertable -----------------------------------
// Provider is client-writable, so every field that confers standing has to be
// protected explicitly. `featured` was not, and the directory has a "Featured
// resources" rail that queries it: an owner could promote themselves into it
// with one PUT. A confirmation date is the same kind of claim — a forged one
// is worse than none, because it dresses stale details as checked.
const promoListing = await createOwned(userA, { name: 'Promo Plumbing', category: 'Home Services', short_description: 'Repairs and installations.' });
const promoId = promoListing.data?.provider?.id;
await call('PUT', `/entities/Provider/${promoId}`, { token: userA, body: { featured: true, sponsored: true, sponsored_until: '2030-01-01T00:00:00.000Z', last_confirmed_at: '2030-01-01T00:00:00.000Z' } });
const promoAfter = (await call('GET', `/entities/Provider/${promoId}`, { token: userA })).data || {};
ok(!promoAfter.featured, 'an owner cannot feature their own listing', JSON.stringify(promoAfter.featured));
ok(!promoAfter.sponsored, 'an owner cannot mark their own listing sponsored', JSON.stringify(promoAfter.sponsored));
ok(!promoAfter.sponsored_until, 'an owner cannot set their own sponsorship window', JSON.stringify(promoAfter.sponsored_until));
ok(!promoAfter.last_confirmed_at, 'an owner cannot forge a confirmation date', JSON.stringify(promoAfter.last_confirmed_at));

// ---- gallery: credited photos, three at most --------------------------------
// The create route and the edit route each shape the field themselves, so both
// doors are tried: a fourth photo, a photo with no credit, a source link that
// is not http(s), and then a good pair that has to come back exactly as sent.
// The fixture lives on the Blob store's host shape, which is the one https
// origin the uploads-only rule accepts; an arbitrary host is refused below.
const photo = (n, extra = {}) => ({ url: `https://kc1test.public.blob.vercel-storage.com/uploads/p${n}.png`, caption: `Photo: example.org ${n}`, source_url: 'https://example.org/about', ...extra });
// Their own member: the suite now creates more listings than the five-a-day
// cap allows one account, and a 429 here would leave every row below undefined.
const galleryEmail = `gallery${Date.now()}@example.com`;
const galleryReg = await call('POST', '/auth/register', { body: { email: galleryEmail, password: 'password123' } });
const galleryVer = await call('POST', '/auth/verify-otp', { body: { email: galleryEmail, otpCode: galleryReg.data?.dev_code } });
const galleryTok = galleryVer.data?.access_token, galleryUserId = galleryVer.data?.user?.id;
const fourUp = await call('POST', '/functions/createListing', { token: galleryTok, body: { name: 'Gallery Four', category: 'Food', short_description: 'x', gallery: [photo(1), photo(2), photo(3), photo(4)] } });
ok(fourUp.status === 400, 'a fourth photo is refused on create', JSON.stringify(fourUp.data));
const galleryListing = await createOwned(galleryTok, { name: 'Gallery Bakery', category: 'Food', short_description: 'x' });
const galleryId = galleryListing.data?.provider?.id;
ok(Array.isArray(galleryListing.data?.provider?.gallery) && galleryListing.data.provider.gallery.length === 0, 'a listing without photos stores an empty gallery', JSON.stringify(galleryListing.data?.provider?.gallery));
let g = await call('PUT', `/entities/Provider/${galleryId}`, { token: galleryTok, body: { gallery: [photo(1), photo(2), photo(3), photo(4)] } });
ok(g.status === 400, 'a fourth photo is refused on edit', JSON.stringify(g.data));
g = await call('PUT', `/entities/Provider/${galleryId}`, { token: galleryTok, body: { gallery: [photo(1, { caption: '' })] } });
ok(g.status === 400 && /caption/i.test(g.data?.error || ''), 'a photo without a caption is refused', JSON.stringify(g.data));
g = await call('PUT', `/entities/Provider/${galleryId}`, { token: galleryTok, body: { gallery: [photo(1, { source_url: 'javascript:alert(1)' })] } });
ok(g.status === 400, 'a javascript: source link is refused', JSON.stringify(g.data));
g = await call('PUT', `/entities/Provider/${galleryId}`, { token: galleryTok, body: { gallery: [photo(1), photo(2)] } });
const galleryAfter = (await call('GET', `/entities/Provider/${galleryId}`, { token: galleryTok })).data || {};
ok(g.status === 200 && JSON.stringify(galleryAfter.gallery) === JSON.stringify([photo(1), photo(2)]), 'a valid two-photo gallery round-trips', JSON.stringify(galleryAfter.gallery));
ok(JSON.stringify(galleryAfter.gallery) === JSON.stringify(g.data?.gallery), 'the PUT answer carries the stored gallery', JSON.stringify(g.data?.gallery));
const stranger = await call('PUT', `/entities/Provider/${galleryId}`, { token: userB, body: { gallery: [photo(3)] } });
ok(stranger.status === 403, 'someone else cannot set a listing\'s photos', String(stranger.status));
// "Uploaded here" has to mean our own storage, not any https host: a remote
// picture is a tracking pixel the host can swap after staff have seen it.
g = await call('PUT', `/entities/Provider/${galleryId}`, { token: galleryTok, body: { gallery: [photo(1, { url: 'https://evil.example/pixel.png?u=1' })] } });
ok(g.status === 400 && /uploaded here/i.test(g.data?.error || ''), 'a photo on another host is refused', JSON.stringify(g.data));
g = await call('PUT', `/entities/Provider/${galleryId}`, { token: galleryTok, body: { gallery: [photo(1, { url: 'https://public.blob.vercel-storage.com.evil.example/p.png' })] } });
ok(g.status === 400, 'a look-alike host is refused', JSON.stringify(g.data));
g = await call('PUT', `/entities/Provider/${galleryId}`, { token: galleryTok, body: { gallery: [photo(1, { url: 'https://' })] } });
ok(g.status === 400, 'a bare https:// is refused as a photo', JSON.stringify(g.data));
g = await call('PUT', `/entities/Provider/${galleryId}`, { token: galleryTok, body: { gallery: [photo(1, { url: `https://kc1test.public.blob.vercel-storage.com/${'a'.repeat(3000)}.png` })] } });
ok(g.status === 400, 'a photo url over 2048 characters is refused', String(g.status));
g = await call('PUT', `/entities/Provider/${galleryId}`, { token: galleryTok, body: { gallery: [photo(1, { url: '/api/files/local-1.png' })] } });
ok(g.status === 200 && g.data?.gallery?.[0]?.url === '/api/files/local-1.png', 'a local-disk upload path is accepted as a photo', JSON.stringify(g.data?.gallery));
g = await call('PUT', `/entities/Provider/${galleryId}`, { token: galleryTok, body: { gallery: [photo(1, { caption: '​‌ ﻿' })] } });
ok(g.status === 400 && /caption/i.test(g.data?.error || ''), 'a caption made only of zero-width characters is refused', JSON.stringify(g.data));
g = await call('PUT', `/entities/Provider/${galleryId}`, { token: galleryTok, body: { gallery: [photo(1, { caption: '​Photo: example.org﻿' })] } });
ok(g.status === 200 && g.data?.gallery?.[0]?.caption === 'Photo: example.org', 'zero-width characters are stripped from a real caption', JSON.stringify(g.data?.gallery));

// The third door. Provider is client-writable, so a member can POST
// /entities/Provider directly, and that route stored the gallery as sent:
// javascript: source links and a null where a photo belongs, which crashed
// the listing page for whoever reviewed it. Its own member, because a create
// counts against the five-a-day cap.
const doorEmail = `door${Date.now()}@example.com`;
const doorReg = await call('POST', '/auth/register', { body: { email: doorEmail, password: 'password123' } });
const doorTok = (await call('POST', '/auth/verify-otp', { body: { email: doorEmail, otpCode: doorReg.data?.dev_code } })).data?.access_token;
const doorBad = await call('POST', '/entities/Provider', { token: doorTok, body: { name: 'Bypass', category: 'Food', short_description: 'x', gallery: [photo(1, { source_url: 'javascript:alert(1)' }), null, 'str'] } });
ok(doorBad.status === 400, 'the generic create route refuses a gallery with a javascript: source', JSON.stringify(doorBad.data));
const doorNull = await call('POST', '/entities/Provider', { token: doorTok, body: { name: 'Bypass', category: 'Food', short_description: 'x', gallery: [null] } });
ok(doorNull.status === 400, 'the generic create route refuses a gallery with a non-object item', JSON.stringify(doorNull.data));
const doorRemote = await call('POST', '/entities/Provider', { token: doorTok, body: { name: 'Bypass', category: 'Food', short_description: 'x', gallery: [photo(1, { url: 'https://evil.example/pixel.png' })] } });
ok(doorRemote.status === 400, 'the generic create route refuses a photo on another host', JSON.stringify(doorRemote.data));
const doorLogo = await call('POST', '/entities/Provider', { token: doorTok, body: { name: 'Bypass', category: 'Food', short_description: 'x', logo_url: 'https://evil.example/track.gif' } });
ok(doorLogo.status === 400, 'the generic create route refuses a logo on another host', JSON.stringify(doorLogo.data));
const doorGood = await call('POST', '/entities/Provider', { token: doorTok, body: { name: 'Bypass Bakery', category: 'Food', short_description: 'x', gallery: [photo(1)], badges: ['pas_yisroel', 'not-a-badge'], whatsapp: '+1 (732) 555-0100' } });
ok(doorGood.status === 201 && JSON.stringify(doorGood.data?.gallery) === JSON.stringify([photo(1)]), 'the generic create route stores a valid gallery as shaped', JSON.stringify(doorGood.data?.gallery));
ok(doorGood.status === 201 && Array.isArray(doorGood.data?.badges) && !doorGood.data.badges.includes('not-a-badge') && doorGood.data?.whatsapp === '17325550100', 'the generic create route shapes badges and WhatsApp like the edit route', JSON.stringify({ badges: doorGood.data?.badges, whatsapp: doorGood.data?.whatsapp }));

// The same four fields through the other door. createListing is a function
// route, so stripProtected never runs for it — and because the list of fields
// to refuse was written out twice, it accepted all four at creation time while
// the generic route above refused them. Both now read one shared list.
const bornPromo = await call('POST', '/functions/createListing', { token: userB, body: { name: 'Door Two Plumbing', category: 'Home Services', short_description: 'Repairs and installations.', featured: true, sponsored: true, sponsored_until: '2030-01-01T00:00:00.000Z', last_confirmed_at: '2030-01-01T00:00:00.000Z' } });
const born = bornPromo.data?.provider || {};
ok(!born.featured, 'a listing cannot be born featured', JSON.stringify(born.featured));
ok(!born.sponsored, 'a listing cannot be born sponsored', JSON.stringify(born.sponsored));
ok(!born.sponsored_until, 'a listing cannot be born with a sponsorship window', JSON.stringify(born.sponsored_until));
ok(!born.last_confirmed_at, 'a listing cannot be born already confirmed', JSON.stringify(born.last_confirmed_at));

// ---- the admin switch for vouches and community notes --------------------
// Off until an admin turns it on. Off is a rule, not a hidden section: no new
// vouches or notes, and none served to anyone but staff. The rows are kept.
const switchListing = await createOwned(userB, { name: 'Switch Test Plumbing', category: 'Home Services', short_description: 'Repairs and installations.' });
const switchId = switchListing.data?.provider?.id;
await call('PUT', `/entities/Provider/${switchId}`, { token: admin, body: { status: 'published' } });
ok((await call('GET', '/config')).data.vouchesEnabled === false, 'vouches start switched off');
const offVouch = await call('POST', '/functions/toggleCommunityActivity', { token: userA, body: { providerId: switchId, activity: 'vouch' } });
ok(offVouch.status === 403, 'a vouch is refused while switched off', String(offVouch.status));
const offNote = await call('POST', '/functions/createReview', { token: userA, body: { provider_id: switchId, provider_name: 'Switch Test Plumbing', body: 'Came the same day and fixed it.' } });
ok(offNote.status === 403, 'a note is refused while switched off', String(offNote.status));
const offUse = await call('POST', '/functions/toggleCommunityActivity', { token: userA, body: { providerId: switchId, activity: 'use' } });
ok(offUse.status === 200 && offUse.data?.active === true, '"I\'ve used them" still works while switched off', String(offUse.status));
const planted = await call('POST', '/entities/Vouch', { token: admin, body: { provider_id: switchId, provider_name: 'Switch Test Plumbing', author_name: 'Kept Row' } });
ok(planted.status === 201, 'admin planted a vouch row for the test');
const vouchRows = async (token) => ((await call('GET', '/entities/Vouch', token ? { token } : {})).data || []).filter((v) => v.provider_id === switchId);
ok((await vouchRows(null)).length === 0 && (await vouchRows(userA)).length === 0, 'no vouch is served to visitors or members while switched off');
ok((await vouchRows(admin)).length === 1, 'the row is kept, and admins still see it');
const setting = await call('POST', '/entities/Setting', { token: userA, body: { key: 'vouches_enabled', value: 'true' } });
ok(setting.status === 403, 'a member cannot flip the switch', String(setting.status));
const flipped = await call('POST', '/entities/Setting', { token: admin, body: { key: 'vouches_enabled', value: 'true' } });
ok(flipped.status === 201 && (await call('GET', '/config')).data.vouchesEnabled === true, 'an admin turns it on');
ok((await vouchRows(null)).length === 1, 'turning it on brings the kept vouch back');
const onVouch = await call('POST', '/functions/toggleCommunityActivity', { token: userA, body: { providerId: switchId, activity: 'vouch' } });
ok(onVouch.status === 200 && onVouch.data?.active === true, 'vouching works again once on', String(onVouch.status));

// ---- a listing that turns private takes its vouches with it --------------
// The dangerous case is not a listing that was always sensitive — vouching on
// one of those is already refused. It is a listing that becomes sensitive
// later: sensitivity is read from the listing's own words, so an owner editing
// their description (or the term list growing, which has happened) can make a
// listing private long after people vouched for it publicly.
const laterListing = await createOwned(userB, { name: 'Later Private Co', category: 'Home Services', short_description: 'General repairs and installations.' });
const laterId = laterListing.data?.provider?.id;
const laterVouch = await call('POST', '/functions/toggleCommunityActivity', { token: userA, body: { providerId: laterId, activity: 'vouch' } });
ok(laterVouch.status === 200 && laterVouch.data?.active === true, 'an ordinary listing can still be vouched for', String(laterVouch.status));

const vouchVisibleTo = async (token) => {
  const r = await call('GET', '/entities/Vouch', token ? { token } : {});
  return Array.isArray(r.data) && r.data.some((v) => v.provider_id === laterId);
};
ok(await vouchVisibleTo(userA), 'the vouch is readable while the listing is ordinary');

// The owner edits their own description. Nothing else changes.
await call('PUT', `/entities/Provider/${laterId}`, { token: userB, body: { description: 'We also provide trauma counseling for families.' } });
ok(!(await vouchVisibleTo(userA)), 'the vouch stops being readable once the listing reads as sensitive');
ok(!(await vouchVisibleTo(null)), 'and is not readable anonymously either');

// ---- sensitive listings: no public record of who needed help -------------
// The client does not render "I've used this" or a vouch button on a crisis
// line, an addiction service, a fertility organization or a mikvah. That is
// presentation. These assertions are the rule: a named vouch or a counted use
// on such a listing publishes something about the member's own life, so the
// server refuses it however the request arrives.
const sensListing = await createOwned(userA, { name: 'Crisis Support Line', category: 'Health', short_description: 'Confidential crisis intervention and counseling.' });
const sensId = sensListing.data?.provider?.id;
ok(!!sensId, 'a sensitive listing can be created', JSON.stringify(sensListing.data || {}).slice(0, 120));

const sensVouch = await call('POST', '/functions/toggleCommunityActivity', { token: userB, body: { providerId: sensId, activity: 'vouch' } });
ok(sensVouch.status >= 400, 'a vouch is refused on a sensitive listing', String(sensVouch.status));

const sensUse = await call('POST', '/functions/toggleCommunityActivity', { token: userB, body: { providerId: sensId, activity: 'use' } });
ok(sensUse.status >= 400, 'a public "used this" is refused on a sensitive listing', String(sensUse.status));

// Saving is private to whoever did it, so it must keep working — someone needs
// to be able to keep the number without telling anyone they kept it.
const sensSave = await call('POST', '/functions/toggleCommunityActivity', { token: userB, body: { providerId: sensId, activity: 'save' } });
ok(sensSave.status === 200 && sensSave.data?.active === true, 'saving a sensitive listing still works', String(sensSave.status));

const sensNote = await call('POST', '/functions/createReview', { token: userB, body: { provider_id: sensId, provider_name: 'Crisis Support Line', body: 'They helped me through a very hard time.' } });
ok(sensNote.status >= 400, 'a signed public note is refused on a sensitive listing', String(sensNote.status));

// A shadchan's page is private for the same reason a crisis line is: a named
// vouch says the voucher used a shadchan, which is their business and nobody
// else's. Worth its own assertion because this category was added on a
// suggestion, and the brief draws the line at resources and contacts — no
// profiles, no matching.
const shidduchListing = await createOwned(userB, { name: 'R. Gold', category: 'Shidduchim', short_description: 'Introductions for singles in the community.' });
const shidduchId = shidduchListing.data?.provider?.id;
ok(!!shidduchId, 'a shidduchim listing can be created', String(shidduchListing.status));
const shidduchVouch = await call('POST', '/functions/toggleCommunityActivity', { token: userA, body: { providerId: shidduchId, activity: 'vouch' } });
ok(shidduchVouch.status >= 400, 'a shidduchim listing refuses a public vouch', String(shidduchVouch.status));
const shidduchSave = await call('POST', '/functions/toggleCommunityActivity', { token: userA, body: { providerId: shidduchId, activity: 'save' } });
ok(shidduchSave.status === 200, 'but can still be saved privately', String(shidduchSave.status));

// And the rule is narrow rather than blanket: public trust still works where
// it helps, which is most of the directory.
const plainListing = await createOwned(userA, { name: 'Reliable Plumbing Co', category: 'Home Services', short_description: 'Repairs and installations for kitchens and bathrooms.' });
const plainId = plainListing.data?.provider?.id;
const plainVouch = await call('POST', '/functions/toggleCommunityActivity', { token: userB, body: { providerId: plainId, activity: 'vouch' } });
ok(plainVouch.status === 200 && plainVouch.data?.active === true, 'a plumber can still be vouched for', String(plainVouch.status));


// ---- editing a listing, and what claiming changes ------------------------
// There was no way to edit a listing at all. The API allowed it; nothing in the
// UI used it, the "request a larger change" queue's Approve button changed
// nothing, and approving a claim stamped the request while leaving the listing
// with its original author. So these rules had never been exercised.
const ownListing2 = await call('POST', '/functions/createListing', { token: userB, body: { name: 'Gold Shoe Repair', category: 'Home Services', short_description: 'Resoling and stretching.' } });
const ownId = ownListing2.data?.provider?.id;
ok(!!ownId, 'a member can add a listing to edit', String(ownListing2.status));

// Adding a listing does not make it yours. Whoever added it suggests a
// correction like anyone else until the team accepts them as its owner; before
// this, a member who typed in a shop they did not own could rewrite it for as
// long as the shop had not claimed it.
const edited = await call('PUT', `/entities/Provider/${ownId}`, { token: userB, body: { description: 'Resoling, stretching and repairs while you wait.', phone: '(561) 555-0199' } });
ok(edited.status === 403, 'the person who added a listing cannot edit it before owning it', String(edited.status));
const taglineByAdder = await call('POST', '/functions/updateListingTagline', { token: userB, body: { provider_id: ownId, tagline: 'Mine?' } });
ok(taglineByAdder.status === 403, 'nor set its tagline', String(taglineByAdder.status));

// Nobody else may either, claimed or not.
const strangerEdit = await call('PUT', `/entities/Provider/${ownId}`, { token: userA, body: { description: 'Hijacked.' } });
ok(strangerEdit.status === 403, 'another member cannot edit someone elses listing', String(strangerEdit.status));

// A claim, and what approving it is supposed to do.
// Two claims filed while the listing is still unowned, held for the guards
// further down. A claim arrives before the handover, not after it — and
// createClaim now refuses one aimed at a listing that already has an owner,
// so resolveClaim's own guards have to be reached this way to stay tested.
const selfClaim = await call('POST', '/functions/createClaim', { token: admin, body: { provider_id: ownId, provider_name: 'Gold Shoe Repair', relationship: 'I run it', verification_details: 'Taking this one for myself, thanks.' } });
const secondClaim = await call('POST', '/functions/createClaim', { token: userC, body: { provider_id: ownId, provider_name: 'Gold Shoe Repair', relationship: 'I bought the shop', verification_details: 'New owner as of this month, happy to show papers.' } });
const claim = await call('POST', '/functions/createClaim', { token: userA, body: { provider_id: ownId, provider_name: 'Gold Shoe Repair', relationship: 'I own the shop', verification_details: 'Listed on our website and our storefront sign.' } });
const claimId = claim.data?.claim?.id;
ok(!!claimId, 'a business can file a claim', String(claim.status));

const claimByMember = await call('POST', '/functions/resolveClaim', { token: userA, body: { claim_id: claimId, approve: true } });
ok(claimByMember.status === 403, 'a member cannot approve their own claim', String(claimByMember.status));

const resolved = await call('POST', '/functions/resolveClaim', { token: admin, body: { claim_id: claimId, approve: true } });
ok(resolved.status === 200 && resolved.data?.provider?.claimed === true, 'approving a claim marks the listing claimed', String(resolved.status));
ok(resolved.data?.provider?.owner_id === idA, 'and hands it to whoever claimed it', String(resolved.data?.provider?.owner_id === idA));

// The handover is the whole point: the business edits, the original author no
// longer does. They can still suggest a correction.
const claimerEdit = await call('PUT', `/entities/Provider/${ownId}`, { token: userA, body: { hours: 'Sun-Thu 9-6, Fri 9-1' } });
ok(claimerEdit.status === 200 && claimerEdit.data?.hours?.startsWith('Sun-Thu'), 'the business can edit once its claim is approved', String(claimerEdit.status));
ok(claimerEdit.data?.name === 'Gold Shoe Repair', 'and a partial edit leaves the rest of the row alone', claimerEdit.data?.name);

// Editing is not a way around the fields an admin owns.
await call('PUT', `/entities/Provider/${ownId}`, { token: userA, body: { verified: true, featured: true, usage_count: 99 } });
const afterSneak = (await call('GET', `/entities/Provider/${ownId}`, { token: userA })).data || {};
ok(!afterSneak.verified && !afterSneak.featured && !afterSneak.usage_count, 'editing cannot grant verification, prominence or counters',
  JSON.stringify({ verified: afterSneak.verified, featured: afterSneak.featured, usage_count: afterSneak.usage_count }));
const formerEdit = await call('PUT', `/entities/Provider/${ownId}`, { token: userB, body: { description: 'Still mine?' } });
ok(formerEdit.status === 403, 'and whoever added it no longer can', String(formerEdit.status));

// The two self-service shortcuts followed whoever ADDED the listing, not its
// editor, so after a handover they were exactly inverted: the business could not
// set its own tagline while the original poster still could.
const taglineByOwner = await call('POST', '/functions/updateListingTagline', { token: userA, body: { provider_id: ownId, tagline: 'Resoling since 1998' } });
ok(taglineByOwner.status === 200, 'the business can set the tagline once it owns the listing', String(taglineByOwner.status));
const taglineByFormer = await call('POST', '/functions/updateListingTagline', { token: userB, body: { provider_id: ownId, tagline: 'Not mine any more' } });
ok(taglineByFormer.status === 403, 'and whoever added it cannot', String(taglineByFormer.status));
const payByFormer = await call('POST', '/functions/updateListingPaymentLink', { token: userB, body: { provider_id: ownId, payment_link_url: 'https://venmo.com/u/not-mine' } });
ok(payByFormer.status === 403, 'nor can they redirect its payment link', String(payByFormer.status));

// A claim that names no listing cannot hand anything over, and must not report
// success — that was the old behaviour for every claim.
const vagueClaim = await call('POST', '/functions/createClaim', { token: userC, body: { provider_name: 'Some shop we have never listed', relationship: 'owner', verification_details: 'Trust me on this one please.' } });
const vagueResolve = await call('POST', '/functions/resolveClaim', { token: admin, body: { claim_id: vagueClaim.data?.claim?.id, approve: true } });
ok(vagueResolve.status >= 400, 'a claim with no listing attached cannot be approved', String(vagueResolve.status));

// Resolving a claim is a position of trust, so it carries the usual guards.
// Found by the audit agents, all three reproducible before this.
const selfApprove = await call('POST', '/functions/resolveClaim', { token: admin, body: { claim_id: selfClaim.data?.claim?.id, approve: true } });
ok(selfApprove.status === 403, 'staff cannot approve their own claim', String(selfApprove.status));

// The listing is already userA's; a second claimant does not quietly inherit it.
const secondApprove = await call('POST', '/functions/resolveClaim', { token: admin, body: { claim_id: secondClaim.data?.claim?.id, approve: true } });
ok(secondApprove.status === 409, 'an already-claimed listing is not handed to the next claimant', String(secondApprove.status));
const stillOwned = (await call('GET', `/entities/Provider/${ownId}`, { token: admin })).data || {};
ok(stillOwned.owner_id === idA, 'and the current owner keeps it', String(stillOwned.owner_id === idA));

// A claim is resolved once. Rejecting an approved one used to leave the listing
// transferred while the request read "rejected".
const reResolve = await call('POST', '/functions/resolveClaim', { token: admin, body: { claim_id: claimId, approve: false } });
ok(reResolve.status === 409, 'a resolved claim cannot be resolved again', String(reResolve.status));
const afterReResolve = (await call('GET', `/entities/Provider/${ownId}`, { token: admin })).data || {};
ok(afterReResolve.owner_id === idA && afterReResolve.claimed === true, 'and the listing is left as it was', JSON.stringify({ owner: afterReResolve.owner_id === idA, claimed: afterReResolve.claimed }));

// The bypass the audit agents found: the single-row route refused the original
// author on a claimed listing, and update-many let them straight through,
// because it scoped by created_by_id — which is no longer who may write the row.
const bulkRetake = await call('POST', '/entities/Provider/update-many', { token: userB, body: { query: { id: ownId }, update: { description: 'Taken back through the bulk route' } } });
const afterBulk = (await call('GET', `/entities/Provider/${ownId}`, { token: admin })).data || {};
ok(bulkRetake.status === 403, 'the bulk route cannot be used to edit a listing', String(bulkRetake.status));
ok(afterBulk.description !== 'Taken back through the bulk route', 'and the listing is untouched by the attempt', String(afterBulk.description || '').slice(0, 40));

// The one thing bulk updates are actually for still works.
const myNotifs = await call('POST', '/entities/Notification/update-many', { token: userB, body: { query: { recipient_id: idB, read: false }, update: { read: true } } });
ok(myNotifs.status === 200, 'marking your own notifications read still works', String(myNotifs.status));

// The listing row carries who added it back to the client, which the page
// uses to tell a staff edit from an owner's.
const creatorListing = await call('POST', '/functions/createListing', { token: userC, body: { name: 'Creator Plumbing', category: 'Home Services', short_description: 'Leaks fixed the same day.' } });
const creatorRow = creatorListing.data?.provider || {};
ok(creatorRow.created_by_id === idC, 'a created listing carries its creator id back to the client', JSON.stringify({ created_by_id: creatorRow.created_by_id, idC }));
const creatorFetched = (await call('GET', `/entities/Provider/${creatorRow.id}`, { token: userC })).data || {};
ok(creatorFetched.created_by_id === idC, 'and still carries it when the listing page fetches it', JSON.stringify(creatorFetched.created_by_id));
ok(!creatorListing.data?.claim, 'adding a listing files no claim unless asked to', JSON.stringify(creatorListing.data?.claim));
const creatorEdit = await call('PUT', `/entities/Provider/${creatorRow.id}`, { token: userC, body: { description: 'Licensed and insured.' } });
ok(creatorEdit.status === 403, 'the creator cannot edit a listing they have not been accepted as owner of', String(creatorEdit.status));

// "This is my business" on the add form files the claim alongside the
// listing, so an owner adding their own page does not have to say it twice.
// It is still a claim: nothing is handed over until the team accepts it.
const mineEmail = `mineowner${Date.now()}@example.com`;
const mineReg = await call('POST', '/auth/register', { body: { email: mineEmail, password: 'password123' } });
const mineTok = (await call('POST', '/auth/verify-otp', { body: { email: mineEmail, otpCode: mineReg.data?.dev_code } })).data?.access_token;
const mineUserId = (await call('GET', '/auth/me', { token: mineTok })).data?.id;
const mineListing = await call('POST', '/functions/createListing', { token: mineTok, body: { name: 'Mine Plumbing', category: 'Home Services', short_description: 'Our own shop.', phone: '555-0142', claim_as_owner: true } });
const mineId = mineListing.data?.provider?.id;
const mineClaim = mineListing.data?.claim;
ok(mineClaim?.status === 'pending' && mineClaim?.provider_id === mineId, 'adding a listing as its owner files a pending claim on it', JSON.stringify(mineClaim));
ok(/555-0142/.test(mineClaim?.verification_details || ''), 'with the listing\'s contact details for the team to check', String(mineClaim?.verification_details));
ok(mineListing.data?.provider && !('claim_as_owner' in mineListing.data.provider), 'and the flag is not stored on the listing');
const mineEarly = await call('PUT', `/entities/Provider/${mineId}`, { token: mineTok, body: { description: 'Before approval.' } });
ok(mineEarly.status === 403, 'the owner still cannot edit before the claim is accepted', String(mineEarly.status));
const mineResolved = await call('POST', '/functions/resolveClaim', { token: admin, body: { claim_id: mineClaim?.id, approve: true } });
ok(mineResolved.status === 200 && mineResolved.data?.provider?.owner_id === mineUserId, 'accepting it hands the listing over', String(mineResolved.status));
const mineEdit = await call('PUT', `/entities/Provider/${mineId}`, { token: mineTok, body: { description: 'Licensed and insured.' } });
ok(mineEdit.status === 200 && mineEdit.data?.description === 'Licensed and insured.', 'and then the owner can edit it', String(mineEdit.status));

// Moderators are staff on listings: they edit the content of any listing
// without claiming it, and without the listing changing hands. Protected
// fields are refused for them exactly as for an owner.
const modEmail = `moderator${Date.now()}@example.com`;
const modReg = await call('POST', '/auth/register', { body: { email: modEmail, password: 'password123' } });
const modVer = await call('POST', '/auth/verify-otp', { body: { email: modEmail, otpCode: modReg.data?.dev_code } });
const modTok = modVer.data?.access_token, modId = modVer.data?.user?.id;
// PUT, not POST: an earlier version of this block POSTed here, got a 404 it
// never checked, and every "moderator" assertion below ran as a plain member.
const modRole = await call('PUT', `/users/${modId}/role`, { token: admin, body: { role: 'moderator' } });
ok(modRole.status === 200 && modRole.data?.role === 'moderator', 'setup: the account really is a moderator', String(modRole.status));

// A listing the moderator posts, then someone else claims — so afterwards the
// moderator is neither its owner nor, in the editor's sense, its author.
const modListing = await call('POST', '/functions/createListing', { token: modTok, body: { name: 'Moderator Hardware', category: 'Home Services', short_description: 'Keys cut and locks fitted.' } });
const modListingId = modListing.data?.provider?.id;
const modClaim = await call('POST', '/functions/createClaim', { token: userC, body: { provider_id: modListingId, provider_name: 'Moderator Hardware', relationship: 'owner', verification_details: 'Our shop, our sign, our phone number.' } });
await call('POST', '/functions/resolveClaim', { token: admin, body: { claim_id: modClaim.data?.claim?.id, approve: true } });
const modBefore = (await call('GET', `/entities/Provider/${modListingId}`, { token: admin })).data || {};
ok(modBefore.owner_id === idC, 'setup: the listing now belongs to the business that claimed it', JSON.stringify(modBefore.owner_id));

// (a) content on a listing the moderator does not own, with no claim.
const modEdit = await call('PUT', `/entities/Provider/${modListingId}`, { token: modTok, body: { description: 'Corrected by staff: open Sundays too.', phone: '555-0199' } });
ok(modEdit.status === 200 && modEdit.data?.description === 'Corrected by staff: open Sundays too.',
  'a moderator can edit the content of a listing they do not own', String(modEdit.status) + ' ' + String(modEdit.data?.description || '').slice(0, 40));
// (b) nothing about whose listing it is moved.
const modAfter = (await call('GET', `/entities/Provider/${modListingId}`, { token: admin })).data || {};
ok(modAfter.owner_id === idC && modAfter.created_by_id === modBefore.created_by_id,
  'and the listing still belongs to the same owner and creator afterwards', JSON.stringify({ owner_id: modAfter.owner_id, created_by_id: modAfter.created_by_id }));
// (c) the fields that only an admin may set stay refused for staff.
await call('PUT', `/entities/Provider/${modListingId}`, { token: modTok, body: { verified: true, featured: true, owner_id: modId, status: 'published' } });
const modGrab = (await call('GET', `/entities/Provider/${modListingId}`, { token: admin })).data || {};
ok(modGrab.verified !== true && modGrab.featured !== true && modGrab.owner_id === idC,
  'a moderator still cannot verify, feature or take over a listing', JSON.stringify({ verified: modGrab.verified, featured: modGrab.featured, owner_id: modGrab.owner_id }));

// Editing any listing stops at the one field that moves money.
const modPayFn = await call('POST', '/functions/updateListingPaymentLink', { token: modTok, body: { provider_id: modListingId, payment_link_url: 'https://buy.stripe.com/not-theirs' } });
ok(modPayFn.status === 403, "a moderator cannot set another business's payment link through the function", String(modPayFn.status));
const modPayPut = await call('PUT', `/entities/Provider/${modListingId}`, { token: modTok, body: { payment_link_url: 'https://buy.stripe.com/not-theirs' } });
ok(modPayPut.status === 403, 'nor through the generic edit route', String(modPayPut.status));
const modPayAfter = (await call('GET', `/entities/Provider/${modListingId}`, { token: admin })).data || {};
ok(!modPayAfter.payment_link_url, "and the listing's payment link is untouched", String(modPayAfter.payment_link_url));// A moderator does still change status — that is their queue work — and it
// is logged as moderation like before. The listing starts out published, so
// the proof is a move to a status it did not already have and back: an
// earlier version asserted 'published' on a row that was already published,
// and passed while every queue action silently did nothing.
const modReject = await call('PUT', `/entities/Provider/${modListingId}`, { token: modTok, body: { status: 'rejected' } });
ok(modReject.status === 200 && modReject.data?.status === 'rejected', 'a moderator can reject a listing from the queue', String(modReject.status) + ' ' + String(modReject.data?.status));
const modPublish = await call('PUT', `/entities/Provider/${modListingId}`, { token: modTok, body: { status: 'published' } });
ok(modPublish.status === 200 && modPublish.data?.status === 'published', 'and publish it again', String(modPublish.data?.status));
// Staff fix addresses, so a staff edit has to move the pin without costing
// the listing its verification: the mark is about the business, and the
// business did not change, its address was corrected.
await call('PUT', `/entities/Provider/${modListingId}`, { token: admin, body: { verified: true, verified_at: '2026-10-01T00:00:00Z' } });
const modTown = await call('PUT', `/entities/Provider/${modListingId}`, { token: modTok, body: { city: 'Lakewood', state: 'NJ' } });
ok(modTown.status === 200 && Math.abs(modTown.data?.latitude - 40.0978) < 0.1, 'a staff address fix pins the listing at the new town', `${modTown.data?.latitude},${modTown.data?.longitude}`);
const modMoved = await call('PUT', `/entities/Provider/${modListingId}`, { token: modTok, body: { city: 'Monsey', state: 'NY' } });
ok(modMoved.status === 200 && Math.abs(modMoved.data?.latitude - 41.1115) < 0.1, 'and a later staff move does not leave the old town\'s pin on the new address', `${modMoved.data?.latitude},${modMoved.data?.longitude}`);
ok(modMoved.data?.verified === true, 'while the listing keeps its verification through a staff correction', String(modMoved.data?.verified));
ok(modMoved.data?.pin_precise === false, 'a town-centre pin is stored as not the building itself', String(modMoved.data?.pin_precise));
// (d) an ordinary member is not staff.
const memberEdit = await call('PUT', `/entities/Provider/${modListingId}`, { token: userA, body: { description: 'Rewritten by a stranger' } });
const afterMember = (await call('GET', `/entities/Provider/${modListingId}`, { token: admin })).data || {};
ok(memberEdit.status === 403 && afterMember.description !== 'Rewritten by a stranger',
  'an ordinary member still cannot edit another member\'s listing', String(memberEdit.status));
// Narrowing is unchanged for the other staff queues: a moderator on someone
// else's report changes its state, not its words.
const modOwn = await createOwned(modTok, { name: 'Moderator Bakery', category: 'Food & Catering', short_description: 'Bread and rolls.' });
const modOwnEdit = await call('PUT', `/entities/Provider/${modOwn.data?.provider?.id}`, { token: modTok, body: { description: 'Fresh daily from 6am.' } });
ok(modOwnEdit.status === 200 && modOwnEdit.data?.description === 'Fresh daily from 6am.',
  'a moderator can still edit a listing that is genuinely theirs', String(modOwnEdit.status));

// Handing a business page from one person to another is the most consequential
// thing staff can do here, and it left no trace at all.
const trail = (await call('GET', '/entities/ActivityEvent?limit=500', { token: admin })).data || [];
ok(Array.isArray(trail) && trail.some((e) => e.entity === 'ClaimRequest' && e.target_id === claimId && e.to === 'approved'),
  'approving a claim is recorded', String(Array.isArray(trail) && trail.length));
ok(Array.isArray(trail) && trail.some((e) => e.type === 'listing_handover' && e.target_id === ownId && e.to === idA),
  'and so is the handover itself, with who it went to');
// A moderator's queue action and a moderator's rewrite of somebody's page
// both leave a trace: the status change as moderation, the content change as
// a staff edit naming the fields, so a redirected phone number or payment
// link can be traced to who did it.
ok(Array.isArray(trail) && trail.some((e) => e.type === 'moderation' && e.target_id === modListingId && e.to === 'rejected'),
  'a moderator rejecting a listing is recorded as moderation');
const staffEdit = Array.isArray(trail) ? trail.find((e) => e.type === 'staff_edit' && e.target_id === modListingId && /description/.test(e.fields || '')) : null;
ok(!!staffEdit && /phone/.test(staffEdit.fields) && staffEdit.actor_role === 'moderator',
  'a staff content edit on someone else\'s listing is recorded with the fields it changed', JSON.stringify(staffEdit));
ok(!trail.some((e) => e.type === 'staff_edit' && e.target_id === modOwn.data?.provider?.id && e.actor_role === 'moderator'),
  'while editing a listing that is genuinely theirs is not a staff edit');

// Claims were the last unbounded write.
const spamEmail = `spamclaim${Date.now()}@example.com`;
const spamReg = await call('POST', '/auth/register', { body: { email: spamEmail, password: 'password123' } });
const spamVer = await call('POST', '/auth/verify-otp', { body: { email: spamEmail, otpCode: spamReg.data?.dev_code } });
const spamTok = spamVer.data?.access_token;
let lastClaim = null;
for (let i = 0; i < 4; i++) {
  lastClaim = await call('POST', '/functions/createClaim', { token: spamTok, body: { provider_name: `Some Business ${i}`, relationship: 'owner', verification_details: 'Filing a few of these to see what happens.' } });
}
ok(lastClaim && lastClaim.status === 429, 'claims are capped per day like listings are', String(lastClaim && lastClaim.status));

// The edit route was a way around every rule the create route enforces: it
// never ran the listing normalizer, so a listing could declare on the way back
// through what it was refused on the way in.
const bakeryId = modOwn.data?.provider?.id;
const shapeEdit = await call('PUT', `/entities/Provider/${bakeryId}`, { token: modTok, body: {
  badges: ['pas_yisroel', 'accepts_insurance', 'not-a-real-badge'],
  whatsapp: '(561) 555-0142',
  tagline: 'x'.repeat(200),
  languages: 'English, Hebrew',
  service_areas: 'Boca Raton, Delray Beach',
} });
const gotBadges = shapeEdit.data?.badges || [];
ok(shapeEdit.status === 200 && gotBadges.includes('pas_yisroel'), 'an edit keeps a badge the category allows', JSON.stringify(gotBadges));
ok(!gotBadges.includes('not-a-real-badge'), 'an edit cannot invent a badge that does not exist', JSON.stringify(gotBadges));
ok(!gotBadges.includes('accepts_insurance'), 'nor claim one belonging to another trade', JSON.stringify(gotBadges));
ok(shapeEdit.data?.whatsapp === '15615550142', 'an edit normalizes a WhatsApp number so the wa.me link works', String(shapeEdit.data?.whatsapp));
ok((shapeEdit.data?.tagline || '').length === 120, 'an edit obeys the tagline cap', String((shapeEdit.data?.tagline || '').length));
ok(Array.isArray(shapeEdit.data?.languages) && shapeEdit.data.languages.length === 2,
  'an edit stores list fields as lists, so the listing page cannot 500 on them', JSON.stringify(shapeEdit.data?.languages));
const sparseEdit = await call('PUT', `/entities/Provider/${bakeryId}`, { token: modTok, body: { phone: '561-555-0101' } });
ok(sparseEdit.status === 200 && JSON.stringify(sparseEdit.data?.languages) === JSON.stringify(shapeEdit.data?.languages) && sparseEdit.data?.tagline === shapeEdit.data?.tagline,
  'and a one-field edit leaves the fields it did not mention alone');
// A category change re-tests what the badges were granted against.
const recategorized = await call('PUT', `/entities/Provider/${bakeryId}`, { token: modTok, body: { category: 'Legal' } });
ok(!(recategorized.data?.badges || []).includes('pas_yisroel'), 'a badge does not survive a move to a trade it means nothing in', JSON.stringify(recategorized.data?.badges));

// owner_id is who may edit the row, so the row's own editor must not set it.
const giveAway = await call('PUT', `/entities/Provider/${ownId}`, { token: userA, body: { owner_id: idB } });
// Categories keep themselves current: nobody presses a button when one is added.
const cats = (await call('GET', '/entities/Category', { token: admin })).data || [];
for (const name of ['Shidduchim', 'Shuls & Minyanim', 'Other']) {
  ok(cats.some((c) => c.name === name), `the directory offers ${name} without anyone adding it`);
}
const offeredRow = ((await call('GET', '/entities/Setting', { token: admin })).data || []).find((s) => s.key === 'categories_offered');
ok(!!offeredRow && JSON.parse(offeredRow.value).includes('other'), 'and records what it has offered, so a removal sticks');
ok(new Set(cats.map((c) => c.name)).size === cats.length, 'and never creates a duplicate');

ok(giveAway.status === 200 && giveAway.data?.owner_id === idA,
  'a listing cannot be handed to someone outside the claim queue', String(giveAway.data?.owner_id));

// A claim asks staff to hand one business page to one person, so the record has
// to say which listing — not whatever the claimant typed in the name field.
const targetListing = await call('POST', '/functions/createListing', { token: admin, body: { name: 'Vfy Kosher Supermarket', category: 'Food & Catering', short_description: 'Groceries and a takeout counter.' } });
const targetId = targetListing.data?.provider?.id;
const truthEmail = `claimtruth${Date.now()}@example.com`;
const truthReg = await call('POST', '/auth/register', { body: { email: truthEmail, password: 'password123' } });
const truthTok = (await call('POST', '/auth/verify-otp', { body: { email: truthEmail, otpCode: truthReg.data?.dev_code } })).data?.access_token;
const liar = await call('POST', '/functions/createClaim', { token: truthTok, body: { provider_id: targetId, provider_name: "Moshe's Little Shoe Repair", relationship: 'owner', verification_details: 'Let me tell you all about my shoe shop.' } });
ok(liar.status === 200 && liar.data?.claim?.provider_name === 'Vfy Kosher Supermarket',
  'a claim is recorded against the listing it names, not the name it types', String(liar.data?.claim?.provider_name));
const twice = await call('POST', '/functions/createClaim', { token: truthTok, body: { provider_id: targetId, provider_name: 'Vfy Kosher Supermarket', relationship: 'owner', verification_details: 'Filing it a second time for good measure.' } });
ok(twice.status === 409, 'the same member cannot pile claims on one listing', String(twice.status));
const ghost = await call('POST', '/functions/createClaim', { token: truthTok, body: { provider_id: 'no-such-listing', provider_name: 'Ghost Shop', relationship: 'owner', verification_details: 'Claiming a listing that is not there.' } });
ok(ghost.status === 404, 'a claim cannot point at a listing that does not exist', String(ghost.status));
const takenToo = await call('POST', '/functions/createClaim', { token: truthTok, body: { provider_id: ownId, provider_name: 'Gold Shoe Repair', relationship: 'owner', verification_details: 'Trying for a listing that already has an owner.' } });
ok(takenToo.status === 409, 'a listing that already belongs to someone is not claimable', String(takenToo.status));

// Their own member, because userB is at the five-listings-a-day cap by now and
// a 429 here would leave the rows below undefined and the assertions vacuous.
const ownerEmail = `listingowner${Date.now()}@example.com`;
const ownerReg = await call('POST', '/auth/register', { body: { email: ownerEmail, password: 'password123' } });
const ownerTok = (await call('POST', '/auth/verify-otp', { body: { email: ownerEmail, otpCode: ownerReg.data?.dev_code } })).data?.access_token;

// The slug is the public URL. /provider/:slug resolves by filtering on it, so
// a member could put another business's slug on their own listing and answer
// at the victim's canonical URL with their own title, OG tags and JSON-LD.
const victim = await call('POST', '/functions/createListing', { token: admin, body: { name: 'Devorahs Kosher Catering', category: 'Food & Catering', short_description: 'Catering for simchas.', slug: 'devorahs-kosher-catering' } });
ok(!victim.data?.provider?.slug, 'a new listing cannot choose its own public URL', String(victim.data?.provider?.slug));
const squatter = await createOwned(ownerTok, { name: 'Not The Caterer', category: 'Business', short_description: 'Something else entirely.' });
const squatId = squatter.data?.provider?.id;
const squat = await call('PUT', `/entities/Provider/${squatId}`, { token: ownerTok, body: { slug: 'devorahs-kosher-catering' } });
ok(squat.status === 200 && !squat.data?.slug, 'nor take over another listing URL by editing', String(squat.data?.slug));

// Verification is a statement about one specific business.
const toVerify = await createOwned(ownerTok, { name: 'Verified Bakery', category: 'Food & Catering', short_description: 'Bread and challah.', city: 'Lakewood' });
const vId = toVerify.data?.provider?.id;
await call('PUT', `/entities/Provider/${vId}`, { token: admin, body: { verified: true, verified_at: '2026-10-01T00:00:00Z', latitude: 40.0963, longitude: -74.2176, badges: ['pas_yisroel'], verified_badges: ['pas_yisroel'] } });
ok(!!vId, 'the rows the verification assertions need exist', String(toVerify.status));
const hoursOnly = await call('PUT', `/entities/Provider/${vId}`, { token: ownerTok, body: { hours: 'Sun-Thu 6am-7pm' } });
ok(hoursOnly.data?.verified === true, 'fixing the hours does not cost a listing its verification', String(hoursOnly.data?.verified));
const becameSomethingElse = await call('PUT', `/entities/Provider/${vId}`, { token: ownerTok, body: { name: "Shloimy's Auto Body", category: 'Home Services', city: 'Brooklyn', address: '1 Other St' } });
ok(becameSomethingElse.data?.verified === false, 'but becoming a different business does', String(becameSomethingElse.data?.verified));
ok(becameSomethingElse.status === 200 && becameSomethingElse.data?.latitude !== 40.0963, 'and the old pin does not stay on the new address', String(becameSomethingElse.data?.latitude));

// A town typed rather than picked saves without coordinates; the server finds
// the pin itself, or saves the listing anyway when it cannot.
const townOnly = await createOwned(ownerTok, { name: 'Town Only Tailor', category: 'Business', short_description: 'Alterations.', city: 'Lakewood', state: 'NJ' });
ok(townOnly.status === 200 && !!townOnly.data?.provider?.id, 'a listing with only a town saves without error', String(townOnly.status));
const townPin = townOnly.data?.provider || {};
ok((townPin.latitude == null && townPin.longitude == null) || (Math.abs(townPin.latitude - 40.0978) < 0.1 && Math.abs(townPin.longitude + 74.2176) < 0.1),
  'and is pinned at the town when the town is known', `${townPin.latitude},${townPin.longitude}`);
const noPlace = await createOwned(ownerTok, { name: 'Remote Only Tutor', category: 'Business', short_description: 'Online lessons.', delivery_mode: 'remote' });
ok(noPlace.status === 200 && noPlace.data?.provider?.latitude == null, 'a listing with no place at all saves with no pin and no error', String(noPlace.status));
const trail2 = (await call('GET', '/entities/ActivityEvent?limit=500', { token: admin })).data || [];
ok(trail2.some((e) => e.type === 'listing_identity_change' && e.target_id === vId),
  'a verified listing changing identity is something staff can find');

// Their own member: the listings above put ownerTok at the five-a-day cap.
const pinEmail = `pinowner${Date.now()}@example.com`;
const pinReg = await call('POST', '/auth/register', { body: { email: pinEmail, password: 'password123' } });
const pinTok = (await call('POST', '/auth/verify-otp', { body: { email: pinEmail, otpCode: pinReg.data?.dev_code } })).data?.access_token;

// A curated town is only an answer in its own state. The list knows a Paris
// and a Jackson, and a listing in Paris, TX was drawn in France.
const parisTx = await createOwned(pinTok, { name: 'Paris Texas Tailor', category: 'Business', short_description: 'Alterations.', address: '12 Main St', city: 'Paris', state: 'TX' });
ok(parisTx.status === 200 && parisTx.data?.provider?.latitude == null, 'a listing in Paris, TX is not pinned at Paris, France', `${parisTx.data?.provider?.latitude}`);
const jacksonMs = await createOwned(pinTok, { name: 'Jackson Mississippi Movers', category: 'Business', short_description: 'Moving.', city: 'Jackson', state: 'MS' });
ok(jacksonMs.status === 200 && jacksonMs.data?.provider?.latitude == null, 'nor Jackson, MS at Jackson, NJ', `${jacksonMs.data?.provider?.latitude}`);
const jacksonBare = await createOwned(pinTok, { name: 'Jackson Somewhere Movers', category: 'Business', short_description: 'Moving.', city: 'Jackson' });
ok(jacksonBare.status === 200 && jacksonBare.data?.provider?.latitude == null, 'a town name shared across states is not pinned without a state', `${jacksonBare.data?.provider?.latitude}`);
const jacksonNj = await createOwned(pinTok, { name: 'Jackson NJ Movers', category: 'Business', short_description: 'Moving.', city: 'Jackson', state: 'NJ', pin_precise: true });
const jnj = jacksonNj.data?.provider || {};
ok(jacksonNj.status === 200 && Math.abs(jnj.latitude - 40.1090) < 0.1 && Math.abs(jnj.longitude + 74.3646) < 0.1, 'the same town with its state is pinned at the town', `${jnj.latitude},${jnj.longitude}`);
ok(jnj.pin_precise === false, 'and a town pin is stored as not the building, whatever the client claimed', String(jnj.pin_precise));
const claimPrecise = await call('PUT', `/entities/Provider/${jnj.id}`, { token: pinTok, body: { pin_precise: true } });
ok(claimPrecise.status === 200 && claimPrecise.data?.pin_precise !== true, 'a client cannot mark its own pin as the building by editing', String(claimPrecise.data?.pin_precise));
// Empty strings in both columns are no pin, not a pin that blocks the lookup.
const emptyCoords = await createOwned(pinTok, { name: 'Empty Coordinates Tailor', category: 'Business', short_description: 'Alterations.', city: 'Lakewood', state: 'NJ', latitude: '', longitude: '' });
ok(emptyCoords.status === 200 && Math.abs(emptyCoords.data?.provider?.latitude - 40.0978) < 0.1, 'a listing saved with empty-string coordinates is still pinned at its town', `${emptyCoords.data?.provider?.latitude}`);
// "Remove pin" sends both coordinates as null; the same request must not pin
// the town straight back, or the control is a no-op.
const removePin = await call('PUT', `/entities/Provider/${jnj.id}`, { token: pinTok, body: { latitude: null, longitude: null } });
ok(removePin.status === 200 && removePin.data?.latitude == null && removePin.data?.longitude == null, 'removing the pin leaves the listing unpinned', `${removePin.data?.latitude},${removePin.data?.longitude}`);
const stillRemoved = (await call('GET', `/entities/Provider/${jnj.id}`, { token: pinTok })).data || {};
ok(stillRemoved.latitude == null, 'and it stays unpinned when read back', String(stillRemoved.latitude));
// A pin the owner placed in the same save as a move is where the business is;
// a geocoder's guess at the new town must not replace it.
const movedWithPin = await call('PUT', `/entities/Provider/${jnj.id}`, { token: pinTok, body: { city: 'Lakewood', state: 'NJ', latitude: 40.1234, longitude: -74.3456 } });
ok(movedWithPin.status === 200 && movedWithPin.data?.latitude === 40.1234 && movedWithPin.data?.longitude === -74.3456, 'a pin placed alongside a city change is kept', `${movedWithPin.data?.latitude},${movedWithPin.data?.longitude}`);
ok(movedWithPin.data?.pin_precise == null, 'and carries no geocoder precision, since the geocoder did not place it', String(movedWithPin.data?.pin_precise));
const movedWithout = await call('PUT', `/entities/Provider/${jnj.id}`, { token: pinTok, body: { city: 'Monsey', state: 'NY' } });
ok(movedWithout.status === 200 && Math.abs(movedWithout.data?.latitude - 41.1115) < 0.1, 'a city change without a pin drops the old one and pins the new town', `${movedWithout.data?.latitude}`);

// A confirmed badge is the admin's word on a claim the listing made. When the
// listing stops making the claim, the admin's confirmation of it has to go too
// — the page draws a badge that is declared OR confirmed, so un-ticking it in
// the form changed nothing while the form said the change was live.
const kosher = await createOwned(ownerTok, { name: 'Badge Bakery', category: 'Food & Catering', short_description: 'Cakes.', badges: ['cholov_yisroel', 'pas_yisroel'] });
const kId = kosher.data?.provider?.id;
await call('PUT', `/entities/Provider/${kId}`, { token: admin, body: { verified_badges: ['cholov_yisroel', 'pas_yisroel'] } });
ok(!!kId, 'and the badge assertions have a row too', String(kosher.status));
const untick = await call('PUT', `/entities/Provider/${kId}`, { token: ownerTok, body: { badges: ['pas_yisroel'] } });
ok(!(untick.data?.verified_badges || []).includes('cholov_yisroel'),
  'a business can retract a confirmed badge it no longer deserves', JSON.stringify(untick.data?.verified_badges));
ok((untick.data?.verified_badges || []).includes('pas_yisroel'), 'and keeps the one it still declares', JSON.stringify(untick.data?.verified_badges));
const moved = await call('PUT', `/entities/Provider/${kId}`, { token: ownerTok, body: { category: 'Legal' } });
ok(!(moved.data?.verified_badges || []).length, 'a confirmed kashrus badge does not follow a listing into another trade', JSON.stringify(moved.data?.verified_badges));
const dupes = await call('PUT', `/entities/Provider/${kId}`, { token: ownerTok, body: { service_areas: 'Boca Raton, Boca Raton, Delray Beach' } });
ok(JSON.stringify(dupes.data?.service_areas) === JSON.stringify(['Boca Raton', 'Delray Beach']),
  'an edit does not store the same area twice', JSON.stringify(dupes.data?.service_areas));

// ---- logo upload --------------------------------------------------------
// The form reported "Your changes are live" while logo_url stayed empty. The
// server half of that path is pinned here: an image upload hands back a URL
// the browser can load, anything else is refused with a message, and a
// logo_url patch lands on the row and moves updated_date.
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
async function uploadAs(token, bytes, type, name) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type }), name);
  const res = await fetch(API + '/upload', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form });
  let data = null; try { data = await res.json(); } catch { /* empty body */ }
  return { status: res.status, data };
}
const anonUpload = await uploadAs(null, PNG_1X1, 'image/png', 'logo.png');
ok(anonUpload.status === 401, 'an upload needs a session', String(anonUpload.status));
// Their own member: the suite now creates more listings than the five-a-day
// cap allows one account, and a 429 here would leave every row below undefined.
const logoEmail = `logo${Date.now()}@example.com`;
const logoReg = await call('POST', '/auth/register', { body: { email: logoEmail, password: 'password123' } });
const logoVer = await call('POST', '/auth/verify-otp', { body: { email: logoEmail, otpCode: logoReg.data?.dev_code } });
const logoTok = logoVer.data?.access_token, logoId = logoVer.data?.user?.id;
const textUpload = await uploadAs(userA, Buffer.from('not an image'), 'text/plain', 'notes.txt');
ok(textUpload.status === 400 && /image/i.test(textUpload.data?.error || ''), 'a non-image upload is refused with a message', JSON.stringify(textUpload));
const pngUpload = await uploadAs(userA, PNG_1X1, 'image/png', 'logo.png');
ok(pngUpload.status === 200 && /^\/api\/files\/[\w-]+\.png$/.test(pngUpload.data?.file_url || ''), 'a PNG upload returns a file_url on the local-disk backend', JSON.stringify(pngUpload));
if (pngUpload.data?.file_url) {
  const served = await fetch(`http://127.0.0.1:${server.address().port}${pngUpload.data.file_url}`);
  ok(served.status === 200 && /^image\/png/.test(served.headers.get('content-type') || ''), 'the uploaded file is served back as image/png', `${served.status} ${served.headers.get('content-type')}`);
}
const logoListing = await createOwned(logoTok, { name: 'Logo Listing', category: 'Business', short_description: 'x' });
const logoRow = logoListing.data?.provider;
ok(!!logoRow?.id && !logoRow.logo_url, 'a listing starts without a logo', JSON.stringify(logoListing.data));
// Timestamps are millisecond ISO strings; a save within the same tick as the
// create would read as "unchanged" and make this check lie.
await new Promise((r) => setTimeout(r, 5));
const logoPut = await call('PUT', `/entities/Provider/${logoRow.id}`, { token: logoTok, body: { logo_url: pngUpload.data?.file_url || '/api/files/test.png' } });
const logoAfter = (await call('GET', `/entities/Provider/${logoRow.id}`, { token: logoTok })).data;
ok(logoPut.status === 200 && logoAfter.logo_url === (pngUpload.data?.file_url || '/api/files/test.png'), 'a logo_url patch by the creator persists on the listing', JSON.stringify({ put: logoPut.data, after: logoAfter.logo_url }));
ok(logoAfter.updated_date && logoAfter.updated_date !== logoRow.updated_date && logoAfter.updated_date > logoRow.created_date, 'saving a logo moves updated_date', JSON.stringify({ before: logoRow.updated_date, after: logoAfter.updated_date }));
ok(logoAfter.name === 'Logo Listing' && logoAfter.created_by_id === logoId, 'a logo-only patch leaves the rest of the row and its ownership alone');
// The logo is held to the same uploads-only rule as the photos. It used to
// pass through unvalidated on both doors while the gallery beside it was
// checked, and it is what og:image and the promoted rail draw.
for (const bad of ['javascript:alert(1)', 'data:text/html,<script>1</script>', 'http://evil.example/p.gif', 'https://evil.example/p.gif', 'not a url at all']) {
  const r = await call('PUT', `/entities/Provider/${logoRow.id}`, { token: logoTok, body: { logo_url: bad } });
  ok(r.status === 400 && /uploaded here/i.test(r.data?.error || ''), `a logo_url of ${JSON.stringify(bad)} is refused on edit`, JSON.stringify(r.data));
}
const logoStill = (await call('GET', `/entities/Provider/${logoRow.id}`, { token: logoTok })).data;
ok(logoStill?.logo_url === logoAfter.logo_url, 'a refused logo leaves the stored one in place', JSON.stringify(logoStill?.logo_url));
// Clearing: the form's Remove control on an existing image sends ''.
const logoClear = await call('PUT', `/entities/Provider/${logoRow.id}`, { token: logoTok, body: { logo_url: '' } });
const logoCleared = (await call('GET', `/entities/Provider/${logoRow.id}`, { token: logoTok })).data;
ok(logoClear.status === 200 && logoCleared?.logo_url === '', 'an empty logo_url takes the stored logo down', JSON.stringify({ put: logoClear.status, after: logoCleared?.logo_url }));
const logoCreateBad = await call('POST', '/functions/createListing', { token: logoTok, body: { name: 'Logo Hotlink', category: 'Business', short_description: 'x', logo_url: 'https://evil.example/track.gif?u=1' } });
ok(logoCreateBad.status === 400 && /uploaded here/i.test(logoCreateBad.data?.error || ''), 'createListing refuses a logo on another host', JSON.stringify(logoCreateBad.data));
const logoCreateOk = await call('POST', '/functions/createListing', { token: logoTok, body: { name: 'Logo Local', category: 'Business', short_description: 'x', logo_url: '/api/files/local-2.png' } });
ok(logoCreateOk.status === 200 && logoCreateOk.data?.provider?.logo_url === '/api/files/local-2.png', 'createListing keeps a logo that is one of our uploads', JSON.stringify(logoCreateOk.data));

// A demo instance adopts one shared guest account for every signed-out
// visitor, so rows it created belong to nobody in particular.
const guestSession = await call('POST', '/auth/demo-session', { body: {} });
const guestTok = guestSession.data?.access_token;
if (guestTok) {
  const guestListing = await call('POST', '/functions/createListing', { token: guestTok, body: { name: 'Guest Shop', category: 'Community', short_description: 'Added without an account.' } });
  const gId = guestListing.data?.provider?.id;
  if (gId) {
    const guestEdit = await call('PUT', `/entities/Provider/${gId}`, { token: guestTok, body: { description: 'Anyone at all can write this.' } });
    ok(guestEdit.status === 403, 'the shared guest account cannot edit a listing, including one it added', String(guestEdit.status));
  } else {
    ok(true, 'the shared guest account cannot add a listing at all', String(guestListing.status));
  }
}

// ---- renaming an invite link ----------------------------------------------
// An invite built from someone's first name can be renamed to something
// neutral, and the old link has to keep working for everyone who already has it.
const inv = (await call('POST', '/functions/myInvite', { token: userA, body: {} })).data?.invite;
ok(inv?.code, 'member has an invite link', JSON.stringify(inv));
const neutral = `welcome-${Date.now().toString(36)}`;
const notMine = await call('POST', '/functions/renameInvite', { token: userB, body: { code: inv.code, new_code: `other-${neutral}` } });
ok(notMine.status === 403, 'another member cannot rename someone else\'s invite', String(notMine.status));
const badSlug = await call('POST', '/functions/renameInvite', { token: userA, body: { code: inv.code, new_code: 'Bad Slug!' } });
ok(badSlug.status === 400, 'an invite slug must be lowercase letters, digits and hyphens', String(badSlug.status));
const renamed = await call('POST', '/functions/renameInvite', { token: userA, body: { code: inv.code, new_code: neutral } });
ok(renamed.status === 200 && renamed.data.invite.code === neutral && renamed.data.invite.aliases.includes(inv.code), 'the inviter renames their own link', JSON.stringify(renamed.data));
const viaOld = await call('GET', `/invites/${inv.code}`);
ok(viaOld.status === 200 && viaOld.data.code === neutral, 'the old link still resolves and reports the new code', JSON.stringify(viaOld.data));
const viaNew = await call('GET', `/invites/${neutral}`);
ok(viaNew.status === 200 && viaNew.data.code === neutral, 'the new link resolves', JSON.stringify(viaNew.data));
const invB = (await call('POST', '/functions/myInvite', { token: userB, body: {} })).data?.invite;
const takenCurrent = await call('POST', '/functions/renameInvite', { token: userB, body: { code: invB.code, new_code: neutral } });
ok(takenCurrent.status === 409, 'a slug already in use as a code is refused', String(takenCurrent.status));
const takenAlias = await call('POST', '/functions/renameInvite', { token: userB, body: { code: invB.code, new_code: inv.code } });
ok(takenAlias.status === 409, 'a slug still held as an alias is refused', String(takenAlias.status));
const byAdmin = await call('POST', '/functions/renameInvite', { token: admin, body: { code: invB.code, new_code: `${neutral}-b` } });
ok(byAdmin.status === 200 && byAdmin.data.invite.code === `${neutral}-b`, 'an admin can rename any invite', JSON.stringify(byAdmin.data));
const joinedViaAlias = await call('POST', '/auth/register', { body: { email: `inv${Date.now()}@example.com`, password: 'password123', invite_code: inv.code } });
ok(joinedViaAlias.status === 201, 'signing up through the old link is still accepted', JSON.stringify(joinedViaAlias.data));
const invAfter = (await call('POST', '/functions/myInvite', { token: userA, body: {} })).data?.invite;
ok(invAfter?.joined_count === 1 && invAfter.code === neutral, 'the join is credited to the renamed invite', JSON.stringify(invAfter));

// Undoing a rename: the former code is this invite's own alias, so taking it
// back is not a collision with anybody. It becomes current again and leaves
// the alias list, so the row does not answer to the same code twice.
const undone = await call('POST', '/functions/renameInvite', { token: userA, body: { code: neutral, new_code: inv.code } });
ok(undone.status === 200 && undone.data.invite.code === inv.code, 'the inviter can rename a link back to one of its own former codes', JSON.stringify(undone.data));
ok(undone.status === 200 && !undone.data.invite.aliases.includes(inv.code) && undone.data.invite.aliases.includes(neutral), 'a code made current again is no longer listed as an alias', JSON.stringify(undone.data?.invite?.aliases));
const neutralStillResolves = await call('GET', `/invites/${neutral}`);
ok(neutralStillResolves.status === 200 && neutralStillResolves.data.code === inv.code, 'the link that was just replaced keeps working as an alias', JSON.stringify(neutralStillResolves.data));

// A freshly generated code must not land on a slug another invite still
// holds as an alias, or everyone with that printed link would be credited
// to the newcomer. The generator is name + four random letters, so a member
// named "Zed" with Math.random pinned to 0 would be offered "zed-aaaa"; that
// slug is parked as an alias on A's invite first, and the generator has to
// move on to its next try.
const aliasTrap = await call('POST', '/functions/renameInvite', { token: userA, body: { code: inv.code, new_code: 'zed-aaaa' } });
const aliasTrapBack = await call('POST', '/functions/renameInvite', { token: userA, body: { code: 'zed-aaaa', new_code: inv.code } });
ok(aliasTrap.status === 200 && aliasTrapBack.status === 200 && aliasTrapBack.data.invite.aliases.includes('zed-aaaa'), 'setup: zed-aaaa is parked as an alias of another invite', JSON.stringify([aliasTrap.data, aliasTrapBack.data]));
const zedEmail = `zed${Date.now()}@example.com`;
const zedReg = await call('POST', '/auth/register', { body: { email: zedEmail, password: 'password123' } });
const zedTok = (await call('POST', '/auth/verify-otp', { body: { email: zedEmail, otpCode: zedReg.data?.dev_code } })).data?.access_token;
await call('PUT', '/auth/me', { token: zedTok, body: { full_name: 'Zed Example' } });
const realRandom = Math.random;
let randomCalls = 0;
// The first four draws spell the colliding tail; later draws pick another.
Math.random = () => (randomCalls++ < 4 ? 0 : 0.5);
let zedInvite;
try {
  zedInvite = (await call('POST', '/functions/myInvite', { token: zedTok, body: {} })).data?.invite;
} finally {
  Math.random = realRandom;
}
ok(zedInvite?.code && zedInvite.code !== 'zed-aaaa' && zedInvite.code.startsWith('zed-'), 'a generated invite code skips a slug another invite holds as an alias', JSON.stringify(zedInvite));
const aliasOwner = await call('GET', '/invites/zed-aaaa');
ok(aliasOwner.status === 200 && aliasOwner.data.code === inv.code, 'the parked alias still resolves to the invite that owned it', JSON.stringify(aliasOwner.data));

// Aliases are capped so one member cannot reserve an unlimited number of
// slugs by renaming in a loop. Past the cap the oldest alias is dropped and
// that link stops resolving; the newer ones all still work.
const capInviter = `cap${Date.now()}@example.com`;
const capReg = await call('POST', '/auth/register', { body: { email: capInviter, password: 'password123' } });
const capTok = (await call('POST', '/auth/verify-otp', { body: { email: capInviter, otpCode: capReg.data?.dev_code } })).data?.access_token;
await call('PUT', '/auth/me', { token: capTok, body: { full_name: 'Cap Tester' } });
const capInvite = (await call('POST', '/functions/myInvite', { token: capTok, body: {} })).data?.invite;
const capStamp = Date.now().toString(36);
const capNames = Array.from({ length: 7 }, (_, i) => `cap-${capStamp}-${i}`);
let capCurrent = capInvite?.code, capLast = null, capMax = 0, capDropped = [];
for (const name of capNames) {
  capLast = await call('POST', '/functions/renameInvite', { token: capTok, body: { code: capCurrent, new_code: name } });
  if (capLast.status !== 200) break;
  capCurrent = name;
  capMax = Math.max(capMax, capLast.data.invite.aliases.length);
  capDropped = capDropped.concat(capLast.data.dropped_aliases || []);
}
ok(capLast?.status === 200 && capMax <= 5 && capLast.data.invite.aliases.length === 5, 'an invite keeps at most five former codes', JSON.stringify({ status: capLast?.status, max: capMax, aliases: capLast?.data?.invite?.aliases }));
ok(capDropped.length === 2 && capDropped[0] === capInvite?.code && capDropped[1] === capNames[0], 'renaming past the cap drops the oldest aliases first and reports them', JSON.stringify(capDropped));
const capGone = await call('GET', `/invites/${capInvite?.code}`);
ok(capGone.status === 404, 'a link whose alias was dropped no longer resolves', String(capGone.status));
const capKept = await call('GET', `/invites/${capNames[1]}`);
ok(capKept.status === 200 && capKept.data.code === capNames[6], 'the newest former codes still resolve to the renamed invite', JSON.stringify(capKept.data));
const capNoDup = capLast?.data?.invite?.aliases || [];
ok(new Set(capNoDup).size === capNoDup.length && !capNoDup.includes(capNames[6]), 'the alias list has no duplicates and never contains the current code', JSON.stringify(capNoDup));

// ---- the rename-invite CLI refuses an in-memory store ----------------------
// Against the memory backend a rename could only vanish at exit, while the
// output would read like production had been changed. The command exits
// before looking anything up, and says why.
const cliMemory = spawnSync(process.execPath, ['server/rename-invite.js', 'some-old-code', 'some-new-code'], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  env: { ...process.env, KC_STORE: 'memory', KC_DEMO_MODE: '1' },
  encoding: 'utf8',
});
const cliErr = String(cliMemory.stderr || cliMemory.error || '');
ok(cliMemory.status === 1 && /in-memory/.test(cliErr) && !/no invite answers/.test(cliErr), 'the rename-invite CLI refuses to run against the in-memory store', JSON.stringify({ status: cliMemory.status, stderr: cliErr.slice(-300) }));

console.log = log;
server.close();
rmSync(uploadDir, { recursive: true, force: true });
console.log(fails ? `\napi checks: ${fails} FAILED` : '\napi checks: all passed');
process.exit(fails ? 1 : 0);
