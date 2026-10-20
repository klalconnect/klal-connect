import React,{useEffect,useRef,useState} from 'react';
import { api } from '@/api/client';
import { MoreHorizontal, Link2, MessageCircle, Bookmark, BookmarkCheck, Flag, Trash2, Loader2, PartyPopper, EyeOff, Sparkles } from 'lucide-react';
import { celebrates, isNewJob } from '@/lib/celebrations';
import { waShareUrl, WA_GREEN } from '@/components/ShareButton';
import { POST_REPORT_REASONS, postExcerpt } from '@/lib/postTypes';
import { postLink } from '@/components/feed/FeedShare';

// The "…" in the corner of a post card. Copy and share work for anyone,
// guest included; saving and reporting need an account of one's own (the
// gate pops the prompt); deleting is the author's, an admin's, or a
// moderator's. The report form itself lives in the card (ReportPostForm
// below) — the menu only asks the card to open it.
export default function FeedPostMenu({ post, user, onReport, onDeleted, onCelebration }) {
  const [open,setOpen]=useState(false),[saved,setSaved]=useState(null),[busy,setBusy]=useState(false),[note,setNote]=useState(''),[err,setErr]=useState('');
  const ref=useRef(null),timer=useRef(null),btn=useRef(null);
  const member=!!user&&!user.guest;
  const isOwn=member&&post.created_by_id===user.id;
  const canDelete=isOwn||user?.role==='admin'||user?.role==='moderator';

  useEffect(()=>()=>clearTimeout(timer.current),[]);
  // Outside click or Escape closes it; the arrows walk the items.
  useEffect(()=>{
    if(!open)return;
    ref.current?.querySelector('[role="menuitem"]')?.focus();
    const onDown=e=>{ if(ref.current&&!ref.current.contains(e.target)) setOpen(false); };
    const onKey=e=>{
      if(e.key==='Escape'){ setOpen(false); return; }
      if(e.key!=='ArrowDown'&&e.key!=='ArrowUp')return;
      // The arrows walk the menu only while focus is in it; elsewhere on the
      // page they keep scrolling.
      if(!ref.current?.contains(document.activeElement))return;
      const items=[...(ref.current?.querySelectorAll('[role="menuitem"]')||[])];
      if(!items.length)return;
      e.preventDefault();
      const i=items.indexOf(document.activeElement);
      items[(i+(e.key==='ArrowDown'?1:-1)+items.length)%items.length].focus();
    };
    document.addEventListener('pointerdown',onDown);
    document.addEventListener('keydown',onKey);
    return ()=>{
      document.removeEventListener('pointerdown',onDown); document.removeEventListener('keydown',onKey);
      // However it closed, focus goes back to the button rather than to <body>.
      if(document.activeElement===document.body||!document.activeElement||ref.current?.contains(document.activeElement)) btn.current?.focus();
    };
  },[open]);
  // Opening starts clean: no leftover note, error, or a close timer from a
  // previous round still ticking.
  const toggle=()=>{ clearTimeout(timer.current); setNote(''); setErr(''); setOpen(o=>!o); };
  // Whether it is already saved is looked up when the menu opens, not for
  // every card on the page.
  useEffect(()=>{
    if(!open||!member||isOwn||saved!==null)return;
    api.entities.SavedPost.filter({post_id:post.id}).then(rows=>setSaved(rows.length>0)).catch(()=>{});
  },[open,member,isOwn,saved,post.id]);

  // A word of confirmation in the menu, then it closes on its own.
  const finish=(text)=>{ setErr(''); setNote(text); clearTimeout(timer.current); timer.current=setTimeout(()=>{ setNote(''); setOpen(false); },1200); };

  const copy=async()=>{
    const link=postLink(post.id);
    let ok=false;
    try{ await navigator.clipboard.writeText(link); ok=true; }
    catch{
      // No clipboard API (an http origin, an old browser): the selection fallback.
      const el=document.createElement('textarea'); el.value=link; el.setAttribute('readonly',''); el.style.position='fixed'; el.style.opacity='0';
      document.body.appendChild(el); el.select(); el.setSelectionRange(0,link.length);
      try{ ok=document.execCommand('copy'); }catch{ ok=false; }
      el.remove();
    }
    if(ok) finish('Copied'); else setErr('Could not copy — long-press the link in WhatsApp share instead.');
  };
  const save=async()=>{
    if(!(await api.auth.requireAccount())){ setOpen(false); return; }
    setBusy(true);
    const r=await api.functions.invoke('toggleSavePost',{post_id:post.id});
    setBusy(false);
    if(r.status>=400){ setErr(r.data?.error||'Action unavailable'); return; }
    setSaved(r.data.saved);
    finish(r.data.saved?'Saved':'Removed from saved');
  };
  const report=async()=>{
    if(!(await api.auth.requireAccount())){ setOpen(false); return; }
    setOpen(false); onReport?.();
  };
  const del=async()=>{
    if(!window.confirm('Delete this post? Its comments and reactions go with it. This cannot be undone.'))return;
    setBusy(true);
    const r=await api.functions.invoke('deletePost',{post_id:post.id});
    setBusy(false);
    if(r.status>=400){ setErr(r.data?.error||'Could not delete'); return; }
    setOpen(false); onDeleted?.(post.id);
  };
  // The author of a new-job post can keep its celebration quiet or bring it
  // back, and change the animation while it shows.
  const celebration=async(patch)=>{
    setOpen(false);
    if(patch==='pick'){ onCelebration?.('pick'); return; }
    const r=await onCelebration?.(patch);
    if(r&&r.status>=400){ setOpen(true); setErr(r.data?.error||'Could not save'); }
  };
  const shareText=`${postExcerpt(post.body||post.repost_body,120)||`A post by ${post.author_name||'a community member'} on Klal`} — ${postLink(post.id)}`;
  const item='flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm font-semibold text-brand-body hover:bg-brand-tint hover:text-brand-ink focus:bg-brand-tint focus:outline-none disabled:opacity-50';

  return <div ref={ref} className="relative -mr-2 -mt-1 shrink-0">
    <button ref={btn} type="button" onClick={toggle} aria-haspopup="menu" aria-expanded={open} aria-label="Post options" className="icon-button text-brand-muted hover:text-brand-ink"><MoreHorizontal/></button>
    {open&&<div role="menu" aria-label="Post options" className="absolute right-0 top-full z-30 mt-1 w-56 overflow-hidden rounded-lg bg-brand-surface py-1 shadow-lg ring-1 ring-brand-line">
      <button type="button" role="menuitem" onClick={copy} className={item}><Link2 size={16}/>{note==='Copied'?'Copied':'Copy link'}</button>
      <a role="menuitem" href={waShareUrl(shareText)} target="_blank" rel="noreferrer" onClick={()=>setOpen(false)} className={item}><MessageCircle size={16} style={{color:WA_GREEN}}/>Share on WhatsApp</a>
      {!isOwn&&<button type="button" role="menuitem" onClick={save} disabled={busy||(member&&saved===null)} className={item}>{saved?<BookmarkCheck size={16} className="text-brand-teal"/>:<Bookmark size={16}/>}{note&&note!=='Copied'?note:(saved?'Unsave':'Save post')}</button>}
      {!isOwn&&<button type="button" role="menuitem" onClick={report} className={item}><Flag size={16}/>Report post</button>}
      {isOwn&&isNewJob(post)&&(celebrates(post)
        ?<><button type="button" role="menuitem" onClick={()=>celebration('pick')} className={item}><Sparkles size={16}/>Change the animation</button>
          <button type="button" role="menuitem" onClick={()=>celebration({celebration_public:false})} className={item}><EyeOff size={16}/>Hide the celebration</button></>
        :<button type="button" role="menuitem" onClick={()=>celebration({celebration_public:true})} className={item}><PartyPopper size={16}/>Celebrate publicly</button>)}
      {canDelete&&<button type="button" role="menuitem" onClick={del} disabled={busy} className={`${item} text-brand-error hover:text-brand-error`}>{busy?<Loader2 size={16} className="animate-spin"/>:<Trash2 size={16}/>}Delete post</button>}
      {err&&<p className="px-3 py-1.5 text-xs font-semibold text-brand-error">{err}</p>}
    </div>}
  </div>;
}

