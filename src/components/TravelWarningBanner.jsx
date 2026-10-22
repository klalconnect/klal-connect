import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Plane, X } from 'lucide-react';
import { useTravelCheck } from '@/hooks/useTravelCheck';

// Dismissible, informational banner. Does not affect any gate or saved
// location — the button only opens the location picker in Settings,
// pre-filled with the detected new location for the user to review and confirm.
export default function TravelWarningBanner(){
  const { suggestion, dismiss }=useTravelCheck();
  const navigate=useNavigate();
  if(!suggestion) return null;
  const go=()=>{
    const params=new URLSearchParams({ travel: JSON.stringify({ lat:suggestion.latitude, lon:suggestion.longitude, city:suggestion.city, country:suggestion.country_code, tz:suggestion.tzid }) });
    navigate(`/settings?${params.toString()}#location`);
  };
  return <div className="bg-brand-gold-bg/80 px-4 py-2.5 text-sm text-brand-gold-ink">
    <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center">
      <Plane size={14} className="shrink-0"/>
      <span>Looks like you may have traveled{suggestion.city ? ` to ${suggestion.city}` : ''} — update your location so your Shabbos &amp; Yom Tov times are accurate.</span>
      <button onClick={go} className="rounded-lg bg-brand-navy px-3 py-1 text-xs font-bold text-white hover:bg-brand-navy-hover">Update location</button>
      <button onClick={dismiss} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-gold-ink/80 underline-offset-2 hover:text-brand-gold-ink hover:underline"><X size={14}/>Don&apos;t show again</button>
    </div>
  </div>;
}