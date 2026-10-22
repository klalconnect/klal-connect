import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

// The community someone picked from the chips on Home.
//
// The choice lives in the URL first, so a link carries it to whoever it is
// sent to, and in sessionStorage as well so coming back to Home finds it where
// it was left.
//
// Only a chip picked on Home itself is remembered. A place typed into a search
// is part of that search: it used to be remembered too, so going back from
// "Food in Hollywood" left Hollywood stuck in the Where box on Home and
// Resources until cleared by hand.
//
// sessionStorage, not localStorage: reopening the app should be a fresh start
// with empty search boxes, not last week's "Boca Raton" still filled in.

const KEY = 'kc_home_community';
// Earlier versions' copies, some of them holding places typed into searches.
const OLD_KEYS = ['kc_community', 'kc_community_home', 'kc_community_resources', 'kc_search_from'];

export function readStoredCommunity() {
  try { return sessionStorage.getItem(KEY) || ''; } catch { return ''; }
}

export function storeCommunity(name) {
  // Wrapped: a private window throws on write, and remembering the community
  // is a convenience — the URL is the copy that matters.
  try {
    if (name) sessionStorage.setItem(KEY, name);
    else sessionStorage.removeItem(KEY);
  } catch { /* no-op */ }
}

// Let go of the older copies as the app loads, before anything reads them.
try {
  OLD_KEYS.forEach((k) => sessionStorage.removeItem(k));
  localStorage.removeItem('kc_community');
} catch { /* no-op */ }

/**
 * The selected community, a setter that persists it, and whether it was
 * actually chosen (false while it is only the fallback).
 *
 * Precedence is URL, then what was remembered, then `fallback` — which
 * arrives late (it comes from the signed-in member's own city), so it is
 * adopted only while nothing has been chosen, and never written to the URL
 * or remembered: a guess about where someone lives should not end up in a
 * shared link, or typed into a search box they did not fill in.
 */
export function useCommunity(fallback = '') {
  const [params, setParams] = useSearchParams();
  const fromUrl = params.get('community') || '';
  const [community, setLocal] = useState(() => fromUrl || readStoredCommunity());
  const [chosen, setChosen] = useState(() => Boolean(community));

  // Both effects deliberately watch one value and read the other. Depending on
  // `community` as well would re-run them on every change it makes, and the
  // second would then fight anyone who cleared the community back to
  // "everywhere" by immediately reinstating the fallback.
  //
  // A shared link decides, and what it decides is then remembered.
  useEffect(() => { if (fromUrl && fromUrl !== community) { setLocal(fromUrl); setChosen(true); } }, [fromUrl]);
  useEffect(() => { if (!community && fallback) setLocal(fallback); }, [fallback]);
  useEffect(() => { if (chosen || !community) storeCommunity(community); }, [community, chosen]);

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
