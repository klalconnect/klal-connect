import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import useVouchesEnabled from '@/hooks/useVouchesEnabled';
import { MapPin, Plus, ArrowRight, MessageCircle, ShieldCheck, Flame, Moon, Newspaper, PenSquare, Users, LogIn } from 'lucide-react';
import SearchPanel from '@/components/SearchPanel';
import AddListingPrompt from '@/components/AddListingPrompt';
import ResourceCard from '@/components/ResourceCard';
import { iconFor, guessIcon } from '@/lib/categoryIcons';
import { countMatches } from '@/lib/search';
import { servesPlace, communitiesFrom } from '@/lib/place';
import { useCommunity } from '@/lib/community';
import { useShabbosStatus } from '@/hooks/useShabbosStatus';
import { timeInZone, timeAgo } from '@/lib/time';
import { POST_TYPE_BY_ID, BADGE_TONES, normalizePostType } from '@/lib/postTypes';
import { postedAt } from '@/lib/scheduledPosts';
import { categoryLabel } from '@/lib/categories';
import { nearbyListings } from '@/lib/nearby';
import useNearHere from '@/hooks/useNearHere';
import { useUserLocation } from '@/lib/userLocation';
import NearYouPrompt from '@/components/NearYouPrompt';
import { LoadingCards } from '@/components/Loading';

// The words people actually use, as searches rather than category filters —
// "Plumbers" is not a category, and the alias layer in @/lib/searchTerms is
// what turns it into results. A link with nothing behind it still leads
// somewhere useful: the directory says so plainly and offers to ask the klal.
const QUICK_LINKS = [
  ['Plumbers', 'plumber'],
  ['Therapists', 'therapist'],
  ['Gemachim', 'gemach'],
  ['Shuls', 'shul'],
  ['Mikvahs', 'mikvah'],
  ['Schools & Yeshivas', 'yeshiva'],
];

// Boca Raton is the launch community, so it is offered even before it is the
// best-stocked one. Every other chip is earned by having listings behind it.
const LAUNCH_COMMUNITY = 'Boca Raton';

