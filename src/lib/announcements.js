// Pinned announcements from "The Klal Team": an admin writes one in Admin →
// Announcements and picks which tabs it sits on top of. Stored as
// Announcement rows ({ title, body, link_url, link_label, tabs, pinned,
// ends_at }). The server serves only live ones to everyone but an admin
// (server/app.js visibleRows), and the banner checks again so one that ends
// while a page is open goes away on the next visit to a tab.

// The tabs an announcement can be pinned to, in the order the bar shows them.
// 'all' is every one of them.
export const ANNOUNCEMENT_TABS = ['Home', 'Feed', 'Resources', 'People', 'Saved', 'Profile', 'Messages'];

// Where on a tab the card shows: the tab's own front page, not every page
// under it. A listing or someone's profile is not the place for site news.
const TAB_PAGES = {
  Home: ['/', '/welcome'],
  Feed: ['/feed'],
  Resources: ['/directory', '/browse'],
  People: ['/people'],
  Saved: ['/saved'],
  Profile: ['/profile'],
  Messages: ['/messages'],
};

export function tabPage(pathname) {
  const p = pathname.replace(/\/+$/, '') || '/';
  return Object.keys(TAB_PAGES).find((tab) => TAB_PAGES[tab].includes(p)) || null;
}

export function isLiveAnnouncement(row, now = Date.now()) {
  if (!row || row.pinned === false) return false;
  if (!row.title && !row.body) return false;
  if (row.ends_at) {
    const end = Date.parse(row.ends_at);
    if (Number.isFinite(end) && end <= now) return false;
  }
  return true;
}

export function showsOnTab(row, tab) {
  if (!tab) return false;
  const tabs = Array.isArray(row?.tabs) ? row.tabs : [];
  return tabs.includes('all') || tabs.includes(tab);
}
