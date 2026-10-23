import React, { useEffect, useState } from 'react';
import { api } from '@/api/client';
import { DIRECTORY_CATEGORIES } from '@/lib/categories';
import { Users, Building2, Search, Phone, MessageCircle, Bookmark, CheckCircle2, ChevronDown, BadgeCheck, X, EyeOff, Eye, Trash2, Megaphone, Crown } from 'lucide-react';
import ShabbosSimulator from '@/components/ShabbosSimulator';
import ShabbosGlobalOverride from '@/components/ShabbosGlobalOverride';
import SiteSwitches from '@/components/admin/SiteSwitches';
import ReportQueue from '@/components/admin/ReportQueue';
import HealthPanel from '@/components/admin/HealthPanel';
import SearchInsights from '@/components/admin/SearchInsights';
import ConfirmDialog from '@/components/admin/ConfirmDialog';
import AnnouncementsPanel from '@/components/admin/AnnouncementsPanel';
import { iconFor, guessIcon, ICON_NAMES } from '@/lib/categoryIcons';
const configs = [['Pending listings', 'Provider', { status: 'pending' }], ['Claim requests', 'ClaimRequest', { status: 'pending' }], ['Positive notes', 'CommunityNote', { status: 'pending' }], ['Private reports', 'PrivateReport', { status: 'open' }], ['Pending edits', 'ListingChangeRequest', { status: 'pending' }], ['Pending jobs', 'Job', { status: 'pending' }]];
export default function Admin() {const [user, setUser] = useState(),[data, setData] = useState({}),[active, setActive] = useState('Pending listings'),[categories, setCategories] = useState([]),[events, setEvents] = useState([]),[users, setUsers] = useState([]),[published, setPublished] = useState([]),[suspended, setSuspended] = useState([]),[reportCount, setReportCount] = useState(0);useEffect(() => {(async () => {const u = await api.auth.me();setUser(u);if (u.role !== 'admin' && u.role !== 'moderator') return;const results = await Promise.all(configs.map(([, e, q]) => api.entities[e].filter(q)));setData(Object.fromEntries(configs.map((c, i) => [c[0], results[i]])));setCategories(await api.entities.Category.list('order'));setEvents(await api.entities.ActivityEvent.list('-created_date', 500));setUsers(await api.entities.User.list());setPublished(await api.entities.Provider.filter({ status: 'published' }));setSuspended(await api.entities.Provider.filter({ status: 'hidden' }));
try { setReportCount((await api.entities.ListingReport.list('-created_date', 500)).length); } catch {}
})();}, []);if (!user) return <div className="loading">Checking administrator access…</div>;const isAdmin = user.role === 'admin';if (!isAdmin && user.role !== 'moderator') return <div className="empty m-6">Administrator access is required.</div>;const action = async (item, status) => {const cfg = configs.find((c) => c[0] === active);let next = status;if (status === 'approved' && active === 'Pending listings') next = 'published';if (status === 'approved' && active === 'Positive notes') next = 'published';if (status === 'approved' && active === 'Pending jobs') next = 'published';if (active === 'Claim requests') {
  // Approving a claim used to stamp the request and change nothing about the
  // listing, so the business still could not edit its own page. resolveClaim
  // hands it over: owner_id and claimed, server-side.
  const r = await api.functions.invoke('resolveClaim', { claim_id: item.id, approve: status === 'approved' });
  if (r.status >= 400) { alert(r.data?.error || 'Could not resolve that claim'); return; }
  setData({ ...data, [active]: data[active].filter((x) => x.id !== item.id) });
  return;
}
await api.entities[cfg[1]].update(item.id, { status: next });setData({ ...data, [active]: data[active].filter((x) => x.id !== item.id) });};const stats = [['Total users', users.length, Users], ['Providers', published.length, Building2], ['Searches', events.filter((e) => e.type === 'search').length, Search], ['Calls', events.filter((e) => e.type === 'call').length, Phone], ['Texts', events.filter((e) => e.type === 'text').length, MessageCircle], ['Saves', '—', Bookmark]];return <div className="page-shell py-5 md:py-9"><span className="eyebrow">ADMINISTRATION</span><h1 className="title text-2xl md:text-3xl">Community operations</h1><div className="my-4 grid grid-cols-3 gap-2 md:my-7 md:gap-3 lg:grid-cols-6">{stats.map(([n, v, I]) => <div className="rounded-lg bg-brand-surface p-3 ring-1 ring-brand-line md:p-5" key={n}><I className="text-brand-teal" size={18} /><strong className="mt-2 block text-xl md:mt-3 md:text-2xl">{v}</strong><span className="text-[11px] leading-tight text-brand-muted md:text-xs">{n}</span></div>)}</div><div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:gap-6 lg:grid-cols-[240px_1fr]"><aside className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:mx-0 lg:block lg:space-y-2 lg:overflow-visible lg:px-0"><button onClick={() => setActive('Find a listing')} className={`admin-nav shrink-0 ${active === 'Find a listing' ? 'admin-nav-active' : ''}`}><span className="inline-flex items-center gap-1.5"><Search size={14} />Find a listing</span></button>{configs.map(([n]) => <button key={n} onClick={() => setActive(n)} className={`admin-nav shrink-0 ${active === n ? 'admin-nav-active' : ''}`}><span>{n}</span><b>{data[n]?.length || 0}</b></button>)}<button onClick={() => setActive('Listing reports')} className={`admin-nav shrink-0 ${active === 'Listing reports' ? 'admin-nav-active' : ''}`}><span>Listing reports</span><b>{reportCount}</b></button><button onClick={() => setActive('Insights')} className={`admin-nav shrink-0 ${active === 'Insights' ? 'admin-nav-active' : ''}`}><span>What people want</span><b>{events.filter((e) => e.type === 'search' && e.zero_result).length}</b></button>{isAdmin && <><button onClick={() => setActive('Announcements')} className={`admin-nav shrink-0 ${active === 'Announcements' ? 'admin-nav-active' : ''}`}><span className="inline-flex items-center gap-1.5"><Megaphone size={14} />Announcements</span></button><button onClick={() => setActive('Site switches')} className={`admin-nav shrink-0 ${active === 'Site switches' ? 'admin-nav-active' : ''}`}><span>Site switches</span></button><button onClick={() => setActive('Shabbos tools')} className={`admin-nav shrink-0 ${active === 'Shabbos tools' ? 'admin-nav-active' : ''}`}><span>Shabbos tools</span></button><button onClick={() => setActive('Health')} className={`admin-nav shrink-0 ${active === 'Health' ? 'admin-nav-active' : ''}`}><span>Health</span><b>·</b></button><button onClick={() => setActive('Categories')} className={`admin-nav shrink-0 ${active === 'Categories' ? 'admin-nav-active' : ''}`}><span>Categories</span><b>{categories.length}</b></button><button onClick={() => setActive('Users')} className={`admin-nav shrink-0 ${active === 'Users' ? 'admin-nav-active' : ''}`}><span className="inline-flex items-center gap-1.5"><Users size={14} />Members</span><b>{users.length}</b></button></>}</aside><section className="min-w-0 md:my-3">{active === 'Find a listing' ? <FindListing listings={[...(data['Pending listings'] || []), ...published, ...suspended]} isAdmin={isAdmin} me={user} onChange={(row, removed) => { const place = (status) => (list) => [...(!removed && row.status === status ? [row] : []), ...list.filter((x) => x.id !== row.id)]; setPublished(place('published')); setSuspended(place('hidden')); setData((d) => ({ ...d, 'Pending listings': (d['Pending listings'] || []).filter((x) => x.id !== row.id).concat(!removed && row.status === 'pending' ? [row] : []) })); }} /> : active === 'Announcements' && isAdmin ? <AnnouncementsPanel /> : active === 'Site switches' && isAdmin ? <SiteSwitches /> : active === 'Shabbos tools' ? <div className="space-y-4"><ShabbosGlobalOverride />{isAdmin && <ShabbosSimulator />}</div> : active === 'Health' ? <HealthPanel /> : active === 'Insights' ? <SearchInsights events={events} /> : active === 'Listing reports' ? <ReportQueue user={user} /> : active === 'Categories' ? <CategoryAdmin items={categories} setItems={setCategories} /> : active === 'Users' ? <UserList users={users} me={user} onUpdate={(r) => setUsers(users.map((x) => x.id === r.id ? { ...x, ...r } : x))} onRemove={(u) => setUsers((us) => us.filter((x) => x.id !== u.id))} onHandOver={async (u, confirm) => { const r = await api.admin.handOverMaster(u.id, confirm); setUsers((us) => us.map((x) => x.id === r.to.id ? { ...x, ...r.to } : x.id === r.from.id ? { ...x, ...r.from } : x)); setUser((me) => ({ ...me, master_admin: false })); }} onRole={async (u, role) => { try { const r = await api.admin.setRole(u.id, role); setUsers(users.map((x) => x.id === u.id ? { ...x, role: r.role } : x)); } catch (e) { alert(e.message || 'Could not change role'); } }} /> : <Queue title={active} items={data[active] || []} onAction={action} users={users} />}</section></div></div>;}
// A claim asks staff to hand a business page from one person to another, and
// the card showed the claimant's own typed text for the listing name with
// nothing else — not who filed it, not the verification details they were
// asked for. Approving acts on provider_id, so the one thing staff read was
// the one thing the claimant chose freely. The name comes off the listing
// record now (see createClaim), and the rest of the decision is on the card.
function ClaimFacts({ x, users }) {
  const who = users?.find((u) => u.id === x.created_by_id);
  const rows = [
    ['Filed by', who ? (who.full_name ? `${who.full_name} · ${who.email}` : who.email) : 'a member who is no longer listed'],
    ['Says they are', x.relationship],
    ['Business email', x.business_email],
    ['Business phone', x.business_phone],
    ['How to check', x.verification_details],
  ].filter(([, v]) => v);
  return <dl className="mt-2 space-y-1 text-sm">{rows.map(([k, v]) => <div key={k} className="flex flex-wrap gap-x-2"><dt className="font-semibold text-brand-ink">{k}:</dt><dd className="min-w-0 text-brand-body">{v}</dd></div>)}</dl>;
}
// Long queues (150+ pending listings) are searchable and collapsed to one
// line per item, so a listing someone asks about can be found and acted on
// without scrolling past everything else. Search reads the same fields staff
// would be told over the phone: name, town, phone, email, website.
const HAYSTACK = ['name', 'title', 'provider_name', 'short_description', 'description', 'body', 'message', 'city', 'state', 'country', 'phone', 'email', 'website', 'category', 'business_email', 'business_phone', 'relationship', 'changes'];
function matches(x, q) {
  const text = HAYSTACK.map((k) => (typeof x[k] === 'string' ? x[k] : '')).join(' ').toLowerCase();
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const digits = q.replace(/\D/g, '');
  if (digits.length >= 3 && text.replace(/\D/g, '').includes(digits)) return true;
  return words.every((w) => text.includes(w));
}
function SearchBox({ value, onChange, placeholder }) {
  return <label className="relative mb-3 block">
    <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted" />
    <input type="text" inputMode="search" enterKeyHint="search" className="field mt-0 pl-9 pr-9" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
    {value && <button type="button" onClick={() => onChange('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-brand-muted hover:text-brand-ink" aria-label="Clear search"><X size={16} /></button>}
  </label>;
}
function Row({ title, subtitle, chips, open, onToggle, children }) {
  return <div className="border-b py-1 last:border-0">
    <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-3 py-3 text-left">
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2"><strong className="min-w-0 truncate text-brand-ink">{title}</strong>{chips}</span>
        {subtitle && <span className="mt-0.5 block truncate text-sm text-brand-body">{subtitle}</span>}
      </span>
      <ChevronDown size={18} className={`shrink-0 text-brand-muted transition ${open ? 'rotate-180' : ''}`} />
    </button>
    {open && <div className="pb-4">{children}</div>}
  </div>;
}
function useOpenRows(shown, q) {
  const [open, setOpen] = useState(() => new Set());
  // A search narrowed to a handful opens them, so the buttons are right there.
  const auto = q.trim() && shown.length <= 3;
  const isOpen = (id) => auto || open.has(id);
  const toggle = (id) => setOpen((o) => { const n = new Set(o); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allOpen = shown.length > 0 && shown.every((x) => open.has(x.id));
  const toggleAll = () => setOpen(allOpen ? new Set() : new Set(shown.map((x) => x.id)));
  return { isOpen, toggle, allOpen, toggleAll, auto };
}
function Queue({ title, items, onAction, users }) {
  const [q, setQ] = useState('');
  const shown = q.trim() ? items.filter((x) => matches(x, q)) : items;
  const { isOpen, toggle, allOpen, toggleAll, auto } = useOpenRows(shown, q);
  return <div className="panel">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 className="section-title">{title}</h2>
      {shown.length > 0 && !auto && <button type="button" onClick={toggleAll} className="text-sm font-semibold text-brand-teal hover:underline">{allOpen ? 'Collapse all' : 'Expand all'}</button>}
    </div>
    {items.length > 0 && <SearchBox value={q} onChange={setQ} placeholder="Search name, town, phone, email" />}
    {q.trim() && <p className="helper mb-2">{shown.length} of {items.length} match</p>}
    {items.length === 0 ? <p className="helper">Queue is clear.</p> : shown.length === 0 ? <p className="helper">Nothing in this queue matches. Try Find a listing to search live listings too.</p> : shown.map((x) => { const sub = x.verification_details ? (x.relationship || x.business_email) : (x.short_description || x.description || x.body || x.message || x.relationship || x.changes); const full = x.description || x.body || x.message || x.changes; return <Row key={x.id} title={x.name || x.title || x.provider_name || 'Submission'} subtitle={sub} open={isOpen(x.id)} onToggle={() => toggle(x.id)}>
      {x.verification_details ? <ClaimFacts x={x} users={users} /> : full && full !== sub && <p className="text-sm text-brand-body">{full}</p>}
      {(x.city || x.phone || x.email) && !x.verification_details && <p className="mt-1 text-sm text-brand-muted">{[x.city && [x.city, x.state].filter(Boolean).join(', '), x.phone, x.email].filter(Boolean).join(' · ')}</p>}
      {x.target_type === 'post' && x.target_id && <a href={`/feed?post=${encodeURIComponent(x.target_id)}`} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm font-semibold text-brand-teal hover:underline">Open the reported post ↗</a>}
      {x.verification_details && !x.provider_id && <p className="mt-2 text-sm font-semibold text-brand-error">This claim names no listing on the site, so approving it cannot hand anything over. Find or add the listing first.</p>}
      {x.provider_id && <a href={`/add?edit=${encodeURIComponent(x.provider_id)}`} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm font-semibold text-brand-teal hover:underline">Open the listing to edit ↗</a>}
      <div className="mt-3 flex gap-2"><button onClick={() => onAction(x, title === 'Private reports' ? 'resolved' : 'approved')} className="primary py-2"><CheckCircle2 size={15} />Approve / resolve</button><button onClick={() => onAction(x, 'rejected')} className="secondary py-2">Reject</button></div>
    </Row>; })}
  </div>;
}
// Someone calls to confirm their page: find it among pending and live
// listings alike, approve it if it is waiting, and tick Verified by Klal.
function FindListing({ listings, isAdmin, me, onChange }) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState('');
  const [confirm, setConfirm] = useState(null);
  const hits = q.trim().length >= 2 ? listings.filter((x) => matches(x, q)) : [];
  const shown = hits.slice(0, 25);
  const { isOpen, toggle } = useOpenRows(shown, q);
  const save = async (x, patch) => {
    setBusy(x.id);
    try { onChange({ ...x, ...(await api.entities.Provider.update(x.id, patch)) }); }
    catch (e) { alert(e.message || 'Could not save that change'); }
    finally { setBusy(''); }
  };
  // Suspending takes the page off the site and out of search; nothing is lost
  // and Unsuspend puts it back. Deleting is for good.
  const askSuspend = (x) => setConfirm({
    title: `Suspend "${x.name || 'this listing'}"?`,
    body: <><p>The page comes off the site and out of search right away. Nothing is deleted.</p><p>You can bring it back any time from here with Unsuspend.</p></>,
    confirmLabel: 'Yes, suspend it',
    onConfirm: async () => onChange({ ...x, ...(await api.entities.Provider.update(x.id, { status: 'hidden' })) }),
  });
  const askDelete = (x) => setConfirm({
    title: `Delete "${x.name || 'this listing'}" for good?`,
    body: <><p>This removes the page completely, with its saves, notes, claims and reports. <b className="text-brand-ink">It cannot be undone.</b></p><p>If you might want it back, press No and use Suspend instead.</p></>,
    confirmLabel: 'Delete forever',
    danger: true,
    typeToConfirm: 'DELETE',
    onConfirm: async () => { await api.admin.deleteListing(x.id); onChange(x, true); },
  });
  const chip = (text, tone) => <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${tone}`}>{text}</span>;
  return <div className="panel">
    <h2 className="section-title mb-1">Find a listing</h2>
    <p className="helper mb-3">Search pending, live and suspended listings to approve, verify, suspend or delete one.</p>
    <SearchBox value={q} onChange={setQ} placeholder="Search name, town, phone, email" />
    {q.trim().length >= 2 && <p className="helper mb-2">{hits.length === 0 ? 'No listing matches.' : hits.length > shown.length ? `Showing the first ${shown.length} of ${hits.length}. Add a town or phone number to narrow it.` : `${hits.length} ${hits.length === 1 ? 'match' : 'matches'}`}</p>}
    {shown.map((x) => <Row key={x.id} title={x.name || 'Listing'} subtitle={[x.category, [x.city, x.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ')} open={isOpen(x.id)} onToggle={() => toggle(x.id)}
      chips={<>{x.status === 'pending' ? chip('PENDING', 'bg-brand-gold-bg text-brand-gold-ink') : x.status === 'hidden' ? chip('SUSPENDED', 'bg-brand-line text-brand-muted') : chip('LIVE', 'bg-brand-tint text-brand-teal')}{x.verified && chip('VERIFIED', 'bg-brand-navy text-white')}</>}>
      {x.short_description && <p className="text-sm text-brand-body">{x.short_description}</p>}
      {(x.phone || x.email || x.website) && <p className="mt-1 break-words text-sm text-brand-muted">{[x.phone, x.email, x.website].filter(Boolean).join(' · ')}</p>}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm font-semibold">
        {x.slug && x.status === 'published' && <a href={`/provider/${encodeURIComponent(x.slug)}`} target="_blank" rel="noreferrer" className="text-brand-teal hover:underline">Open the page ↗</a>}
        <a href={`/add?edit=${encodeURIComponent(x.id)}`} target="_blank" rel="noreferrer" className="text-brand-teal hover:underline">Edit ↗</a>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {x.status === 'pending' && <button type="button" disabled={busy === x.id} onClick={() => save(x, { status: 'published' })} className="primary py-2"><CheckCircle2 size={15} />Approve</button>}
        {isAdmin && <button type="button" disabled={busy === x.id} onClick={() => save(x, x.verified ? { verified: false, verified_at: null, verified_by: null } : { verified: true, verified_at: new Date().toISOString(), verified_by: me.id })} className="secondary py-2"><BadgeCheck size={15} />{x.verified ? 'Remove Verified by Klal' : 'Mark Verified by Klal'}</button>}
        {x.status === 'pending' && <button type="button" disabled={busy === x.id} onClick={() => save(x, { status: 'rejected' })} className="secondary py-2">Reject</button>}
        {x.status === 'published' && <button type="button" disabled={busy === x.id} onClick={() => askSuspend(x)} className="secondary py-2"><EyeOff size={15} />Suspend</button>}
        {x.status === 'hidden' && <button type="button" disabled={busy === x.id} onClick={() => save(x, { status: 'published' })} className="secondary py-2"><Eye size={15} />Unsuspend</button>}
        {isAdmin && <button type="button" disabled={busy === x.id} onClick={() => askDelete(x)} className="secondary py-2 text-brand-error"><Trash2 size={15} />Delete</button>}
      </div>
    </Row>)}
    {confirm && <ConfirmDialog title={confirm.title} confirmLabel={confirm.confirmLabel} danger={confirm.danger} typeToConfirm={confirm.typeToConfirm} onConfirm={confirm.onConfirm} onClose={() => setConfirm(null)}>{confirm.body}</ConfirmDialog>}
  </div>;
}
// A category with no icon showed the generic dots, which is what happened to
// "Mikva". The icon is guessed from the name and can be changed here.
function CategoryAdmin({ items, setItems }) {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const [busy, setBusy] = useState(false);
  const chosen = icon || guessIcon(name);
  const add = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const x = await api.entities.Category.create({
        name: name.trim(),
        slug: name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
        icon: chosen,
        order: items.length + 1,
        subcategories: [],
        active: true,
      });
      setItems([...items, x]); setName(''); setIcon('');
    } finally { setBusy(false); }
  };
  const setCategoryIcon = async (x, next) => {
    const updated = await api.entities.Category.update(x.id, { icon: next });
    setItems(items.map((i) => (i.id === x.id ? { ...i, ...updated } : i)));
  };
  const remove = async (x) => {
    if (!window.confirm(`Remove the "${x.name}" category? Listings in it keep their category name but it stops appearing in the directory.`)) return;
    await api.entities.Category.delete(x.id);
    setItems(items.filter((i) => i.id !== x.id));
  };
  // Categories added to the code do nothing for a directory that is already
  // running: the seeder only touches a fresh database, and putting them in by
  // hand here meant retyping the icon and the subcategories from memory. This
  // adds the ones the app expects and the database has not got — by name, so
  // it is safe to press twice and it never touches a category already there.
  const missing = DIRECTORY_CATEGORIES.filter((c) => !items.some((i) => (i.name || '').trim().toLowerCase() === c.name.toLowerCase()));
  const [addedCount, setAddedCount] = useState(0);
  const [addErr, setAddErr] = useState('');
  const addMissing = async () => {
    if (!missing.length || busy) return;
    setBusy(true); setAddErr('');
    const made = [];
    try {
      for (const c of missing) {
        made.push(await api.entities.Category.create({
          name: c.name,
          slug: c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
          icon: c.icon,
          order: c.order,
          subcategories: c.subcategories || [],
          active: true,
        }));
      }
      setAddedCount(made.length);
    } catch (e) {
      setAddErr(e.message || 'Could not add them all — press again to pick up where it stopped.');
    } finally {
      // Whatever was created is shown even if one failed partway, so pressing
      // again adds only the rest.
      if (made.length) setItems([...items, ...made]);
      setBusy(false);
    }
  };
  const Preview = iconFor(chosen);
  return <div className="panel">
    <h2 className="section-title">Category management</h2>
    <p className="helper">The icon is guessed from the name — "Mikva" gets a water drop — and you can pick a different one.</p>
    {missing.length > 0 && <div className="mt-4 rounded-lg bg-brand-gold-bg p-4">
      <p className="text-sm font-semibold text-brand-gold-ink">{missing.length} categor{missing.length === 1 ? 'y' : 'ies'} the app expects {missing.length === 1 ? 'is' : 'are'} not here yet</p>
      <p className="mt-1 text-sm text-brand-gold-ink">{missing.map((c) => c.name).join(', ')}</p>
      <button onClick={addMissing} disabled={busy} className="primary mt-3 text-sm disabled:opacity-60">{busy ? 'Adding…' : `Add ${missing.length === 1 ? 'it' : 'all ' + missing.length}`}</button>
    </div>}
    {addedCount > 0 && missing.length === 0 && <p className="success mt-4 p-3">Added {addedCount}. The directory and the listing form offer them now.</p>}
    {addErr && <p className="mt-3 text-sm font-semibold text-brand-error">{addErr}</p>}
    <div className="my-4 flex flex-wrap items-center gap-2">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-tint text-brand-teal"><Preview size={20}/></span>
      <input className="field mt-0 min-w-[10rem] flex-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="New category" />
      <select className="field mt-0 w-auto" value={chosen} onChange={(e) => setIcon(e.target.value)} aria-label="Icon">
        {ICON_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
      <button onClick={add} disabled={busy || !name.trim()} className="primary disabled:opacity-60">Add</button>
    </div>
    {items.map((x) => { const I = iconFor(x.icon && x.icon !== 'MoreHorizontal' ? x.icon : guessIcon(x.name)); return <div key={x.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-3">
      <span className="flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-tint text-brand-teal"><I size={16}/></span>{x.order}. {x.name}</span>
      <span className="flex items-center gap-2">
        <select className="field mt-0 w-auto py-1 text-xs" value={x.icon || guessIcon(x.name)} onChange={(e) => setCategoryIcon(x, e.target.value)} aria-label={`Icon for ${x.name}`}>
          {ICON_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <button onClick={() => remove(x)} className="text-sm text-brand-error">Remove</button>
      </span>
    </div>; })}
  </div>;
}
// Find a member by name or email, then edit, reset, suspend or delete them.
// Suspending blocks sign-in and hides the profile, and can be undone.
// Deleting removes the account and what they posted, and cannot.
function UserList({ users, me, onRole, onUpdate, onRemove, onHandOver }) {
  const [q, setQ] = useState('');
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = words.length ? users.filter((u) => { const text = [u.full_name, u.email, u.headline, u.home_city].filter(Boolean).join(' ').toLowerCase(); return words.every((w) => text.includes(w)); }) : users;
  const shown = hits.slice(0, 50);
  return <div className="panel">
    <h2 className="section-title mb-1">Members</h2>
    <p className="helper mb-3">Moderators see the review queues and can approve, reject and resolve. Only admins manage categories, members and verification. "Reset password" hands you a temporary password to pass on — the member should change it from their profile.</p>
    <SearchBox value={q} onChange={setQ} placeholder="Search name or email" />
    <p className="helper mb-2">{words.length ? (hits.length === 0 ? 'No member matches.' : `${hits.length} ${hits.length === 1 ? 'match' : 'matches'}`) : `${users.length} members`}{hits.length > shown.length ? `. Showing the first ${shown.length}; type a name or email to narrow it.` : ''}</p>
    {shown.map((u) => <UserRow key={u.id} u={u} me={me} onRole={onRole} onUpdate={onUpdate} onRemove={onRemove} onHandOver={onHandOver} />)}
  </div>;
}
// What each role can do, said in the "Are you sure?" step before it changes.
const ROLE_NAMES = { user: 'Member', moderator: 'Moderator', admin: 'Admin' };
const ROLE_A = { user: 'a regular member', moderator: 'a moderator', admin: 'an admin' };
const ROLE_HELP = {
  user: 'They lose any staff access and use Klal like everyone else.',
  moderator: 'They can open the Admin page to review pending listings, claims, notes, edits, jobs and reports, approve or decline them, and edit or suspend listings. They cannot delete anything or change members, roles, categories, announcements or site switches.',
  admin: 'They get full control, the same as you: members and roles, deleting accounts and listings, categories, announcements and site switches. Only give this to someone you fully trust.',
};
function UserRow({ u, me, onRole, onUpdate, onRemove, onHandOver }) {const [edit, setEdit] = useState(false),[name, setName] = useState(u.full_name || ''),[headline, setHeadline] = useState(u.headline || ''),[clearMedia, setClearMedia] = useState(false),[temp, setTemp] = useState(''),[busy, setBusy] = useState(false),[err, setErr] = useState(''),[confirm, setConfirm] = useState(null);const isGuest = u.email === 'guest@klal.app';const who = u.full_name || u.email;const run = async (fn) => {setBusy(true);setErr('');try { await fn(); } catch (e) { setErr(e.message || 'Something went wrong'); }setBusy(false);};const save = () => run(async () => {const patch = { full_name: name, headline };if (clearMedia) { patch.avatar_url = ''; patch.banner_url = ''; patch.work_experience = []; patch.bio = ''; patch.home_city = ''; patch.phone = ''; }onUpdate(await api.admin.updateUser(u.id, patch));setEdit(false);});const reset = () => run(async () => {if (!window.confirm(`Give ${who} a new temporary password? Their current one stops working.`)) return;const r = await api.admin.resetPassword(u.id);setTemp(r.temp_password);});const unsuspend = () => run(async () => {onUpdate(await api.admin.updateUser(u.id, { disabled: false }));});const askSuspend = () => setConfirm({ title: `Suspend ${who}?`, body: <><p>They are signed out and cannot sign in, and their profile is hidden from other members. Nothing is deleted.</p><p>You can bring the account back any time with Unsuspend.</p></>, confirmLabel: 'Yes, suspend', onConfirm: async () => onUpdate(await api.admin.updateUser(u.id, { disabled: true })) });const askDelete = () => setConfirm({ title: `Delete ${who}'s account for good?`, body: <><p>This removes the account ({u.email}) and everything they posted: feed posts, comments, messages, connections and saves. Listings stay on the site, and any they had claimed go back to unclaimed. <b className="text-brand-ink">It cannot be undone.</b></p><p>If you might want them back, press No and use Suspend instead.</p></>, confirmLabel: 'Delete forever', danger: true, typeToConfirm: 'DELETE', onConfirm: async () => { await api.admin.deleteUser(u.id); onRemove(u); } });const askRole = (role) => { if (role === u.role) return; setConfirm({ title: `Make ${who} ${ROLE_A[role]}?`, body: <><p>{ROLE_HELP[role]}</p><p>You can change it back here any time.</p></>, confirmLabel: `Yes, make ${ROLE_NAMES[role].toLowerCase()}`, danger: role === 'admin', onConfirm: async () => onRole(u, role) }); };const askHandOver = () => setConfirm({ title: `Hand master admin over to ${who}?`, body: <><p><b className="text-brand-ink">{who}</b> ({u.email}) becomes the master admin and an admin. After this, no other admin, <b className="text-brand-ink">including you</b>, can change their role, suspend, reset or delete them.</p><p>You stay an admin, but lose the master protection, so the new master admin could remove you. Only they can hand it back.</p></>, confirmLabel: 'Hand it over', danger: true, typeToConfirm: 'CONFIRM', onConfirm: async () => onHandOver(u, 'CONFIRM') });const markVerified = () => run(async () => {onUpdate(await api.admin.updateUser(u.id, { verified: true }));});const master = u.master_admin === true;const locked = master && u.id !== me.id;const others = u.id !== me.id && !isGuest && !locked;return <div className="border-b py-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-3"><span className="min-w-0 truncate">{who}{master && <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-brand-teal/15 px-2 py-0.5 text-[10px] font-bold text-brand-teal"><Crown size={11} />MASTER ADMIN</span>}{u.disabled && <span className="ml-2 rounded-full bg-brand-line px-2 py-0.5 text-[10px] font-bold text-brand-muted">SUSPENDED</span>}{!isGuest && u.verified === false && <span className="ml-2 rounded-full bg-brand-gold-bg px-2 py-0.5 text-[10px] font-bold text-brand-gold-ink" title="Has not entered an email code; will be asked for one at log in once email is on">UNVERIFIED</span>}<span className="ml-2 text-xs text-brand-muted">{u.email}</span></span><span className="flex flex-wrap items-center gap-2">{u.id === me.id || locked ? <b>{master ? 'Master admin' : ROLE_NAMES[u.role] || u.role}</b> : <select className="field mt-0 w-auto py-1 text-xs" value={u.role} onChange={(e) => askRole(e.target.value)} disabled={isGuest} aria-label={`Role for ${who}`}><option value="user">Member</option><option value="moderator">Moderator</option><option value="admin">Admin</option></select>}{!locked && <button type="button" onClick={() => setEdit((v) => !v)} className="secondary py-1 text-xs">{edit ? 'Cancel' : 'Edit'}</button>}{others && <button type="button" disabled={busy} onClick={reset} className="secondary py-1 text-xs">Reset password</button>}{others && (u.disabled ? <button type="button" disabled={busy} onClick={unsuspend} className="secondary py-1 text-xs"><Eye size={13} />Unsuspend</button> : <button type="button" disabled={busy} onClick={askSuspend} className="secondary py-1 text-xs"><EyeOff size={13} />Suspend</button>)}{others && me.master_admin === true && !u.disabled && <button type="button" disabled={busy} onClick={askHandOver} className="secondary py-1 text-xs"><Crown size={13} />Hand over master admin</button>}{others && <button type="button" disabled={busy} onClick={askDelete} className="secondary py-1 text-xs text-brand-error"><Trash2 size={13} />Delete</button>}{!isGuest && !locked && u.verified === false && <button type="button" disabled={busy} onClick={markVerified} className="secondary py-1 text-xs" title="Skip the email code for this member">Mark verified</button>}</span></div>{edit && <div className="mt-3 grid gap-2 sm:grid-cols-2"><label className="text-xs">Name<input className="field" value={name} onChange={(e) => setName(e.target.value)} /></label><label className="text-xs">Headline<input className="field" value={headline} onChange={(e) => setHeadline(e.target.value)} /></label><label className="flex items-center gap-2 text-xs sm:col-span-2"><input type="checkbox" checked={clearMedia} onChange={(e) => setClearMedia(e.target.checked)} />Also clear photo, banner, bio, city, phone and work experience</label><div className="sm:col-span-2"><button type="button" disabled={busy} onClick={save} className="primary py-1.5 text-xs">Save</button></div></div>}{temp && <p className="mt-2 rounded-xl bg-brand-gold-bg p-3 text-xs text-brand-gold-ink">Temporary password for <b>{u.email}</b> — shown once, copy it now: <code className="select-all font-mono text-sm font-bold">{temp}</code></p>}{err && <p className="mt-2 text-xs font-semibold text-brand-error">{err}</p>}{confirm && <ConfirmDialog title={confirm.title} confirmLabel={confirm.confirmLabel} danger={confirm.danger} typeToConfirm={confirm.typeToConfirm} onConfirm={confirm.onConfirm} onClose={() => setConfirm(null)}>{confirm.body}</ConfirmDialog>}</div>;}
