// Ready-made skills a member can tap instead of typing, like LinkedIn's
// suggested skills. Each group carries the words that, found in someone's
// headline or job titles, put that group first: a bookkeeper sees
// bookkeeping skills before plumbing ones. Typing still adds anything.
const GROUPS = [
  { match: /account|bookkeep|cpa|tax|payroll|financ|controller|audit|cfo/i, skills: ['Bookkeeping', 'Accounting', 'Tax preparation', 'Payroll', 'QuickBooks', 'Financial planning', 'Budgeting', 'Auditing', 'Accounts payable', 'Accounts receivable'] },
  { match: /real estate|realtor|broker|property|mortgage|landlord|apartment|rental/i, skills: ['Real estate', 'Property management', 'Mortgages', 'Leasing', 'Real estate investing', 'Appraisal', 'Commercial real estate'] },
  { match: /insurance|agent|benefits|annuit/i, skills: ['Insurance', 'Life insurance', 'Health insurance', 'Employee benefits', 'Medicare'] },
  { match: /sales|business develop|account exec|marketing|brand|social media|seo|advertis/i, skills: ['Sales', 'Business development', 'Marketing', 'Social media', 'Digital marketing', 'SEO', 'Copywriting', 'Branding', 'Lead generation', 'Customer relationships'] },
  { match: /design|graphic|artist|creative|photo|video|film/i, skills: ['Graphic design', 'Logo design', 'Photography', 'Videography', 'Video editing', 'Canva', 'Adobe Photoshop', 'Printing'] },
  { match: /software|developer|engineer|programm|tech|web|it |it$|computer|data|network/i, skills: ['Software development', 'Web design', 'IT support', 'Networking', 'Cybersecurity', 'Data analysis', 'JavaScript', 'Python', 'SQL', 'WordPress', 'Excel'] },
  { match: /manag|director|owner|founder|ceo|coo|president|operations|office/i, skills: ['Management', 'Operations', 'Project management', 'Leadership', 'Hiring', 'Office management', 'Strategic planning', 'Negotiation'] },
  { match: /admin|assistant|secretar|reception|clerk|customer|service/i, skills: ['Customer service', 'Data entry', 'Scheduling', 'Microsoft Office', 'Excel', 'Typing', 'Phone skills', 'Organization'] },
  { match: /rebbe|morah|teach|tutor|educat|school|principal|melamed|menahel|yeshiva|seminary|kollel/i, skills: ['Teaching', 'Tutoring', 'Special education', 'Curriculum planning', 'Classroom management', 'Reading help', 'Math tutoring', 'Test prep'] },
  { match: /rabbi|rav|torah|gemara|halach|chazzan|sofer|mashgiach|kashrus|mohel|shul|kiruv/i, skills: ['Gemara', 'Halacha', 'Bar mitzvah lessons', 'Kriah (Torah reading)', 'Chazzanus', 'Sofrus (STaM)', 'Kashrus supervision', 'Kiruv', 'Shiurim'] },
  { match: /therap|speech|occupational|physical|counsel|social work|psycholog|nurs|doctor|medical|health|dent|pharm/i, skills: ['Speech therapy', 'Occupational therapy', 'Physical therapy', 'Counseling', 'Social work', 'Nursing', 'Medical billing', 'Home health care', 'ABA therapy'] },
  { match: /law|legal|attorney|lawyer|paralegal|immigration|notary/i, skills: ['Law', 'Contracts', 'Real estate law', 'Immigration', 'Estate planning', 'Notary', 'Paralegal work', 'Mediation'] },
  { match: /chessed|gemach|nonprofit|non-profit|tzedak|fundrais|development|grant|organization/i, skills: ['Fundraising', 'Grant writing', 'Nonprofit management', 'Event planning', 'Volunteer coordination', 'Community outreach'] },
  { match: /cater|chef|cook|bak|food|restaurant|kitchen/i, skills: ['Catering', 'Cooking', 'Baking', 'Event planning', 'Menu planning', 'Food service'] },
  { match: /contract|plumb|electric|hvac|construct|handyman|carpent|paint|roof|renovat|build/i, skills: ['Contracting', 'Plumbing', 'Electrical', 'HVAC', 'Carpentry', 'Painting', 'Renovations', 'Handyman work'] },
  { match: /clean|mov|driv|deliver|transport|logistic|warehouse|ship/i, skills: ['Cleaning', 'Moving', 'Driving', 'Delivery', 'Logistics', 'Shipping'] },
  { match: /child|baby|nanny|babysit|camp|youth|counselor/i, skills: ['Childcare', 'Babysitting', 'Camp counseling', 'Youth programs'] },
  { match: /write|writer|editor|journal|translat|publish/i, skills: ['Writing', 'Editing', 'Proofreading', 'Translation', 'Hebrew', 'Yiddish'] },
];

// Shown before any group when nothing about the person points anywhere:
// skills that fit almost anyone.
const COMMON = ['Customer service', 'Sales', 'Management', 'Bookkeeping', 'Excel', 'Teaching', 'Social media', 'Event planning', 'Hebrew', 'Yiddish', 'Public speaking', 'Writing'];

const ALL = [...new Set(GROUPS.flatMap((g) => g.skills).concat(COMMON, ['Public speaking', 'Problem solving', 'Teamwork', 'Time management']))];

/**
 * Suggestions for `user`, best first, without any already chosen.
 * `typed` narrows the list to skills containing it, those starting with it
 * first.
 */
export function suggestSkills(user, chosen = [], typed = '') {
  const have = new Set(chosen.map((s) => s.toLowerCase()));
  const about = [user?.headline, ...(Array.isArray(user?.work_experience) ? user.work_experience.map((j) => j?.title) : [])].filter(Boolean).join(' · ');
  const matched = about ? GROUPS.filter((g) => g.match.test(about)).flatMap((g) => g.skills) : [];
  let list = [...new Set([...matched, ...COMMON, ...ALL])].filter((s) => !have.has(s.toLowerCase()));
  const t = typed.trim().toLowerCase();
  if (t) {
    list = list.filter((s) => s.toLowerCase().includes(t));
    list.sort((a, b) => Number(!a.toLowerCase().startsWith(t)) - Number(!b.toLowerCase().startsWith(t)));
  }
  return list;
}

// Languages offered on a listing. Typing another one still works.
export const LANGUAGE_CHOICES = ['English', 'Hebrew', 'Yiddish', 'Russian', 'Spanish', 'French', 'Persian', 'Hungarian', 'Portuguese', 'Italian'];

// Areas served: the two "everywhere" answers the search already understands,
// then the larger communities.
export const AREA_CHOICES = ['Nationwide', 'Worldwide', 'Lakewood', 'Brooklyn', 'Monsey', 'Five Towns', 'Queens', 'Passaic', 'Teaneck', 'Baltimore', 'Boca Raton', 'Miami', 'Chicago', 'Los Angeles', 'Cleveland', 'Toronto', 'London', 'Jerusalem'];
