import React,{useEffect,useRef,useState} from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '@/api/client';
import FeedComposer from '@/components/feed/FeedComposer';
import FeedPostItem from '@/components/feed/FeedPostItem';
import FeedPromotedPanel from '@/components/feed/FeedPromotedPanel';
import FeedPeoplePanel from '@/components/feed/FeedPeoplePanel';
import { FEED_FILTERS, matchesFilter } from '@/lib/postTypes';

const PAGE=50;

export default function Feed(){
  const [posts,setPosts]=useState(null),[user,setUser]=useState(null),[loading,setLoading]=useState(true),[filter,setFilter]=useState('all');
  // ?post=<id> — a shared or saved link — shows that one post on its own.
  const [params,setParams]=useSearchParams();
  const postId=params.get('post');
  // ?ask=<text> — a search that came up empty, prefilled as an ask so the
  // question reaches the people who can answer it instead of dying on a
  // "no results" page.
  const ask=params.get('ask')||'';
  // A shared link shows its post whatever filter chip was left selected.
  const visible=posts?.filter(p=>postId||matchesFilter(p,filter));
  // Loads are numbered so that one still in flight when the next starts
  // (Show all posts clicked mid-load, say) cannot land on top of it.
  const run=useRef(0);
  // How many posts to fetch: a page more each time Show more posts is tapped.
  const shown=useRef(PAGE);
  const [more,setMore]=useState(false);
  const load=(quiet)=>{
    const mine=++run.current;
    if(!quiet)setLoading(true);
    const fetching=postId?api.entities.FeedPost.get(postId).then(p=>[p]).catch(()=>[]):api.entities.FeedPost.list('feed',shown.current);
    return fetching.then(rows=>{ if(run.current===mine){ setPosts(rows); setMore(!postId&&rows.length>=shown.current); setLoading(false); } });
  };
  const showMore=()=>{ shown.current+=PAGE; setMore(false); load(true); };
  useEffect(()=>{setPosts(null);setLoading(true);shown.current=PAGE;const mine=++run.current;(async()=>{if(await api.auth.isAuthenticated()){try{const u=await api.auth.me();if(run.current===mine)setUser(u);}catch{}}if(run.current===mine)load();})();},[postId]);
  const removed=id=>setPosts(ps=>ps?.filter(p=>p.id!==id));
  return <div className="page-shell py-4 md:py-7">
    <div className="mb-3 md:mb-5"><span className="eyebrow">KLAL FEED</span><h1 className="title">Community business feed</h1><p className="helper hidden sm:block">Post updates, promote your business, ask the klal, and find what's happening near you.</p></div>
    {/* grid-cols-[minmax(0,1fr)] is load-bearing on a phone: a grid item's
        default min-width is auto, so the single column grew to fit the widest
        thing inside it — the filter chips — and dragged the whole page past
        the edge of the screen. */}
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="mx-auto w-full min-w-0 max-w-2xl space-y-4 md:space-y-5">
        {ask&&<p className="rounded-lg bg-brand-tint p-3 text-sm text-brand-body">Nobody has added that to the directory yet — ask the klal, and the answer becomes a listing the next person finds.</p>}
        <FeedComposer onPosted={()=>{if(postId||ask)setParams({});load();}} user={user} initialBody={ask} initialType={ask?'question':''}/>
        {postId
          ?<div className="flex flex-wrap items-center justify-between gap-2 text-sm"><span className="text-brand-muted">Showing one post</span><Link to="/feed" className="font-semibold text-brand-teal hover:underline">Show all posts</Link></div>
          :<div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:flex-wrap sm:overflow-visible">{FEED_FILTERS.map(f=><button key={f.id} type="button" onClick={()=>setFilter(f.id)} className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition ${filter===f.id?'bg-brand-navy text-white':'bg-brand-surface text-brand-body ring-1 ring-brand-line hover:text-brand-ink'}`}>{f.label}</button>)}</div>}
        {loading&&<div className="loading">Loading feed…</div>}
        {!loading&&posts?.length===0&&<div className="empty"><p>{postId?'That post is no longer available.':'Be the first to post to the Klal feed.'}</p>{postId&&<Link to="/feed" className="text-sm font-semibold text-brand-teal hover:underline">Show all posts</Link>}</div>}
        {!loading&&posts?.length>0&&visible?.length===0&&<div className="empty"><p>{filter==='unanswered'?'Every ask has an answer. Nice work, klal.':'Nothing here yet — try another filter.'}</p></div>}
        {visible?.map(p=><FeedPostItem key={p.id} post={p} user={user} onDeleted={removed} onReposted={()=>{if(postId)setParams({});load();}}/>)}
        {more&&<button type="button" onClick={showMore} className="secondary w-full justify-center">Show more posts</button>}
      </div>
      <aside className="hidden space-y-5 lg:block">
        <FeedPromotedPanel/>
        <FeedPeoplePanel/>
      </aside>
    </div>
  </div>;
}
