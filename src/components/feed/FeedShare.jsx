import React,{useEffect,useRef,useState} from 'react';
import { Share2, Link2, MessageCircle, Linkedin, X, Copy, ExternalLink, Info } from 'lucide-react';
import { waShareUrl, WA_GREEN } from '@/components/ShareButton';
import { postExcerpt } from '@/lib/postTypes';
import { useIsDark } from '@/hooks/useIsDark';

// Where a single post lives: the feed, showing only that post (Feed.jsx).
export const postLink = (id) => `${window.location.origin}/feed?post=${encodeURIComponent(id)}`;

// LinkedIn's own blue, on LinkedIn buttons only — the same rule as WhatsApp's
// green: a signal that the button leaves the site.
export const LI_BLUE = '#0A66C2';
// The lighter blue LinkedIn itself uses on dark backgrounds, for the icon.
const LI_BLUE_DARK = '#70B5F9';
// LinkedIn's compose box, opened with the text filled in. There is no way to
// hand it photos, and its phone app does not always take the text either —
// which is why the dialog below says so and copies the text first.
export const linkedInShareUrl = (text) => `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(text)}`;

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    // No clipboard API (an http origin, an old browser): the selection fallback.
    const el=document.createElement('textarea'); el.value=text; el.setAttribute('readonly',''); el.style.position='fixed'; el.style.opacity='0';
    document.body.appendChild(el); el.select(); el.setSelectionRange(0,text.length);
    let ok=false; try{ ok=document.execCommand('copy'); }catch{ ok=false; }
    el.remove(); return ok;
  }
}

// What goes to LinkedIn: the post's own words, then the link back here, so
// whoever reads it there can click through to the original.
const linkedInText = (post) => {
  const words=String(post.body||post.repost_body||'').trim();
  return `${words}${words?'\n\n':''}See it on Klal Connect: ${postLink(post.id)}`;
};

// One tap away from LinkedIn, with a check-it-first note. LinkedIn opens in a
// new tab with the text filled in; nothing is posted until the person taps
// Post there themselves.
export function LinkedInShareDialog({ post, onClose }) {
  const [copied,setCopied]=useState(false);
  const text=linkedInText(post);
  const photos=(post.image_urls?.length||0)+(post.repost_image_urls?.length||0);
  const hasVideo=!!(post.video_url||post.repost_video_url);
  useEffect(()=>{
    const onKey=e=>{ if(e.key==='Escape') onClose(); };
    window.addEventListener('keydown',onKey);
    return ()=>window.removeEventListener('keydown',onKey);
  },[onClose]);
  const copy=async()=>{ setCopied(await copyText(text)); };
  return <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/40 px-4 pb-4 sm:items-center sm:pb-0" onClick={onClose}>
    <div role="dialog" aria-modal="true" aria-labelledby="li-share-title" className="w-full max-w-md space-y-4 rounded-xl bg-brand-surface p-5 shadow-xl ring-1 ring-brand-line" onClick={e=>e.stopPropagation()}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-full text-white" style={{background:LI_BLUE}}><Linkedin size={20}/></div>
          <h3 id="li-share-title" className="section-title">Share on LinkedIn</h3>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="icon-button -mt-1 -mr-1"><X size={18}/></button>
      </div>
      <div className="flex gap-2.5 rounded-lg bg-brand-tint p-3 text-sm text-brand-body">
        <Info size={18} className="mt-0.5 shrink-0 text-brand-teal"/>
        <div className="space-y-1">
          <p className="font-semibold text-brand-ink">Check it before you post</p>
          <p>LinkedIn opens with your text filled in. Make sure everything came across before you tap Post there.</p>
          <ul className="list-disc space-y-0.5 pl-4">
            {photos>0
              ?<li>Photos don't carry over. Add {photos===1?'the photo':`the ${photos} photos`} on LinkedIn yourself.</li>
              :!hasVideo&&<li>Photos never carry over, so add any there yourself.</li>}
            {hasVideo&&<li>The video doesn't carry over either. Add it on LinkedIn yourself.</li>}
            <li>The LinkedIn phone app sometimes leaves the text out. It's copied for you, so just paste it in.</li>
          </ul>
        </div>
      </div>
      <p className="max-h-36 overflow-y-auto whitespace-pre-line [overflow-wrap:anywhere] rounded-lg border border-brand-line bg-brand-canvas px-3 py-2 text-sm text-brand-body">{text}</p>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button type="button" onClick={copy} className="secondary py-2"><Copy size={15}/>{copied?'Copied':'Copy text'}</button>
        <a href={linkedInShareUrl(text)} target="_blank" rel="noreferrer" onClick={()=>{ copyText(text); setTimeout(onClose,300); }} className="primary py-2 text-white" style={{background:LI_BLUE,borderColor:LI_BLUE}}><ExternalLink size={15}/>Open LinkedIn</a>
      </div>
    </div>
  </div>;
}

// The Share button under a post: copy its link, or send it to WhatsApp or
// LinkedIn. Works for everyone, guests included — a link brings people in.
export default function FeedShareButton({ post, className='' }) {
  const [open,setOpen]=useState(false),[note,setNote]=useState(''),[linkedIn,setLinkedIn]=useState(false);
  const dark=useIsDark();
  const ref=useRef(null),timer=useRef(null);
  useEffect(()=>()=>clearTimeout(timer.current),[]);
  useEffect(()=>{
    if(!open)return;
    const onDown=e=>{ if(ref.current&&!ref.current.contains(e.target)) setOpen(false); };
    const onKey=e=>{ if(e.key==='Escape') setOpen(false); };
    document.addEventListener('pointerdown',onDown); document.addEventListener('keydown',onKey);
    return ()=>{ document.removeEventListener('pointerdown',onDown); document.removeEventListener('keydown',onKey); };
  },[open]);
  const copy=async()=>{
    const ok=await copyText(postLink(post.id));
    setNote(ok?'Link copied':'Could not copy');
    clearTimeout(timer.current); timer.current=setTimeout(()=>{ setNote(''); setOpen(false); },1200);
  };
  const shareText=`${postExcerpt(post.body||post.repost_body,120)||`A post by ${post.author_name||'a community member'} on Klal Connect`} — ${postLink(post.id)}`;
  const item='flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm font-semibold text-brand-body hover:bg-brand-tint hover:text-brand-ink focus:bg-brand-tint focus:outline-none';
  return <div ref={ref} className="relative flex flex-1 sm:flex-none">
    <button type="button" onClick={()=>{ setNote(''); setOpen(o=>!o); }} aria-haspopup="menu" aria-expanded={open} className={className}><Share2 size={17}/>Share</button>
    {open&&<div role="menu" aria-label="Share this post" className="absolute bottom-full right-0 z-30 mb-2 w-56 overflow-hidden rounded-lg bg-brand-surface py-1 shadow-lg ring-1 ring-brand-line">
      <button type="button" role="menuitem" onClick={copy} className={item}><Link2 size={16}/>{note||'Copy link'}</button>
      <a role="menuitem" href={waShareUrl(shareText)} target="_blank" rel="noreferrer" onClick={()=>setOpen(false)} className={item}><MessageCircle size={16} style={{color:WA_GREEN}}/>Share on WhatsApp</a>
      <button type="button" role="menuitem" onClick={()=>{ setOpen(false); setLinkedIn(true); }} className={item}><Linkedin size={16} style={{color:dark?LI_BLUE_DARK:LI_BLUE}}/>Share on LinkedIn</button>
    </div>}
    {linkedIn&&<LinkedInShareDialog post={post} onClose={()=>setLinkedIn(false)}/>}
  </div>;
}
