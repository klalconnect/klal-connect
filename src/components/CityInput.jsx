import React, { useEffect, useRef, useState } from 'react';
import { MapPin, Loader2 } from 'lucide-react';
import { api } from '@/api/client';

// A city field that suggests as you type, instead of hoping everyone spells
// "Kew Gardens Hills" the same way. Suggestions come from /api/geo/search,
// which answers from the curated community list — so "rbs" finds Beit Shemesh
// and a full street address finds its city.
//
// Picking a suggestion hands the caller the whole place (coordinates, time
// zone, country) so a city can also set the Shabbos location; typing
// something not on the list is still allowed, because a directory should not
// refuse a town nobody thought of.
export default function CityInput({
  value,
  onChange,
  onPick,
  placeholder = 'Lakewood, Brooklyn, Jerusalem…',
  className = 'field',
  id,
  autoFocus,
  onBlur,
  // What to say after "type it as you say it" when a town is not found. A
  // guest has no Settings to point to.
  missHint = 'Shabbos times can be set in Settings.',
  ...rest
}) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState([]);
  const [active, setActive] = useState(-1);
  // One state rather than separate busy/failed flags, because the in-between
  // moments are what went wrong: a stale failure message survived into the next
  // lookup, and clearing it eagerly flashed "not on our list" during the
  // debounce, before anything had been asked. The note is shown only once a
  // lookup has settled for what is currently typed.
  // 'idle' | 'loading' | 'none' | 'failed'
  const [state, setState] = useState('idle');
  const busy = state === 'loading';
  const box = useRef(null);
  const latest = useRef(0);

  const typed = String(value || '').trim();

  // Debounced so a fast typist does not fire a request per keystroke.
  useEffect(() => {
    const q = typed;
    if (!open || q.length < 2) { setOptions([]); setState('idle'); return; }
    const mine = ++latest.current;
    setState('loading');
    const timer = setTimeout(async () => {
      try {
        const rows = await api.geo.search(q, 6);
        if (latest.current !== mine) return;
        const list = Array.isArray(rows) ? rows : [];
        setOptions(list);
        setState(list.length ? 'idle' : 'none');
      } catch {
        // Swallowing this silently was the whole problem: in production the
        // external geocoder is deliberately unusable (Nominatim 403s traffic it
        // cannot attribute), so anyone outside the curated communities typed
        // their town and got nothing at all — no list, no error, no reason.
        if (latest.current !== mine) return;
        setOptions([]);
        setState('failed');
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [typed, open]);

  // Clicking anywhere else closes the list.
  useEffect(() => {
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, []);

  const choose = (p) => {
    onChange(p.city || p.label || '');
    onPick?.(p);
    setOpen(false);
    setOptions([]);
    setActive(-1);
  };

  const onKeyDown = (e) => {
    if (!options.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % options.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i <= 0 ? options.length : i) - 1); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); choose(options[active]); }
    else if (e.key === 'Escape') { setOpen(false); }
  };

  return (
    <div ref={box} className="relative">
      <input
        id={id}
        className={className}
        value={value || ''}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setActive(-1); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        // Tabbing on to the next field left the list hanging open over it.
        // Picking with the mouse does not blur (see the option's onMouseDown).
        // A caller's own onBlur (onboarding saves the city) runs as well,
        // rather than replacing this one and leaving the list open.
        onBlur={(e) => { setOpen(false); onBlur?.(e); }}
        placeholder={placeholder}
        autoComplete="off"
        autoFocus={autoFocus}
        role="combobox"
        aria-expanded={open && options.length > 0}
        aria-autocomplete="list"
        {...rest}
      />
      {busy && <Loader2 size={15} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-brand-muted" />}
      {/* Typing a town nobody listed is allowed — this says so, instead of
          leaving an empty box that looks broken. Either way the city is saved as
          typed; only the exact zmanim need a known place. */}
      {open && (state === 'none' || state === 'failed') && (
        <p className="mt-1 text-xs leading-5 text-brand-muted">
          {state === 'failed'
            ? `We cannot reach the place lookup right now — type your town as you say it and carry on. ${missHint}`
            : `Not on our list yet — type it as you say it and carry on. ${missHint}`}
        </p>
      )}
      {open && options.length > 0 && (
        <ul className="absolute z-30 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-brand-line bg-brand-surface py-1 shadow-lg" role="listbox">
          {options.map((p, i) => (
            <li key={`${p.latitude},${p.longitude},${p.label}`} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                // Keeps focus in the input, so its onBlur does not close the
                // list before this click lands (Safari never focuses buttons).
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(p)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${i === active ? 'bg-brand-tint text-brand-ink' : 'text-brand-body'}`}
              >
                <MapPin size={14} className="shrink-0 text-brand-teal" />
                <span className="min-w-0 flex-1 truncate">{placeText(p)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// "Jerusalem, IL" reads as Illinois to anyone in America, so a place outside
// the US is shown with its country spelled out: "Jerusalem, Israel".
const countryNames = (() => { try { return new Intl.DisplayNames(['en'], { type: 'region' }); } catch { return null; } })();
function placeText(p) {
  const cc = String(p.country_code || '').toUpperCase();
  if (!p.city || !cc || cc === 'US') return p.label || p.city;
  let country = cc;
  try { country = countryNames?.of(cc) || cc; } catch { /* unknown code */ }
  return [p.city, p.region, country].filter(Boolean).join(', ');
}

// US states and the other places Klal has members, so a listing's region is
// picked rather than typed three different ways.
export const US_STATES = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'],
  ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'], ['DC', 'District of Columbia'],
  ['FL', 'Florida'], ['GA', 'Georgia'], ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IL', 'Illinois'],
  ['IN', 'Indiana'], ['IA', 'Iowa'], ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'],
  ['ME', 'Maine'], ['MD', 'Maryland'], ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'],
  ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'], ['NV', 'Nevada'],
  ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'], ['NY', 'New York'],
  ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'], ['OK', 'Oklahoma'], ['OR', 'Oregon'],
  ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'], ['SC', 'South Carolina'], ['SD', 'South Dakota'],
  ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'],
  ['WA', 'Washington'], ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
];

const ELSEWHERE = [
  ['IL-JM', 'Israel'], ['ON', 'Ontario'], ['QC', 'Quebec'], ['UK', 'United Kingdom'],
  ['VIC', 'Victoria (AU)'], ['NSW', 'New South Wales (AU)'], ['ZA', 'South Africa'], ['OTHER', 'Elsewhere'],
];

// The State choice for a picked place. Places outside the US mostly carry no
// region, and keeping whatever was chosen before left "Jerusalem, New Jersey".
const BY_COUNTRY = { IL: 'IL-JM', GB: 'UK', ZA: 'ZA' };
export function stateForPlace(p, current = '') {
  const region = String(p?.region || '').toUpperCase();
  if (region && [...US_STATES, ...ELSEWHERE].some(([code]) => code === region)) return region;
  const country = String(p?.country_code || '').toUpperCase();
  if (BY_COUNTRY[country]) return BY_COUNTRY[country];
  if (country && country !== 'US') return 'OTHER';
  return current;
}

const KNOWN = new Set([...US_STATES, ...ELSEWHERE].map(([code]) => code));

// A select rather than a free-text box: "NY", "N.Y.", "New York" and "new
// york" were four different states as far as any search was concerned.
export function StateSelect({ value, onChange, className = 'field', id, ...rest }) {
  return (
    <select id={id} className={className} value={value || ''} onChange={(e) => onChange(e.target.value)} {...rest}>
      <option value="">Choose…</option>
      {/* A state saved before this was a list ("New York", "Fla.") would
          otherwise show as "Choose…" while still being saved. */}
      {value && !KNOWN.has(value) && <option value={value}>{value}</option>}
      <optgroup label="United States">
        {US_STATES.map(([code, name]) => <option key={code} value={code}>{name} ({code})</option>)}
      </optgroup>
      <optgroup label="Outside the US">
        {ELSEWHERE.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
      </optgroup>
    </select>
  );
}
