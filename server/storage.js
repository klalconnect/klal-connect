// File storage for uploads.
//
// Two backends behind one interface. Local disk is fine for development, but a
// serverless deployment has an ephemeral filesystem — a file written during one
// request is gone by the next — so production must use object storage.
//
// Supabase Storage is driven over its REST API rather than the JS SDK: the
// operations we need are two HTTP calls, and a serverless bundle is better off
// without the extra dependency.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { put as putBlob, list as listBlobs } from '@vercel/blob';
import { newId } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
// The service role key bypasses row-level security, so it must never reach the
// browser. It is only ever read here, server-side.
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'uploads';

// Vercel Blob is used whenever its token is present, which it is on any
// deployment with a Blob store attached. Supabase remains supported for a
// self-hosted deployment that prefers it.
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN || '';

export const usingObjectStorage = Boolean((SUPABASE_URL && SUPABASE_KEY) || BLOB_TOKEN);

const UPLOAD_DIR = process.env.KC_UPLOAD_DIR || path.join(__dirname, 'uploads');

// Created on first write, not at import. A serverless filesystem is read-only,
// so doing this at module load crashed the entire API — including every read —
// on a deployment that simply had not configured object storage yet.
let localDirReady = false;
function ensureLocalDir() {
  if (localDirReady) return;
  try {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    localDirReady = true;
  } catch (err) {
    const e = new Error(
      'Photo uploads are temporarily unavailable. Please try again later.'
    );
    e.statusCode = 503;
    e.cause = err;
    throw e;
  }
}

const EXT_BY_TYPE = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
};

// Never trust the client's filename: it can carry a path, a double extension,
// or a script suffix. Derive the extension from the sniffed mime type instead.
function safeName(mimetype) {
  return `${newId()}${EXT_BY_TYPE[mimetype] || '.bin'}`;
}

async function putSupabase(buffer, mimetype) {
  const name = safeName(mimetype);
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${name}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': mimetype,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'x-upsert': 'false',
    },
    body: buffer,
  });
  if (!res.ok) {
    await res.text().catch(() => '');
    const error = new Error('Photo uploads are temporarily unavailable. Please try again later.');
    error.statusCode = 503;
    throw error;
  }
  // Bucket must be marked public for this URL to resolve.
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${name}`;
}

async function putLocal(buffer, mimetype) {
  ensureLocalDir();
  const name = safeName(mimetype);
  await fs.promises.writeFile(path.join(UPLOAD_DIR, name), buffer);
  return `/api/files/${name}`;
}

async function putVercelBlob(buffer, mimetype) {
  try {
    const { url } = await putBlob(`uploads/${safeName(mimetype)}`, buffer, {
      access: 'public',
      contentType: mimetype,
      addRandomSuffix: false,
      token: BLOB_TOKEN,
    });
    return url;
  } catch (err) {
    const error = new Error('Photo uploads are temporarily unavailable. Please try again later.');
    error.statusCode = 503;
    error.cause = err;
    throw error;
  }
}

/** @returns {Promise<string>} a URL the browser can load the file from */
export function put(buffer, mimetype) {
  if (SUPABASE_URL && SUPABASE_KEY) return putSupabase(buffer, mimetype);
  if (BLOB_TOKEN) return putVercelBlob(buffer, mimetype);
  return putLocal(buffer, mimetype);
}

/**
 * How much of the photo store is in use, for the weekly check against the
 * Blob free allowance. Only the Blob backend can say; elsewhere null.
 */
export async function photoStorageUsage() {
  if (!BLOB_TOKEN || (SUPABASE_URL && SUPABASE_KEY)) return null;
  let count = 0, bytes = 0, cursor;
  for (let page = 0; page < 50; page++) {
    const r = await listBlobs({ token: BLOB_TOKEN, prefix: 'uploads/', limit: 1000, cursor });
    for (const b of r.blobs) { count++; bytes += b.size || 0; }
    if (!r.hasMore) break;
    cursor = r.cursor;
  }
  return { count, bytes };
}

export { UPLOAD_DIR };
