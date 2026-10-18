import React, { useEffect, useState } from 'react';
import { BarChart3, Eye, EyeOff, Heart, MessageCircle, Repeat2, Users } from 'lucide-react';
import { api } from '@/api/client';

// The private Analytics box on your own profile, like LinkedIn's: how many
// people looked at your profile and how your posts did, over a stretch you
// pick. Nobody else ever sees it, and it shows numbers only, never names.

const RANGES = [
  { id: 7, label: '7 days', span: 'the last 7 days', before: 'the 7 days before' },
  { id: 30, label: '30 days', span: 'the last 30 days', before: 'the 30 days before' },
  { id: 90, label: '90 days', span: 'the last 90 days', before: 'the 90 days before' },
  { id: 365, label: '1 year', span: 'the last year', before: 'the year before' },
  { id: 'all', label: 'All time', span: 'all time' },
];

const TILES = [
  { key: 'profile_views', label: 'Profile views', icon: Users, chart: true },
  { key: 'impressions', label: 'Post views', icon: Eye, chart: true },
  { key: 'reactions', label: 'Likes', icon: Heart },
  { key: 'comments', label: 'Comments', icon: MessageCircle },
  { key: 'reposts', label: 'Reposts', icon: Repeat2 },
];

const fmt = (n) => Number(n || 0).toLocaleString();
const count = (n, word) => `${fmt(n)} ${word}${n === 1 ? '' : 's'}`;
const day = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

// "Up 12", against the same stretch just before it (said once, under the tiles).
function Change({ count, before }) {
  const diff = count - before;
  if (before === null || (!count && !before)) return null;
  if (diff === 0) return <span className="text-xs text-brand-muted">Same</span>;
  return <span className={`text-xs font-semibold ${diff > 0 ? 'text-brand-success' : 'text-brand-muted'}`}>{diff > 0 ? 'Up' : 'Down'} {fmt(Math.abs(diff))}</span>;
}

function Bars({ buckets, field, label }) {
  const max = Math.max(1, ...buckets.map((b) => b[field]));
  const total = buckets.reduce((s, b) => s + b[field], 0);
  const unit = buckets[0]?.unit || 'day';
  const name = (b) => (b.unit === 'month' ? new Date(b.start).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : b.unit === 'week' ? `Week of ${day(b.start)}` : day(b.start));
  return <figure className="mt-4">
    <div className="flex h-28 items-end gap-[2px] border-b border-brand-line" role="img" aria-label={`${label} by ${unit}: ${buckets.map((b) => `${name(b)} ${b[field]}`).join(', ')}`}>
      {buckets.map((b) => <div key={b.start} className="group relative flex h-full min-w-0 flex-1 items-end" title={`${name(b)}: ${fmt(b[field])}`}>
        <div className="w-full rounded-t-[4px] bg-brand-teal transition-opacity group-hover:opacity-80" style={{ height: b[field] ? `${Math.max(4, (b[field] / max) * 100)}%` : '0' }}/>
        <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-brand-ink px-2 py-1 text-xs font-semibold text-brand-canvas shadow group-hover:block">{name(b)}: {fmt(b[field])}</span>
      </div>)}
    </div>
    <figcaption className="mt-1.5 flex justify-between text-xs text-brand-muted">
      <span>{unit === 'month' ? name(buckets[0]) : day(buckets[0].start)}</span>
      <span>{total ? `${fmt(max)} in the busiest ${unit}` : `No ${label.toLowerCase()} yet`}</span>
      <span>Today</span>
    </figcaption>
  </figure>;
}

