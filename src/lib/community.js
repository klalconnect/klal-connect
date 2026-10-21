import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

// The community someone is looking at on Home, or on Resources.
//
// The choice lives in the URL first, so a link carries it to whoever it is
// sent to, and in sessionStorage as well so coming back to the page (or
// pressing back from the results) finds it where it was left.
//
// Home and Resources each keep their own. Searching Boca on one used to fill
// Boca into the other as well, where it stayed stuck until cleared by hand.
// The results page (/browse) is shared, so it files whatever is searched
// there under whichever of the two was opened last — the one it came from.
//
// sessionStorage, not localStorage: reopening the app should be a fresh start
// with empty search boxes, not last week's "Boca Raton" still filled in.

const SCOPES = ['home', 'resources'];
const ORIGIN = 'kc_search_from';
const keyFor = (scope) => `kc_community_${SCOPES.includes(scope) ? scope : 'home'}`;

// Home and Resources call this as they open, so /browse knows which of the
// two a search belongs to.
export function markSearchOrigin(scope) {
  try { sessionStorage.setItem(ORIGIN, scope); } catch { /* no-op */ }
}

export function searchOrigin() {
  try { return sessionStorage.getItem(ORIGIN) || 'home'; } catch { return 'home'; }
}

export function readStoredCommunity(scope = searchOrigin()) {
  try { return sessionStorage.getItem(keyFor(scope)) || ''; } catch { return ''; }
}

export function storeCommunity(name, scope = searchOrigin()) {
  // Wrapped: a private window throws on write, and remembering the community
  // is a convenience — the URL is the copy that matters.
  try {
    if (name) sessionStorage.setItem(keyFor(scope), name);
    else sessionStorage.removeItem(keyFor(scope));
    // Older versions kept one shared copy, first for good and then per visit;
    // let go of both.
    localStorage.removeItem('kc_community');
    sessionStorage.removeItem('kc_community');
  } catch { /* no-op */ }
}

/**
 * The selected community for `scope` ('home' or 'resources'), a setter that persists it, and whether it was
 * actually chosen (false while it is only the fallback).
 *
 * Precedence is URL, then what was remembered, then `fallback` — which
 * arrives late (it comes from the signed-in member's own city), so it is
 * adopted only while nothing has been chosen, and never written to the URL
 * or remembered: a guess about where someone lives should not end up in a
 * shared link, or typed into a search box they did not fill in.
 */
export function useCommunity(fallback = '', scope = 'home') {
  const [params, setParams] = useSearchParams();
  const fromUrl = params.get('community') || '';
  // Set while rendering, not in an effect: the page's own search box can be
  // submitted before effects run, and its results must land under this page.
  markSearchOrigin(scope);
  const [community, setLocal] = useState(() => fromUrl || readStoredCommunity(scope));
  const [chosen, setChosen] = useState(() => Boolean(community));

  // Both effects deliberately watch one value and read the other. Depending on
  // `community` as well would re-run them on every change it makes, and the
  // second would then fight anyone who cleared the community back to
  // "everywhere" by immediately reinstating the fallback.
  //
  // A shared link decides, and what it decides is then remembered.
  useEffect(() => { if (fromUrl && fromUrl !== community) { setLocal(fromUrl); setChosen(true); } }, [fromUrl]);
  useEffect(() => { if (!community && fallback) setLocal(fallback); }, [fallback]);
  useEffect(() => { if (chosen || !community) storeCommunity(community, scope); }, [community, chosen, scope]);

  const setCommunity = useCallback((name) => {
    setLocal(name || '');
    setChosen(Boolean(name));
    // replace, not push: choosing a community is a filter, not a place in
    // history — the back button should leave the page, not undo a chip.
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (name) next.set('community', name); else next.delete('community');
      return next;
    }, { replace: true });
  }, [setParams]);

  return [community, setCommunity, chosen];
}
