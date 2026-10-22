// Klal API — entities, auth, business functions and uploads.
//
// Exports the Express app without listening, so the same code serves both the
// local dev server (server/index.js) and a serverless function (api/index.js).
// Calling listen() in a serverless runtime is what breaks these deployments.
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { randomBytes } from 'node:crypto';

import { store, users, userToPublic, otp, geoCache, GUEST_EMAIL } from './db.js';
import {
  attachUser, requireAuth, requireAdmin,
  hashPassword, checkPassword, signToken, deliverCode, canDeliverCodes,
} from './auth.js';
import { functions, publicFunctions, safeExternalUrl, findInviteByCode } from './functions.js';
import { ADMIN_ONLY_LISTING_FIELDS } from '../src/lib/trust.js';
import { BADGE_BY_ID, badgeAppliesTo } from '../src/lib/badges.js';
import { isSensitiveListing } from '../src/lib/sensitivity.js';
import { listingEditor, normalizeListingPatch, canSetPaymentLink } from '../src/lib/listing.js';
import { verificationAfterEdit, pinAfterEdit, hasCoordinate } from '../src/lib/trust.js';
import { isValidTimeZone } from './shabbos.js';
import { isScheduled, byPostedAtDesc } from '../src/lib/scheduledPosts.js';
import { BOOKING_LABELS, DEFAULT_BOOKING_LABEL, withScheme } from '../src/lib/booking.js';
import { WORK_STATUS_IDS } from '../src/lib/workStatus.js';
import { isDemoMode } from './db.js';
import { ensureDemoData } from './demo-seed.js';
import { ensureCoreCategories } from './ensure-core.js';
import { reverseGeocode, searchPlaces, geolocateIp, pinForListing, tzFor, PROVIDER as GEO_PROVIDER } from './geocode.js';
import { translateEnabled, LANGUAGES as TRANSLATE_LANGUAGES } from './translate.js';
import { put as putFile, usingObjectStorage, UPLOAD_DIR } from './storage.js';
import { mountSeo, sitemap, robots, siteOrigin } from './seo.js';
import { healthReport } from './health.js';
import { vouchesEnabled, forgetSettings } from './settings.js';

// The built index.html, baked in at build time by scripts/emit-shell.mjs.
// Absent in dev and in tests, where Vite serves the shell itself.
let SHELL = '';
try { ({ SHELL } = await import('./shell.generated.js')); } catch { /* dev */ }
// Which commit this server was built from. Absent when running from source.
let BUILD = { commit: 'dev' };
try { ({ BUILD } = await import('./build.generated.js')); } catch { /* dev */ }