export default function ProfileAnalytics() {
  const [days, setDays] = useState(30);
  const [chart, setChart] = useState('impressions');
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    setError(false);
    api.functions.invoke('myAnalytics', { days, tzOffset: new Date().getTimezoneOffset() }).then((r) => {
      if (!alive) return;
      if (r.status >= 400) setError(true); else setData(r.data);
    });
    return () => { alive = false; };
  }, [days]);

  const chartTile = TILES.find((t) => t.key === chart);
  const shown = RANGES.find((r) => r.id === data?.days) || RANGES[1];

  return <section className="panel" aria-labelledby="analytics-title">
    <div>
      <h2 id="analytics-title" className="section-title flex items-center gap-2"><BarChart3 size={20} className="text-brand-teal"/>Analytics</h2>
      <p className="mt-0.5 flex items-center gap-1.5 text-sm text-brand-muted"><EyeOff size={14}/>Private to you</p>
    </div>
    <div className="mt-3 grid grid-cols-5 rounded-full bg-brand-canvas p-1 ring-1 ring-brand-line sm:inline-grid" role="group" aria-label="Time range">
      {RANGES.map((r) => <button key={r.id} type="button" onClick={() => setDays(r.id)} aria-pressed={days === r.id} className={`whitespace-nowrap rounded-full px-1.5 py-1 text-xs font-semibold transition sm:px-3 ${days === r.id ? 'bg-brand-navy text-white' : 'text-brand-body hover:text-brand-ink'}`}>{r.label}</button>)}
    </div>

    {error && <p className="mt-4 text-sm text-brand-muted">Your analytics could not be loaded just now. Please try again in a moment.</p>}
    {!error && !data && <p className="mt-4 text-sm text-brand-muted">Loading your analytics…</p>}
    {!error && data && <>
      <div className="mt-4 grid grid-cols-6 gap-2 sm:grid-cols-5">
        {TILES.map((t, i) => {
          const v = data.totals[t.key] || { count: 0, before: 0 };
          const Icon = t.icon;
          const picked = t.chart && chart === t.key;
          const body = <>
            <span className="flex items-center gap-1.5 text-xs font-semibold text-brand-body"><Icon size={14} className="text-brand-teal"/>{t.label}</span>
            <span className="mt-1 block font-heading text-2xl font-bold text-brand-ink">{fmt(v.count)}</span>
            <Change count={v.count} before={v.before}/>
          </>;
          const cls = `rounded-xl p-3 text-left ring-1 ${i < 2 ? 'col-span-3' : 'col-span-2'} sm:col-span-1 ${picked ? 'bg-brand-tint ring-brand-teal' : 'bg-brand-canvas ring-brand-line'}`;
          return t.chart
            ? <button key={t.key} type="button" onClick={() => setChart(t.key)} aria-pressed={picked} className={`${cls} hover:ring-brand-teal/60`}>{body}</button>
            : <div key={t.key} className={cls}>{body}</div>;
        })}
      </div>

      <p className="mt-2 text-xs text-brand-muted">{shown.before ? `Up or down compared with ${shown.before}. ` : ''}Tap Profile views or Post views to chart it.</p>

      <Bars buckets={data.buckets} field={chart} label={chartTile.label}/>

      {data.top_posts.length > 0 && <div className="mt-5">
        <h3 className="text-sm font-bold text-brand-ink">Your top posts {shown.id === 'all' ? 'of' : 'in'} {shown.span}</h3>
        <ul className="mt-2 divide-y divide-brand-line">
          {data.top_posts.map((p) => <li key={p.id} className="py-2.5">
            <a href={`/feed?post=${p.id}`} className="line-clamp-2 text-sm font-semibold text-brand-ink hover:text-brand-teal">{p.excerpt}</a>
            <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-brand-body">
              <span>{count(p.impressions, 'view')}</span><span>{count(p.reactions, 'like')}</span><span>{count(p.comments, 'comment')}</span><span>{count(p.reposts, 'repost')}</span>
            </p>
          </li>)}
        </ul>
      </div>}

      <p className="helper text-xs">Counts members who were signed in. Someone who opens your profile several times in one day counts once. Your own views and likes are not counted. Profile views are counted from the day this box was added, so earlier visits are not included.</p>
    </>}
  </section>;
}
