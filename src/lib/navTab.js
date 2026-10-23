// Which bar tab a page belongs to. NavLink alone only lights a tab whose own
// address the page starts with, so a listing (/provider/…), the search results
// (/browse) or someone else's profile left every tab dark and the person had
// no way to tell where in the site they were.
export function tabFor(pathname, userId) {
  const p = pathname.replace(/\/+$/, '') || '/';
  const under = (...roots) => roots.some((r) => p === r || p.startsWith(`${r}/`));
  if (p === '/' || p === '/welcome') return 'Home';
  if (under('/feed', '/jobs', '/post-job')) return 'Feed';
  if (under('/directory', '/browse', '/provider', '/gemach', '/add')) return 'Resources';
  if (under('/profile')) {
    const id = p.split('/')[2];
    return !id || (userId && String(id) === String(userId)) ? 'Profile' : 'People';
  }
  if (under('/people', '/companies', '/company', '/create-company')) return 'People';
  if (under('/saved')) return 'Saved';
  if (under('/messages')) return 'Messages';
  return null;
}
