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

// Cloudflare's reasons, in words an admin can act on. Whatever is not here is
// shown as Cloudflare's own code.
const R2_REASONS = {
  InvalidAccessKeyId: 'Cloudflare does not recognise the Access Key ID. Copy it again into R2_ACCESS_KEY_ID in Vercel.',
  SignatureDoesNotMatch: 'The Secret Access Key does not match the Access Key ID. Copy both again into Vercel (R2_SECRET_ACCESS_KEY and R2_ACCESS_KEY_ID).',
  NoSuchBucket: 'There is no bucket with that name. R2_BUCKET in Vercel should be klal-media.',
  AccessDenied: 'The key is not allowed to write to the bucket. Its permission should be Object Read & Write, for klal-media.',
  // R2 answers this both for a key copied wrong and for one without write
  // permission, so the advice covers both.
  Unauthorized: 'Cloudflare did not accept the key. Either the Access Key ID or Secret Access Key was copied wrong into Vercel, or the key is not allowed to write to klal-media (it should be Object Read & Write).',
};

async function tryOnce(method, url, init) {
  try {
    const res = await fetch(url, { method, ...init });
    const text = await res.text().catch(() => '');
    const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1] || '';
    return { status: res.status, code };
  } catch (err) {
    return { status: 0, code: err?.cause?.code || err?.message || 'network' };
  }
}

/**
 * The admin's "Test video storage" button: a tiny upload done exactly the way
 * a phone does it, then a read through the public address, then a clean-up.
 * A browser is never told why storage refused an upload — Cloudflare's error
 * replies carry no permission for the page to read them — so this is the
 * only place the reason can be seen. Nothing secret is returned.
 */
export async function checkVideoStorage() {
  const setup = {
    account_id: /^[0-9a-f]{32}$/.test(ACCOUNT_ID) ? 'looks right' : ACCOUNT_ID ? 'does not look like a Cloudflare Account ID (32 letters and numbers)' : 'missing',
    access_key_id: ACCESS_KEY ? (ACCESS_KEY.length === 32 ? 'looks right' : `is ${ACCESS_KEY.length} characters; Cloudflare's are 32`) : 'missing',
    secret_access_key: SECRET_KEY ? (SECRET_KEY.length === 64 ? 'looks right' : `is ${SECRET_KEY.length} characters; Cloudflare's are 64`) : 'missing',
    bucket: BUCKET,
    public_url: /^https:\/\//.test(PUBLIC_URL) ? 'looks right' : PUBLIC_URL ? 'should start with https://' : 'missing',
  };
  if (!videoStorageReady()) return { ok: false, reason: 'Some of the R2 settings are missing in Vercel.', setup };

  const key = `videos/storage-check-${newId()}.mp4`;
  const body = Buffer.from('klal storage check');
  const headers = { 'content-length': body.length, 'content-type': 'video/mp4' };
  const put = await tryOnce('PUT', r2Url('PUT', key, headers, 60), { headers: { 'Content-Type': 'video/mp4' }, body });
  const result = { setup, upload: put };
  if (put.status === 0) {
    result.ok = false;
    result.reason = `The site could not reach Cloudflare storage (${put.code}). The Account ID in Vercel is probably wrong.`;
    return result;
  }
  if (put.status < 200 || put.status >= 300) {
    // The same upload with only the type signed tells a key problem from a
    // problem with how the size is signed.
    const plain = await tryOnce('PUT', r2Url('PUT', key, { 'content-type': 'video/mp4' }, 60), { headers: { 'Content-Type': 'video/mp4' }, body });
    result.upload_type_only = plain;
    result.ok = false;
    if (plain.status >= 200 && plain.status < 300) {
      result.reason = 'The key works, but Cloudflare refused the signed size. This is a fix on the code side.';
      await fetch(r2Url('DELETE', key, {}, 60), { method: 'DELETE' }).catch(() => {});
    } else {
      result.reason = R2_REASONS[put.code] || `Cloudflare refused the upload (${put.status} ${put.code || 'no code'}).`;
    }
    return result;
  }
  const view = await tryOnce('GET', `${PUBLIC_URL}/${key}`);
  result.view = view;
  await fetch(r2Url('DELETE', key, {}, 60), { method: 'DELETE' }).catch(() => {});
  result.ok = view.status === 200;
  result.reason = result.ok
    ? 'Uploading and playing both work. If a phone still cannot upload, the upload permission rule (CORS) is the thing to check.'
    : `Uploading works, but the video could not be opened at the public address (${view.status || view.code}). Check R2_PUBLIC_URL in Vercel and that the bucket's Public Development URL is on.`;
  return result;
}
