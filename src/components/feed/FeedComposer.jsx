import React,{useState} from 'react';
import { api } from '@/api/client';
import { ImagePlus, Send, Linkedin, X, CalendarClock } from 'lucide-react';
import Headline from '@/components/Headline';
import { AccountButtons } from '@/components/GuestPrompt';
import { POST_TYPES, POST_TYPE_BY_ID } from '@/lib/postTypes';
import { markEngaged } from '@/lib/engagement';
import { LinkedInShareDialog, LI_BLUE } from '@/components/feed/FeedShare';
import { isScheduled, scheduleLabel, toLocalInput } from '@/lib/scheduledPosts';
import { DEFAULT_CELEBRATION, JOB_FIELD_MAX } from '@/lib/celebrations';
import { CelebrationBurst, CelebrationChoice, CelebrationVisibility } from '@/components/feed/Celebration';

// Where the time box starts when scheduling is opened: tomorrow at 9 AM, or
// Sunday when tomorrow is Shabbos.
function defaultScheduleTime(){ const d=new Date(); d.setDate(d.getDate()+(d.getDay()===5?2:1)); d.setHours(9,0,0,0); return toLocalInput(d); }

// initialBody/initialType arrive from /feed?ask=… — a search that found
// nothing, handed straight to the people who might know the answer.
export default function FeedComposer({ onPosted, user, initialBody = '', initialType = '' }) {
  const [body,setBody]=useState(initialBody),[type,setType]=useState(initialType||'post'),[uploading,setUploading]=useState(false),[imgs,setImgs]=useState([]),[busy,setBusy]=useState(false),[err,setErr]=useState('');
  // Expanded on a wide screen, a single line on a phone until tapped — but
  // always expanded when it arrives prefilled, or the text a visitor was
  // handed sits hidden behind a collapsed bar.
  // The post just made, so it can go to LinkedIn too, and whether that
  // dialog is open.
  const [posted,setPosted]=useState(null),[sharing,setSharing]=useState(false);
  // A time to go live instead of now, picked in the poster's own time zone.
  // Empty while posting straight away.
  const [when,setWhen]=useState('');
  // A new-job post: the role, where, which animation it plays, whether it
  // celebrates in public, and a count that plays a preview when it changes.
  const [job,setJob]=useState({title:'',company:''}),[celebration,setCelebration]=useState(DEFAULT_CELEBRATION),[celebratePublic,setCelebratePublic]=useState(true),[preview,setPreview]=useState(0);
  const newJob=type==='new_job';
  const [open,setOpen]=useState(()=>!!initialBody||typeof window==='undefined'||window.innerWidth>=640);
  const upload=async e=>{
    setUploading(true);
    const {file_url}=await api.integrations.Core.UploadFile({file:e.target.files[0]});
    setImgs(i=>[...i,file_url]); setUploading(false);
  };
  const submit=async e=>{
    e.preventDefault();
    if(!body.trim())return;
    if(!(await api.auth.requireAccount()))return;
    // The browser reads the picked time in its own zone; the server gets the
    // exact moment.
    const publish_at=when?new Date(when).toISOString():undefined;
    if(when&&Number.isNaN(new Date(when).getTime())){ setErr('Pick a date and time for your post.'); return; }
    setBusy(true);
    const jobFields=newJob?{job_title:job.title,job_company:job.company,celebration,celebration_public:celebratePublic}:{};
    const r=await api.functions.invoke('createPost',{body,post_type:type,image_urls:imgs,publish_at,...jobFields});
    if(r.status>=400){ setErr(r.data?.error||'Could not post'); setBusy(false); return; }
    markEngaged();
    setErr(''); setBody(''); setImgs([]); setWhen(''); setJob({title:'',company:''}); setCelebration(DEFAULT_CELEBRATION); setCelebratePublic(true); setBusy(false); setPosted(r.data?.post||null);
    if(window.innerWidth<640) setOpen(false);
    onPosted?.();
  };
  if(user?.guest) return <div className="panel space-y-3">
    <p className="font-semibold text-brand-ink">Join the conversation</p>
    <p className="text-sm text-brand-body">You're browsing the feed as a guest. Create a free account to post, like and comment.</p>
    <AccountButtons returnTo="/feed" compact/>
  </div>;
  // On a phone the composer stays a single line until it is tapped. Expanded,
  // it was taller than a third of the screen and the first post never
  // appeared — and most visits to a feed are to read it, not to write.
  // min-w-0 and truncate are load-bearing: a flex child will not shrink below
  // its text, so without them this button stays as wide as the placeholder and
  // stretches the whole page past the edge of the screen.
  // A scheduled post has no link anyone else can open yet, so there is
  // nothing to share until it goes live.
  const postedNote=posted&&isScheduled(posted)?<div className="flex items-center gap-2 rounded-xl bg-brand-tint px-3 py-2 text-sm text-brand-body">
    <CalendarClock size={16} className="shrink-0 text-brand-teal"/>
    <span className="min-w-0 flex-1"><span className="font-semibold text-brand-ink">Scheduled for {scheduleLabel(posted.publish_at)}.</span> Only you can see it until then.</span>
    <button type="button" onClick={()=>setPosted(null)} aria-label="Dismiss" className="icon-button shrink-0 text-brand-muted"><X size={16}/></button>
  </div>:posted&&<div className="flex items-center gap-2 rounded-xl bg-brand-tint px-3 py-2 text-sm text-brand-body">
    <span className="min-w-0 flex-1 font-semibold text-brand-ink">Posted. Share it on LinkedIn too?</span>
    <button type="button" onClick={()=>setSharing(true)} className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white" style={{background:LI_BLUE}}><Linkedin size={14}/>Share on LinkedIn</button>
    <button type="button" onClick={()=>setPosted(null)} aria-label="Dismiss" className="icon-button shrink-0 text-brand-muted"><X size={16}/></button>
    {sharing&&<LinkedInShareDialog post={posted} onClose={()=>{ setSharing(false); setPosted(null); }}/>}
  </div>;
  if(!open) return <>{postedNote}<button type="button" onClick={()=>setOpen(true)} className="flex w-full min-w-0 items-center gap-3 rounded-xl bg-brand-surface p-3 text-left ring-1 ring-brand-line sm:hidden">
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-tint text-xs font-bold text-brand-teal">{(user?.full_name||'You').split(' ').map(x=>x[0]).slice(0,2).join('')}</span>
    <span className="min-w-0 flex-1 truncate text-sm text-brand-muted">Share something with the klal…</span>
    <span className="shrink-0 rounded-full bg-brand-navy p-2 text-white"><Send size={15}/></span>
  </button></>;

  return <>{postedNote}<form onSubmit={submit} className="panel space-y-3">
    <div className="flex gap-3">
      <div className="hidden h-11 w-11 shrink-0 place-items-center rounded-full bg-brand-tint text-sm font-bold text-brand-teal sm:grid">You</div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 hidden sm:block"><p className="text-sm font-semibold text-brand-ink">{user?.full_name||'You'}</p><Headline text={user?.headline}/></div>
        <div className="mb-2 -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:flex-wrap sm:overflow-visible">{POST_TYPES.map(t=><button type="button" key={t.id} onClick={()=>setType(t.id)} className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition ${type===t.id?'bg-brand-navy text-white':'bg-brand-tint text-brand-body hover:text-brand-ink'}`}>{t.label}</button>)}</div>
        <textarea value={body} onChange={e=>setBody(e.target.value)} placeholder={POST_TYPE_BY_ID[type]?.placeholder} autoFocus className="min-h-16 w-full resize-none rounded-lg border border-brand-line bg-brand-canvas px-4 py-3 text-sm outline-none focus:border-[#0D6B66] sm:min-h-20"/>
      </div>
    </div>
    {newJob&&<div className="relative space-y-3 overflow-hidden rounded-lg bg-brand-tint p-3 sm:ml-14">
      {preview>0&&<CelebrationBurst key={preview} kind={celebration} seed={preview}/>}
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block min-w-0"><span className="mb-1 block text-xs font-semibold text-brand-ink">Job title</span><input value={job.title} onChange={e=>setJob(j=>({...j,title:e.target.value}))} maxLength={JOB_FIELD_MAX} placeholder="e.g. Office manager" className="w-full min-w-0 rounded-lg border border-brand-line bg-brand-canvas px-3 py-2 text-sm text-brand-ink outline-none focus:border-[#0D6B66]"/></label>
        <label className="block min-w-0"><span className="mb-1 block text-xs font-semibold text-brand-ink">Company</span><input value={job.company} onChange={e=>setJob(j=>({...j,company:e.target.value}))} maxLength={JOB_FIELD_MAX} placeholder="e.g. Ezra Accounting" className="w-full min-w-0 rounded-lg border border-brand-line bg-brand-canvas px-3 py-2 text-sm text-brand-ink outline-none focus:border-[#0D6B66]"/></label>
      </div>
      <div className="space-y-1.5">
        <p className="text-xs font-semibold text-brand-ink">Celebration</p>
        <CelebrationVisibility value={celebratePublic} onChange={setCelebratePublic}/>
        {celebratePublic
          ?<><CelebrationChoice value={celebration} onChange={c=>{ setCelebration(c); setPreview(n=>n+1); }}/><p className="text-xs text-brand-muted">Everyone sees a "Started a new position" card, and it plays when they scroll to it. Tap one to see it.</p></>
          :<p className="text-xs text-brand-muted">Your post goes out as a regular update, with no card or animation. You can turn the celebration on later from the post's ••• menu.</p>}
      </div>
    </div>}
    {when&&<div className="space-y-1.5 rounded-lg bg-brand-tint p-3 sm:ml-14">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="feed-schedule" className="text-sm font-semibold text-brand-ink">Goes live</label>
        <input id="feed-schedule" type="datetime-local" value={when} min={toLocalInput(new Date())} onChange={e=>setWhen(e.target.value)} className="min-w-0 rounded-lg border border-brand-line bg-brand-canvas px-3 py-1.5 text-sm text-brand-ink outline-none focus:border-[#0D6B66]"/>
        <button type="button" onClick={()=>setWhen('')} className="text-xs font-semibold text-brand-teal hover:underline">Post now instead</button>
      </div>
      <p className="text-xs text-brand-muted">In your time zone. Only you can see it until then, and you can change or cancel it anytime.</p>
    </div>}
    {imgs.length>0&&<div className="flex gap-2 sm:pl-14">{imgs.map(u=><img key={u} src={u} className="h-16 w-16 rounded-lg object-cover"/>)}</div>}
    <div className="flex items-center justify-between sm:pl-14">
      <div className="flex items-center gap-2">
        <label className="icon-button cursor-pointer" aria-label="Add a photo"><ImagePlus size={18}/><input type="file" accept="image/*" onChange={upload} className="hidden"/></label>
        <button type="button" onClick={()=>{ setErr(''); setWhen(w=>w?'':defaultScheduleTime()); }} aria-pressed={!!when} aria-label="Schedule for later" title="Schedule for later" className={`icon-button ${when?'bg-brand-tint text-brand-teal':''}`}><CalendarClock size={18}/></button>
        {uploading&&<span className="text-xs text-brand-body">Uploading…</span>}
      </div>
      <div className="flex items-center gap-2">{err&&<span className="text-xs font-semibold text-brand-error">{err}</span>}<button type="button" onClick={()=>{setOpen(false);setBody('');setWhen('');}} className="text-xs font-medium text-brand-muted hover:text-brand-ink sm:hidden">Cancel</button><button disabled={busy||!body.trim()} className="primary">{when?<CalendarClock size={15}/>:<Send size={15}/>}{when?'Schedule':type==='question'?'Ask':'Post'}</button></div>
    </div>
  </form></>;
}
