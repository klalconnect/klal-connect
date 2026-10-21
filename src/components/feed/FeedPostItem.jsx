import React,{useState} from 'react';
import { api } from '@/api/client';
import { Link } from 'react-router-dom';
import { MessageCircle, Eye, ThumbsUp, Repeat2, Loader2, CalendarClock, Pencil, Send, Trash2 } from 'lucide-react';
import FeedCommentList from '@/components/feed/FeedCommentList';
import FeedPostMenu, { ReportPostForm } from '@/components/feed/FeedPostMenu';
import FeedShareButton from '@/components/feed/FeedShare';
import Headline from '@/components/Headline';
import ReactionPicker, { useReactionPicker } from '@/components/feed/ReactionPicker';
import TranslateToggle from '@/components/TranslateToggle';
import { POST_TYPE_BY_ID, BADGE_TONES, normalizePostType } from '@/lib/postTypes';
import { isNewJob } from '@/lib/celebrations';
import { CelebrationBurst, CelebrationChoice, NewJobBanner, useCelebration } from '@/components/feed/Celebration';
import { REACTION_BY_ID, DEFAULT_REACTION, reactionOf, topReactions } from '@/lib/reactions';
import { timeAgo, fullDate } from '@/lib/time';
import { isScheduled, postedAt, scheduleLabel, toLocalInput } from '@/lib/scheduledPosts';
import { WorkStatusRing } from '@/components/WorkStatus';

// The author's initials, in their photo ribbon's colour when they have one
// on (the server adds author_work_status as it is now). Too small for the
// ribbon's words, so just the frame.
function AuthorAvatar({ post }) {
  return <WorkStatusRing user={{ work_status: post.author_work_status }} thickness={5} ribbon={false} className="shrink-0">
    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand-tint text-sm font-bold text-brand-teal ring-2 ring-brand-surface">{(post.author_name||'KC').split(' ').map(x=>x[0]).slice(0,2).join('')}</div>
  </WorkStatusRing>;
}

// The post a repost carries, as it was when it was reposted.
function RepostedCard({ post }) {
  if(post.repost_removed) return <p className="rounded-lg bg-brand-tint px-4 py-3 text-sm text-brand-muted">The original post is no longer available.</p>;
  const when=timeAgo(post.repost_created_date);
  return <Link to={`/feed?post=${encodeURIComponent(post.repost_of)}`} className="block space-y-2 rounded-lg p-3 ring-1 ring-brand-line transition hover:bg-brand-tint">
    <div className="flex items-start gap-2.5">
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-tint text-xs font-bold text-brand-teal">{(post.repost_author_name||'KC').split(' ').map(x=>x[0]).slice(0,2).join('')}</div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-brand-ink">{post.repost_author_name||'Community member'}{when&&<span className="font-normal text-brand-muted"> · {when}</span>}</p>
        <Headline text={post.repost_author_headline}/>
      </div>
    </div>
    {post.repost_body&&<p className="line-clamp-6 whitespace-pre-line text-sm leading-6 text-brand-body">{post.repost_body}</p>}
    {post.repost_image_urls?.length>0&&<div className="grid gap-2 sm:grid-cols-2">{post.repost_image_urls.map(u=><img key={u} src={u} className="rounded-lg ring-1 ring-brand-line"/>)}</div>}
  </Link>;
}

