// The LinkedIn-style ribbons a member can put on their own profile photo.
// Fixed, official designs rather than a custom ribbon-builder: consistency is
// the point, the same way LinkedIn's own frames are not user-customizable.
// `color` is the ribbon itself (solid, with white letters, in both themes);
// `badge` is the small pill next to the name.
export const WORK_STATUSES = {
  open_to_work: { id: 'open_to_work', label: 'Open to work', color: '#2E7D4F', badge: 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200 dark:bg-emerald-400/10 dark:text-emerald-300 dark:ring-emerald-400/30' },
  hiring: { id: 'hiring', label: 'Hiring', color: '#4B4FA8', badge: 'bg-indigo-50 text-indigo-800 ring-1 ring-indigo-200 dark:bg-indigo-400/10 dark:text-indigo-300 dark:ring-indigo-400/30' },
  new_clients: { id: 'new_clients', label: 'Taking new clients', color: '#A3620A', badge: 'bg-amber-50 text-amber-800 ring-1 ring-amber-200 dark:bg-amber-400/10 dark:text-amber-300 dark:ring-amber-400/30' },
  mentoring: { id: 'mentoring', label: 'Happy to mentor', color: '#8A3D7E', badge: 'bg-fuchsia-50 text-fuchsia-800 ring-1 ring-fuchsia-200 dark:bg-fuchsia-400/10 dark:text-fuchsia-300 dark:ring-fuchsia-400/30' },
};

export const WORK_STATUS_IDS = Object.keys(WORK_STATUSES);

export const workStatusOf = (user) => WORK_STATUSES[user?.work_status] || null;
