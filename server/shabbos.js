// Shabbos / Yom Tov status.
//
// These times gate whether the app accepts writes, so they have to be right.
// Zmanim, the Hebrew calendar, parsha and Israel-vs-diaspora yom tov lengths
// all come from @hebcal/core rather than hand-rolled sunset math.
import { HebrewCalendar, Location, Zmanim, CandleLightingEvent, HavdalahEvent, flags } from '@hebcal/core';
import { store } from './db.js';

const DAY = 86_400_000;

// The global override is read on every status call and changes about once a
// year, so a short cache removes a database round trip from the hottest path
// while still letting an admin's change take effect promptly.
const OVERRIDE_TTL_MS = Number(process.env.KC_SHABBOS_OVERRIDE_TTL_MS || 30_000);
let overrideCache = { value: false, readAt: 0 };

async function readGlobalOverride() {
  const now = Date.now();
  if (now - overrideCache.readAt < OVERRIDE_TTL_MS) return overrideCache.value;
  const value = (await store.filter('Setting', { key: 'shabbos_global_override' }))[0]?.value === 'true';
  overrideCache = { value, readAt: now };
  return value;
}

// A zone name only counts if the platform knows it. hebcal accepts anything
// at construction and throws much later, from inside the calendar call, so an
// unusable value has to be caught here.
export function isValidTimeZone(tzid) {
  if (!tzid || typeof tzid !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tzid });
    return true;
  } catch {
    return false;
  }
}

// Whether these are Israel times, which decides one day of Yom Tov or two.
// The zone is the reliable signal: country_code is a free-text box that
// geocoders often leave empty, and an empty country used to turn a Jerusalem
// member into the diaspora — a whole extra day of lock.
const ISRAEL_ZONES = new Set(['Asia/Jerusalem', 'Asia/Tel_Aviv', 'Asia/Hebron', 'Asia/Gaza']);
export function inIsrael({ timezone, country_code, latitude, longitude }) {
  if (isValidTimeZone(timezone) && ISRAEL_ZONES.has(timezone)) return true;
  if (String(country_code || '').trim().toUpperCase() === 'IL') return true;
  // Last resort, for a row with coordinates but neither zone nor country: the
  // box around Israel. Deliberately generous — one day of Yom Tov is the
  // lenient answer, so this only ever adds the stricter reading where the
  // coordinates genuinely sit in the country.
  const lat = Number(latitude), lon = Number(longitude);
  return Number.isFinite(lat) && Number.isFinite(lon)
    && lat > 29.4 && lat < 33.4 && lon > 34.2 && lon < 35.9;
}

function locationFor(profile) {
  const { latitude, longitude, timezone, city, country_code } = profile;
  if (latitude == null || longitude == null) return null;
  // A tzid is required for correct local times. An invalid one used to be
  // passed straight through and blew up inside the calendar call, which took
  // the whole status endpoint — and every write — down with it.
  if (!isValidTimeZone(timezone)) return null;
  try {
    return new Location(Number(latitude), Number(longitude), inIsrael(profile), timezone, city || 'Your location', country_code || undefined);
  } catch {
    return null;
  }
}

// havdalah_method as it is stored: a number of minutes after sunset ("42",
// "50", "72"), degrees below the horizon ("8.5deg"), or the token the settings
// menu has always sent for the degrees option.
const HAVDALAH_TOKENS = { tzeis_8_5: { havdalahDeg: 8.5 }, tzeis_7_083: { havdalahDeg: 7.083 }, tzeis_8_5deg: { havdalahDeg: 8.5 } };
function havdalahOptions(method) {
  const raw = String(method ?? '50').trim();
  if (HAVDALAH_TOKENS[raw]) return HAVDALAH_TOKENS[raw];
  if (raw.endsWith('deg')) {
    const deg = parseFloat(raw);
    if (Number.isFinite(deg)) return { havdalahDeg: deg };
  }
  const mins = parseFloat(raw);
  if (Number.isFinite(mins) && mins > 0) return { havdalahMins: mins };
  // Anything else is a value we do not understand. Say so rather than
  // quietly applying a different opinion than the one that was chosen.
  if (raw && raw !== '50') console.warn(`[shabbos] unrecognised havdalah_method ${JSON.stringify(raw)} — using 50 minutes`);
  return { havdalahMins: 50 };
}

