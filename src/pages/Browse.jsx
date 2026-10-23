import React, { useEffect, useId, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '@/api/client';
import { List, Map as MapIcon, SlidersHorizontal, MessageCircle, Plus, MapPin, Globe, ChevronDown, LocateFixed, X } from 'lucide-react';
import ResourceCard from '@/components/ResourceCard';
import DirectoryMap from '@/components/DirectoryMap';
import { EVERYWHERE, placeCounter, searchDirectory, startingCountry, suggestKeywords, suggestPlaces } from '@/lib/search';
import SuggestInput from '@/components/SuggestInput';
import CountrySelect from '@/components/CountrySelect';
import { placeMatcher } from '@/lib/place';
import { countryName, inCountry } from '@/lib/countries';
import { kitchenAppliesTo, kitchenMatches } from '@/lib/kitchen';
import { lookupPlaces } from '@/lib/placeLookup';
import { providerPath } from '@/lib/paths';
import { categoryLabel } from '@/lib/categories';
import { OWNERSHIP_FILTERS, ownershipMatches, ownershipRank, readOwnershipFilter, saveOwnershipFilter } from '@/lib/ownership';
import { milesTo, useUserLocation } from '@/lib/userLocation';
import CityInput from '@/components/CityInput';
import { EVERYDAY_MILES, PICKS_SHOWN, QUICK_CATEGORIES, categoryPicks, everydayRank, kindOf, quickLabel } from '@/lib/everyday';

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
  const [category, setCategory] = useState(params.get('category') || (params.get('kitchen') ? 'Food & Catering' : ''));
  // The country picked, '' for Everywhere picked, or null for none picked yet,
  // when the box starts on the person's own country (worked out below).
  const [pickedCountry, setCountry] = useState(() => {
    const given = params.get('country');
    return given == null || given === '' ? null : given === EVERYWHERE ? '' : given;
  });
  const [kitchen, setKitchen] = useState(params.get('kitchen') || '');
  // The kind picked from the second row of picks (Restaurants, Women's…),
  // as kindOf's id. Belongs to the category, so it goes when the category does.
  const [kind, setKind] = useState(params.get('type') || '');
  const [morePicks, setMorePicks] = useState(false);
  const chooseCategory = (value) => {
    setCategory(value); setKind(''); setMorePicks(false);
    if (!kitchenAppliesTo(value)) setKitchen('');
  };
  // Closest first is the default whenever we know where the person is: the
  // spot "Near me" sent, else their profile city, or the place a guest picked
  // or their browser shared. A caterer search from Brooklyn should open on
  // Brooklyn, not Minnesota. "Nearest" needs a location to measure from;
  // without one every distance is unknown, so the list falls back to Most Used.
  const me = useUserLocation();
  // Where the device is right now, from a Near me tap here or on Home or
  // Resources. It beats the profile city, so someone driving to another town
  // for the day sees what is around them there. Kept in the link (lat, lng),
  // so coming back from a listing finds the same order.
  const [spot, setSpot] = useState(() => {
    const lat = Number(params.get('lat')), lng = Number(params.get('lng'));
    return lat && lng ? { lat, lng, city: '' } : null;
  });
  const here = spot || (me.lat != null ? { lat: me.lat, lng: me.lng } : null);
  const located = Boolean(here);
  const country = pickedCountry ?? startingCountry(providers, me.country, place);
  // Where suggestions keep to the country in the box, shown or picked, and
  // put places near the person first.
  const near = me.lat != null && me.lng != null ? { lat: me.lat, lng: me.lng } : null;
  // What they picked, if anything; until then the default follows the location,
  // which for a member arrives a moment after the page opens.
  const [picked, setSort] = useState('');
  const sort = picked && (picked !== 'nearest' || located) ? picked : located ? 'nearest' : 'used';
  const [settingCity, setSettingCity] = useState(false);
  const [cityText, setCityText] = useState('');
  const [locating, setLocating] = useState(false);
  const [denied, setDenied] = useState(false);
  const useMyLocation = async () => { setLocating(true); setDenied(!(await me.ask())); setLocating(false); };
  // Near me asks the device afresh every tap (a minute-old answer at most),
  // never the saved city. The Where box is emptied, since "near me" and
  // "in Boca Raton" ask different things, and the country box follows the
  // device: a New Yorker in Jerusalem gets Israel, not the United States.
  const whereId = useId();
  const [finding, setFinding] = useState(false);
  const [locationOff, setLocationOff] = useState(false);
  const nearMe = () => {
    setLocationOff(false);
    const off = () => { setFinding(false); setLocationOff(true); document.getElementById(whereId)?.focus(); };
    if (!navigator.geolocation) { off(); return; }
    setFinding(true);
    navigator.geolocation.getCurrentPosition(async ({ coords }) => {
      const at = { lat: coords.latitude, lng: coords.longitude, city: '' };
      setSpot(at); setPlace(''); setSort('nearest'); setCountry(''); setFinding(false);
      try {
        const { city, country_code } = await api.geo.reverse(coords.latitude, coords.longitude);
        setSpot((now) => (now === at ? { ...at, city: city || '' } : now));
        const name = countryName(String(country_code || '').toUpperCase());
        if (name) setCountry(name);
      } catch { /* the point is what matters; the name is for display */ }
    }, off, { timeout: 10000, maximumAge: 60000 });
  };
  const leaveNearMe = () => { setSpot(null); setCountry(null); };
  const [verified, setVerified] = useState(false);
  // All, Jewish-owned only or Not Jewish-owned only. Remembered in this
  // browser, so a visitor who wants only one kind keeps getting it.
  const [owned, setOwnedState] = useState(readOwnershipFilter);
  const setOwned = (v) => { setOwnedState(v); saveOwnershipFilter(v); };
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
    set('q', q); set('location', place); set('category', category); set('country', pickedCountry === '' ? EVERYWHERE : pickedCountry); set('kitchen', kitchen); set('type', kind);
    set('lat', spot && spot.lat.toFixed(4)); set('lng', spot && spot.lng.toFixed(4));
    const query = next.toString();
    const url = `${location.pathname}${query ? `?${query}` : ''}${location.hash}`;
    if (url !== `${location.pathname}${location.search}${location.hash}`) window.history.replaceState(window.history.state, '', url);
  }, [q, place, category, pickedCountry, kitchen, kind, spot]);

  // Every word typed and the place both count; see @/lib/search. Everything
  // but the category is applied here, so the category list can count what
  // each choice would show for this search.
  const search = useMemo(() => searchDirectory(providers, { q, where: place, country }), [providers, q, place, country]);
  const scoreOf = useMemo(() => new Map(search.results.map((r) => [r.provider.id, r.score])), [search]);
  const passes = (p) => (!verified || p.verified) && ownershipMatches(p, owned) && (!category || p.category === category) && kitchenMatches(p, kitchen) && (!kind || kindOf(p)?.id === kind);

  // With a search typed, the listings that are what was asked for come first
  // (a search for shul opens on the shuls), and the chosen sort orders each
  // tier. Without one, the sort alone decides.
  //
  // Closest first is gentler with the tiers: anything that is a real answer
  // (at least half as strong a match as the best one) counts as one tier, so
  // a Brooklyn caterer is not put behind a Minnesota one over a word in its
  // name. Mentions in passing still come after.
  //
  // Among the real answers, Jewish-owned listings come first: in Closest
  // first only against others about as close (the same ~3-mile band), in
  // every other sort ahead of the rest of the tier.
  //
  // With nothing typed and no category picked, the everyday things (food,
  // gemachs) lead instead of whatever is nearest, which is nearly always a
  // shul or a mikvah; see @/lib/everyday. In Closest first only within
  // EVERYDAY_MILES, so nothing far away jumps ahead of the town.
  const everyday = !q.trim() && !category && (sort === 'nearest' || sort === 'used');
  const lead = (p) => (!everyday ? 0 : sort !== 'nearest' ? everydayRank(p.category)
    : (p.distance ?? 9999) <= EVERYDAY_MILES ? everydayRank(p.category) : 1000);
  const order = (rows, scores = scoreOf) => {
    const best = Math.max(0, ...rows.map((p) => scores.get(p.id) || 0));
    const tier = (p) => ((scores.get(p.id) || 0) >= best / 2 ? 1 : 0);
    const score = sort === 'nearest' ? tier : (p) => scores.get(p.id) || 0;
    const band = (p) => Math.floor((p.distance ?? 9999) / 3);
    return [...rows].sort((a, b) => (lead(a) - lead(b)) || (tier(b) - tier(a))
      || (sort === 'nearest' ? band(a) - band(b) : 0) || ownershipRank(a, b)
      || (score(b) - score(a)) || (sort === 'nearest' ? (a.distance ?? 9999) - (b.distance ?? 9999)
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
  }, [search, category, sort, verified, owned, here?.lat, here?.lng, country, kitchen, kind]); // eslint-disable-line react-hooks/exhaustive-deps
  // Where the results are, in words: "Boca Raton", "Israel", "Jerusalem, Israel".
  const whereText = [askedPlace, country].filter(Boolean).filter((s, i, all) => all.indexOf(s) === i).join(', ');

  // The category list shows no numbers, but a category with nothing in the
  // search on screen (say, shul in Boca Raton) is greyed out, judged by the
  // results, never the whole directory.
  const scoped = useMemo(() => search.results.map((r) => r.provider).filter((p) => (!verified || p.verified) && ownershipMatches(p, owned)), [search, verified, owned]);
  const countFor = (name) => scoped.filter((p) => p.category === name).length;
  // The picks inside the chosen category, from what it has on screen before
  // any of them is applied, so the row stays put as they are tapped.
  const picks = useMemo(() => (category
    ? categoryPicks(scoped.filter((p) => p.category === category), { kitchens: kitchenAppliesTo(category), kitchenFor: kitchenMatches })
    : []), [scoped, category]);
  const isOn = (pick) => (pick.kind === 'kitchen' ? kitchen === pick.id : kind === pick.id);
  const togglePick = (pick) => {
    const set = pick.kind === 'kitchen' ? setKitchen : setKind;
    set(isOn(pick) ? '' : pick.id);
  };
  // About five at a time; More shows the rest. One that is on always shows.
  const shownPicks = morePicks ? picks : picks.filter((p, i) => i < PICKS_SHOWN || isOn(p));
  const hiddenPicks = picks.length - shownPicks.length;

  // The numbers beside places in the Where box are what picking that place
  // would show with everything else on screen kept: the words typed, the
  // category, Verified only and the kitchen. Counted from the listings as
  // loaded, so a new listing is in them the next time the page opens.
  // A country nobody picked does not narrow them, so a place abroad is still
  // offered, and picking it opens on Everywhere (see startingCountry).
  const countPlace = useMemo(() => placeCounter(providers, { q, country: pickedCountry || '', keep: passes }),
    [providers, q, pickedCountry, category, verified, owned, kitchen, kind]); // eslint-disable-line react-hooks/exhaustive-deps

  // Suggestions under the keyword box count what is listed in the place being
  // searched, so they never promise results the page will not show.
  const navigate = useNavigate();
  const pickKeyword = (item) => {
    if (item.kind === 'listing') navigate(providerPath(item.value));
    else if (item.kind === 'category') { chooseCategory(item.value); setQ(''); }
    else setQ(item.value);
  };

  // The ownership filter is left out: it is remembered, so counting it would
  // log a search every time someone who set it opens the page. So is a
  // country nobody picked: every visit starts on one.
  const isSearch = !!(q || place || category || verified || pickedCountry || kitchen || kind);

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

  const clearFilters = () => { setSpot(null); setLocationOff(false); setQ(''); choosePlace(''); setCountry(null); setCategory(''); setVerified(false); setOwned(''); setKitchen(''); setKind(''); };

  return <div className="page-shell py-8">
    <div className="mb-7">
      <span className="eyebrow">DISCOVER</span>
      <h1 className="title text-3xl">Community resources</h1>
      <p className="helper">Search curated Klal listings—not an unfiltered public business index.</p>
    </div>

    <div className="mb-6 grid gap-2 rounded-lg bg-brand-surface p-3 ring-1 ring-brand-line md:grid-cols-12">
      <SuggestInput wrapperClassName="md:col-span-4" value={q} onChange={setQ} onPick={pickKeyword}
        suggest={(text) => suggestKeywords(text, providers, categories, place, country)}
        placeholder="Shul, mikvah, restaurant…" aria-label="What are you looking for?" />
      <SuggestInput id={whereId} wrapperClassName="md:col-span-2" value={place} onChange={(v) => { choosePlace(v); setLocationOff(false); }} onPick={(item) => choosePlace(item.value)}
        suggest={(text) => suggestPlaces(text, providers, country, countPlace, near)} suggestMore={(text) => (text.length >= 2 ? lookupPlaces(text, { country, near }) : [])} minLength={0}
        placeholder={country ? `All of ${country}` : 'Any city, state or ZIP'} aria-label="Where: city, state or ZIP" />
      {/* Right under the Where box on a phone, so it is a thumb away; on a
          computer it sits beside Clear. Teal outline when on, so it is plain
          the list is ordered from here. */}
      <button type="button" onClick={nearMe} disabled={finding} aria-pressed={!!spot}
        className={`secondary md:order-1 md:col-span-2 ${spot ? 'border-brand-teal bg-brand-tint text-brand-teal' : ''}`}>
        <LocateFixed size={16} className="text-brand-teal" />{finding ? 'Finding you…' : 'Near me'}
      </button>
      <CountrySelect wrapperClassName="md:col-span-2" labelClassName="left-3 right-9 mt-0.5 text-sm" className="field" providers={providers} value={country} onChange={chooseCountry} />
      <select className="field md:col-span-2" value={category} onChange={(e) => chooseCategory(e.target.value)}>
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
      <select className="field md:col-span-3" value={owned} onChange={(e) => setOwned(e.target.value)} aria-label="Jewish-owned or not">
        {OWNERSHIP_FILTERS.map((f) => <option key={f.id || 'all'} value={f.id}>{f.id ? f.label : 'Jewish-owned or not: All'}</option>)}
      </select>
      <label className="flex items-center gap-2 px-2 text-sm md:col-span-5">
        <input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} /> Verified only
      </label>
      {/* Last of the filters, and filled teal so it reads as the one action in a stack of boxes. */}
      <button type="button" onClick={clearFilters} className="clear-filters md:order-2 md:col-span-2">Clear</button>
    </div>

    {locationOff && <p role="status" className="-mt-3 mb-4 flex items-center gap-1.5 rounded-lg bg-brand-gold-bg/60 px-3 py-2 text-sm font-medium text-brand-gold-ink"><MapPin size={14} className="shrink-0" />Location is off, type your city instead.</p>}
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
    {sort === 'nearest' && spot && <p className="-mt-3 mb-4 flex flex-wrap items-center gap-x-2 px-1 text-xs text-brand-muted">
      <LocateFixed size={13} className="shrink-0 text-brand-teal" />
      <span>Closest to where you are now first{spot.city ? ` (near ${spot.city})` : ''}.</span>
      {me.lat != null && <button type="button" onClick={leaveNearMe} className="font-semibold text-brand-teal underline-offset-2 hover:underline">Use {me.city || 'my saved location'} instead</button>}
    </p>}
    {sort === 'nearest' && !spot && <p className="-mt-3 mb-4 flex flex-wrap items-center gap-x-2 px-1 text-xs text-brand-muted">
      <MapPin size={13} className="shrink-0 text-brand-teal" />
      <span>Closest to {me.city || 'your location'} first{me.source === 'profile' ? ' (your profile city)' : ''}{everyday ? ', with food and gemachs nearby leading' : ''}.</span>
      {me.source !== 'profile' && <button type="button" onClick={() => { me.forget(); setSettingCity(true); }} className="font-semibold text-brand-teal underline-offset-2 hover:underline">Change</button>}
    </p>}

    {/* On a computer: the count on its own line, then the quick picks with
        List / Map on their right. On a phone the picks get a row of their own
        under the count and List / Map, so they are not squeezed. */}
    <div className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      {/* When there is nothing local, say that — a bare "0 found" sitting
          above the clearly-labelled listings from other communities is the
          same confusion the padded count used to cause. */}
      <span className="order-1 min-w-0 flex-1 text-sm font-medium md:basis-full">
        {results.length > 0
          ? <>{results.length} {results.length === 1 ? 'resource' : 'resources'} found {whereText ? `in ${whereText}` : 'everywhere'}</>
          : isSearch
            ? <>No matches{whereText ? <> in {whereText}</> : null}{elsewhere.length > 0 ? ` · ${elsewhere.length} elsewhere` : ''}</>
            : <>0 resources found</>}
      </span>
      {/* Quick picks beside List / Map, so the common things are one tap
          instead of a dropdown. Before a category is chosen they are the
          categories; after, the chosen one (tap to go back) and the kinds
          inside it that the search on screen has. Only ones with listings. */}
      {providers.length > 0 && <div className={`quick-cats order-3 w-full md:order-2 md:w-auto md:flex-1 ${category ? 'wrap' : ''}`} role="group" aria-label="Quick picks">
        {!category && QUICK_CATEGORIES.filter((c) => countFor(c.name) > 0).map((c) => (
          <button key={c.name} type="button" onClick={() => chooseCategory(c.name)} className="quick-cat">{c.label}</button>
        ))}
        {category && <>
          <button type="button" onClick={() => chooseCategory('')} className="quick-cat on" aria-label={`${quickLabel(category)}: show all categories`}>
            <X size={13} />{quickLabel(category)}
          </button>
          {shownPicks.map((p) => (
            <button key={`${p.kind}:${p.id}`} type="button" onClick={() => togglePick(p)} aria-pressed={isOn(p)} className={`quick-cat ${isOn(p) ? 'picked' : ''}`}>{p.label}</button>
          ))}
          {(hiddenPicks > 0 || morePicks) && picks.length > PICKS_SHOWN && <button type="button" onClick={() => setMorePicks((v) => !v)} className="quick-cat more">
            {morePicks ? 'Less' : 'More'}<ChevronDown size={13} className={morePicks ? 'rotate-180' : ''} />
          </button>}
        </>}
      </div>}
      <div className="order-2 ml-auto flex shrink-0 rounded-xl bg-brand-surface p-1 ring-1 ring-brand-line md:order-3">
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
              {(isSearch || owned) && <button type="button" onClick={clearFilters} className="secondary">Clear filters</button>}
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
