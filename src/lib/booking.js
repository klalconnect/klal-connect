// The "Book an appointment" button on a profile: the member's own scheduling
// link (Calendly, Acuity, a Google Calendar booking page…) behind a button
// whose wording they pick from a short list. Free text was not offered: a
// button that says anything at all is an ad slot, not a booking button.
export const BOOKING_LABELS = ['Book an appointment', 'Schedule a call', 'Book a consultation', 'Book a meeting'];
export const DEFAULT_BOOKING_LABEL = BOOKING_LABELS[0];

export const bookingLabel = (user) => (BOOKING_LABELS.includes(user?.booking_label) ? user.booking_label : DEFAULT_BOOKING_LABEL);

// People paste "calendly.com/name" without the https://. That is still a
// link, so it gets one. Anything that already names a scheme is left alone
// for the server to accept (http/https) or refuse (javascript:, mailto:…).
export function withScheme(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  return /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
}
