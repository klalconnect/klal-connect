// The place a guest picked, or their browser shared, kept in this browser only
// and never sent anywhere except to work out their Shabbos times. Its own small
// module so the header's Shabbos bar can read it without loading the city
// tables @/lib/userLocation brings in.
//
// Stored as { lat, lng, city, country?, source }.

const KEY = 'kc_my_location';

/** A guest's picked or shared place, or null. */
export function readSaved() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    return saved && Number.isFinite(saved.lat) && Number.isFinite(saved.lng) ? saved : null;
  } catch { return null; }
}

export function save(value) {
  try {
    if (value) localStorage.setItem(KEY, JSON.stringify(value));
    else localStorage.removeItem(KEY);
  } catch { /* private window: it lasts until the page closes */ }
  window.dispatchEvent(new Event('kc-location'));
}

