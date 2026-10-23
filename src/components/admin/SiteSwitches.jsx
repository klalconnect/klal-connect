import React, { useEffect, useState } from 'react';
import { api } from '@/api/client';
import { Handshake, Video, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';

// Site-wide switches an admin can flip (stored as Setting rows, admin-only).
// The server reads the same rows — see server/settings.js — so a switch here
// is the rule for the API and the pages Google reads, not just the screen.
const VOUCHES = 'vouches_enabled';
const VIDEOS = 'videos_enabled';

// One switch. `fallback` is what a switch nobody has flipped yet reads as,
// matching readFlag on the server.
function Switch({ settingKey, fallback = false, icon: Icon, title, helper, onText, offText, note }) {
  const [on, setOn] = useState(fallback), [busy, setBusy] = useState(false), [loaded, setLoaded] = useState(false), [err, setErr] = useState('');
  useEffect(() => {
    (async () => {
      try { const s = await api.entities.Setting.filter({ key: settingKey }); setOn(s[0] ? s[0].value === 'true' : fallback); } catch { /* shows the default */ }
      setLoaded(true);
    })();
  }, [settingKey, fallback]);
  const toggle = async () => {
    setBusy(true); setErr('');
    try {
      const existing = await api.entities.Setting.filter({ key: settingKey });
      const next = !on;
      if (existing.length > 0) await api.entities.Setting.update(existing[0].id, { value: String(next) });
      else await api.entities.Setting.create({ key: settingKey, value: String(next) });
      setOn(next);
    } catch (e) { setErr(e.message || 'That did not save. Please try again.'); }
    finally { setBusy(false); }
  };
  return <div className="panel flex items-start justify-between gap-4">
    <div>
      <h2 className="section-title flex items-center gap-2"><Icon size={18}/>{title}</h2>
      <p className="helper">{helper}</p>
      <p className="mt-2 text-sm font-semibold text-brand-ink">{!loaded ? 'Checking…' : on ? onText : offText}</p>
      {note && <p className="mt-1 text-xs font-semibold text-brand-error">{note}</p>}
      {err && <p className="mt-1 text-xs font-semibold text-brand-error">{err}</p>}
    </div>
    <button onClick={toggle} disabled={!loaded || busy} className={`shrink-0 rounded-xl px-5 py-2.5 text-sm font-bold text-white ${on ? 'bg-brand-error' : 'bg-brand-navy'}`}>{busy ? 'Saving…' : on ? 'Turn OFF' : 'Turn ON'}</button>
  </div>;
}

// A tiny upload done on the server the way a phone does it, so the reason
// Cloudflare refuses one can be read. A phone is only ever told "it failed".
const SETUP_LABELS = [['account_id', 'Account ID'], ['access_key_id', 'Access Key ID'], ['secret_access_key', 'Secret Access Key'], ['bucket', 'Bucket'], ['public_url', 'Public address']];
function VideoStorageCheck() {
  const [busy, setBusy] = useState(false), [r, setR] = useState(null), [err, setErr] = useState('');
  const run = async () => {
    setBusy(true); setErr(''); setR(null);
    try { setR(await api.admin.videoCheck()); } catch (e) { setErr(e.message || 'The test did not run. Please try again.'); }
    finally { setBusy(false); }
  };
  return <div className="panel space-y-3">
    <div className="flex items-start justify-between gap-4">
      <div>
        <h2 className="section-title flex items-center gap-2"><Video size={18}/>Test video storage</h2>
        <p className="helper">Uploads a tiny test file to Cloudflare, opens it, and deletes it, then says in plain words whether it worked.</p>
      </div>
      <button onClick={run} disabled={busy} className="shrink-0 rounded-xl bg-brand-navy px-5 py-2.5 text-sm font-bold text-white">{busy ? <Loader2 size={16} className="animate-spin"/> : 'Run test'}</button>
    </div>
    {err && <p className="text-sm font-semibold text-brand-error">{err}</p>}
    {r && <div className={`flex gap-2 rounded-lg p-3 text-sm ${r.ok ? 'bg-brand-tint text-brand-ink' : 'bg-brand-error/10 text-brand-ink'}`}>
      {r.ok ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-brand-teal"/> : <AlertTriangle size={18} className="mt-0.5 shrink-0 text-brand-error"/>}
      <div className="min-w-0 space-y-2">
        <p className="font-semibold">{r.reason}</p>
        {r.setup && <dl className="space-y-0.5 text-xs text-brand-body">{SETUP_LABELS.map(([k, label]) => <div key={k} className="flex flex-wrap gap-x-1.5"><dt className="font-semibold">{label}:</dt><dd>{r.setup[k]}</dd></div>)}</dl>}
        {r.upload && <p className="text-xs text-brand-muted">Cloudflare replied {r.upload.status || 'nothing'}{r.upload.code ? ` (${r.upload.code})` : ''}{r.upload_type_only ? `; without the size: ${r.upload_type_only.status}${r.upload_type_only.code ? ` (${r.upload_type_only.code})` : ''}` : ''}{r.view ? `; opening it: ${r.view.status || r.view.code}` : ''}.</p>}
      </div>
    </div>}
  </div>;
}

export default function SiteSwitches() {
  // Whether the video storage keys are in place yet. Until they are, the
  // switch can be set but nobody sees a video button.
  const [videoStorage, setVideoStorage] = useState(true);
  useEffect(() => { api.getConfig().then((c) => setVideoStorage(c.videoStorage !== false)); }, []);
  return <div className="space-y-4">
    <Switch settingKey={VOUCHES} icon={Handshake} title="Vouches and community notes"
      helper={<>When off, vouches, vouch counts and community notes are hidden everywhere on the site, and nobody can add new ones. Nothing is deleted: turning it back on shows everything again as it was. The &ldquo;used them&rdquo; count is not affected.</>}
      onText="On: visitors see vouches and notes." offText="Off: vouches and notes are hidden." />
    <Switch settingKey={VIDEOS} fallback icon={Video} title="Videos in feed posts"
      helper="Members can add one video to a post, up to 60 seconds. Turning this off removes the video button, so no new videos can be added. Videos already posted keep playing. Use it if video storage ever gets close to its free limit."
      onText="On: members can add videos." offText="Off: no new videos."
      note={videoStorage ? '' : 'Video storage is not set up yet, so nobody sees the video button.'} />
    {videoStorage && <VideoStorageCheck />}
  </div>;
}
