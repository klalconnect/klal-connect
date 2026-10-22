import { useEffect, useMemo, useRef } from 'react';
import { useUserLocation } from '@/lib/userLocation';
import { placePoint } from '@/lib/nearby';

/**
 * The point "Near you" sections measure from, and what to call it.
 *
 * A place picked on the page (a Home community chip) wins; then the member's
 * own saved location or profile city; then a guest's shared or picked
 * location. A guest who already allowed location for this site is located
 * without being asked again; one who has not gets `ask`, which shows the
 * browser's permission prompt, so nothing is asked on page load.
 *
 * Returns { origin: {lat, lng} | null, where: a place name or '', ask, source }.
 */
export default function useNearHere(providers = [], place = '') {
  const loc = useUserLocation();
  const { ask, source } = loc;

  const tried = useRef(false);
  useEffect(() => {
    if (tried.current || source || place || !navigator.permissions?.query) return;
    tried.current = true;
    navigator.permissions.query({ name: 'geolocation' })
      .then((p) => { if (p.state === 'granted') ask(); })
      .catch(() => { /* older browsers: wait for the button */ });
  }, [source, place, ask]);

  return useMemo(() => {
    const own = loc.lat != null && loc.lng != null ? { lat: loc.lat, lng: loc.lng } : null;
    if (place) {
      // Their own city by name is better answered by their saved coordinates.
      const same = own && loc.city && loc.city.toLowerCase() === place.toLowerCase();
      const at = same ? own : placePoint({ city: place });
      if (at) return { origin: at, where: place, ask, source: 'place' };
    }
    if (own) return { origin: own, where: loc.city, ask, source };
    // A member whose city could not be pinned from listings with map pins.
    const byName = loc.city ? placePoint({ city: loc.city }) : null;
    return { origin: byName, where: byName ? loc.city : '', ask, source: byName ? 'profile' : null };
  }, [loc.lat, loc.lng, loc.city, source, place, ask]);
}
