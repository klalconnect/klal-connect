import React,{useEffect,useState} from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api/client';
import { Image } from '@/components/ui/image';
import { Plus } from 'lucide-react';
import { companyPath } from '@/lib/paths';
import HeadlineEdit from '@/components/HeadlineEdit';
import { LoadingNote } from '@/components/Loading';

export default function ManageCompanies({ user }){
  const [companies,setCompanies]=useState([]);
  const [loading,setLoading]=useState(true);
  const [taglineFor,setTaglineFor]=useState({});
  const [savingId,setSavingId]=useState(null);
  const [savedId,setSavedId]=useState(null);

  useEffect(()=>{(async()=>{
    if(!user) return;
    const all=await api.entities.Company.filter({created_by_id:user.id},'-created_date');
    setCompanies(all); setLoading(false);
  })()},[user]);

  const saveTagline=async(c)=>{
    setSavingId(c.id);
    try{
      const updated=await api.entities.Company.update(c.id,{tagline:taglineFor[c.id]||null});
      setCompanies(companies.map(x=>x.id===c.id?updated:x));
      setSavedId(c.id); setTimeout(()=>setSavedId(null),1500);
    }finally{ setSavingId(null); }
  };

  return <section className="panel mt-6 space-y-4">
    <div className="flex items-center justify-between">
      <div>
        <h2 className="section-title">Your company pages</h2>
        <p className="helper">Company pages you manage, separate from your personal profile.</p>
      </div>
      <Link to="/create-company" className="primary"><Plus size={16}/>New page</Link>
    </div>
    {loading ? <LoadingNote label="Loading your company pages…"/> : companies.length===0
      ? <p className="text-sm text-brand-muted">You haven't created any company pages yet.</p>
      : <div className="space-y-4">{companies.map(c=>{
        const initials=(c.name||'?').split(' ').map(x=>x[0]).slice(0,2).join('').toUpperCase();
        return <div key={c.id} className="space-y-3 rounded-lg border border-brand-line p-4">
          <Link to={companyPath(c)} className="flex items-center gap-3 rounded-xl p-1 hover:bg-brand-tint">
            {c.logo_url
              ? <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg ring-1 ring-brand-line"><Image src={c.logo_url} fittingType="fill" className="h-10 w-10"/></div>
              : <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-tint text-sm font-bold text-brand-teal">{initials}</div>}
            <div className="min-w-0">
              <p className="truncate font-semibold text-brand-ink">{c.name}</p>
              <p className="truncate text-xs text-brand-muted">{c.industry||'Company page'}</p>
            </div>
          </Link>
          <HeadlineEdit label="Tagline" value={taglineFor[c.id]!=null?taglineFor[c.id]:(c.tagline||'')} onChange={v=>setTaglineFor({...taglineFor,[c.id]:v})} helper="Appears under your company name across the app."/>
          <button onClick={()=>saveTagline(c)} disabled={savingId===c.id} className="primary text-sm">{savingId===c.id?'Saving…':'Save tagline'}{savedId===c.id?' ✓':''}</button>
        </div>;
      })}</div>}
  </section>;
}