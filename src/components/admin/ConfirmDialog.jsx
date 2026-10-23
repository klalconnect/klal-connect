import React, { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';

// The "Are you sure?" step in front of suspending and deleting. A delete
// cannot be taken back, so for one of those the button stays off until the
// word is typed: a stray tap on a phone cannot delete anything.
export default function ConfirmDialog({ title, children, confirmLabel, typeToConfirm, danger, onConfirm, onClose }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);
  const ready = !typeToConfirm || typed.trim().toUpperCase() === typeToConfirm;
  const go = async () => {
    if (!ready || busy) return;
    setBusy(true); setErr('');
    try { await onConfirm(); onClose(); }
    catch (e) { setErr(e.message || 'Something went wrong. Nothing was changed.'); setBusy(false); }
  };
  return <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/50 px-4" onClick={() => !busy && onClose()}>
    <div role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" className="w-full max-w-md rounded-xl bg-brand-surface p-6 shadow-xl ring-1 ring-brand-line" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${danger ? 'bg-brand-tint text-brand-error' : 'bg-brand-gold-bg text-brand-gold-ink'}`}><AlertTriangle size={20} /></div>
          <h3 id="confirm-title" className="section-title">{title}</h3>
        </div>
        <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="icon-button -mr-1 -mt-1"><X size={18} /></button>
      </div>
      <div className="mt-3 space-y-2 text-sm text-brand-body">{children}</div>
      {typeToConfirm && <label className="mt-4 block text-sm font-semibold text-brand-ink">Type <b className="font-mono">{typeToConfirm}</b> to confirm
        <input className="field" value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') go(); }} autoFocus autoComplete="off" autoCapitalize="characters" spellCheck={false} />
      </label>}
      {err && <p className="mt-3 text-sm font-semibold text-brand-error">{err}</p>}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onClose} disabled={busy} className="secondary py-2">No, keep it</button>
        <button type="button" onClick={go} disabled={!ready || busy} className={`lift inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50 ${danger ? 'bg-brand-error text-brand-surface' : 'bg-brand-navy text-white hover:bg-brand-navy-hover'}`}>{busy ? 'Working…' : confirmLabel}</button>
      </div>
    </div>
  </div>;
}
