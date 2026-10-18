// Text translation, proxied through our server for the same reasons geocoding
// is: the API key must never ship to the client, and results are cheap to
// cache since the same post or comment gets translated by more than one reader.
//
// Two possible engines. Claude (ANTHROPIC_API_KEY) is preferred: Google's
// Yiddish is weak — it reads Hasidic spelling and the Loshon Kodesh words
// mixed into everyday frum Yiddish and English as noise — while Claude keeps
// "Baruch Hashem", "shul" and "simcha" as the community says them. Google
// (GOOGLE_TRANSLATE_API_KEY) is the fallback engine if only that key exists.
// With neither set, translate() throws and the client never shows a
// "Translate" affordance in the first place — see translateEnabled in
// GET /api/config.
import Anthropic from '@anthropic-ai/sdk';
import { geoCache } from './db.js';

const CLAUDE_KEY = process.env.ANTHROPIC_API_KEY || '';
const API_KEY = process.env.GOOGLE_TRANSLATE_API_KEY || '';
const CLAUDE_MODEL = 'claude-opus-5-5';
const TRANSLATE_TTL = 30 * 24 * 60 * 60 * 1000; // wording of a post never changes once written
const UPSTREAM_TIMEOUT_MS = 8000;
const MAX_CHARS = 2000; // a post or comment, not an essay — keeps billing bounded
const UNAVAILABLE = 'Translation is temporarily unavailable.';

// The languages the community actually writes in. Restricting the target list
// (rather than accepting any of Google's ~130) keeps the client UI to a short,
// meaningful menu instead of a searchable haystack.
export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'he', label: 'Hebrew' },
  { code: 'yi', label: 'Yiddish' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'ru', label: 'Russian' },
];
const LANGUAGE_CODES = new Set(LANGUAGES.map((l) => l.code));

class TranslateError extends Error {
  constructor(message, statusCode = 502) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function translateEnabled() {
  return Boolean(CLAUDE_KEY || API_KEY);
}

export function translateEngine() {
  if (CLAUDE_KEY) return 'claude';
  if (API_KEY) return 'google';
  return '';
}

const LABEL = Object.fromEntries(LANGUAGES.map((l) => [l.code, l.label]));
const SYSTEM = `You translate posts and comments on Klal Connect, a networking site for the Orthodox Jewish community. Posts may be in English, Hebrew, Yiddish (including Hasidic spelling, with or without nekudos), or other languages, and often mix them.

Rules:
- Reply with only the translation. No preface, notes, quotes or explanation.
- Keep the poster's tone, line breaks, names, phone numbers, emails, links and emoji exactly.
- Keep common Jewish terms the community uses as-is in the target language instead of literal glosses (for English: Baruch Hashem, shul, simcha, Shabbos, Yom Tov, bochur, kallah, chasunah, gemach, and so on). Use Ashkenazi English transliteration, as the community writes it.
- If the text is already entirely in the target language, return it unchanged.`;

let claude;
async function translateWithClaude(clean, lang) {
  claude ||= new Anthropic({ apiKey: CLAUDE_KEY, timeout: UPSTREAM_TIMEOUT_MS * 2, maxRetries: 1 });
  let msg;
  try {
    msg = await claude.beta.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 4000,
      output_config: { effort: 'low' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      messages: [{ role: 'user', content: `Translate into ${LABEL[lang]}:\n\n${clean}` }],
    });
  } catch (err) {
    console.warn('[translate] claude request failed', { status: err?.status, reason: err?.name || 'unknown' });
    throw new TranslateError(UNAVAILABLE, err?.status === 429 ? 429 : 503);
  }
  if (msg.stop_reason === 'refusal') throw new TranslateError(UNAVAILABLE, 503);
  const text = (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  if (!text) throw new TranslateError(UNAVAILABLE, 503);
  return { text, detectedSourceLanguage: '' };
}

// A crude but fast hash — cache keys just need to be short and collision-free
// in practice, not cryptographically sound.
function hashOf(text) {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

export async function translate(text, target) {
  if (!translateEnabled()) throw new TranslateError('Translation is not configured.', 503);
  const clean = String(text || '').trim();
  if (!clean) throw new TranslateError('Nothing to translate.', 400);
  if (clean.length > MAX_CHARS) throw new TranslateError('That is too long to translate.', 400);
  const lang = String(target || '').trim().toLowerCase();
  if (!LANGUAGE_CODES.has(lang)) throw new TranslateError('Unsupported target language.', 400);

  const engine = translateEngine();
  const key = `translate:${engine}:${lang}:${hashOf(clean)}`;
  const hit = await geoCache.get(key);
  if (hit) return hit;

  if (engine === 'claude') {
    const result = await translateWithClaude(clean, lang);
    await geoCache.set(key, result, TRANSLATE_TTL);
    return result;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  let data;
  try {
    // Google's v2 REST path is /language/translate/v2. This said
    // /language/translate2, which 404s on every call — so the whole feature
    // would have failed closed the moment a key was added, and the unit test
    // asserted the typo rather than the endpoint.
    const res = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${API_KEY}`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      // No `source`: letting Google auto-detect means a Yiddish post typed
      // without diacritics still lands correctly, rather than us guessing.
      body: JSON.stringify({ q: clean, target: lang, format: 'text' }),
    });
    data = await res.json();
    if (!res.ok) {
      console.warn('[translate] upstream rejected request', { status: res.status, detail: data?.error?.message });
      throw new TranslateError(UNAVAILABLE, res.status === 429 ? 429 : 503);
    }
  } catch (err) {
    if (err instanceof TranslateError) throw err;
    console.warn('[translate] upstream request failed', { reason: err.name || 'unknown' });
    throw new TranslateError(UNAVAILABLE, 503);
  } finally {
    clearTimeout(timer);
  }

  const row = data?.data?.translations?.[0];
  if (!row) throw new TranslateError(UNAVAILABLE, 503);
  const result = {
    text: row.translatedText,
    detectedSourceLanguage: row.detectedSourceLanguage || '',
  };
  // Already in the target language: still worth caching, so a repeat click
  // costs nothing, but the client can use detectedSourceLanguage to skip
  // showing "Translate" at all next time.
  await geoCache.set(key, result, TRANSLATE_TTL);
  return result;
}

export { TranslateError };
