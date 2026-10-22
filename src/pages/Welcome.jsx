import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Compass, Wrench, Store, Handshake, Plus } from 'lucide-react';
import { api } from '@/api/client';
import useVouchesEnabled from '@/hooks/useVouchesEnabled';
import { safeReturnTo } from '@/lib/authReturnTo';
import { PROFILE_TYPES } from '@/lib/affiliations';
import InviteButton from '@/components/InviteButton';
import { locateFromCity } from '@/hooks/useDetectLocation';
import CityInput from '@/components/CityInput';
import ResourceCard from '@/components/ResourceCard';
import { nearbyListings, placePoint } from '@/lib/nearby';

// The ninety seconds after sign-up: one question per card, every card
// skippable, and the value (nearby listings) shown before the ask (invites).
const ICONS = { community_member: Compass, provider: Wrench, business_owner: Store };

export default function Welcome() {
  const vouchesOn = useVouchesEnabled();
  const [me, setMe] = useState(null);
  const [step, setStep] = useState(0);
  const [type, setType] = useState('community_member');
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [nearby, setNearby] = useState(null);
  const [placed, setPlaced] = useState(null);
  const [placing, setPlacing] = useState(false);
  const [members, setMembers] = useState(null);
  // Where "Done" goes: wherever sign-up was headed, else the feed — the
  // first thing a new member should see is the community, not the brochure.
  const rt = safeReturnTo();
  const done = rt === '/' || rt === '/welcome' ? '/feed' : rt;

  useEffect(() => {
    (async () => {
      if (!(await api.auth.hasAccount())) return api.auth.redirectToLogin('/welcome');
      const u = await api.auth.me();
      setMe(u);
      setType(u.profile_type || 'community_member');
      setName(u.full_name || '');
      setCity(u.home_city || u.city || '');
      api.entities.User.list('-created_date', 500).then(setMembers).catch(() => setMembers([]));
    })();
  }, []);

  const twin = (() => {
    const wanted = name.trim().toLowerCase();
    if (!members || wanted.length < 4) return null;
    return members.find((m) => m.id !== me?.id && (m.full_name || '').trim().toLowerCase() === wanted) || null;
  })();

  // The listings nearest the city they just gave, most-used first within each
  // town — never the most-used on the whole site, which greeted a member in
  // Brooklyn with the Bahamas. Nothing within an hour's drive, or no city at
  // all, is said plainly instead.
  useEffect(() => {
    if (step !== 2 || nearby) return;
    const origin = placed?.latitude != null ? placePoint({ lat: placed.latitude, lng: placed.longitude })
      : placePoint({ lat: me?.latitude, lng: me?.longitude }) || placePoint({ city });
    if (!origin) { setNearby([]); return; }
    const count = vouchesOn ? 'vouch_count' : 'usage_count';
    const rank = (a, b) => (b[count] || 0) - (a[count] || 0);
    api.entities.Provider.filter({ status: 'published' })
      .then((all) => setNearby(nearbyListings(all, origin, { rank }).slice(0, 5)))
      .catch(() => setNearby([]));
  }, [step, nearby, vouchesOn, placed, me, city]);

  const save = async (patch) => { try { await api.auth.updateMe(patch); } catch { /* keep going; the profile page can fix it later */ } };

  // The city they just typed is the best thing we know about where they are,
  // so it seeds the Shabbos times too. Without this the app falls back to the
  // address their connection resolves to, which put a Jerusalem member in
  // Buffalo — and candle lighting for the wrong continent locks the app at the
  // wrong hour.
  const saveCity = async (value) => {
    const typed = String(value || '').trim();
    if (!typed) return;
    setPlacing(true);
    const found = await locateFromCity(typed);
    setPlacing(false);
    setPlaced(found);
    await save(found
      ? { home_city: found.city || typed, latitude: found.latitude, longitude: found.longitude, timezone: found.timezone, city: found.city, country_code: found.country_code, shabbos_mode_source: 'onboarding' }
      : { home_city: typed });
    return found;
  };
  const next = async (patch) => { if (patch) await save(patch); setStep((s) => s + 1); };
  const finish = async () => { await save({ onboarded: true }); window.location.href = done; };

  if (!me) return <div className="loading">Setting things up…</div>;

  const dots = <div className="flex justify-center gap-1.5">{[0, 1, 2, 3].map((i) => <span key={i} className={`h-1.5 w-6 rounded-full ${i === step ? 'bg-brand-navy' : i < step ? 'bg-brand-teal' : 'bg-brand-line'}`} />)}</div>;

  return <div className="page-shell max-w-2xl py-8 md:py-14">
    {dots}
    <div className="panel mt-6 space-y-6">
      {step === 0 && <>
        <div><span className="eyebrow">WELCOME</span><h1 className="title text-3xl">First, your name</h1><p className="helper">{vouchesOn ? 'Vouches, answers' : 'Answers'} and invites carry your name — that is what makes them worth something here.</p></div>
        <label>Your name (optional for now)<input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="As people in the community know you" autoFocus/></label>
        {twin && <div className="rounded-lg bg-brand-gold-bg p-4 text-sm text-brand-gold-ink"><p className="font-semibold">There is already a {twin.full_name} on Klal{twin.headline ? ` — ${String(twin.headline).trim().replace(/[.\s]+$/, '')}` : ''}.</p><p className="mt-1">If that is you, <button type="button" onClick={() => api.auth.logout('/login')} className="font-semibold underline">log in to that account</button> instead of starting a second one. If it is someone else with your name, carry on.</p></div>}
        <div><h2 className="section-title">What brings you to Klal?</h2><p className="helper">You can do all three. This just picks where we start.</p></div>
        <div className="grid gap-3">{PROFILE_TYPES.map((t) => { const I = ICONS[t.id]; return <button key={t.id} type="button" onClick={() => setType(t.id)} className={`flex items-start gap-3 rounded-lg p-4 text-left ring-1 transition ${type === t.id ? 'bg-brand-tint ring-brand-teal' : 'bg-brand-surface ring-brand-line hover:bg-brand-tint/50'}`}><span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${type === t.id ? 'bg-brand-navy text-white' : 'bg-brand-tint text-brand-teal'}`}><I size={20}/></span><span><span className="block font-semibold text-brand-ink">{t.label}</span><span className="block text-sm text-brand-body">{!vouchesOn && t.blurbNoVouches || t.blurb}</span></span></button>; })}</div>
        <div className="flex justify-end"><button type="button" onClick={() => next({ profile_type: type, full_name: name.trim() })} className="primary">Continue<ArrowRight size={16}/></button></div>
      </>}

      {step === 1 && <>
        <div><span className="eyebrow">YOUR COMMUNITY</span><h1 className="title text-3xl">Where are you?</h1><p className="helper">Your city sets what you see first — the listings, people and asks near you.</p></div>
        <label>City<CityInput value={city} onChange={(v) => { setCity(v); setPlaced(null); setNearby(null); }} onPick={(p) => { setCity(p.city); setPlaced(p); save({ home_city: p.city, latitude: p.latitude, longitude: p.longitude, timezone: p.timezone, city: p.city, country_code: p.country_code, shabbos_mode_source: 'onboarding' }); }} onBlur={(e) => saveCity(e.target.value)} placeholder="Lakewood, Brooklyn, Jerusalem…"/></label>
        {placed && placed.timezone && <p className="rounded-xl bg-brand-tint p-3 text-sm text-brand-body">Shabbos and Yom Tov times will be computed for <b>{placed.city}</b> — time zone {placed.timezone}. You can change this any time in Settings.</p>}
        <div className="flex items-center justify-between"><button type="button" onClick={() => next()} className="text-sm font-medium text-brand-muted hover:text-brand-ink">Skip</button><button type="button" disabled={placing} onClick={async () => { await saveCity(city); setStep((s) => s + 1); }} className="primary disabled:opacity-60">{placing ? 'Checking…' : 'Continue'}<ArrowRight size={16}/></button></div>
      </>}

      {step === 2 && <>
        <div><span className="eyebrow">{type === 'community_member' ? 'NEAR YOU' : 'YOUR LISTING'}</span>
          <h1 className="title text-3xl">{type === 'community_member' ? 'Trusted by the community' : 'Put yourself in front of the klal'}</h1>
          <p className="helper">{type === 'community_member' ? (vouchesOn ? `The most-vouched listings near ${city || 'you'}. Vouches come from named members — never anonymous.` : `Some of the most-used listings near ${city || 'you'}.`) : `Your listing is live the moment you post it — members can find it, ${vouchesOn ? 'vouch for it, ' : ''}and message you on WhatsApp.`}</p></div>
        {type === 'community_member'
          ? (nearby === null ? <div className="loading min-h-24">Loading…</div>
            : nearby.length === 0
              ? <div className="empty min-h-32"><Handshake className="text-brand-teal"/><p>The directory is just getting started{city ? ` in ${city}` : ''}. Know a business the community trusts? Add it{vouchesOn ? ' and be its first vouch' : ' so others can find it'}.</p><Link to="/add" className="primary"><Plus size={16}/>Add a listing</Link></div>
              : <div className="grid grid-cols-[minmax(0,1fr)] gap-3">{nearby.map((p) => <ResourceCard key={p.id} provider={p}/>)}</div>)
          : <div className="grid gap-3 sm:grid-cols-2"><Link to="/add" className="panel flex items-start gap-3 hover:bg-brand-tint/40"><Plus className="mt-0.5 shrink-0 text-brand-teal"/><span><span className="block font-semibold text-brand-ink">Create your listing</span><span className="block text-sm text-brand-body">Takes five minutes. Add a WhatsApp number and badges.</span></span></Link><Link to="/directory" className="panel flex items-start gap-3 hover:bg-brand-tint/40"><Compass className="mt-0.5 shrink-0 text-brand-teal"/><span><span className="block font-semibold text-brand-ink">Already listed?</span><span className="block text-sm text-brand-body">Find your business in the directory and claim it.</span></span></Link></div>}
        <div className="flex justify-end"><button type="button" onClick={() => next()} className="primary">Continue<ArrowRight size={16}/></button></div>
      </>}

      {step === 3 && <>
        <div><span className="eyebrow">GROW YOUR COMMUNITY</span><h1 className="title text-3xl">Invite three people you trust</h1><p className="helper">Klal works when your community is on it — {vouchesOn ? 'vouches from people you know, ' : ''}asks answered by people you trust. Your invite link is yours; anyone who joins through it is connected to you.</p></div>
        <InviteButton/>
        <div className="flex items-center justify-between"><button type="button" onClick={finish} className="text-sm font-medium text-brand-muted hover:text-brand-ink">Skip for now</button><button type="button" onClick={finish} className="primary">Done<ArrowRight size={16}/></button></div>
      </>}
    </div>
  </div>;
}
