import React,{useEffect,useState} from 'react';
import { Briefcase, Sparkles } from 'lucide-react';
import { CELEBRATIONS, celebrationOf } from '@/lib/celebrations';

// The colours the pieces come in: the site's teal, gold and navy, and softer
// versions of each. They read on a light card and a dark one alike.
const COLORS=['#0D6B66','#D4A73A','#1F3A5F','#5FB3AD','#E8C872','#9DB8D9'];

// The same post draws the same pieces every time it plays, rather than a new
// scatter on every render.
function seeded(seed){ let t=seed>>>0; return ()=>{ t+=0x6D2B79F5; let r=Math.imul(t^(t>>>15),1|t); r^=r+Math.imul(r^(r>>>7),61|r); return ((r^(r>>>14))>>>0)/4294967296; }; }
const hash=s=>[...String(s)].reduce((h,c)=>Math.imul(h^c.charCodeAt(0),16777619),2166136261);

function pieces(kind,seed){
  const rnd=seeded(hash(`${kind}:${seed}`)),pick=a=>a[Math.floor(rnd()*a.length)];
  if(kind==='balloons') return Array.from({length:9},(_,i)=>({key:i,className:'kc-balloon',style:{'--x':`${4+i*11+rnd()*5}%`,'--c':pick(COLORS),'--d':`${2.6+rnd()*1.2}s`,'--delay':`${rnd()*0.7}s`,'--sway':`${(rnd()-0.5)*40}px`,'--s':0.8+rnd()*0.45}}));
  if(kind==='fireworks') return [[22,32,0],[74,26,0.45],[48,58,0.9]].flatMap(([x,y,delay],b)=>Array.from({length:20},(_,i)=>{
    const a=(i/20)*Math.PI*2,r=60+rnd()*40;
    return {key:`${b}-${i}`,className:'kc-spark',style:{left:`${x}%`,top:`${y}%`,'--c':COLORS[(b*2+i)%COLORS.length],'--tx':`${Math.cos(a)*r}px`,'--ty':`${Math.sin(a)*r}px`,'--delay':`${delay}s`}};
  }));
  if(kind==='sparkles') return Array.from({length:18},(_,i)=>({key:i,className:'kc-star',style:{left:`${rnd()*94}%`,top:`${rnd()*88}%`,'--c':pick(['#D4A73A','#E8C872','#5FB3AD']),'--delay':`${rnd()*1.6}s`,'--s':0.6+rnd()*0.9}}));
  return Array.from({length:46},(_,i)=>({key:i,className:'kc-confetti',style:{'--x':`${rnd()*100}%`,'--c':pick(COLORS),'--d':`${1.8+rnd()*1.2}s`,'--delay':`${rnd()*0.6}s`,'--dx':`${(rnd()-0.5)*120}px`,'--r':`${(rnd()-0.5)*900}deg`,'--w':`${5+rnd()*4}px`}}));
}

// How long each one runs, so it can take itself off the page afterwards.
const LENGTH={confetti:3400,balloons:4600,fireworks:2600,sparkles:3200};

// The animation itself, laid over whatever box it sits in (which needs
// `relative`). It plays once and goes. Anyone who has asked their device for
// less motion gets none of it (index.css).
export function CelebrationBurst({ kind, seed='' }){
  const k=celebrationOf(kind);
  const [done,setDone]=useState(false);
  useEffect(()=>{ const t=setTimeout(()=>setDone(true),LENGTH[k]); return ()=>clearTimeout(t); },[k]);
  if(done) return null;
  return <div aria-hidden="true" className="kc-burst">{pieces(k,seed).map(p=><span key={p.key} className={p.className} style={p.style}/>)}</div>;
}

// Plays the animation once the post is mostly on screen, and again whenever
// `replay` is called. Each play is a fresh mount, so it starts from the top.
export function useCelebration(ref, enabled){
  const [play,setPlay]=useState(0);
  useEffect(()=>{
    const el=ref.current;
    if(!enabled||!el||typeof IntersectionObserver==='undefined')return;
    const io=new IntersectionObserver(([e])=>{ if(e.isIntersecting){ setPlay(n=>n||1); io.disconnect(); } },{threshold:0.5});
    io.observe(el);
    return ()=>io.disconnect();
  },[ref,enabled]);
  return { play, replay:()=>setPlay(n=>n+1) };
}

// The card at the top of a new-job post: who started where, a button to play
// the animation again, and a quick way to say mazel tov.
export function NewJobBanner({ post, onReplay, mine, onMazelTov, own }){
  const title=post.job_title, company=post.job_company;
  const saidIt=mine==='mazel_tov';
  return <div className="rounded-xl bg-gradient-to-br from-brand-tint to-brand-gold-bg p-4 ring-1 ring-brand-line">
    <div className="flex items-start gap-3">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand-teal text-white"><Briefcase size={20}/></span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold uppercase tracking-wide text-brand-teal">Started a new position</p>
        <p className="mt-0.5 text-base font-bold leading-snug text-brand-ink">{title||(company?'New job':'Started a new job')}{company&&<span className="font-semibold text-brand-body"> at {company}</span>}</p>
      </div>
      <button type="button" onClick={onReplay} aria-label="Play the celebration again" title="Play the celebration again" className="icon-button shrink-0 text-brand-teal"><Sparkles size={18}/></button>
    </div>
    {!own&&<div className="mt-3 sm:pl-14">
      <button type="button" onClick={onMazelTov} aria-pressed={saidIt} className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${saidIt?'bg-brand-surface text-brand-teal ring-1 ring-brand-line':'bg-brand-navy text-white hover:bg-brand-navy-hover'}`}>🎉 {saidIt?'You said mazel tov':'Say mazel tov'}</button>
    </div>}
  </div>;
}

// The four animations to choose from, as chips. Tapping one picks it.
export function CelebrationChoice({ value, onChange }){
  return <div role="radiogroup" aria-label="Celebration" className="flex flex-wrap gap-1.5">
    {CELEBRATIONS.map(c=><button key={c.id} type="button" role="radio" aria-checked={value===c.id} onClick={()=>onChange(c.id)} className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition ${value===c.id?'bg-brand-navy text-white':'bg-brand-surface text-brand-body ring-1 ring-brand-line hover:text-brand-ink'}`}><span aria-hidden="true">{c.emoji}</span>{c.label}</button>)}
  </div>;
}

// Everyone, or kept quiet: the choice the poster makes about the celebration.
export function CelebrationVisibility({ value, onChange }){
  const opt=(on,label)=><button type="button" role="radio" aria-checked={value===on} onClick={()=>onChange(on)} className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition sm:flex-none ${value===on?'bg-brand-surface text-brand-ink shadow-sm ring-1 ring-brand-line':'text-brand-body hover:text-brand-ink'}`}>{label}</button>;
  return <div role="radiogroup" aria-label="Who sees the celebration" className="flex gap-1 rounded-lg bg-brand-canvas p-1 ring-1 ring-brand-line">{opt(true,'Celebrate publicly')}{opt(false,'Keep it quiet')}</div>;
}
