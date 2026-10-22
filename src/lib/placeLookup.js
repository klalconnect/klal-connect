import { api } from '@/api/client';

// Places from the server's lookup (the curated communities, then every town in
// the world), as suggestions for a location box. A failure is quietly no extra
// suggestions: the places that have listings are still shown.
export async function lookupPlaces(text) {
  const rows = await api.geo.search(text, 6);
  return (Array.isArray(rows) ? rows : [])
    .filter((p) => p.city)
    // The hint is the rest of the place's name: "FL" for a US town, the country
    // spelled out elsewhere ("Israel", not "IL", which reads as Illinois).
    .map((p) => ({ group: 'Other places', kind: 'place', label: p.city, value: p.city,
      hint: String(p.label || '').split(', ').slice(1).join(', ') || p.region || p.country_code || '' }));
}
