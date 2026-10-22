import { normalizeMinyanim } from './minyanim.js';
import { normalizeKitchen } from './kitchen.js';

// Who controls a listing.
//
// Whoever the Klal team has accepted as its owner, through a claim. Nobody
// else: adding a listing does not make it yours. It used to — whoever added a
// listing could keep rewriting it until the business claimed it, so a stranger
// who typed in a shop could change its phone number or description for as long
// as the shop had not noticed. Everyone who is not the owner (the person who
// added it included) suggests a correction, which reaches the team privately.
// Someone adding their own business ticks "This is my business" on the form,
// which files the claim for them.
//
// This lives in one place because the rule needs to hold in five: canWrite on
// the generic entity route, the two self-service functions (tagline and payment
// link), the Edit link on a listing page, the edit form's own refusal, and the
// "manage my listings" list. Written out five times it would drift, and the
// drift would be silent — which is exactly what happened with the admin-only
// field list earlier: the generic route refused them while createListing wrote
// them straight onto the row.
export const listingEditor = (row) => (row && row.owner_id) || null;

// Staff on listings: admins and moderators. The team accounts correct
// addresses, hours and descriptions across the directory as part of the job,
// and before this the only way a moderator could fix a typo on a listing they
// had not posted was to claim it — which would hand them a business's page.
// Editing as staff changes the words on the page and nothing about whose page
// it is: owner_id and created_by_id are left alone, so the rightful editor is
// still the rightful editor afterwards.
export const isListingStaff = (user) => !!user && (user.role === 'admin' || user.role === 'moderator');

/** May this person change this listing? Staff always may. */
/**
 * May this person change where a listing's money goes?
 *
 * Narrower than editing. Staff may fix a listing's hours, wording or photos
 * for the business, but the payment link is the one field whose misuse
 * moves money: a compromised or careless staff account pointing it at a
 * stranger's account is the worst thing "edit any listing" could enable, and
 * nothing a staff member legitimately does needs it. The business that owns
 * the listing sets it, and an admin can undo a bad one.
 */
export const canSetPaymentLink = (row, user) =>
  !!user && !!row && (user.role === 'admin' || listingEditor(row) === user.id);

export const canEditListing = (row, user) =>
  !!user && !!row && (isListingStaff(user) || listingEditor(row) === user.id);

// Shape, not permission.
//
// Creating a listing goes through listingInput, which filters badges to the
// ones the category allows, reduces a WhatsApp number to the digits wa.me
// needs, and caps the tagline. Editing one goes through the generic PUT route,
// which did none of that — so the edit form was a way around every rule the
// create path enforces. A plumber could not declare Pas Yisroel on the way in
// and could on the way back through.
//
// A patch is not a whole row, so this only touches keys the patch actually
// carries. The alternative — running the create normalizer over a patch — adds
// `badges: []`, `whatsapp: ''` and `languages: ['English']` to a row that never
// had them, which is how a one-field edit quietly rewrites four other fields.
export const GALLERY_MAX = 3;

// An image this site serves itself.
//
// A photo or logo on a listing is drawn into every visitor's browser, so a
// link to some other host turns the directory into a tracking pixel for that
// host, and lets whoever controls it swap the picture after staff have looked
// at it. Only our own uploads pass: a path under /api/files (the local-disk
// backend) or an https link on the Vercel Blob store (production). The Blob
// host is matched by its suffix because the store's own subdomain is random
// per store and this module is shared with the browser, which cannot read
// the server's environment. The error text says "uploaded here" and the check
// now means it.
//
// Length is capped and the link has to parse, because an unparseable
// `https://` on its own gave a broken <img>, and a 100KB "URL" rode along on
// every list response that carried the row.
export const IMAGE_URL_MAX = 2048;
export function isOwnUploadUrl(value) {
  const url = String(value || '');
  if (!url || url.length > IMAGE_URL_MAX) return false;
  if (url.startsWith('/api/files/')) return /^\/api\/files\/[\w.-]+$/.test(url);
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  return parsed.protocol === 'https:' && parsed.hostname.endsWith('.public.blob.vercel-storage.com');
}

const refuse = (message) => { const err = new Error(message); err.statusCode = 400; throw err; };