const app = express();
// Vercel and most hosts terminate TLS in front of us; req.ip must come from
// X-Forwarded-For there, but trusting that header when we are NOT behind a
// proxy would let any client spoof its own IP.
if (process.env.KC_TRUST_PROXY === '1') app.set('trust proxy', true);
// The API answers this site, and localhost while developing. It used to
// answer any origin at all, which let any page on the internet call it with a
// visitor's token in hand.
const ALLOWED_ORIGINS = [
  'https://klalconnect.org',
  'https://www.klalconnect.org',
  ...(process.env.KC_ALLOWED_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean),
];
const isAllowedOrigin = (origin) => {
  if (!origin) return true;                     // same-origin, curl, an app
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  if (process.env.NODE_ENV !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  // Vercel builds every deploy its own hostname; the preview of this project
  // has to be able to call its own API.
  //
  // Scoped to the account, not just the project name: `klal-connect-[anything]`
  // also matches a project a stranger creates, and anyone can name a Vercel
  // project `klal-connect-whatever`. A deploy of ours is always
  // klal-connect-<hash>-<team slug>.vercel.app, and the team slug is not
  // something someone else can take. Override with KC_ALLOWED_ORIGINS if the
  // team is ever renamed.
  return /^https:\/\/klal-connect-[a-z0-9-]+-izzyarbivs-projects\.vercel\.app$/.test(origin);
};
app.use(cors({
  origin: (origin, cb) => cb(null, isAllowedOrigin(origin)),
  allowedHeaders: ['authorization', 'content-type'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  maxAge: 86400,
}));
app.use(express.json({ limit: '2mb' }));
// A demo instance seeds itself on first request; every cold start is empty.
if (isDemoMode) {
  app.use((req, res, next) => { ensureDemoData().then(() => next(), next); });
}

// Categories keep themselves current on every deployment, demo or not. After
// the demo seed so a fresh instance has its admin first.
app.use((req, res, next) => { ensureCoreCategories().then(() => next(), () => next()); });

app.use(attachUser);

// The shared guest session exists so a visitor can look around without signing
// in — not so that anonymous visitors can post, message and edit one permanent
// account between them. With KC_GUEST_READONLY=1 the guest reads everything a
// member reads, and every write gets a 403 the client can show as "sign in to
// do that". Off by default so a demo stays fully interactive.
const GUEST_READONLY = process.env.KC_GUEST_READONLY === '1';
const GUEST_BLOCKED_AUTH = new Set(['/api/auth/me', '/api/auth/password']);
const isGuest = (user) => !!user && user.email === GUEST_EMAIL;

// The guest is one row shared by every visitor, and before KC_GUEST_READONLY
// existed any visitor could write to it — which is how a real member's name,
// phone and work history ended up on it. So the row's profile fields are never
// trusted: everywhere the guest is read (its own session, the members list,
// the profile route, the author fields on anything it creates) this fixed
// placeholder is used instead. Whatever is stored on the row stays invisible.
const GUEST_PROFILE = { full_name: 'Guest', headline: 'Browsing Klal as a guest', profile_type: 'community_member' };
function maskGuest(user) {
  if (!isGuest(user)) return user;
  const { id, email, role, verified, created_date, updated_date } = user;
  return { id, email, role, verified, created_date, updated_date, ...GUEST_PROFILE };
}
app.use((req, _res, next) => { req.user = maskGuest(req.user); next(); });

// What a session handed to the client looks like: the profile plus a flag the
// UI uses to show "create an account" instead of the guest's own settings.
const sessionUser = (user) => (user ? { ...maskGuest(user), guest: isGuest(user) } : null);

app.use((req, res, next) => {
  if (!GUEST_READONLY || !isGuest(req.user)) return next();
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  // Signing in or registering as someone else is how a visitor stops being the
  // guest, so those must go through even with the guest token attached.
  if (req.path.startsWith('/api/auth/') && !GUEST_BLOCKED_AUTH.has(req.path)) return next();
  const fn = req.path.match(/^\/api\/functions\/([^/]+)$/)?.[1];
  if (fn && publicFunctions.has(fn)) return next();
  res.status(403).json({ error: 'Sign in to do that.', guest: true });
});

// ---------------------------------------------------------------- entities --

// Which entities a signed-out visitor may read. The directory is public by
// design; everything else (messages, notifications, reports…) is not.
const PUBLIC_READ = new Set(['Provider', 'Company', 'Category', 'CommunityNote', 'Vouch', 'FeedPost', 'Comment', 'SkillEndorsement', 'Recommendation', 'Job']);

// Entities that carry a moderation status. Everyone except an admin sees only
// published rows — plus their own submissions, so an author can still find the
// listing they sent to the review queue. Without this, anyone could read the
// pending/hidden/declined queue straight off the API.
const MODERATED = new Set(['Provider', 'Company', 'CommunityNote', 'Job']);

function moderationVisible(row, user) {
  if (row.status === 'published' || row.status === undefined) return true;
  return !!user && row.created_by_id === user.id;
}

// Rows nobody but their owner reads, admins included.
const PERSONAL = new Set(['SavedProvider', 'SavedPost', 'FeedLike', 'CommentVote']);

// Rows a signed-in non-admin may read: either public, their own, or addressed
// to them. Keeps one user's messages out of another's list() call.
const OWNER_SCOPED = {
  Message: (row, user) => row.created_by_id === user.id || row.recipient_id === user.id,
  Notification: (row, user) => row.recipient_id === user.id,
  SavedProvider: (row, user) => row.created_by_id === user.id,
  SavedPost: (row, user) => row.created_by_id === user.id,
  ProviderUsage: (row, user) => row.created_by_id === user.id,
  FeedLike: (row, user) => row.created_by_id === user.id,
  CommentVote: (row, user) => row.created_by_id === user.id,
  Invite: (row, user) => row.created_by_id === user.id,
  // Searches, calls, post views: a member's own trail, nobody else's to read.
  ActivityEvent: (row, user) => row.created_by_id === user.id,
  // An application is between the two people on it: whoever applied, and
  // whoever posted the job — the same shape as a private message.
  JobApplication: (row, user) => row.created_by_id === user.id || row.poster_id === user.id,
  PrivateReport: (row, user) => row.created_by_id === user.id,
  ListingReport: (row, user) => row.created_by_id === user.id,
  ClaimRequest: (row, user) => row.created_by_id === user.id,
  ListingChangeRequest: (row, user) => row.created_by_id === user.id,
};

// Entities the client may write directly. Anything with moderation state or
// counters goes through /functions instead.
// SavedProvider is deliberately absent. A save is the only write here that a
// public counter depends on, and the generic route does not recount: several
// rows created directly for one listing inflated save_count the next time
// anyone toggled a save on it, and a direct delete left the count reading high
// for good. toggleCommunityActivity owns both sides and recounts from the rows,
// so saves go through it. Reading is unaffected — PERSONAL and OWNER_SCOPED
// below still scope a save to the person who made it.
const CLIENT_WRITABLE = new Set([
  'Provider', 'Company', 'Setting', 'Notification', 'Connection',
  'ListingChangeRequest', 'Category', 'ActivityEvent',
  'Recommendation', 'Job',
]);

// What the app is allowed to record about what someone did. Anything that
// affects a count — a post view, a vouch — is written by the server from
// /api/functions, never by the client, so those types are not here. Without
// this list ActivityEvent was simply not writable and every search, listing
// view and tap-to-call was silently refused: the directory had no idea what
// people were looking for.
const CLIENT_EVENTS = new Set(['search', 'profile_view', 'call', 'text', 'share', 'share_whatsapp', 'whatsapp', 'payment_link_click', 'directions']);

// The only notifications a member's own browser may create. Everything else
// is written server-side from /api/functions. Without this list, Notification
// being client-writable meant any member could post arbitrary text to anyone
// — "Klal admin: verify your account at …" — with a forged actor name.
const CLIENT_NOTIFICATION_TYPES = new Set(['save', 'connection_request', 'connection_accept', 'recommendation', 'recommendation_accepted']);

// Entities a moderator works: the review queues and what they moderate.
// A moderator never sees messages, saves, or anyone's private notifications.
const MODERATED_BY_STAFF = new Set(['Provider', 'CommunityNote', 'ClaimRequest', 'ListingChangeRequest', 'ListingReport', 'PrivateReport', 'Job']);
const isModerator = (user) => user?.role === 'moderator';

// Author fields are copied onto rows when they are created (functions.js
// authorFields, sender_name, actor_name…). Rows the guest created before it
// was locked carry whatever name was on its profile at the time, so the mask
// is applied on the way out as well: anything the guest wrote reads as Guest.
const GUEST_AUTHOR = { author_name: GUEST_PROFILE.full_name, author_headline: GUEST_PROFILE.headline, author_avatar_url: '', sender_name: GUEST_PROFILE.full_name, inviter_name: GUEST_PROFILE.full_name, actor_name: GUEST_PROFILE.full_name, actor_headline: '' };

// The shape a row takes on the way to a particular reader.
function present(entity, row, user) {
  let out = row;
  if (row.created_by === GUEST_EMAIL) {
    out = { ...out };
    for (const k of Object.keys(GUEST_AUTHOR)) if (k in out) out[k] = GUEST_AUTHOR[k];
  }
  // How many people saw a post is the author's to know, not the readers'.
  if (entity === 'FeedPost' && user?.role !== 'admin' && row.created_by_id !== user?.id && 'view_count' in out) {
    const { view_count, ...rest } = out;
    out = rest;
  }
  return out;
}

async function readable(entity, rows, user) {
  const out = (await visibleRows(entity, rows, user)).map((row) => present(entity, row, user));
  return entity === 'FeedPost' ? withAuthorRibbons(out) : out;
}

// A post shows its author's photo ribbon (Hiring, Open to work…) as it is
// now, not as it was when they posted: turning "Open to work" off takes it
// off every old post too. So it is looked up on the way out, never stored.
async function withAuthorRibbons(rows) {
  if (!rows.length) return rows;
  const byId = new Map((await users.all()).map((row) => [row.id, row.data?.work_status]));
  return rows.map((row) => {
    const status = row.created_by !== GUEST_EMAIL && byId.get(row.created_by_id);
    return WORK_STATUS_IDS.includes(status) ? { ...row, author_work_status: status } : row;
  });
}

// The guest's id, looked up once per process. Null where there is no guest.
let guestIdPromise = null;
// Cached only once the row is actually found. A rejected lookup already cleared
// itself, but a successful lookup that found nothing resolved to null and `??=`
// then kept that miss for the life of the process: the first call on a cold
// start can arrive before the guest row is seeded, and every call afterwards
// answered null from cache — so the guest mask was quietly off for that
// instance until it recycled.
const guestId = () => (guestIdPromise ??= users.byEmail(GUEST_EMAIL)
  .then((row) => { if (!row?.id) guestIdPromise = null; return row?.id || null; })
  .catch(() => { guestIdPromise = null; return null; }));

async function visibleRows(entity, rows, user) {
  // The demo seed connects the guest to everyone so the demo has something to
  // show; those are nobody's connections and must not count as anyone's —
  // not even on an admin's screen.
  if (entity === 'Connection') {
    const g = await guestId();
    if (g) rows = rows.filter((row) => row.requester_id !== g && row.recipient_id !== g);
    // The accepted graph is public — that is what connection counts and
    // "mutual connections" are made of. A request that is pending or was
    // declined is between the two people on it and nobody else.
    if (user?.role !== 'admin') rows = rows.filter((row) => row.status === 'accepted' || (user && (row.requester_id === user.id || row.recipient_id === user.id)));
  }
  // A recommendation is only public once its subject has accepted it — until
  // then it is between the two people on it, same as a pending connection.
  if (entity === 'Recommendation' && user?.role !== 'admin') {
    rows = rows.filter((row) => row.status === 'accepted' || (user && (row.created_by_id === user.id || row.recipient_id === user.id)));
  }
  // A scheduled post is its author's alone until its time comes, admins
  // included: nobody else can see, share or react to it before then.
  if (entity === 'FeedPost') {
    const now = Date.now();
    rows = rows.filter((row) => !isScheduled(row, now) || (!!user && !isGuest(user) && row.created_by_id === user.id));
  }
  // The guest has no messages, notifications, saves or votes of its own —
  // anything addressed to it would be readable by every visitor at once.
  if (isGuest(user) && OWNER_SCOPED[entity]) return [];
  // Bookmarks and reactions are personal for everyone, an admin included:
  // an admin's Saved page is their own list, not a register of everyone's.
  if (PERSONAL.has(entity)) return rows.filter((row) => !!user && row.created_by_id === user.id);
  if (user?.role === 'admin') return rows;
  if (isModerator(user) && MODERATED_BY_STAFF.has(entity)) return rows;

  // A vouch names the member who gave it and a community note is signed, so on
  // a listing where that must not be public neither row may be readable —
  // hiding the section in the UI is not the rule, any more than hiding the
  // button was. Both entities are in PUBLIC_READ, so without this they were
  // served to anyone who asked for them directly.
  //
  // The case this really exists for is a listing that becomes sensitive after
  // the fact. Sensitivity is read from the listing's own words, so an owner
  // editing their description — or the term list growing, which has already
  // happened once — can turn a listing private long after people vouched for it
  // in public. Those vouches must go private with it, not sit in the API
  // describing who needed the service.
  // Vouches and notes can be switched off site-wide from the admin area. Off
  // means off for anyone asking directly, not just a hidden section; the rows
  // stay, and staff still see them (the note queue lives on them).
  if ((entity === 'Vouch' || entity === 'CommunityNote') && !(await vouchesEnabled())) return [];
  if ((entity === 'Vouch' || entity === 'CommunityNote') && rows.length) {
    const ids = [...new Set(rows.map((row) => row.provider_id).filter(Boolean))];
    const listings = await Promise.all(ids.map((id) => store.get('Provider', id).catch(() => null)));
    const privateIds = new Set(ids.filter((id, i) => isSensitiveListing(listings[i])));
    if (privateIds.size) rows = rows.filter((row) => !privateIds.has(row.provider_id));
  }

  if (!user && !PUBLIC_READ.has(entity)) return [];
  const scope = OWNER_SCOPED[entity];
  let visible = scope ? rows.filter((row) => scope(row, user)) : rows;
  if (MODERATED.has(entity)) visible = visible.filter((row) => moderationVisible(row, user));
  return visible;
}

function canWrite(entity, user, row) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  // An event is a record of something that happened; only an admin rewrites
  // history (and does, when clearing test data).
  if (entity === 'ActivityEvent' && row) return false;
  // Moderators change the state of existing rows in the queues; they do not
  // create listings on anyone's behalf or delete anything.
  if (isModerator(user) && row && MODERATED_BY_STAFF.has(entity)) return true;
  if (!CLIENT_WRITABLE.has(entity)) return false;
  // Settings are platform-wide (e.g. the global Shabbos override) and the
  // category list is the directory's structure — admin only.
  if (entity === 'Setting' || entity === 'Category') return false;
  // A row with no author is not everyone's to edit. The `created_by_id &&`
  // that used to guard this meant server-written rows — every notification
  // notify() creates without an actor — fell through to `return true`, so any
  // member could rewrite or delete any notification by id, including
  // somebody else's.
  // A listing's editor is the owner the team accepted through a claim, and
  // nobody else (see listingEditor). Adding a listing does not make it yours:
  // a community member who added it in good faith can suggest a correction,
  // but a business should not have a stranger editing its own page.
  // owner_id was previously read for self-vouch checks and notification
  // recipients and never consulted here, so a business that claimed its listing
  // still could not change a word of it.
  // The shared guest account creates rows on behalf of every signed-out
  // visitor in a demo instance, so "the member who created it" is not a person
  // there. Anyone could edit any listing a previous visitor had added.
  if (entity === 'Provider' && row) return !isGuest(user) && listingEditor(row) === user.id;
  if (row && row.created_by_id !== user.id) {
    // Notifications are written by the server for a recipient, who may mark
    // them read; that is the one cross-author write we allow.
    return entity === 'Notification' && row.recipient_id === user.id;
  }
  return true;
}

// What the person on the receiving end of a row may change about it, and
// nothing else. A connection request is answered by its recipient (accept or
// decline); a message is marked read by its recipient. Neither may touch any
// other field — the PUT route replaces the body with exactly this patch.
const RECIPIENT_PATCH = {
  Connection: (body) => (['accepted', 'declined'].includes(body?.status) ? { status: body.status } : null),
  Message: (body) => ({ read: !!body?.read }),
  // A recommendation is written about someone, not by them — only the
  // subject decides whether it goes on their profile, the same trust model
  // as a connection request.
  Recommendation: (body) => (['accepted', 'declined'].includes(body?.status) ? { status: body.status } : null),
};
function recipientPatch(entity, user, row, body) {
  const narrow = RECIPIENT_PATCH[entity];
  if (!narrow || !row || row.recipient_id !== user.id || row.created_by_id === user.id) return null;
  return narrow(body);
}

const parseJSON = (value, fallback) => {
  if (value === undefined) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
};

// Everything the client knows how to ask for (src/api/client.js). Anything
// else is a typo or a probe, and gets a 404 rather than a plausible-looking
// empty list.
const ENTITIES = new Set([
  'Provider', 'Company', 'Category', 'Comment', 'CommunityNote', 'Connection',
  'ActivityEvent', 'FeedPost', 'FeedLike', 'Message', 'Notification', 'Setting',
  'SavedProvider', 'ProviderUsage', 'ClaimRequest', 'ListingChangeRequest',
  'ListingReport', 'PrivateReport', 'Vouch', 'CommentVote', 'Invite', 'SavedPost',
  'SkillEndorsement', 'Recommendation', 'Job', 'JobApplication',
]);

app.param('entity', (req, res, next, entity) => {
  if (!ENTITIES.has(entity)) return res.status(404).json({ error: `Unknown entity: ${entity}` });
  next();
});

// Registered before the generic :entity route below, which would otherwise
// shadow it and return an empty list (users don't live in the records table).
app.get('/api/entities/User', async (req, res, next) => {
  const list = await memberList(req.user);
  res.json(req.query.limit ? list.slice(0, Number(req.query.limit)) : list);
});

app.get('/api/entities/:entity', async (req, res, next) => {
  const { entity } = req.params;
  const { sort, limit, query } = req.query;
  const q = parseJSON(query, null);
  let rows = q ? await store.filter(entity, q, sort, null) : await store.list(entity, sort, null);
  // A scheduled post takes its place in the feed at the time it went live, not
  // the time it was written.
  if (entity === 'FeedPost' && (sort || '-created_date') === '-created_date') rows = [...rows].sort(byPostedAtDesc);
  const visible = await readable(entity, rows, req.user);
  res.json(limit ? visible.slice(0, Number(limit)) : visible);
});

app.get('/api/entities/:entity/:id', async (req, res, next) => {
  const row = await store.get(req.params.entity, req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const [visible] = await readable(req.params.entity, [row], req.user);
  if (!visible) return res.status(403).json({ error: 'Not permitted' });
  res.json(visible);
});

// Fields only the server or an admin may set. A listing's author may edit
// their listing, but not publish it, verify it, or inflate its counts.
const PROTECTED_FIELDS = new Set([
  'status', 'verified', 'verified_at', 'verified_by', 'verified_badges', 'claimed', 'demo',
  // owner_id is who may edit the row. A listing's own editor could PUT it to
  // anyone, which hands the page away outside the claim queue entirely.
  'owner_id',
  // The public URL. /provider/:slug resolves by filtering on this field, so a
  // member could set another business's slug on their own listing and serve it
  // at the victim's canonical URL, with their title, OG tags and JSON-LD.
  'slug',
  'save_count', 'usage_count', 'vouch_count', 'created_by_id', 'created_by', 'id',
  // Whether the pin is the building or the middle of its town, as the
  // geocoder reported it. A client that could set it would make a town-centre
  // pin read as the business's door.
  'pin_precise',
  // Prominence and confirmation, which a listing must never grant itself.
  // `featured` was missing here and Provider is client-writable, so an owner
  // could PUT { featured: true } and appear in the directory's "Featured
  // resources" rail — self-assertion buying standing, the same thing we refuse
  // to let payment buy. A forged `last_confirmed_at` is worse than none: it
  // dresses stale details up as checked.
  //
  // The list is shared with listingInput in functions.js rather than repeated,
  // because repeating it is how createListing came to accept all four.
  ...ADMIN_ONLY_LISTING_FIELDS,
]);
const MODERATOR_FIELDS = new Set(['status', 'admin_notes', 'resolved_at', 'resolved_by']);
const stripProtected = (body) => Object.fromEntries(Object.entries(body || {}).filter(([k]) => !PROTECTED_FIELDS.has(k)));

// The status a member's freshly created row starts in, whatever the body
// said. A connection request is pending until its recipient answers; a
// listing or note waits for review; a company page publishes as it always
// has (there is no review queue for companies).
// A row created through the generic route with no status at all reads as
// published to moderationVisible() and to the prerender, so every entity that
// is client-writable needs an entry here. Job was missing: a direct POST
// landed instantly public and skipped createJob's link validation, length
// checks and rate limit entirely.
const CREATE_STATUS = { Connection: 'pending', Provider: 'pending', CommunityNote: 'pending', ListingChangeRequest: 'pending', Company: 'published', Recommendation: 'pending', Job: 'pending' };

app.post('/api/entities/:entity', requireAuth, async (req, res, next) => {
  const { entity } = req.params;
  if (!canWrite(entity, req.user)) return res.status(403).json({ error: 'Not permitted' });
  if (entity === 'ActivityEvent' && req.user.role !== 'admin' && !CLIENT_EVENTS.has(req.body?.type)) {
    return res.status(400).json({ error: 'Unknown event type' });
  }
  let body = req.body || {};
  if (req.user.role !== 'admin') {
    // Without this a direct POST could hand itself an accepted connection, a
    // published listing, or someone else's name as creator.
    body = stripProtected(body);
    if (CREATE_STATUS[entity]) body.status = CREATE_STATUS[entity];
  }
  // A link a visitor is sent to. Validated wherever it can be written, not
  // only through the dedicated function, because Company goes straight
  // through this generic route.
  // Every link that becomes an href a visitor can click. apply_url reaches
  // JobDetail as one, so it is validated here too and not only in createJob.
  for (const field of ['payment_link_url', 'apply_url', 'minyan_url']) {
    if (!(field in body)) continue;
    try { body[field] = safeExternalUrl(body[field]); }
    catch (err) { return res.status(err.statusCode || 400).json({ error: err.message }); }
  }
  // Provider is client-writable, so this route is a third way to create a
  // listing next to createListing and the PUT route — and it was the only one
  // of the three that stored the gallery, logo and badges as sent. A member
  // could post a photo whose "source" was a javascript: link, or a null where
  // a photo belongs, and the listing page threw for every moderator who opened
  // it. The same shaping the PUT route applies, with the same 400 on refusal.
  if (entity === 'Provider') {
    try { body = normalizeListingPatch(body, null, { badgeById: BADGE_BY_ID, badgeApplies: badgeAppliesTo, safeUrl: safeExternalUrl, user: req.user }); }
    catch (err) { return res.status(err.statusCode || 400).json({ error: err.message }); }
  }
  if (entity === 'Connection') {
    const recipient = body.recipient_id ? await users.byId(body.recipient_id) : null;
    if (!recipient || recipient.email === GUEST_EMAIL) return res.status(400).json({ error: 'That member cannot receive connection requests.' });
    if (recipient.id === req.user.id) return res.status(400).json({ error: 'You cannot connect with yourself.' });
    body.requester_id = req.user.id;
  }
  if (entity === 'Notification' && req.user.role !== 'admin') {
    if (!CLIENT_NOTIFICATION_TYPES.has(body.type)) {
      return res.status(400).json({ error: 'Unknown notification type' });
    }
    // The actor is whoever is calling, never whoever they say they are.
    body.actor_id = req.user.id;
    body.actor_name = req.user.full_name || req.user.email;
    body.actor_headline = req.user.headline || '';
  }
  if (entity === 'Recommendation') {
    const recipient = body.recipient_id ? await users.byId(body.recipient_id) : null;
    if (!recipient || recipient.email === GUEST_EMAIL) return res.status(400).json({ error: 'That member cannot receive recommendations.' });
    if (recipient.id === req.user.id) return res.status(400).json({ error: 'You cannot recommend yourself.' });
    const text = String(body.body || '').trim();
    if (text.length < 20) return res.status(400).json({ error: 'Please write at least 20 characters.' });
    if (text.length > 2000) return res.status(400).json({ error: 'Recommendations must be 2000 characters or fewer.' });
    body.body = text;
  }
  const created = await store.create(entity, body, req.user);
  if (entity === 'Setting') forgetSettings();
  res.status(201).json(created);
});

app.put('/api/entities/:entity/:id', requireAuth, async (req, res, next) => {
  const { entity, id } = req.params;
  const existing = await store.get(entity, id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const asRecipient = req.user.role !== 'admin' ? recipientPatch(entity, req.user, existing, req.body) : null;
  if (!asRecipient && !canWrite(entity, req.user, existing)) return res.status(403).json({ error: 'Not permitted' });
  let patch = req.body;
  if (asRecipient) {
    patch = asRecipient;
  } else if (req.user.role !== 'admin') {
    // A moderator on a queue row that is not theirs (a report, a claim, a
    // note) changes exactly its state: the status, their notes, and the
    // resolution stamp. A listing is the exception. The team accounts keep
    // the directory accurate, and narrowing them to status meant the only way
    // to fix a wrong phone number on a listing they had not posted was to
    // claim it — handing a business's page to a staff member. So a moderator
    // edits a listing's content like its editor would, through stripProtected:
    // owner_id, verified, featured and the rest are still refused, which is
    // what keeps a content edit from becoming a transfer or a promotion.
    const ownsRow = existing.created_by_id === req.user.id;
    const pickModeratorFields = () => Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => MODERATOR_FIELDS.has(k)));
    if (isModerator(req.user) && MODERATED_BY_STAFF.has(entity) && entity !== 'Provider' && !ownsRow) {
      patch = pickModeratorFields();
    } else if (isModerator(req.user) && entity === 'Provider') {
      // stripProtected refuses status, so routing a moderator's listing edit
      // through it alone took away the one thing moderators do all day:
      // approving, rejecting and hiding listings from the queues. Each of
      // those returned 200 and changed nothing, and the queue showed the
      // listing as dealt with while it stayed live. The content edit and the
      // queue action are both theirs, so the patch is both: the content
      // fields an editor may set, plus the state fields a moderator may set.
      patch = { ...stripProtected(req.body), ...pickModeratorFields() };
    } else {
      patch = stripProtected(req.body);
    }
  }
  for (const field of ['payment_link_url', 'apply_url', 'minyan_url']) {
    if (!patch || !(field in patch)) continue;
    try { patch = { ...patch, [field]: safeExternalUrl(patch[field]) }; }
    catch (err) { return res.status(err.statusCode || 400).json({ error: err.message }); }
  }
  let reverified = null;
  // Set when this request itself took the pin off, which is what "Remove pin"
  // in the form does by sending both coordinates as null. The re-geocode
  // below must not run then, or the control is a no-op: the row was cleared
  // and the same pin written straight back before the response went out.
  let pinRemoved = false;
  const isStaff = req.user.role === 'admin' || isModerator(req.user);
  // The one field whose misuse moves money. Staff may fix anything else on a
  // listing for the business; where its payments go stays with the business.
  if (entity === 'Provider' && 'payment_link_url' in (patch || {}) && !canSetPaymentLink(existing, req.user)) {
    return res.status(403).json({ error: 'Only the business that owns this listing can change its payment link.' });
  }
  if (entity === 'Provider') {
    try { patch = normalizeListingPatch(patch, existing, { badgeById: BADGE_BY_ID, badgeApplies: badgeAppliesTo, safeUrl: safeExternalUrl, user: req.user }); }
    catch (err) { return res.status(err.statusCode || 400).json({ error: err.message }); }
    if ('latitude' in patch || 'longitude' in patch) {
      if (hasCoordinate(patch.latitude) && hasCoordinate(patch.longitude)) {
        // A pin the person placed, or picked from the town list. The
        // geocoder's precision flag described a pin the geocoder chose, not
        // this one, so it comes off rather than mislabel the new pin.
        patch = { ...patch, latitude: Number(patch.latitude), longitude: Number(patch.longitude), pin_precise: null };
      } else {
        // Half a pair, or empty strings, is no pin either; store it as none
        // rather than as values the map cannot draw. Only an explicit null
        // pair is the person asking for no pin: an empty string is a missing
        // value, and a missing value is still worth geocoding.
        pinRemoved = patch.latitude === null && patch.longitude === null;
        patch = { ...patch, latitude: null, longitude: null, pin_precise: null };
      }
    }
    // A moved business loses the old address's pin whoever moved it. Staff are
    // the people who correct addresses, and skipping them here left a
    // Brooklyn address drawn at Lakewood coordinates after every such fix.
    const repinned = pinAfterEdit(patch, existing);
    if (repinned) patch = { ...patch, ...repinned };
    // Staff edit a listing in order to correct it, so their edit is not what
    // invalidates the check they themselves made.
    if (!isStaff) {
      reverified = verificationAfterEdit(patch, existing);
      if (reverified) patch = { ...patch, ...reverified.fields };
    }
  }
  let updated = await store.update(entity, id, patch);
  if (entity === 'Setting') forgetSettings();
  // A listing left without a pin — because it never had one, or because
  // pinAfterEdit just cleared a stale one off a new address — gets a fresh
  // one from the address it has now. Not when the person just removed it.
  if (entity === 'Provider' && !pinRemoved) {
    const pin = await pinForListing(updated);
    if (pin) updated = await store.update(entity, id, pin);
  }
  // A verified listing that changed identity is a thing a moderator has to be
  // able to find, since the mark they granted has just come off.
  if (reverified) {
    await store.create('ActivityEvent', { type: 'listing_identity_change', entity: 'Provider', target_id: id, fields: reverified.changed.join(','), was_verified: !!existing.verified }, req.user);
  }
  // Staff rewriting a page that is not theirs — a phone number, a payment
  // link, an address — is a write the business never sees happen. Claim
  // approvals and status changes already leave a trace; this one did not, so
  // nothing recorded who changed what. The status fields are the moderation
  // event's below, so only the content fields that actually changed go here.
  if (entity === 'Provider' && isStaff && listingEditor(existing) !== req.user.id) {
    const differs = (k) => JSON.stringify(patch[k] ?? null) !== JSON.stringify(existing[k] ?? null);
    const fields = Object.keys(patch).filter((k) => !MODERATOR_FIELDS.has(k) && differs(k));
    if (fields.length) {
      await store.create('ActivityEvent', { type: 'staff_edit', entity: 'Provider', target_id: id, fields: fields.join(','), actor_role: req.user.role }, req.user);
    }
  }
  // Every status change by staff leaves a trace: who, what, from, to.
  if (MODERATED.has(entity) || MODERATED_BY_STAFF.has(entity)) {
    if (patch.status !== undefined && patch.status !== existing.status && (req.user.role === 'admin' || isModerator(req.user))) {
      await store.create('ActivityEvent', { type: 'moderation', entity, target_id: id, from: existing.status || null, to: patch.status, actor_role: req.user.role }, req.user);
    }
  }
  res.json(updated);
});

app.delete('/api/entities/:entity/:id', requireAuth, async (req, res, next) => {
  const { entity, id } = req.params;
  const existing = await store.get(entity, id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (isModerator(req.user) && existing.created_by_id !== req.user.id) return res.status(403).json({ error: 'Moderators cannot delete.' });
  if (!canWrite(entity, req.user, existing)) return res.status(403).json({ error: 'Not permitted' });
  await store.delete(entity, id);
  res.json({ ok: true });
});

app.post('/api/entities/:entity/update-many', requireAuth, async (req, res, next) => {
  const { entity } = req.params;
  const { query = {}, update = {} } = req.body || {};
  if (!canWrite(entity, req.user)) return res.status(403).json({ error: 'Not permitted' });

  // Bulk updates exist for exactly one thing: marking your own notifications
  // read. Scoping everything else by created_by_id walked straight past the
  // single-row rules, because created_by_id is not always who may write the row.
  // After a claim is approved the original author is still created_by_id on the
  // listing while owner_id is the business — so the author could bulk-patch a
  // listing that is no longer theirs, through a route that never asked canWrite
  // about that specific row, while the PUT route correctly refused them.
  if (req.user.role !== 'admin' && entity !== 'Notification') {
    return res.status(403).json({ error: 'Not permitted' });
  }
  // Non-admins may only bulk-update their own rows (used to mark notifications read).
  const scoped = req.user.role === 'admin'
    ? query
    : { ...query, ...(entity === 'Notification' ? { recipient_id: req.user.id } : { created_by_id: req.user.id }) };
  // The same field guard the single-row routes apply. Without it this route
  // was a way around every one of them: scoping to your own rows still let
  // you accept a connection request you had sent yourself, publish and
  // verify your own pending listing, inflate its counters, or push live a
  // recommendation you wrote about somebody else.
  const patch = req.user.role === 'admin' ? update : stripProtected(update);
  res.json({ updated: await store.updateMany(entity, scoped, patch) });
});

// ------------------------------------------------------------------- users --

function publicProfile(user) {
  if (!user) return null;
  // Never hand a member's contact details, location or Shabbos configuration
  // to other users. The profile page shows the rest.
  const {
    email, phone, latitude, longitude, timezone, country_code,
    candle_lighting_offset_minutes, havdalah_method, shabbos_full_lock, shabbos_mode_source,
    ...safe
  } = user;
  return safe;
}

// A deactivated account stays in the table (its posts and messages still point
// at it) but is nobody's business except an admin's.
const isDisabled = (user) => user.disabled === true;

// The seeded bootstrap admin. Real to the database, not a person anyone should
// find in the member list — it showed up in People as "Demo Admin", which
// reads exactly as unfinished as it sounds.
const DEMO_EMAIL = (process.env.KC_DEMO_EMAIL || 'demo@klal.app').toLowerCase();
const isSeedAdmin = (user) => String(user?.email || '').toLowerCase() === DEMO_EMAIL;

// An account with no name yet is not someone to connect with either. Since
// the name became optional at sign-up, anyone who registers and stops before
// onboarding showed up in People as a blank row with a Connect button — which
// is how a throwaway test account ended up listed as a member of the
// community. They appear as soon as they enter a name.
const isNameless = (user) => !String(user?.full_name || '').trim();

async function memberList(viewer) {
  const all = (await users.all()).map(userToPublic);
  if (viewer?.role === 'admin') return all;
  // The guest is a session, not a member: it is not someone to connect with.
  return all.filter((u) => !isDisabled(u) && !isGuest(u) && !isSeedAdmin(u) && !isNameless(u)).map(publicProfile);
}

// requireAuth, because this is the whole member directory — every name,
// headline, photo and city. It was readable by anyone on the internet with one
// unauthenticated GET, which is a scraped community list, not a public page.
// Browsing still works without an account: a visitor holds the shared guest
// session, which is a real token, so nothing about the signed-out experience
// changes — it just stops being available to a script that never loaded the app.
app.get('/api/users', requireAuth, async (req, res, next) => {
  const list = await memberList(req.user);
  res.json(req.query.limit ? list.slice(0, Number(req.query.limit)) : list);
});

// Admin only: hand a locked-out member a temporary password. Shown once to
// the admin, never stored in the clear, and every use is audited. This is
// the way back in while there is no email to send a reset code to.
app.post('/api/users/:id/reset-password', requireAdmin, async (req, res, next) => {
  const target = await users.byId(req.params.id);
  if (!target) return res.status(404).json({ error: 'Not found' });
  if (target.email === GUEST_EMAIL) return res.status(400).json({ error: 'The guest account has no password to reset.' });
  const temp = tempPassword();
  await users.update(target.id, { password_hash: hashPassword(temp) });
  await store.create('ActivityEvent', { type: 'password_reset', target_id: target.id, by: 'admin' }, req.user);
  res.json({ temp_password: temp, email: target.email });
});

// Admin only: the basic profile fields, and deactivation. Not role (its own
// route), not email, not password.
const ADMIN_PROFILE_FIELDS = new Set(['full_name', 'headline', 'bio', 'home_city', 'phone', 'avatar_url', 'banner_url', 'work_experience', 'profile_type', 'disabled', 'verified']);
app.put('/api/users/:id', requireAdmin, async (req, res, next) => {
  const target = await users.byId(req.params.id);
  if (!target) return res.status(404).json({ error: 'Not found' });
  const patch = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => ADMIN_PROFILE_FIELDS.has(k)));
  if (target.id === req.user.id && patch.disabled) return res.status(400).json({ error: 'You cannot deactivate yourself.' });
  const updated = await users.update(target.id, patch);
  await store.create('ActivityEvent', { type: 'profile_edit', target_id: target.id, fields: Object.keys(patch), by: 'admin' }, req.user);
  res.json(userToPublic(updated));
});

