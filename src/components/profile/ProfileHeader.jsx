import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api/client';
import { Image } from '@/components/ui/image';
import { MapPin, Briefcase, Users, Pencil, Camera, Loader2, Settings, Phone, X, CalendarDays } from 'lucide-react';
import ConnectButton from '@/components/ConnectButton';
import MessageButton from '@/components/MessageButton';
import ShareButton from '@/components/ShareButton';
import ProfileBanner, { PHOTO_EDGE } from '@/components/ProfileBanner';
import HeadlineEdit from '@/components/HeadlineEdit';
import { PROFILE_TYPES } from '@/lib/affiliations';
import CityInput from '@/components/CityInput';
import { WorkStatusRing, WorkStatusSelect } from '@/components/WorkStatus';
import { workStatusOf } from '@/lib/workStatus';
import { topJob } from '@/lib/connections';
import { BOOKING_LABELS, DEFAULT_BOOKING_LABEL, bookingLabel } from '@/lib/booking';

// See-through, like LinkedIn's, so the cover shows behind the pencil. Inline
// because the brand colours have no <alpha-value>: bg-brand-surface/50 is
// never generated.
const COVER_PENCIL = { background: 'hsl(var(--brand-surface) / 0.5)', boxShadow: '0 0 0 1px hsl(var(--brand-ink) / 0.12)' };

const initialsOf = (user) => (user.full_name || user.email || '?').split(' ').map((x) => x[0]).slice(0, 2).join('').toUpperCase();

