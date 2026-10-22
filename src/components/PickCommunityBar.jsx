import React, { useState } from 'react';
import { MapPin, LocateFixed } from 'lucide-react';
import { api } from '@/api/client';
import CityInput from '@/components/CityInput';
import { save } from '@/lib/savedLocation';

// Where a member is told to set their location in Settings, a guest is asked
// to pick their community instead: guests have no Settings. The place is kept
// in this browser (@/lib/savedLocation), and the same place then drives the
// Shabbos times, "near you" and closest-first search, so they cannot disagree.
export default function PickCommunityBar() {
  const [city, setCity] = useState('');
  const [state, setState] = useState(''); // '' | 'asking' | 'denied'

  const pick = (p) => {
    if (p?.latitude == null || p?.longitude == null) return;
    save({ lat: Number(p.latitude), lng: Number(p.longitude), city: p.city || p.label || '', country: p.country_code || '', source: 'chosen' });
  };
  const locate = () => {
    if (!navigator.geolocation) { setState('denied'); return; }
    setState('asking');
    navigator.geolocation.getCurrentPosition(async ({ coords }) => {
      const here = { lat: coords.latitude, lng: coords.longitude, city: '', source: 'browser' };
      try {
        const { city: name, country_code } = await api.geo.reverse(coords.latitude, coords.longitude);
        if (name) Object.assign(here, { city: name, country: country_code || '' });
      } catch { /* the point is what matters; the name is for display */ }
      save(here);
    }, () => {
      setState('denied');
      document.getElementById('kc-pick-community')?.focus();
    }, { timeout: 10000, maximumAge: 600000 });
  };

  return <div className="bg-brand-gold-bg/60 px-4 py-2.5 text-sm text-brand-gold-ink">
    <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-x-3 gap-y-2">
      <span className="inline-flex items-center gap-1.5 font-semibold"><MapPin size={14} className="shrink-0" />Pick your community</span>
      <span className="hidden text-brand-gold-ink/80 sm:inline">for Shabbos times and listings near you</span>
      <div className="w-full max-w-[15rem] text-brand-ink sm:w-60">
        <CityInput id="kc-pick-community" value={city} onChange={setCity} onPick={pick}
          className="field mt-0 py-1.5 text-sm" placeholder="Type your city"
          aria-label="Your community" missHint="Pick a city from the list for Shabbos times." />
      </div>
      <button type="button" onClick={locate} disabled={state === 'asking'} className="secondary py-1.5 text-xs disabled:opacity-60">
        <LocateFixed size={14} className="text-brand-teal" />{state === 'asking' ? 'Finding you…' : 'Use my location'}
      </button>
      {state === 'denied' && <span className="w-full text-center text-xs">Location is off, type your city instead.</span>}
    </div>
  </div>;
}
