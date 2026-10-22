// The country a listing is in, and the Country filter beside the Where box.
//
// The directory began in the US, where a state said enough. Listings now come
// from Israel, France, England, Canada, Mexico and further, with no US state
// and often no state at all, so "Where" alone could not narrow them. Each
// listing carries its country by name ("Israel", "United Kingdom"), and the
// filter offers only the countries that have something listed.

// Names as people say them, not as ISO writes them: "DR Congo", "Turkey".
const LIST =
  'AD Andorra|AE United Arab Emirates|AF Afghanistan|AG Antigua and Barbuda|AI Anguilla|AL Albania|AM Armenia|' +
  'AO Angola|AR Argentina|AS American Samoa|AT Austria|AU Australia|AW Aruba|AZ Azerbaijan|' +
  'BA Bosnia and Herzegovina|BB Barbados|BD Bangladesh|BE Belgium|BF Burkina Faso|BG Bulgaria|BH Bahrain|' +
  'BI Burundi|BJ Benin|BL Saint Barthélemy|BM Bermuda|BN Brunei|BO Bolivia|BQ Caribbean Netherlands|BR Brazil|' +
  'BS Bahamas|BT Bhutan|BW Botswana|BY Belarus|BZ Belize|CA Canada|CD DR Congo|CF Central African Republic|' +
  'CG Republic of the Congo|CH Switzerland|CI Ivory Coast|CK Cook Islands|CL Chile|CM Cameroon|CN China|' +
  'CO Colombia|CR Costa Rica|CU Cuba|CV Cape Verde|CW Curaçao|CY Cyprus|CZ Czech Republic|DE Germany|DJ Djibouti|' +
  'DK Denmark|DM Dominica|DO Dominican Republic|DZ Algeria|EC Ecuador|EE Estonia|EG Egypt|EH Western Sahara|' +
  'ER Eritrea|ES Spain|ET Ethiopia|FI Finland|FJ Fiji|FK Falkland Islands|FM Micronesia|FO Faroe Islands|' +
  'FR France|GA Gabon|GB United Kingdom|GD Grenada|GE Georgia|GF French Guiana|GG Guernsey|GH Ghana|GI Gibraltar|' +
  'GL Greenland|GM Gambia|GN Guinea|GP Guadeloupe|GQ Equatorial Guinea|GR Greece|GT Guatemala|GU Guam|' +
  'GW Guinea-Bissau|GY Guyana|HK Hong Kong|HN Honduras|HR Croatia|HT Haiti|HU Hungary|ID Indonesia|IE Ireland|' +
  'IL Israel|IM Isle of Man|IN India|IQ Iraq|IR Iran|IS Iceland|IT Italy|JE Jersey|JM Jamaica|JO Jordan|JP Japan|' +
  'KE Kenya|KG Kyrgyzstan|KH Cambodia|KI Kiribati|KM Comoros|KN Saint Kitts and Nevis|KP North Korea|' +
  'KR South Korea|KW Kuwait|KY Cayman Islands|KZ Kazakhstan|LA Laos|LB Lebanon|LC Saint Lucia|LI Liechtenstein|' +
  'LK Sri Lanka|LR Liberia|LS Lesotho|LT Lithuania|LU Luxembourg|LV Latvia|LY Libya|MA Morocco|MC Monaco|' +
  'MD Moldova|ME Montenegro|MF Saint Martin|MG Madagascar|MH Marshall Islands|MK North Macedonia|ML Mali|' +
  'MM Myanmar|MN Mongolia|MO Macau|MP Northern Mariana Islands|MQ Martinique|MR Mauritania|MS Montserrat|' +
  'MT Malta|MU Mauritius|MV Maldives|MW Malawi|MX Mexico|MY Malaysia|MZ Mozambique|NA Namibia|NC New Caledonia|' +
  'NE Niger|NG Nigeria|NI Nicaragua|NL Netherlands|NO Norway|NP Nepal|NR Nauru|NU Niue|NZ New Zealand|OM Oman|' +
  'PA Panama|PE Peru|PF French Polynesia|PG Papua New Guinea|PH Philippines|PK Pakistan|PL Poland|' +
  'PM Saint Pierre and Miquelon|PR Puerto Rico|PS Palestinian Territories|PT Portugal|PW Palau|PY Paraguay|' +
  'QA Qatar|RE Réunion|RO Romania|RS Serbia|RU Russia|RW Rwanda|SA Saudi Arabia|SB Solomon Islands|SC Seychelles|' +
  'SD Sudan|SE Sweden|SG Singapore|SH Saint Helena|SI Slovenia|SK Slovakia|SL Sierra Leone|SM San Marino|' +
  'SN Senegal|SO Somalia|SR Suriname|SS South Sudan|ST São Tomé and Príncipe|SV El Salvador|SX Sint Maarten|' +
  'SY Syria|SZ Eswatini|TC Turks and Caicos Islands|TD Chad|TG Togo|TH Thailand|TJ Tajikistan|TK Tokelau|' +
  'TL Timor-Leste|TM Turkmenistan|TN Tunisia|TO Tonga|TR Turkey|TT Trinidad and Tobago|TV Tuvalu|TW Taiwan|' +
  'TZ Tanzania|UA Ukraine|UG Uganda|US United States|UY Uruguay|UZ Uzbekistan|VA Vatican City|' +
  'VC Saint Vincent and Grenadines|VE Venezuela|VG British Virgin Islands|VI U.S. Virgin Islands|VN Vietnam|' +
  'VU Vanuatu|WF Wallis and Futuna|WS Samoa|XK Kosovo|YE Yemen|YT Mayotte|ZA South Africa|ZM Zambia|ZW Zimbabwe|' +
  'ZZ Unknown Region';

