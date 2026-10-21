import React from 'react';
import { UtensilsCrossed } from 'lucide-react';
import { kitchenOf } from '@/lib/kitchen';

// The meat / dairy / fish label on a food listing. Nothing when none is set.
// `kitchen_unconfirmed` marks a "both" filled in from a hechsher's public list
// rather than by the owner: the list says the place serves both, not that the
// kitchens are separate, so the page says to check.
export default function KitchenPill({ provider, small = false }) {
  const k = kitchenOf(provider);
  if (!k) return null;
  const size = small ? 'gap-1 px-2 py-0.5 text-[10px]' : 'gap-1.5 px-3 py-1 text-sm';
  const pill = <span title={k.hint} className={`inline-flex max-w-full items-center rounded-full font-semibold ${size} ${k.pill}`}>
    <UtensilsCrossed size={small ? 10 : 14} className="shrink-0" aria-hidden="true" />
    <span>{k.label}{k.id === 'meat_dairy' && !small && <span className="font-normal"> · separate kitchens</span>}</span>
  </span>;
  if (small || !(k.id === 'meat_dairy' && provider.kitchen_unconfirmed)) return pill;
  return <div>
    {pill}
    <p className="mt-1 text-xs text-brand-muted">From the hechsher's public list. Please check the kitchens with the restaurant yourself.</p>
  </div>;
}
