import React from 'react';
import { UtensilsCrossed } from 'lucide-react';
import { kitchenOf } from '@/lib/kitchen';

// The meat / dairy / fish label on a food listing. Nothing when none is set.
export default function KitchenPill({ provider }) {
  const k = kitchenOf(provider);
  if (!k) return null;
  return <span title={k.hint} className={`inline-flex max-w-full items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${k.pill}`}>
    <UtensilsCrossed size={14} className="shrink-0" aria-hidden="true" />
    <span>{k.label}{k.id === 'meat_dairy' && <span className="font-normal"> · separate kitchens</span>}</span>
  </span>;
}
