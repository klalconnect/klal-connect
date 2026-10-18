import { api } from '@/api/client';

// The viewer's translation target. It lives on the account (Settings →
// Translation) so it follows them from phone to computer, with a local copy
// for the moment before the account loads. Once someone picks Yiddish, every
// "Translate" on the site uses it, not just the one post they clicked from.
const KEY = 'kc_translate_lang';
export const SUPPORTED = ['en', 'he', 'yi', 'es', 'fr', 'ru'];

export function preferredTranslateLang(user) {
  if (user?.translate_language && SUPPORTED.includes(user.translate_language)) return user.translate_language;
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && SUPPORTED.includes(saved)) return saved;
  } catch { /* private browsing, etc — fall through to a guess */ }
  const nav = String(navigator.language || 'en').slice(0, 2).toLowerCase();
  return SUPPORTED.includes(nav) ? nav : 'en';
}

export async function setPreferredTranslateLang(code, user) {
  try { localStorage.setItem(KEY, code); } catch { /* nothing to persist to */ }
  if (user && !user.guest) {
    user.translate_language = code;
    await api.auth.updateMe({ translate_language: code }).catch(() => {});
  }
}

// Which alphabet a post is mostly written in. Good enough to skip offering
// "Translate" on an English post to an English reader; Hebrew and Yiddish
// share an alphabet, so a Hebrew-letter post always gets the offer.
function scriptOf(text) {
  let hebrew = 0, cyrillic = 0, latin = 0;
  for (const ch of String(text || '')) {
    if (/[֐-׿יִ-ﭏ]/.test(ch)) hebrew++;
    else if (/[Ѐ-ӿ]/.test(ch)) cyrillic++;
    else if (/[A-Za-zÀ-ɏ]/.test(ch)) latin++;
  }
  const max = Math.max(hebrew, cyrillic, latin);
  if (!max) return '';
  return max === hebrew ? 'hebrew' : max === cyrillic ? 'cyrillic' : 'latin';
}

export function needsTranslation(text, lang) {
  const script = scriptOf(text);
  if (!script) return false;
  if (lang === 'ru') return script !== 'cyrillic';
  if (lang === 'he' || lang === 'yi') return true;
  if (script !== 'latin') return true;
  // A Latin-letter post to an English reader is almost always English here;
  // accents are the giveaway for the Spanish or French one that is not.
  if (lang === 'en') return /[áéíóúñçèàêëïôûü¿¡]/i.test(text);
  return true;
}
