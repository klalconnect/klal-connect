import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Mail, ArrowLeft, Loader2 } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";

export default function ForgotPassword() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [unavailable, setUnavailable] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const result = await api.auth.resetPasswordRequest(email.trim());
      const params = new URLSearchParams({ email: email.trim() });
      // Local dev gets the code prefilled; production builds drop this line
      // entirely and the person types the code from the email.
      if (import.meta.env.DEV && result?.dev_code) params.set("code", result.dev_code);
      navigate(`/reset-password?${params.toString()}`);
    } catch (err) {
      // 503 means the server has no way to email a code at all; say so
      // instead of promising a link that will never arrive. Any other failure
      // still shows the neutral "if an account exists" message, so the form
      // never reveals which addresses are registered.
      if (err?.status === 503) setUnavailable(err.message);
      else setSent(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      icon={Mail}
      title="Reset password"
      subtitle="We'll email you a six-digit code to reset it"
      footer={
        <Link to="/login" className="text-brand-teal font-medium hover:underline">
          <ArrowLeft className="w-3 h-3 inline mr-1" />Back to log in
        </Link>
      }
    >
      {unavailable ? (
        <p className="text-sm text-foreground text-center">{unavailable} Please email <a className="font-semibold text-brand-teal hover:underline" href="mailto:hello@klalconnect.org">hello@klalconnect.org</a> for help.</p>
      ) : sent ? (
        <p className="text-sm text-foreground text-center">
          Check your email for the six-digit reset code.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email address</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
              <Input
                id="email"
                type="email"
                autoComplete="email"
                autoFocus
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="pl-10 h-12"
                required
              />
            </div>
          </div>
          <Button type="submit" className="w-full h-12 font-medium" disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Sending...
              </>
            ) : (
              "Send reset code"
            )}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
