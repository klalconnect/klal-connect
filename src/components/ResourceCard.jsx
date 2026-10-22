import React from 'react';
import { Link } from 'react-router-dom';
import { MapPin, CheckCircle2, Users, Handshake } from 'lucide-react';
import { providerPath } from '@/lib/paths';
import Headline from '@/components/Headline';
import BadgeChips from '@/components/BadgeChips';
import KitchenPill from '@/components/KitchenPill';
import OwnershipPill from '@/components/OwnershipPill';
import { isSensitiveListing } from '@/lib/sensitivity';
import useVouchesEnabled from '@/hooks/useVouchesEnabled';
import TrustMarks from '@/components/TrustMarks';
import { VERIFIED_MEANING } from '@/lib/trust';
import { categoryLabel } from '@/lib/categories';
import { placeLine } from '@/lib/countries';
export default function ResourceCard({provider,distance}) {
  const vouchesOn=useVouchesEnabled();
  return <Link to={providerPath(provider)} className="block rounded-xl bg-brand-surface p-5 ring-1 ring-brand-line transition hover:-translate-y-0.5 hover:shadow-md">
    {/* min-w-0 on every flex level that holds text: a flex item will not shrink
        below its content by default, so one long business name pushed the whole
        card past the edge of the phone. break-words lets a single long word
        split rather than set the card's width. */}
    <div className="flex min-w-0 gap-4"><div className="grid h-14 w-14 shrink-0 place-items-center rounded-lg bg-brand-tint font-bold text-brand-teal">{provider.name?.split(' ').map(x=>x[0]).slice(0,2).join('')}</div><div className="min-w-0 flex-1"><div className="flex min-w-0 items-start justify-between gap-2"><h3 className="min-w-0 break-words font-heading text-lg font-bold">{provider.name}</h3>{provider.verified&&<CheckCircle2 title={VERIFIED_MEANING} className="shrink-0 text-brand-gold-ink" size={19}/>}</div><Headline text={provider.tagline}/><p className="text-sm font-medium text-brand-teal">{categoryLabel(provider.category)}{provider.subcategory?` · ${categoryLabel(provider.subcategory)}`:''}</p><p className="mt-1 line-clamp-2 text-sm text-brand-body">{provider.short_description}</p><div className="mt-2 space-y-1.5"><TrustMarks provider={provider} small/><OwnershipPill provider={provider} small/><KitchenPill provider={provider} small/><BadgeChips provider={provider} max={3} small/></div></div></div>
    <div className="mt-4 flex flex-wrap gap-3 border-t pt-3 text-xs text-brand-body"><span className="flex items-center gap-1"><MapPin size={14}/>{distance!=null?`${distance.toFixed(1)} mi · `:''}{placeLine(provider)}</span>{!isSensitiveListing(provider)&&<>{provider.usage_count>0&&<span className="flex items-center gap-1"><Users size={14}/>Used by {provider.usage_count}</span>}{vouchesOn&&provider.vouch_count>0&&<span className="flex items-center gap-1 font-semibold text-brand-gold-ink"><Handshake size={14}/>{provider.vouch_count} {provider.vouch_count===1?'vouch':'vouches'}</span>}</>}</div>{provider.demo&&<span className="mt-3 inline-block rounded-full bg-brand-gold-bg px-2 py-1 text-[10px] font-semibold text-brand-gold-ink">DEMONSTRATION LISTING</span>}
  </Link>;
}