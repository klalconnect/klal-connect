import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check } from 'lucide-react';
import { api } from '@/api/client';
import { markEngaged } from '@/lib/engagement';
import { loadMyConnections, connectedIds } from '@/lib/connections';
import { isSensitiveListing } from '@/lib/sensitivity';
import { categoryLabel, SHUL_LABEL } from '@/lib/categories';
import useVouchesEnabled from '@/hooks/useVouchesEnabled';

const initials = (name) => (name || '?').split(' ').map((x) => x[0]).slice(0, 2).join('').toUpperCase();

// Nobody "uses" a shul; they have been there. Shuls are filed under a few
// names (see categoryLabel), so it is the label that is checked. Mikvahs would
// read the same way, but they are sensitive listings and never show this.
const isPlace = (p) => categoryLabel(p?.category) === SHUL_LABEL || categoryLabel(p?.subcategory) === SHUL_LABEL;

// "Used by" and "vouched for by" on a listing, and the one way to add to them.
//
// It used to be two buttons in the sidebar — "I've Used This" and "I vouch for
// this" — plus a separate note form further down, three unrelated controls for
// what is really one moment: you used someone, would you send a friend, and
// what did you appreciate. Now it asks those in order, one at a time, and each
// step after the first can be skipped.
//
// Names are public (a vouch is a statement, not a bookmark); the "you know"
// count only appears for a signed-in member with connections, and never names
// who. None of this exists on a sensitive listing — see @/lib/sensitivity.
//
// Vouches and notes can be switched off site-wide (Admin → Site switches).
// Off, this is just the "used them" count: no names, no vouch or note steps.
export default function CommunityTrust({ provider, onCounts, onNote }) {
  const [vouches, setVouches] = useState(null);
  const [known, setKnown] = useState(0);
  const [me, setMe] = useState(null);
  const [used, setUsed] = useState(false);
  const [vouched, setVouched] = useState(false);
  // null at rest; 'vouch' and 'note' are the follow-up questions after
  // "I've used them". 'note' is also reachable later from the done state.
  const [step, setStep] = useState(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [tick, setTick] = useState(0);
  const vouchesOn = useVouchesEnabled();

  const sensitive = isSensitiveListing(provider);

  useEffect(() => {
    if (sensitive) return undefined;
    let alive = true;
    (async () => {
      const rows = await api.entities.Vouch.filter({ provider_id: provider.id }, '-created_date', 200).catch(() => []);
      if (!alive) return;
      setVouches(rows);
      try {
        if (await api.auth.hasAccount()) {
          const user = await api.auth.me();
          const [u, conns] = await Promise.all([
            api.entities.ProviderUsage.filter({ provider_id: provider.id, created_by_id: user.id }),
            loadMyConnections(user.id),
          ]);
          if (!alive) return;
          setMe(user);
          setUsed(u.length > 0);
          setVouched(rows.some((v) => v.created_by_id === user.id));
          const ids = connectedIds(conns);
          setKnown(rows.filter((v) => ids.has(v.created_by_id)).length);
        }
      } catch { /* signed out, or a lookup failed: the page still reads fine */ }
    })();
    return () => { alive = false; };
  }, [provider.id, sensitive, tick]);

  if (sensitive || !vouches) return null;

  // Someone cannot vouch for their own listing (the server refuses it), so the
  // owner is never asked.
  const ownListing = !!me && (provider.created_by_id === me.id || provider.owner_id === me.id);

  const toggle = async (activity) => {
    const r = await api.functions.invoke('toggleCommunityActivity', { providerId: provider.id, activity });
    if (r.status >= 400) throw new Error(r.data?.error || 'That did not go through. Please try again.');
    markEngaged();
    onCounts?.({ [activity === 'use' ? 'usage_count' : 'vouch_count']: r.data.count });
    return r.data.active;
  };

  const run = async (fn) => {
    setErr('');
    setBusy(true);
    try { await fn(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const markUsed = () => run(async () => {
    if (!await api.auth.requireAccount()) return;
    // requireAccount may have just signed them in; the effect has not caught up.
    const user = me || await api.auth.me();
    setMe(user);
    const already = (await api.entities.ProviderUsage.filter({ provider_id: provider.id, created_by_id: user.id })).length > 0;
    if (!already) await toggle('use');
    setUsed(true);
    const isOwner = provider.created_by_id === user.id || provider.owner_id === user.id;
    const hasVouched = vouches.some((v) => v.created_by_id === user.id);
    setStep(!vouchesOn ? null : isOwner || hasVouched ? 'note' : 'vouch');
  });

  const vouch = () => run(async () => {
    if (!await api.auth.requireAccount()) return;
    if (!vouched) await toggle('vouch');
    setVouched(true);
    setStep((s) => (s === 'vouch' ? 'note' : null));
    setTick((t) => t + 1);
  });

  const withdrawVouch = () => run(async () => {
    if (vouched) await toggle('vouch');
    setVouched(false);
    setTick((t) => t + 1);
  });

  const unmarkUsed = () => run(async () => {
    if (used) await toggle('use');
    setUsed(false);
    setStep(null);
  });

  const submitNote = (e) => {
    e.preventDefault();
    run(async () => {
      if (!await api.auth.requireAccount()) return;
      const r = await api.functions.invoke('createReview', { provider_id: provider.id, provider_name: provider.name, body });
      if (r.status >= 400) throw new Error(r.data?.error || 'Your note did not go through. Please try again.');
      markEngaged();
      onNote?.(r.data.note);
      setBody('');
      setStep(null);
    });
  };

  const usedCount = provider.usage_count || 0;
  // Switched off, a vouch they gave earlier is kept but not shown or offered.
  const vouchedShown = vouchesOn && vouched;
  const shown = vouches.slice(0, 5);
  const names = shown.slice(0, 2).map((v) => v.author_name || 'A community member');
  const place = isPlace(provider);

  // Before anyone has said they used them, a big panel announcing that nobody
  // has made every new listing look empty. Until the first person, it is one
  // small line that is also the button.
  if (usedCount === 0 && !used && !vouchedShown && step === null) {
    return <div className="rounded-xl bg-brand-tint px-4 py-3 text-sm text-brand-body">
      {place ? 'Been here?' : 'Used them?'}{' '}
      <button type="button" onClick={markUsed} disabled={busy} className="font-semibold text-brand-teal hover:underline">{place ? 'Let others know' : 'Be the first to say so'}</button>
      {err && <p className="mt-1 text-xs font-semibold text-brand-error">{err}</p>}
    </div>;
  }

  return <section className="panel space-y-4">
    <div className="flex items-center gap-4">
      {usedCount > 0
        ? <span className="font-display text-5xl font-bold leading-none tracking-tight text-brand-teal tabular-nums">{usedCount.toLocaleString()}</span>
        : null}
      <div className="min-w-0">
        <h2 className="section-title">{place ? (usedCount === 1 ? 'person in the community has been here' : 'people in the community have been here') : usedCount === 1 ? 'person in the community has used them' : 'people in the community have used them'}</h2>
        {vouchesOn && vouches.length > 0 && <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="flex">
            {shown.map((v, i) => <Link key={v.id} to={`/profile/${v.created_by_id}`} title={v.author_name || 'Community member'} className={`grid h-7 w-7 place-items-center rounded-full bg-brand-tint text-[10px] font-bold text-brand-teal ring-2 ring-brand-surface ${i ? '-ml-2' : ''}`}>{initials(v.author_name)}</Link>)}
          </span>
          <span className="text-sm text-brand-body">
            {vouches.length === 1 ? `${names[0]} would send a friend` : `${names.join(', ')}${vouches.length > 2 ? ` and ${vouches.length - 2} ${vouches.length - 2 === 1 ? 'other' : 'others'}` : ''} would send a friend`}
          </span>
        </div>}
        {vouchesOn && known > 0 && <p className="mt-1 text-sm font-semibold text-brand-teal">{known} {known === 1 ? 'is someone' : 'are people'} you know</p>}
      </div>
    </div>

    <div className="rounded-xl bg-brand-tint p-4 text-sm text-brand-ink">
      {!used && !vouchedShown && step === null && <div className="space-y-3">
        <p><b>{place ? `Have you been to ${provider.name}?` : `Have you used ${provider.name}?`}</b> Tapping below adds you to the count. Thanks for helping the next person.</p>
        <button type="button" onClick={markUsed} disabled={busy} className="primary"><Check size={16}/>{place ? <>I&apos;ve been here</> : <>I&apos;ve used them</>}</button>
      </div>}

      {step === 'vouch' && <div className="space-y-3">
        <p><b>Thanks. Would you send a friend to them?</b></p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={vouch} disabled={busy} className="primary">Yes, I vouch for them</button>
          <button type="button" onClick={() => setStep('note')} disabled={busy} className="rounded-xl px-4 py-2.5 font-semibold text-brand-body hover:text-brand-ink">Not now</button>
        </div>
      </div>}

      {step === 'note' && <form onSubmit={submitNote} className="space-y-3">
        <label htmlFor="trust-note" className="block"><b>What did you appreciate?</b> <span className="text-brand-body">Optional. Only positive notes; concerns go privately through Suggest a Correction.</span></label>
        <textarea id="trust-note" value={body} onChange={(e) => setBody(e.target.value)} className="field min-h-24" placeholder="They came the same day and explained everything…"/>
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={busy || body.trim().length < 10} className="primary disabled:opacity-50">Share note</button>
          <button type="button" onClick={() => { setStep(null); setBody(''); setErr(''); }} disabled={busy} className="rounded-xl px-4 py-2.5 font-semibold text-brand-body hover:text-brand-ink">Skip</button>
        </div>
      </form>}

      {(used || vouchedShown) && step === null && <div className="space-y-2">
        <p className="flex items-start gap-2"><Check size={16} className="mt-0.5 shrink-0 text-brand-success"/><span><b>{used && vouchedShown ? "You're counted and vouching." : used ? "You're counted." : "You're vouching for them."}</b> <span className="text-brand-body">Thank you for helping the next person.</span></span></p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 pl-6 text-sm font-semibold">
          {vouchesOn && !vouched && !ownListing && <button type="button" onClick={vouch} disabled={busy} className="text-brand-teal hover:underline">Vouch for them</button>}
          {vouchesOn && <button type="button" onClick={() => setStep('note')} disabled={busy} className="text-brand-teal hover:underline">Add a note</button>}
          {vouchedShown && <button type="button" onClick={withdrawVouch} disabled={busy} className="text-brand-muted hover:underline">Withdraw my vouch</button>}
          {used && <button type="button" onClick={unmarkUsed} disabled={busy} className="text-brand-muted hover:underline">Remove me from the count</button>}
        </div>
      </div>}

      {err && <p className="mt-2 text-xs font-semibold text-brand-error">{err}</p>}
    </div>
  </section>;
}
