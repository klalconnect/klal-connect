import React from 'react';
import { Plus, Check } from 'lucide-react';

// A row of tap-to-pick pills, LinkedIn style, so people choose instead of
// typing. A picked pill turns solid teal with a tick; tapping it again takes
// it off. The text box beside it stays for anything not on the list.
export default function PickPills({ label = 'Tap to add', options, isPicked = () => false, onPick }) {
  if (!options.length) return null;
  return <div>
    <p className="mb-1.5 text-xs font-semibold text-brand-muted">{label}</p>
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = isPicked(o);
        return <button
          key={o}
          type="button"
          onClick={() => onPick(o)}
          aria-pressed={on}
          className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-medium ring-1 transition ${on ? 'bg-brand-teal text-brand-canvas ring-brand-teal' : 'bg-brand-surface text-brand-ink ring-brand-line hover:ring-brand-teal'}`}
        >{on ? <Check size={13}/> : <Plus size={13} className="text-brand-teal"/>}{o}</button>;
      })}
    </div>
  </div>;
}

// For the comma-separated fields on the listing form: is `item` in the text,
// and the text with it added or taken out.
const parts = (text) => String(text || '').split(',').map((x) => x.trim()).filter(Boolean);
export const inList = (text, item) => parts(text).some((x) => x.toLowerCase() === item.toLowerCase());
export const toggleInList = (text, item) => {
  const list = parts(text);
  return (inList(text, item) ? list.filter((x) => x.toLowerCase() !== item.toLowerCase()) : [...list, item]).join(', ');
};
