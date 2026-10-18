import React,{useEffect,useState} from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api/client';
import { Send, ChevronUp, CheckCircle2 } from 'lucide-react';
import Headline from '@/components/Headline';
import TranslateToggle from '@/components/TranslateToggle';
import { timeAgo, fullDate } from '@/lib/time';

// An answer to "who does X?" is often just a name and a number — "Moshe Green
// Plumbing, 555-0134" — which is a good first guess at a listing name. A
// paragraph is not, and pasting one into the name field would be worse than
// leaving it empty, so prose is left alone.
const nameGuess = (body) => {
  const line = String(body || '').trim().split('\n')[0].trim();
  const words = line.split(/\s+/).length;
  return line && line.length <= 48 && words <= 7 && !/[.!?]$/.test(line) ? line : '';
};

// Comments under a post. Under an ask they are answers: each can be upvoted
// by anyone but its author, and the person who asked can mark one as the one
// that helped — it moves to the top with a gold mark, and the answerer hears.
export default function FeedCommentList({ postId, user, authorId, isAsk, helpfulId, onHelpful, onCount }) {
  const [comments,setComments]=useState([]),[text,setText]=useState(''),[busy,setBusy]=useState(false),[err,setErr]=useState(''),[myVotes,setMyVotes]=useState(new Set());
  const [translate,setTranslate]=useState({enabled:false,languages:[]});
  const load=()=>api.entities.Comment.filter({post_id:postId},'-created_date').then(c=>{setComments(c);onCount?.(c.length);});
  useEffect(()=>{load();},[postId]);
  useEffect(()=>{(async()=>{if(!isAsk||!user||user.guest)return;try{const v=await api.entities.CommentVote.filter({post_id:postId});setMyVotes(new Set(v.map(x=>x.comment_id)));}catch{}})();},[postId,isAsk,user]);
  useEffect(()=>{api.getConfig().then(c=>setTranslate({enabled:!!c.translateEnabled&&!!user&&!user.guest,languages:c.translateLanguages||[]})).catch(()=>{});},[user]);
  const submit=async e=>{
    e.preventDefault();
    if(!text.trim())return;
    if(!(await api.auth.requireAccount()))return;
    setBusy(true);
    const r=await api.functions.invoke('createComment',{post_id:postId,body:text});
    if(r.status>=400){setErr(r.data?.error||'Action unavailable');setBusy(false);return;}
    setErr('');setText('');setBusy(false);load();
  };
  const vote=async(c)=>{
    if(!(await api.auth.requireAccount()))return;
    const r=await api.functions.invoke('toggleAnswerVote',{comment_id:c.id});
    if(r.status>=400){setErr(r.data?.error||'Could not vote');return;}
    setErr('');
    setMyVotes(v=>{const n=new Set(v);r.data.voted?n.add(c.id):n.delete(c.id);return n;});
    setComments(cs=>cs.map(x=>x.id===c.id?{...x,vote_count:r.data.vote_count}:x));
  };
  const helped=async(c)=>{
    const r=await api.functions.invoke('markHelpful',{post_id:postId,comment_id:c.id});
    if(r.status>=400){setErr(r.data?.error||'Could not mark');return;}
    setErr('');onHelpful?.(r.data.helpful_comment_id);
  };
  const isAsker=!!user&&user.id===authorId;
  const ordered=isAsk?[...comments].sort((a,b)=>(b.id===helpfulId)-(a.id===helpfulId)||(b.vote_count||0)-(a.vote_count||0)||new Date(a.created_date)-new Date(b.created_date)):comments;

  return <div className="space-y-3 pt-1">
    {ordered.map(c=>{const isHelpful=isAsk&&c.id===helpfulId;return <div key={c.id} className={`flex gap-2 rounded-lg p-3 ${isHelpful?'bg-brand-gold-bg ring-1 ring-brand-gold/40':'bg-brand-tint'}`}>
      {isAsk&&<button type="button" onClick={()=>vote(c)} disabled={!!user&&c.created_by_id===user.id} aria-label="Upvote this answer" className={`flex h-12 w-9 shrink-0 flex-col items-center justify-center rounded-xl text-xs font-bold ${myVotes.has(c.id)?'bg-brand-navy text-white':'bg-brand-surface text-brand-body hover:text-brand-ink'} disabled:opacity-40`}><ChevronUp size={16}/>{c.vote_count||0}</button>}
      {!isAsk&&<div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-surface text-xs font-bold text-brand-teal">{(c.author_name||' KC').split(' ').map(x=>x[0]).slice(0,2).join('')}</div>}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2"><p className="text-xs font-semibold text-brand-ink">{c.author_name||'Community member'}</p>{c.created_date&&<time dateTime={c.created_date} title={fullDate(c.created_date)} className="text-[11px] text-brand-muted">{timeAgo(c.created_date)}</time>}{isHelpful&&<span className="inline-flex items-center gap-1 rounded-full bg-brand-surface px-2 py-0.5 text-[10px] font-bold text-brand-gold-ink"><CheckCircle2 size={11}/>Helped the asker</span>}</div>
        <Headline text={c.author_headline} className="text-[11px]"/>
        <p dir="auto" className="text-sm leading-6 text-brand-body">{c.body}</p>
        <TranslateToggle text={c.body} enabled={translate.enabled} languages={translate.languages} user={user}/>
        {/* The loop the directory runs on: someone asks, someone answers, and
            the answer becomes a listing the next person finds instead of an
            answer that scrolls away. Offered to anyone, not only the asker —
            whoever knows the business is the one who can list it. */}
        {isAsk&&<div className="mt-1 flex flex-wrap items-center gap-3">
          {isAsker&&<button type="button" onClick={()=>helped(c)} className="text-xs font-semibold text-brand-teal hover:underline">{isHelpful?'Unmark as helpful':'This helped'}</button>}
          <Link to={`/add?from_post=${encodeURIComponent(postId)}${nameGuess(c.body)?`&name=${encodeURIComponent(nameGuess(c.body))}`:''}`} className="text-xs font-semibold text-brand-navy hover:underline">Add to the directory</Link>
        </div>}
      </div>
    </div>;})}
    {comments.length===0&&<p className="text-xs text-brand-muted">{isAsk?'No answers yet. Know someone? Answer below or share this ask on WhatsApp.':'No comments yet.'}</p>}
    {err&&<p className="text-xs font-semibold text-brand-error">{err}</p>}
    <form onSubmit={submit} className="flex gap-2"><input value={text} onChange={e=>setText(e.target.value)} placeholder={isAsk?'Write an answer…':'Add a comment…'} className="flex-1 rounded-xl border border-brand-line bg-brand-surface px-3 py-2 text-sm text-brand-ink outline-none placeholder:text-brand-muted focus:border-brand-teal"/><button disabled={busy||!text.trim()} className="primary px-3"><Send size={15}/></button></form>
  </div>;
}
