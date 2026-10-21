import React from 'react';
import { WORK_STATUSES, workStatusOf } from '@/lib/workStatus';

// The tag on the photo: a soft pill tinted with the status colour, with a
// small dot in front. color-mix keeps the tint right on both themes' surface.
function Tag({ status }) {
  const c = status.color;
  return (
    <span className={`pointer-events-none absolute -bottom-2.5 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-bold leading-none ${status.text}`} style={{ background: `color-mix(in srgb, ${c} 12%, hsl(var(--brand-surface)))`, boxShadow: `0 0 0 1px color-mix(in srgb, ${c} 35%, transparent), 0 2px 6px rgb(0 0 0 / 0.12)` }}>
      <span className="h-[7px] w-[7px] rounded-full" style={{ background: c, boxShadow: `0 0 0 3px color-mix(in srgb, ${c} 25%, transparent)` }} aria-hidden="true"/>
      {status.label}
    </span>
  );
}

// A soft coloured glow around an avatar, edged by a fine ring and set off
// from the photo by a small gap, with a tag on the photo saying what it
// means: our own take on LinkedIn's frames. Renders its children untouched
// when the member has no status, so callers can wrap an avatar
// unconditionally. `ribbon={false}` keeps just the ring and glow, for photos
// too small for a tag (the name's pill says it there instead).
// `thickness` is the whole space from photo to outer edge; the ring is the
// outer `ring` pixels of it and the rest is the gap, painted the surface
// colour so it reads the same over the cover photo as off it. 5.5 lets the
// ring sit just outside PHOTO_EDGE (4px surface, then a faint 1px line).
// `glow` is how far the colour spreads beyond the ring.
export function WorkStatusRing({ user, thickness = 5.5, ring = 1.5, glow = 16, ribbon = true, className = '', children }) {
  const status = workStatusOf(user);
  if (!status) return children;
  // inline-block, not the div default: a block box stretches to fill
  // whatever non-flex parent it lands in (a card, a link), turning a ring
  // into a full-width pill the moment rounded-full meets a non-square box.
  return (
    <div className={`relative inline-block rounded-full align-top ${className}`} style={{ padding: thickness, background: 'hsl(var(--brand-surface))', boxShadow: `inset 0 0 0 ${ring}px color-mix(in srgb, ${status.color} 75%, transparent), 0 0 ${glow}px ${glow / 4}px color-mix(in srgb, ${status.color} 45%, transparent)` }} title={status.label}>
      {children}
      {ribbon && <Tag status={status}/>}
    </div>
  );
}

// The small text pill that goes next to a name.
export function WorkStatusBadge({ user, className = '' }) {
  const status = workStatusOf(user);
  if (!status) return null;
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${status.badge} ${className}`}>{status.label}</span>;
}

// The edit control: a member sets their own ribbon, or clears it. One at a
// time by design — LinkedIn allows only one frame on a photo at once too.
export function WorkStatusSelect({ value, onChange, className = 'field' }) {
  return (
    <select className={className} value={value || ''} onChange={(e) => onChange(e.target.value)}>
      <option value="">No ribbon</option>
      {Object.values(WORK_STATUSES).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
    </select>
  );
}
