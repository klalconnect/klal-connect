import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { countriesFrom } from '@/lib/countries';

// The Country filter beside the Where box: Everywhere, then each country that
// has listings, with how many. A country with nothing listed is never offered.
//
// The numbers are for choosing: once a country is picked the closed box says
// just "United States", not "United States (7524)". A select shows its chosen
// option's own text, so the name alone is drawn over that text, on the box's
// own background, leaving the arrow; the list that opens still has every count.
// Big numbers are rounded down to the hundred below and given a plus, so they
// read at a glance and never overstate: 7524 is "7.5k+", 1433 "1.4k+", 432
// stays 432.
export function shortCount(n) {
  if (n < 1000) return String(n);
  return `${Math.floor(n / 100) / 10}k+`;
}

// Phones keep the native select: it opens the phone's own picker, which suits
// a thumb. On a computer the browser draws a native list of ~90 countries as
// tall as the screen, so there the list is our own: a normal-height box that
// scrolls inside itself, like the suggestion lists under the search boxes.
function usePointerList() {
  const query = '(hover: hover) and (pointer: fine)';
  const [fine, setFine] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const m = window.matchMedia?.(query);
    if (!m) return undefined;
    const update = () => setFine(m.matches);
    m.addEventListener?.('change', update);
    return () => m.removeEventListener?.('change', update);
  }, []);
  return fine;
}

export default function CountrySelect({ providers = [], value = '', onChange, className = 'field', wrapperClassName = '', labelClassName = 'left-0 right-4', ...rest }) {
  const countries = useMemo(() => countriesFrom(providers), [providers]);
  const fine = usePointerList();
  const options = useMemo(() => {
    const list = [{ value: '', name: 'Everywhere' }];
    // A country from a link that has nothing listed (yet) still shows as chosen.
    if (value && !countries.some((c) => c.country === value)) list.push({ value, name: value });
    for (const { country, count } of countries) list.push({ value: country, name: country, count: shortCount(count) });
    return list;
  }, [countries, value]);

  if (fine) return <CountryList options={options} value={value} onChange={onChange} className={className} wrapperClassName={wrapperClassName} {...rest} />;

  return <span className={`relative block min-w-0 ${wrapperClassName}`}>
    <select className={className} value={value} onChange={(e) => onChange(e.target.value)} aria-label="Country" {...rest}>
      {options.map((o) => <option key={o.value || 'everywhere'} value={o.value}>{o.count ? `${o.name} (${o.count})` : o.name}</option>)}
    </select>
    <span aria-hidden="true" className={`pointer-events-none absolute top-1/2 -translate-y-1/2 truncate bg-brand-surface text-brand-ink ${labelClassName}`}>{value || 'Everywhere'}</span>
  </span>;
}

// The computer version: a button that shows the chosen country, and a list
// that opens under it. Arrows move, Enter picks, Escape closes, and typing a
// letter jumps to the first country starting with it. Picking closes it.
function CountryList({ options, value, onChange, className, wrapperClassName, ...rest }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef(null);
  const list = useRef(null);
  const listId = useId();
  const chosen = Math.max(0, options.findIndex((o) => o.value === value));

  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  useEffect(() => {
    if (open) list.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const show = () => { setActive(chosen); setOpen(true); };
  const pick = (o) => { setOpen(false); if (o.value !== value) onChange(o.value); };

  const onKeyDown = (e) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); show(); }
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
    else if (e.key === 'Tab') setOpen(false);
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(options.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(options.length - 1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(options[active]); }
    else if (/^[a-z]$/i.test(e.key)) {
      const letter = e.key.toLowerCase();
      const next = options.findIndex((o, i) => i > active && o.name.toLowerCase().startsWith(letter));
      const first = options.findIndex((o) => o.name.toLowerCase().startsWith(letter));
      const to = next >= 0 ? next : first;
      if (to >= 0) setActive(to);
    }
  };

  return <span ref={box} className={`relative block min-w-0 ${wrapperClassName}`}>
    <button type="button" className={`flex items-center gap-2 text-left ${className}`} aria-label="Country" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
      aria-activedescendant={open ? `${listId}-${active}` : undefined}
      onClick={() => (open ? setOpen(false) : show())} onKeyDown={onKeyDown} {...rest}>
      <span className="min-w-0 flex-1 truncate text-brand-ink">{options[chosen]?.name || 'Everywhere'}</span>
      <ChevronDown size={16} className={`shrink-0 text-brand-muted transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
    {/* Lightly see-through, like the search suggestion lists but more solid
        so a long list stays easy to read, and no taller than
        about eight rows: the rest scrolls inside the box. */}
    {open && (
      <ul ref={list} id={listId} role="listbox" aria-label="Country" className="absolute left-0 z-40 mt-1 max-h-72 w-full min-w-[16rem] overflow-y-auto rounded-xl border border-brand-line/50 bg-brand-surface/90 py-1 text-left shadow-lg backdrop-blur-md backdrop-saturate-150">
        {options.map((o, i) => <li key={o.value || 'everywhere'} id={`${listId}-${i}`} role="option" aria-selected={i === chosen}>
          <button type="button" tabIndex={-1} onMouseEnter={() => setActive(i)} onMouseDown={(e) => e.preventDefault()} // On Home and Resources the box sits inside a <label>; without
            // preventDefault the label would click the button and reopen the list.
            onClick={(e) => { e.preventDefault(); pick(o); }}
            className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm ${i === active ? 'bg-brand-tint text-brand-ink' : 'text-brand-body'}`}>
            <Check size={15} className={`shrink-0 text-brand-teal ${i === chosen ? '' : 'invisible'}`} />
            <span className="min-w-0 flex-1 truncate">{o.name}</span>
            {o.count && <span className="shrink-0 text-xs text-brand-muted">{o.count}</span>}
          </button>
        </li>)}
      </ul>
    )}
  </span>;
}
