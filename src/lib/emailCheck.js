// Catches the email mistakes that would otherwise only show up as a code
// that never arrives. Shared by the sign-up and reset forms and the server.

const SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Domains that can never receive mail: the documentation and test names
// reserved by RFC 2606 / 6761. Resend refuses them outright.
const RESERVED = /(^|\.)(example\.(com|net|org)|example|test|invalid|localhost|local)$/;

// Misspellings of the providers most members use, mapped to the real one.
// Only exact matches, so a genuine small domain is never "corrected".
const DOMAIN_FIXES = {
  'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gamil.com': 'gmail.com', 'gmal.com': 'gmail.com',
  'gmaill.com': 'gmail.com', 'gnail.com': 'gmail.com', 'gmail.co': 'gmail.com', 'gmail.cm': 'gmail.com',
  'gmail.om': 'gmail.com', 'gmail.con': 'gmail.com', 'gmail.cmo': 'gmail.com', 'gmail.comm': 'gmail.com',
  'gmail.coom': 'gmail.com', 'gmail.cpm': 'gmail.com', 'gmail.vom': 'gmail.com', 'gmali.com': 'gmail.com',
  'gemail.com': 'gmail.com', 'gimail.com': 'gmail.com', 'gmaul.com': 'gmail.com', 'gmsil.com': 'gmail.com',
  'gmail.net': 'gmail.com', 'googlemail.co': 'googlemail.com',
  'yaho.com': 'yahoo.com', 'yahooo.com': 'yahoo.com', 'yhoo.com': 'yahoo.com', 'yahoo.co': 'yahoo.com',
  'yahoo.con': 'yahoo.com', 'yahoo.cm': 'yahoo.com', 'yaoo.com': 'yahoo.com', 'tahoo.com': 'yahoo.com',
  'hotmial.com': 'hotmail.com', 'hotmal.com': 'hotmail.com', 'hotmai.com': 'hotmail.com', 'hotmail.co': 'hotmail.com',
  'hotmail.con': 'hotmail.com', 'hotmil.com': 'hotmail.com', 'hotamil.com': 'hotmail.com', 'homail.com': 'hotmail.com',
  'outlok.com': 'outlook.com', 'outloo.com': 'outlook.com', 'outlook.co': 'outlook.com', 'outlook.con': 'outlook.com',
  'outllok.com': 'outlook.com', 'otlook.com': 'outlook.com',
  'icloud.co': 'icloud.com', 'icloud.con': 'icloud.com', 'iclod.com': 'icloud.com', 'icoud.com': 'icloud.com', 'icluod.com': 'icloud.com',
  'aol.co': 'aol.com', 'aol.con': 'aol.com', 'aoll.com': 'aol.com',
  'verizon.ent': 'verizon.net', 'optonline.com': 'optonline.net', 'optonline.ent': 'optonline.net',
};

// Any domain ending in a mistyped ".com" (".con", ".cmo", ".comm" ...).
const TLD_FIXES = { con: 'com', cmo: 'com', ocm: 'com', vom: 'com', xom: 'com', cpm: 'com', comm: 'com', coom: 'com', ent: 'net', nte: 'net' };

const split = (email) => {
  const s = String(email || '').trim().toLowerCase();
  const at = s.lastIndexOf('@');
  return at < 1 ? [s, ''] : [s.slice(0, at), s.slice(at + 1)];
};

// True when the address cannot possibly receive mail. The form and the
// server both refuse these before anything is sent.
export function isUndeliverableEmail(email) {
  const s = String(email || '').trim();
  if (!SHAPE.test(s) || /\.\.|@\.|\.@/.test(s)) return true;
  return RESERVED.test(split(s)[1]);
}

// A likely intended address ("eli@gmial.com" -> "eli@gmail.com"), or null.
export function suggestEmail(email) {
  const [local, domain] = split(email);
  if (!local || !domain) return null;
  if (DOMAIN_FIXES[domain]) return `${local}@${DOMAIN_FIXES[domain]}`;
  const dot = domain.lastIndexOf('.');
  const tld = domain.slice(dot + 1);
  if (dot > 0 && TLD_FIXES[tld]) return `${local}@${domain.slice(0, dot)}.${TLD_FIXES[tld]}`;
  return null;
}
