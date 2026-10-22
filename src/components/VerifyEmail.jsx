import React, { useState } from 'react';
import { Mail, Loader2 } from 'lucide-react';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import AuthLayout from '@/components/AuthLayout';
import { toast } from '@/components/ui/use-toast';
import { friendlyAuthError } from '@/lib/authErrors';

// The six-digit email check. Sign-up lands here right after registering; log
// in lands here when the account never finished verifying. Both go on to
// `onVerified` with a session once the code is right.
export default function VerifyEmail({ email, onVerified, devCode }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const verify = async () => {
    setError(''); setLoading(true);
    try {
      const result = await api.auth.verifyOtp({ email, otpCode: code });
      if (result?.access_token) api.auth.setToken(result.access_token);
      onVerified(result);
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally { setLoading(false); }
  };

  const resend = async () => {
    setError('');
    try {
      await api.auth.resendOtp(email);
      toast({ title: 'Code sent', description: 'Check your email for the new code.' });
    } catch (err) { setError(friendlyAuthError(err)); }
  };

  return <AuthLayout icon={Mail} title="Check your email" subtitle={`We sent a 6-digit code to ${email}`}>
    {error && <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">{error}</div>}
    {import.meta.env.DEV && devCode && <div className="mb-4 p-3 rounded-lg bg-primary/10 text-brand-teal text-sm">Local dev: your code is <code className="font-mono font-bold">{devCode}</code></div>}
    <div className="flex justify-center mb-6">
      <InputOTP maxLength={6} value={code} onChange={setCode} autoFocus autoComplete="one-time-code">
        <InputOTPGroup>{[0, 1, 2, 3, 4, 5].map((i) => <InputOTPSlot key={i} index={i} />)}</InputOTPGroup>
      </InputOTP>
    </div>
    <Button className="w-full h-12 font-medium" onClick={verify} disabled={loading || code.length < 6}>
      {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Verifying...</> : 'Verify'}
    </Button>
    <p className="text-center text-sm text-muted-foreground mt-4">
      Didn't get it? Check spam, or{' '}
      <button type="button" onClick={resend} className="text-brand-teal font-medium hover:underline">send a new code</button>
    </p>
  </AuthLayout>;
}