const tempPassword = () => {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(12);
  let s = '';
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return `Klal-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
};

// Admin only: user | moderator | admin. You cannot change your own role, so
// there is always at least the admin who is doing the changing.
const ROLES = new Set(['user', 'moderator', 'admin']);
app.put('/api/users/:id/role', requireAdmin, async (req, res, next) => {
  const { role } = req.body || {};
  if (!ROLES.has(role)) return res.status(400).json({ error: 'Role must be user, moderator or admin.' });
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'You cannot change your own role.' });
  const target = await users.byId(req.params.id);
  if (!target) return res.status(404).json({ error: 'Not found' });
  if (target.email === GUEST_EMAIL) return res.status(400).json({ error: 'The guest account cannot have a role.' });
  const updated = await users.update(target.id, { role });
  await store.create('ActivityEvent', { type: 'role_change', target_id: target.id, from: target.role, to: role }, req.user);
  res.json(userToPublic(updated));
});

// Same reasoning as the list above: one profile at a time is still the same
// directory, just fetched in a loop.
app.get('/api/users/:id', requireAuth, async (req, res, next) => {
  const user = userToPublic(await users.byId(req.params.id));
  const isAdmin = req.user?.role === 'admin';
  const isSelfOrAdmin = req.user && user && (req.user.id === user.id || isAdmin);
  if (!user || (isDisabled(user) && !isSelfOrAdmin)) return res.status(404).json({ error: 'Not found' });
  // Only an admin (who may need to scrub it) sees what is stored on the guest row.
  if (isGuest(user) && !isAdmin) return res.status(404).json({ error: 'Not found' });
  res.json(isSelfOrAdmin ? user : publicProfile(user));
});

// -------------------------------------------------------------------- auth --

// Public runtime config: what the browser needs to know before it renders,
// none of it secret. Kept server-side so any of it can change with an env var
// instead of a rebuild.
//
// GOOGLE_MAPS_BROWSER_KEY is meant to ship to the client — restrict it in the
// Cloud console to this site's referrers and to the Maps JavaScript API only.
// The server-side geocoding key (KC_GEOCODER_KEY) is a different key and never
// leaves this process.
app.get('/api/config', async (_req, res) => res.json({
  // Visitors get a read-only shared guest session so the whole site is
  // browsable without an account. Named for what it is; "demo mode" made
  // more than one reviewer think the site was a sandbox.
  guestBrowsing: isDemoMode,
  // Public by design: Google's client id identifies the app, it is not a secret.
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleMapsKey: process.env.GOOGLE_MAPS_BROWSER_KEY || '',
  googleMapsMapId: process.env.GOOGLE_MAPS_MAP_ID || '',
  tileUrl: process.env.KC_TILE_URL || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  tileAttribution: process.env.KC_TILE_ATTRIBUTION || '&copy; OpenStreetMap contributors',
  geocoder: GEO_PROVIDER,
  // Whether a city can be looked up at all. The curated community list makes
  // this true even with no provider key, so the client can stop treating
  // location as unavailable.
  placeLookup: true,
  guestReadOnly: GUEST_READONLY,
  // Hidden entirely until a Google Cloud Translation key exists — see
  // translateText in functions.js.
  translateEnabled: translateEnabled(),
  translateLanguages: TRANSLATE_LANGUAGES,
  // The admin switch for vouches and community notes (server/settings.js).
  vouchesEnabled: await vouchesEnabled(),
}));

// Issues a session for the shared guest account so a visitor can browse the
// signed-in parts of the app without a login wall.
//
// Only mounted when KC_DEMO_MODE is on. Everyone who lands here shares one
// account, which is why KC_GUEST_READONLY exists (see the middleware above).
if (isDemoMode) {
  app.post('/api/auth/demo-session', async (_req, res, next) => {
    try {
      const guest = await users.byEmail(GUEST_EMAIL);
      if (!guest) return res.status(503).json({ error: 'Demo data is still loading.' });
      res.json({ access_token: signToken(guest), user: sessionUser(userToPublic(guest)) });
    } catch (err) {
      next(err);
    }
  });
}

app.get('/api/auth/me', requireAuth, (req, res) => res.json(sessionUser(req.user)));

app.put('/api/auth/me', requireAuth, async (req, res, next) => {
  // A zone the platform does not know used to be storable, and then threw
  // from inside the Hebrew calendar on every read — taking the Shabbos status
  // endpoint and every write down with it, with no way back in through the UI.
  if (req.body?.timezone && !isValidTimeZone(req.body.timezone)) {
    return res.status(400).json({ error: `"${req.body.timezone}" is not a time zone. Use a name like Asia/Jerusalem or America/New_York.` });
  }
  // Every visitor shares the guest; letting one of them write its profile is
  // how another member's details end up shown to everyone. Refused regardless
  // of KC_GUEST_READONLY.
  if (isGuest(req.user)) return res.status(403).json({ error: 'Create an account to have a profile of your own.', guest: true });
  // Role and verification are server-owned; a user cannot promote themselves.
  const { role, verified, password_hash, email, id, ...safe } = req.body || {};
  // Free text a member can otherwise fill their profile with unbounded, one
  // entry per line of a chip input — capped and de-duplicated (case-insensitive,
  // first spelling wins) so the skills section cannot become a spam dumping
  // ground or silently double-count "Excel" and "excel" as different skills.
  if (Array.isArray(safe.skills)) {
    const seen = new Set();
    safe.skills = safe.skills
      .map((s) => String(s || '').trim())
      .filter((s) => {
        if (!s || s.length > 40) return false;
        const key = s.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 30);
  }
  // The booking button is an href every visitor can click, so only a real
  // http(s) link is stored, and the wording is one of the fixed choices.
  if ('booking_url' in safe) {
    try { safe.booking_url = safeExternalUrl(withScheme(safe.booking_url)); }
    catch (err) { return res.status(err.statusCode || 400).json({ error: err.message }); }
  }
  if ('booking_label' in safe && !BOOKING_LABELS.includes(safe.booking_label)) safe.booking_label = DEFAULT_BOOKING_LABEL;
  // The photo ribbon is one of the fixed designs, or none.
  if ('work_status' in safe && !WORK_STATUS_IDS.includes(safe.work_status)) safe.work_status = '';
  res.json(userToPublic(await users.update(req.user.id, safe)));
});

// "Continue with Google": the browser hands us the ID token Google issued
// for our client id; we check it with Google, then sign in the account with
// that (Google-verified) email or create it. No password, no code.
async function verifyGoogleToken(credential) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) { const e = new Error('Google sign-in is not configured.'); e.statusCode = 501; throw e; }
  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(String(credential || ''))}`);
  const info = await res.json().catch(() => ({}));
  const ok = res.ok && info.aud === clientId && ['accounts.google.com', 'https://accounts.google.com'].includes(info.iss)
    && info.email && String(info.email_verified) === 'true' && Number(info.exp) * 1000 > Date.now();
  if (!ok) { const e = new Error('Google could not confirm that sign-in. Please try again.'); e.statusCode = 401; throw e; }
  return { email: String(info.email).trim().toLowerCase(), name: info.name || '', picture: info.picture || '', sub: info.sub };
}

