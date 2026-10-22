// Email/password auth with JWT sessions.
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { users, userToPublic, otp } from './db.js';
import { mailConfigured, sendMail, codeEmail } from './mail.js';

const SECRET = process.env.KC_JWT_SECRET || 'kc-dev-secret-change-me';
const TOKEN_TTL = '30d';

if (!process.env.KC_JWT_SECRET && process.env.NODE_ENV === 'production') {
  console.warn('[auth] KC_JWT_SECRET is not set — refusing to use the dev secret in production.');
  process.exit(1);
}

export const hashPassword = (pw) => bcrypt.hashSync(String(pw), 10);
export const checkPassword = (pw, hash) => !!hash && bcrypt.compareSync(String(pw), hash);

export const signToken = (user) =>
  jwt.sign({ sub: user.id, email: user.email, role: user.role }, SECRET, { expiresIn: TOKEN_TTL });

export function verifyToken(token) {
  try {
    return jwt.verify(token, SECRET);
  } catch {
    return null;
  }
}

function tokenFromRequest(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

// Populates req.user when a valid token is present; never rejects. Routes that
// require a session use requireAuth below.
export async function attachUser(req, _res, next) {
  try {
    const claims = verifyToken(tokenFromRequest(req));
    const row = claims ? userToPublic(await users.byId(claims.sub)) : null;
    // Deactivation has to revoke access, not merely hide a profile. This is
    // the one chokepoint every authenticated route passes through, so a
    // disabled account reads as no session at all and the 30-day token it is
    // still holding stops working the moment an admin deactivates it.
    req.user = row && row.disabled === true ? null : row;
    next();
  } catch (err) {
    next(err);
  }
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

// With no mail provider wired up, verification codes are logged and handed back
// to the caller so the flow can be completed locally.
//
// Fail safe: that only ever happens when explicitly opted in AND not in
// production. Returning a code to an unauthenticated caller in production would
// let anyone register under someone else's address and verify it themselves,
// so the dangerous case must require two positive signals, never a default.
const DEV_CODES = process.env.KC_EMAIL_DELIVERY === 'dev' && process.env.NODE_ENV !== 'production';
const REAL_MAIL = process.env.KC_EMAIL_DELIVERY === 'real' && mailConfigured();

if (process.env.KC_EMAIL_DELIVERY === 'real' && !mailConfigured()) {
  console.warn('[auth] KC_EMAIL_DELIVERY=real but RESEND_API_KEY / KC_MAIL_FROM are not set — codes cannot be delivered.');
}

// Whether a verification or reset code can actually reach the person: either a
// real mail provider, or the local dev mode that hands the code back.
export const canDeliverCodes = () => REAL_MAIL || DEV_CODES;
export const sendsRealMail = () => REAL_MAIL;

// Sends the code by email when a provider is configured. In local dev the
// code is returned to the caller instead; in production without a provider
// it goes nowhere, and the routes that call this already say so.
export async function deliverCode(email, purpose, code) {
  if (DEV_CODES) {
    console.log(`[auth] ${purpose} code for ${email}: ${code}`);
    return code;
  }
  if (REAL_MAIL) {
    try {
      await sendMail({ to: String(email).trim(), ...codeEmail(purpose, code) });
    } catch (err) {
      // Details stay in the server log; the person gets a sentence.
      console.error(`[auth] ${purpose} code to ${email} not sent:`, err.message);
      throw mailFailure(err);
    }
    console.log(`[auth] ${purpose} code emailed to ${email}`);
    return undefined;
  }
  console.log(`[auth] ${purpose} code for ${email}: (withheld — no mail provider)`);
  return undefined;
}

export const ADDRESS_REJECTED = "We couldn't send a verification email to that address. Please check it and try again.";
export const MAIL_UNAVAILABLE = "We couldn't send the email just now. Please try again in a few minutes.";

function mailFailure(cause) {
  const e = new Error(cause?.addressRejected ? ADDRESS_REJECTED : MAIL_UNAVAILABLE);
  e.statusCode = cause?.addressRejected ? 422 : 503;
  e.mailFailed = true;
  return e;
}

export { otp };
