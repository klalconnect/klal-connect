import { useEffect, useLayoutEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

const getHashId = (hash) => {
  const rawId = hash.slice(1);

  try {
    return decodeURIComponent(rawId);
  } catch {
    return rawId;
  }
};

// Where each page in this tab's history was scrolled to, by history entry.
// sessionStorage, not just memory, so a reload or a trip out to another site
// and back still lands where the person was.
const STORE_KEY = "kc_scroll";
const MAX_ENTRIES = 100;
const readStore = () => {
  try { return JSON.parse(sessionStorage.getItem(STORE_KEY) || "{}") || {}; } catch { return {}; }
};
const writeStore = (positions) => {
  try { sessionStorage.setItem(STORE_KEY, JSON.stringify(positions)); } catch { /* private mode: memory only */ }
};

// How long to keep trying after a back. Most pages fetch their content after
// they mount, so straight after the back there is nothing to scroll into: the
// browser's own restore ran against an empty page and left you at the top.
// This waits for the page to grow tall enough, then puts you back.
const RESTORE_FOR_MS = 4000;

export default function ScrollToTop() {
  const { pathname, search, hash, key } = useLocation();
  const navigationType = useNavigationType();
  const positions = useRef(null);
  const currentKey = useRef(key);
  const lastPlace = useRef(null);

  if (positions.current === null) positions.current = readStore();

  useEffect(() => {
    if ("scrollRestoration" in window.history) window.history.scrollRestoration = "manual";

    let frame = 0;
    const save = () => {
      frame = 0;
      const all = positions.current;
      delete all[currentKey.current];
      all[currentKey.current] = Math.round(window.scrollY);
      const keys = Object.keys(all);
      if (keys.length > MAX_ENTRIES) delete all[keys[0]];
      writeStore(all);
    };
    const onScroll = () => { if (!frame) frame = window.requestAnimationFrame(save); };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  // A layout effect, so the key moves on before the browser clamps the old
  // scroll position to the new, shorter page and fires a scroll event — that
  // event belongs to the new page, not to the one being left.
  useLayoutEffect(() => { currentKey.current = key; }, [key]);

  useEffect(() => {
    const place = pathname + hash;
    const samePlace = lastPlace.current === place;
    lastPlace.current = place;

    if (navigationType === "POP") {
      const target = positions.current[key];
      if (!target) return;

      let stopped = false, frame = 0;
      const started = Date.now();
      const stop = () => {
        stopped = true;
        if (frame) window.cancelAnimationFrame(frame);
        ["wheel", "touchstart", "keydown", "mousedown"].forEach((e) => window.removeEventListener(e, stop));
      };
      // The person scrolling or tapping while we wait wins: never yank the
      // page out from under someone who has already moved on.
      ["wheel", "touchstart", "keydown", "mousedown"].forEach((e) => window.addEventListener(e, stop, { passive: true }));
      const attempt = () => {
        if (stopped) return;
        const reachable = document.documentElement.scrollHeight - window.innerHeight;
        window.scrollTo({ top: Math.min(target, reachable), left: 0, behavior: "instant" });
        if (reachable >= target || Date.now() - started > RESTORE_FOR_MS) return stop();
        frame = window.requestAnimationFrame(attempt);
      };
      attempt();
      return stop;
    }

    // Only the query string changed (a filter, a search box writing to the
    // URL): the person is still on the same page, so leave them where they are.
    if (samePlace) return;

    if (hash) {
      const id = getHashId(hash);
      const timer = window.setTimeout(() => {
        document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
      }, 50);
      return () => window.clearTimeout(timer);
    }

    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [pathname, search, hash, key, navigationType]);

  return null;
}