// The top of a profile: cover, photo, name, headline, the facts, the actions.
// One component for both the owner (editable: pencils, upload overlays, an
// inline intro form) and everyone else (Connect / Message / Share).
export default function ProfileHeader({ user, me, editable, onSave, connections, onReload, companies = {}, connectionCount, mutual, editing, setEditing }) {
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [preview, setPreview] = useState(null);
  const open = editing === 'intro';

  const startEdit = () => setEditing('intro');
  // The form is built from the profile whenever the editor opens (pencil or
  // checklist) and dropped whenever it closes, so no draft outlives a switch
  // to another section.
  React.useEffect(() => {
    if (open) setForm({ full_name: user.full_name || '', headline: user.headline || '', profile_type: user.profile_type || 'community_member', home_city: user.home_city || '', phone: user.phone || '', work_status: user.work_status || '', booking_url: user.booking_url || '', booking_label: bookingLabel(user) });
    else setForm(null);
    setErr('');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const cancel = () => setEditing(null);
  React.useEffect(() => {
    if (!preview) return undefined;
    const close = (e) => { if (e.key === 'Escape') setPreview(null); };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [preview]);
  // Every write from this header goes through here: one busy flag, one
  // error line, and a failed save never goes unnoticed.
  const write = async (patch, fallback) => {
    setBusy(true); setErr('');
    try { await onSave(patch); return true; }
    catch (error) { setErr(error.message || fallback); return false; }
    finally { setBusy(false); }
  };
  const submit = async (e) => { e.preventDefault(); if (await write(form, 'Could not save')) setEditing(null); };
  const upload = (field) => async (e) => {
    const file = e.target.files?.[0];
    // Cleared so choosing the same file again (after a failed upload, say)
    // still fires a change event.
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { setErr('Please choose an image file.'); return; }
    if (file.size > 4 * 1024 * 1024) { setErr('That image is too large. Please choose one under 4MB.'); return; }
    setBusy(true); setErr('');
    try { const { file_url } = await api.integrations.Core.UploadFile({ file }); await onSave({ [field]: file_url }); }
    catch (error) { setErr(error.message || 'That image could not be uploaded.'); }
    finally { setBusy(false); }
  };

  const job = topJob(user);
  const companyLink = job?.company ? companies[job.company.trim().toLowerCase()] : null;
  const typeLabel = PROFILE_TYPES.find((t) => t.id === user.profile_type)?.label;
  const profileUrl = `${window.location.origin}/profile/${user.id}`;

  return <>
  <section id="intro" className="scroll-mt-24 overflow-hidden rounded-xl bg-brand-surface ring-1 ring-brand-line">
    <div className="relative">
      {/* No radius of its own: the section above clips with rounded-xl and
          overflow-hidden, and a smaller radius here left a faint seam. */}
      <ProfileBanner url={user.banner_url} onClick={() => setPreview({ url: user.banner_url, alt: `${user.full_name || 'Profile'} cover photo` })}/>
      {/* Changing the cover lives here, where the cover is. Removing it does
          not: an X floating on an image reads as "close this toolbar", and
          pressing it used to delete the picture on the spot — which is what
          happened to the first person who tried it. Remove is in Edit intro,
          and asks first. */}
      {/* A small see-through pencil in the corner, like LinkedIn's, so it
          hides as little of the picture as possible. The words live in the tooltip
          and the screen-reader label. */}
      {editable && <label className="absolute right-3 top-3 grid h-9 w-9 cursor-pointer place-items-center rounded-full text-brand-ink shadow-sm backdrop-blur-sm transition hover:scale-105" style={COVER_PENCIL} title={user.banner_url ? 'Change cover photo' : 'Add a cover photo'} aria-label={user.banner_url ? 'Change cover photo' : 'Add a cover photo'} onClick={(e) => e.stopPropagation()}>{busy ? <Loader2 size={16} className="animate-spin"/> : <Pencil size={16}/>}<input type="file" accept="image/*" className="hidden" onChange={upload('banner_url')} disabled={busy}/></label>}
    </div>
    <div className="px-6 pb-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="relative z-10 -mt-12 sm:-mt-14">
          <WorkStatusRing user={user}>
          {user.avatar_url
            ? <button type="button" onClick={() => setPreview({ url: user.avatar_url, alt: `${user.full_name || 'Profile'} profile photo` })} className="h-24 w-24 cursor-zoom-in overflow-hidden rounded-full sm:h-28 sm:w-28" style={PHOTO_EDGE} aria-label="Open profile photo"><Image src={user.avatar_url} fittingType="fill" className="h-24 w-24 sm:h-28 sm:w-28"/></button>
            : <div className="grid h-24 w-24 place-items-center rounded-full bg-brand-tint text-2xl font-bold text-brand-teal ring-4 ring-brand-surface sm:h-28 sm:w-28">{initialsOf(user)}</div>}
          </WorkStatusRing>
          {/* Up in the corner while a ribbon is on, so its tag along the bottom stays clear. */}
          {editable && <label className={`absolute ${workStatusOf(user) ? '-top-1' : '-bottom-1'} -right-1 grid h-9 w-9 cursor-pointer place-items-center rounded-full bg-brand-navy text-white shadow ring-2 ring-brand-surface hover:bg-brand-navy-hover`} title={user.avatar_url ? 'Change photo' : 'Add a photo'}>{busy ? <Loader2 size={15} className="animate-spin"/> : <Camera size={15}/>}<input id="avatar-upload" type="file" accept="image/*" className="hidden" onChange={upload('avatar_url')} disabled={busy}/></label>}
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-3">
          {editable
            ? <><button type="button" onClick={open ? cancel : startEdit} className="primary"><Pencil size={15}/>{open ? 'Close' : 'Edit intro'}</button><ShareButton title={`${user.full_name || 'A member'} on Klal`} url={profileUrl} className="secondary"/><Link to="/settings" className="secondary"><Settings size={15}/>Settings</Link></>
            : <><ConnectButton targetId={user.id} me={me} connections={connections} onReload={onReload}/><MessageButton targetId={user.id} me={me} connections={connections}/><ShareButton title={`${user.full_name || 'A member'} on Klal`} url={profileUrl} className="secondary"/></>}
        </div>
      </div>

      {open && user.banner_url && <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-brand-tint p-3 text-sm text-brand-body">
        <span className="flex-1">Cover photo</span>
        <button type="button" disabled={busy} onClick={() => { if (window.confirm('Remove your cover photo? You will need the original file to put it back.')) write({ banner_url: '' }, 'Could not remove the cover'); }} className="secondary py-1.5 text-xs"><X size={14}/>Remove cover</button>
      </div>}
      {open && user.avatar_url && <div className="mt-2 flex flex-wrap items-center gap-3 rounded-xl bg-brand-tint p-3 text-sm text-brand-body">
        <span className="flex-1">Profile photo</span>
        <button type="button" disabled={busy} onClick={() => { if (window.confirm('Remove your profile photo? You will need the original file to put it back.')) write({ avatar_url: '' }, 'Could not remove the photo'); }} className="secondary py-1.5 text-xs"><X size={14}/>Remove photo</button>
      </div>}
      {open && form
        ? <form onSubmit={submit} className="mt-4 space-y-4 rounded-lg bg-brand-tint/60 p-4 ring-1 ring-brand-line">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="sm:col-span-2">Name<input className="field" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} placeholder="As people in the community know you" autoFocus/></label>
            <div className="sm:col-span-2"><HeadlineEdit label="Headline" value={form.headline} onChange={(v) => setForm({ ...form, headline: v })} suggestion={job ? `${job.title}${job.company ? ` — ${job.company}` : ''}` : null}/></div>
            <label>What brings you here<select className="field" value={form.profile_type} onChange={(e) => setForm({ ...form, profile_type: e.target.value })}>{PROFILE_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></label>
            <label>General home city<CityInput value={form.home_city} onChange={(v) => setForm({ ...form, home_city: v })} onPick={(p) => setForm({ ...form, home_city: p.city })} placeholder="Lakewood, Brooklyn, Monsey…"/><span className="helper">Your exact location is never displayed.</span></label>
            <label>Phone<input className="field" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} inputMode="tel"/><span className="helper">Private. Only you and the admins can see it.</span></label>
            <label>Photo ribbon<WorkStatusSelect value={form.work_status} onChange={(v) => setForm({ ...form, work_status: v })}/><span className="helper">Shows on your profile photo, like LinkedIn's. Choose "No ribbon" to take it off.</span></label>
            <label>Booking link<input className="field" value={form.booking_url} onChange={(e) => setForm({ ...form, booking_url: e.target.value })} inputMode="url" placeholder="calendly.com/your-name"/><span className="helper">Your Calendly, Acuity or other scheduling page. Adds a button to your profile. Leave blank for no button.</span></label>
            <label>Button says<select className="field" value={form.booking_label || DEFAULT_BOOKING_LABEL} onChange={(e) => setForm({ ...form, booking_label: e.target.value })}>{BOOKING_LABELS.map((l) => <option key={l} value={l}>{l}</option>)}</select></label>
          </div>
          {user.avatar_url && <button type="button" disabled={busy} onClick={() => write({ avatar_url: '' }, 'Could not remove the photo')} className="text-sm font-semibold text-brand-error hover:underline">Remove profile photo</button>}
          {err && <p className="text-sm font-semibold text-brand-error">{err}</p>}
          <div className="flex items-center gap-3"><button className="primary" disabled={busy}>{busy ? <Loader2 size={15} className="animate-spin"/> : null}Save</button><button type="button" onClick={cancel} className="text-sm font-medium text-brand-muted hover:text-brand-ink">Cancel</button></div>
        </form>
        : <div className="mt-3 min-w-0">
          <h1 className="text-2xl font-bold text-brand-ink">{user.full_name || (editable ? <button type="button" onClick={startEdit} className="text-brand-muted hover:underline">Add your name</button> : 'Community member')}</h1>
          {user.headline && String(user.headline).trim()
            ? <p className="mt-0.5 line-clamp-2 text-base text-brand-body">{user.headline}</p>
            : editable && <button type="button" onClick={startEdit} className="mt-0.5 text-sm text-brand-muted hover:text-brand-teal hover:underline">Add a one-line headline</button>}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {typeLabel && <span className="rounded-full bg-brand-tint px-2.5 py-1 text-xs font-semibold text-brand-teal">{typeLabel}</span>}
          </div>
          <div className="mt-3 space-y-1 text-sm text-brand-body">
            {job && <p className="flex items-start gap-2"><Briefcase size={14} className="mt-1 shrink-0 text-brand-teal"/><span>{job.title}{job.company ? <>, {companyLink ? <Link to={companyLink} className="font-semibold text-brand-teal hover:underline">{job.company}</Link> : job.company}</> : ''}</span></p>}
            {user.home_city && <p className="flex items-start gap-2"><MapPin size={14} className="mt-1 shrink-0 text-brand-teal"/><span>{user.home_city}</span></p>}
            {editable && user.phone && <p className="flex items-start gap-2 text-brand-muted"><Phone size={14} className="mt-1 shrink-0 text-brand-teal"/><span>{user.phone} <span className="text-xs">· only you see this</span></span></p>}
            {connectionCount > 0 && <p className="flex items-start gap-2"><Users size={14} className="mt-1 shrink-0 text-brand-teal"/><span>{connectionCount} {connectionCount === 1 ? 'connection' : 'connections'}{mutual?.count > 0 && <span className="text-brand-muted"> · {mutual.count} mutual{mutual.names.length ? `: ${mutual.names.join(', ')}${mutual.count > mutual.names.length ? ` and ${mutual.count - mutual.names.length} more` : ''}` : ''}</span>}</span></p>}
            {user.invited_by_name && <p className="text-xs text-brand-muted">Invited to Klal by {user.invited_by_id ? <Link to={`/profile/${user.invited_by_id}`} className="font-semibold text-brand-teal hover:underline">{user.invited_by_name}</Link> : user.invited_by_name}</p>}
          </div>
          {user.booking_url
            ? <a href={user.booking_url} target="_blank" rel="noopener noreferrer" className="secondary mt-4 w-full rounded-full border-brand-teal/50 text-brand-teal"><CalendarDays size={16}/>{bookingLabel(user)}</a>
            : editable && <button type="button" onClick={startEdit} className="mt-3 flex items-center gap-1.5 text-sm text-brand-muted hover:text-brand-teal hover:underline"><CalendarDays size={14}/>Add a "Book an appointment" button</button>}
          {err && <p className="mt-2 text-sm font-semibold text-brand-error">{err}</p>}
        </div>}
    </div>
  </section>
  {preview && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" role="dialog" aria-modal="true" aria-label={preview.alt} onClick={() => setPreview(null)}>
    <button type="button" onClick={() => setPreview(null)} className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-white/90 text-2xl text-brand-ink" aria-label="Close image viewer"><X size={22}/></button>
    <img src={preview.url} alt={preview.alt} className="max-h-[90vh] max-w-[95vw] object-contain" onClick={(e) => e.stopPropagation()} />
  </div>}
  </>;
}
