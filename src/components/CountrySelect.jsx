import React, { useMemo } from 'react';
import { countriesFrom } from '@/lib/countries';

// The Country filter beside the Where box: Everywhere, then each country that
// has listings, with how many. A country with nothing listed is never offered.
//
// The numbers are for choosing: once a country is picked the closed box says
// just "United States", not "United States (7524)". A select shows its chosen
// option's own text, so the name alone is drawn over that text, on the box's
// own background, leaving the arrow; the list that opens still has every count.
export default function CountrySelect({ providers = [], value = '', onChange, className = 'field', wrapperClassName = '', labelClassName = 'left-0 right-4', ...rest }) {
  const countries = useMemo(() => countriesFrom(providers), [providers]);
  return <span className={`relative block min-w-0 ${wrapperClassName}`}>
    <select className={className} value={value} onChange={(e) => onChange(e.target.value)} aria-label="Country" {...rest}>
      <option value="">Everywhere</option>
      {/* A country from a link that has nothing listed (yet) still shows as chosen. */}
      {value && !countries.some((c) => c.country === value) && <option value={value}>{value}</option>}
      {countries.map(({ country, count }) => <option key={country} value={country}>{country} ({count})</option>)}
    </select>
    <span aria-hidden="true" className={`pointer-events-none absolute top-1/2 -translate-y-1/2 truncate bg-brand-surface text-brand-ink ${labelClassName}`}>{value || 'Everywhere'}</span>
  </span>;
}