// Zero-width characters survive String.prototype.trim, so a caption made
// only of them read as present while showing nothing under the photo.
const visibleText = (value) => String(value || '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();

// The listing's logo. Empty is allowed, because clearing a logo is sent as
// logo_url: '' — the one way an owner can take a picture down.
export function normalizeLogoUrl(raw) {
  const url = String(raw || '').trim();
  if (!url) return '';
  if (!isOwnUploadUrl(url)) refuse('The logo has to be uploaded here, not linked from elsewhere.');
  return url;
}

// Photos of the business.
//
// A listing may carry a few pictures. When anyone but the business adds one —
// staff, or whoever typed the listing in — it has to say where it came from and
// link to the official source, so a visitor can tell a photo the business
// published from one somebody found. The listing's accepted owner is the
// exception: their own pictures are theirs, so a credit and a source link are
// optional, and the photo is marked from_owner so the page can say it came from
// the business. That mark is decided here from who is saving, never taken from
// the request. Staff saving a listing keep an owner photo's mark (matched by its
// image), so tidying the page does not suddenly demand a credit for a picture
// the owner put up.
//
// An uncredited image is refused rather than silently dropped: a form that
// quietly loses a photo looks like the upload failed, and the person uploads it
// again. safeUrl is handed in because the http(s)-only check lives in the
// server's functions module and this file is shared with the browser, which
// must not import that.
//
// Throws with statusCode 400 like the server's own fail(), so both routes can
// answer with the message as written.
export function normalizeGallery(raw, { safeUrl, byOwner = false, previous = [] }) {
  if (raw === null || raw === undefined || raw === '') return [];
  if (!Array.isArray(raw)) refuse('Photos must be a list.');
  if (raw.length > GALLERY_MAX) refuse(`A listing can show up to ${GALLERY_MAX} photos.`);
  const before = (Array.isArray(previous) ? previous : []).filter((p) => p && typeof p === 'object');
  const ownerPhotos = new Set(before.filter((p) => p.from_owner).map((p) => p.url));
  const known = new Set(before.map((p) => p.url));
  return raw.map((item) => {
    if (!item || typeof item !== 'object') refuse('Each photo needs an image, a caption and a source link.');
    const url = String(item.url || '').trim();
    const caption = visibleText(item.caption).slice(0, 200);
    if (!url) refuse('Each photo needs an image.');
    if (!isOwnUploadUrl(url)) refuse('Photos have to be uploaded here, not linked from elsewhere.');
    // The owner vouches for every photo they save without a credit; one they
    // keep with a credit (say, a press shot staff added) stays credited.
    if (ownerPhotos.has(url) || (byOwner && (!caption || !known.has(url)))) {
      return { url, caption, source_url: safeUrl(item.source_url), from_owner: true };
    }
    if (!caption) refuse('Each photo needs a caption saying where it came from, like "Photo: example.org".');
    const source_url = safeUrl(item.source_url);
    if (!source_url) refuse('Each photo needs a link to its official source.');
    return { url, caption, source_url };
  });
}

// user is whoever is saving; their being the listing's accepted owner is what
// lets a photo go without a credit (see normalizeGallery).
export function normalizeListingPatch(patch, row, { badgeById, badgeApplies, safeUrl, user = null }) {
  if (!patch || typeof patch !== 'object') return patch;
  const out = { ...patch };
  if ('gallery' in out) {
    const byOwner = !!user && !!listingEditor(row) && listingEditor(row) === user.id;
    out.gallery = normalizeGallery(out.gallery, { safeUrl, byOwner, previous: row?.gallery });
  }
  if ('logo_url' in out) out.logo_url = normalizeLogoUrl(out.logo_url);
  if ('minyanim' in out) out.minyanim = normalizeMinyanim(out.minyanim);
  const category = 'category' in out ? out.category : row?.category;
  // Like a badge, the kitchen only means anything on a food listing.
  if ('kitchen' in out || ('category' in out && row?.kitchen)) out.kitchen = normalizeKitchen('kitchen' in out ? out.kitchen : row?.kitchen, category);
  // Anyone setting the kitchen by hand has answered the "check the kitchens"
  // note the backfill left on a meat-and-dairy place.
  if ('kitchen' in out) out.kitchen_unconfirmed = false;
  if ('not_jewish_owned' in out) out.not_jewish_owned = out.not_jewish_owned === true;
  // A category change re-tests the badges already on the row, because a badge
  // only means anything next to the trade it was granted for.
  if ('badges' in out || ('category' in out && Array.isArray(row?.badges) && row.badges.length)) {
    const declared = Array.isArray(out.badges) ? out.badges : (row?.badges || []);
    out.badges = [...new Set(declared.filter((id) => badgeById[id] && badgeApplies(badgeById[id], category)))];
  }
  // A verified badge the listing has stopped declaring has to come down.
  // The page draws a badge that is declared OR confirmed, and verified_badges
  // is an admin field the owner's patch cannot touch — so un-ticking a badge
  // in the edit form saved and changed nothing on the page, while the form
  // said "Your changes are live." That is the one direction that must work: a
  // caterer who stops being cholov Yisroel, or stops closing for Shabbos, is
  // the only one who knows, and had no way to say so. Confirmed is a subset of
  // declared, so the server keeps it one.
  if ('badges' in out || 'category' in out) {
    const declared = new Set('badges' in out ? out.badges : (row?.badges || []));
    const confirmed = 'verified_badges' in out ? out.verified_badges : row?.verified_badges;
    if (Array.isArray(confirmed) && confirmed.length) {
      out.verified_badges = confirmed.filter((id) => declared.has(id) && badgeById[id] && badgeApplies(badgeById[id], category));
    }
  }
  if ('whatsapp' in out) {
    out.whatsapp = out.whatsapp ? String(out.whatsapp).replace(/\D/g, '').replace(/^1?(\d{10})$/, '1$1') : '';
  }
  if ('tagline' in out) out.tagline = String(out.tagline || '').slice(0, 120);
  // The public listing page maps over both of these. A string where an array
  // belongs is a 500 on a page anyone can open.
  for (const field of ['service_areas', 'languages']) {
    if (!(field in out)) continue;
    const given = out[field];
    out[field] = [...new Set((Array.isArray(given) ? given : String(given || '').split(','))
      .map((v) => String(v).trim())
      .filter(Boolean))];
  }
  return out;
}
