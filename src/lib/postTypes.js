// The kinds of thing a member can post. `question` is the stored value for an
// ask (it predates the name), so it stays; everything user-facing says "Ask".
// Every post carries its kind on the card, so a reader can tell an ask from
// a promotion before reading it — the same label the composer and the feed
// filters use.
export const POST_TYPES = [
  { id: 'post',      label: 'Update',            badge: 'Update',    tone: 'neutral', placeholder: 'Share a business update, a job, or something the klal should know…' },
  { id: 'question',  label: 'Ask the community', badge: 'Ask',       tone: 'navy',    placeholder: 'What do you want to ask the klal? A good mohel in Lakewood, a reliable electrician, a tutor for…' },
  { id: 'insight',   label: 'Tip or insight',    badge: 'Insight',   tone: 'gold',    placeholder: 'A tip from your field — tax notes before Yom Tov, what to check before winter, how to choose a…' },
  { id: 'promotion', label: 'Promotion',         badge: 'Promotion', tone: 'gold',    placeholder: 'A special, an opening, availability — put your business in front of the community.' },
  { id: 'new_job',   label: 'New job',           badge: 'New job',   tone: 'teal',    placeholder: 'Share your news: where you started, what you will be doing, and anyone you want to thank…' },
];
export const POST_TYPE_BY_ID = Object.fromEntries(POST_TYPES.map((t) => [t.id, t]));

// Older rows (and the demo seed) stored `update` for what is now `post`.
export const normalizePostType = (value) => (value === 'update' || !POST_TYPE_BY_ID[value] ? 'post' : value);

// The kind a post shows as. A new-job post whose author kept the celebration
// quiet goes out as a plain update: no "New job" badge to give it away.
export const shownPostType = (post) => {
  const type = normalizePostType(post?.post_type);
  return type === 'new_job' && post.celebration_public === false ? 'post' : type;
};

export const BADGE_TONES = {
  neutral: 'bg-brand-tint text-brand-body',
  navy: 'bg-brand-navy text-white',
  gold: 'bg-brand-gold-bg text-brand-gold-ink',
  teal: 'bg-brand-teal/15 text-brand-teal',
};

export const FEED_FILTERS = [
  { id: 'all', label: 'Everything' },
  { id: 'question', label: 'Asks' },
  { id: 'unanswered', label: 'Unanswered asks' },
  { id: 'post', label: 'Updates' },
  { id: 'insight', label: 'Insights' },
  { id: 'promotion', label: 'Promotions' },
  { id: 'new_job', label: 'New jobs' },
];

// Which posts a feed filter keeps.
export function matchesFilter(post, filter) {
  const type = shownPostType(post);
  if (filter === 'all') return true;
  if (filter === 'unanswered') return type === 'question' && !post.helpful_comment_id;
  return type === filter;
}

// Why a post can be reported. The ids are what the server stores on the
// PrivateReport row; the labels are what the member picks from and what the
// admin reads in the queue.
export const POST_REPORT_REASONS = [
  { id: 'spam', label: 'Spam' },
  { id: 'scam', label: 'Scam or misleading' },
  { id: 'harassment', label: 'Harassment' },
  { id: 'off_topic', label: 'Off-topic or inappropriate' },
  { id: 'other', label: 'Other' },
];
export const POST_REPORT_REASON_BY_ID = Object.fromEntries(POST_REPORT_REASONS.map((r) => [r.id, r]));

// The first `max` characters of a post on one line, for a share message, a
// saved-posts row, or the quote on a report. Cut at a word where there is
// one, with an ellipsis when something was left out.
export function postExcerpt(body, max = 120) {
  const text = String(body || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${space > max * 0.6 ? cut.slice(0, space) : cut}…`;
}
