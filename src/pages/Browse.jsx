import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '@/api/client';
import { List, Map as MapIcon, SlidersHorizontal, MessageCircle, Plus, MapPin, Globe, ChevronDown, X } from 'lucide-react';
import ResourceCard from '@/components/ResourceCard';
import DirectoryMap from '@/components/DirectoryMap';
import { placeCounter, searchDirectory, suggestKeywords, suggestPlaces } from '@/lib/search';
import SuggestInput from '@/components/SuggestInput';
import CountrySelect from '@/components/CountrySelect';
import { placeMatcher } from '@/lib/place';
import { inCountry } from '@/lib/countries';
import { KITCHENS, kitchenMatches, kitchenOf } from '@/lib/kitchen';
import { lookupPlaces } from '@/lib/placeLookup';
import { providerPath } from '@/lib/paths';
import { categoryLabel } from '@/lib/categories';
import { milesTo, useUserLocation } from '@/lib/userLocation';
import CityInput from '@/components/CityInput';

// A search id, so a contact action can be attributed to the search that led
// to it — "did this search actually help anyone" is the only question worth
// asking of search analytics.
const newSearchId = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export default function Browse() {
  const params = new URLSearchParams(location.search);
  const [providers, setProviders] = useState([]);
  const [categories, setCategories] = useState([]);
  const [q, setQ] = useState(params.get('q') || '');
  // Only the place this link names. A place typed here belongs to this
  // search: going back to Home or Resources finds their own Where box empty,
  // not "Hollywood" carried over from the results.
  const [place, setPlace] = useState(params.get('location') || '');
  const [category, setCategory] = useState(params.get('category') || '');
  const [country, setCountry] = useState(params.get('country') || '');
  const [kitchen, setKitchen] = useState(params.get('kitchen') || '');
  // Closest first is the default whenever we know where the person is: the
  // spot "Near me" sent, else their profile city, or the place a guest picked
  // or their browser shared. A caterer search from Brooklyn should open on
  // Brooklyn, not Minnesota. "Nearest" needs a location to measure from;
  // without one every distance is unknown, so the list falls back to Most Used.
  const me = useUserLocation();
  const urlLat = Number(params.get('lat')), urlLng = Number(params.get('lng'));
  const here = urlLat && urlLng ? { lat: urlLat, lng: urlLng } : me.lat != null ? { lat: me.lat, lng: me.lng } : null;
  const located = Boolean(here);
  // What they picked, if anything; until then the default follows the location,
  // which for a member arrives a moment after the page opens.
  const [picked, setSort] = useState('');
  const sort = picked && (picked !== 'nearest' || located) ? picked : located ? 'nearest' : 'used';
  const [settingCity, setSettingCity] = useState(false);
  const [cityText, setCityText] = useState('');
  const [locating, setLocating] = useState(false);
  const [denied, setDenied] = useState(false);
  const useMyLocation = async () => { setLocating(true); setDenied(!(await me.ask())); setLocating(false); };
  const [verified, setVerified] = useState(false);
  const [view, setView] = useState('list');
  const [showWide, setShowWide] = useState(false);

  useEffect(() => {
    Promise.all([api.entities.Provider.filter({ status: 'published' }), api.entities.Category.list('order')])
      .then(([p, c]) => { setProviders(p); setCategories(c); })
      .catch(() => {});
  }, []);

  const choosePlace = (value) => setPlace(value);
  // Picking a country lets go of a place that is not in it: "Israel" with
  // "Boca Raton" still in the Where box would find nothing.
  const chooseCountry = (value) => {
    setCountry(value);
    const test = placeMatcher(place, providers);
    if (value && test && !inCountry(providers, value).some(test)) choosePlace('');
  };

  // The search is kept in this page's own address instead, so opening a
  // listing and coming back finds the results as they were left. Written
  // straight into the current history entry, not through the router: the
  // entry keeps its key, so the back button's scroll restore still finds it,
  // and nothing re-renders on every letter typed.
  useEffect(() => {
    const next = new URLSearchParams(location.search);
    const set = (name, value) => { if (value) next.set(name, value); else next.delete(name); };
    set('q', q); set('location', place); set('category', category); set('country', country); set('kitchen', kitchen);
    const query = next.toString();
    const url = `${location.pathname}${query ? `?${query}` : ''}${location.hash}`;
    if (url !== `${location.pathname}${location.search}${location.hash}`) window.history.replaceState(window.history.state, '', url);
  }, [q, place, category, country, kitchen]);

  // Every word typed and the place both count; see @/lib/search. Everything
  // but the category is applied here, so the category list can count what
  // each choice would show for this search.
  const search = useMemo(() => searchDirectory(providers, { q, where: place, country }), [providers, q, place, country]);
  const scoreOf = useMemo(() => new Map(search.results.map((r) => [r.provider.id, r.score])), [search]);
  const passes = (p) => (!verified || p.verified) && (!category || p.category === category) && kitchenMatches(p, kitchen);

  // With a search typed, the listings that are what was asked for come first
  // (a search for shul opens on the shuls), and the chosen sort orders each
  // tier. Without one, the sort alone decides.
  //
  // Closest first is gentler with the tiers: anything that is a real answer
  // (at least half as strong a match as the best one) counts as one tier, so
  // a Brooklyn caterer is not put behind a Minnesota one over a word in its
  // name. Mentions in passing still come after.
  const order = (rows, scores = scoreOf) => {
    const best = Math.max(0, ...rows.map((p) => scores.get(p.id) || 0));
    const score = sort === 'nearest' ? (p) => ((scores.get(p.id) || 0) >= best / 2 ? 1 : 0) : (p) => scores.get(p.id) || 0;
    return [...rows].sort((a, b) => (score(b) - score(a)) || (sort === 'nearest' ? (a.distance ?? 9999) - (b.distance ?? 9999)
      : sort === 'used' ? (b.usage_count || 0) - (a.usage_count || 0)
        : sort === 'saved' ? (b.save_count || 0) - (a.save_count || 0)
          : sort === 'recent' ? new Date(b.created_date) - new Date(a.created_date)
            : (a.name || '').localeCompare(b.name || '')));
  };

  // Results are what actually matched — nothing else. The previous version
  // widened the search when it came up empty, and its last stage dropped the
  // query text altogether, so a search for a plumber with no plumbers listed
  // returned every listing in the directory while the header counted them as
  // results. A padded answer is worse than an honest "not yet".
  //
  // A search for a place shows what is in that place. Organizations that
  // match only because they serve everywhere ("Nationwide", "International")
  // are kept apart, in a folded box underneath, so the Bahamas shows the
  // Bahamas while someone in Boca can still find Relief Resources.
  const { results, wide, elsewhere, askedPlace } = useMemo(() => {
    // Most listings have no pin of their own and are placed at their city's
    // centre: good enough to order by, but "0.0 mi" on a card would be a guess
    // dressed as a fact, so only a pinned listing shows its miles.
    const withDistance = (p) => {
      const distance = milesTo(here, p);
      const pinned = Number(p.latitude) && Number(p.longitude);
      return { ...p, distance, shownDistance: pinned ? distance : null };
    };
    const where = search.parsed.place;
    const hits = search.results.filter((r) => !r.wide).map((r) => r.provider).filter(passes);
    const anywhere = search.results.filter((r) => r.wide).map((r) => r.provider).filter(passes);
    // Same search, other communities. Shown under its own heading, never
    // mixed into the count.
    let other = [], otherScores = new Map();
    if (where) {
      const seen = new Set([...hits, ...anywhere].map((p) => p.id));
      const wide = searchDirectory(providers, { q, anywhere: true, country }).results;
      otherScores = new Map(wide.map((r) => [r.provider.id, r.score]));
      other = wide.map((r) => r.provider).filter((p) => passes(p) && !seen.has(p.id));
    }
    return { results: order(hits.map(withDistance)), wide: order(anywhere.map(withDistance)), elsewhere: order(other.map(withDistance), otherScores), askedPlace: where };
  }, [search, category, sort, verified, here?.lat, here?.lng, country, kitchen]); // eslint-disable-line react-hooks/exhaustive-deps
  // Where the results are, in words: "Boca Raton", "Israel", "Jerusalem, Israel".
  const whereText = [askedPlace, country].filter(Boolean).filter((s, i, all) => all.indexOf(s) === i).join(', ');

  // The category list shows no numbers, but a category with nothing in the
  // search on screen (say, shul in Boca Raton) is greyed out, judged by the
  // results, never the whole directory.
  const scoped = useMemo(() => search.results.map((r) => r.provider).filter((p) => !verified || p.verified), [search, verified]);
  const countFor = (name) => scoped.filter((p) => p.category === name).length;
  // The Meat / Dairy filter shows once food is in the picture: food chosen,
  // or a search that turned up places with a kitchen label.
  const showKitchen = !!kitchen || category === 'Food & Catering' || scoped.some((p) => kitchenOf(p) && (!category || p.category === category));

  // The numbers beside places in the Where box are what picking that place
  // would show with everything else on screen kept: the words typed, the
  // category, Verified only and the kitchen. Counted from the listings as
  // loaded, so a new listing is in them the next time the page opens.
  const countPlace = useMemo(() => placeCounter(providers, { q, country, keep: passes }),
    [providers, q, country, category, verified, kitchen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Suggestions under the keyword box count what is listed in the place being
  // searched, so they never promise results the page will not show.
  const navigate = useNavigate();
  const pickKeyword = (item) => {
    if (item.kind === 'listing') navigate(providerPath(item.value));
    else if (item.kind === 'category') { setCategory(item.value); setQ(''); }
    else setQ(item.value);
  };

  const isSearch = !!(q || place || category || verified || country || kitchen);

  // Every search is recorded, not only the ones where someone clicks the
  // button — most arrive from a link with the query already in the URL. The
  // result count is the point: an empty one is the clearest statement of
  // what this community is missing.
  useEffect(() => {
    if (!providers.length || !isSearch) return;
    const timer = setTimeout(() => {
      const search_id = newSearchId();
      try {
        sessionStorage.setItem('kc_last_search', JSON.stringify({ search_id, query: q, city: askedPlace, at: Date.now() }));
      } catch { /* private mode; attribution is a nicety */ }
      api.entities.ActivityEvent.create({
        type: 'search',
        query: q,
        category,
        city: askedPlace,
        country,
        results: results.length,
        zero_result: results.length === 0,
        search_id,
      }).catch(() => {});
    }, 900);
    return () => clearTimeout(timer);
  }, [q, place, category, verified, country, results.length, providers.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // What to call the thing they were looking for, in a sentence. This text is
  // posted publicly under a real person's name, so it must not read as though
  // a machine wrote it.
  //
  // Articles are a trap here and not worth solving: an English "ends in s"
  // test says "a gemachim", because this vocabulary pluralises in -im and
  // -os — gemachim, mikvaos, yeshivos, sofrim, mohelim, shidduchim. So the
  // search is quoted rather than bent into a sentence. That is grammatical
  // whatever was typed, and it is also more honest: it shows the person
  // answering exactly what was searched for.
  const lookingFor = q.trim() || category || 'listings';
  const askSubject = q.trim() || category;
  const askText = askSubject
    ? `Looking for “${askSubject}”${whereText ? ` in ${whereText}` : ''} — does anyone have someone they would suggest?`
    : `Looking for a recommendation${whereText ? ` in ${whereText}` : ''} — can anyone help?`;
  const askHref = `/feed?ask=${encodeURIComponent(askText)}`;

  // The communities that do have something for this search, so "not here"
  // comes with somewhere to look.
  const otherPlaces = [...new Set(elsewhere.map((p) => (p.city || '').trim()).filter(Boolean))].slice(0, 6);

  const clearFilters = () => { setQ(''); choosePlace(''); setCountry(''); setCategory(''); setVerified(false); setKitchen(''); };

  return <div className="page-shell py-8">
    <div className="mb-7">
      <span className="eyebrow">DISCOVER</span>
      <h1 className="title text-3xl">Community resources</h1>
      <p className="helper">Search curated Klal listings—not an unfiltered public business index.</p>
    </div>

    <div className="mb-6 grid gap-2 rounded-lg bg-brand-surface p-3 ring-1 ring-brand-line md:grid-cols-12">
      <SuggestInput wrapperClassName="md:col-span-4" value={q} onChange={setQ} onPick={pickKeyword}
        suggest={(text) => suggestKeywords(text, providers, categories, place, country)}
        placeholder="Plumber, therapist, gemach…" aria-label="What are you looking for?" />
      <SuggestInput wrapperClassName="md:col-span-2" value={place} onChange={choosePlace} onPick={(item) => choosePlace(item.value)}
        suggest={(text) => suggestPlaces(text, providers, country, countPlace)} suggestMore={(text) => (text.length >= 2 ? lookupPlaces(text) : [])} minLength={0}
        placeholder={country ? `All of ${country}` : 'Any city, state or ZIP'} aria-label="Where: city, state or ZIP" />
      <CountrySelect className="field md:col-span-2" providers={providers} value={country} onChange={chooseCountry} />
      <select className="field md:col-span-2" value={category} onChange={(e) => setCategory(e.target.value)}>
        <option value="">All categories</option>
        {categories.map((c) => <option key={c.id} value={c.name} disabled={countFor(c.name) === 0 && c.name !== category}>{categoryLabel(c.name)}</option>)}
      </select>
      <select className="field md:col-span-2" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
        {located && <option value="nearest">Closest first</option>}
        <option value="used">Most Used</option>
        <option value="saved">Most Saved</option>
        <option value="recent">Recently Added</option>
        <option value="alpha">Alphabetical</option>
      </select>
      {showKitchen && <select className="field md:col-span-3" value={kitchen} onChange={(e) => setKitchen(e.target.value)} aria-label="Meat, dairy or fish">
        <option value="">Meat, dairy or fish: any</option>
        {KITCHENS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
      </select>}
      <label className={`flex items-center gap-2 px-2 text-sm ${showKitchen ? 'md:col-span-7' : 'md:col-span-10'}`}>
        <input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} /> Verified only
      </label>
      {/* Last of the filters, and filled teal so it reads as the one action in a stack of boxes. */}
      <button type="button" onClick={clearFilters} className="clear-filters md:col-span-2"><X size={16} />Clear</button>
    </div>

    {/* No location yet: ask for one rather than guess. Until then the list is
        Most Used. Kept to one quiet line so it never pushes the results down. */}
    {!located && providers.length > 0 && <div className="mb-4 rounded-lg bg-brand-surface px-3 py-2 text-sm ring-1 ring-brand-line">
      {settingCity
        ? <div className="flex flex-wrap items-center gap-2">
          <span className="text-brand-body">Your city:</span>
          <CityInput value={cityText} onChange={setCityText} autoFocus className="field mt-0 min-w-0 flex-1 py-1.5"
            onPick={(p) => { me.choose(p); setSettingCity(false); setCityText(''); }} />
          <button type="button" className="secondary py-1.5" onClick={() => setSettingCity(false)}>Cancel</button>
        </div>
        : <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-brand-body">
          <MapPin size={15} className="shrink-0 text-brand-teal" />
          <span>{denied ? 'Your browser did not share a location.' : 'See the closest results first:'}</span>
          <button type="button" onClick={useMyLocation} disabled={locating} className="font-semibold text-brand-teal underline-offset-2 hover:underline">{locating ? 'Finding you…' : 'Use my location'}</button>
          <span className="text-brand-muted">or</span>
          <button type="button" onClick={() => setSettingCity(true)} className="font-semibold text-brand-teal underline-offset-2 hover:underline">pick your city</button>
        </p>}
    </div>}
    {/* Says what "closest" is measured from, so the order explains itself. A
        guest can change it; a member's comes from their profile city. */}
    {sort === 'nearest' && !(urlLat && urlLng) && <p className="-mt-3 mb-4 flex flex-wrap items-center gap-x-2 px-1 text-xs text-brand-muted">
      <MapPin size={13} className="shrink-0 text-brand-teal" />
      <span>Closest to {me.city || 'your location'} first{me.source === 'profile' ? ' (your profile city)' : ''}.</span>
      {me.source !== 'profile' && <button type="button" onClick={() => { me.forget(); setSettingCity(true); }} className="font-semibold text-brand-teal underline-offset-2 hover:underline">Change</button>}
    </p>}

    <div className="mb-3 flex items-center justify-between">
      {/* When there is nothing local, say that — a bare "0 found" sitting
          above the clearly-labelled listings from other communities is the
          same confusion the padded count used to cause. */}
      <span className="text-sm font-medium">
        {results.length > 0
          ? <>{results.length} {results.length === 1 ? 'resource' : 'resources'} found {whereText ? `in ${whereText}` : 'everywhere'}</>
          : isSearch
            ? <>No matches{whereText ? <> in {whereText}</> : null}{elsewhere.length > 0 ? ` · ${elsewhere.length} elsewhere` : ''}</>
            : <>0 resources found</>}
      </span>
      <div className="flex rounded-xl bg-brand-surface p-1 ring-1 ring-brand-line">
        <button onClick={() => setView('list')} className={`view-button ${view === 'list' ? 'active' : ''}`}><List size={16} />List</button>
        <button onClick={() => setView('map')} className={`view-button ${view === 'map' ? 'active' : ''}`}><MapIcon size={16} />Map</button>
      </div>
    </div>

    {/* A corrected typo is said out loud, so a surprise result explains itself. */}
    {search.parsed.corrected && <p className="mb-3 text-sm text-brand-muted">Showing results for <b className="text-brand-ink">{search.parsed.corrected}</b></p>}

    {results.length > 0 && (view === 'map'
      ? <DirectoryMap providers={results} />
      // grid-cols-[minmax(0,1fr)] is load-bearing on a phone, for the same
      // reason it is in Feed: a grid item's default min-width is auto, so the
      // column grew to fit the widest listing card and pushed the page sideways.
      : <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[repeat(2,minmax(0,1fr))]">{results.map((p) => <ResourceCard key={p.id} provider={p} distance={p.shownDistance} />)}</div>)}

    {/* Nothing matched. Say so plainly, then give three ways forward: where it
        does exist, asking the community, and adding it. */}
    {results.length === 0 && providers.length > 0 && <div className="space-y-4">
      <div className="rounded-xl bg-brand-surface p-6 ring-1 ring-brand-line">
        <div className="flex items-start gap-3">
          <SlidersHorizontal className="mt-0.5 shrink-0 text-brand-teal" size={20} />
          <div className="min-w-0">
            <p className="font-semibold text-brand-ink">
              {isSearch
                ? <>No matching {lookingFor.toLowerCase()}{whereText ? <> in <b>{whereText}</b></> : null} yet.</>
                : <>Nothing matched those filters.</>}
            </p>
            <p className="helper mt-1">This is a curated directory, so a gap means nobody has added it — not that it does not exist.</p>

            {otherPlaces.length > 0 && <div className="mt-4">
              <p className="text-sm font-semibold text-brand-ink">Listed in other communities</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {otherPlaces.map((city) => (
                  <button key={city} type="button" onClick={() => choosePlace(city)} className="inline-flex items-center gap-1.5 rounded-full bg-brand-tint px-3 py-1.5 text-xs font-semibold text-brand-teal hover:ring-1 hover:ring-brand-teal">
                    <MapPin size={12} />{city}
                  </button>
                ))}
              </div>
            </div>}

            <div className="mt-5 flex flex-wrap gap-2">
              <Link to={askHref} className="primary"><MessageCircle size={16} />Ask the community</Link>
              <Link to="/add" className="secondary"><Plus size={16} />Suggest a listing</Link>
              {isSearch && <button type="button" onClick={clearFilters} className="secondary">Clear filters</button>}
            </div>
          </div>
        </div>
      </div>

      {/* Related results, clearly separated — never counted as matches. */}
      {elsewhere.length > 0 && <section>
        <h2 className="section-title mb-3">You might also look at…</h2>
        <p className="helper mb-3 mt-0">These match your search but are listed in another community.</p>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[repeat(2,minmax(0,1fr))]">{elsewhere.slice(0, 6).map((p) => <ResourceCard key={p.id} provider={p} distance={p.shownDistance} />)}</div>
      </section>}
    </div>}

    {wide.length > 0 && <section className="mt-6 rounded-xl bg-brand-surface ring-1 ring-brand-line">
      <button type="button" onClick={() => setShowWide((v) => !v)} aria-expanded={showWide}
        className="flex w-full items-center gap-3 px-4 py-3 text-left">
        <Globe size={18} className="shrink-0 text-brand-teal" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-brand-ink">Also helps from anywhere ({wide.length})</span>
          <span className="block text-xs text-brand-muted">Not based {whereText ? `in ${whereText}` : 'here'}. They list where they serve as nationwide or international.</span>
        </span>
        <ChevronDown size={18} className={`shrink-0 text-brand-muted transition ${showWide ? 'rotate-180' : ''}`} />
      </button>
      {showWide && <div className="grid grid-cols-[minmax(0,1fr)] gap-4 border-t border-brand-line p-4 lg:grid-cols-[repeat(2,minmax(0,1fr))]">{wide.map((p) => <ResourceCard key={p.id} provider={p} distance={p.shownDistance} />)}</div>}
    </section>}

    {providers.length === 0 && <div className="empty">
      <SlidersHorizontal />
      <p>The directory is just getting started — no listings have been added yet.</p>
      <Link to="/add" className="primary">Add the first listing</Link>
    </div>}
  </div>;
}
