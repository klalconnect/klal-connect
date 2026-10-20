import React from 'react';
import { BriefcaseBusiness, UserPlus } from 'lucide-react';
import { WORK_STATUSES, workStatusOf } from '@/lib/workStatus';

const ICONS = { open_to_work: BriefcaseBusiness, hiring: UserPlus };

// The see-through tag on the photo: frosted and faintly tinted, so the
// picture shows softly through it, with the status in its colour. Inline because the brand
// colours have no <alpha-value>: bg-brand-surface/80 is never generated.
const GLASS = { background: 'hsl(var(--brand-surface) / 0.78)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' };

function Tag({ status }) {
  const Icon = ICONS[status.id];
  return (
    <span className={`pointer-events-none absolute -bottom-2.5 left-1/2 inline-flex -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-bold leading-none tracking-wide shadow-sm ${status.text}`} style={{ ...GLASS, background: `linear-gradient(${status.color}1a, ${status.color}1a), ${GLASS.background}`, boxShadow: `0 0 0 1px ${status.color}55, 0 2px 6px rgb(0 0 0 / 0.12)` }}>
      {Icon && <Icon size={12} strokeWidth={2.5} aria-hidden="true"/>}{status.label}
    </span>
  );
}

// A coloured frame around an avatar, with a frosted tag on the photo saying
// what it means, our own take on LinkedIn's. Renders its children untouched
// when the member has no status, so callers can wrap an avatar
// unconditionally. `ribbon={false}` keeps just the frame, for photos too
// small for a tag (the name's pill says it there instead).
// Thicker than it looks like it should need to be: avatars already carry a
// 5px box-shadow edge (PHOTO_EDGE) to separate them from whatever they sit
// on, and a box-shadow paints outside the element regardless of a wrapper's
// padding — so only what is left over shows as colour.
export function WorkStatusRing({ user, thickness = 8, ribbon = true, className = '', children }) {
  const status = workStatusOf(user);
  if (!status) return children;
  // inline-block, not the div default: a block box stretches to fill
  // whatever non-flex parent it lands in (a card, a link), turning a ring
  // into a full-width pill the moment rounded-full meets a non-square box.
  return (
    <div className={`relative inline-block rounded-full align-top ${className}`} style={{ padding: thickness, background: status.color }} title={status.label}>
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
