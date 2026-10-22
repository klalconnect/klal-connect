// Server-side business logic, reached from the app via api.functions.invoke().
//
// These are functions rather than plain entity writes because each enforces
// something the client must not be trusted with: moderation status, ownership,
// counter integrity, or the Shabbos write-gate.
import { store, users, userToPublic, GUEST_EMAIL } from './db.js';
import { computeShabbosStatus, assertWritable as assertShabbosWritable } from './shabbos.js';
import { canDeliverCodes } from './auth.js';
import { pinForListing, tzFor } from './geocode.js';
import { normalizeMinyanim } from '../src/lib/minyanim.js';
import { normalizeKitchen } from '../src/lib/kitchen.js';
import { vouchesEnabled } from './settings.js';
import { translate } from './translate.js';
import { BADGES, badgeAppliesTo } from '../src/lib/badges.js';
import { isSensitiveListing } from '../src/lib/sensitivity.js';
import { ADMIN_ONLY_LISTING_FIELDS } from '../src/lib/trust.js';
import { canEditListing, canSetPaymentLink, normalizeGallery, normalizeLogoUrl } from '../src/lib/listing.js';
import { REACTION_BY_ID, DEFAULT_REACTION, reactionOf } from '../src/lib/reactions.js';
import { POST_REPORT_REASON_BY_ID, postExcerpt } from '../src/lib/postTypes.js';
import { isScheduled, MAX_SCHEDULE_DAYS } from '../src/lib/scheduledPosts.js';
import { celebrationOf, thisMonth, canAnnounce, JOB_FIELD_MAX } from '../src/lib/celebrations.js';

const BADGE_BY_ID = Object.fromEntries(BADGES.map((b) => [b.id, b]));

// Anyone can look around; creating something under someone else's email is
// what verification prevents. Only bites where a code can actually be
// delivered — otherwise an account could never clear it. Bundled with the
// Shabbos check so every business function keeps calling one gate.
function assertVerified(user) {
  if (!canDeliverCodes()) return;
  if (user && user.verified === false) {
    const err = new Error('Please confirm your email address first — check your inbox for the code we sent.');
    err.statusCode = 403;
    err.verification_required = true;
    throw err;
  }
}

async function assertWritable(user, now) {
  assertVerified(user);
  await assertShabbosWritable(user, now);
}

// Listings and positive notes go live the moment they are submitted. Admins
// and moderators can still hide, archive or reject anything from the queues,
// and reports still come in privately. KC_REVIEW_LISTINGS=1 brings back the
// hold-for-approval step if the community ever needs it.
const REVIEW_FIRST = process.env.KC_REVIEW_LISTINGS === '1';
const INITIAL_STATUS = REVIEW_FIRST ? 'pending' : 'published';

// The composer's ids (src/lib/postTypes.js). `update` was an older spelling of
// `post` and still exists on seeded rows, so it is folded in rather than
// rejected — otherwise the "Updates" filter never matched those posts.
const POST_TYPES = new Set(['post', 'question', 'insight', 'promotion', 'new_job']);
const EMPLOYMENT_TYPES = new Set(['full_time', 'part_time', 'contract', 'seasonal', 'volunteer']);
const postType = (value) => (value === 'update' ? 'post' : POST_TYPES.has(value) ? value : 'post');

// A new job as the member typed it: the role, where, and the month it
// started ("2026-10"). A title or a company is needed; the month defaults to
// this one.
function newJobInput({ job_title, job_company, job_start }) {
  const field = (value, what) => {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (text.length > JOB_FIELD_MAX) fail(`${what} must be ${JOB_FIELD_MAX} characters or fewer.`);
    return text;
  };
  const title = field(job_title, 'The job title'), company = field(job_company, 'The company name');
  if (!title && !company) fail('Add your job title or the company.');
  let start = String(job_start || '').trim() || thisMonth();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(start)) fail('Pick the month you started.');
  if (start > thisMonth(new Date(Date.now() + 31 * 86_400_000))) fail('Pick a month that has already started, or this one.');
  return { title, company, start };
}

// A new job goes onto the member's own profile, first in their experience and
// marked current. Adding the same role at the same company again changes
// nothing, so announcing a job already on the profile does not list it twice.
async function addJobToProfile(user, { title, company, start }) {
  const fresh = await users.byId(user.id);
  const list = Array.isArray(fresh?.work_experience) ? fresh.work_experience : [];
  const same = (j) => String(j.title || '').toLowerCase() === title.toLowerCase() && String(j.company || '').toLowerCase() === company.toLowerCase();
  if (list.some(same)) return userToPublic(fresh);
  const job = { title, company, location: '', start_date: start, end_date: '', current: true, description: '' };
  return userToPublic(await users.update(user.id, { work_experience: [job, ...list] }));
}

// A post somebody may act on: there, and already live. A scheduled post is
// nobody's to like, comment on, save or repost until its time comes — it is
// not visible to them (visibleRows in app.js), so it answers as missing.
async function livePost(id, message = 'Post not found.') {
  const post = await store.get('FeedPost', id);
  if (!post || isScheduled(post)) fail(message, 404);
  return post;
}

// The moment a post is to go live, checked. Empty means now. The time comes
// from the poster's own browser as an exact moment, so their time zone is
// already in it.
async function scheduleTime(value, user) {
  if (value === undefined || value === null || value === '') return null;
  const t = Date.parse(value);
  if (!Number.isFinite(t)) fail('Pick a date and time for your post.');
  const now = Date.now();
  if (t <= now + 60_000) fail('Pick a time later than now.');
  if (t > now + MAX_SCHEDULE_DAYS * 86_400_000) fail('Posts can be scheduled up to a year ahead.');
  // Nothing goes live in someone's name on Shabbos or Yom Tov, the same rule
  // as posting by hand. Read for where the poster is.
  if ((await computeShabbosStatus(user, t)).isRestricted) fail('That time is on Shabbos or Yom Tov where you are. Please pick a time after it ends.');
  return new Date(t).toISOString();
}

// Own keys only: a plain object also answers to 'constructor' and friends.
const validReaction = (value) => (value === undefined || value === null || value === '' ? DEFAULT_REACTION : (typeof value === 'string' && Object.hasOwn(REACTION_BY_ID, value) ? value : null));
// What a member may say about their own listing. Verification, status and
// the counters are the server's and an admin's to set.
function listingInput(payload) {
  const { verified, verified_at, verified_by, verified_badges, status, claimed, demo, save_count, usage_count, vouch_count, owner_id, slug, ...given } = payload || {};
  // Prominence and confirmation are an admin's to grant, and this is a function
  // route: stripProtected never runs here, so it has to refuse them itself —
  // from the same list the generic route uses, not a second copy of it.
  const rest = Object.fromEntries(Object.entries(given).filter(([key]) => !ADMIN_ONLY_LISTING_FIELDS.includes(key)));
  // Badges are category-specific: a plumber cannot claim Pas Yisroel, and the
  // check belongs here rather than only in the form.
  const badges = Array.isArray(rest.badges)
    ? [...new Set(rest.badges.filter((id) => BADGE_BY_ID[id] && badgeAppliesTo(BADGE_BY_ID[id], rest.category)))]
    : [];
  // WhatsApp wants the number as digits with the country code, no plus.
  const whatsapp = rest.whatsapp ? String(rest.whatsapp).replace(/\D/g, '').replace(/^1?(\d{10})$/, '1$1') : '';
  const payment_link_url = safeExternalUrl(rest.payment_link_url);
  const gallery = normalizeGallery(rest.gallery, { safeUrl: safeExternalUrl });
  // The logo is drawn on the listing page and emitted as og:image, so it is
  // held to the same uploads-only rule as the photos — it used to pass through
  // `...rest` untouched while the gallery next to it was checked.
  const logo_url = normalizeLogoUrl(rest.logo_url);
  const minyanim = normalizeMinyanim(rest.minyanim);
  const minyan_url = safeExternalUrl(rest.minyan_url);
  const kitchen = normalizeKitchen(rest.kitchen, rest.category);
  return { ...rest, badges, whatsapp, payment_link_url, gallery, logo_url, minyanim, minyan_url, kitchen, kitchen_unconfirmed: false, not_jewish_owned: rest.not_jewish_owned === true };
}

