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

// A new-job post celebrates in public unless its author chose to keep it
// quiet. Kept quiet, it reads to everyone else as an ordinary update.
export const isNewJob = (post) => post?.post_type === 'new_job';
export const celebrates = (post) => isNewJob(post) && post.celebration_public !== false;

// The longest a job title or company name can be.
export const JOB_FIELD_MAX = 100;
