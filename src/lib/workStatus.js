// The LinkedIn-style ribbons a member can put on their own profile photo.
// Fixed, official designs rather than a custom ribbon-builder: consistency is
// the point, the same way LinkedIn's own frames are not user-customizable.
// `color` is the frame around the photo; `text` colours the see-through tag
// on the photo; `badge` is the small pill next to the name on cards.
export const WORK_STATUSES = {
  open_to_work: { id: 'open_to_work', label: 'Open to work', color: '#2E8B57', text: 'text-emerald-700 dark:text-emerald-300', badge: 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200 dark:bg-emerald-400/10 dark:text-emerald-300 dark:ring-emerald-400/30' },
  hiring: { id: 'hiring', label: 'Hiring', color: '#5257C4', text: 'text-indigo-700 dark:text-indigo-300', badge: 'bg-indigo-50 text-indigo-800 ring-1 ring-indigo-200 dark:bg-indigo-400/10 dark:text-indigo-300 dark:ring-indigo-400/30' },
};

export const WORK_STATUS_IDS = Object.keys(WORK_STATUSES);

export const workStatusOf = (user) => WORK_STATUSES[user?.work_status] || null;
