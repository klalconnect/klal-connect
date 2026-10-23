import React,{useEffect,useState} from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api/client';
import { Bell, Heart, MessageCircle, UserPlus, Link2, Bookmark, Star, PartyPopper } from 'lucide-react';
import { notificationPath } from '@/lib/notifications';
import Headline from '@/components/Headline';
import { membersByIds } from '@/lib/members';

const ICONS={like:Heart,comment:MessageCircle,connection_request:UserPlus,connection_accept:Link2,save:Bookmark,review:Star,invite_joined:PartyPopper};

// "X joined using your invite" is written the moment they sign up, often
// before they have typed a name, so it was stuck saying "Someone". Read the
// person's name as it is now instead.
const inviteText=(n,people)=>{
  // Older ones stored the email when there was no name; never show that.
  const saved=String(n.actor_name||'').includes('@')?'':n.actor_name;
  const name=String(people.get(n.target_id)?.full_name||saved||'').trim();
  return `${name||'Someone'} joined using your invite`;
};

export default function NotificationList({ items, onNavigate }){
  const navigate=useNavigate();
  const [people,setPeople]=useState(()=>new Map());
  useEffect(()=>{
    const ids=(items||[]).filter(n=>n.type==='invite_joined').map(n=>n.target_id);
    if(ids.length) membersByIds(ids).then(setPeople).catch(()=>{});
  },[items]);
  if(!items||items.length===0) return <p className="px-4 py-8 text-center text-sm text-brand-muted">No notifications yet.</p>;
  const open=async n=>{
    if(!n.read){ try{ await api.entities.Notification.update(n.id,{read:true}); }catch{} }
    onNavigate?.();
    navigate(notificationPath(n));
  };
  return <div className="max-h-[60vh] overflow-y-auto">
    {items.map(n=>{
      const Icon=ICONS[n.type]||Bell;
      return <button key={n.id} onClick={()=>open(n)} className={`flex w-full items-start gap-3 border-b border-brand-line/50 px-4 py-3 text-left hover:bg-brand-tint ${!n.read?'bg-brand-gold-bg/40':''}`}>
        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-tint text-brand-teal"><Icon size={15}/></span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm leading-5 text-brand-ink">{n.type==='invite_joined'?inviteText(n,people):(n.message||'New notification')}</span>
          <Headline text={n.actor_headline} className="text-[11px]"/>
          <span className="block text-xs text-brand-muted">{new Date(n.created_date).toLocaleString()}</span>
        </span>
        {!n.read&&<span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-teal"/>}
      </button>;
    })}
  </div>;
}