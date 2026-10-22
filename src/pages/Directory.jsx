import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '@/api/client';
import SearchPanel from '@/components/SearchPanel';
import { Plus, ChevronRight } from 'lucide-react';
import AddListingPrompt from '@/components/AddListingPrompt';
import CategoryGrid from '@/components/CategoryGrid';
import ResourceCard from '@/components/ResourceCard';
import NearYouPrompt from '@/components/NearYouPrompt';
import useNearHere from '@/hooks/useNearHere';
import { nearbyListings } from '@/lib/nearby';
import { ownershipRank } from '@/lib/ownership';
import { readStoredCommunity } from '@/lib/community';

export default function Directory(){
  const {data:categories=[]}=useQuery({queryKey:['categories'],queryFn:()=>api.entities.Category.list('order')});
  // The same list Home and the search box load, so it is usually cached.
  const {data:providers=[]}=useQuery({queryKey:['providers','all'],
    queryFn:()=>api.entities.Provider.filter({status:'published'})});

  // Every rail is "near you": ranked over the listings within an hour's drive
  // of the person, nearest town first (see @/lib/nearby). They used to rank
  // the whole site, so Brooklyn was shown the Bahamas. A rail with nothing
  // that close is left out, and with no idea where the person is the rails
  // give way to one "Use my location" prompt. A Home community chip, if one
  // was picked this visit, counts as where they are.
  const {origin,where,ask}=useNearHere(providers,readStoredCommunity());
  const near=useMemo(()=>nearbyListings(providers,origin),[providers,origin]);

  // Matched against the category list rather than a hardcoded label: the string
  // here read 'Gemachs & Free Resources' while the category is named 'Gemachim',
  // so this section was always empty.
  const gemachCategory=(categories.find(c=>/gemach/i.test(c.name))||{}).name;

  // Each listing appears in one rail only, so a handful of local listings do
  // not fill all three with the same cards.
  const rails=useMemo(()=>{
    const used=new Set();
    const pick=(rows,rank)=>{
      const out=rows.filter(p=>!used.has(p.id));
      const top=rank?nearbyFirst(out,rank):out;
      const chosen=top.slice(0,3);
      chosen.forEach(p=>used.add(p.id));
      return chosen;
    };
    const gemachs=pick(near.filter(p=>gemachCategory&&p.category===gemachCategory));
    return {
      featured:pick(near.filter(p=>p.featured)),
      favorites:pick(near.filter(p=>p.usage_count>0),(a,b)=>(b.usage_count||0)-(a.usage_count||0)),
      recent:pick(near,(a,b)=>String(b.created_date||'').localeCompare(String(a.created_date||''))),
      gemachs,
    };
  },[near,gemachCategory]);
  const {featured,favorites,recent,gemachs}=rails;
  const here=where?` near ${where}`:' near you';
  const browseNear=!origin?'':where?`?location=${encodeURIComponent(where)}`:`?lat=${origin.lat}&lng=${origin.lng}`;
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
    {!origin&&providers.length>0&&<NearYouPrompt ask={ask} title="Featured, popular and new near you"/>}
    <ProviderSection title={`Featured${here}`} items={featured} more={`/browse${browseNear}`}/>
    <ProviderSection title={`Most used${here}`} items={favorites} more={`/browse${browseNear}`}/>
    <ProviderSection title={`Recently added${here}`} items={recent} more={`/browse${browseNear}`}/>

    {gemachs.length>0&&(
      <section>
        <div className="section-head"><div><span className="eyebrow">GEMACHS & FREE RESOURCES</span><h2 className="title">Find a Gemach{here}</h2><p className="helper">Borrow what you need, or support an organization that gives to the community.</p></div><Link to={`/browse${browseNear||'?'}${browseNear?'&':''}category=${encodeURIComponent(gemachCategory)}`} className="text-sm font-semibold text-brand-teal">Browse gemachs</Link></div>
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

// Nearest towns first, `rank` deciding within each: the three best of the
// closest few towns, not the three most used anywhere within the hour.
// Jewish-owned ones come first among those.
function nearbyFirst(rows,rank){
  const nearest=rows.slice(0,12);
  return [...nearest].sort((a,b)=>ownershipRank(a,b)||rank(a,b)).concat(rows.slice(12));
}

function ProviderSection({ title, items, more='/browse' }){
  // A heading with nothing under it reads as broken. Nothing is flagged
  // featured yet, so that rail simply does not appear until something is.
  if(!items || items.length===0) return null;
  return <section><div className="section-head"><h2 className="title">{title}</h2><Link to={more} className="text-sm font-semibold text-brand-teal">See more</Link></div><div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-[repeat(3,minmax(0,1fr))]">{items.map(p=><ResourceCard key={p.id} provider={p}/>)}</div></section>;
}