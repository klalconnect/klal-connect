import React, { useEffect, useRef, useState } from 'react';
import { api } from '@/api/client';
import { friendlyAuthError } from '@/lib/authErrors';

// "Continue with Google" through Google Identity Services. Renders nothing at
// all unless the server has a client id (GOOGLE_CLIENT_ID), so there is never
// a dead button. Google hands back an ID token; the server verifies it and
// creates or signs in the account — no password, no verification code,
// because Google already verified the address.
const GSI_SRC = 'https://accounts.google.com/gsi/client';
const GOOGLE_FAILED = 'Google sign-in did not work. Please try again, or use your email below.';
const GOOGLE_UNAVAILABLE = 'Google sign-in is not available right now. You can use your email below.';
let gsiLoading = null;
function loadGsi() {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (!gsiLoading) {
    gsiLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = GSI_SRC; s.async = true; s.defer = true;
      s.onload = resolve; s.onerror = () => reject(new Error('Google sign-in could not load.'));
      document.head.appendChild(s);
    });
  }
  return gsiLoading;
}

export default function GoogleButton({ onSignedIn, onError, text = 'continue_with' }) {
  const [clientId, setClientId] = useState(null);
  const box = useRef(null);

  useEffect(() => { api.getConfig().then((c) => setClientId(c.googleClientId || '')).catch(() => setClientId('')); }, []);

  useEffect(() => {
    if (!clientId || !box.current) return;
    let cancelled = false;
    loadGsi().then(() => {
      if (cancelled || !window.google?.accounts?.id) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: async ({ credential }) => {
          try { onSignedIn(await api.auth.loginWithGoogle(credential)); }
          catch (err) { onError?.(friendlyAuthError(err, GOOGLE_FAILED)); }
        },
        ux_mode: 'popup',
        itp_support: true,
      });
      window.google.accounts.id.renderButton(box.current, { theme: 'outline', size: 'large', shape: 'pill', text, width: 340, logo_alignment: 'left' });
    }).catch((err) => { console.warn('[auth] Google button did not load', err); onError?.(GOOGLE_UNAVAILABLE); });
    return () => { cancelled = true; };
  }, [clientId, onSignedIn, onError, text]);

  if (!clientId) return null;
  return <div className="mb-6">
    <div ref={box} className="flex justify-center" />
    <div className="relative mt-6">
      <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border" /></div>
      <div className="relative flex justify-center text-xs uppercase"><span className="bg-card px-3 text-muted-foreground">or</span></div>
    </div>
  </div>;
}
