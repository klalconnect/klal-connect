import React, { useEffect, useState } from 'react';
import { Megaphone, Pin, PinOff, Pencil, Trash2, Loader2 } from 'lucide-react';
import { api } from '@/api/client';
import ConfirmDialog from '@/components/admin/ConfirmDialog';
import { AnnouncementCard, announcementHref, forgetAnnouncements } from '@/components/AnnouncementBanner';
import { ANNOUNCEMENT_TABS, isLiveAnnouncement } from '@/lib/announcements';

// Admin → Announcements: write a pinned post from "The Klal Team", choose the
// tabs it sits on top of, and unpin it or let it end on a date.
const EMPTY = { title: '', body: '', link_url: '', link_label: '', tabs: ['all'], ends_on: '' };

// The end date is picked as a day; it ends at the end of that day, the
// admin's own time.
const endOfDay = (day) => (day ? new Date(`${day}T23:59:59`).toISOString() : '');
const dayOf = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const niceDate = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const tabsLabel = (tabs = []) => (tabs.includes('all') ? 'Every tab' : tabs.join(', ') || 'No tabs');

function statusOf(a) {
  if (isLiveAnnouncement(a)) return { text: a.ends_at ? `Showing until ${niceDate(a.ends_at)}` : 'Showing until you unpin it', live: true };
  if (a.pinned === false) return { text: 'Unpinned', live: false };
  return { text: `Ended ${niceDate(a.ends_at)}`, live: false };
}