// Repost: share it to the feed as it is, or with a few words of your own.
function RepostButton({ post, className, onReposted }) {
  const [open,setOpen]=useState(false),[writing,setWriting]=useState(false),[text,setText]=useState(''),[busy,setBusy]=useState(false),[err,setErr]=useState(''),[done,setDone]=useState(false);
  const ref=React.useRef(null);
  React.useEffect(()=>{
    if(!open)return;
    const onDown=e=>{ if(ref.current&&!ref.current.contains(e.target)) setOpen(false); };
    const onKey=e=>{ if(e.key==='Escape') setOpen(false); };
    document.addEventListener('pointerdown',onDown); document.addEventListener('keydown',onKey);
    return ()=>{ document.removeEventListener('pointerdown',onDown); document.removeEventListener('keydown',onKey); };
  },[open]);
  const send=async(body='')=>{
    if(!(await api.auth.requireAccount())){ setOpen(false); return; }
    setBusy(true);
    const r=await api.functions.invoke('repostPost',{post_id:post.repost_of||post.id,body});
    setBusy(false);
    if(r.status>=400){ setErr(r.data?.error||'Could not repost'); return; }
    setErr(''); setOpen(false); setWriting(false); setText(''); setDone(true);
    onReposted?.();
  };
  const item='flex w-full items-start gap-2.5 px-3 py-2 text-left text-sm text-brand-body hover:bg-brand-tint hover:text-brand-ink focus:bg-brand-tint focus:outline-none';
  return <>
    <div ref={ref} className="relative flex flex-1 sm:flex-none">
      <button type="button" onClick={()=>{ setErr(''); setOpen(o=>!o); }} aria-haspopup="menu" aria-expanded={open} className={`${className} w-full ${done?'text-brand-teal':''}`}><Repeat2 size={17}/>{done?'Reposted':'Repost'}</button>
      {open&&<div role="menu" aria-label="Repost" className="absolute bottom-full left-1/2 z-30 mb-2 w-64 -translate-x-1/2 overflow-hidden rounded-lg bg-brand-surface py-1 shadow-lg ring-1 ring-brand-line">
        <button type="button" role="menuitem" disabled={busy} onClick={()=>send()} className={item}><Repeat2 size={16} className="mt-0.5 shrink-0"/><span><span className="block font-semibold text-brand-ink">Repost</span><span className="text-xs text-brand-muted">Share it to the feed as it is</span></span></button>
        <button type="button" role="menuitem" onClick={async()=>{ setOpen(false); if(await api.auth.requireAccount()) setWriting(true); }} className={item}><MessageCircle size={16} className="mt-0.5 shrink-0"/><span><span className="block font-semibold text-brand-ink">Repost with your thoughts</span><span className="text-xs text-brand-muted">Add a few words above it</span></span></button>
        {err&&<p className="px-3 py-1.5 text-xs font-semibold text-brand-error">{err}</p>}
      </div>}
    </div>
    {writing&&<form onSubmit={e=>{e.preventDefault();send(text);}} className="order-last basis-full space-y-2 pt-2">
      <textarea value={text} onChange={e=>setText(e.target.value)} autoFocus maxLength={5000} placeholder="What do you think about this?" className="min-h-16 w-full resize-none rounded-lg border border-brand-line bg-brand-canvas px-4 py-3 text-sm outline-none focus:border-[#0D6B66]"/>
      {err&&<p className="text-xs font-semibold text-brand-error">{err}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={()=>{ setWriting(false); setText(''); setErr(''); }} className="secondary py-2">Cancel</button>
        <button type="submit" disabled={busy} className="primary py-2">{busy?<Loader2 size={15} className="animate-spin"/>:<Repeat2 size={15}/>}Repost</button>
      </div>
    </form>}
  </>;
}

// A post its author scheduled, before it goes live. Only the author ever gets
// this card (the server shows the post to nobody else), so it carries their
// controls instead of likes and comments: change it, post it now, or cancel.
function ScheduledPostItem({ post, onChanged, onDeleted }) {
  const type=POST_TYPE_BY_ID[normalizePostType(post.post_type)];
  const [editing,setEditing]=useState(false),[text,setText]=useState(post.body||''),[when,setWhen]=useState(toLocalInput(post.publish_at)),[busy,setBusy]=useState(''),[err,setErr]=useState('');
  const change=async(payload,what)=>{
    setBusy(what); setErr('');
    const r=await api.functions.invoke('updateScheduledPost',{post_id:post.id,...payload});
    setBusy('');
    if(r.status>=400){ setErr(r.data?.error||'Could not save'); return false; }
    onChanged?.(r.data.post); return true;
  };
  const save=async e=>{
    e.preventDefault();
    const t=new Date(when);
    if(Number.isNaN(t.getTime())){ setErr('Pick a date and time for your post.'); return; }
    if(await change({body:text,publish_at:t.toISOString()},'save')) setEditing(false);
  };
  const cancel=async()=>{
    if(!window.confirm('Cancel this scheduled post? It will be deleted and never go live.'))return;
    setBusy('cancel'); setErr('');
    const r=await api.functions.invoke('deletePost',{post_id:post.id});
    setBusy('');
    if(r.status>=400){ setErr(r.data?.error||'Could not cancel'); return; }
    onDeleted?.(post.id);
  };
  const btn='flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold ring-1 ring-brand-line hover:bg-brand-tint disabled:opacity-50';
  return <article className="panel space-y-3">
    <div className="flex items-start gap-2.5 rounded-lg bg-brand-tint px-3 py-2.5">
      <CalendarClock size={18} className="mt-0.5 shrink-0 text-brand-teal"/>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-brand-ink">Scheduled for {scheduleLabel(post.publish_at)}</p>
        <p className="text-xs text-brand-muted">Only you can see this until then.</p>
      </div>
    </div>
    <div className="flex items-start gap-3">
      <AuthorAvatar post={post}/>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="truncate font-semibold text-brand-ink">{post.author_name||'Community member'}</p>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${BADGE_TONES[type.tone]}`}>{type.badge}</span>
        </div>
        <Headline text={post.author_headline}/>
      </div>
    </div>
    {editing?<form onSubmit={save} className="space-y-2">
      <textarea value={text} onChange={e=>setText(e.target.value)} maxLength={5000} aria-label="Post text" className="min-h-24 w-full resize-none rounded-lg border border-brand-line bg-brand-canvas px-4 py-3 text-sm outline-none focus:border-[#0D6B66]"/>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`when-${post.id}`} className="text-sm font-semibold text-brand-ink">Goes live</label>
        <input id={`when-${post.id}`} type="datetime-local" value={when} min={toLocalInput(new Date())} onChange={e=>setWhen(e.target.value)} className="min-w-0 rounded-lg border border-brand-line bg-brand-canvas px-3 py-1.5 text-sm text-brand-ink outline-none focus:border-[#0D6B66]"/>
      </div>
      {err&&<p className="text-xs font-semibold text-brand-error">{err}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={()=>{ setEditing(false); setText(post.body||''); setWhen(toLocalInput(post.publish_at)); setErr(''); }} className="secondary py-2">Cancel</button>
        <button type="submit" disabled={!!busy} className="primary py-2">{busy==='save'&&<Loader2 size={15} className="animate-spin"/>}Save changes</button>
      </div>
    </form>:<>
      {post.body&&<p className="whitespace-pre-line leading-7 text-brand-body">{post.body}</p>}
      {post.image_urls?.length>0&&<div className="grid gap-2 sm:grid-cols-2">{post.image_urls.map(u=><img key={u} src={u} className="rounded-lg ring-1 ring-brand-line"/>)}</div>}
      <div className="flex flex-wrap items-center gap-2 border-t pt-3 text-brand-body">
        <button type="button" onClick={()=>setEditing(true)} disabled={!!busy} className={btn}><Pencil size={14}/>Edit</button>
        <button type="button" onClick={()=>change({post_now:true},'now')} disabled={!!busy} className={btn}>{busy==='now'?<Loader2 size={14} className="animate-spin"/>:<Send size={14}/>}Post now</button>
        <button type="button" onClick={cancel} disabled={!!busy} className={`${btn} text-brand-error`}>{busy==='cancel'?<Loader2 size={14} className="animate-spin"/>:<Trash2 size={14}/>}Cancel post</button>
      </div>
      {err&&<p className="text-xs font-semibold text-brand-error">{err}</p>}
    </>}
  </article>;
}

// A scheduled post shows its author the card above until its time comes, then
// turns into an ordinary post on the page without a reload.
export default function FeedPostItem(props) {
  const [post,setPost]=useState(props.post);
  React.useEffect(()=>{ setPost(props.post); },[props.post]);
  const [,tick]=useState(0);
  React.useEffect(()=>{
    if(!isScheduled(post))return;
    const wait=Date.parse(post.publish_at)-Date.now();
    // setTimeout cannot wait longer than about 24 days; a post further off
    // than a day is checked again on the next visit.
    if(wait>86_400_000)return;
    const t=setTimeout(()=>tick(n=>n+1),wait+500);
    return ()=>clearTimeout(t);
  },[post]);
  if(isScheduled(post)) return <ScheduledPostItem post={post} onChanged={setPost} onDeleted={props.onDeleted}/>;
  return <LivePostItem {...props} post={post} onChanged={setPost}/>;
}

// The animation picker the author of a new-job post opens from the ••• menu.
function CelebrationPicker({ post, onPicked, onChanged }) {
  const [busy,setBusy]=useState(false),[err,setErr]=useState('');
  const set=async(patch)=>{
    setBusy(true); setErr('');
    const r=await api.functions.invoke('setPostCelebration',{post_id:post.id,...patch});
    setBusy(false);
    if(r.status>=400){ setErr(r.data?.error||'Could not save'); return; }
    onChanged?.(r.data.post); onPicked?.();
  };
  return <div className="space-y-2 rounded-lg bg-brand-tint p-3">
    <p className="text-xs font-semibold text-brand-ink">Pick the animation everyone sees</p>
    <CelebrationChoice value={post.celebration} onChange={c=>!busy&&set({celebration:c})}/>
    {err&&<p className="text-xs font-semibold text-brand-error">{err}</p>}
  </div>;
}

function LivePostItem({ post, user, onDeleted, onReposted, onChanged }) {
  const type=POST_TYPE_BY_ID[normalizePostType(post.post_type)];
  const isAsk=type.id==='question';
  const [mine,setMine]=useState(null),[likes,setLikes]=useState(post.like_count||0),[counts,setCounts]=useState(post.reaction_counts||{}),[showComments,setShowComments]=useState(false),[cc,setCc]=useState(post.comment_count||0),[likeErr,setLikeErr]=useState(''),[helpfulId,setHelpfulId]=useState(post.helpful_comment_id||null),[reporting,setReporting]=useState(false);
  const [translate,setTranslate]=useState({enabled:false,languages:[]});
  const views=post.view_count||0;
  const picker=useReactionPicker();
  // A new-job post that celebrates plays its animation as it scrolls into
  // view, and again on its sparkle button.
  const card=React.useRef(null);
  const party=isNewJob(post);
  const {play,replay}=useCelebration(card,party);
  const [pickingCelebration,setPickingCelebration]=useState(false);
  React.useEffect(()=>{api.getConfig().then(c=>setTranslate({enabled:!!c.translateEnabled&&!!user&&!user.guest,languages:c.translateLanguages||[]})).catch(()=>{});},[user]);
  // These four are seeded from props into state, and posts are keyed by id —
  // so a refetch remounts nothing and the counts froze at whatever they were
  // on first render, drifting from the server for the life of the page. Kept
  // in step with the server values here. Reactions are excluded on purpose:
  // `mine` is the viewer's own and is loaded from FeedLike below, so it is
  // never clobbered by an incoming prop.
  React.useEffect(()=>{setLikes(post.like_count||0);setCounts(post.reaction_counts||{});},[post.like_count,post.reaction_counts]);
  React.useEffect(()=>{setCc(post.comment_count||0);},[post.comment_count]);
  React.useEffect(()=>{setHelpfulId(post.helpful_comment_id||null);},[post.helpful_comment_id]);
  React.useEffect(()=>{(async()=>{if(user&&!user.guest){const rows=await api.entities.FeedLike.filter({post_id:post.id});const own=rows.find(r=>r.created_by_id===user.id);setMine(own?reactionOf(own):null);}})();},[post.id,user]);
  // Recording a view returns nothing: the count is the author's, and the
  // author never records one.
  React.useEffect(()=>{if(user&&!user.guest&&post.created_by_id!==user.id){api.functions.invoke('recordPostView',{postId:post.id}).catch(()=>{});}},[post.id,user]);

  const react=async(reaction)=>{
    picker.close();
    if(!(await api.auth.requireAccount()))return;
    const r=await api.functions.invoke('toggleLike',{post_id:post.id,reaction});
    if(r.status>=400){setLikeErr(r.data?.error||'Action unavailable');return;}
    setLikeErr('');if(r.data){setMine(r.data.reaction);setLikes(r.data.like_count);setCounts(r.data.reaction_counts||{});}
  };
  // A plain tap gives a like, or takes back whatever reaction is there.
  const tap=()=>{ if(picker.consumedByPress())return; react(mine||DEFAULT_REACTION); };

  const current=mine?REACTION_BY_ID[mine]:null;
  const top=topReactions(counts);
  // Reactions recorded before the breakdown existed show as plain likes.
  const stack=top.length?top:(likes>0?[REACTION_BY_ID[DEFAULT_REACTION]]:[]);
  // The author sees how many people saw it; nobody else does, and the shared
  // guest session is nobody.
  const isOwn=!!user&&!user.guest&&post.created_by_id===user.id;
  const showViews=isOwn;
  const when=timeAgo(postedAt(post));
  const isRepost=!!post.repost_of;
  // Reposting your own post is just sharing it; the Share button does that.
  const canRepost=!(user&&!user.guest&&(isRepost?post.repost_author_id:post.created_by_id)===user.id);
  const reposts=post.repost_count||0;
  const action='flex flex-1 flex-col items-center justify-center gap-1 rounded-lg px-1 py-1.5 text-xs font-semibold hover:bg-brand-tint sm:flex-none sm:flex-row sm:gap-1.5 sm:px-3 sm:text-sm';

  return <article ref={card} className="panel relative space-y-3">
    {party&&play>0&&<CelebrationBurst key={play} kind={post.celebration} seed={`${post.id}:${play}`}/>}
    <div className="flex items-start gap-3">
      <AuthorAvatar post={post}/>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="truncate font-semibold text-brand-ink">{post.author_name||'Community member'}{isRepost&&<span className="font-normal text-brand-muted"> reposted</span>}</p>
          {when&&<time dateTime={postedAt(post)} title={fullDate(postedAt(post))} className="text-xs text-brand-muted">· {when}</time>}
          {!isRepost&&<span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${BADGE_TONES[type.tone]}`}>{type.badge}</span>}
          {isAsk&&helpfulId&&<span className="rounded-full bg-brand-tint px-2 py-0.5 text-[10px] font-bold text-brand-teal">Answered ✓</span>}
        </div>
        <Headline text={post.author_headline}/>
        {post.business_name&&<p className="text-xs font-medium text-[#0D6B66]">{post.business_name}</p>}
      </div>
      <FeedPostMenu post={post} user={user} onReport={()=>setReporting(true)} onDeleted={onDeleted} onPickCelebration={()=>setPickingCelebration(true)}/>
    </div>
    {party&&<NewJobBanner post={post} own={isOwn} mine={mine} onReplay={replay} onMazelTov={()=>react('mazel_tov')}/>}
    {isOwn&&party&&pickingCelebration&&<CelebrationPicker post={post} onPicked={()=>setPickingCelebration(false)} onChanged={onChanged}/>}
    {post.body&&<p className="whitespace-pre-line leading-7 text-brand-body">{post.body}</p>}
    {post.body&&<TranslateToggle text={post.body} enabled={translate.enabled} languages={translate.languages}/>}
    {isRepost&&<RepostedCard post={post}/>}
    {post.image_urls?.length>0&&<div className="grid gap-2 sm:grid-cols-2">{post.image_urls.map(u=><img key={u} src={u} className="rounded-lg ring-1 ring-brand-line"/>)}</div>}
    {reporting&&<ReportPostForm post={post} onClose={()=>setReporting(false)}/>}
    {(likes>0||cc>0||reposts>0||showViews)&&<div className="flex items-center gap-3 text-xs text-brand-muted">
      {likes>0&&<span className="flex items-center gap-1"><span className="flex -space-x-1">{stack.map(r=><span key={r.id} className="grid h-5 w-5 place-items-center rounded-full bg-brand-surface text-[13px] ring-1 ring-brand-line" title={r.label}>{r.emoji}</span>)}</span>{likes}</span>}
      {cc>0&&<span>{cc} {isAsk?(cc===1?'answer':'answers'):(cc===1?'comment':'comments')}</span>}
      {reposts>0&&<span>{reposts} {reposts===1?'repost':'reposts'}</span>}
      {showViews&&<span className="ml-auto flex items-center gap-1"><Eye size={14}/>{views} {views===1?'view':'views'}</span>}
    </div>}
    <div className="flex flex-wrap items-center gap-1 border-t pt-3 text-sm text-brand-body">
      <div className="relative flex flex-1 sm:flex-none" {...picker.hoverProps}>
        <ReactionPicker open={picker.open} current={mine} onPick={react} className="bottom-full left-0 mb-2"/>
        <button type="button" {...picker.pressProps} onClick={tap} aria-label={current?`You reacted ${current.label}. Tap to remove, hold to change.`:'Like. Hold to choose a reaction.'} className={`${action} w-full ${current?'text-brand-teal':''}`}>
          {current?<span className="text-base leading-none">{current.emoji}</span>:<ThumbsUp size={17}/>}{current?current.label:'Like'}
        </button>
      </div>
      <button onClick={()=>setShowComments(s=>!s)} className={`${action} ${isAsk?'text-brand-teal':''}`}><MessageCircle size={17}/>{isAsk?(helpfulId?'Answers':'Answer'):'Comment'}</button>
      {canRepost&&<RepostButton post={post} className={action} onReposted={onReposted}/>}
      <FeedShareButton post={post} className={`${action} w-full`}/>
      {likeErr&&<span className="basis-full text-xs font-semibold text-brand-error sm:ml-auto sm:basis-auto">{likeErr}</span>}
    </div>
    {showComments&&<FeedCommentList postId={post.id} user={user} authorId={post.created_by_id} isAsk={isAsk} helpfulId={helpfulId} onHelpful={setHelpfulId} onCount={n=>setCc(n)}/>}
  </article>;
}
