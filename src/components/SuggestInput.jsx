import React, { useEffect, useId, useRef, useState } from 'react';
import { Search, MapPin, LayoutGrid, Building2, User, Briefcase, X } from 'lucide-react';

// A text box that offers suggestions as you type, for every search on the
// site. Callers decide what to suggest; this owns the list itself: keyboard
// (arrows, Enter, Escape), tap and click, closing when focus moves on, and
// letting Enter submit the search as typed when nothing is highlighted.
//
// suggest(text) returns the items to show right away, from what the page
// already has. suggestMore(text), when given, is a slower lookup (the place
// list on the server) that is debounced and added underneath.
//
// An X at the end of the box clears it in one tap, instead of deleting
// letter by letter; it shows only when there is something to clear.
//
// An item is { label, group?, hint?, count?, kind? }. Picking one calls
// onPick(item); the caller decides whether that fills the box, sets a filter
// or opens a page.
const ICONS = { category: LayoutGrid, place: MapPin, listing: Building2, person: User, job: Briefcase, company: Building2 };

export default function SuggestInput({
  value,
  onChange,
  onPick,
  suggest,
  suggestMore,
  className = 'field',
  wrapperClassName = '',
  minLength = 1,
  ...rest
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [more, setMore] = useState([]);
  const box = useRef(null);
  const input = useRef(null);
  const latest = useRef(0);
  const listId = useId();

  const typed = String(value || '').trim();
  const ready = open && typed.length >= minLength;
  const quick = ready && suggest ? suggest(typed) || [] : [];

  useEffect(() => {
    if (!ready || !suggestMore) { setMore([]); return; }
    const mine = ++latest.current;
    const timer = setTimeout(async () => {
      try {
        const rows = await suggestMore(typed);
        if (latest.current === mine) setMore(Array.isArray(rows) ? rows : []);
      } catch {
        if (latest.current === mine) setMore([]);
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [typed, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const seen = new Set(quick.map((i) => `${i.kind}:${String(i.label).toLowerCase()}`));
  const items = [...quick, ...more.filter((i) => !seen.has(`${i.kind}:${String(i.label).toLowerCase()}`))].slice(0, 12);

  // Clicking anywhere else closes the list.
  useEffect(() => {
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, []);

  const choose = (item) => {
    setOpen(false);
    setActive(-1);
    onPick?.(item);
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (!items.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => (i + 1) % items.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i <= 0 ? items.length : i) - 1); }
    // With nothing highlighted, Enter searches for what was typed, as before.
    else if (e.key === 'Enter') {
      if (active >= 0 && items[active]) { e.preventDefault(); choose(items[active]); }
      else setOpen(false);
    }
  };

  const show = ready && items.length > 0;
  let lastGroup = null;

  return (
    <div ref={box} className={`relative ${wrapperClassName}`}>
      <input
        ref={input}
        className={`${className} pr-9`}
        value={value || ''}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setActive(-1); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        onBlur={() => setOpen(false)}
        autoComplete="off"
        role="combobox"
        aria-expanded={show}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={show && active >= 0 ? `${listId}-${active}` : undefined}
        {...rest}
      />
      {value && (
        <button
          type="button"
          aria-label="Clear"
          // Keeps the keyboard up on a phone, ready for the next search.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => { onChange(''); setActive(-1); input.current?.focus(); }}
          className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-brand-muted hover:bg-brand-tint hover:text-brand-ink"
        >
          <X size={16} />
        </button>
      )}
      {/* See-through, like the back-to-top arrow: the blur keeps it readable
          over whatever is behind it, in both themes. */}
      {show && (
        <ul id={listId} role="listbox" className="absolute left-0 right-0 z-40 mt-1 max-h-80 min-w-[16rem] overflow-y-auto rounded-xl border border-brand-line/50 bg-brand-surface/55 py-1 text-left shadow-lg backdrop-blur-md backdrop-saturate-150">
          {items.map((item, i) => {
            const heading = item.group && item.group !== lastGroup ? item.group : null;
            lastGroup = item.group;
            const Icon = ICONS[item.kind] || Search;
            return (
              <React.Fragment key={`${item.kind}:${item.label}:${i}`}>
                {heading && <li role="presentation" className="px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wide text-brand-muted">{heading}</li>}
                <li id={`${listId}-${i}`} role="option" aria-selected={i === active}>
                  <button
                    type="button"
                    tabIndex={-1}
                    onMouseEnter={() => setActive(i)}
                    // Keeps focus in the input, so its onBlur does not close the
                    // list before this tap lands (Safari never focuses buttons).
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(item)}
                    className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm ${i === active ? 'bg-brand-tint text-brand-ink' : 'text-brand-body'}`}
                  >
                    <Icon size={15} className="shrink-0 text-brand-teal" />
                    <span className="min-w-0 flex-1 truncate">
                      <Highlight text={item.label} part={typed} />
                      {item.hint && <span className="ml-1.5 text-xs text-brand-muted">{item.hint}</span>}
                    </span>
                    {item.count > 0 && <span className="shrink-0 text-xs text-brand-muted">{item.count}</span>}
                  </button>
                </li>
              </React.Fragment>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// The part that was typed, in bold, where the word starts with it.
function Highlight({ text, part }) {
  const s = String(text || '');
  const p = String(part || '').toLowerCase();
  const lower = s.toLowerCase();
  let at = -1;
  for (let i = lower.indexOf(p); p && i !== -1; i = lower.indexOf(p, i + 1)) {
    if (i === 0 || !/[a-z0-9]/i.test(lower[i - 1])) { at = i; break; }
  }
  if (at < 0) return <span className="text-brand-ink">{s}</span>;
  return <span className="text-brand-ink">{s.slice(0, at)}<b className="font-bold">{s.slice(at, at + p.length)}</b>{s.slice(at + p.length)}</span>;
}
