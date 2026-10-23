// Community affiliation, chosen during onboarding and editable on the
// profile. Optional, self-described, and used for personalisation and the
// "known in your community" counts — never as a gate.
export const AFFILIATIONS = [
  { id: 'yeshivish', label: 'Yeshivish' },
  { id: 'chassidish', label: 'Chassidish' },
  { id: 'heimish', label: 'Heimish' },
  { id: 'modern_orthodox', label: 'Modern Orthodox' },
  { id: 'sephardic', label: 'Sephardic' },
  { id: 'chabad', label: 'Chabad' },
  { id: 'other', label: 'Other / mixed' },
  { id: 'private', label: 'Prefer not to say' },
];
export const AFFILIATION_BY_ID = Object.fromEntries(AFFILIATIONS.map((a) => [a.id, a]));

export const PROFILE_TYPES = [
  { id: 'community_member', label: 'Looking for resources', blurb: 'Find trusted businesses, professionals and gemachs, and ask the community.' },
  { id: 'provider', label: 'Offering a service', blurb: 'A professional or tradesperson. Set up your listing so the community can find and vouch for you.', blurbNoVouches: 'A professional or tradesperson. Set up your listing so the community can find you.' },
  { id: 'business_owner', label: 'Running a business', blurb: 'A shop, restaurant, practice or organization. Claim or create its page and post updates.' },
  // Lighter answers for the profile only; the welcome screen keeps the three above.
  { id: 'just_chilling', label: 'Just chilling', profileOnly: true },
];
export const PROFILE_TYPE_BY_ID = Object.fromEntries(PROFILE_TYPES.map((t) => [t.id, t]));