app.post('/api/auth/google', async (req, res, next) => {
  try {
    const { credential, invite_code } = req.body || {};
    const g = await verifyGoogleToken(credential);
    let row = await users.byEmail(g.email);
    let created = false;
    if (row) {
      if (row.email === GUEST_EMAIL) return res.status(400).json({ error: 'That account cannot be used.' });
      if (row.data?.disabled) return res.status(403).json({ error: 'This account has been deactivated.' });
      // Google vouches for the address: an unverified email/password account
      // is verified by this, and remembers its Google id.
      row = await users.update(row.id, { verified: true, google_sub: g.sub, ...(row.data?.avatar_url ? {} : (g.picture ? { avatar_url: g.picture } : {})) });
    } else {
      const invited = invite_code ? await findInviteByCode(invite_code) : null;
      const invitedBy = invited ? { invited_by_id: invited.created_by_id, invited_by_name: invited.inviter_name || '' } : {};
      const role = (await users.all()).length === 0 ? 'admin' : 'user';
      row = await users.create({ email: g.email, password_hash: null, role, verified: true, full_name: g.name, avatar_url: g.picture, google_sub: g.sub, ...invitedBy });
      await acceptInvite(invited, row);
      created = true;
    }
    res.status(created ? 201 : 200).json({ access_token: signToken(row), user: sessionUser(userToPublic(row)), created });
  } catch (err) { next(err); }
});

