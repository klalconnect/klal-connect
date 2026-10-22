import React,{useEffect,useState} from 'react';
import { Link } from 'react-router-dom';
import { MapPin } from 'lucide-react';
import { useShabbosStatus, shabbosState } from '@/hooks/useShabbosStatus';
import { tokenStore } from '@/api/client';
import { useAuth } from '@/lib/AuthContext';
import PickCommunityBar from '@/components/PickCommunityBar';
// Shared with the homepage's local section, so both show a Havdalah that falls
// tomorrow the same way. See @/lib/time.
import { timeInZone as fmt } from '@/lib/time';
function countdown(ms){ if(!ms) return ''; const s=Math.max(0,Math.floor((ms-Date.now())/1000)); const h=Math.floor(s/3600),m=Math.floor((s%3600)/60); return h>0?`${h}h ${m}m`:`${m}m`; }

export default function ShabbosMode(){
  const { status, verified }=useShabbosStatus();
  const { isAuthenticated, isGuest }=useAuth();
  const [,force]=useState(0);
  // Lets someone past a full lock for genuine need — looking up a doctor or a
  // gemach. Writes stay blocked; this only makes the app readable, and it
  // resets on reload so it is a deliberate act each time.
  const [browsing,setBrowsing]=useState(false);
  useEffect(()=>{ const id=setInterval(()=>force(x=>x+1),1000); return ()=>clearInterval(id); },[]);

  // The gate is keyed to a signed-in user's saved location, so a visitor who is
  // not signed in has nothing to gate on — the server answers hasLocation:false
  // for them anyway.
  //
  // The signal is the presence of a token, NOT a successful session check.
  // Offline, /api/auth/me fails and isAuthenticated goes false, which would
  // skip the gate for a signed-in user — the exact fail-open this guards
  // against. AuthContext only clears the token on a real 401/403, so a token
  // that is still there means the session is still good as far as we know.
  const signedIn = !!tokenStore.get() || isAuthenticated;
  if(!signedIn) return null;

  // Decided from the clock against absolute boundaries, so crossing candle
  // lighting locks on the next tick rather than at the next poll.
  const state=shabbosState(status);

  // Never render the app when we cannot establish the time. Showing an
  // unlocked app during Shabbos is the failure this whole feature exists to
  // prevent, so an unverified state blocks instead.
  if(state==='unknown') return <Unverified/>;
  // A guest has no Settings to set a location in, so they pick one here.
  if(state==='no-location') return isGuest ? <PickCommunityBar/> : <NoLocation/>;
  if(state==='restricted'){
    // Nothing can be written either way — assertWritable refuses on the server.
    // The only question here is whether the app is readable.
    if(status.readOnly || browsing) return <ReadOnlyBanner status={status}/>;
    return <LockScreen status={status} onBrowse={()=>setBrowsing(true)}/>;
  }
  if(status.nextChange && status.nextChange-Date.now()>0 && status.nextChange-Date.now()<6*3600000) return <CountdownBanner status={status} stale={!verified}/>;
  return null;
}

// Blocking, not a banner: until the times are known the app must not be usable.
function Unverified(){
  return <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-brand-navy px-6 text-center text-white">
    <div className="h-8 w-8 animate-spin rounded-full border-4 border-white/20 border-t-white"/>
    <p className="mt-5 font-heading text-xl font-bold">Checking Shabbos &amp; Yom Tov times…</p>
    <p className="mt-2 max-w-sm text-sm text-white/70">The app stays closed until your candle lighting and Havdalah times are confirmed.</p>
  </div>;
}

function NoLocation(){ return <div className="bg-brand-gold-bg/60 px-4 py-2 text-center text-sm text-brand-gold-ink"><MapPin size={14} className="mr-1 inline"/>Set your location in <Link to="/settings#location" className="font-bold underline">Settings</Link> for accurate Shabbos &amp; Yom Tov times.</div>; }
// Both banners carry the parsha alongside the times. These are the two places
// most people actually see their zmanim — the lock screen only appears once
// Shabbos is in — and "when does it start" and "which parsha is it" are the
// same question asked on the same Friday afternoon. status.parsha comes from
// @hebcal/core already rendered ("Parashat Noach"), so it needs no label.
//
// flex-wrap rather than one line of text: four facts and a city name do not fit
// across a phone, and a banner that overflows is worse than one that wraps.
function CountdownBanner({status, stale}){ return <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 bg-brand-navy px-4 py-2 text-center text-sm text-white">
  <span className="font-semibold">Shabbos begins in {countdown(status.nextChange)}</span>
  {status.startsAt&&<span className="text-white/75">· Candle lighting {fmt(status.startsAt,status.tzid)}</span>}
  {status.parsha&&<span className="font-semibold">· {status.parsha}</span>}
  <span className="text-white/75">· {status.cityLabel}</span>
  {stale&&<span className="text-white/60">(offline — last known times)</span>}
</div>; }
function ReadOnlyBanner({status}){ return <div className="sticky top-[calc(4rem+env(safe-area-inset-top))] z-30 flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 bg-brand-gold-bg/80 px-4 py-2 text-center text-sm text-brand-gold-ink">
  <span className="font-semibold">Shabbos / Yom Tov (read-only)</span>
  {status.parsha&&<span className="font-semibold">· {status.parsha}</span>}
  <span>· Havdalah {fmt(status.endsAt,status.tzid)}</span>
  <span className="opacity-75">· {status.cityLabel}</span>
</div>; }
function LockScreen({status, onBrowse}){ const greeting=status.windowKind==='yomtov'?'Gut Yom Tov':status.windowKind==='both'?'Gut Yom Tov & Gut Shabbos':status.windowKind==='shabbos'?'Gut Shabbos':(status.parsha?'Gut Shabbos':'Gut Yom Tov'); return <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-brand-navy px-6 text-center text-white"><p className="text-xs font-bold tracking-[0.18em] text-brand-gold">{status.isInIsrael?'ISRAEL':'DIASPORA'}</p><h1 className="mt-3 font-heading text-4xl font-bold tracking-tight">{greeting}</h1><p className="mt-2 text-brand-gold">{status.cityLabel}</p><div className="mt-8 grid gap-3 text-sm"><p>Candle lighting · <b>{fmt(status.startsAt,status.tzid)}</b></p><p>Havdalah · <b>{fmt(status.endsAt,status.tzid)}</b></p>{status.parsha&&<p>Parsha · <b>{status.parsha}</b></p>}</div><p className="mt-8 text-sm text-white/70">Havdalah in {countdown(status.endsAt)}</p><p className="mt-2 text-xs text-white/50">The app unlocks automatically after Havdalah.</p>
  <button onClick={onBrowse} className="mt-8 text-sm text-white/60 underline underline-offset-4 hover:text-white">Need a phone number urgently? Open the directory</button>
</div>; }