// The report form the card shows in place of a modal: a reason, a few words,
// and a thank-you. Nothing about a report is ever shown to the author.
export function ReportPostForm({ post, onClose }) {
  const [reason,setReason]=useState(''),[text,setText]=useState(''),[busy,setBusy]=useState(false),[err,setErr]=useState(''),[done,setDone]=useState(false);
  const submit=async e=>{
    e.preventDefault();
    if(!reason){ setErr('Please choose a reason.'); return; }
    if(text.trim().length<20){ setErr('Please add at least 20 characters of explanation.'); return; }
    if(!(await api.auth.requireAccount()))return;
    setBusy(true);
    const r=await api.functions.invoke('reportPost',{post_id:post.id,reason_category:reason,explanation:text});
    setBusy(false);
    if(r.status>=400){ setErr(r.data?.error||'Could not send the report'); return; }
    setErr(''); setDone(true);
  };
  if(done)return <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-brand-tint px-4 py-3 text-sm"><p className="font-semibold text-brand-teal">Thanks — our team will look at it.</p><button type="button" onClick={onClose} className="text-xs font-semibold text-brand-body hover:underline">Close</button></div>;
  return <form onSubmit={submit} className="space-y-3 rounded-lg bg-brand-tint p-4">
    <div>
      <p className="text-sm font-bold text-brand-ink">Report this post</p>
      <p className="text-xs text-brand-muted">Goes privately to the Klal team. The author is not told who reported it.</p>
    </div>
    <label className="block text-xs font-semibold text-brand-body">Reason
      <select className="field" value={reason} onChange={e=>setReason(e.target.value)} required>
        <option value="">Choose a reason…</option>
        {POST_REPORT_REASONS.map(r=><option key={r.id} value={r.id}>{r.label}</option>)}
      </select>
    </label>
    <label className="block text-xs font-semibold text-brand-body">What's wrong with it?
      <textarea className="field min-h-20" value={text} onChange={e=>setText(e.target.value)} placeholder="A sentence or two so our team knows what to look for." required minLength={20} maxLength={1000}/>
      <span className="mt-1 block text-[11px] font-normal text-brand-muted">{text.trim().length}/1000 (at least 20)</span>
    </label>
    {err&&<p className="text-xs font-semibold text-brand-error">{err}</p>}
    <div className="flex justify-end gap-2">
      <button type="button" onClick={onClose} className="secondary py-2">Cancel</button>
      <button type="submit" disabled={busy} className="primary py-2">{busy?<Loader2 size={16} className="animate-spin"/>:'Send report'}</button>
    </div>
  </form>;
}