// A link a visitor will be sent to — a Stripe Payment Link, PayPal.me,
// Venmo or Zelle page. Validated as a real http(s) URL so it can never
// become a javascript: URL or similar when rendered as an href.
export function safeExternalUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  let url;
  try { url = new URL(value); } catch { fail('Enter a full link starting with https://'); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') fail('The link must start with http:// or https://');
  if (value.length > 500) fail('That link is too long.');
  return url.toString();
}

const need = (value, message) => {
  if (value === undefined || value === null || String(value).trim() === '') {
    const err = new Error(message);
    err.statusCode = 400;
    throw err;
  }
  return value;
};

const fail = (message, statusCode = 400) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  throw err;
};

// Author fields are denormalized onto posts/comments because the feed renders
// them without a second lookup.
async function canMessage(senderId, recipientId) {
  const [outbound, inbound] = await Promise.all([
    store.filter('Connection', { requester_id: senderId, recipient_id: recipientId, status: 'accepted' }),
    store.filter('Connection', { requester_id: recipientId, recipient_id: senderId, status: 'accepted' }),
  ]);
  if (outbound.length || inbound.length) return true;
  const existing = await store.filter('Message', { sender_id: recipientId, recipient_id: senderId });
  if (existing.length) return true;
  // Applying to a job is an invited introduction — the poster asked for
  // applicants — so an applicant and a poster may reach each other about it
  // the same way an accepted connection can, whichever one of them is "sender".
  const [applied, postedTo] = await Promise.all([
    store.filter('JobApplication', { created_by_id: senderId, poster_id: recipientId }),
    store.filter('JobApplication', { created_by_id: recipientId, poster_id: senderId }),
  ]);
  return applied.length > 0 || postedTo.length > 0;
}

const authorFields = (user) => ({
  author_name: user.full_name || user.email,
  author_headline: user.headline || '',
  author_avatar_url: user.avatar_url || '',
});

// e.g. "miriam-4k7x": a first name people recognise plus four characters
// that make it unique. Lower-case, URL-safe.
function inviteCode(user) {
  const first = String(user.full_name || 'klal').trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, '').slice(0, 12) || 'klal';
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  let tail = '';
  for (let i = 0; i < 4; i++) tail += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `${first}-${tail}`;
}

