// In-memory data layer for demo deployments.
//
// Mirrors the Postgres layer's interface exactly so nothing above it knows the
// difference. Used only when KC_DEMO_MODE=1 — never as a fallback for a missing
// DATABASE_URL, because silently accepting writes that vanish is far worse than
// failing loudly.
//
// Everything lives in the process, so writes survive only as long as a warm
// instance and are not shared between instances. That is fine for showing the
// app; it is not a database.
import { randomInt } from 'node:crypto';
import { nowISO, newId, userToPublic } from './db-shared.js';

/**
 * Builds an in-memory data layer. `onChange` receives a description of each
 * mutation — { op: 'put' | 'del', kind: 'record' | 'user', row | id } — which is
 * how the Blob-backed layer persists without duplicating the query logic below.
 * Deltas, not snapshots: two instances writing at once must not erase each
 * other's work when their writes are replayed.
 */
export function createMemoryStore({ onChange = () => {} } = {}) {
const records = [];
const userRows = [];
const otpRows = [];
const geoRows = new Map();

const RESERVED = new Set(['id', 'created_date', 'updated_date', 'created_by_id', 'created_by']);
const splitFields = (obj = {}) =>
  Object.fromEntries(Object.entries(obj).filter(([k]) => !RESERVED.has(k)));

const toRecord = (row) =>
  row && {
    ...row.data,
    id: row.id,
    created_date: row.created_date,
    updated_date: row.updated_date,
    created_by_id: row.created_by_id,
    created_by: row.created_by,
  };

// Identical semantics to the Postgres layer — see db-postgres.js.
function applySort(rows, sort) {
  if (!sort) return rows;
  const desc = sort.startsWith('-');
  const key = desc ? sort.slice(1) : sort;
  return [...rows].sort((a, b) => {
    const av = a?.[key], bv = b?.[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'number' && typeof bv === 'number') return desc ? bv - av : av - bv;
    const c = String(av).localeCompare(String(bv));
    return desc ? -c : c;
  });
}

function matches(record, query = {}) {
  return Object.entries(query).every(([k, want]) => {
    const got = record?.[k];
    if (Array.isArray(want)) return want.includes(got);
    if (Array.isArray(got)) return got.includes(want);
    return got === want;
  });
}

const rowsFor = (entity) => records.filter((r) => r.entity === entity).map(toRecord);

const pool = { end: async () => {} };
const query = async () => {
  throw new Error('Raw SQL is not available in demo mode.');
};
function ready() { return Promise.resolve(); }
function migrate() { return Promise.resolve(); }

const store = {
  async list(entity, sort, limit) {
    const sorted = applySort(rowsFor(entity), sort || '-created_date');
    return limit ? sorted.slice(0, Number(limit)) : sorted;
  },
  async filter(entity, query, sort, limit) {
    const hits = rowsFor(entity).filter((r) => matches(r, query));
    const sorted = applySort(hits, sort || '-created_date');
    return limit ? sorted.slice(0, Number(limit)) : sorted;
  },
  async get(entity, id) {
    return toRecord(records.find((r) => r.entity === entity && r.id === id));
  },
  async create(entity, obj = {}, actor = null) {
    const ts = nowISO();
    const row = {
      id: obj.id || newId(),
      entity,
      data: splitFields(obj),
      created_date: ts,
      updated_date: ts,
      created_by_id: obj.created_by_id ?? actor?.id ?? null,
      created_by: obj.created_by ?? actor?.email ?? null,
    };
    records.push(row);
    onChange({ op: 'put', kind: 'record', row });
    return toRecord(row);
  },
  async update(entity, id, patch = {}) {
    const row = records.find((r) => r.entity === entity && r.id === id);
    if (!row) return null;
    row.data = { ...row.data, ...splitFields(patch) };
    row.updated_date = nowISO();
    onChange({ op: 'put', kind: 'record', row });
    return toRecord(row);
  },
  async delete(entity, id) {
    const i = records.findIndex((r) => r.entity === entity && r.id === id);
    if (i === -1) return false;
    records.splice(i, 1);
    onChange({ op: 'del', kind: 'record', id });
    return true;
  },
  async updateMany(entity, query, patch = {}) {
    const fields = patch.$set ? patch.$set : patch;
    const hits = await this.filter(entity, query);
    for (const hit of hits) await this.update(entity, hit.id, fields);
    return hits.length;
  },
  async count(entity, query = {}) {
    return (await this.filter(entity, query)).length;
  },
};

const users = {
  async byEmail(email) {
    const wanted = String(email || '').trim().toLowerCase();
    return userRows.find((u) => u.email.toLowerCase() === wanted) || null;
  },
  async byId(id) {
    return userRows.find((u) => u.id === id) || null;
  },
  async create({ id, email, password_hash, role = 'user', verified = false, ...rest }) {
    const ts = nowISO();
    const row = {
      id: id || newId(), email: String(email).trim(), password_hash, role,
      verified: !!verified, data: rest, created_date: ts, updated_date: ts,
    };
    userRows.push(row);
    onChange({ op: 'put', kind: 'user', row });
    return row;
  },
  async update(id, patch = {}) {
    const row = userRows.find((u) => u.id === id);
    if (!row) return null;
    const { email, role, verified, password_hash, ...rest } = patch;
    if (email !== undefined) row.email = email;
    if (role !== undefined) row.role = role;
    if (verified !== undefined) row.verified = !!verified;
    if (password_hash !== undefined) row.password_hash = password_hash;
    row.data = { ...row.data, ...rest };
    row.updated_date = nowISO();
    onChange({ op: 'put', kind: 'user', row });
    return row;
  },
  async all() {
    return [...userRows].sort((a, b) => String(b.created_date).localeCompare(String(a.created_date)));
  },
  async delete(id) {
    const i = userRows.findIndex((u) => u.id === id);
    if (i < 0) return false;
    userRows.splice(i, 1);
    onChange({ op: 'del', kind: 'user', id });
    return true;
  },
};

const otp = {
  async issue(email, purpose, ttlMinutes = 15) {
    // Mirrors the Postgres layer: unguessable codes, not Math.random.
    const code = String(randomInt(100000, 1000000));
    const key = String(email).trim().toLowerCase();
    for (let i = otpRows.length - 1; i >= 0; i--) {
      if (otpRows[i].email === key && otpRows[i].purpose === purpose) otpRows.splice(i, 1);
    }
    otpRows.push({ email: key, code, purpose, expires_at: Date.now() + ttlMinutes * 60_000 });
    return code;
  },
  async issuedAt(email, purpose, ttlMinutes = 15) {
    const key = String(email || '').trim().toLowerCase();
    const row = otpRows.find((r) => r.email === key && r.purpose === purpose);
    return row ? row.expires_at - ttlMinutes * 60_000 : null;
  },
  async verify(email, purpose, code) {
    const key = String(email || '').trim().toLowerCase();
    const i = otpRows.findIndex((r) => r.email === key && r.purpose === purpose);
    if (i === -1) return false;
    const row = otpRows[i];
    if (row.expires_at < Date.now() || row.code !== String(code).trim()) return false;
    otpRows.splice(i, 1);
    return true;
  },
};

const geoCache = {
  async get(key) {
    const hit = geoRows.get(key);
    if (!hit) return null;
    if (hit.expires_at < Date.now()) { geoRows.delete(key); return null; }
    return hit.value;
  },
  async set(key, value, ttlMs) {
    geoRows.set(key, { value, expires_at: Date.now() + ttlMs });
    return value;
  },
};

  // Replays a mutation without re-emitting it — used when rebuilding state
  // from a log. Upsert by id, so replaying the same entry twice is harmless.
  function apply(event) {
    if (!event) return;
    const target = event.kind === 'user' ? userRows : records;
    if (event.op === 'del') {
      const i = target.findIndex((r) => r.id === event.id);
      if (i !== -1) target.splice(i, 1);
      return;
    }
    if (!event.row) return;
    const i = target.findIndex((r) => r.id === event.row.id);
    if (i === -1) target.push(event.row);
    else target[i] = event.row;
  }

  return { pool, query, ready, migrate, store, users, otp, geoCache, apply, _raw: { records, userRows, otpRows, geoRows } };
}

// The plain in-memory layer: a store with no persistence behind it.
const singleton = createMemoryStore();
export const { pool, query, ready, migrate, store, users, otp, geoCache } = singleton;
export { nowISO, newId, userToPublic };
