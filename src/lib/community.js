import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

// The community someone is looking at, remembered across the site.
//
// Choosing a community on the homepage and then finding the directory had
// forgotten it is the difference between a product and a pile of pages. The
// choice lives in the URL first, so a link carries it to whoever it is sent
// to, and in sessionStorage as well so it carries from page to page.
//
// sessionStorage, not localStorage: reopening the app should be a fresh start
// with empty search boxes, not last week's "Boca Raton" still filled in.

const KEY = 'kc_community';

export function readStoredCommunity() {
  try { return sessionStorage.getItem(KEY) || ''; } catch { return ''; }
}

export function storeCommunity(name) {
  // Wrapped: a private window throws on write, and remembering the community
  // is a convenience — the URL is the copy that matters.
  try {
    if (name) sessionStorage.setItem(KEY, name);
    else sessionStorage.removeItem(KEY);
    // Older versions kept it here for good; let go of it.
    localStorage.removeItem(KEY);
  } catch { /* no-op */ }
}

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