// The shape of a code people type into a URL. Hyphens inside only, because
// a leading or trailing one reads like a typo and `--` is unreadable aloud.
export const INVITE_CODE_RE = /^(?=.{4,40}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;

// The one place an invite is looked up by what is in the URL. A renamed
// invite answers to its current code and to every code it has ever had, so
// a link shared before the rename is as good as one shared after.
export async function findInviteByCode(code) {
  const clean = String(code || '').trim().toLowerCase();
  if (!clean) return null;
  const [current] = await store.filter('Invite', { code: clean });
  if (current) return current;
  const [aliased] = await store.filter('Invite', { aliases: clean });
  return aliased || null;
}

// How many former codes an invite keeps answering to. Every alias reserves a
// slug for everyone else, so without a ceiling one member renaming in a loop
// could squat "admin", "support", "klal" and so on forever. Five covers the
// realistic case (a name swapped out, a typo fixed, a seasonal link retired)
// while keeping the squattable surface small.
export const INVITE_ALIAS_LIMIT = 5;

// The rename itself, shared by the API function and the CLI so the two cannot
// disagree about what a rename means. Returns the fields to store, or a
// `conflict` when another invite already answers to the wanted code.
//
// A code the invite itself used to have is fair game: it only ever pointed
// here, so making it current again is undoing a rename, not taking anything
// from anyone. It leaves the alias list so the row does not answer to the
// same code twice. When the list is over the limit the oldest alias is
// dropped, and a link printed with that code stops working — that is the
// price of the cap, and the caller is told which codes still resolve.
export async function planInviteRename(invite, next) {
  const taken = await findInviteByCode(next);
  if (taken && taken.id !== invite.id) return { conflict: true };
  const kept = Array.from(new Set([...(invite.aliases || []), invite.code])).filter((a) => a !== next);
  const dropped = kept.slice(0, Math.max(0, kept.length - INVITE_ALIAS_LIMIT));
  const aliases = kept.slice(dropped.length);
  return { conflict: false, aliases, dropped };
}

// "New listings go live right away" is only a safe promise if one account
// cannot paper the directory before anyone notices. Bounded per account per
// day: more than enough for someone adding their own businesses, not enough
// to be worth a spammer's afternoon. Admins are exempt — seeding is their job.
const DAY_MS = 24 * 60 * 60 * 1000;
async function assertUnderDailyLimit(entity, user, limit, what) {
  // Staff are exempt, moderators included — seeding and cleanup are their job,
  // and a moderator adding a batch of real listings should not hit a 429.
  if (user.role === 'admin' || user.role === 'moderator') return;
  const mine = await store.filter(entity, { created_by_id: user.id });
  const since = Date.now() - DAY_MS;
  const recent = mine.filter((row) => new Date(row.created_date).getTime() >= since);
  if (recent.length >= limit) {
    fail(`That is ${limit} ${what} from this account today. The rest can wait until tomorrow — or write to us if you have a lot to add at once.`, 429);
  }
}

const ACTIVITIES = {
  save: { entity: 'SavedProvider', field: 'save_count' },
  use: { entity: 'ProviderUsage', field: 'usage_count' },
  vouch: { entity: 'Vouch', field: 'vouch_count' },
};

async function notify(recipientId, payload) {
  if (!recipientId) return;
  await store.create('Notification', { recipient_id: recipientId, read: false, ...payload });
}

// Whether this actor has already told this recipient about this thing —
// a like taken back and given again is not news twice.
async function alreadyNotified(recipientId, type, targetId, actorId) {
  const rows = await store.filter('Notification', { recipient_id: recipientId, type, target_id: targetId, actor_id: actorId });
  return rows.length > 0;
}

export const functions = {
  // ---- listings -------------------------------------------------------------

  async createListing(payload, user) {
    await assertWritable(user);
    await assertUnderDailyLimit('Provider', user, 5, 'listings');
    need(payload.name, 'A listing name is required.');
    need(payload.category, 'Please choose a category.');
    // "This is my business" files a claim alongside the listing. Adding a
    // listing no longer makes it yours to edit (see listingEditor), so an owner
    // adding their own page would otherwise have to find the claim form
    // separately and say it all again. It is still a claim: the team accepts it
    // before the listing is handed over, the same as any other.
    const { claim_as_owner, ...listingPayload } = payload || {};
    if (claim_as_owner) await assertUnderDailyLimit('ClaimRequest', user, 3, 'claims');
    payload = listingPayload;
    // Published on submission unless KC_REVIEW_LISTINGS=1 puts the
    // hold-for-approval step back — see REVIEW_FIRST above. This comment used
    // to claim the opposite, which is worth more than a nitpick: a stale note
    // about what moderation does is how someone later assumes a review
    // happened when none did.
    const input = listingInput(payload);
    // Whether the pin is the building or its town centre is the geocoder's
    // word, written below; a client cannot declare it. listingInput never sees
    // PROTECTED_FIELDS, so it is refused here.
    delete input.pin_precise;
    // A pin the person placed, or picked from the town list, is kept as is.
    // Anything less than a usable pair — an empty string from a form field,
    // one coordinate without the other — is no pin, and is stored as none so
    // the lookup below runs instead of the row looking pinned forever.
    const hasCoord = (v) => v !== null && v !== undefined && String(v).trim() !== '' && Number.isFinite(Number(v));
    if ('latitude' in input || 'longitude' in input) {
      const usable = hasCoord(input.latitude) && hasCoord(input.longitude);
      input.latitude = usable ? Number(input.latitude) : null;
      input.longitude = usable ? Number(input.longitude) : null;
    }
    const provider = await store.create(
      'Provider',
      { ...input, status: INITIAL_STATUS, claimed: false, save_count: 0, usage_count: 0, vouch_count: 0 },
      user
    );
    // Someone who typed a town without picking it from the list saved no
    // coordinates, and the listing then never appeared on the map or in
    // "nearest". The pin is found here from the address instead.
    const pin = await pinForListing(provider);
    const saved = pin ? await store.update('Provider', provider.id, pin) : provider;
    let claim = null;
    if (claim_as_owner) {
      const contact = [
        payload.email && `Email: ${payload.email}`,
        payload.phone && `Phone: ${payload.phone}`,
        payload.website && `Website: ${payload.website}`,
      ].filter(Boolean).join('\n');
      claim = await store.create('ClaimRequest', {
        provider_id: saved.id,
        provider_name: saved.name,
        relationship: 'Added this listing and said it is their business',
        business_email: payload.email || '',
        business_phone: payload.phone || '',
        website: payload.website || '',
        verification_details: contact || 'No contact details on the listing.',
        status: 'pending',
      }, user);
    }
    return { provider: saved, claim };
  },

  // A business's own Stripe Payment Link, PayPal.me, Venmo or Zelle page.
  // Klal never touches the money — this only stores where to send someone
  // who wants to pay. Self-service, like the tagline, because it carries no
  // review risk: it is either a working link or it is not.
  async updateListingPaymentLink({ provider_id, payment_link_url }, user) {
    await assertWritable(user);
    const provider = await store.get('Provider', need(provider_id, 'Missing listing.'));
    if (!provider) fail('Listing not found.', 404);
    // The listing's editor, not merely whoever added it: after a claim is
    // approved these were exactly inverted — the business that now owned the
    // listing could not change its tagline or payment link, while the original
    // poster still could.
    if (!canSetPaymentLink(provider, user)) {
      fail('You can only edit listings you manage.', 403);
    }
    const url = safeExternalUrl(payment_link_url);
    const updated = await store.update('Provider', provider_id, { payment_link_url: url });
    return { provider: updated };
  },

  async updateListingTagline({ provider_id, tagline }, user) {
    await assertWritable(user);
    const provider = await store.get('Provider', need(provider_id, 'Missing listing.'));
    if (!provider) fail('Listing not found.', 404);
    // The listing's editor, not merely whoever added it: after a claim is
    // approved these were exactly inverted — the business that now owned the
    // listing could not change its tagline or payment link, while the original
    // poster still could.
    if (!canEditListing(provider, user)) {
      fail('You can only edit listings you manage.', 403);
    }
    if (String(tagline || '').length > 120) fail('Taglines must be 120 characters or fewer.');
    return { provider: await store.update('Provider', provider_id, { tagline: String(tagline || '') }) };
  },

  // ---- jobs -------------------------------------------------------------

  async createJob(payload, user) {
    await assertWritable(user);
    await assertUnderDailyLimit('Job', user, 5, 'job posts');
    need(payload.title, 'A job title is required.');
    need(payload.category, 'Please choose a category.');
    const description = String(payload.description || '').trim();
    if (description.length < 30) fail('Please add a bit more detail to the description.');
    const job = await store.create(
      'Job',
      {
        title: String(payload.title).trim(),
        company_name: String(payload.company_name || '').trim(),
        category: payload.category,
        employment_type: EMPLOYMENT_TYPES.has(payload.employment_type) ? payload.employment_type : 'full_time',
        location: String(payload.location || '').trim(),
        remote: !!payload.remote,
        description,
        apply_url: safeExternalUrl(payload.apply_url),
        open: true,
        status: INITIAL_STATUS,
        ...authorFields(user),
      },
      user
    );
    return { job };
  },

  // In-app apply, for when a job has no external link: the poster is
  // notified and — same as an accepted connection — can message the
  // applicant back, and the applicant can message them, from here on.
  async applyToJob({ job_id, note }, user) {
    await assertWritable(user);
    if (user.email === GUEST_EMAIL) fail('Create an account to apply.', 403);
    const job = await store.get('Job', need(job_id, 'Missing job.'));
    if (!job) fail('Job not found.', 404);
    if (job.status !== 'published') fail('This job is not accepting applications right now.');
    if (!job.open) fail('This job is no longer accepting applications.');
    if (job.created_by_id === user.id) fail('You cannot apply to your own job.');
    const existing = await store.filter('JobApplication', { job_id, created_by_id: user.id });
    if (existing.length) fail('You already applied to this job.');

    const application = await store.create(
      'JobApplication',
      {
        job_id,
        poster_id: job.created_by_id,
        note: String(note || '').trim().slice(0, 1000),
        applicant_name: user.full_name || user.email,
        applicant_headline: user.headline || '',
        applicant_avatar_url: user.avatar_url || '',
      },
      user
    );
    await notify(job.created_by_id, {
      type: 'job_application',
      actor_id: user.id,
      actor_name: user.full_name || user.email,
      target_type: 'job',
      target_id: job_id,
      message: `${user.full_name || 'Someone'} applied to your job: ${job.title}`,
    });
    return { application };
  },

  async createClaim(payload, user) {
    await assertWritable(user);
    // Claims were the one unbounded write left: no cap, while adding a listing
    // has one. Filing claims is rare and a burst of them is noise in a queue
    // that hands over ownership.
    await assertUnderDailyLimit('ClaimRequest', user, 3, 'claims');
    need(payload.provider_name, 'Tell us which listing you are claiming.');
    need(payload.relationship, 'Describe your relationship to the listing.');
    need(payload.verification_details, 'Verification details are required.');
    const fields = { ...payload };
    if (fields.provider_id) {
      const provider = await store.get('Provider', fields.provider_id);
      if (!provider) fail('We cannot find that listing. Choose it from the list, or leave it blank and name the business.', 404);
      // The queue card showed the name the claimant typed while approval acted
      // on provider_id, so staff could read one business and hand over another.
      // The name on the record is the listing's own from here on.
      fields.provider_name = provider.name || fields.provider_name;
      if (provider.owner_id && provider.owner_id !== user.id) {
        fail('That listing already belongs to someone. If that is wrong, write to us and we will look into it rather than hand it over twice.', 409);
      }
      const pending = await store.filter('ClaimRequest', { created_by_id: user.id, provider_id: fields.provider_id, status: 'pending' });
      if (pending.length) fail('Your claim on that listing is already with us. We will come back to you on it.', 409);
    }
    const claim = await store.create('ClaimRequest', { ...fields, status: 'pending' }, user);
    return { claim };
  },

  // Approving a claim used to stamp the request and nothing else: the listing
  // kept its original author, owner_id was never set, and claimed stayed false.
  // So the queue said "approved" while the business still could not edit its own
  // page — and ClaimForm had already promised we would hand the listing over.
  async resolveClaim({ claim_id, approve }, user) {
    await assertWritable(user);
    if (user.role !== 'admin' && user.role !== 'moderator') fail('Staff only.', 403);
    const claim = await store.get('ClaimRequest', need(claim_id, 'Missing claim.'));
    if (!claim) fail('Claim not found.', 404);

    // Staff, but not on your own claim. Being a moderator is not a way to take
    // ownership of any business in the directory by filing a claim and waving it
    // through yourself.
    if (claim.created_by_id === user.id) fail('Someone else has to review your own claim.', 403);

    // Resolved once. Without this, approving twice re-ran the handover and
    // rejecting an approved claim left the listing transferred while the request
    // read "rejected" — the record and the listing disagreeing about what
    // happened.
    if (claim.status && claim.status !== 'pending') {
      fail(`That claim was already ${claim.status}.`, 409);
    }

    const resolution = { status: approve ? 'approved' : 'rejected', resolved_at: new Date().toISOString(), resolved_by: user.id };

    if (!approve) {
      const rejected = await store.update('ClaimRequest', claim.id, resolution);
      await store.create('ActivityEvent', { type: 'moderation', entity: 'ClaimRequest', target_id: claim.id, from: 'pending', to: 'rejected', actor_role: user.role }, user);
      await notify(claim.created_by_id, {
        type: 'claim_rejected', actor_id: user.id, actor_name: user.full_name || 'The Klal team',
        target_type: 'provider', target_id: claim.provider_id || '',
        message: `Your claim for ${claim.provider_name || 'a listing'} was not approved`,
      });
      return { claim: rejected };
    }

    // A claim with no listing attached cannot hand anything over, and saying
    // "approved" would be a lie. The person claiming typed a name instead of
    // picking from the list, so the listing has to be chosen first.
    if (!claim.provider_id) fail('This claim names no listing. Attach one before approving it.', 400);
    const provider = await store.get('Provider', claim.provider_id);
    if (!provider) fail('That listing no longer exists.', 404);

    // A listing that already belongs to someone is not handed to the next
    // claimant who asks. Approving a second claim used to transfer it silently,
    // so whoever claimed last owned it. Moving a listing between owners should
    // be a deliberate act, not a side effect of clearing a queue.
    if (provider.owner_id && provider.owner_id !== claim.created_by_id) {
      fail('That listing is already claimed. Release it from the current owner before approving another claim.', 409);
    }

    const updated = await store.update('Provider', provider.id, { owner_id: claim.created_by_id, claimed: true });
    const resolved = await store.update('ClaimRequest', claim.id, resolution);
    // Every other staff decision leaves a trace of who, what, from and to. This
    // one hands a business page from one person to another and left none.
    await store.create('ActivityEvent', { type: 'moderation', entity: 'ClaimRequest', target_id: claim.id, from: 'pending', to: 'approved', actor_role: user.role }, user);
    await store.create('ActivityEvent', { type: 'listing_handover', entity: 'Provider', target_id: provider.id, from: provider.owner_id || provider.created_by_id || null, to: claim.created_by_id, actor_role: user.role }, user);
    await notify(claim.created_by_id, {
      type: 'claim_approved', actor_id: user.id, actor_name: user.full_name || 'The Klal team',
      target_type: 'provider', target_id: provider.id,
      message: `${provider.name} is yours to edit now`,
    });
    return { claim: resolved, provider: updated };
  },

  // ---- community feedback ---------------------------------------------------

  async createReview({ provider_id, provider_name, body }, user) {
    await assertWritable(user);
    need(provider_id, 'Missing listing.');
    if (!(await vouchesEnabled())) fail('Community notes are turned off right now.', 403);
    if (String(body || '').trim().length < 10) fail('Please share a little more detail.');
    // A community note is signed, so a public note on a sensitive listing
    // identifies its author as someone who needed that service. Same rule as
    // vouches — and corrections still reach the team privately.
    const subject = await store.get('Provider', provider_id);
    if (subject && isSensitiveListing(subject)) {
      fail('Public notes are turned off for this kind of listing. Use Suggest a Correction to reach the Klal team privately.');
    }
    const note = await store.create(
      'CommunityNote',
      { provider_id, provider_name, body: String(body).trim(), status: INITIAL_STATUS, ...authorFields(user) },
      user
    );
    return { note };
  },

  async createReport({ resource_id, reason_category, explanation, contact_ok, contact_phone }, user) {
    await assertWritable(user);
    need(resource_id, 'Missing listing.');
    need(reason_category, 'Please choose a reason.');
    const text = String(explanation || '').trim();
    if (!text) fail('Please add a short explanation.');
    if (text.length > 1000) fail('Explanation must be 1000 characters or fewer.');
    const phone = contact_ok ? String(contact_phone || '').trim().slice(0, 30) : '';

    const provider = await store.get('Provider', resource_id);
    const report = await store.create(
      'ListingReport',
      {
        resource_id,
        provider_name: provider?.name || '',
        reason_category,
        explanation: text,
        contact_ok: !!contact_ok,
        status: 'open',
        reporter_email: contact_ok ? user.email : '',
        reporter_phone: phone,
      },
      user
    );
    return { report };
  },

  // ---- feed -----------------------------------------------------------------

  async createPost({ body, post_type, image_urls, publish_at, job_title, job_company, job_start, celebration }, user) {
    await assertWritable(user);
    const text = String(body || '').trim();
    const kind = postType(post_type);
    // A new-job post says what it is on its card, so its words are optional.
    const job = kind === 'new_job' ? newJobInput({ job_title, job_company, job_start }) : null;
    if (job && !canAnnounce(job.start)) fail('Only jobs that started since Klal Connect opened can be announced. Add this one to your profile instead.');
    if (!text && !(image_urls || []).length && !job) fail('Write something to post.');
    if (text.length > 5000) fail('Posts must be 5000 characters or fewer.');
    const when = await scheduleTime(publish_at, user);
    const post = await store.create(
      'FeedPost',
      {
        body: text,
        post_type: kind,
        ...(job ? { job_title: job.title, job_company: job.company, job_start: job.start, celebration: celebrationOf(celebration) } : {}),
        image_urls: image_urls || [],
        ...(when ? { publish_at: when } : {}),
        like_count: 0,
        comment_count: 0,
        view_count: 0,
        ...authorFields(user),
      },
      user
    );
    if (job) await addJobToProfile(user, job);
    return { post };
  },

  // A new job added to the member's profile without announcing it: nothing
  // goes in the feed.
  async addNewJob({ job_title, job_company, job_start }, user) {
    await assertWritable(user);
    return { user: await addJobToProfile(user, newJobInput({ job_title, job_company, job_start })) };
  },

  // The author changing a post that has not gone live yet: its words, its
  // time, or "post it now". Once it is live it stays as it is, like any post.
  async updateScheduledPost({ post_id, body, publish_at, post_now }, user) {
    await assertWritable(user);
    need(post_id, 'Missing post.');
    const post = await store.get('FeedPost', post_id);
    if (!post) fail('Post not found.', 404);
    if (post.created_by_id !== user.id) fail('You can only change your own posts.', 403);
    if (!isScheduled(post)) fail('This post is already live.');
    const patch = {};
    if (body !== undefined) {
      const text = String(body || '').trim();
      if (!text && !(post.image_urls || []).length) fail('Write something to post.');
      if (text.length > 5000) fail('Posts must be 5000 characters or fewer.');
      patch.body = text;
    }
    if (post_now) patch.publish_at = new Date().toISOString();
    else if (publish_at !== undefined) {
      const when = await scheduleTime(publish_at, user);
      if (!when) fail('Pick a date and time for your post.');
      patch.publish_at = when;
    }
    return { post: await store.update('FeedPost', post_id, patch) };
  },

  // The author of a new-job post picking another animation for it, before or
  // after it goes live.
  async setPostCelebration({ post_id, celebration }, user) {
    await assertWritable(user);
    need(post_id, 'Missing post.');
    const post = await store.get('FeedPost', post_id);
    if (!post) fail('Post not found.', 404);
    if (post.created_by_id !== user.id) fail('You can only change your own posts.', 403);
    if (post.post_type !== 'new_job') fail('Only a new-job post has a celebration.');
    return { post: await store.update('FeedPost', post_id, { celebration: celebrationOf(celebration) }) };
  },

  // Sharing someone's post into the feed, with or without a few words of your
  // own. The original is copied in, so the repost reads the same however many
  // reposts down it is; reposting a repost shares the original it carries.
  async repostPost({ post_id, body }, user) {
    await assertWritable(user);
    need(post_id, 'Missing post.');
    let original = await store.get('FeedPost', post_id);
    if (original?.repost_of) original = await store.get('FeedPost', original.repost_of);
    if (!original || isScheduled(original)) fail('That post is no longer available.', 404);
    if (original.created_by_id === user.id) fail('You can share your own post with the Share button instead.');
    const text = String(body || '').trim();
    if (text.length > 5000) fail('Posts must be 5000 characters or fewer.');
    const post = await store.create(
      'FeedPost',
      {
        body: text,
        post_type: 'post',
        image_urls: [],
        like_count: 0,
        comment_count: 0,
        view_count: 0,
        repost_of: original.id,
        repost_author_id: original.created_by_id || '',
        repost_author_name: original.author_name || '',
        repost_author_headline: original.author_headline || '',
        repost_body: original.body || '',
        repost_image_urls: original.image_urls || [],
        repost_post_type: original.post_type || 'post',
        repost_created_date: original.publish_at || original.created_date || '',
        ...authorFields(user),
      },
      user
    );
    const repost_count = await store.count('FeedPost', { repost_of: original.id });
    await store.update('FeedPost', original.id, { repost_count });
    return { post };
  },

  async createComment({ post_id, body }, user) {
    await assertWritable(user);
    need(post_id, 'Missing post.');
    const text = String(body || '').trim();
    if (!text) fail('Write a comment first.');
    const post = await livePost(post_id);

    const comment = await store.create('Comment', { post_id, body: text, ...authorFields(user) }, user);
    // Recount rather than increment so the badge can't drift from reality.
    const comment_count = await store.count('Comment', { post_id });
    await store.update('FeedPost', post_id, { comment_count });

    if (post.created_by_id !== user.id) {
      await notify(post.created_by_id, {
        type: 'comment',
        actor_id: user.id,
        actor_name: user.full_name || user.email,
        target_type: 'post',
        target_id: post_id,
        message: `${user.full_name || 'Someone'} commented on your post`,
      });
    }
    return { comment, comment_count };
  },

  // ---- invites -------------------------------------------------------------

  // Every member has one personal invite link; asking again returns it. The
  // code is short and memorable enough to read out loud.
  async myInvite(_payload, user) {
    if (user.email === GUEST_EMAIL) fail('Create an account to invite people.', 403);
    assertVerified(user);
    const [existing] = await store.filter('Invite', { created_by_id: user.id, provider_id: null });
    if (existing) return { invite: existing };
    // A generated code must be free as a current code and as an alias:
    // an alias is still a link someone printed, and a new invite with that
    // code would be found first and take credit for every join through it.
    let code = null;
    for (let i = 0; i < 5 && !code; i++) {
      const candidate = inviteCode(user);
      if (!(await findInviteByCode(candidate))) code = candidate;
    }
    if (!code) fail('Could not find a free link name just now. Try again.', 503);
    const invite = await store.create('Invite', { code, inviter_name: user.full_name || '', provider_id: null, provider_name: null, joined_user_ids: [], joined_count: 0 }, user);
    return { invite };
  },

  // Gives an invite a new slug while the old link keeps working. Invite codes
  // are built from the inviter's first name, and a name is not always
  // something a person wants in a URL they hand out. The old code moves into
  // `aliases`, which every lookup also consults, so links already shared or
  // printed still land on the same invite. Reachable for the inviter and for
  // admins; plain users cannot rename someone else's link.
  async renameInvite({ code, new_code }, user) {
    const invite = await findInviteByCode(code);
    if (!invite) fail('That invite link is not valid.', 404);
    if (user.role !== 'admin' && invite.created_by_id !== user.id) fail('Only the inviter or an admin can rename this link.', 403);
    const next = String(new_code || '').trim().toLowerCase();
    if (!INVITE_CODE_RE.test(next)) fail('A link name is 4-40 lowercase letters, digits or hyphens.');
    if (next === invite.code) fail('That is already the name of this link.');
    const plan = await planInviteRename(invite, next);
    if (plan.conflict) fail('That link name is already in use.', 409);
    const updated = await store.update('Invite', invite.id, { code: next, aliases: plan.aliases });
    return { invite: updated, dropped_aliases: plan.dropped };
  },

  // ---- skills ----------------------------------------------------------------

  // A skill only its owner listed can be endorsed — otherwise removing a
  // skill would leave orphaned endorsements for something no longer claimed,
  // and anyone could manufacture an endorsement for a skill nobody has.
  async toggleSkillEndorsement({ user_id, skill }, user) {
    await assertWritable(user);
    need(user_id, 'Missing member.');
    const clean = String(skill || '').trim();
    need(clean, 'Missing skill.');
    if (user_id === user.id) fail('You cannot endorse your own skill.');
    const target = userToPublic(await users.byId(user_id));
    if (!target) fail('Member not found.', 404);
    // The owner's own spelling is the one of record, so "excel" and "Excel"
    // land on the same row instead of splitting the count across two.
    const canonical = (target.skills || []).find((s) => s.toLowerCase() === clean.toLowerCase());
    if (!canonical) fail('That is not one of their listed skills.');

    const existing = await store.filter('SkillEndorsement', { user_id, skill: canonical, created_by_id: user.id });
    let endorsed;
    if (existing.length) {
      for (const row of existing) await store.delete('SkillEndorsement', row.id);
      endorsed = false;
    } else {
      await store.create('SkillEndorsement', { user_id, skill: canonical }, user);
      endorsed = true;
    }
    const count = await store.count('SkillEndorsement', { user_id, skill: canonical });

    // One notification per person per skill, the same way a like is told
    // once — endorsing, un-endorsing and endorsing again is not three events.
    const target_id = `${user_id}::${canonical}`;
    if (endorsed && !existing.length && !(await alreadyNotified(user_id, 'skill_endorsement', target_id, user.id))) {
      await notify(user_id, {
        type: 'skill_endorsement',
        actor_id: user.id,
        actor_name: user.full_name || user.email,
        target_type: 'skill',
        target_id,
        message: `${user.full_name || 'Someone'} endorsed you for ${canonical}`,
      });
    }
    return { endorsed, count };
  },

  // ---- asks: answers with upvotes, and the asker's "this helped" ---------

  async toggleAnswerVote({ comment_id }, user) {
    await assertWritable(user);
    need(comment_id, 'Missing answer.');
    const comment = await store.get('Comment', comment_id);
    if (!comment) fail('Answer not found.', 404);
    if (comment.created_by_id === user.id) fail('You cannot upvote your own answer.');
    const existing = await store.filter('CommentVote', { comment_id, created_by_id: user.id });
    let voted;
    if (existing.length) {
      for (const v of existing) await store.delete('CommentVote', v.id);
      voted = false;
    } else {
      await store.create('CommentVote', { comment_id, post_id: comment.post_id }, user);
      voted = true;
    }
    const vote_count = await store.count('CommentVote', { comment_id });
    await store.update('Comment', comment_id, { vote_count });
    return { voted, vote_count };
  },

  // Only the person who asked can say what helped. One answer at a time;
  // choosing another moves the mark, choosing the same one again clears it.
  async markHelpful({ post_id, comment_id }, user) {
    await assertWritable(user);
    need(post_id, 'Missing post.');
    const post = await livePost(post_id);
    if (post.created_by_id !== user.id) fail('Only the person who asked can mark an answer as helpful.', 403);
    const previous = post.helpful_comment_id || null;
    const next = previous === comment_id ? null : comment_id;
    if (next) {
      const comment = await store.get('Comment', next);
      if (!comment || comment.post_id !== post_id) fail('Answer not found.', 404);
    }
    if (previous) await store.update('Comment', previous, { helpful: false });
    if (next) await store.update('Comment', next, { helpful: true });
    await store.update('FeedPost', post_id, { helpful_comment_id: next });
    if (next) {
      const comment = await store.get('Comment', next);
      if (comment.created_by_id !== user.id) {
        await notify(comment.created_by_id, {
          type: 'helpful',
          actor_id: user.id,
          actor_name: user.full_name || user.email,
          target_type: 'post',
          target_id: post_id,
          message: `${user.full_name || 'Someone'} marked your answer as helpful`,
        });
      }
    }
    return { helpful_comment_id: next };
  },

  // One reaction per member per post. Reacting again with the same one takes
  // it back; with a different one, it changes. `like_count` stays the total
  // of every kind, so nothing that reads it needed to change; the breakdown is
  // in `reaction_counts`.
  async toggleLike({ post_id, reaction }, user) {
    await assertWritable(user);
    need(post_id, 'Missing post.');
    const post = await livePost(post_id);
    const wanted = validReaction(reaction);
    if (!wanted) fail('Unknown reaction.');

    const existing = await store.filter('FeedLike', { post_id, created_by_id: user.id });
    let liked;
    if (existing.length && reactionOf(existing[0]) === wanted) {
      for (const like of existing) await store.delete('FeedLike', like.id);
      liked = false;
    } else if (existing.length) {
      await store.update('FeedLike', existing[0].id, { reaction: wanted });
      for (const extra of existing.slice(1)) await store.delete('FeedLike', extra.id);
      liked = true;
    } else {
      await store.create('FeedLike', { post_id, reaction: wanted }, user);
      liked = true;
    }
    const all = await store.filter('FeedLike', { post_id });
    const reaction_counts = {};
    for (const row of all) { const id = reactionOf(row); reaction_counts[id] = (reaction_counts[id] || 0) + 1; }
    const like_count = all.length;
    await store.update('FeedPost', post_id, { like_count, reaction_counts });

    // Told once per member per post: changing a reaction, or taking one back
    // and giving it again, is not a new event.
    if (liked && !existing.length && post.created_by_id !== user.id && !(await alreadyNotified(post.created_by_id, 'like', post_id, user.id))) {
      const what = REACTION_BY_ID[wanted];
      await notify(post.created_by_id, {
        type: 'like',
        actor_id: user.id,
        actor_name: user.full_name || user.email,
        target_type: 'post',
        target_id: post_id,
        message: wanted === DEFAULT_REACTION
          ? `${user.full_name || 'Someone'} liked your post`
          : `${user.full_name || 'Someone'} reacted ${what.emoji} ${what.label} to your post`,
      });
    }
    return { liked, reaction: liked ? wanted : null, like_count, reaction_counts };
  },

  // Views are counted once per viewer, so a refresh loop can't inflate them.
  async recordPostView({ postId }, user) {
    need(postId, 'Missing post.');
    const post = await livePost(postId);

    // The count is the author's alone (see present() in app.js), and the
    // author never records a view of their own post — so nothing comes back.
    const seen = await store.filter('ActivityEvent', { type: 'post_view', target_id: postId, created_by_id: user.id });
    if (!seen.length) {
      await store.create('ActivityEvent', { type: 'post_view', target_id: postId }, user);
      const count = await store.count('ActivityEvent', { type: 'post_view', target_id: postId });
      await store.update('FeedPost', postId, { view_count: count });
    }
    return { recorded: true };
  },

  // A member opening someone else's profile. Counted once per viewer per day,
  // so coming back to a profile tomorrow counts again but a refresh does not.
  // Only the number ever leaves the server (myAnalytics); who looked is kept
  // to nobody, the profile owner included.
  async recordProfileView({ userId }, user) {
    need(userId, 'Missing profile.');
    if (userId === user.id || user.email === GUEST_EMAIL) return { recorded: false };
    const day = new Date().toISOString().slice(0, 10);
    const seen = await store.filter('ActivityEvent', { type: 'member_profile_view', target_id: userId, created_by_id: user.id, day });
    if (!seen.length) await store.create('ActivityEvent', { type: 'member_profile_view', target_id: userId, day }, user);
    return { recorded: true };
  },

  // The private Analytics box on your own profile: how many people looked at
  // it and how your posts did, over the last 7, 30, 90 or 365 days (next to
  // the same stretch before it) or all time. Counts only. Your own views,
  // likes and comments on your own posts are left out.
  async myAnalytics({ days, tzOffset }, user) {
    if (user.email === GUEST_EMAIL) fail('Create an account to see your analytics.', 403);
    const allTime = days === 'all';
    const range = allTime ? 'all' : [7, 30, 90, 365].includes(Number(days)) ? Number(days) : 30;
    const DAY = 86_400_000;
    // Days are the member's own calendar days, from their browser's offset.
    const offset = Number.isFinite(Number(tzOffset)) ? Math.max(-840, Math.min(840, Number(tzOffset))) * 60_000 : 0;
    const now = Date.now();
    const todayStart = Math.floor((now - offset) / DAY) * DAY + offset;
    const end = todayStart + DAY;
    const at = (row) => Date.parse(row.created_date) || 0;
    const others = (rows) => rows.filter((r) => r.created_by_id !== user.id);

    const posts = (await store.filter('FeedPost', { created_by_id: user.id })).filter((p) => !isScheduled(p));
    const ids = posts.map((p) => p.id);
    const [profileViews, impressions, reactions, comments, reposts] = await Promise.all([
      store.filter('ActivityEvent', { type: 'member_profile_view', target_id: user.id }),
      ids.length ? store.filter('ActivityEvent', { type: 'post_view', target_id: ids }) : [],
      ids.length ? store.filter('FeedLike', { post_id: ids }) : [],
      ids.length ? store.filter('Comment', { post_id: ids }) : [],
      ids.length ? store.filter('FeedPost', { repost_of: ids }) : [],
    ]).then((sets) => sets.map(others));
    const all = { profile_views: profileViews, impressions, reactions, comments, reposts };

    // All time starts at whichever came first: the account, or anything on it.
    let start;
    if (allTime) {
      const first = Math.min(Date.parse(user.created_date) || now, ...Object.values(all).flat().map(at).filter(Boolean));
      start = Math.floor((first - offset) / DAY) * DAY + offset;
    } else {
      start = todayStart - (range - 1) * DAY;
    }
    const prevStart = allTime ? null : start - range * DAY;

    const inRange = (rows) => rows.filter((r) => at(r) >= start);
    const totals = {};
    for (const [key, rows] of Object.entries(all)) {
      totals[key] = { count: inRange(rows).length, before: allTime ? null : rows.filter((r) => at(r) >= prevStart && at(r) < start).length };
    }

    // Bars for the chart, oldest first: a day each over a week or a month, a
    // week each over three months, a calendar month each over a year or
    // all time (the first month starting where the stretch does).
    const spans = [];
    if (allTime || range === 365) {
      const local = new Date(start - offset);
      let y = local.getUTCFullYear(), m = local.getUTCMonth();
      for (let s = start; s < end;) {
        m += 1; if (m === 12) { m = 0; y += 1; }
        const e = Math.min(Date.UTC(y, m, 1) + offset, end);
        spans.push([s, e, 'month']);
        s = e;
      }
    } else {
      const step = range === 90 ? 7 : 1;
      for (let s = start; s < end; s += step * DAY) spans.push([s, Math.min(s + step * DAY, end), step === 7 ? 'week' : 'day']);
    }
    const buckets = spans.map(([s, e, unit]) => {
      const within = (rows) => rows.filter((r) => at(r) >= s && at(r) < e).length;
      return { start: new Date(s).toISOString(), unit, profile_views: within(profileViews), impressions: within(impressions) };
    });

    // Your best posts in this stretch, by who saw them, then by who answered.
    const tally = (rows, field) => {
      const m = new Map();
      for (const r of inRange(rows)) m.set(r[field], (m.get(r[field]) || 0) + 1);
      return m;
    };
    const seen = tally(impressions, 'target_id'), liked = tally(reactions, 'post_id'), said = tally(comments, 'post_id'), shared = tally(reposts, 'repost_of');
    const top_posts = posts
      .map((p) => ({
        id: p.id,
        excerpt: postExcerpt(p.body || p.repost_body, 90) || (p.image_urls?.length ? 'Photo post' : 'Post'),
        created_date: p.publish_at || p.created_date,
        impressions: seen.get(p.id) || 0,
        reactions: liked.get(p.id) || 0,
        comments: said.get(p.id) || 0,
        reposts: shared.get(p.id) || 0,
      }))
      .filter((p) => p.impressions + p.reactions + p.comments + p.reposts > 0)
      .sort((a, b) => b.impressions - a.impressions || (b.reactions + b.comments + b.reposts) - (a.reactions + a.comments + a.reposts))
      .slice(0, 3);

    return { days: range, since: new Date(start).toISOString(), totals, buckets, top_posts, post_count: posts.length };
  },

  // ---- the post menu: save, report, delete ---------------------------------

  // A private bookmark. The row is the member's own (OWNER_SCOPED in app.js):
  // nobody, the author included, sees who saved what.
  async toggleSavePost({ post_id }, user) {
    await assertWritable(user);
    need(post_id, 'Missing post.');
    const post = await livePost(post_id);
    const existing = await store.filter('SavedPost', { post_id, created_by_id: user.id });
    if (existing.length) {
      for (const row of existing) await store.delete('SavedPost', row.id);
      return { saved: false };
    }
    await store.create('SavedPost', { post_id }, user);
    return { saved: true };
  },

  // Goes to the private-reports queue the admin already works. `name` and
  // `body` are what that queue renders, so both are written to read on their
  // own: who wrote the post, why it was reported, what the reporter said,
  // and a line of the post itself in case it is edited or gone by then.
  async reportPost({ post_id, reason_category, explanation }, user) {
    await assertWritable(user);
    need(post_id, 'Missing post.');
    const post = await livePost(post_id);
    if (post.created_by_id === user.id) fail('You cannot report your own post.');
    const reason = typeof reason_category === 'string' && Object.hasOwn(POST_REPORT_REASON_BY_ID, reason_category) ? POST_REPORT_REASON_BY_ID[reason_category] : null;
    if (!reason) fail('Please choose a reason.');
    const text = String(explanation || '').trim();
    if (text.length < 20) fail('Please add at least 20 characters of explanation.');
    if (text.length > 1000) fail('Explanation must be 1000 characters or fewer.');
    const open = await store.filter('PrivateReport', { target_type: 'post', target_id: post_id, created_by_id: user.id, status: 'open' });
    if (open.length) fail('You have already reported this post. Our team will look at it.');

    const author = post.author_name || 'a community member';
    const report = await store.create(
      'PrivateReport',
      {
        name: `Reported post by ${author}`,
        body: `${reason.label}: ${text} — the post reads “${postExcerpt(post.body, 140) || '(no text)'}”`,
        target_type: 'post',
        target_id: post_id,
        post_author_id: post.created_by_id,
        post_author_name: post.author_name || '',
        reason_category,
        explanation: text,
        status: 'open',
      },
      user
    );
    return { report };
  },

  // The author takes back their own post; an admin or a moderator removes
  // anyone's. Everything hanging off it goes with it, so no comment, reaction,
  // vote or bookmark is left pointing at a post that is not there. A staff
  // removal is audited the way a status change is (app.js).
  async deletePost({ post_id }, user) {
    await assertWritable(user);
    need(post_id, 'Missing post.');
    const post = await store.get('FeedPost', post_id);
    if (!post) fail('Post not found.', 404);
    const own = post.created_by_id === user.id;
    const staff = user.role === 'admin' || user.role === 'moderator';
    if (!own && !staff) fail('You can only delete your own posts.', 403);

    const removeWithEverything = async (id) => {
      for (const entity of ['Comment', 'FeedLike', 'CommentVote', 'SavedPost']) {
        for (const row of await store.filter(entity, { post_id: id })) await store.delete(entity, row.id);
      }
      await store.delete('FeedPost', id);
    };
    await removeWithEverything(post_id);
    // Reposts of it keep their own words but no longer carry its copy; a bare
    // repost has nothing left to show and goes too.
    for (const repost of await store.filter('FeedPost', { repost_of: post_id })) {
      if (!String(repost.body || '').trim()) { await removeWithEverything(repost.id); continue; }
      await store.update('FeedPost', repost.id, { repost_removed: true, repost_body: '', repost_image_urls: [], repost_author_name: '', repost_author_headline: '' });
    }
    if (post.repost_of) {
      const original = await store.get('FeedPost', post.repost_of);
      if (original) await store.update('FeedPost', original.id, { repost_count: await store.count('FeedPost', { repost_of: original.id }) });
    }
    if (!own) {
      await store.create('ActivityEvent', { type: 'moderation', entity: 'FeedPost', target_id: post_id, from: 'published', to: 'deleted', actor_role: user.role }, user);
    }
    return { ok: true };
  },

  // ---- provider activity ----------------------------------------------------

  // save   → SavedProvider  (private to the member: their own list)
  // use    → ProviderUsage   (private signal, public count)
  // vouch  → Vouch           (public, and carries the member's name: a vouch
  //                           is a statement, not a bookmark)
  async toggleCommunityActivity({ providerId, activity }, user) {
    await assertWritable(user);
    need(providerId, 'Missing listing.');
    const provider = await store.get('Provider', providerId);
    if (!provider) fail('Listing not found.', 404);

    const kind = ACTIVITIES[activity];
    if (!kind) fail('Unknown activity.');
    // A vouch names the member who gave it and a use is counted in public. On
    // a crisis line, an addiction service, a fertility organization or a
    // mikvah, that record says something about the member's own life to
    // everyone, permanently. The client does not render these controls there;
    // this is what makes that a rule rather than a decoration.
    //
    // Saving stays allowed: a save is private to the person who made it.
    if (activity !== 'save' && isSensitiveListing(provider)) {
      fail('Public "used this" and vouches are turned off for this kind of listing.');
    }
    // Switched off site-wide from the admin area: no new vouches and no
    // withdrawals either, so the rows stand as they were until it comes back.
    if (activity === 'vouch' && !(await vouchesEnabled())) fail('Vouching is turned off right now.', 403);
    if (activity === 'vouch' && (provider.created_by_id === user.id || provider.owner_id === user.id)) {
      fail('You cannot vouch for your own listing.');
    }
    const existing = await store.filter(kind.entity, { provider_id: providerId, created_by_id: user.id });

    let active;
    if (existing.length) {
      for (const row of existing) await store.delete(kind.entity, row.id);
      active = false;
    } else {
      await store.create(
        kind.entity,
        {
          provider_id: providerId, provider_name: provider.name, category: provider.category,
          ...(activity === 'vouch' ? authorFields(user) : {}),
        },
        user
      );
      active = true;
    }

    const count = await store.count(kind.entity, { provider_id: providerId });
    await store.update('Provider', providerId, { [kind.field]: count });

    // The business hears who vouched — the strongest nudge there is to claim
    // and complete a listing.
    if (activity === 'vouch' && active) {
      const owner = provider.owner_id || provider.created_by_id;
      if (owner && owner !== user.id) {
        await notify(owner, {
          type: 'vouch',
          actor_id: user.id,
          actor_name: user.full_name || user.email,
          target_type: 'provider',
          target_id: providerId,
          message: `${user.full_name || 'A community member'} vouched for ${provider.name}`,
        });
      }
    }
    return { active, count };
  },

  // ---- messaging ------------------------------------------------------------

  async sendMessage({ recipient_id, body }, user) {
    await assertWritable(user);
    need(recipient_id, 'Missing recipient.');
    const text = String(body || '').trim();
    if (!text) fail('Write a message first.');
    if (recipient_id === user.id) fail('You cannot message yourself.');
    const recipient = await users.byId(recipient_id);
    if (!recipient) fail('That member could not be found.', 404);
    // Every visitor reads as the guest; a message to it would be public.
    if (recipient.email === GUEST_EMAIL) fail('That member cannot receive messages.');

    // Only people you are connected to. The UI already hides the message button
    // otherwise, but that is not enforcement — without this a direct POST could
    // reach anyone, which is how a community app turns into a cold-outreach
    // channel. An existing thread also qualifies, so a conversation started
    // before a connection lapsed can still be replied to.
    if (!(await canMessage(user.id, recipient_id))) {
      fail('You can only message people you are connected with.', 403);
    }

    const message = await store.create(
      'Message',
      {
        recipient_id,
        sender_id: user.id,
        sender_name: user.full_name || user.email,
        body: text,
        read: false,
      },
      user
    );
    await notify(recipient_id, {
      type: 'message',
      actor_id: user.id,
      actor_name: user.full_name || user.email,
      target_type: 'message',
      target_id: user.id,
      message: `${user.full_name || 'Someone'} sent you a message`,
    });
    return { message };
  },

  // A reaction on a message in a thread you are part of. One per person per
  // message, stored on the message keyed by member id; the same reaction again
  // removes it. Nobody is notified — it is a nod, not a message.
  async reactToMessage({ message_id, reaction }, user) {
    await assertWritable(user);
    need(message_id, 'Missing message.');
    const message = await store.get('Message', message_id);
    if (!message) fail('Message not found.', 404);
    if (message.sender_id !== user.id && message.recipient_id !== user.id) fail('Not your conversation.', 403);
    const wanted = validReaction(reaction);
    if (!wanted) fail('Unknown reaction.');
    const reactions = { ...(message.reactions || {}) };
    if (reactions[user.id] === wanted) delete reactions[user.id];
    else reactions[user.id] = wanted;
    return { message: await store.update('Message', message_id, { reactions }) };
  },

  // ---- zmanim ---------------------------------------------------------------

  // The simulator passes { debug: {...} } to preview another time or location; that
  // only ever overlays the caller's own profile, never another user's.
  //
  // A guest has no profile of their own (every visitor shares one), so the
  // place they picked in this browser is sent as `place` and the times are
  // worked out for it. Only for a guest or a signed-out visitor: a member's
  // times always come from their own saved location.
  async getShabbosStatus({ debug, place } = {}, user) {
    let profile = { ...(user || {}) };
    if ((!user || user.email === GUEST_EMAIL) && place && typeof place === 'object') {
      const latitude = Number(place.latitude), longitude = Number(place.longitude);
      if (Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) {
        profile = {
          latitude, longitude,
          // From the coordinates, not the device, which is wrong whenever someone travels.
          timezone: tzFor(latitude, longitude),
          city: String(place.city || '').slice(0, 80),
          country_code: String(place.country_code || '').slice(0, 2),
        };
      }
    }
    let now = Date.now();
    if (debug && typeof debug === 'object') {
      if (debug.now) now = new Date(debug.now).getTime() || now;
      for (const key of ['latitude', 'longitude', 'timezone', 'city', 'country_code']) {
        if (debug[key] !== undefined && debug[key] !== null && debug[key] !== '') profile[key] = debug[key];
      }
    }
    return await computeShabbosStatus(profile, now);
  },

  // ---- translation -----------------------------------------------------------

  // Click-to-translate for posts and comments, so a Yiddish, Hebrew, or
  // English post reaches everyone rather than only its own language's readers.
  // Blocked for the shared guest session purely for cost control — a visitor
  // can still read the original text.
  async translateText({ text, target }, user) {
    if (user.email === GUEST_EMAIL) fail('Create an account to translate posts.', 403);
    return await translate(text, target);
  },
};

export const publicFunctions = new Set(['getShabbosStatus']);
