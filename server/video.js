// Video uploads for feed posts, stored in Cloudflare R2.
//
// Videos do not go through this server. Vercel refuses any request body over
// 4.5MB, and a one-minute phone video is ten to twenty times that. Instead the
// server signs a short-lived upload link for one object of one exact size and
// type, and the browser sends the file straight to R2 with it.
//
// R2 rather than the Blob store the photos use: R2 charges nothing when a
// video is watched, only for what is stored, so a popular video cannot run up
// a bill or exhaust a monthly allowance.
//
// R2 speaks the S3 API. Signing is done here with node:crypto rather than the
// AWS SDK: it is one HMAC chain, and a serverless bundle is better off without
// the extra dependency.
import { createHash, createHmac } from 'node:crypto';
import { newId } from './db.js';

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID || '';
const ACCESS_KEY = process.env.R2_ACCESS_KEY_ID || '';
// Like the database password, this never leaves the server.
const SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY || '';
const BUCKET = process.env.R2_BUCKET || 'klal-media';
// Where the bucket is readable from: its r2.dev address, or a custom domain.
const PUBLIC_URL = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '');

export const VIDEO_MAX_MB = Number(process.env.KC_VIDEO_MAX_MB || 100);
export const VIDEO_MAX_SECONDS = 60;

// MP4 and QuickTime cover every phone; WebM is what desktop recorders make.
const EXT_BY_TYPE = {
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
};

export const videoStorageReady = () => Boolean(ACCOUNT_ID && ACCESS_KEY && SECRET_KEY && PUBLIC_URL);

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const hmac = (key, s) => createHmac('sha256', key).update(s).digest();
// RFC 3986, which is stricter than encodeURIComponent about !'()*.
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * A SigV4 query-string signature (a "presigned URL"). Headers passed in are
 * signed, so the request that uses the link must send exactly those values.
 * Exported with its inputs explicit so it can be checked against AWS's own
 * published example.
 */
export function presign({ method, host, path, headers = {}, accessKey, secretKey, region, service = 's3', expires, now = new Date() }) {
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${region}/${service}/aws4_request`;
  const allHeaders = { host, ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim()])) };
  const names = Object.keys(allHeaders).sort();
  const signedHeaders = names.join(';');
  const query = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${accessKey}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': signedHeaders,
  };
  const canonicalQuery = Object.keys(query).sort().map((k) => `${enc(k)}=${enc(query[k])}`).join('&');
  const canonicalPath = path.split('/').map(enc).join('/');
  const canonicalRequest = [
    method,
    canonicalPath,
    canonicalQuery,
    names.map((n) => `${n}:${allHeaders[n]}\n`).join(''),
    signedHeaders,
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
  const key = [day, region, service, 'aws4_request'].reduce((k, part) => hmac(k, part), `AWS4${secretKey}`);
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  return `https://${host}${canonicalPath}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

const r2Host = () => `${ACCOUNT_ID}.r2.cloudflarestorage.com`;
const r2Url = (method, key, headers, expires) =>
  presign({ method, host: r2Host(), path: `/${BUCKET}/${key}`, headers, accessKey: ACCESS_KEY, secretKey: SECRET_KEY, region: 'auto', expires });

function fail(message, statusCode = 400) {
  const e = new Error(message);
  e.statusCode = statusCode;
  throw e;
}

/**
 * A link the browser can PUT one video to, good for ten minutes, and the
 * address the video will be watched from once it is there.
 */
export function videoUploadLink({ content_type, size }) {
  if (!videoStorageReady()) fail('Video uploads are not set up yet.', 503);
  const ext = EXT_BY_TYPE[content_type];
  if (!ext) fail('Please choose an MP4, MOV or WebM video.');
  const bytes = Number(size);
  if (!Number.isInteger(bytes) || bytes <= 0) fail('Please choose a video file.');
  if (bytes > VIDEO_MAX_MB * 1024 * 1024) fail(`That video is too large. Please choose one under ${VIDEO_MAX_MB}MB.`);
  const key = `videos/${newId()}${ext}`;
  // Size and type are signed: R2 refuses an upload that differs from what was
  // checked here, so the limit cannot be stepped around with a bigger file.
  const upload_url = r2Url('PUT', key, { 'content-length': bytes, 'content-type': content_type }, 600);
  return { upload_url, file_url: `${PUBLIC_URL}/${key}` };
}

/** Is this an address a video uploaded through videoUploadLink lives at? */
export function isOurVideo(url) {
  return Boolean(PUBLIC_URL) && typeof url === 'string' && url.startsWith(`${PUBLIC_URL}/videos/`) && !url.includes('..');
}

/**
 * Removes a deleted post's video from storage, which is what keeps storage
 * free: R2 bills by what is kept. Best effort, since the post is already gone
 * and a leftover file costs a fraction of a cent.
 */
export async function deleteVideo(url) {
  if (!videoStorageReady() || !isOurVideo(url)) return;
  const key = url.slice(PUBLIC_URL.length + 1);
  try {
    await fetch(r2Url('DELETE', key, {}, 60), { method: 'DELETE' });
  } catch (err) {
    console.warn('[video] could not delete', key, err?.message);
  }
}