/** Every country, as [code, name], alphabetical by name. For the listing form. */
export const COUNTRIES = LIST.split('|').map((row) => [row.slice(0, 2), row.slice(3)])
  .sort((a, b) => a[1].localeCompare(b[1]));
export const US = 'United States';

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/\./g, '').replace(/[^a-z0-9]+/g, ' ').trim();

const BY_CODE = new Map(COUNTRIES.map(([code, name]) => [code, name]));
const BY_NAME = new Map(COUNTRIES.map(([, name]) => [norm(name), name]));
// Other names people type for a country.
for (const [alias, name] of [
  ['usa', US], ['us', US], ['america', US], ['united states of america', US],
  ['uk', 'United Kingdom'], ['england', 'United Kingdom'], ['scotland', 'United Kingdom'], ['wales', 'United Kingdom'],
  ['great britain', 'United Kingdom'], ['britain', 'United Kingdom'], ['northern ireland', 'United Kingdom'],
  ['eretz yisroel', 'Israel'], ['eretz yisrael', 'Israel'], ['brasil', 'Brazil'], ['mexico', 'Mexico'],
  ['korea', 'South Korea'], ['holland', 'Netherlands'], ['czechia', 'Czech Republic'], ['turkiye', 'Turkey'],
  ['deutschland', 'Germany'], ['espana', 'Spain'], ['italia', 'Italy'], ['suisse', 'Switzerland'], ['schweiz', 'Switzerland'],
]) BY_NAME.set(alias, name);

/** The country's name for a code ("IL") or anything people call it ("England"), or ''. */
export function countryName(text) {
  const raw = String(text ?? '').trim();
  if (/^[A-Za-z]{2}$/.test(raw) && raw === raw.toUpperCase() && BY_CODE.has(raw)) return BY_CODE.get(raw);
  return BY_NAME.get(norm(raw)) || '';
}

const CODE_OF = new Map(COUNTRIES.map(([code, name]) => [name, code]));
/** The two-letter code for a country's name ("Israel" -> "IL"), or ''. */
export const countryCode = (name) => CODE_OF.get(countryName(name)) || '';

/**
 * The countries whose name, or a name people call them, has a word starting
 * with `text`: "bah" is the Bahamas, "kingdom" and "eng" the United Kingdom.
 */
export function countriesStarting(text) {
  const t = norm(text);
  if (t.length < 2) return new Set();
  const found = new Set();
  for (const [name, country] of BY_NAME) {
    if (name.startsWith(t) || name.includes(` ${t}`)) found.add(country);
  }
  return found;
}

// A listing from before countries were recorded: a US state is the US.
const US_STATES = new Set(('al ak az ar ca co ct de dc fl ga hi id il in ia ks ky la me md ma mi mn ms mo mt ne nv nh nj nm ' +
  'ny nc nd oh ok or pa ri sc sd tn tx ut vt va wa wv wi wy').split(' '));
const US_STATE_NAMES = new Set(['alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado', 'connecticut', 'delaware',
  'district of columbia', 'florida', 'georgia', 'hawaii', 'idaho', 'illinois', 'indiana', 'iowa', 'kansas', 'kentucky',
  'louisiana', 'maine', 'maryland', 'massachusetts', 'michigan', 'minnesota', 'mississippi', 'missouri', 'montana',
  'nebraska', 'nevada', 'new hampshire', 'new jersey', 'new mexico', 'new york', 'north carolina', 'north dakota', 'ohio',
  'oklahoma', 'oregon', 'pennsylvania', 'rhode island', 'south carolina', 'south dakota', 'tennessee', 'texas', 'utah',
  'vermont', 'virginia', 'washington', 'west virginia', 'wisconsin', 'wyoming']);

/** The country a listing is in, or '' when it does not say. */
export function countryOf(provider) {
  const own = String(provider?.country || '').trim();
  if (own) return countryName(own) || own;
  const state = norm(provider?.state);
  return US_STATES.has(state) || US_STATE_NAMES.has(state) ? US : '';
}

// Listings that serve the whole world, not one country: shown whichever
// country is picked. "Nationwide" is not one of these; it means its own country.
const WORLDWIDE = /\b(worldwide|world-?wide|international(?:ly)?|global(?:ly)?|anywhere|everywhere|online)\b/i;
export function servesWorldwide(provider) {
  return (provider?.service_areas || []).some((area) => WORLDWIDE.test(String(area || '')));
}

/** A test for "is this listing in `country`?", or null for Everywhere. */
export function countryMatcher(country) {
  const name = countryName(country) || String(country || '').trim();
  if (!name) return null;
  return (p) => countryOf(p) === name || servesWorldwide(p);
}

/** Only the listings in `country`; the same list for Everywhere. */
export function inCountry(providers, country) {
  const test = countryMatcher(country);
  return test ? providers.filter(test) : providers;
}

/**
 * The countries that have something listed, most-listed first, for the
 * Country filter. The US leads whatever the counts, since most visitors are
 * there.
 */
export function countriesFrom(providers = []) {
  const counts = new Map();
  for (const p of providers) {
    const c = countryOf(p);
    if (c) counts.set(c, (counts.get(c) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => (b[0] === US) - (a[0] === US) || b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([country, count]) => ({ country, count }));
}

/** "Paris, France" or "Boca Raton, FL": city, region and, outside the US, the country. */
export function placeLine(provider) {
  const country = countryOf(provider);
  // "OTHER" is the listing form's state for somewhere outside the US, not a place.
  const parts = [provider?.city, provider?.state].map((s) => String(s || '').trim()).filter((s) => s && !/^other$/i.test(s));
  if (country && country !== US && !parts.some((s) => s.toLowerCase() === country.toLowerCase())) parts.push(country);
  return parts.join(', ');
}
