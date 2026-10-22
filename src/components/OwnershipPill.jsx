import React from 'react';
import { Info } from 'lucide-react';

// "Not Jewish owned", as picked on the listing form. Jewish owned is the
// default and shows nothing, so most listings carry no pill at all.
export default function OwnershipPill({ provider, small = false }) {
  if (provider?.not_jewish_owned !== true) return null;
  const size = small ? 'gap-1 px-2 py-0.5 text-[10px]' : 'gap-1.5 px-3 py-1 text-sm';
  return <span className={`inline-flex max-w-full items-center rounded-full font-semibold ${size} bg-slate-100 text-slate-700 ring-1 ring-slate-300 dark:bg-slate-400/10 dark:text-slate-300 dark:ring-slate-400/30`}>
    <Info size={small ? 10 : 14} className="shrink-0" aria-hidden="true" />
    <span>Not Jewish owned</span>
  </span>;
}
