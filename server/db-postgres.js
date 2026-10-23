// Postgres-backed document store.
//
// The app reads and writes ad-hoc fields across 18 entities, so records are
// stored as documents: one row each, fields in a jsonb blob. Adding a field is
// not a migration. Only the columns every entity is sorted or scoped by are
// lifted out of the blob into real columns.
//
// Serverless note: this module is imported once per warm instance, so the pool
// is created once and kept small. Against Supabase it must point at the
// transaction pooler, not the direct connection — a serverless platform opens
// far more short-lived connections than Postgres will accept directly.
import { randomInt } from 'node:crypto';
import pg from 'pg';
import tls from 'node:tls';
import fs from 'node:fs';
import { SUPABASE_CA } from './certs/supabase-ca.js';

const { Pool } = pg;

const rawConnectionString =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  'postgres://localhost:5432/klal_connect_dev';

// pg merges the parsed connection string OVER the config object, and
// pg-connection-string replaces ssl with {} whenever any sslmode/sslcert param
// is present. So a URL ending in ?sslmode=require silently discards the ssl
// settings below. Strip those params and configure TLS in code instead.
function stripSslParams(url) {
  try {
    const parsed = new URL(url);
    let found = false;
    for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) {
      if (parsed.searchParams.has(key)) { parsed.searchParams.delete(key); found = true; }
    }
    if (found) {
      console.warn('[db] stripped sslmode/ssl* from the connection string; TLS is configured in code');
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

const connectionString = stripSslParams(rawConnectionString);

// A hosted Postgres requires TLS; a local dev server does not.
const isLocal = /@?(localhost|127\.0\.0\.1)[:/]/.test(connectionString);

// Certificates are verified, with hostname checking. Supabase signs its pooler
// with a private CA ("Supabase Root 2021 CA"), so that root is shipped here and
// trusted alongside the system roots — the alternative, rejectUnauthorized:
// false, would accept any certificate and leave the connection open to
// interception. KC_PG_CA_FILE adds another provider's private CA the same way.
function trustedRoots() {
  const roots = [...tls.rootCertificates, SUPABASE_CA];
  if (process.env.KC_PG_CA_FILE) {
    try { roots.push(fs.readFileSync(process.env.KC_PG_CA_FILE, 'utf8')); }
    catch (err) { console.warn(`[db] could not read KC_PG_CA_FILE: ${err.message}`); }
  }
  return roots;
}

export const pool = new Pool({
  connectionString,
  ssl: isLocal ? false : { rejectUnauthorized: true, ca: trustedRoots() },
  // Not 1: a single instance serves concurrent requests, so a pool of one
  // serializes them. Not 10 either — the pooler's budget is shared across every
  // warm instance.
  max: Number(process.env.KC_PG_POOL_MAX || (process.env.VERCEL ? 3 : 10)),
  idleTimeoutMillis: process.env.VERCEL ? 5_000 : 10_000,
  connectionTimeoutMillis: 10_000,
  // A query that hangs would otherwise hold a pooler backend until the function
  // times out, starving every other instance.
  statement_timeout: 15_000,
  allowExitOnIdle: true,
});

// Lets Vercel drain the pool before freezing an instance. Optional dependency:
// absent locally, present on Vercel.
if (process.env.VERCEL) {
  try {
    const { attachDatabasePool } = await import('@vercel/functions');
    attachDatabasePool(pool);
  } catch {
    /* not installed — the pool still works, it just is not drained early */
  }
}

pool.on('error', (err) => console.error('[db] idle client error', err.message));

// Deliberately positional-only. Passing a `name` here would turn on server-side
// prepared statements, which Supabase's transaction pooler does not support
// ("prepared statement ... already exists").
export const query = (text, params) => pool.query(text, params);

import { nowISO, newId, userToPublic } from './db-shared.js';
export { nowISO, newId, userToPublic };

// ---- schema -----------------------------------------------------------------

let readyPromise = null;

// Called once per process before the first query.
//
// Set KC_AUTO_MIGRATE=0 in production and run `npm run migrate` on deploy
// instead: on a serverless host, a burst of cold starts would otherwise have
// every instance issuing DDL at once. IF NOT EXISTS makes that safe rather
// than correct, and it is wasted work on every cold start.
export function ready() {
  if (process.env.KC_AUTO_MIGRATE === '0') return Promise.resolve();
  readyPromise ??= migrate();
  return readyPromise;
}

export function migrate() {
  return (async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS records (
        id            TEXT PRIMARY KEY,
        entity        TEXT NOT NULL,
        data          JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_date  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_date  TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_by_id TEXT,
        created_by    TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_records_entity   ON records (entity, created_date DESC);
      CREATE INDEX IF NOT EXISTS idx_records_creator  ON records (entity, created_by_id);
      -- Containment queries on arbitrary document fields ride this index.
      CREATE INDEX IF NOT EXISTS idx_records_data_gin ON records USING GIN (data jsonb_path_ops);

      CREATE TABLE IF NOT EXISTS users (
        id            TEXT PRIMARY KEY,
        email         TEXT NOT NULL,
        password_hash TEXT,
        role          TEXT NOT NULL DEFAULT 'user',
        verified      BOOLEAN NOT NULL DEFAULT false,
        data          JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_date  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_date  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      -- Case-insensitive uniqueness: "A@b.com" and "a@b.com" are one account.
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (lower(email));

      CREATE TABLE IF NOT EXISTS otp_codes (
        email      TEXT NOT NULL,
        code       TEXT NOT NULL,
        purpose    TEXT NOT NULL,
        expires_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_otp_email ON otp_codes (lower(email), purpose);

      CREATE TABLE IF NOT EXISTS geo_cache (
        key        TEXT PRIMARY KEY,
        value      JSONB NOT NULL,
        expires_at BIGINT NOT NULL
      );
    `);
  })();
}

// ---- record <-> row ---------------------------------------------------------

// The app treats id/created_date/created_by_id as ordinary fields on the object,
// so flatten the row back into one object on the way out.
function toRecord(row) {
  if (!row) return null;
  return {
    ...row.data,
    id: row.id,
    created_date: row.created_date instanceof Date ? row.created_date.toISOString() : row.created_date,
    updated_date: row.updated_date instanceof Date ? row.updated_date.toISOString() : row.updated_date,
    created_by_id: row.created_by_id,
    created_by: row.created_by,
  };
}

const RESERVED = new Set(['id', 'created_date', 'updated_date', 'created_by_id', 'created_by']);
function splitFields(obj = {}) {
  const data = {};
  for (const [k, v] of Object.entries(obj)) if (!RESERVED.has(k)) data[k] = v;
  return data;
}

// ---- query helpers ----------------------------------------------------------

// Sort strings are "field" for ascending, "-field" for descending.
function applySort(rows, sort) {
  if (!sort) return rows;
  const desc = sort.startsWith('-');
  const key = desc ? sort.slice(1) : sort;
  return [...rows].sort((a, b) => {
    const av = a?.[key], bv = b?.[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;   // missing values sort last either way
    if (bv == null) return -1;
    if (typeof av === 'number' && typeof bv === 'number') return desc ? bv - av : av - bv;
    const c = String(av).localeCompare(String(bv));
    return desc ? -c : c;
  });
}

// Equality matching. A scan of the call sites showed the app never uses
// Mongo-style operators, so anything fancier would be dead code.
function matches(record, query = {}) {
  return Object.entries(query).every(([k, want]) => {
    const got = record?.[k];
    if (Array.isArray(want)) return want.includes(got);   // treat arrays as "in"
    if (Array.isArray(got)) return got.includes(want);    // tag-style fields
    return got === want;
  });
}

// Filtering and sorting stay in JS so the semantics above are preserved exactly.
// To keep that from meaning "fetch the whole table", the parts of a query that
// map cleanly onto real columns are pushed into SQL first, and scalar document
// fields become containment tests that ride the GIN index. SQL only narrows;
// matches() still decides, so the two can never disagree.
const COLUMN_FIELDS = new Set(['id', 'created_by_id', 'created_by']);
const isScalar = (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v);

function buildWhere(entity, query = {}) {
  const where = ['entity = $1'];
  const params = [entity];
  for (const [key, want] of Object.entries(query)) {
    if (COLUMN_FIELDS.has(key)) {
      if (Array.isArray(want)) {
        params.push(want);
        where.push(`${key} = ANY($${params.length})`);
      } else {
        params.push(want);
        where.push(`${key} = $${params.length}`);
      }
    } else if (isScalar(want) && /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      // A field that holds a scalar, or a tag-style array containing it —
      // both are how matches() reads equality.
      params.push(JSON.stringify({ [key]: want }), JSON.stringify({ [key]: [want] }));
      where.push(`(data @> $${params.length - 1}::jsonb OR data @> $${params.length}::jsonb)`);
    }
  }
  return { text: where.join(' AND '), params };
}

async function fetchRows(entity, query) {
  await ready();
  const { text, params } = buildWhere(entity, query);
  const { rows } = await pool.query(
    `SELECT * FROM records WHERE ${text} ORDER BY created_date DESC`,
    params
  );
  return rows.map(toRecord);
}

export const store = {
  async list(entity, sort, limit) {
    const rows = await fetchRows(entity, {});
    const sorted = applySort(rows, sort || '-created_date');
    return limit ? sorted.slice(0, Number(limit)) : sorted;
  },

  async filter(entity, query, sort, limit) {
    const rows = await fetchRows(entity, query);
    const hits = rows.filter((r) => matches(r, query));
    const sorted = applySort(hits, sort || '-created_date');
    return limit ? sorted.slice(0, Number(limit)) : sorted;
  },

  async get(entity, id) {
    await ready();
    const { rows } = await pool.query('SELECT * FROM records WHERE entity = $1 AND id = $2', [entity, id]);
    return toRecord(rows[0]);
  },

  async create(entity, obj = {}, actor = null) {
    await ready();
    const id = obj.id || newId();
    const { rows } = await pool.query(
      `INSERT INTO records (id, entity, data, created_by_id, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [
        id,
        entity,
        JSON.stringify(splitFields(obj)),
        obj.created_by_id ?? actor?.id ?? null,
        obj.created_by ?? actor?.email ?? null,
      ]
    );
    return toRecord(rows[0]);
  },

  async update(entity, id, patch = {}) {
    await ready();
    // Merge server-side so concurrent writers cannot clobber each other's
    // fields by round-tripping a whole document through the client.
    const { rows } = await pool.query(
      `UPDATE records SET data = data || $3::jsonb, updated_date = now()
       WHERE entity = $1 AND id = $2 RETURNING *`,
      [entity, id, JSON.stringify(splitFields(patch))]
    );
    return toRecord(rows[0]);
  },

  async delete(entity, id) {
    await ready();
    const { rowCount } = await pool.query('DELETE FROM records WHERE entity = $1 AND id = $2', [entity, id]);
    return rowCount > 0;
  },

  async updateMany(entity, query, patch = {}) {
    // The app passes Mongo-ish { $set: {...} } here; accept both shapes.
    const fields = patch.$set ? patch.$set : patch;
    const hits = await this.filter(entity, query);
    for (const hit of hits) await this.update(entity, hit.id, fields);
    return hits.length;
  },

  async count(entity, query = {}) {
    return (await this.filter(entity, query)).length;
  },
};

// ---- users ------------------------------------------------------------------


export const users = {
  async byEmail(email) {
    await ready();
    const { rows } = await pool.query('SELECT * FROM users WHERE lower(email) = lower($1)', [
      String(email || '').trim(),
    ]);
    return rows[0] || null;
  },
  async byId(id) {
    await ready();
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    return rows[0] || null;
  },
  async create({ id, email, password_hash, role = 'user', verified = false, ...rest }) {
    await ready();
    const { rows } = await pool.query(
      `INSERT INTO users (id, email, password_hash, role, verified, data)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [id || newId(), String(email).trim(), password_hash, role, !!verified, JSON.stringify(rest)]
    );
    return rows[0];
  },
  async update(id, patch = {}) {
    await ready();
    const { email, role, verified, password_hash, ...rest } = patch;
    const { rows } = await pool.query(
      `UPDATE users SET
         email         = COALESCE($2, email),
         role          = COALESCE($3, role),
         verified      = COALESCE($4, verified),
         password_hash = COALESCE($5, password_hash),
         data          = data || $6::jsonb,
         updated_date  = now()
       WHERE id = $1 RETURNING *`,
      [
        id,
        email ?? null,
        role ?? null,
        verified === undefined ? null : !!verified,
        password_hash ?? null,
        JSON.stringify(rest),
      ]
    );
    return rows[0] || null;
  },
  async all() {
    await ready();
    const { rows } = await pool.query('SELECT * FROM users ORDER BY created_date DESC');
    return rows;
  },
  async delete(id) {
    await ready();
    const { rowCount } = await pool.query('DELETE FROM users WHERE id = $1', [id]);
    return rowCount > 0;
  },
};

export const otp = {
  async issue(email, purpose, ttlMinutes = 15) {
    await ready();
    // randomInt, not Math.random: these codes reset passwords, and
    // Math.random is neither uniform nor unguessable across a known seed.
    const code = String(randomInt(100000, 1000000));
    // One transaction, because this runs on however many serverless instances
    // are warm. As two statements, two registrations for the same address could
    // interleave — one instance's DELETE landing after the other's INSERT — and
    // leave either two live codes or none, so the code in someone's inbox was
    // already gone by the time they typed it.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM otp_codes WHERE lower(email) = lower($1) AND purpose = $2', [email, purpose]);
      await client.query('INSERT INTO otp_codes (email, code, purpose, expires_at) VALUES ($1, $2, $3, $4)', [
        email, code, purpose, Date.now() + ttlMinutes * 60_000,
      ]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    return code;
  },
  // When the live code for this address was issued, so the routes can refuse
  // to send another one every few seconds. Derived from the row's expiry, so
  // it works across serverless instances without another column.
  async issuedAt(email, purpose, ttlMinutes = 15) {
    await ready();
    const { rows } = await pool.query(
      'SELECT expires_at FROM otp_codes WHERE lower(email) = lower($1) AND purpose = $2',
      [email, purpose]
    );
    if (!rows[0]) return null;
    return Number(rows[0].expires_at) - ttlMinutes * 60_000;
  },
  async verify(email, purpose, code) {
    await ready();
    // Claiming the row and judging it have to be one statement. As a SELECT
    // followed by a DELETE, two requests arriving together could both read the
    // same live code and both succeed — one code, used twice.
    //
    // The code and expiry are in the WHERE, so a wrong or late guess matches
    // nothing and deletes nothing: a mistyped digit must not burn the code the
    // person is still holding. Attempt limits are handled by the route.
    const { rows } = await pool.query(
      `DELETE FROM otp_codes
        WHERE lower(email) = lower($1) AND purpose = $2 AND code = $3 AND expires_at >= $4
        RETURNING code`,
      [email, purpose, String(code).trim(), Date.now()]
    );
    return rows.length > 0;
  },
};

// ---- geocoding cache --------------------------------------------------------

// Geocoding answers are stable and upstream providers are rate-limited (or
// billed per call), so results are cached in the database rather than in memory
// — a serverless instance rarely lives long enough for an in-process cache to
// pay off, and every instance would keep its own copy.
export const geoCache = {
  async get(key) {
    await ready();
    const { rows } = await pool.query('SELECT value, expires_at FROM geo_cache WHERE key = $1', [key]);
    const row = rows[0];
    if (!row) return null;
    if (Number(row.expires_at) < Date.now()) {
      await pool.query('DELETE FROM geo_cache WHERE key = $1', [key]);
      return null;
    }
    return row.value;
  },
  async set(key, value, ttlMs) {
    await ready();
    await pool.query(
      `INSERT INTO geo_cache (key, value, expires_at) VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at`,
      [key, JSON.stringify(value), Date.now() + ttlMs]
    );
    return value;
  },
};
