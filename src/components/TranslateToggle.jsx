import React, { useState } from 'react';
import { Languages, Loader2 } from 'lucide-react';
import { api } from '@/api/client';
import { needsTranslation, preferredTranslateLang, setPreferredTranslateLang } from '@/lib/translateLang';

// Click-to-translate, the way Facebook and LinkedIn do it: the original text
// always stays put, and a small link reveals a translation beneath it rather
// than replacing anything — nobody's words get silently rewritten.
//
// `enabled`/`languages` come from GET /api/config, so this renders nothing at
// all (not even the button) until a translation key exists. It also stays out
// of the way on a post already in the reader's language.
export default function TranslateToggle({ text, enabled, languages = [], user }) {
  const [shown, setShown] = useState(false);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [lang, setLang] = useState(() => preferredTranslateLang(user));

  if (!enabled || !String(text || '').trim()) return null;
  if (!result && !needsTranslation(text, lang)) return null;

  const run = async (target) => {
    setBusy(true);
    setError('');
    const r = await api.functions.invoke('translateText', { text, target });
    setBusy(false);
    if (r.status >= 400) { setError(r.data?.error || 'Could not translate.'); return; }
    setResult(r.data);
    setShown(true);
  };

  const toggle = () => {
    if (shown) { setShown(false); return; }
    if (result) { setShown(true); return; }
    run(lang);
  };

  const changeLang = (e) => {
    const next = e.target.value;
    setLang(next);
    setPreferredTranslateLang(next, user);
    setResult(null);
    run(next);
  };

  return (
    <div className="text-xs">
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        className="flex items-center gap-1 font-semibold text-brand-teal hover:underline"
      >
        {busy ? <Loader2 size={12} className="animate-spin" /> : <Languages size={12} />}
        {shown ? 'Hide translation' : `Translate to ${languages.find((l) => l.code === lang)?.label || 'your language'}`}
      </button>
      {error && <p className="mt-1 text-brand-error">{error}</p>}
      {shown && result && (
        <div className="mt-1.5 rounded-lg bg-brand-tint/60 p-2.5 text-brand-body">
          <p dir="auto" className="whitespace-pre-line leading-6">{result.text}</p>
          <select
            value={lang}
            onChange={changeLang}
            aria-label="Translate into"
            className="mt-1.5 rounded border-0 bg-transparent text-[11px] font-medium text-brand-muted"
          >
            {languages.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </div>
      )}
    </div>
  );
}
