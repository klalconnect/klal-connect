import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { api } from '@/api/client';
import GuestPrompt from '@/components/GuestPrompt';
import PeopleYouMayKnow from '@/components/PeopleYouMayKnow';
import InviteButton from '@/components/InviteButton';
import ProfileHeader from '@/components/profile/ProfileHeader';
import ProfileAbout from '@/components/profile/ProfileAbout';
import ProfileExperience from '@/components/profile/ProfileExperience';
import ProfileSkills from '@/components/profile/ProfileSkills';
import ProfileRecommendations from '@/components/profile/ProfileRecommendations';
import ProfileActivity from '@/components/profile/ProfileActivity';
import ProfileChecklist from '@/components/profile/ProfileChecklist';
import ProfileAnalytics from '@/components/profile/ProfileAnalytics';
import { loadMyConnections, suggestSimilar, connectedIds } from '@/lib/connections';
import { companyPath, providerPath } from '@/lib/paths';

// One page for every profile. Your own is the same page as everyone else's,
// with the edit controls turned on — what you see is what they see.
// `userId` undefined means "me".
export default function ProfilePage({ userId }) {
  const [me, setMe] = useState();
  const [user, setUser] = useState();
  const [loading, setLoading] = useState(true);
  const [connections, setConnections] = useState({ sent: [], received: [], all: [] });
  const [theirs, setTheirs] = useState([]);
  const [members, setMembers] = useState([]);
  const [companies, setCompanies] = useState({});
  const [companyLogos, setCompanyLogos] = useState({});
  const [suggestions, setSuggestions] = useState([]);
  const [editing, setEditing] = useState(null);
  const [saved, setSaved] = useState(false);

  const reload = async () => { if (me) setConnections(await loadMyConnections(me.id)); };

  useEffect(() => {
    // Moving from one profile to another reuses this component, so everything
    // that belongs to a profile is reset here, and a load that is still in
    // flight when the next one starts must not land on the new page.
    let alive = true;
    const set = (fn) => (value) => { if (alive) fn(value); };
    setLoading(true); setUser(undefined); setEditing(null); setTheirs([]); setSuggestions([]); setConnections({ sent: [], received: [], all: [] });
    (async () => {
      if (!(await api.auth.isAuthenticated())) return api.auth.redirectToLogin(location.href);
      const u = await api.auth.me();
      if (!alive) return;
      setMe(u);
      const self = !userId || userId === u.id;
      // The session already carries everything about yourself, including the
      // private fields the public route strips.
      const target = self ? u : await api.entities.User.get(userId).catch(() => null);
      if (!alive) return;
      setUser(target);
      if (!target) { setLoading(false); return; }
      // Counted for the owner's private Analytics box. Only the number is ever
      // shown; the server skips your own profile and the guest.
      if (!self && !u.guest) api.functions.invoke('recordProfileView', { userId: target.id }).catch(() => {});
      // The guest has no connections of its own (the server hides the seeded
      // ones), so this is empty for it, and the page reads the same either way.
      const conn = await loadMyConnections(u.id).catch(() => ({ sent: [], received: [], all: [] }));
      if (!alive) return;
      setConnections(conn);
      setLoading(false);
      // Decoration, loaded after the page is usable.
      api.entities.User.list('-created_date', 500).then(set(setMembers)).catch(() => {});
      // Both the link and the logo, so a role at a business in the directory
      // shows that business's own mark rather than a generic briefcase.
      Promise.all([
        api.entities.Company.filter({ status: 'published' }).catch(() => []),
        api.entities.Provider.filter({ status: 'published' }).catch(() => []),
      ]).then(([companyRows, providerRows]) => {
        const byName = {};
        const logos = {};
        for (const c of companyRows) {
          if (!c.name) continue;
          const key = c.name.trim().toLowerCase();
          byName[key] = companyPath(c);
          if (c.logo_url) logos[key] = c.logo_url;
        }
        // A listing can stand in for a company that has no page of its own.
        for (const pr of providerRows) {
          if (!pr.name) continue;
          const key = pr.name.trim().toLowerCase();
          if (!byName[key]) byName[key] = providerPath(pr);
          if (!logos[key] && pr.logo_url) logos[key] = pr.logo_url;
        }
        set(setCompanies)(byName);
        set(setCompanyLogos)(logos);
      }).catch(() => {});
      if (self) {
        setTheirs(conn.all.filter((c) => c.status === 'accepted'));
      } else {
        Promise.all([api.entities.Connection.filter({ requester_id: target.id, status: 'accepted' }), api.entities.Connection.filter({ recipient_id: target.id, status: 'accepted' })])
          .then(([a, b]) => set(setTheirs)([...a, ...b])).catch(() => {});
      }
      suggestSimilar(target, u.id, [...connectedIds(conn)]).then(set(setSuggestions)).catch(() => {});
    })();
    return () => { alive = false; };
  }, [userId]);

  const save = async (patch) => {
    const updated = await api.auth.updateMe(patch);
    setUser((u) => ({ ...u, ...updated }));
    setMe((m) => ({ ...m, ...updated }));
    setSaved(true); setTimeout(() => setSaved(false), 1800);
    return updated;
  };

  if (loading) return <div className="loading">Loading profile…</div>;
  if (me?.guest && (!userId || userId === me.id)) return <GuestPrompt title="Your profile starts with an account" body="You're browsing as a guest, so there is nothing to edit here yet. Create a free account to set up your profile, add work experience, and manage your listings."/>;
  if (!user) return <div className="empty">This community member could not be found.</div>;

  const isMe = me?.id === user.id;
  const editable = isMe && !me.guest;
  const nameOf = new Map(members.map((m) => [m.id, m.full_name || 'Community member']));
  const theirIds = new Set(theirs.flatMap((c) => [c.requester_id, c.recipient_id]).filter((id) => id !== user.id));
  const mineAccepted = new Set(connections.all.filter((c) => c.status === 'accepted').flatMap((c) => [c.requester_id, c.recipient_id]).filter((id) => id !== me.id));
  const mutualIds = isMe || me.guest ? [] : [...theirIds].filter((id) => mineAccepted.has(id));
  const mutual = { count: mutualIds.length, names: mutualIds.slice(0, 3).map((id) => nameOf.get(id)).filter(Boolean) };

  return <div className="page-shell max-w-3xl space-y-5 py-8">
    {isMe
      ? <div className="flex flex-wrap items-center justify-between gap-3">
        <div><span className="eyebrow">YOUR PROFILE</span><p className="text-sm text-brand-body">This is your profile exactly as members see it. Click a pencil to change a section.</p></div>
        <span className={`text-sm font-semibold text-brand-teal transition-opacity ${saved ? 'opacity-100' : 'opacity-0'}`} aria-live="polite">Saved</span>
      </div>
      : <Link to="/people" className="flex items-center gap-2 text-sm font-semibold text-brand-teal"><ArrowLeft size={17}/>Back to people</Link>}

    {editable && <ProfileChecklist user={user} onEdit={(section) => setEditing(section)}/>}

    <ProfileHeader user={user} me={me} editable={editable} onSave={save} connections={connections} onReload={reload} companies={companies} connectionCount={theirIds.size} mutual={mutual} editing={editing} setEditing={setEditing}/>
    {editable && <ProfileAnalytics/>}
    <ProfileAbout user={user} editable={editable} onSave={save} editing={editing} setEditing={setEditing}/>
    <ProfileExperience user={user} editable={editable} onSave={save} companies={companies} companyLogos={companyLogos} editing={editing} setEditing={setEditing}/>
    <ProfileSkills user={user} me={me} editable={editable} onSave={save} editing={editing} setEditing={setEditing}/>
    <ProfileRecommendations user={user} me={me} members={members} editable={editable} editing={editing} setEditing={setEditing}/>
    <ProfileActivity user={user} me={me} editable={editable}/>

    {editable && <div className="panel"><p className="font-semibold text-brand-ink">Invite people from your community</p><p className="mb-3 text-sm text-brand-body">Klal works when the people you trust are on it. Your link is yours; anyone who joins through it is connected to you.</p><InviteButton/></div>}

    <PeopleYouMayKnow suggestions={suggestions} me={me} connections={connections} onReload={reload}/>
  </div>;
}