// An offset of "" is not an offset of zero. Zero would mean lighting exactly
// at sunset, which opens the write gate well past the real candle lighting.
function candleOptions(value) {
  if (value === '' || value == null) return {};
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? { candleLightingMins: n } : {};
}

// The calendar date it is right now in a zone, and that date's weekday.
function localDate(now, tzid) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tzid, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short',
  }).formatToParts(new Date(now)).map((x) => [x.type, x.value]));
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day), dow };
}

// Epoch ms of midnight starting a calendar date in a zone. Two passes, because
// the zone's offset on that date is only known once we are near it.
function midnightIn(y, m, d, tzid) {
  let t = Date.UTC(y, m - 1, d);
  for (let i = 0; i < 2; i++) {
    const p = localDate(t, tzid);
    const hm = new Intl.DateTimeFormat('en-GB', { timeZone: tzid, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(t)).split(':').map(Number);
    const shown = Date.UTC(p.y, p.m - 1, p.d) + (hm[0] * 60 + hm[1]) * 60_000;
    t += Date.UTC(y, m - 1, d) - shown;
  }
  return t;
}

// When the home page puts the Shabbos times at the top: from sunset on
// Thursday until Friday ends, in the place the times are for. The window for
// this week, or the coming week once Friday is over.
export function homePinWindow(location, now = Date.now()) {
  const tzid = location.getTzid();
  const { y, m, d, dow } = localDate(now, tzid);
  const toThursday = dow === 5 ? -1 : (4 - dow + 7) % 7;
  const thu = new Date(Date.UTC(y, m - 1, d + toThursday));
  const [ty, tm, td] = [thu.getUTCFullYear(), thu.getUTCMonth() + 1, thu.getUTCDate()];
  const sunset = new Zmanim(location, new Date(ty, tm - 1, td), false).sunset();
  return {
    pinFrom: Number.isNaN(sunset?.getTime?.()) ? midnightIn(ty, tm, td + 1, tzid) : sunset.getTime(),
    pinUntil: midnightIn(ty, tm, td + 2, tzid),
  };
}

/**
 * @param profile user-ish object: latitude, longitude, timezone, city,
 *   country_code, candle_lighting_offset_minutes, havdalah_method,
 *   shabbos_read_only, admin_override
 * @param now epoch ms
 */
export async function computeShabbosStatus(profile = {}, now = Date.now()) {
  const globalOverride = await readGlobalOverride();

  if (globalOverride || profile.admin_override) {
    return { adminOverride: true, isRestricted: false, hasLocation: true };
  }

  const location = locationFor(profile);
  if (!location) return { hasLocation: false, isRestricted: false, adminOverride: false };

  let events;
  try {
    events = HebrewCalendar.calendar({
      // Five days back, not three: a Yom Tov that runs into Shabbos is over
      // three days long, so a shorter lookback loses the window's own opening
      // boundary and reports an intermediate candle lighting as the start.
      start: new Date(now - 5 * DAY),
      end: new Date(now + 10 * DAY),
      location,
      il: location.getIsrael(),
      candlelighting: true,
      sedrot: true,
      ...candleOptions(profile.candle_lighting_offset_minutes),
      ...havdalahOptions(profile.havdalah_method),
    });
  } catch (err) {
    // A profile hebcal cannot work with must not take down the status
    // endpoint and every write with it.
    console.error('[shabbos] could not compute zmanim for this profile:', err.message);
    return { hasLocation: false, isRestricted: false, adminOverride: false, error: 'zmanim_unavailable' };
  }

  // Reduce to an ordered list of boundary times: candle lighting opens a
  // restricted window, havdalah closes it. Match on the event classes rather
  // than flag masks — hebcal reuses mask 32 for both Havdalah and
  // light-candles-after-tzeis, so the masks can't tell them apart.
  const boundaries = events
    .filter((e) => e.eventTime && (e instanceof CandleLightingEvent || e instanceof HavdalahEvent))
    .map((e) => ({
      time: e.eventTime.getTime(),
      opens: e instanceof CandleLightingEvent,
      desc: e.render('en'),
    }))
    .sort((a, b) => a.time - b.time);

  let startsAt = null;
  let endsAt = null;
  let isRestricted = false;

  for (let i = 0; i < boundaries.length; i++) {
    const b = boundaries[i];
    if (!b.opens) continue;
    // A three-day window has candle lighting again in the middle of it. The
    // window began at the first of those, so walk back over any run of
    // openings before reporting when it started.
    if (i > 0 && boundaries[i - 1].opens) continue;
    const close = boundaries.slice(i + 1).find((x) => !x.opens);
    if (!close) continue;
    if (now >= b.time && now < close.time) {
      isRestricted = true;
      startsAt = b.time;
      endsAt = close.time;
      break;
    }
  }

  // Next boundary the UI can count down to.
  const upcoming = boundaries.find((b) => b.time > now);
  const nextChange = isRestricted ? endsAt : upcoming?.time ?? null;

  if (!isRestricted && upcoming?.opens) {
    startsAt = upcoming.time;
    endsAt = boundaries.find((x) => x.time > upcoming.time && !x.opens)?.time ?? null;
  }

  // Parsha for the Shabbos inside (or nearest ahead of) the current window.
  const anchor = startsAt ?? now;
  const parshaEvent = events
    .filter((e) => e.getFlags() & flags.PARSHA_HASHAVUA)
    .find((e) => Math.abs(e.getDate().greg().getTime() - anchor) < 2 * DAY);

  // What the window actually is, taken from the events rather than guessed
  // from the parsha — the parsha of the week exists during Yom Kippur too,
  // and the lock screen was greeting people with "Gut Shabbos" because of it.
  const holidayFlags = flags.CHAG | flags.MAJOR_HOLIDAY | flags.YOM_TOV_ENDS | flags.EREV;
  const inWindow = (t) => startsAt != null && endsAt != null && t >= startsAt - DAY && t <= endsAt + DAY;
  const hasYomTov = events.some((e) => (e.getFlags() & holidayFlags) && inWindow(e.getDate().greg().getTime()));
  const coversSaturday = (() => {
    if (startsAt == null || endsAt == null) return false;
    try {
      const zone = location.getTzid();
      for (let t = startsAt; t <= endsAt; t += 6 * 3600_000) {
        if (new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short' }).format(new Date(t)) === 'Sat') return true;
      }
    } catch { /* the zone was validated above; this is belt and braces */ }
    return false;
  })();
  const windowKind = hasYomTov && coversSaturday ? 'both' : hasYomTov ? 'yomtov' : 'shabbos';

  return {
    hasLocation: true,
    adminOverride: false,
    isRestricted,
    // Read-only unless the user has explicitly asked for a full lock. Reading is
    // not melacha, and a hard lock on a community directory is worst exactly
    // when it matters most — someone looking up a doctor or the medical
    // equipment gemach on Shabbos. The write-gate is what this feature is for.
    readOnly: profile.shabbos_full_lock !== true,
    startsAt,
    endsAt,
    nextChange,
    cityLabel: location.getName() || profile.city || 'Your location',
    tzid: location.getTzid(),
    parsha: parshaEvent ? parshaEvent.render('en') : null,
    // 'shabbos' | 'yomtov' | 'both' — what to call this window, and how to
    // greet someone during it.
    windowKind,
    isInIsrael: location.getIsrael(),
    // Thursday sunset to the end of Friday: the home page pins the times then.
    ...homePinWindow(location, now),
  };
}

// Write-gate used by the mutating functions: during Shabbos/Yom Tov the server
// refuses writes, so a client clock or a stale tab can't slip one through.
export async function assertWritable(profile, now = Date.now()) {
  const status = await computeShabbosStatus(profile, now);
  if (status.isRestricted) {
    const err = new Error('This action is unavailable during Shabbos and Yom Tov.');
    err.statusCode = 423;
    throw err;
  }
}
