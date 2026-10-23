// Klal API client.
//
// One object — entities / auth / functions / integrations — is the app's entire
// interface to the server. Components import `api` and never touch fetch, so
// auth headers, error shapes and the token live in exactly one place.
import { shrinkImage, putWithProgress } from '@/lib/media';

const TOKEN_KEY = 'kc_access_token';
const API = '/api';

export const tokenStore = {
  get: () => {
    try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
  },
  // Changing the token changes who you are, so the cached session below is
  // dropped here rather than at each call site. Five places set a token
  // directly — adopting a guest session, email login, Google login, register,
  // verify-otp — and every one of them would otherwise leave a signed-in
  // visitor reading a cached guest identity until the TTL expired.
  set: (token) => {
    try { token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ }
    forgetMe();
  },
};

class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

async function request(method, path, { body, query, raw } = {}) {
  const url = new URL(API + path, window.location.origin);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    }
  }

  const headers = {};
  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body && !raw) headers['Content-Type'] = 'application/json';

  const res = await fetch(url, {
    method,
    headers,
    body: raw ? body : body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  if (!res.ok) throw new ApiError(data?.error || res.statusText, res.status, data);
  return data;
}

// ------------------------------------------------------------ account gate --

// Visitors browse as a shared guest account. Anything that would write —
// posting, liking, connecting, saving, editing a profile — needs an account of
// their own. Components call api.auth.requireAccount() before such an action;
// for a guest it raises this event, which AccountRequiredModal (mounted once in
// AppLayout) turns into a "create an account" prompt. The server refuses guest
// writes regardless (KC_GUEST_READONLY), so this is the polite layer, not the
// enforcement.
export const ACCOUNT_REQUIRED_EVENT = 'kc:account-required';
export const promptForAccount = () => window.dispatchEvent(new CustomEvent(ACCOUNT_REQUIRED_EVENT));

// The last session the server described, so a gate does not need a round trip
// on every click.
//
// This used to be written and never read: me() overwrote it, isAuthenticated()
// fired its own GET /auth/me and threw the body away, and requireAccount()
// called both — so a single click could ask the server who you are three
// times, and a cold page load asked it once per page component. Now every
// caller goes through meNow(): one in-flight request shared by all of them,
// and a short cache so a burst of gates costs nothing. Anything that changes
// identity (a new token, a logout, a profile edit) clears it.
let lastMe = null;
let mePending = null;
let meAt = 0;
const ME_TTL_MS = 30_000;

const forgetMe = () => { lastMe = null; mePending = null; meAt = 0; };

function meNow({ force = false } = {}) {
  if (!force && lastMe && Date.now() - meAt < ME_TTL_MS) return Promise.resolve(lastMe);
  if (!force && mePending) return mePending;
  mePending = request('GET', '/auth/me')
    .then((me) => { lastMe = me; meAt = Date.now(); return me; })
    .finally(() => { mePending = null; });
  return mePending;
}

// ---------------------------------------------------------------- entities --

// The 18 entities the app uses. Listed explicitly so a typo like
// `api.entities.Provdier` fails loudly instead of silently returning [].
const ENTITY_NAMES = [
  'Provider', 'Company', 'Category', 'Comment', 'CommunityNote', 'Connection',
  'ActivityEvent', 'FeedPost', 'FeedLike', 'Message', 'Notification', 'Setting',
  'SavedProvider', 'ProviderUsage', 'ClaimRequest', 'ListingChangeRequest',
  'ListingReport', 'PrivateReport', 'Vouch', 'CommentVote', 'Invite', 'User',
  'SavedPost', 'SkillEndorsement', 'Recommendation', 'Job', 'JobApplication',
];

function entityApi(name) {
  const base = name === 'User' ? '/users' : `/entities/${name}`;
  return {
    list: (sort, limit) => request('GET', base, { query: { sort, limit } }),
    filter: (query, sort, limit) => request('GET', base, { query: { query, sort, limit } }),
    get: (id) => request('GET', `${base}/${id}`),
    create: (obj) => request('POST', base, { body: obj }),
    update: (id, obj) => request('PUT', `${base}/${id}`, { body: obj }),
    delete: (id) => request('DELETE', `${base}/${id}`),
    updateMany: (query, update) =>
      request('POST', `/entities/${name}/update-many`, { body: { query, update } }),

    // Polling stands in for realtime: pass a callback, get an unsubscribe
    // function back. Swapping in websockets later means changing only this.
    subscribe: (callback, intervalMs = 20000) => {
      const id = setInterval(() => { try { callback(); } catch { /* caller handles */ } }, intervalMs);
      return () => clearInterval(id);
    },
  };
}

const entities = Object.fromEntries(ENTITY_NAMES.map((name) => [name, entityApi(name)]));

// -------------------------------------------------------------------- auth --

const loginUrl = (returnTo) =>
  `/login${returnTo ? `?returnTo=${encodeURIComponent(toSamePath(returnTo))}` : ''}`;

// redirectToLogin is called with a full href in most places; the login page
// only accepts same-origin paths, so normalize before handing it over.
function toSamePath(target) {
  try {
    const url = new URL(target, window.location.origin);
    if (url.origin !== window.location.origin) return '/';
    return url.pathname + url.search;
  } catch {
    return '/';
  }
}

const auth = {
  // Pass { force: true } right after something that changes the session.
  async me(opts) {
    return meNow(opts);
  },

  // True for a signed-in member with their own account — not the shared
  // guest session. Reads work for the guest; writes do not.
  async hasAccount() {
    if (!(await this.isAuthenticated())) return false;
    // Falls back to the last identity we were told rather than to "no
    // account": on a transport failure this used to show a real member the
    // "Join Klal to do that" modal in the middle of their own action.
    const me = await meNow().catch(() => lastMe);
    return !!me && !me.guest;
  },

  // Gate for anything that writes. Signed out → login page (and back here
  // afterwards); guest → the "create an account" prompt; member → true.
  async requireAccount() {
    if (!(await this.isAuthenticated())) { this.redirectToLogin(window.location.href); return false; }
    if (await this.hasAccount()) return true;
    promptForAccount();
    return false;
  },

  async isAuthenticated() {
    // No session yet: on a demo instance take the guest one.
    if (!tokenStore.get()) await adoptDemoSession();
    if (!tokenStore.get()) return false;
    try {
      await meNow();
      return true;
    } catch (err) {
      // A token that no longer resolves — the account it referenced is gone, or
      // it expired. Discard it and try for a guest session, otherwise a visitor
      // holding a stale token is stuck at the login wall forever: adoptDemoSession
      // refuses to replace an existing token, and nothing else clears it.
      if (err.status === 401 || err.status === 403) {
        tokenStore.set(null);
        forgetMe();
        if (await adoptDemoSession()) return true;
        return false;
      }
      // The server never answered — a flaky connection, not a signed-out
      // visitor. Returning false here sent a signed-in member to /login
      // mid-action and lost whatever they had typed. We are holding a token;
      // believe it, and let the action itself fail loudly if it has to.
      return true;
    }
  },

  async updateMe(patch) {
    const updated = await request('PUT', '/auth/me', { body: patch });
    // The profile just changed; keep the cache honest rather than stale.
    forgetMe();
    return updated;
  },

  // Google's ID token in, a Klal session out. Carries the invite code the
  // visitor arrived with, like register() does.
  async loginWithGoogle(credential) {
    let invite_code = null;
    try { invite_code = localStorage.getItem('kc_invite_code') || null; } catch { /* fine */ }
    const res = await request('POST', '/auth/google', { body: { credential, invite_code } });
    tokenStore.set(res.access_token);
    try { localStorage.removeItem('kc_invite_code'); } catch { /* fine */ }
    return res;
  },

  async changePassword(current_password, new_password) {
    return request('PUT', '/auth/password', { body: { current_password, new_password } });
  },

  setToken(token) {
    tokenStore.set(token);
    forgetMe();
  },

  async loginViaEmailPassword(email, password) {
    const res = await request('POST', '/auth/login', { body: { email, password } });
    tokenStore.set(res.access_token);
    return res;
  },

  async register({ email, password, full_name }) {
    // An invite code remembered from a /join/<code> link, if any.
    let invite_code = null;
    try { invite_code = localStorage.getItem('kc_invite_code') || null; } catch { /* fine */ }
    const res = await request('POST', '/auth/register', { body: { email, password, full_name, invite_code } });
    try { if (res.ok) localStorage.removeItem('kc_invite_code'); } catch { /* fine */ }
    // With no mail provider the server signs the new account in directly.
    if (res.access_token) tokenStore.set(res.access_token);
    return res;
  },

  async verifyOtp({ email, otpCode }) {
    const res = await request('POST', '/auth/verify-otp', { body: { email, otpCode } });
    if (res.access_token) tokenStore.set(res.access_token);
    return res;
  },

  async resendOtp(email) {
    return request('POST', '/auth/resend-otp', { body: { email } });
  },

  async resetPasswordRequest(email) {
    return request('POST', '/auth/reset-password-request', { body: { email } });
  },

  async resetPassword({ email, resetToken, newPassword }) {
    return request('POST', '/auth/reset-password', { body: { email, resetToken, newPassword } });
  },

  logout(redirectTo) {
    forgetMe();
    tokenStore.set(null);
    window.location.href = redirectTo ? toSamePath(redirectTo) : '/';
  },

  redirectToLogin(returnTo) {
    window.location.href = loginUrl(returnTo || window.location.href);
  },
};

// --------------------------------------------------------------- functions --

// Callers check `r.status >= 400` and read `r.data.error`, so resolve on
// failure rather than throwing — that contract is load-bearing across the app.
const functionsApi = {
  async invoke(name, payload = {}) {
    try {
      const data = await request('POST', `/functions/${name}`, { body: payload });
      return { status: 200, data };
    } catch (err) {
      if (err instanceof ApiError) return { status: err.status, data: err.data || { error: err.message } };
      return { status: 500, data: { error: err.message || 'Network error' } };
    }
  },
};

// ---------------------------------------------------------------- geo --

// Geocoding goes through our server, never straight to a provider: the browser
// cannot set the User-Agent OSM requires, API keys must not ship to a client,
// and the user's coordinates should not be handed to a third party by their own
// browser. Shapes are normalized server-side, so swapping providers changes
// nothing here.
const geo = {
  reverse: (latitude, longitude) => request('GET', '/geo/reverse', { query: { lat: latitude, lon: longitude } }),
  // `extra`: { country: 'US', lat, lng } keeps to one country and puts the
  // nearest first.
  search: (q, limit = 8, extra = {}) => request('GET', '/geo/search', { query: { q, limit, ...extra } }),
  ip: () => request('GET', '/geo/ip'),
  tz: (latitude, longitude) => request('GET', '/geo/tz', { query: { lat: latitude, lon: longitude } }),
};

let configPromise = null;
// Cached for the page's lifetime — it is static per deployment, apart from
// admin switches like vouchesEnabled, which a reload picks up. A *failure*
// is not cached: one flaky request at boot used to pin `{}` for the whole
// session, which silently disabled guest browsing (guestBrowsing falsy, so
// adoptDemoSession refused) and left the Google sign-in button unrendered
// until a manual reload.
const getConfig = () => (configPromise ??= request('GET', '/config').catch((err) => {
  configPromise = null;
  throw err;
})).catch(() => ({}));

/**
 * On a demo instance, adopt the shared guest session so a visitor can browse the
 * signed-in parts of the app without hitting a login wall. Does nothing on a
 * real deployment, and never replaces an existing session.
 * @returns {Promise<boolean>} whether a demo session was adopted
 */
// One shared attempt across concurrent callers. The token guard below is
// checked before two awaits, so a cold load with several gates racing each
// issued its own POST /auth/demo-session and threw away the losing token —
// which is also what made the 401-recovery race below reachable.
let adopting = null;
export async function adoptDemoSession() {
  if (tokenStore.get()) return false;
  adopting ??= (async () => {
    try {
      const { guestBrowsing } = await getConfig();
      if (!guestBrowsing) return false;
      const res = await request('POST', '/auth/demo-session');
      if (!res?.access_token) return false;
      tokenStore.set(res.access_token);
      return true;
    } catch {
      return false;
    } finally {
      adopting = null;
    }
  })();
  return adopting;
}

// ------------------------------------------------------------ integrations --

const integrations = {
  Core: {
    async UploadFile({ file }) {
      const form = new FormData();
      form.append('file', await shrinkImage(file));
      return request('POST', '/upload', { body: form, raw: true });
    },
    // The server signs a link and the file goes straight to video storage;
    // see server/video.js for why it does not pass through the API.
    async UploadVideo({ file, onProgress }) {
      const { upload_url, file_url } = await request('POST', '/upload/video-link', { body: { content_type: file.type, size: file.size } });
      await putWithProgress(upload_url, file, onProgress);
      return { file_url };
    },
  },
};

export const api = {
  invites: { get: (code) => request('GET', `/invites/${encodeURIComponent(code)}`) },
  admin: {
    setRole: (id, role) => request('PUT', `/users/${encodeURIComponent(id)}/role`, { body: { role } }),
    resetPassword: (id) => request('POST', `/users/${encodeURIComponent(id)}/reset-password`),
    updateUser: (id, patch) => request('PUT', `/users/${encodeURIComponent(id)}`, { body: patch }),
    deleteUser: (id) => request('DELETE', `/users/${encodeURIComponent(id)}`),
    deleteListing: (id) => request('DELETE', `/admin/listings/${encodeURIComponent(id)}`),
    health: () => request('GET', '/admin/health'),
  }, entities, auth, functions: functionsApi, integrations, geo, getConfig };
export { ApiError };
export default api;
