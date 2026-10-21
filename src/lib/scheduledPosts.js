// Scheduled feed posts. A post can carry `publish_at`, the moment it goes
// live. Until then only its author sees it; after that it reads as if it was
// posted at that moment. Nothing has to run on a timer for this: whether a
// post is live is worked out from the clock every time the feed is read.
// Shared by the server (who may read it) and the feed (how it is shown).

// The furthest ahead a post can be scheduled.
export const MAX_SCHEDULE_DAYS = 365;

export function isScheduled(post, now = Date.now()) {
  if (!post?.publish_at) return false;
  const t = Date.parse(post.publish_at);
  return Number.isFinite(t) && t > now;
}

// When the post went (or goes) live: its scheduled time, else when it was made.
export const postedAt = (post) => post?.publish_at || post?.created_date;

// For the feed's newest-first order, by when posts went live rather than when
// they were written.
export const byPostedAtDesc = (a, b) => String(postedAt(b) || '').localeCompare(String(postedAt(a) || ''));

// The feed's own order: newest first, but a business post or an
// accomplishment gets a head start, as if it had gone live this many hours
// later than it did. So a new job from this morning sits above a passing
// update from an hour ago, and nothing stays pinned at the top for days.
export const FEED_HEAD_START_HOURS = { new_job: 12, promotion: 12, insight: 6, question: 6 };

// A good post earns more: each like, comment and repost adds hours too, up to
// a cap, so a popular post rises but cannot sit on top of the feed for a week.
export const FEED_EARNED_HOURS = { like: 1, comment: 2, repost: 2, max: 12 };

const count = (n) => Math.max(0, Number(n) || 0);
export const earnedHours = (post) => Math.min(
  FEED_EARNED_HOURS.max,
  count(post?.like_count) * FEED_EARNED_HOURS.like
    + count(post?.comment_count) * FEED_EARNED_HOURS.comment
    + count(post?.repost_count) * FEED_EARNED_HOURS.repost,
);

const feedScore = (post) => {
  const t = Date.parse(postedAt(post) || '');
  const hours = (FEED_HEAD_START_HOURS[post?.post_type] || 0) + earnedHours(post);
  return (Number.isFinite(t) ? t : 0) + hours * 3_600_000;
};
export const byFeedRank = (a, b) => feedScore(b) - feedScore(a) || byPostedAtDesc(a, b);

// "Fri, Oct 17 at 9:00 AM" in the reader's own time zone.
export function scheduleLabel(value) {
  const t = new Date(value);
  if (Number.isNaN(t.getTime())) return '';
  const sameYear = t.getFullYear() === new Date().getFullYear();
  const day = t.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
  const time = t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${day} at ${time}`;
}

// The value a <input type="datetime-local"> takes, in the browser's own zone.
export function toLocalInput(value) {
  const t = new Date(value);
  if (Number.isNaN(t.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T${pad(t.getHours())}:${pad(t.getMinutes())}`;
}
