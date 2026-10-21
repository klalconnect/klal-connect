// Outbound email through Resend's HTTP API. No SDK: one POST.
//
//   RESEND_API_KEY   from resend.com → API Keys
//   KC_MAIL_FROM     e.g. "Klal <hello@klalconnect.org>" — the domain must be
//                    verified in Resend (DKIM/SPF records at the registrar)
//   KC_EMAIL_DELIVERY=real   turns it on; without it codes stay dev-only
//
// Everything that emails a person goes through sendMail so the provider can
// change in one place.
const API = 'https://api.resend.com/emails';

export const mailConfigured = () => Boolean(process.env.RESEND_API_KEY && process.env.KC_MAIL_FROM);

export async function sendMail({ to, subject, text, html }) {
  if (!mailConfigured()) throw new Error('Email is not configured (RESEND_API_KEY / KC_MAIL_FROM).');
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.KC_MAIL_FROM, to: [to], subject, text, html: html || `<pre style="font: 15px/1.5 -apple-system, system-ui, sans-serif; white-space: pre-wrap">${escapeHtml(text)}</pre>` }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Email send failed (${res.status}): ${body.slice(0, 200)}`);
  }
  return res.json();
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The two codes the auth flow sends. Plain text on purpose: it renders
// everywhere, and a six-digit code needs no design.
export function codeEmail(purpose, code) {
  if (purpose === 'reset') {
    return {
      subject: `${code} is your Klal Connect password reset code`,
      text: `Use this code to reset your Klal Connect password:\n\n    ${code}\n\nIt expires in 10 minutes. If you did not ask to reset your password, you can ignore this email — nothing changes unless the code is used.\n\n— Klal Connect · klalconnect.org`,
    };
  }
  return {
    subject: `${code} is your Klal Connect verification code`,
    text: `Welcome to Klal Connect. Your verification code is:\n\n    ${code}\n\nIt expires in 10 minutes.\n\n— Klal Connect · klalconnect.org`,
  };
}
