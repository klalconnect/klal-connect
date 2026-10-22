import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '@/api/client';
import SearchPanel from '@/components/SearchPanel';
import { Plus, ChevronRight } from 'lucide-react';
import AddListingPrompt from '@/components/AddListingPrompt';
import CategoryGrid from '@/components/CategoryGrid';
import ResourceCard from '@/components/ResourceCard';

export default function Directory(){
  const {data:categories=[]}=useQuery({queryKey:['categories'],queryFn:()=>api.entities.Category.list('order')});

  // Each rail is ranked over ALL published listings, not over a recency window.
  // Previously every rail was computed from the newest 30, so the moment there
  // were more than 30 listings the "most used" rail could only ever surface
  // recent ones — the ranking silently stopped ranking.
  const published={status:'published'};
  const {data:recent=[]}=useQuery({queryKey:['providers','recent'],
    queryFn:()=>api.entities.Provider.filter(published,'-created_date',3)});
  const {data:favorites=[]}=useQuery({queryKey:['providers','used'],
    queryFn:()=>api.entities.Provider.filter(published,'-usage_count',3)});
  const {data:featured=[]}=useQuery({queryKey:['providers','featured'],
    queryFn:()=>api.entities.Provider.filter({...published,featured:true},'-usage_count',3)});

  // Matched against the category list rather than a hardcoded label: the string
  // here read 'Gemachs & Free Resources' while the category is named 'Gemachim',
  // so this section was always empty.
  const gemachCategory=(categories.find(c=>/gemach/i.test(c.name))||{}).name;
  const {data:gemachs=[]}=useQuery({queryKey:['providers','gemach',gemachCategory],
    enabled:!!gemachCategory,
    queryFn:()=>api.entities.Provider.filter({...published,category:gemachCategory},'-created_date',3)});
  return <div className="page-shell space-y-12 py-10">
    <div><span className="eyebrow">RESOURCES</span><h1 className="title">Find trusted community resources</h1><p className="helper">Search the directory, browse categories, or explore what's new and popular near you.</p><div className="mt-5"><SearchPanel/></div><AddListingPrompt className="mt-4"/></div>

    <section>
      <div className="section-head"><div><span className="eyebrow">EXPLORE</span><h2 className="title">Popular categories</h2></div><Link to="/browse" className="text-sm font-semibold text-brand-teal">View all</Link></div>
      {/* Every category but "Other". The first twelve left Shuls and Insurance
          off the page, and "View all" is for listings, not headings. */}
      <CategoryGrid categories={categories.filter(c=>c.name!=='Other')}/>
    </section>

    {/* These three rails were mislabelled against their own queries: the
        featured:true rail was titled "Popular near you" while the rail ranked
        by usage was titled "Featured resources". With only a handful of
        listings all three also showed the same cards, which is where the
        "recently added vs featured" duplication came from. Each rail now
        carries the name of what it actually ranks, and one with nothing to
        rank does not appear at all. */}
    <ProviderSection title="Featured resources" items={featured}/>
    <ProviderSection title="Most used in the community" items={favorites.filter(p=>p.usage_count>0)}/>
    <ProviderSection title="Recently added" items={recent}/>

    {gemachs.length>0&&(
      <section>
        <div className="section-head"><div><span className="eyebrow">GEMACHS & FREE RESOURCES</span><h2 className="title">Find a Gemach near you</h2><p className="helper">Borrow what you need, or support an organization that gives to the community.</p></div><Link to={`/browse${gemachCategory?`?category=${encodeURIComponent(gemachCategory)}`:''}`} className="text-sm font-semibold text-brand-teal">Browse all gemachs</Link></div>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-[repeat(3,minmax(0,1fr))]">{gemachs.map(p=><ResourceCard key={p.id} provider={p}/>)}</div>
      </section>
    )}

    <section className="rounded-xl bg-brand-navy p-7 text-white md:flex md:items-center md:justify-between md:p-10">
      <div><h2 className="text-2xl font-bold">Is your business or resource missing?</h2><p className="mt-2 text-white/75">Add a community resource or claim your business listing — it's live the moment you post it.</p></div>
      {/* Same look as the "Add a listing" prompt under the search on Home: a
          teal plus in a pale pill, so the two ways in read as one button. */}
      <Link to="/add" className="group mt-5 inline-flex shrink-0 items-center gap-3 rounded-2xl bg-brand-tint py-2.5 pl-2.5 pr-4 font-bold text-brand-ink shadow-md ring-2 ring-brand-teal/40 transition hover:ring-brand-teal md:mt-0">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-teal text-white shadow-sm"><Plus size={20} strokeWidth={2.5} /></span>
        Add or claim a listing
        <ChevronRight size={18} className="shrink-0 text-brand-teal transition group-hover:translate-x-0.5" />
      </Link>
    </section>
  </div>;
}

function ProviderSection({ title, items }){
  // A heading with nothing under it reads as broken. Nothing is flagged
  // featured yet, so that rail simply does not appear until something is.
  if(!items || items.length===0) return null;
  return <section><div className="section-head"><h2 className="title">{title}</h2><Link to="/browse" className="text-sm font-semibold text-brand-teal">See more</Link></div><div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-[repeat(3,minmax(0,1fr))]">{items.map(p=><ResourceCard key={p.id} provider={p}/>)}</div></section>;
}