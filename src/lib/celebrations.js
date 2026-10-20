// The animations a "New job" post can play. Shared with the server
// (functions.js), so an unknown one is stored as the default instead.
export const CELEBRATIONS = [
  { id: 'confetti',  label: 'Confetti',  emoji: '🎊' },
  { id: 'balloons',  label: 'Balloons',  emoji: '🎈' },
  { id: 'fireworks', label: 'Fireworks', emoji: '🎆' },
  { id: 'sparkles',  label: 'Sparkles',  emoji: '✨' },
];
export const CELEBRATION_BY_ID = Object.fromEntries(CELEBRATIONS.map((c) => [c.id, c]));
export const DEFAULT_CELEBRATION = 'confetti';
export const celebrationOf = (value) => (Object.hasOwn(CELEBRATION_BY_ID, value || '') ? value : DEFAULT_CELEBRATION);

// A new-job post always celebrates. Someone who would rather not announce a
// new job adds it to their profile instead, and nothing goes in the feed.
export const isNewJob = (post) => post?.post_type === 'new_job';

// Only a job that started in or after this month can be announced. Everyone
// filling in their experience as the site opens would otherwise flood the
// feed with old news; earlier jobs go on the profile only. Set to the month
// the site opens to the public.
export const ANNOUNCE_FROM = '2026-10';
export const canAnnounce = (start) => !!start && start >= ANNOUNCE_FROM;
export const announceFromLabel = () => new Date(`${ANNOUNCE_FROM}-01T12:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

// "2026-10" for the month a <input type="month"> starts on: this one.
export const thisMonth = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

// The longest a job title or company name can be.
export const JOB_FIELD_MAX = 100;
