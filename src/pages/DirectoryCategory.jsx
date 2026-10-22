import React from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, SlidersHorizontal } from 'lucide-react';
import { api } from '@/api/client';
import { slugify } from '@/lib/paths';
import ResourceCard from '@/components/ResourceCard';
import { jewishOwnedFirst } from '@/lib/ownership';
import { useMetaTags } from '@/hooks/useMetaTags';
import { categoryLabel } from '@/lib/categories';

// The client-side twin of the /directory/:category(/:city) prerender in
// server/seo.js — same slug parsing, same filtering. Without this route a
// crawler saw a real page (title, JSON-LD, listings) and a real visitor's
// browser saw "not found" the instant React mounted, because there was no
// client route to match the URL the server had just rendered.
export default function DirectoryCategory() {
  const { category, city } = useParams();
  const { data: categories = [], isLoading: loadingCategories } = useQuery({ queryKey: ['categories'], queryFn: () => api.entities.Category.list('order') });
  // Not filter({status:'published'}): the prerender counts a row with no
  // status at all as published (server/seo.js isPublished, and
  // moderationVisible in server/app.js agree), so an exact-equality query
  // here would drop legacy rows the server had just listed in the HTML and
  // the JSON-LD — the page would prerender listings and hydrate to "none".
  const { data: providers = [], isLoading: loadingProviders } = useQuery({ queryKey: ['providers', 'visible'], queryFn: () => api.entities.Provider.list() });

  const match = categories.find((c) => slugify(c.name) === category);
  const cityName = city ? city.replace(/-/g, ' ') : '';
  const where = cityName ? ` in ${cityName.replace(/\b\w/g, (m) => m.toUpperCase())}` : '';

  // Compared as slugs. slugify('Brooklyn, NY') is 'brooklyn-ny', and turning
  // dashes back into spaces can never restore the comma — so un-slugging and
  // matching on text meant the sitemap advertised URLs that matched nothing.
  const rows = match
    ? jewishOwnedFirst(providers.filter((p) => (p.status === 'published' || p.status === undefined)
        && (p.category || '').toLowerCase() === match.name.toLowerCase()
        && (!city || slugify(p.city || '') === city)))
    : [];

  useMetaTags(match ? {
    title: `${categoryLabel(match.name)}${where} · Klal Connect`,
    description: `${categoryLabel(match.name)}${where} — ${rows.length} ${rows.length === 1 ? 'listing' : 'listings'} in the Klal Connect community directory.`,
  } : {});

  if (!loadingCategories && categories.length && !match) {
    return <div className="page-shell py-10">
      <div className="empty"><SlidersHorizontal/><p>That category doesn't exist.</p><Link to="/directory" className="primary">Back to the directory</Link></div>
    </div>;
  }

  return <div className="page-shell space-y-8 py-10">
    <Link to="/directory" className="flex items-center gap-2 text-sm font-semibold text-brand-teal"><ArrowLeft size={16}/>All categories</Link>
    <div>
      <span className="eyebrow">DIRECTORY</span>
      <h1 className="title">{match ? `${categoryLabel(match.name)}${where}` : 'Loading…'}</h1>
      <p className="helper">{loadingProviders ? 'Loading…' : `${rows.length} ${rows.length === 1 ? 'listing' : 'listings'} in the Klal Connect community directory.`}</p>
    </div>
    {rows.length > 0
      ? <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-[repeat(2,minmax(0,1fr))] lg:grid-cols-[repeat(3,minmax(0,1fr))]">{rows.map((p) => <ResourceCard key={p.id} provider={p}/>)}</div>
      : !loadingProviders && <div className="empty"><SlidersHorizontal/><p>No listings here yet.</p><Link to="/add" className="primary">Add the first listing</Link></div>}
  </div>;
}
