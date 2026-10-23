import React, { useEffect, useState } from 'react';
import { Pencil, Loader2, X, Award } from 'lucide-react';
import { api } from '@/api/client';
import PickPills from '@/components/PickPills';
import { suggestSkills } from '@/lib/skillSuggestions';

// Skills, and who has endorsed them — LinkedIn's mechanic, scaled to a
// community: a member lists what they do, and anyone who knows their work
// can back it up with one click. Endorsement counts are public (even to a
// guest), the same as a listing's vouch count.
export default function ProfileSkills({ user, me, editable, onSave, editing, setEditing }) {
  const [draft, setDraft] = useState('');
  const [list, setList] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [rows, setRows] = useState([]);
  const [endorseBusy, setEndorseBusy] = useState(null);
  const [more, setMore] = useState(false);
  const open = editing === 'skills';
  const skills = user.skills || [];
  const canEndorse = me && !me.guest && me.id !== user.id;

  useEffect(() => { if (open) { setList(skills); setDraft(''); setErr(''); setMore(false); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Every endorsement for this profile, loaded once: enough to both count
  // per skill and know whether the viewer already endorsed each one.
  useEffect(() => {
    let alive = true;
    api.entities.SkillEndorsement.filter({ user_id: user.id }).then((r) => { if (alive) setRows(r); }).catch(() => {});
    return () => { alive = false; };
  }, [user.id]);

  if (!skills.length && !editable) return null;

  const start = () => setEditing('skills');
  const add = (skill) => {
    const clean = skill.trim();
    if (!clean || list.some((s) => s.toLowerCase() === clean.toLowerCase())) return;
    if (list.length >= 30) { setErr('Up to 30 skills.'); return; }
    setList([...list, clean]);
  };
  const addFromDraft = () => { add(draft); setDraft(''); };
  // Picking a suggestion while something is typed takes the typing's place:
  // the typing was only there to find it.
  const pick = (skill) => { add(skill); setDraft(''); };
  const suggestions = open ? suggestSkills(user, list, draft) : [];
  const shown = suggestions.slice(0, more || draft.trim() ? 40 : 12);
  const onKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addFromDraft(); }
  };
  const remove = (skill) => setList(list.filter((s) => s !== skill));
  const save = async () => {
    setBusy(true); setErr('');
    // Words typed but not yet entered still count, the way leaving the box
    // used to add them.
    const typed = draft.trim();
    const final = typed && !list.some((s) => s.toLowerCase() === typed.toLowerCase()) && list.length < 30 ? [...list, typed] : list;
    try { await onSave({ skills: final }); setEditing(null); }
    catch (error) { setErr(error.message || 'Could not save'); }
    finally { setBusy(false); }
  };

  const countOf = (skill) => rows.filter((r) => r.skill.toLowerCase() === skill.toLowerCase()).length;
  const endorsedByMe = (skill) => !!me && rows.some((r) => r.skill.toLowerCase() === skill.toLowerCase() && r.created_by_id === me.id);
  const ranked = [...skills].sort((a, b) => countOf(b) - countOf(a));

  const toggleEndorse = async (skill) => {
    if (!canEndorse || endorseBusy) return;
    setEndorseBusy(skill);
    const r = await api.functions.invoke('toggleSkillEndorsement', { user_id: user.id, skill });
    setEndorseBusy(null);
    if (r.status >= 400) { setErr(r.data?.error || 'Could not endorse'); return; }
    setErr('');
    // Optimistic-enough: refetch rather than hand-patch, since the count
    // depends on rows this component does not otherwise track per-toggle.
    api.entities.SkillEndorsement.filter({ user_id: user.id }).then(setRows).catch(() => {});
  };

  return <section id="skills" className="panel scroll-mt-24 space-y-3">
    <div className="flex items-center justify-between gap-3"><h2 className="section-title">Skills</h2>{editable && !open && <button type="button" onClick={start} className="icon-button" aria-label="Edit skills"><Pencil size={16}/></button>}</div>
    {open
      ? <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {list.map((s) => <span key={s} className="inline-flex items-center gap-1.5 rounded-full bg-brand-tint px-3 py-1.5 text-sm font-medium text-brand-ink">{s}<button type="button" onClick={() => remove(s)} aria-label={`Remove ${s}`} className="text-brand-muted hover:text-brand-error"><X size={13}/></button></span>)}
        </div>
        <PickPills label={draft.trim() ? 'Matching skills' : 'Suggested for you. Tap to add'} options={shown} onPick={pick}/>
        {!draft.trim() && !more && suggestions.length > shown.length && <button type="button" onClick={() => setMore(true)} className="text-sm font-semibold text-brand-teal hover:underline">Show more suggestions</button>}
        <input className="field" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKeyDown} placeholder="Or type your own and press Enter" enterKeyHint="done"/>
        {err && <p className="text-sm font-semibold text-brand-error">{err}</p>}
        <div className="flex items-center gap-3"><button type="button" onClick={save} className="primary" disabled={busy}>{busy ? <Loader2 size={15} className="animate-spin"/> : null}Save</button><button type="button" onClick={() => setEditing(null)} className="text-sm font-medium text-brand-muted hover:text-brand-ink">Cancel</button></div>
      </div>
      : skills.length
        ? <div className="flex flex-wrap gap-2">
          {ranked.map((s) => {
            const count = countOf(s);
            const mine = endorsedByMe(s);
            return <button
              key={s}
              type="button"
              disabled={!canEndorse || endorseBusy === s}
              onClick={() => toggleEndorse(s)}
              title={canEndorse ? (mine ? 'Remove your endorsement' : 'Endorse this skill') : undefined}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium ring-1 transition ${mine ? 'bg-brand-teal text-brand-canvas ring-brand-teal' : 'bg-brand-tint text-brand-ink ring-transparent'} ${canEndorse ? 'cursor-pointer hover:ring-brand-teal' : 'cursor-default'}`}
            >
              {endorseBusy === s ? <Loader2 size={13} className="animate-spin"/> : <Award size={13} className={mine ? '' : 'text-brand-teal'}/>}
              {s}
              {count > 0 && <span className={`text-xs font-semibold ${mine ? 'text-white/80' : 'text-brand-muted'}`}>{count}</span>}
            </button>;
          })}
        </div>
        : <button type="button" onClick={start} className="w-full rounded-lg border border-dashed border-brand-line px-4 py-5 text-left text-sm text-brand-muted hover:border-brand-teal hover:text-brand-teal">Add skills so people know what to ask you about — and connections can back you up.</button>}
    {!open && err && <p className="text-sm font-semibold text-brand-error">{err}</p>}
  </section>;
}
