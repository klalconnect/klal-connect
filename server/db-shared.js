import { createHash } from 'node:crypto';
// Helpers shared by both data layers.
export const nowISO = () => new Date().toISOString();

// Visitors on a KC_DEMO_MODE deployment are signed in as this one shared
// account so they can browse without a login wall. It is a placeholder, not a
// person: nothing written onto its row is ever shown (see app.js).
export const GUEST_EMAIL = 'guest@klal.app';
export const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 24);

// A stable id derived from content, for seeded rows. Two instances seeding the
// same catalogue produce the same ids, so a link or a session minted against
// one still resolves on another — which matters when the store lives in process
// memory. Also makes re-seeding idempotent.
export function stableId(...parts) {
  return createHash('sha256').update(parts.join(':')).digest('hex').slice(0, 24);
}

// The master admin: the site owner's own account, named here by its login
// email so it is theirs from the first deploy and no other admin can claim
// it first. KC_MASTER_ADMIN_EMAIL (comma-separated) overrides the list. The
// account always reads as an admin, and app.js refuses any other admin who
// tries to demote, suspend, edit, reset or delete it.
//
// The master admin can hand it over from the admin screen. That is written on
// the two user rows (master_admin true on the new one, false on the old), so
// a stored flag wins over the email list.
const OWNER_EMAILS = ['eliepstein111@gmail.com'];
const masterEmails = () => (process.env.KC_MASTER_ADMIN_EMAIL ? process.env.KC_MASTER_ADMIN_EMAIL.split(',') : OWNER_EMAILS)
  .map((e) => e.trim().toLowerCase()).filter(Boolean);
export const isMasterEmail = (email) => !!email && masterEmails().includes(String(email).trim().toLowerCase());
const isMasterRow = (row) => {
  const flag = row.data?.master_admin;
  return flag === true || (flag !== false && isMasterEmail(row.email));
};

// The app reads users as plain objects; password_hash must never be among them.
export function userToPublic(row) {
  if (!row) return null;
  return {
    ...(row.data || {}),
    id: row.id,
    email: row.email,
    role: isMasterRow(row) ? 'admin' : row.role,
    master_admin: isMasterRow(row),
    verified: !!row.verified,
    created_date: row.created_date instanceof Date ? row.created_date.toISOString() : row.created_date,
    updated_date: row.updated_date instanceof Date ? row.updated_date.toISOString() : row.updated_date,
  };
}
