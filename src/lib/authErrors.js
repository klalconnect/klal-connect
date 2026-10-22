// What a sign-up, sign-in or reset form shows when a request fails. The
// server's own messages are written for people and pass through; anything
// else (no connection, a 5xx, a page that is not ours) becomes a plain
// sentence, and the details go to the browser console instead.
export const SOMETHING_WENT_WRONG = 'Something went wrong on our side. Please try again in a few minutes.';
export const NO_CONNECTION = 'We could not reach Klal Connect. Please check your connection and try again.';

export function friendlyAuthError(err, fallback = SOMETHING_WENT_WRONG) {
  const status = err?.status;
  const ours = typeof err?.data?.error === 'string' && err.data.error;
  // 503 is the server saying, in words, that email is down for now.
  if (ours && status && (status < 500 || status === 503)) return ours;
  console.warn('[auth]', err);
  if (!status) return err?.name === 'TypeError' ? NO_CONNECTION : fallback;
  return fallback;
}
