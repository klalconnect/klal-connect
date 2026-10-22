import { useEffect, useState, useCallback, useRef } from "react";
import { api } from "@/api/client";
import { readSaved } from "@/lib/savedLocation";

// The place a guest picked or shared, which the server uses only when there is
// no member profile to work from (see getShabbosStatus).
function guestPlace() {
  const saved = readSaved();
  return saved ? { latitude: saved.lat, longitude: saved.lng, city: saved.city || "", country_code: saved.country || "" } : undefined;
}

// Shabbos / Yom Tov status, cached so the UI can fail CLOSED.
//
// The previous version set status to null on any network failure, and
// ShabbosMode renders nothing when status is null — so a failed request, or
// simply the moment before the first request resolved, displayed the app
// fully unlocked. During Shabbos that is the one outcome this feature exists
// to prevent, and a service worker would make it reachable offline too.
//
// So: the last good answer is persisted, and the boundaries in it (absolute
// epoch ms) are what the UI decides from. That fallback trusts the device
// clock, which is acceptable — a tampered clock can only mislead the person
// doing the tampering, and the real gate is assertWritable on the server,
// which refuses writes regardless of what the client believes.
const CACHE_KEY = "kc_shabbos_last";
const POLL_MS = 30 * 60 * 1000;

// Location and zmanim settings change which times apply, so a cached answer is
// only reusable for the profile it was computed for.
const profileKeyOf = (status) =>
  status ? `${status.cityLabel || ""}|${status.tzid || ""}|${!!status.isInIsrael}` : "";

// The profileKey written alongside the status has to be checked on the way
// back out. Without this, moving city and reloading while the request is slow
// or offline seeded the gate from the previous city's boundaries — the app
// locking outside Shabbos, or worse, staying unlocked during it, labelled
// with the old city. A cached answer for a different profile is no answer.
function readCache(expectedKey) {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    const status = cached?.status ?? null;
    if (!status) return null;
    // Older entries predate the key; trust them only until the first refresh.
    if (expectedKey && cached.profileKey && cached.profileKey !== expectedKey) return null;
    return status;
  } catch {
    return null;
  }
}

function writeCache(status) {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ status, profileKey: profileKeyOf(status), savedAt: Date.now() })
    );
  } catch {
    /* private mode, quota — the in-memory value still works for this session */
  }
}

export function useShabbosStatus() {
  // Seed from cache so a reload during Shabbos locks immediately instead of
  // flashing the unlocked app while the first request is in flight.
  const [status, setStatus] = useState(readCache);
  const [verified, setVerified] = useState(false);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const r = await api.functions.invoke("getShabbosStatus", { place: guestPlace() });
      if (!alive.current) return;
      if (r.status >= 400 || !r.data) throw new Error("unavailable");
      setStatus(r.data);
      setVerified(true);
      writeCache(r.data);
    } catch {
      // Keep the last known answer rather than falling back to "unknown",
      // which the UI would previously have rendered as "unlocked".
      if (alive.current) setVerified(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    refresh();
    // Polling is a safety net, not the mechanism. The response carries absolute
    // boundaries, shabbosState decides from the clock, and there is a timer
    // aligned to the next boundary plus wake listeners below — so a 60s poll
    // bought nothing and cost an API call per user per minute (1.4M/day at a
    // thousand users). This interval only exists to pick up a changed location
    // or an admin override.
    const id = setInterval(refresh, POLL_MS);

    // Timers are throttled or frozen in a backgrounded tab — iOS freezes a
    // standalone PWA's JS within seconds — so returning to the app must
    // re-check rather than trust whatever the last interval left behind.
    const onWake = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("pageshow", onWake);
    window.addEventListener("focus", onWake);
    window.addEventListener("online", refresh);
    // A guest picking their community changes which times apply.
    window.addEventListener("kc-location", refresh);

    // Refresh right after the next boundary. Without this, havdalah passes and
    // the known window ends, which reads as "unknown" — a blocking screen — for
    // up to a full poll interval before the next window is fetched.
    let boundaryTimer;
    const next = status?.endsAt ?? status?.nextChange;
    if (next && next > Date.now()) {
      // setTimeout caps out around 24.8 days; anything beyond that is handled
      // by the ordinary interval anyway.
      const delay = Math.min(next - Date.now() + 2_000, 2_147_483_000);
      boundaryTimer = setTimeout(refresh, delay);
    }

    return () => {
      alive.current = false;
      clearInterval(id);
      clearTimeout(boundaryTimer);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("pageshow", onWake);
      window.removeEventListener("focus", onWake);
      window.removeEventListener("online", refresh);
      window.removeEventListener("kc-location", refresh);
    };
  }, [refresh, status?.endsAt, status?.nextChange]);

  return { status, verified, refresh };
}

export { shabbosState } from '@/lib/shabbosState';
