import {
  Home, BriefcaseBusiness, HeartPulse, Scale, Laptop, GraduationCap, Utensils, Users, Landmark,
  Gift, ShieldCheck, Droplets, BookOpen, Baby, Car, Scissors, Camera, Music, Wrench, Truck,
  Stethoscope, Shirt, Cake, Flower2, Building2, HandHeart, Plane, PawPrint, Dumbbell, Sparkles,
  Store, Hammer, Paintbrush, KeyRound, Phone, MoreHorizontal, Umbrella,
} from 'lucide-react';
import StarOfDavid from '@/components/icons/StarOfDavid';

// Icons a category can carry. One registry, shared by the directory grid and
// the admin picker, so a category added from the admin screen is not stuck
// with the generic dots — which is what happened to "Mikva".
export const CATEGORY_ICONS = {
  Home, BriefcaseBusiness, HeartPulse, Scale, Laptop, GraduationCap, Utensils, Users, Landmark,
  Gift, ShieldCheck, Droplets, BookOpen, Baby, Car, Scissors, Camera, Music, Wrench, Truck,
  Stethoscope, Shirt, Cake, Flower2, Building2, HandHeart, Plane, PawPrint, Dumbbell, Sparkles,
  Store, Hammer, Paintbrush, KeyRound, Phone, MoreHorizontal, Umbrella, StarOfDavid,
};

export const iconFor = (name) => CATEGORY_ICONS[name] || MoreHorizontal;
export const ICON_NAMES = Object.keys(CATEGORY_ICONS);

// A first guess from the category's own name, so adding one is a single field
// in the common case. Order matters: the first match wins.
const GUESSES = [
  [/^home|home services|household/i, 'Home'],
  [/mikv|mikveh|bath/i, 'Droplets'],
  [/shul|synagogue|beis medrash|minyan/i, 'StarOfDavid'],
  [/school|yeshiv|cheder|tutor|educat|kollel|seminary/i, 'GraduationCap'],
  [/sefer|sefarim|book|judaica/i, 'BookOpen'],
  [/gemach|chesed|tzedak|charit/i, 'Gift'],
  [/shidduch|shadchan|matchmak|dating/i, 'HandHeart'],
  [/food|cater|bakery|restaurant|grocer|pizza/i, 'Utensils'],
  [/simcha|wedding|hall|photograph/i, 'Camera'],
  [/music|band|singer|klezmer/i, 'Music'],
  [/cake|candy|sweet/i, 'Cake'],
  [/flower|florist/i, 'Flower2'],
  [/health|medical|doctor|dentist|therap|nurse/i, 'HeartPulse'],
  [/pharmac|clinic/i, 'Stethoscope'],
  [/babysit|childcare|daycare|playgroup|camp/i, 'Baby'],
  [/law|legal|attorney|advocate/i, 'Scale'],
  [/insur/i, 'Umbrella'],
  [/account|bookkeep|financ|mortgage|tax|loan/i, 'Landmark'],
  [/real estate|realty|apartment|rental|property/i, 'Building2'],
  [/car|auto|mechanic|driving|taxi|limo/i, 'Car'],
  [/mov(e|ing)|deliver|shipping|storage/i, 'Truck'],
  [/travel|flight|trip/i, 'Plane'],
  [/cloth|shaitel|sheitel|wig|tailor|dress|linen/i, 'Shirt'],
  [/barber|hair|salon|makeup/i, 'Scissors'],
  [/plumb|electric|handy|repair|contract|renovat/i, 'Wrench'],
  [/paint|decor/i, 'Paintbrush'],
  [/carpent|furnitur|build/i, 'Hammer'],
  [/lock|key|security|alarm/i, 'KeyRound'],
  [/tech|computer|it |software|web|phone repair/i, 'Laptop'],
  [/phone|cell|telecom/i, 'Phone'],
  [/gym|fitness|exercise|sport/i, 'Dumbbell'],
  [/clean|housekeep|laundr/i, 'Sparkles'],
  [/pet|dog|cat|vet/i, 'PawPrint'],
  [/shop|store|retail|gift shop/i, 'Store'],
  [/volunteer|hachnos|bikur/i, 'HandHeart'],
  [/business|service|profession/i, 'BriefcaseBusiness'],
  [/communit|organi[sz]ation|shuls/i, 'Users'],
];

export function guessIcon(name) {
  for (const [pattern, icon] of GUESSES) if (pattern.test(String(name || ''))) return icon;
  return 'MoreHorizontal';
}
