import React,{useEffect,useState} from 'react';
import { Link, useNavigate } from 'react-router-dom';
import SuggestInput from '@/components/SuggestInput';
import { startsWord } from '@/lib/searchTerms';
import { api } from '@/api/client';
import { Search } from 'lucide-react';
import UserCard from '@/components/UserCard';
import PeopleYouMayKnow from '@/components/PeopleYouMayKnow';
import { loadMyConnections, suggestSimilar, sentThisWeekCount, connectedIds, topJob, WEEKLY_CAP } from '@/lib/connections';
import InviteButton from '@/components/InviteButton';
import { WORK_STATUSES } from '@/lib/workStatus';
import { LoadingCards } from '@/components/Loading';

export default function People(){
  const [me,setMe]=useState();
  const [users,setUsers]=useState([]);
  const [connections,setConnections]=useState({ sent:[], received:[], all:[] });
  const [suggestions,setSuggestions]=useState([]);
  const [q,setQ]=useState('');
  const [statusFilter,setStatusFilter]=useState('');
  const [loading,setLoading]=useState(true);

  const reload = async () => {
    if (!me) return;
    setConnections(await loadMyConnections(me.id));
  };

  useEffect(()=>{(async()=>{
    const authenticated = await api.auth.isAuthenticated();
    const u = authenticated ? await api.auth.me() : { id: null, guest: true, full_name: 'Guest' };
    setMe(u);
    const [allUsers, conn] = await Promise.all([
      api.entities.User.list('-created_date', 200),
      authenticated ? loadMyConnections(u.id) : Promise.resolve({ sent: [], received: [], all: [] }),
    ]);
    const ranked = allUsers.filter(x => x.id !== u.id).map(x => ({ user: x }));
    setUsers(ranked);
    setConnections(conn);
    const excluded = [...connectedIds(conn)];
    setSuggestions(authenticated ? await suggestSimilar(u, u.id, excluded) : []);
    setLoading(false);
  })()},[]);

  const conns = connectedIds(connections);
  const filtered = users.filter(({user}) => {
    if (q) {
      const hay = [user.full_name, user.headline, user.home_city, user.profile_type, topJob(user)?.title, topJob(user)?.company].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    if (statusFilter && user.work_status !== statusFilter) return false;
    return true;
  });

  // As you type: members by name (opens their profile), then towns and
  // companies (fills the search).
  const navigate = useNavigate();
  const suggest = (text) => {
    const people = users.filter(({user}) => startsWord(user.full_name, text)).slice(0, 5)
      .map(({user}) => ({ group: 'People', kind: 'person', label: user.full_name, value: user, hint: user.home_city || '' }));
    const words = (get, group, kind) => {
      const all = users.map(({user}) => (get(user) || '').trim()).filter(Boolean);
      return [...new Set(all.filter((v) => startsWord(v, text)))].slice(0, 3)
        .map((v) => ({ group, kind, label: v, value: v, count: all.filter((x) => x === v).length }));
    };
    return [...people, ...words((u) => u.home_city, 'Towns', 'place'), ...words((u) => topJob(u)?.company, 'Companies', 'company')];
  };
  const pick = (item) => (item.kind === 'person' ? navigate(`/profile/${item.value.id}`) : setQ(item.value));

  if (!me) return <div className="loading">Loading community…</div>;

  const used = sentThisWeekCount(connections.sent);

  return <div className="page-shell space-y-10 py-9">
    <div>
      <span className="eyebrow">COMMUNITY</span>
      <h1 className="title">People</h1>
      <p className="helper">Discover community members and connect.{!me.guest && ` You can send up to ${WEEKLY_CAP} connection requests per week.`}</p>
      {!me.guest && <p className="mt-2 text-sm font-semibold text-brand-teal">{used} / {WEEKLY_CAP} sent this week</p>}
      <div className="mt-2 flex gap-4 text-sm font-semibold text-brand-teal">
        <Link to="/messages" className="hover:underline">Messages →</Link>
      </div>
      {!me.guest && <div className="mt-4 rounded-lg bg-brand-tint p-4"><p className="text-sm font-semibold text-brand-ink">Know someone who should be here?</p><p className="mb-3 text-sm text-brand-body">Klal gets better with every person from your community. Anyone who joins through your link is connected to you.</p><InviteButton/></div>}
    </div>

    <div className="relative">
      <Search size={16} className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-[#9AA8A2]"/>
      <SuggestInput className="field pl-9" placeholder="Search by name, city, or company" aria-label="Search people" value={q} onChange={setQ} onPick={pick} suggest={suggest}/>
    </div>

    <div className="flex flex-wrap gap-2">
      {Object.values(WORK_STATUSES).map(s => (
        <button key={s.id} type="button" onClick={()=>setStatusFilter(f=>f===s.id?'':s.id)} className={`rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ${statusFilter===s.id?s.badge.replace('ring-1 ',''):'bg-brand-surface text-brand-muted ring-brand-line'}`}>{s.label}</button>
      ))}
    </div>

    {!q && <PeopleYouMayKnow suggestions={suggestions} me={me} connections={connections} onReload={reload}/>}

    <section>
      <div className="section-head"><h2 className="title">{q ? 'Matching profiles' : 'All members'}</h2><Link to="/profile" className="text-sm font-semibold text-brand-teal">My profile</Link></div>
      {loading ? <LoadingCards kind="person" count={6} label="Loading members…"/> : filtered.length === 0
        ? <p className="text-sm text-brand-muted">No members found{q ? ` for "${q}"` : ''}.</p>
        : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{filtered.map(({user})=><UserCard key={user.id} user={user} me={me} connections={connections} onReload={reload}/>)}</div>}
    </section>
  </div>;
}