export default function AnnouncementsPanel() {
  const [rows, setRows] = useState(null), [form, setForm] = useState(EMPTY), [editing, setEditing] = useState(null), [busy, setBusy] = useState(false), [err, setErr] = useState(''), [confirm, setConfirm] = useState(null);
  useEffect(() => { api.entities.Announcement.list('-created_date').then(setRows).catch(() => setRows([])); }, []);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const allTabs = form.tabs.includes('all');
  const toggleTab = (tab) => setForm((f) => {
    if (tab === 'all') return { ...f, tabs: allTabs ? [] : ['all'] };
    const picked = f.tabs.filter((t) => t !== 'all');
    return { ...f, tabs: picked.includes(tab) ? picked.filter((t) => t !== tab) : ANNOUNCEMENT_TABS.filter((t) => t === tab || picked.includes(t)) };
  });
  const linkBad = form.link_url.trim() && !announcementHref(form.link_url);
  const ready = (form.title.trim() || form.body.trim()) && form.tabs.length && !linkBad;
  const saved = (row) => { forgetAnnouncements(); setRows((rs) => [row, ...(rs || []).filter((x) => x.id !== row.id)]); };
  const save = async () => {
    if (!ready || busy) return;
    setBusy(true); setErr('');
    const data = { title: form.title.trim(), body: form.body.trim(), link_url: form.link_url.trim(), link_label: form.link_label.trim(), tabs: form.tabs, ends_at: endOfDay(form.ends_on), pinned: true };
    try {
      saved(editing ? await api.entities.Announcement.update(editing, data) : await api.entities.Announcement.create(data));
      setForm(EMPTY); setEditing(null);
    } catch (e) { setErr(e.message || 'That did not save. Please try again.'); }
    setBusy(false);
  };
  const edit = (a) => { setEditing(a.id); setForm({ title: a.title || '', body: a.body || '', link_url: a.link_url || '', link_label: a.link_label || '', tabs: a.tabs?.length ? a.tabs : ['all'], ends_on: dayOf(a.ends_at) }); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  // Pinning again an announcement that already ended clears its end date,
  // or it would go straight back to "Ended".
  const setPinned = async (a, pinned) => {
    try { saved(await api.entities.Announcement.update(a.id, pinned && !isLiveAnnouncement({ ...a, pinned: true }) ? { pinned, ends_at: '' } : { pinned })); }
    catch (e) { alert(e.message || 'That did not save. Please try again.'); }
  };
  const askDelete = (a) => setConfirm({ a });
  const preview = { title: form.title.trim() || (form.body.trim() ? '' : 'Your headline'), body: form.body.trim() || (form.title.trim() ? '' : 'What you want everyone to know.'), link_url: linkBad ? '' : form.link_url, link_label: form.link_label };

  return <div className="space-y-4">
    <div className="panel space-y-4">
      <div>
        <h2 className="section-title flex items-center gap-2"><Megaphone size={18} />{editing ? 'Edit announcement' : 'New announcement'}</h2>
        <p className="helper">Pins a post from <b>The Klal Team</b> to the top of the tabs you pick, for big news or a new feature. Visitors can close it with the X.</p>
      </div>
      <label className="block text-sm font-semibold text-brand-ink">Headline
        <input className="field" value={form.title} onChange={set('title')} maxLength={120} placeholder="New: kosher kitchen labels on every restaurant" />
      </label>
      <label className="block text-sm font-semibold text-brand-ink">Message
        <textarea className="field min-h-[96px]" value={form.body} onChange={set('body')} maxLength={1000} placeholder="A sentence or two about what is new." />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-semibold text-brand-ink">Button link <span className="font-normal text-brand-muted">(optional)</span>
          <input className="field" value={form.link_url} onChange={set('link_url')} placeholder="/browse or https://…" inputMode="url" autoCapitalize="off" />
          {linkBad && <span className="mt-1 block text-xs font-semibold text-brand-error">Use a web address (https://…) or a page on Klal starting with /.</span>}
        </label>
        <label className="block text-sm font-semibold text-brand-ink">Button words <span className="font-normal text-brand-muted">(optional)</span>
          <input className="field" value={form.link_label} onChange={set('link_label')} maxLength={40} placeholder="Learn more" />
        </label>
      </div>
      <fieldset>
        <legend className="text-sm font-semibold text-brand-ink">Show it on</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {['all', ...ANNOUNCEMENT_TABS].map((tab) => {
            const on = tab === 'all' ? allTabs : !allTabs && form.tabs.includes(tab);
            return <button type="button" key={tab} aria-pressed={on} onClick={() => toggleTab(tab)} className={`rounded-full px-3.5 py-1.5 text-sm font-semibold ring-1 ${on ? 'bg-brand-teal text-brand-canvas ring-brand-teal' : 'bg-brand-surface text-brand-ink ring-brand-line hover:bg-brand-tint'}`}>{tab === 'all' ? 'Every tab' : tab}</button>;
          })}
        </div>
        {!form.tabs.length && <p className="mt-1 text-xs font-semibold text-brand-error">Pick at least one tab.</p>}
      </fieldset>
      <label className="block text-sm font-semibold text-brand-ink">Take it down on <span className="font-normal text-brand-muted">(optional, otherwise it stays until you unpin it)</span>
        <input type="date" className="field sm:w-60" value={form.ends_on} min={dayOf(new Date().toISOString())} onChange={set('ends_on')} />
      </label>
      <div>
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-brand-muted">How it will look</p>
        <AnnouncementCard a={preview} />
      </div>
      {err && <p className="text-sm font-semibold text-brand-error">{err}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={save} disabled={!ready || busy} className="inline-flex items-center gap-2 rounded-xl bg-brand-navy px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-navy-hover disabled:cursor-not-allowed disabled:opacity-50">{busy ? <Loader2 size={16} className="animate-spin" /> : <Pin size={16} />}{editing ? 'Save changes' : 'Pin it'}</button>
        {editing && <button type="button" onClick={() => { setEditing(null); setForm(EMPTY); }} className="secondary py-2">Cancel</button>}
      </div>
    </div>

    <div className="panel">
      <h2 className="section-title">Your announcements</h2>
      {rows === null ? <p className="helper">Loading…</p> : !rows.length ? <p className="helper">None yet. The one you pin above shows here.</p> : <ul className="mt-2 divide-y divide-brand-line">
        {rows.map((a) => {
          const s = statusOf(a);
          return <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm">
            <div className="min-w-0">
              <p className="font-semibold text-brand-ink">{a.title || a.body?.slice(0, 80)}</p>
              <p className="text-xs text-brand-muted">{tabsLabel(a.tabs)} · <span className={s.live ? 'font-semibold text-brand-teal' : ''}>{s.text}</span></p>
            </div>
            <span className="flex flex-wrap gap-2">
              <button type="button" onClick={() => edit(a)} className="secondary py-1 text-xs"><Pencil size={13} />Edit</button>
              {s.live ? <button type="button" onClick={() => setPinned(a, false)} className="secondary py-1 text-xs"><PinOff size={13} />Unpin</button> : <button type="button" onClick={() => setPinned(a, true)} className="secondary py-1 text-xs"><Pin size={13} />Pin again</button>}
              <button type="button" onClick={() => askDelete(a)} className="secondary py-1 text-xs text-brand-error"><Trash2 size={13} />Delete</button>
            </span>
          </li>;
        })}
      </ul>}
    </div>
    {confirm && <ConfirmDialog title="Delete this announcement?" confirmLabel="Delete" danger onClose={() => setConfirm(null)} onConfirm={async () => { await api.entities.Announcement.delete(confirm.a.id); forgetAnnouncements(); setRows((rs) => rs.filter((x) => x.id !== confirm.a.id)); }}>
      <p>“{confirm.a.title || confirm.a.body?.slice(0, 80)}” comes off every tab and out of this list. If you might use it again, press No and use Unpin instead.</p>
    </ConfirmDialog>}
  </div>;
}
