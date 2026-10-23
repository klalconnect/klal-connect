import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Pin, X } from 'lucide-react';
import { api } from '@/api/client';
import { Mark } from '@/components/Brand';
import { isLiveAnnouncement, showsOnTab, tabPage } from '@/lib/announcements';

// The pinned "Klal Team" card on top of a tab's front page. Admins write
// these in Admin → Announcements. A visitor can close one; it stays closed for
// them on this device, and a new announcement shows again.
const CLOSED_KEY = 'kc_closed_announcements';
const readClosed = () => {
  try { return JSON.parse(localStorage.getItem(CLOSED_KEY) || '[]'); } catch { return []; }
};

// One fetch shared by every tab, refreshed at most once a minute, so moving
// between tabs does not ask the server each time.
let cache = { rows: null, at: 0, pending: null };
const REFRESH_MS = 60_000;
export function forgetAnnouncements() { cache = { rows: null, at: 0, pending: null }; }
function loadAnnouncements() {
  if (cache.rows && Date.now() - cache.at < REFRESH_MS) return Promise.resolve(cache.rows);
  cache.pending ??= api.entities.Announcement.list('-created_date', 20)
    .then((rows) => { cache = { rows: rows || [], at: Date.now(), pending: null }; return cache.rows; })
    .catch(() => { cache.pending = null; return cache.rows || []; });
  return cache.pending;
}

// Only a web address or a page on this site. Anything else (javascript:…)
// is not a link.
export function announcementHref(url) {
  const u = String(url || '').trim();
  if (!u) return null;
  if (u.startsWith('/') && !u.startsWith('//')) return { internal: true, href: u };
  if (/^https?:\/\//i.test(u)) return { internal: false, href: u };
  if (/^[\w-]+(\.[\w-]+)+(\/|$)/.test(u)) return { internal: false, href: `https://${u}` };
  return null;
}

export function AnnouncementCard({ a, onClose }) {
  const link = announcementHref(a.link_url);
  const label = (a.link_label || '').trim() || 'Learn more';
  const button = 'inline-flex items-center rounded-xl bg-brand-navy px-4 py-2 text-sm font-bold text-white hover:bg-brand-navy-hover';
  return <article className="relative rounded-xl bg-brand-surface p-4 ring-1 ring-brand-teal/40 sm:p-5" aria-label="Announcement from The Klal Team">
    <div className="flex items-start gap-3">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-teal/15 text-brand-teal"><Mark className="h-6 w-6" /></span>
      <div className="min-w-0 flex-1 pr-6">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm"><b className="text-brand-ink">The Klal Team</b><span className="inline-flex items-center gap-1 text-xs font-semibold text-brand-teal"><Pin size={12} />Pinned</span></p>
        {a.title && <h2 className="mt-1.5 font-display text-lg font-bold leading-snug text-brand-ink">{a.title}</h2>}
        {a.body && <p className="mt-1 whitespace-pre-line text-sm text-brand-body">{a.body}</p>}
        {link && <div className="mt-3">{link.internal ? <Link to={link.href} className={button}>{label}</Link> : <a href={link.href} target="_blank" rel="noopener noreferrer" className={button}>{label}</a>}</div>}
      </div>
    </div>
    {onClose && <button type="button" onClick={onClose} aria-label="Close this announcement" className="icon-button absolute right-2 top-2"><X size={16} /></button>}
  </article>;
}

export default function AnnouncementBanner() {
  const { pathname } = useLocation();
  const tab = tabPage(pathname);
  const [rows, setRows] = useState(cache.rows || []);
  const [closed, setClosed] = useState(readClosed);
  useEffect(() => {
    if (!tab) return;
    let live = true;
    loadAnnouncements().then((r) => { if (live) setRows(r); });
    return () => { live = false; };
  }, [tab]);
  const now = Date.now();
  const shown = rows.filter((a) => isLiveAnnouncement(a, now) && showsOnTab(a, tab) && !closed.includes(a.id));
  if (!tab || !shown.length) return null;
  const close = (id) => {
    const next = [...closed, id].slice(-50);
    setClosed(next);
    try { localStorage.setItem(CLOSED_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  };
  return <div className="page-shell space-y-3 pt-4 md:pt-6">{shown.map((a) => <AnnouncementCard key={a.id} a={a} onClose={() => close(a.id)} />)}</div>;
}
