import React,{useState,useRef,useEffect} from 'react';
import { createPortal } from 'react-dom';
import { Bell } from 'lucide-react';
import { api } from '@/api/client';
import { useNotifications } from '@/hooks/useNotifications';
import NotificationList from '@/components/NotificationList';

export default function NotificationBell(){
  const [open,setOpen]=useState(false);
  const ref=useRef(null);
  const panel=useRef(null);
  const [pos,setPos]=useState(null);
  const { items, unread, loading, reload }=useNotifications();

  useEffect(()=>{
    const onClick=e=>{ if(!ref.current?.contains(e.target)&&!panel.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown',onClick);
    return ()=>document.removeEventListener('mousedown',onClick);
  },[]);

  // The panel hangs below the bell, lined up with its right edge, but on a
  // phone the bell sits well in from the screen edge, so a 320px panel ran
  // off the left side. Slide it just enough to keep a 12px gap on both sides.
  // It is drawn outside the header: the header's own blur stopped this
  // panel's see-through blur from reaching the page behind it.
  useEffect(()=>{
    if(!open) return;
    const place=()=>{
      const r=ref.current?.getBoundingClientRect(); if(!r) return;
      const vw=document.documentElement.clientWidth, gap=12, w=Math.min(320,vw-gap*2);
      setPos({top:r.bottom+8,left:Math.max(gap,Math.min(r.right-w,vw-gap-w)),width:w});
    };
    place();
    window.addEventListener('resize',place);
    return ()=>window.removeEventListener('resize',place);
  },[open]);

  const markAll=async()=>{
    try{ const me=await api.auth.me(); await api.entities.Notification.updateMany({recipient_id:me.id,read:false},{$set:{read:true}}); reload(); }catch{}
  };

  return <div className="relative" ref={ref}>
    <button onClick={()=>setOpen(o=>!o)} className="icon-button relative" aria-label="Notifications">
      <Bell size={19}/>
      {unread>0&&<span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-brand-error px-1 text-[10px] font-bold text-white dark:text-black">{unread>9?'9+':unread}</span>}
    </button>
    {/* See-through like the search suggestion lists. */}
    {open&&pos&&createPortal(<div ref={panel} style={pos} className="fixed z-50 overflow-hidden rounded-xl border border-brand-line/50 bg-brand-surface/55 shadow-xl backdrop-blur-md backdrop-saturate-150">
      <div className="flex items-center justify-between border-b border-brand-line/50 px-4 py-2.5">
        <span className="text-sm font-bold text-brand-ink">Notifications</span>
        {unread>0&&<button onClick={markAll} className="text-xs font-semibold text-brand-teal hover:underline">Mark all read</button>}
      </div>
      {loading?<p className="px-4 py-8 text-center text-sm text-brand-muted">Loading…</p>:<NotificationList items={items} onNavigate={()=>setOpen(false)}/>}
    </div>,document.body)}
  </div>;
}