import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { UserPlus, LogIn, Compass } from 'lucide-react';
import { api } from '@/api/client';
import useVouchesEnabled from '@/hooks/useVouchesEnabled';
import AuthLayout from '@/components/AuthLayout';

// Where an invite link lands. Remembers the code so the account created next
// is credited to the inviter, and says who invited you before asking for
// anything.
export default function Join() {
  const vouchesOn = useVouchesEnabled();
  const { code } = useParams();
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const invite = await api.invites.get(code);
        try { localStorage.setItem('kc_invite_code', invite.code); } catch { /* private mode */ }
        const member = await api.auth.hasAccount().catch(() => false);
        if (alive) setState({ loading: false, invite, member });
      } catch (err) {
        if (alive) setState({ loading: false, error: err.message || 'That invite link is not valid.' });
      }
    })();
    return () => { alive = false; };
  }, [code]);

  if (state.loading) return <div className="loading">Opening your invite…</div>;

  const register = '/register?returnTo=' + encodeURIComponent('/welcome');
  return <AuthLayout icon={UserPlus} title={state.invite ? `${state.invite.inviter_name} invited you to Klal Connect` : 'Welcome to Klal Connect'} subtitle={state.error || (vouchesOn ? 'Trusted businesses, gemachs and professionals — vouched for by people you know.' : 'Trusted businesses, gemachs and professionals, shared by people you know.')}
    footer={<Link to="/directory" className="text-brand-teal font-medium hover:underline"><Compass className="w-3 h-3 inline mr-1" />Browse the directory first</Link>}>
    <div className="space-y-3">
      {state.member
        ? <p className="text-sm text-center text-foreground">You already have an account — you're in. <Link to="/feed" className="text-brand-teal font-medium hover:underline">Open the feed</Link></p>
        : <>
          <Link to={register} className="flex h-12 w-full items-center justify-center gap-2 rounded-md bg-brand-navy font-medium text-white hover:bg-brand-navy-hover"><UserPlus size={17}/>Create a free account</Link>
          <Link to="/login" className="flex h-12 w-full items-center justify-center gap-2 rounded-md border border-brand-line bg-brand-surface font-medium text-brand-ink hover:bg-brand-tint"><LogIn size={17}/>I already have one</Link>
        </>}
    </div>
  </AuthLayout>;
}