export default function Home() {
  const vouchesOn = useVouchesEnabled();
  const { data: providers = [], isLoading: loadingListings } = useQuery({
    queryKey: ['providers', 'all'],
    queryFn: () => api.entities.Provider.filter({ status: 'published' }),
  });
  const { data: categories = [], isLoading: loadingCategories } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.entities.Category.list('order'),
  });
  // Only to seed the community — nobody should have to tell us where they are
  // twice. The same place the Shabbos times use: a member's saved location,
  // or the community a guest picked.
  const homeCity = useUserLocation().city;
  const { data: me = null } = useQuery({
    queryKey: ['me', 'home'],
    queryFn: async () => (await api.auth.hasAccount() ? api.auth.me() : null),
    retry: false,
  });
  const [community, setCommunity, chosen] = useCommunity(homeCity);

  // What is available where they are. A listing that serves everywhere serves
  // here too — see @/lib/place, which is also what the search uses.
  const local = useMemo(() => providers.filter((p) => servesPlace(p, community)), [providers, community]);

  const communities = useMemo(() => {
    const found = communitiesFrom(providers);
    const names = new Set(found.map((c) => c.city));
    // Deduped against each other, not only against the listed cities: when the
    // chosen community *is* the launch community and neither has listings yet,
    // both candidates passed the filter and React was handed two chips with the
    // same key — which duplicates or drops one. Likely at launch, where Boca
    // Raton may have nothing in it yet.
    const extra = [...new Set([LAUNCH_COMMUNITY, community])].filter((c) => c && !names.has(c)).map((city) => ({ city, count: 0 }));
    return [...found, ...extra].slice(0, 8);
  }, [providers, community]);

  // Counted against what a click will return, only to put the links with
  // results first and grey out the rest; the number itself is not shown (see
  // the category tiles below). A gap stays visible, because it is also
  // information — and an invitation.
  const quickLinks = useMemo(() => QUICK_LINKS
    .map(([label, q]) => ({ label, q, count: countMatches(providers, q, community) }))
    .sort((a, b) => (b.count > 0) - (a.count > 0)), [providers, community]);

  // Counted only to order the tiles and spot the empty ones; no number is
  // shown, the same as the category cards on Resources. Every count on this
  // page measured something slightly different (a city name, a search, a
  // drive radius), so they disagreed with each other and with the results a
  // tap opened. A category with nothing in it is not hidden and is not
  // promised as "coming soon" — nobody has committed to filling it. It asks
  // for the first listing instead, which is the actual bottleneck.
  const tiles = useMemo(() => categories
    .map((c) => ({ ...c, count: local.filter((p) => p.category === c.name).length }))
    .sort((a, b) => b.count - a.count || (a.order ?? 99) - (b.order ?? 99))
    .slice(0, 8), [categories, local]);

  const timesOnTop = useShabbosAtTop();

  return <div className="page-shell space-y-14 py-8 md:space-y-16 md:py-12">
    {/* From Thursday's sunset until Friday ends, the times and parsha are
        what people come for, so the strip moves up from Near you to the top. */}
    {timesOnTop && <ShabbosTimesBar className="-mb-8 md:-mb-10" />}
    {/* The feed leads: Klal Connect is first a place where the frum business
        world talks to itself. The directory follows, as what you get once
        you're here. */}
    <section>
      <span className="eyebrow">THE KLAL'S PROFESSIONAL NETWORK</span>
      <h1 className="mt-2 max-w-3xl font-display text-2xl font-bold tracking-tight text-brand-ink sm:text-3xl md:text-5xl">Where frum professionals and businesses connect.</h1>
      <p className="mt-3 max-w-2xl text-base text-brand-body sm:text-lg">Share what you're working on, ask the klal, promote your business and meet the people behind it.</p>
      <div className="mt-6 flex flex-wrap gap-2">
        <Link to="/feed" className="primary"><Newspaper size={16} />Open the feed</Link>
        {me
          ? <Link to="/feed" className="secondary"><PenSquare size={16} />Write a post</Link>
          : <>
            <Link to="/register" className="secondary"><Users size={16} />Join free</Link>
            <Link to="/login" className="secondary"><LogIn size={16} />Log in</Link>
          </>}
      </div>
    </section>

    <FeedPreview />

    {/* The directory, introduced as the bonus it now is. */}
    <section className="space-y-4">
      <div className="rounded-xl bg-brand-surface p-5 ring-1 ring-brand-teal/30">
        <span className="eyebrow">AND ONCE YOU'RE HERE</span>
        <h2 className="mt-1 font-heading text-xl font-bold text-brand-ink sm:text-2xl">Use it as a resource too.</h2>
        <p className="mt-1 text-sm text-brand-body sm:text-base">Find a shul, a mikvah, a restaurant or a caterer from a directory of frum businesses and community resources.</p>
      </div>
      {/* Only a place someone picked fills the Where box; their own city just
          shapes the page below, so the search itself starts empty. */}
      <SearchPanel defaultLocation={chosen ? community : ''} />
      <div className="flex flex-wrap items-center gap-2">
        {quickLinks.map(({ label, q, count }) => <Link
          key={q}
          to={`/browse?q=${encodeURIComponent(q)}${community ? `&location=${encodeURIComponent(community)}` : ''}`}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold transition ${count > 0 || loadingListings ? 'bg-brand-tint text-brand-teal hover:ring-1 hover:ring-brand-teal' : 'text-brand-muted ring-1 ring-brand-line hover:text-brand-ink'}`}
        >{label}</Link>)}
      </div>
      <AddListingPrompt />
    </section>

    {/* Choosing a community here is remembered everywhere else on the site. */}
    {communities.length > 0 && <section>
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-ink"><MapPin size={15} className="text-brand-teal" />Community</span>
        {communities.map(({ city }) => <button
          key={city}
          type="button"
          onClick={() => setCommunity(city === community ? '' : city)}
          className={`rounded-full px-3 py-1.5 text-sm font-semibold transition ${city === community ? 'bg-brand-navy text-white' : 'bg-brand-surface text-brand-body ring-1 ring-brand-line hover:text-brand-ink'}`}
        >{city}</button>)}
        {community && <button type="button" onClick={() => setCommunity('')} className="text-sm font-medium text-brand-muted hover:text-brand-ink">Show everywhere</button>}
      </div>
    </section>}

    <LocalSection providers={providers} loading={loadingListings} community={community} showTimes={!timesOnTop} />

    <section>
      <div className="section-head">
        <div><span className="eyebrow">BROWSE</span><h2 className="title">Categories{community ? ` in ${community}` : ''}</h2></div>
        {categories.length > tiles.length && <Link to="/directory" className="text-sm font-semibold text-brand-teal">All {categories.length} categories</Link>}
      </div>
      {/* Until the listings arrive every tile would count zero and ask for
          "Add the first", so stand-in tiles shimmer instead. */}
      {loadingListings || loadingCategories ? <LoadingCards kind="tile" count={8} label={null} /> : <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {tiles.map((c) => {
          const Icon = iconFor(c.icon && c.icon !== 'MoreHorizontal' ? c.icon : guessIcon(c.name));
          const empty = c.count === 0;
          return <Link
            key={c.id || c.slug || c.name}
            to={empty ? `/add?category=${encodeURIComponent(c.name)}` : `/browse?category=${encodeURIComponent(c.name)}${community ? `&location=${encodeURIComponent(community)}` : ''}`}
            className={`group rounded-lg p-4 transition hover:-translate-y-0.5 hover:shadow-md ${empty ? 'border border-dashed border-brand-line bg-brand-canvas' : 'bg-brand-surface ring-1 ring-brand-line'}`}
          >
            <Icon className={`mb-3 ${empty ? 'text-brand-muted' : 'text-brand-teal'}`} size={22} />
            <span className={`block text-sm font-semibold leading-tight ${empty ? 'text-brand-body' : 'text-brand-ink'}`}>{categoryLabel(c.name)}</span>
            {empty && <span className="mt-1 block text-xs text-brand-muted">Add the first</span>}
          </Link>;
        })}
      </div>}
    </section>

    {/* The mission, and how the place works — below the useful part, not
        above it. Someone who needs a phone number should never have to read
        past a manifesto to reach the search box. */}
    <section className="grid gap-6 md:grid-cols-2">
      <div className="panel space-y-3">
        <Newspaper size={22} className="text-brand-teal" />
        <h2 className="font-heading text-xl font-bold text-brand-ink">Use it to connect</h2>
        <p className="leading-7 text-brand-body">Post updates, ask questions, share what you know and build a network inside the community.</p>
        <Link to="/feed" className="secondary inline-flex"><ArrowRight size={16} />Go to the feed</Link>
      </div>
      <div className="panel space-y-3">
        <MessageCircle size={22} className="text-brand-gold-ink" />
        <h2 className="font-heading text-xl font-bold text-brand-ink">Use it to be found</h2>
        <p className="leading-7 text-brand-body">Add your business or organization, keep it current, and answer the people asking for exactly what you do.</p>
        <Link to="/add" className="secondary inline-flex"><Plus size={16} />Add a listing</Link>
      </div>
    </section>

    <section className="rounded-xl bg-brand-canvas p-7 text-center ring-1 ring-brand-line md:p-10">
      <ShieldCheck size={26} className="mx-auto text-brand-teal" />
      <h2 className="mt-3 font-heading text-xl font-bold text-brand-ink">Built on trust, not reviews</h2>
      <p className="mx-auto mt-3 max-w-xl text-brand-body">No public negative reviews and no rating wars. Klal Connect shows community usage{vouchesOn ? ' and positive experiences' : ''}, and handles corrections privately — because a livelihood is on the other end of every listing.</p>
    </section>
  </div>;
}

// The top three posts in the feed's own order, as a taste of the feed. The full post, with its
// likes and comments, is one tap away.
function FeedPreview() {
  const { data: posts = [], isLoading } = useQuery({
    queryKey: ['feed', 'home-preview'],
    queryFn: () => api.entities.FeedPost.list('feed', 3),
  });
  return <section>
    <div className="section-head">
      <div><span className="eyebrow">KLAL FEED</span><h2 className="title">Trending now</h2></div>
      <Link to="/feed" className="text-sm font-semibold text-brand-teal">See the feed</Link>
    </div>
    {isLoading && <LoadingCards kind="post" count={3} label="Loading the latest posts…" />}
    {!isLoading && posts.length === 0 && <div className="empty"><p>Be the first to post to the Klal feed.</p><Link to="/feed" className="primary"><PenSquare size={16} />Write a post</Link></div>}
    <div className="space-y-3">
      {posts.slice(0, 3).map((p) => {
        const type = POST_TYPE_BY_ID[normalizePostType(p.post_type)];
        return <Link key={p.id} to={`/feed?post=${encodeURIComponent(p.id)}`} className="block rounded-xl bg-brand-surface p-4 ring-1 ring-brand-line transition hover:ring-brand-teal/50">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-tint font-bold text-brand-teal">{(p.author_name || '?').trim().charAt(0).toUpperCase()}</span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="truncate font-semibold text-brand-ink">{p.author_name || 'Member'}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${BADGE_TONES[type.tone]}`}>{type.badge}</span>
              </div>
              {(p.author_headline || postedAt(p)) && <p className="truncate text-xs text-brand-muted">{[p.author_headline, postedAt(p) && timeAgo(postedAt(p))].filter(Boolean).join(' · ')}</p>}
              {p.body && <p className="mt-2 line-clamp-3 text-sm leading-6 text-brand-body">{p.body}</p>}
              {/* A repost shows what it shares, not an empty card. */}
              {p.repost_of && <div className="mt-2 rounded-lg p-3 ring-1 ring-brand-line">
                {!p.repost_removed && <p className="truncate text-xs font-semibold text-brand-ink">{p.repost_author_name || 'Member'}</p>}
                {p.repost_removed ? <p className="mt-1 text-sm text-brand-muted">The original post is no longer available.</p> : p.repost_body && <p className="mt-1 line-clamp-3 text-sm leading-6 text-brand-body">{p.repost_body}</p>}
              </div>}
            </div>
          </div>
        </Link>;
      })}
    </div>
  </section>;
}