// A signed-in member changes their own password. Needs the current one, so
// a session left open on a shared device cannot lock the owner out.
app.put('/api/auth/password', requireAuth, async (req, res, next) => {
  const { current_password, new_password } = req.body || {};
  if (String(new_password || '').length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
  const row = await users.byId(req.user.id);
  if (!checkPassword(current_password, row.password_hash)) return res.status(400).json({ error: 'Your current password is not right' });
  await users.update(row.id, { password_hash: hashPassword(new_password) });
  res.json({ ok: true });
});

app.post('/api/auth/login', async (req, res, next) => {
  const { password } = req.body || {};
  const email = normalizeEmail(req.body?.email);
  const row = await users.byEmail(email);
  if (!row || !checkPassword(password, row.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  // `row` is the raw database row here, so the flag lives under data — and a
  // deactivated account must not be able to sign back in. Until this check
  // existed, deactivation removed the profile from listings while the
  // password went on working.
  if (row.data?.disabled === true) {
    return res.status(403).json({ error: 'This account has been deactivated. Please contact us if you think that is a mistake.' });
  }
  // An account that registered while email was on but never entered its code
  // is not in yet. A fresh code goes out and the client shows the same
  // verification screen sign-up uses. Accounts created before a mail provider
  // existed were marked verified at creation, so nobody is locked out by this.
  if (!row.verified && canDeliverCodes()) {
    const code = await otp.issue(String(email).trim(), 'verify');
    return res.status(403).json(withDevCode({ error: 'Please verify your email address first. We just sent you a new code.', verification_required: true }, await deliverCode(email, 'verify', code)));
  }
  res.json({ access_token: signToken(row), user: userToPublic(row) });
});

// Public, unauthenticated: who an invite link is from, so the join page can
// say "Miriam invited you" before there is an account. Names only.
app.get('/api/invites/:code', async (req, res, next) => {
  try {
    // Resolved through aliases too, and the current code is what goes back,
    // so a visitor who followed an old link sees the name the inviter chose.
    const invite = await findInviteByCode(req.params.code);
    if (!invite) return res.status(404).json({ error: 'That invite link is not valid.' });
    res.json({ code: invite.code, inviter_name: invite.inviter_name || 'A community member', for_business: invite.provider_name || null });
  } catch (err) { next(err); }
});

// One spelling of an address, everywhere. The unique index is on lower(email)
// and lookups are case-insensitive, but the row itself used to keep whatever
// casing the form sent, so the same person could look like two people.
const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

// A code costs an email and can be used to pester someone; one per minute per
// address, and a fresh one only when the last is nearly spent.
// deliverCode() hands a code back only in local dev. Outside dev the key is
// left off the response altogether rather than sent as null, so a client (or a
// bundle scan) never sees a `dev_code` field in production.
const withDevCode = (payload, code) => (code ? { ...payload, dev_code: code } : payload);

const RESEND_COOLDOWN_MS = 60_000;
async function throttleCode(email, purpose, res) {
  const issued = await otp.issuedAt(normalizeEmail(email), purpose).catch(() => null);
  if (issued && Date.now() - issued < RESEND_COOLDOWN_MS) {
    const wait = Math.ceil((RESEND_COOLDOWN_MS - (Date.now() - issued)) / 1000);
    res.status(429).json({ error: `Please wait ${wait} second${wait === 1 ? '' : 's'} before asking for another code.` });
    return true;
  }
  return false;
}

app.post('/api/auth/register', async (req, res, next) => {
  const { password, full_name, invite_code } = req.body || {};
  const email = normalizeEmail(req.body?.email);
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(400).json({ error: 'That does not look like an email address' });
  if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (await users.byEmail(email)) return res.status(409).json({ error: 'That email is already registered' });

  // First account bootstraps the admin; there is no other way in yet.
  const role = (await users.all()).length === 0 ? 'admin' : 'user';

  // Until a mail provider is wired up (KC_EMAIL_DELIVERY=real) nobody can
  // receive a verification code, so a new account is signed in straight away
  // rather than parked on a screen waiting for an email that never comes.
  // Login never required verification anyway; this just stops pretending.
  // An invite link, if the visitor arrived through one. Recorded on both
  // sides so the profile can say "Invited by" and the inviter gets credit.
  const invited = invite_code ? await findInviteByCode(invite_code) : null;
  const invitedBy = invited ? { invited_by_id: invited.created_by_id, invited_by_name: invited.inviter_name || '' } : {};

  if (!canDeliverCodes()) {
    const row = await users.create({ email, password_hash: hashPassword(password), role, verified: true, full_name: full_name || '', ...invitedBy });
    await acceptInvite(invited, row);
    return res.status(201).json({ ok: true, otp_sent: false, access_token: signToken(row), user: sessionUser(userToPublic(row)) });
  }

  const row = await users.create({ email, password_hash: hashPassword(password), role, verified: 0, full_name: full_name || '', ...invitedBy });
  await acceptInvite(invited, row);
  const code = await otp.issue(String(email).trim(), 'verify');
  res.status(201).json(withDevCode({ ok: true, otp_sent: true }, await deliverCode(email, 'verify', code)));
});

// Marks an invite as joined and tells the inviter. Invite rows are reusable
// links (one per member), so this appends to a list rather than closing it.
async function acceptInvite(invite, newUser) {
  if (!invite) return;
  const joined = [...(invite.joined_user_ids || []), newUser.id];
  await store.update('Invite', invite.id, { joined_user_ids: joined, joined_count: joined.length });
  if (invite.created_by_id && invite.created_by_id !== newUser.id) {
    await store.create('Notification', {
      recipient_id: invite.created_by_id, read: false, type: 'invite_joined',
      actor_name: newUser.data?.full_name || newUser.email,
      target_type: 'user', target_id: newUser.id,
      message: `${newUser.data?.full_name || 'Someone'} joined Klal from your invite`,
    }, { id: newUser.id, email: newUser.email });
  }
}

// A six-digit code with a fifteen-minute window and no ceiling on guesses is
// a million tries wide and unauthenticated — enough to take an account over
// by looping /auth/reset-password. Issuing was throttled; verifying was not.
//
// Counted in the shared key-value table rather than a new column, so it holds
// across serverless instances without a migration.
const CODE_ATTEMPT_LIMIT = 8;
const CODE_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const attemptKey = (email, purpose) => `otp-attempts:${purpose}:${String(email || '').trim().toLowerCase()}`;

async function tooManyCodeAttempts(email, purpose, res) {
  const used = Number(await geoCache.get(attemptKey(email, purpose)).catch(() => 0)) || 0;
  if (used < CODE_ATTEMPT_LIMIT) return false;
  res.status(429).json({ error: 'Too many incorrect codes. Request a new one and try again.' });
  return true;
}
const recordCodeAttempt = async (email, purpose) => {
  const key = attemptKey(email, purpose);
  const used = Number(await geoCache.get(key).catch(() => 0)) || 0;
  await geoCache.set(key, used + 1, CODE_ATTEMPT_WINDOW_MS).catch(() => {});
};
const clearCodeAttempts = (email, purpose) => geoCache.set(attemptKey(email, purpose), 0, 1000).catch(() => {});

app.post('/api/auth/verify-otp', async (req, res, next) => {
  const { otpCode } = req.body || {};
  const email = normalizeEmail(req.body?.email);
  if (await tooManyCodeAttempts(email, 'verify', res)) return;
  if (!(await otp.verify(String(email || '').trim(), 'verify', otpCode))) {
    await recordCodeAttempt(email, 'verify');
    return res.status(400).json({ error: 'That code is incorrect or has expired' });
  }
  await clearCodeAttempts(email, 'verify');
  const row = await users.byEmail(email);
  if (!row) return res.status(404).json({ error: 'Account not found' });
  await users.update(row.id, { verified: true });
  res.json({ access_token: signToken(row), user: userToPublic(await users.byId(row.id)) });
});

app.post('/api/auth/resend-otp', async (req, res, next) => {
  const email = normalizeEmail(req.body?.email);
  if (!(await users.byEmail(email))) return res.json({ ok: true }); // don't reveal who is registered
  if (await throttleCode(email, 'verify', res)) return;
  const code = await otp.issue(String(email).trim(), 'verify');
  res.json(withDevCode({ ok: true }, await deliverCode(email, 'verify', code)));
});

app.post('/api/auth/reset-password-request', async (req, res, next) => {
  const email = normalizeEmail(req.body?.email);
  if (!canDeliverCodes()) {
    return res.status(503).json({ error: 'Password reset by email is not available yet. Please contact us and we will reset it for you.' });
  }
  if (!(await users.byEmail(email))) return res.json({ ok: true });
  if (await throttleCode(email, 'reset', res)) return;
  const code = await otp.issue(String(email).trim(), 'reset');
  res.json(withDevCode({ ok: true }, await deliverCode(email, 'reset', code)));
});

app.post('/api/auth/reset-password', async (req, res, next) => {
  const { resetToken, newPassword } = req.body || {};
  const email = normalizeEmail(req.body?.email);
  if (!email) return res.status(400).json({ error: 'Enter the email address the reset code was sent to' });
  if (String(newPassword || '').length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  if (await tooManyCodeAttempts(email, 'reset', res)) return;
  if (!(await otp.verify(String(email || '').trim(), 'reset', resetToken))) {
    await recordCodeAttempt(email, 'reset');
    return res.status(400).json({ error: 'That reset code is incorrect or has expired' });
  }
  await clearCodeAttempts(email, 'reset');
  const row = await users.byEmail(email);
  if (!row) return res.status(404).json({ error: 'Account not found' });
  await users.update(row.id, { password_hash: hashPassword(newPassword) });
  res.json({ ok: true });
});

// --------------------------------------------------------------- functions --

app.post('/api/functions/:name', async (req, res, next) => {
  const { name } = req.params;
  // Own properties only: `functions[name]` also answered to 'constructor',
  // 'toString' and friends, so /api/functions/constructor resolved to
  // something callable rather than a clean 404.
  const fn = Object.hasOwn(functions, name) ? functions[name] : undefined;
  if (!fn) return res.status(404).json({ error: `Unknown function: ${name}` });
  if (!publicFunctions.has(name) && !req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    res.json(await fn(req.body || {}, req.user));
  } catch (err) {
    res.status(err.statusCode || 500).json({
      error: err.message || 'Something went wrong',
      ...(err.verification_required ? { verification_required: true } : {}),
    });
  }
});

// ----------------------------------------------------------------- uploads --

// Buffered in memory rather than written to disk: on a serverless host there
// is no durable disk to write to, and the storage layer needs the bytes anyway.
//
// 4MB, not 8: Vercel rejects any request body over 4.5MB at the platform edge
// with an opaque 413 before the function runs. Staying under that means the
// user gets our message instead of a Vercel error page.
const MAX_UPLOAD_MB = Number(process.env.KC_MAX_UPLOAD_MB || 4);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

app.post('/api/upload', requireAuth, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: `Please choose an image file under ${MAX_UPLOAD_MB}MB.` });
    res.json({ file_url: await putFile(req.file.buffer, req.file.mimetype) });
  } catch (err) { next(err); }
});

