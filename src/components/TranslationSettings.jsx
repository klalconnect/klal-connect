import React, { useEffect, useState } from 'react';
import { api } from '@/api/client';
import { preferredTranslateLang, setPreferredTranslateLang } from '@/lib/translateLang';

// The language "Translate" on feed posts and comments turns things into.
// Hidden until the site has a translation key, since it would do nothing.
export default function TranslationSettings({ user }) {
  const [config, setConfig] = useState(null);
  const [lang, setLang] = useState(() => preferredTranslateLang(user));
  const [saved, setSaved] = useState(false);
  useEffect(() => { api.getConfig().then(setConfig).catch(() => {}); }, []);
  if (!config?.translateEnabled) return null;

  const change = async (e) => {
    const next = e.target.value;
    setLang(next);
    await setPreferredTranslateLang(next, user);
    setSaved(true); setTimeout(() => setSaved(false), 1500);
  };
  return <section className="panel space-y-3 my-3">
    <div><h2 className="section-title">Translation</h2><p className="helper">When a post or comment is in another language, a Translate link appears under it. Pick the language it translates into.</p></div>
    <label className="flex items-center justify-between gap-3 rounded-xl border border-brand-line px-3 py-2.5">
      <span className="text-sm font-medium text-brand-ink">Translate posts into</span>
      <select value={lang} onChange={change} className="field w-auto py-1.5 text-sm">
        {(config.translateLanguages || []).map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
      </select>
    </label>
    {saved && <p className="text-sm font-semibold text-brand-teal">Saved</p>}
  </section>;
}