// The listings closest to the person, plus the times that govern the week
// there. Shabbos times belong here, attached to a place, rather than in a band
// across the top of the page: they matter enormously on Friday and not at all
// to someone looking for an exterminator on Tuesday.
//
// Only what is actually near: the nearest town's listings first, then the
// next towns over, and nothing past an hour's drive (see @/lib/nearby). With
// nothing that close the section is left out rather than filled with the
// Bahamas; with no idea where the person is, it offers to find out.
const byUse = (a, b) => (b.usage_count || 0) - (a.usage_count || 0) || String(b.created_date || '').localeCompare(String(a.created_date || ''));

// Thursday's sunset to the end of Friday, where the times are for (the server
// works the window out with the zmanim). A status saved before it sent the
// window falls back to the device's own Friday.
function useShabbosAtTop() {
  const { status } = useShabbosStatus();
  const now = Date.now();
  if (status?.pinFrom && status?.pinUntil) return now >= status.pinFrom && now < status.pinUntil;
  return new Date(now).getDay() === 5;
}

// City, candle lighting, Havdalah and the parsha in one strip. Nothing when
// there is no place to work from yet.
function ShabbosTimesBar({ className = '' }) {
  const { status } = useShabbosStatus();
  const times = status?.cityLabel && (status.startsAt || status.endsAt) ? status : null;
  if (!times) return null;
  return <div className={`flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg bg-brand-surface px-4 py-3 text-sm ring-1 ring-brand-line ${className}`}>
    <span className="font-semibold text-brand-ink">{times.cityLabel}</span>
    {times.startsAt && <span className="inline-flex items-center gap-1.5 text-brand-body"><Flame size={14} className="text-brand-gold-ink" />Candle lighting <b className="text-brand-ink">{timeInZone(times.startsAt, times.tzid)}</b></span>}
    {times.endsAt && <span className="inline-flex items-center gap-1.5 text-brand-body"><Moon size={14} className="text-brand-teal" />Havdalah <b className="text-brand-ink">{timeInZone(times.endsAt, times.tzid)}</b></span>}
    {times.parsha && <span className="text-brand-muted">{times.parsha}</span>}
  </div>;
}