// Only meaningful for the local-disk backend; with object storage the browser
// fetches the file straight from the storage host.
if (!usingObjectStorage) {
  app.use('/api/files', express.static(UPLOAD_DIR, { maxAge: '7d' }));
}

// ------------------------------------------------------------- geocoding --

// Signed-in only: an open geocoding proxy would let anyone burn the app's
// provider quota, and every caller in the app is already authenticated.
app.get('/api/geo/reverse', requireAuth, async (req, res, next) => {
  try {
    res.json(await reverseGeocode(req.query.lat, req.query.lon));
  } catch (err) { next(err); }
});

app.get('/api/geo/search', requireAuth, async (req, res, next) => {
  try {
    res.json(await searchPlaces(req.query.q, req.query.limit));
  } catch (err) { next(err); }
});

// The time zone at a point, for a shul page working out its next minyan.
// Public, unlike the routes above: listing pages are, and this is a lookup in
// a table shipped with the app, so there is no provider quota to protect.
app.get('/api/geo/tz', (req, res) => {
  const lat = Number(req.query.lat), lon = Number(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return res.status(400).json({ error: 'lat and lon are required' });
  res.set('Cache-Control', 'public, max-age=86400');
  res.json({ timezone: tzFor(lat, lon) || '' });
});

// Coarse fallback when the browser's geolocation is denied or unavailable.
app.get('/api/geo/ip', requireAuth, async (req, res, next) => {
  try {
    // req.ip honours the trust-proxy setting below, so a spoofed
    // X-Forwarded-For is only believed when we are actually behind a proxy.
    res.json(await geolocateIp(req.ip));
  } catch (err) { next(err); }
});

// What needs attention before and after launch, in one call. Admin only: it
// names members and their addresses.
app.get('/api/admin/health', requireAdmin, async (_req, res, next) => {
  try { res.json(await healthReport()); } catch (err) { next(err); }
});

// ------------------------------------------------------------------- seo --

app.get('/sitemap.xml', async (req, res, next) => {
  try {
    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
    res.send(await sitemap(siteOrigin(req)));
  } catch (err) { next(err); }
});

app.get('/robots.txt', (req, res) => {
  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=0, s-maxage=86400');
  res.send(robots(siteOrigin(req)));
});

app.get('/api/health', async (_req, res, next) => {
  try {
    // build goes first: the commonest question asked of this endpoint is
    // whether a deploy actually landed.
    res.json({ ok: true, build: BUILD, users: (await users.all()).length, providers: await store.count('Provider') });
  } catch (err) { next(err); }
});

// An /api path that matched nothing is a client mistake, and the client
// parses JSON — Express's default HTML error page would surface as a parse
// error instead of the status.
app.use('/api', (req, res) => res.status(404).json({ error: `No such endpoint: ${req.method} ${req.originalUrl.split('?')[0]}` }));

// Public pages, rendered with their own title, description and schema. Last,
// so nothing above is shadowed.
mountSeo(app, SHELL);

app.use((err, _req, res, _next) => {
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: `That image is too large. Please choose one under ${MAX_UPLOAD_MB}MB.` });
  }
  // A 4xx is the API doing its job — a refused sign-in, a 404 — and logging a
  // stack for each one buries the 5xx that actually need looking at.
  const status = err.statusCode || 500;
  if (status >= 500) console.error('[api]', err);
  else console.warn(`[api] ${status} ${err.message}`);
  res.status(status).json({ error: err.message || 'Server error' });
});

export default app;
