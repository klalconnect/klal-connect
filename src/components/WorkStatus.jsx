import React from 'react';
import { WORK_STATUSES, workStatusOf } from '@/lib/workStatus';

// The ribbon's geometry, in a 100×100 box laid over the framed photo. The
// band hugs the outer edge and its words run along it, centred low on the
// left so the camera button (bottom right, on your own profile) stays clear.
const CENTER = 135; // degrees, clockwise from 3 o'clock
const OUTER = 50, INNER = 34, TEXT_R = 41.6, FONT = 7.2;
const point = (r, deg) => {
  const a = (deg * Math.PI) / 180;
  return `${(50 + r * Math.cos(a)).toFixed(2)} ${(50 + r * Math.sin(a)).toFixed(2)}`;
};

function Ribbon({ status }) {
  const text = status.label.toUpperCase();
  // Long enough for the words, which decides how far round the band goes:
  // about 5.6 units a letter at this size, plus a tapered end on each side.
  const half = Math.min(76, ((text.length * 5.6) / TEXT_R) * (90 / Math.PI) + 4);
  const band = `M ${point(OUTER, CENTER + half + 12)} A ${OUTER} ${OUTER} 0 0 0 ${point(OUTER, CENTER - half - 12)} L ${point(INNER, CENTER - half)} A ${INNER} ${INNER} 0 0 1 ${point(INNER, CENTER + half)} Z`;
  const id = `ribbon${React.useId().replace(/:/g, '')}`;
  return (
    <svg viewBox="0 0 100 100" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
      <path d={band} fill={status.color}/>
      <path id={id} d={`M ${point(TEXT_R, CENTER + half + 6)} A ${TEXT_R} ${TEXT_R} 0 0 0 ${point(TEXT_R, CENTER - half - 6)}`} fill="none"/>
      <text fill="#fff" fontSize={FONT} fontWeight="800" letterSpacing="0.5" style={{ fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
        <textPath href={`#${id}`} startOffset="50%" textAnchor="middle" dominantBaseline="central">{text}</textPath>
      </text>
    </svg>
  );
}

// A coloured frame around an avatar, with the status written along it like
// LinkedIn's. Renders its children untouched when the member has no status,
// so callers can wrap an avatar unconditionally. `ribbon={false}` keeps just
// the frame, for photos too small for the words to be read (the name's pill
// says it there instead).
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
      {ribbon && <Ribbon status={status}/>}
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