function LocalSection({ providers, loading, community, showTimes = true }) {
  const { origin, where, ask } = useNearHere(providers, community);
  const near = useMemo(() => nearbyListings(providers, origin, { rank: byUse }), [providers, origin]);
  const shown = near.slice(0, 4);
  const timesBar = showTimes && <ShabbosTimesBar className="mb-4" />;

  if (!origin) return <div>{timesBar}<NearYouPrompt ask={ask} title="Help near you">Or pick a community above.</NearYouPrompt></div>;
  // Still loading: shimmer where the nearby cards will land, rather than
  // leaving a gap that then jumps open.
  if (loading) return <section>
    <div className="section-head"><div><span className="eyebrow">NEAR YOU</span><h2 className="title">Help {where ? `near ${where}` : 'near you'}</h2></div></div>
    {timesBar}
    <LoadingCards count={2} label="Finding listings near you…" />
  </section>;
  if (shown.length === 0) return timesBar || null;

  const browseHere = community ? `/browse?location=${encodeURIComponent(community)}`
    : `/browse?lat=${origin.lat}&lng=${origin.lng}`;
  return <section>
    <div className="section-head">
      <div>
        <span className="eyebrow">NEAR YOU</span>
        <h2 className="title">Help {where ? `near ${where}` : 'near you'}</h2>
        <p className="helper">Within about an hour's drive, closest first.</p>
      </div>
      {near.length > shown.length && <Link to={browseHere} className="text-sm font-semibold text-brand-teal">See more</Link>}
    </div>
    {timesBar}
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[repeat(2,minmax(0,1fr))]">{shown.map((p) => <ResourceCard key={p.id} provider={p} />)}</div>
  </section>;
}
