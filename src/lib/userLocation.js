import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { listingPoint, placePoint } from './nearby.js';

// Where the person using the site is, for "closest first" and "near you".
//
// Order of trust:
//   1. a member's own location, saved to their profile from the home city
//      they gave us (see @/hooks/useDetectLocation)
//   2. a place a guest picked, or their browser's location once they agreed
//      to share it — kept in this browser only, never sent anywhere
//   3. nothing: callers fall back to their usual order and may offer `ask`
//
// A member's profile city without coordinates yet (the lookup runs in the
// background) is placed at the centre of that city (see @/lib/nearby), which
// is near enough to tell Brooklyn from Minnesota.

const KEY = 'kc_my_location';

const rad = (x) => x * Math.PI / 180;
/** Miles between two points, as the crow flies. */
export function milesBetween(lat1, lng1, lat2, lng2) {
  const x = rad(lat2 - lat1), y = rad(lng2 - lng1);
  const q = Math.sin(x / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(y / 2) ** 2;
  return 3959 * 2 * Math.atan2(Math.sqrt(q), Math.sqrt(1 - q));
}

const hasPoint = (p) => p && p.latitude != null && p.longitude != null && p.latitude !== '' && p.longitude !== ''
  && Number.isFinite(Number(p.latitude)) && Number.isFinite(Number(p.longitude));

/**
 * How far a listing is from a location, in miles, or null when either cannot
 * be placed. A listing without its own pin is measured from its city's centre.
 */
export function milesTo(here, provider) {
  const at = here && listingPoint(provider);
  return at ? milesBetween(here.lat, here.lng, at.lat, at.lng) : null;
}

function readSaved() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    return saved && Number.isFinite(saved.lat) && Number.isFinite(saved.lng) ? saved : null;
  } catch { return null; }
}

function save(value) {
  try {
    if (value) localStorage.setItem(KEY, JSON.stringify(value));
    else localStorage.removeItem(KEY);
  } catch { /* private window: it lasts until the page closes */ }
  window.dispatchEvent(new Event('kc-location'));
}

/**
 * The person's location: { lat, lng, city, source } with source 'profile',
 * 'browser' or 'chosen', or null fields while none is known.
 *
 * `ask()` asks the browser (resolving true or false), `choose(place)` keeps a
 * picked place ({ latitude, longitude, city }), and `forget()` drops either.
 */
export function useUserLocation() {
  const { data: me = null } = useQuery({
    queryKey: ['me', 'home'],
    queryFn: async () => (await api.auth.hasAccount() ? api.auth.me() : null),
    retry: false,
  });
  const [saved, setSaved] = useState(readSaved);
  useEffect(() => {
    const sync = () => setSaved(readSaved());
    window.addEventListener('kc-location', sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener('kc-location', sync); window.removeEventListener('storage', sync); };
  }, []);

  const ask = useCallback(() => new Promise((resolve) => {
    if (!navigator.geolocation) { resolve(false); return; }
    navigator.geolocation.getCurrentPosition(async ({ coords }) => {
      const here = { lat: coords.latitude, lng: coords.longitude, city: '', source: 'browser' };
      save(here);
      resolve(true);
      try {
        const { city } = await api.geo.reverse(coords.latitude, coords.longitude);
        if (city) save({ ...here, city });
      } catch { /* the point is what matters; the name is for display */ }
    }, () => resolve(false), { timeout: 10000, maximumAge: 600000 });
  }), []);
  const choose = useCallback((place) => {
    if (!hasPoint(place)) return;
    save({ lat: Number(place.latitude), lng: Number(place.longitude), city: place.city || place.label || '', source: 'chosen' });
  }, []);
  const forget = useCallback(() => save(null), []);

  const profileCity = String(me?.home_city || me?.city || '').trim();
  let here = null;
  if (hasPoint(me)) here = { lat: Number(me.latitude), lng: Number(me.longitude), city: profileCity, source: 'profile' };
  else if (saved) here = saved;
  else if (profileCity) {
    const point = placePoint({ city: profileCity, country: me?.country_code });
    if (point) here = { ...point, city: profileCity, source: 'profile' };
  }
  return { lat: here?.lat ?? null, lng: here?.lng ?? null, city: here?.city || '', source: here?.source || null, ask, choose, forget };
}
