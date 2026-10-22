import React, { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserPlus, Mail, Loader2 } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";
import PasswordInput from "@/components/PasswordInput";
import VerifyEmail from "@/components/VerifyEmail";
import GoogleButton from "@/components/GoogleButton";
import EmailSuggestion from "@/components/EmailSuggestion";
import { safeReturnTo } from "@/lib/authReturnTo";
import { suggestEmail } from "@/lib/emailCheck";
import { friendlyAuthError } from "@/lib/authErrors";

// A new account goes through the welcome cards first, then on to wherever
// it was headed.
const welcomeUrl = () => { const rt = safeReturnTo(); return '/welcome' + (rt !== '/' && rt !== '/welcome' ? '?returnTo=' + encodeURIComponent(rt) : ''); };

export default function Register() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // Set once the server has emailed a verification code; null until then, and
  // never when the server signed the account in directly.
  const [verify, setVerify] = useState(null);
  // A likely typo caught before sending ("gmial.com"), and the address the
  // person already said is right, so they are asked only once.
  const [suggestion, setSuggestion] = useState(null);
  const [keptEmail, setKeptEmail] = useState(null);
  const reasonReport = new URLSearchParams(window.location.search).get("reason") === "report";
  const loginLink = (() => { const p = new URLSearchParams(); const rt = safeReturnTo(); if (rt !== "/") p.set("returnTo", rt); if (reasonReport) p.set("reason", "report"); return "/login" + (p.toString() ? "?" + p.toString() : ""); })();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    const typed = email.trim();
    const fix = typed !== keptEmail ? suggestEmail(typed) : null;
    if (fix) { setSuggestion(fix); return; }
    setSuggestion(null);
    setLoading(true);
    try {
      const result = await api.auth.register({ email: typed, password });
      if (result?.access_token) { window.location.href = welcomeUrl(); return; }
      // The server hands the code back only in local dev; the production
      // bundle must not even know the field exists, so the read is behind a
      // build-time constant Vite folds away.
      setVerify({ email: typed, devCode: import.meta.env.DEV ? result?.dev_code : undefined });
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  if (verify) return <VerifyEmail email={verify.email} devCode={verify.devCode} onVerified={() => { window.location.href = welcomeUrl(); }} />;

  return (
    <AuthLayout
      icon={UserPlus}
      title="Create your account"
      subtitle="Sign up to get started"
      footer={
        <>
          Already have an account?{" "}
          <Link
            to={loginLink}
            className="text-brand-teal font-medium hover:underline"
          >
            Log in
          </Link>
        </>
      }
    >
    {reasonReport && (
      <div className="mb-4 p-3 rounded-lg bg-primary/10 text-brand-teal text-sm">
        Please log in to report an issue. Reports are private, but we require an account so our review team can follow up if needed.
      </div>
    )}
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
          {error}
        </div>
      )}

      <GoogleButton text="signup_with" onSignedIn={() => { window.location.href = welcomeUrl(); }} onError={setError} />

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Input
              id="email"
              type="email"
              autoComplete="email"
              autoFocus
              placeholder="you@example.com"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setSuggestion(null); }}
              className="pl-10 h-12"
              required
            />
          </div>
          <EmailSuggestion
            suggestion={suggestion}
            onAccept={() => { setEmail(suggestion); setSuggestion(null); }}
            onKeep={() => { setKeptEmail(email.trim()); setSuggestion(null); }}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <PasswordInput
            id="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="flex h-12 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            withIcon
            minLength={8}
            required
          />
          <p className="text-xs text-muted-foreground">At least 8 characters. Use the eye icon to check what you typed.</p>
        </div>
        <Button type="submit" className="w-full h-12 font-medium" disabled={loading}>
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Creating account...
            </>
          ) : (
            "Create account"
          )}
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          By creating an account, you agree to our{" "}
          <Link to="/terms" className="text-brand-teal font-medium hover:underline">Terms of Use</Link>
          {" "}and{" "}
          <Link to="/privacy" className="text-brand-teal font-medium hover:underline">Privacy policy</Link>.
        </p>
      </form>
    </AuthLayout>
  );
}