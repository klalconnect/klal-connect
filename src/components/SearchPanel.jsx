import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Search, MapPin, LocateFixed, Globe } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import SuggestInput from '@/components/SuggestInput';
import CountrySelect from '@/components/CountrySelect';
import { placeCounter, suggestKeywords, suggestPlaces } from '@/lib/search';
import { lookupPlaces } from '@/lib/placeLookup';
import { providerPath } from '@/lib/paths';

// defaultLocation is the community already selected elsewhere on the page, so
// the search starts where the person is instead of asking them again.
export default function SearchPanel({ defaultLocation = '', autoFocus = false }) {
  const [query, setQuery] = useState('');
  const [location, setLocation] = useState(defaultLocation);
  const [country, setCountry] = useState('');
  const [locating, setLocating] = useState(false);
  const [locationOff, setLocationOff] = useState(false);
  const whereId = useId();
  const navigate = useNavigate();

  // A later community choice updates the field — but never over something
  // typed into it, which would throw away what the person actually wants.
  const typed = useRef(false);
  useEffect(() => { if (!typed.current) setLocation(defaultLocation); }, [defaultLocation]);

  // The same lists the homepage already loads, so suggestions cost nothing
  // extra there.
  const { data: providers = [] } = useQuery({
    queryKey: ['providers', 'all'],
    queryFn: () => api.entities.Provider.filter({ status: 'published' }),
  });
  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.entities.Category.list('order'),
  });

  // Each place is counted with what is typed in the first box, so its number
  // is what the results page will say.
  const countPlace = useMemo(() => placeCounter(providers, { q: query, country }), [providers, query, country]);

  const go = (q, where, category = '') => navigate(`/browse?q=${encodeURIComponent(q)}&location=${encodeURIComponent(where)}${country ? `&country=${encodeURIComponent(country)}` : ''}${category ? `&category=${encodeURIComponent(category)}` : ''}`);
  // Picking a country empties a Where box filled in for you (your own
  // community), which would otherwise find nothing there. Something you typed stays.
  const chooseCountry = (value) => {
    setCountry(value);
    if (value && !typed.current) setLocation('');
  };
  const submit = (e) => {
    e.preventDefault();
    go(query, location);
  };
  const pickKeyword = (item) => {
    if (item.kind === 'listing') navigate(providerPath(item.value));
    else if (item.kind === 'category') go('', location, item.value);
    else { setQuery(item.value); go(item.value, location); }
  };
  // The query used to be dropped here: searching for a plumber and then
  // tapping Near Me returned every listing nearby instead.
  //
  // With location blocked it used to do nothing at all. Now it says so and
  // puts the cursor in the Where box, which is the other way to say where.
  const locationIsOff = () => {
    setLocating(false);
    setLocationOff(true);
    document.getElementById(whereId)?.focus();
  };
  const nearMe = () => {
    setLocationOff(false);
    if (!navigator.geolocation) { locationIsOff(); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => { navigate(`/browse?q=${encodeURIComponent(query)}&lat=${coords.latitude}&lng=${coords.longitude}`); setLocating(false); },
      locationIsOff,
      { timeout: 10000, maximumAge: 600000 },
    );
  };

  return <div><form onSubmit={submit} className="rounded-xl bg-brand-surface p-3 ring-1 ring-brand-line md:flex md:gap-2">
    <label className="flex flex-1 items-center gap-3 border-b px-3 py-3 md:border-b-0 md:border-r">
      <Search className="text-brand-teal" />
      <SuggestInput wrapperClassName="w-full" value={query} onChange={setQuery} onPick={pickKeyword}
        suggest={(text) => suggestKeywords(text, providers, categories, location, country)}
        autoFocus={autoFocus} className="w-full bg-transparent outline-none" placeholder="Plumber, therapist, gemach…" aria-label="What are you looking for?" />
    </label>
    <label className="flex flex-1 items-center gap-3 border-b px-3 py-3 md:border-b-0 md:border-r">
      <MapPin className="text-brand-teal" />
      <SuggestInput id={whereId} wrapperClassName="w-full" value={location} onChange={(v) => { typed.current = true; setLocation(v); setLocationOff(false); }}
        onPick={(item) => { typed.current = true; setLocation(item.value); }}
        suggest={(text) => suggestPlaces(text, providers, country, countPlace)} suggestMore={(text) => (text.length >= 2 ? lookupPlaces(text) : [])} minLength={0}
        className="w-full bg-transparent outline-none" placeholder={country ? `All of ${country}` : 'Any city, state or ZIP'} aria-label="Where: city, state or ZIP" />
    </label>
    <label className="flex items-center gap-3 px-3 py-3 md:w-48 md:flex-none">
      <Globe className="shrink-0 text-brand-teal" />
      <CountrySelect className="w-full min-w-0 bg-transparent outline-none" providers={providers} value={country} onChange={chooseCountry} />
    </label>
    {/* Navy and white, the site's own primary button, instead of the gold
        block: it reads cleaner in both themes and matches every other main
        action. Near Me is its quiet outlined partner at the same height. */}
    <button type="submit" className="primary w-full px-6 py-3 text-base md:w-auto"><Search size={18} />Search</button>
    <button type="button" onClick={nearMe} className="secondary mt-2 w-full px-5 py-3 text-base md:mt-0 md:w-auto"><LocateFixed size={18} className="text-brand-teal" />{locating ? 'Locating…' : 'Near Me'}</button>
  </form>
  {locationOff && <p role="status" className="mt-2 flex items-center gap-1.5 rounded-lg bg-brand-gold-bg/60 px-3 py-2 text-sm font-medium text-brand-gold-ink"><MapPin size={14} className="shrink-0" />Location is off, type your city instead.</p>}
  </div>;
}
