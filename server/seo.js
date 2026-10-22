// Server-rendered pages for the public surface.
//
// The app is a single-page React app: every route used to return the same
// shell with the same title, and a crawler landing on a listing saw an empty
// <div id="root">. Search is how a directory is found, so the public routes —
// a listing, a company, the directory itself — are served from here instead:
// the same shell, with this page's title, description, canonical URL, social
// tags and schema.org data filled in, and the listing's own text inside the
// root element. React replaces that text when it mounts, so a person sees the
// app and a crawler sees the content.
//
// Everything else still falls through to the static shell.
import { store } from './db.js';
import { vouchesEnabled } from './settings.js';
import { slugify } from './seo-shared.js';
import { categoryLabel } from '../src/lib/categories.js';
import { isScheduled } from '../src/lib/scheduledPosts.js';

const SITE_NAME = 'Klal Connect';
const TAGLINE = 'Community resources & business directory';
const DEFAULT_DESCRIPTION = 'Klal Connect is a community-powered platform for finding trusted Jewish professionals, businesses, and resources near you.';
// The homepage says something more specific than the site-wide description:
// it names what someone can actually expect to find.
const HOME_DESCRIPTION = 'Find businesses, gemachim, shuls, and everyday help across Jewish communities.';

export const siteOrigin = (req) => {
  const host = req.get('x-forwarded-host') || req.get('host') || 'klalconnect.org';
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(host);
  const proto = req.get('x-forwarded-proto') || (local ? 'http' : 'https');
  return `${proto}://${host}`;
};

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// JSON-LD sits in a <script>, where only the closing tag and HTML comments can
// break out.
const jsonLd = (data) => JSON.stringify(data).replace(/</g, '\\u003c');
const clamp = (s, n) => {
  const text = String(s ?? '').replace(/\s+/g, ' ').trim();
  return text.length <= n ? text : `${text.slice(0, n - 1).trimEnd()}…`;
};

// Replaces the head tags Vite ships with this page's own, so nothing is
// duplicated, and drops the content into the root element.
export function renderPage(shell, { title, description, canonical, image, type = 'website', schema, body = '', noindex = false }) {
  const head = [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(description)}" />`,
    `<link rel="canonical" href="${escapeHtml(canonical)}" />`,
    noindex ? '<meta name="robots" content="noindex,follow" />' : '',
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${escapeHtml(description)}" />`,
    `<meta property="og:type" content="${escapeHtml(type)}" />`,
    `<meta property="og:url" content="${escapeHtml(canonical)}" />`,
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    image ? `<meta property="og:image" content="${escapeHtml(image)}" />` : '',
    '<meta name="twitter:card" content="summary_large_image" />',
    `<meta name="twitter:title" content="${escapeHtml(title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(description)}" />`,
    image ? `<meta name="twitter:image" content="${escapeHtml(image)}" />` : '',
    schema ? `<script type="application/ld+json">${jsonLd(schema)}</script>` : '',
  ].filter(Boolean).join('\n    ');

  return shell
    // Strip the shell's static title/description/social tags; ours replace them.
    .replace(/\s*<title>[\s\S]*?<\/title>/i, '')
    .replace(/\s*<meta\s+name="description"[^>]*>/gi, '')
    .replace(/\s*<meta\s+property="og:[^"]*"[^>]*>/gi, '')
    .replace(/\s*<meta\s+name="twitter:[^"]*"[^>]*>/gi, '')
    .replace('</head>', `  ${head}\n  </head>`)
    .replace('<div id="root"></div>', `<div id="root">${body}</div>`);
}

const addressOf = (p) => [p.address, p.city, p.state, p.zip].filter(Boolean).join(', ');

// A listing, as schema.org sees it. LocalBusiness is the type search engines
// use for the "near me" results this directory wants to appear in.
function providerSchema(provider, url, image) {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: provider.name,
    url,
    description: clamp(provider.description || provider.short_description, 500) || undefined,
    image: image || undefined,
    telephone: provider.phone || undefined,
    email: provider.email || undefined,
    areaServed: (provider.service_areas || []).length ? provider.service_areas : undefined,
    knowsLanguage: (provider.languages || []).length ? provider.languages : undefined,
    openingHours: provider.hours || undefined,
    additionalType: categoryLabel(provider.category) || undefined,
  };
  if (provider.city || provider.address) {
    schema.address = {
      '@type': 'PostalAddress',
      streetAddress: provider.address || undefined,
      addressLocality: provider.city || undefined,
      addressRegion: provider.state || undefined,
      postalCode: provider.zip || undefined,
    };
  }
  if (provider.latitude != null && provider.longitude != null) {
    schema.geo = { '@type': 'GeoCoordinates', latitude: provider.latitude, longitude: provider.longitude };
  }
  if (provider.website) schema.sameAs = [provider.website];
  return schema;
}

// The text a crawler reads. Deliberately plain: React throws it away on mount,
// so it exists to be parsed, not styled.
function providerBody(provider, notes, vouches) {
  const facts = [
    ['Category', [provider.category, provider.subcategory].filter(Boolean).map(categoryLabel).join(' · ')],
    ['Location', addressOf(provider)],
    ['Serves', (provider.service_areas || []).join(', ')],
    ['Languages', (provider.languages || []).join(', ')],
    ['Hours', provider.hours],
    ['Phone', provider.phone],
    ['Website', provider.website],
    ['Vouched for by', vouches ? `${vouches} community ${vouches === 1 ? 'member' : 'members'}` : ''],
  ].filter(([, v]) => v);
  return [
    `<h1>${escapeHtml(provider.name)}</h1>`,
    provider.tagline ? `<p>${escapeHtml(provider.tagline)}</p>` : '',
    provider.short_description ? `<p>${escapeHtml(provider.short_description)}</p>` : '',
    provider.description ? `<p>${escapeHtml(provider.description)}</p>` : '',
    facts.length ? `<dl>${facts.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('')}</dl>` : '',
    notes.length ? `<h2>What the community says</h2>${notes.map((n) => `<blockquote>${escapeHtml(n.body)}</blockquote>`).join('')}` : '',
  ].filter(Boolean).join('\n');
}

const isPublished = (row) => row.status === 'published' || row.status === undefined;

// Oldest first on a tie. The slug is server-owned now, but rows written
// before that could share one, and the default order is newest-first — which
// is the wrong way round: it hands the URL to whoever took it last.
const firstBySlug = (rows) => (rows || []).slice().sort((x, y) => Date.parse(x.created_date || 0) - Date.parse(y.created_date || 0))[0];

async function findProvider(slugOrId) {
  const bySlug = firstBySlug(await store.filter('Provider', { slug: slugOrId }));
  if (bySlug) return bySlug;
  return store.get('Provider', slugOrId);
}

async function findCompany(slugOrId) {
  const bySlug = firstBySlug(await store.filter('Company', { slug: slugOrId }));
  if (bySlug) return bySlug;
  return store.get('Company', slugOrId);
}

// Mounted for the public routes only; anything private keeps the plain shell,
// which is also why those pages carry noindex.
export function mountSeo(app, shell) {
  if (!shell) return;
  const ogFallback = (origin) => `${origin}/brand/og-image.jpg`;

  // A path that reaches the function but matches nothing. It still has to
  // return the app — these prefixes are rewritten to the function, so there
  // is no static shell behind them to fall through to — with a 404 status
  // and noindex, and the app renders its own not-found screen.
  const notFound = (req, res) => {
    const origin = siteOrigin(req);
    res.status(404);
    send(res, renderPage(shell, {
      title: `Page not found · ${SITE_NAME}`,
      description: DEFAULT_DESCRIPTION,
      canonical: `${origin}${req.path}`,
      noindex: true,
    }));
  };

  const send = (res, html) => {
    // A listing changes when its owner edits it, so the HTML is cached only
    // briefly at the edge and revalidated in the background.
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400');
    res.send(html);
  };

  app.get(['/provider/:slug', '/gemach/:slug'], async (req, res, next) => {
    try {
      const origin = siteOrigin(req);
      const provider = await findProvider(req.params.slug);
      if (!provider || !isPublished(provider)) {
        // 404, not 200. A listing that does not exist must not answer "this page
        // is fine" — that is a soft 404, which keeps dead URLs looking alive to
        // crawlers and wastes crawl budget on them. send() keeps whatever status
        // is already set, and the body still hydrates, so an owner opening their
        // own unpublished row is unaffected.
        res.status(404);
        return send(res, renderPage(shell, {
          title: `Listing not found · ${SITE_NAME}`,
          description: DEFAULT_DESCRIPTION,
          canonical: `${origin}${req.path}`,
          noindex: true,
        }));
      }
      const canonicalPath = `/${(provider.category || '').toLowerCase().includes('gemach') ? 'gemach' : 'provider'}/${provider.slug || provider.id}`;
      // Switched off from the admin area: crawlers read neither, same as people.
      const showVouches = await vouchesEnabled();
      const [notes, vouchCount] = showVouches ? await Promise.all([
        store.filter('CommunityNote', { provider_id: provider.id, status: 'published' }).catch(() => []),
        store.count('Vouch', { provider_id: provider.id }).catch(() => 0),
      ]) : [[], 0];
      const where = [provider.city, provider.state].filter(Boolean).join(', ');
      const title = `${provider.name}${provider.category ? ` — ${categoryLabel(provider.category)}` : ''}${where ? ` in ${where}` : ''} · ${SITE_NAME}`;
      const description = clamp(provider.tagline || provider.short_description || provider.description || `${provider.name} on Klal Connect.`, 155);
      const image = provider.logo_url || (provider.image_urls || [])[0] || ogFallback(origin);
      const canonical = `${origin}${canonicalPath}`;
      send(res, renderPage(shell, {
        title, description, canonical, image, type: 'profile',
        schema: providerSchema(provider, canonical, image),
        body: providerBody(provider, notes.slice(0, 5), vouchCount),
      }));
    } catch (err) { next(err); }
  });

  app.get('/company/:slug', async (req, res, next) => {
    try {
      const origin = siteOrigin(req);
      const company = await findCompany(req.params.slug);
      if (!company || !isPublished(company)) {
        // 404, not 200. A company page that does not exist must not answer "this page
        // is fine" — that is a soft 404, which keeps dead URLs looking alive to
        // crawlers and wastes crawl budget on them. send() keeps whatever status
        // is already set, and the body still hydrates, so an owner opening their
        // own unpublished row is unaffected.
        res.status(404);
        return send(res, renderPage(shell, { title: `Company not found · ${SITE_NAME}`, description: DEFAULT_DESCRIPTION, canonical: `${origin}${req.path}`, noindex: true }));
      }
      const canonical = `${origin}/company/${company.slug || company.id}`;
      const description = clamp(company.tagline || company.about || `${company.name} on Klal Connect.`, 155);
      const image = company.logo_url || ogFallback(origin);
      send(res, renderPage(shell, {
        title: `${company.name}${company.industry ? ` — ${company.industry}` : ''} · ${SITE_NAME}`,
        description, canonical, image, type: 'profile',
        schema: {
          '@context': 'https://schema.org', '@type': 'Organization',
          name: company.name, url: canonical, description: clamp(company.about, 500) || undefined,
          logo: company.logo_url || undefined, telephone: company.phone || undefined,
          sameAs: company.website ? [company.website] : undefined,
          address: company.city ? { '@type': 'PostalAddress', addressLocality: company.city, addressRegion: company.state || undefined } : undefined,
        },
        body: [
          `<h1>${escapeHtml(company.name)}</h1>`,
          company.tagline ? `<p>${escapeHtml(company.tagline)}</p>` : '',
          company.about ? `<p>${escapeHtml(company.about)}</p>` : '',
        ].filter(Boolean).join('\n'),
      }));
    } catch (err) { next(err); }
  });

  // The directory itself, and a category view under it. Both list real
  // listings in the HTML so the page is worth crawling.
  app.get(['/directory', '/directory/:category', '/directory/:category/:city'], async (req, res, next) => {
    try {
      const origin = siteOrigin(req);
      const { category, city } = req.params;
      const all = (await store.list('Provider')).filter(isPublished);
      const categories = await store.list('Category').catch(() => []);
      const match = category ? categories.find((c) => slugify(c.name) === category) : null;
      if (category && !match) return notFound(req, res);
      const cityName = city ? city.replace(/-/g, ' ') : '';
      // Matched as slugs so the round trip holds: slugify('Brooklyn, NY') is
      // 'brooklyn-ny', and replacing dashes with spaces cannot put the comma
      // back, so the sitemap was advertising URLs that matched no listing.
      const rows = all.filter((p) =>
        (!match || (p.category || '').toLowerCase() === match.name.toLowerCase())
        && (!city || slugify(p.city || '') === city));
      const where = cityName ? ` in ${cityName.replace(/\b\w/g, (m) => m.toUpperCase())}` : '';
      const what = match ? categoryLabel(match.name) : 'Community resources';
      const canonical = `${origin}${req.path.replace(/\/$/, '')}`;
      send(res, renderPage(shell, {
        title: `${what}${where} · ${SITE_NAME}`,
        description: match
          ? clamp(`${categoryLabel(match.name)}${where} — ${rows.length} ${await vouchesEnabled() ? 'vouched-for ' : ''}${rows.length === 1 ? 'listing' : 'listings'} in the Klal Connect community directory.`, 155)
          : DEFAULT_DESCRIPTION,
        canonical,
        image: ogFallback(origin),
        // Thin pages are worse than no pages: an empty category is followed
        // for its links but kept out of the index.
        noindex: rows.length === 0,
        schema: rows.length ? {
          '@context': 'https://schema.org', '@type': 'ItemList',
          itemListElement: rows.slice(0, 50).map((p, i) => ({
            '@type': 'ListItem', position: i + 1, name: p.name,
            url: `${origin}/provider/${p.slug || p.id}`,
          })),
        } : undefined,
        body: [
          `<h1>${escapeHtml(what)}${escapeHtml(where)}</h1>`,
          `<p>${escapeHtml(DEFAULT_DESCRIPTION)}</p>`,
          rows.length
            ? `<ul>${rows.slice(0, 100).map((p) => `<li><a href="/provider/${escapeHtml(p.slug || p.id)}">${escapeHtml(p.name)}</a>${p.city ? ` — ${escapeHtml(p.city)}` : ''}${p.short_description ? `: ${escapeHtml(clamp(p.short_description, 120))}` : ''}</li>`).join('')}</ul>`
            : '<p>No listings here yet.</p>',
          categories.length
            ? `<h2>Categories</h2><ul>${categories.map((c) => `<li><a href="/directory/${slugify(c.name)}">${escapeHtml(categoryLabel(c.name))}</a></li>`).join('')}</ul>`
            : '',
        ].filter(Boolean).join('\n'),
      }));
    } catch (err) { next(err); }
  });

  app.get('/', async (req, res, next) => {
    try {
      const origin = siteOrigin(req);
      const categories = await store.list('Category').catch(() => []);
      send(res, renderPage(shell, {
        title: `${SITE_NAME} — ${TAGLINE}`,
        // The homepage's own description, not the site-wide one: the snippet a
        // search result shows should say what this page actually says.
        description: HOME_DESCRIPTION,
        canonical: `${origin}/`,
        image: ogFallback(origin),
        schema: {
          '@context': 'https://schema.org', '@type': 'WebSite',
          name: SITE_NAME, url: `${origin}/`, description: DEFAULT_DESCRIPTION,
          potentialAction: {
            '@type': 'SearchAction',
            target: { '@type': 'EntryPoint', urlTemplate: `${origin}/browse?q={search_term_string}` },
            'query-input': 'required name=search_term_string',
          },
        },
        body: [
          // Kept in step with the rendered homepage h1 on purpose: a crawler
          // and a person should be told the same thing about this page.
          '<h1>Your community. Wherever you are.</h1>',
          `<p>${escapeHtml(HOME_DESCRIPTION)}</p>`,
          categories.length ? `<h2>Browse by category</h2><ul>${categories.map((c) => `<li><a href="/directory/${slugify(c.name)}">${escapeHtml(categoryLabel(c.name))}</a></li>`).join('')}</ul>` : '',
        ].filter(Boolean).join('\n'),
      }));
    } catch (err) { next(err); }
  });

  // Everything a person signs in for: served as the plain shell, and kept out
  // of the index because there is nothing there for a search result.
  // Anything else that was routed here: an old link, a typo, a path under a
  // rewritten prefix. Never /api — an unknown endpoint there stays JSON.
  // Express 5 has no bare '*' route, and this has to catch every method-safe
  // request that fell through, so it is a middleware rather than a route.
  const servePage = (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/api/')) return next();
    return notFound(req, res);
  };

  // The privacy policy is public and worth indexing, so it gets its own title
  // rather than inheriting the homepage's.
  app.get('/privacy', (req, res) => {
    const origin = siteOrigin(req);
    send(res, renderPage(shell, {
      title: `Privacy policy · ${SITE_NAME}`,
      description: 'What Klal Connect collects, what it never collects, who can see your profile, and how to delete your account.',
      canonical: `${origin}/privacy`,
      image: ogFallback(origin),
    }));
  });

  // The other public pages linked from the footer, indexed like the privacy
  // policy.
  const STATIC_PAGES = {
    '/terms': ['Terms of use', 'The rules for using Klal Connect: listings, accuracy, claiming or removing a listing, and posting.'],
    '/about': ['About', 'Klal Connect is a community directory and network for the frum community.'],
    '/contact': ['Contact us', 'How to reach Klal Connect, and how to correct, claim or remove a listing.'],
  };
  for (const [path, [label, description]] of Object.entries(STATIC_PAGES)) {
    app.get(path, (req, res) => {
      const origin = siteOrigin(req);
      send(res, renderPage(shell, { title: `${label} · ${SITE_NAME}`, description, canonical: `${origin}${path}`, image: ogFallback(origin) }));
    });
  }

  // People type /signup; the page is /register. Permanent, with the query
  // string kept so a returnTo survives.
  app.get('/signup', (req, res) => {
    const q = req.originalUrl.indexOf('?');
    res.redirect(301, '/register' + (q === -1 ? '' : req.originalUrl.slice(q)));
  });

  // Public, but only worth indexing once there is something on it. Same rule
  // as an empty directory category: followed for its links, kept out of the
  // index until it has content.
  app.get('/companies', async (req, res, next) => {
    try {
      const origin = siteOrigin(req);
      const companies = (await store.list('Company')).filter(isPublished);
      send(res, renderPage(shell, {
        title: `Company pages · ${SITE_NAME}`,
        description: clamp(`${companies.length || 'No'} community company ${companies.length === 1 ? 'page' : 'pages'} on Klal Connect.`, 155),
        canonical: `${origin}/companies`,
        image: ogFallback(origin),
        noindex: companies.length === 0,
        body: companies.length
          ? `<h1>Company pages</h1><ul>${companies.map((c) => `<li><a href="/company/${escapeHtml(c.slug || c.id)}">${escapeHtml(c.name)}</a></li>`).join('')}</ul>`
          : '<h1>Company pages</h1><p>No company pages yet.</p>',
      }));
    } catch (err) { next(err); }
  });

  // A parameterised search view: real title, never indexed. The canonical
  // directory pages are what belong in results.
  app.get('/browse', (req, res) => {
    const origin = siteOrigin(req);
    send(res, renderPage(shell, {
      title: `Search the directory · ${SITE_NAME}`,
      description: DEFAULT_DESCRIPTION,
      canonical: `${origin}/directory`,
      image: ogFallback(origin),
      noindex: true,
    }));
  });

  // Everything a person signs in for, plus the surfaces that are still empty:
  // a real title, and out of the index. /jobs and /post-job belong here until
  // there are jobs; /add and /create-company are forms, never results.
  const PRIVATE = ['/feed', '/people', '/messages', '/messages/:id', '/saved', '/profile', '/profile/:id', '/settings', '/admin', '/welcome', '/login', '/register', '/forgot-password', '/reset-password', '/join/:code', '/jobs', '/jobs/:id', '/post-job', '/add', '/create-company'];
  // A per-path title, so a signed-in page is not eleven copies of the
  // homepage's tab name. Not indexed either way.
  const PRIVATE_TITLES = {
    '/feed': 'Community feed', '/people': 'People', '/messages': 'Messages',
    '/saved': 'Saved resources', '/profile': 'Your profile', '/profile/': 'Member profile', '/settings': 'Settings',
    '/admin': 'Administration', '/welcome': 'Welcome', '/login': 'Log in',
    '/register': 'Create your account', '/forgot-password': 'Reset your password',
    '/reset-password': 'Reset your password', '/jobs': 'Jobs',
    '/post-job': 'Post a job', '/add': 'Add a listing', '/create-company': 'Create a company page',
  };
  // A shared post link (/feed?post=<id>) previews as that post — who wrote
  // it, its first words and its photo — wherever it is pasted: WhatsApp,
  // LinkedIn, a text. Still kept out of the index, like the rest of the feed.
  app.get('/feed', async (req, res, next) => {
    const id = typeof req.query.post === 'string' ? req.query.post : '';
    if (!id) return next();
    try {
      const post = await store.get('FeedPost', id).catch(() => null);
      // A scheduled post is not out yet: its link previews as the plain feed.
      if (!post || isScheduled(post)) return next();
      const origin = siteOrigin(req);
      const author = post.author_name && post.author_name !== 'Guest' ? post.author_name : 'A community member';
      const words = post.body || post.repost_body || '';
      send(res, renderPage(shell, {
        title: `${author} on ${SITE_NAME}`,
        description: clamp(words, 155) || DEFAULT_DESCRIPTION,
        canonical: `${origin}/feed?post=${encodeURIComponent(post.id)}`,
        image: (post.image_urls || [])[0] || (post.repost_image_urls || [])[0] || ogFallback(origin),
        type: 'article',
        noindex: true,
      }));
    } catch (err) { next(err); }
  });

  app.get(PRIVATE, (req, res) => {
    const origin = siteOrigin(req);
    // Exact path first, then "/profile/" for a path with a segment after it
    // (someone else's profile is not "Your profile"), then the bare prefix.
    const base = `/${req.path.split('/')[1] || ''}`;
    const nested = req.path.split('/').length > 2 ? `${base}/` : '';
    const label = PRIVATE_TITLES[req.path] || (nested && PRIVATE_TITLES[nested]) || PRIVATE_TITLES[base];
    send(res, renderPage(shell, {
      title: label ? `${label} · ${SITE_NAME}` : `${SITE_NAME} — ${TAGLINE}`,
      description: DEFAULT_DESCRIPTION,
      canonical: `${origin}${req.path}`,
      image: ogFallback(origin),
      noindex: true,
    }));
  });

  app.use(servePage);
}

// ------------------------------------------------------------- sitemap --

export async function sitemap(origin) {
  const [providers, companies, categories] = await Promise.all([
    store.list('Provider').catch(() => []),
    store.list('Company').catch(() => []),
    store.list('Category').catch(() => []),
  ]);
  const published = providers.filter(isPublished);
  const publishedCompanies = companies.filter(isPublished);
  const urls = [
    { loc: `${origin}/`, changefreq: 'daily', priority: '1.0' },
    { loc: `${origin}/directory`, changefreq: 'daily', priority: '0.9' },
    { loc: `${origin}/privacy`, changefreq: 'yearly', priority: '0.2' },
    { loc: `${origin}/terms`, changefreq: 'yearly', priority: '0.2' },
    { loc: `${origin}/about`, changefreq: 'yearly', priority: '0.3' },
    { loc: `${origin}/contact`, changefreq: 'yearly', priority: '0.2' },
  ];

  // /companies is served noindex while it has nothing on it — "kept out of the
  // index until it has content", as the handler says. Listing it here anyway
  // asked a crawler to fetch a page we then tell it to ignore, which is the
  // same contradiction the category rule below exists to avoid. This was the
  // one page that did not follow it.
  if (publishedCompanies.length) {
    urls.push({ loc: `${origin}/companies`, changefreq: 'weekly', priority: '0.6' });
  }

  // Only categories that actually have listings — an empty page is not worth
  // a crawl, and telling a search engine otherwise costs trust.
  const counts = new Map();
  for (const p of published) {
    const key = (p.category || '').toLowerCase();
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  }
  for (const c of categories) {
    if (!counts.get((c.name || '').toLowerCase())) continue;
    urls.push({ loc: `${origin}/directory/${slugify(c.name)}`, changefreq: 'weekly', priority: '0.7' });
  }

  // Category + city, where a real cluster of listings exists.
  const cityCounts = new Map();
  for (const p of published) {
    if (!p.category || !p.city) continue;
    const key = `${slugify(p.category)}/${slugify(p.city)}`;
    cityCounts.set(key, (cityCounts.get(key) || 0) + 1);
  }
  for (const [key, n] of cityCounts) {
    if (n < 2) continue;
    urls.push({ loc: `${origin}/directory/${key}`, changefreq: 'weekly', priority: '0.7' });
  }

  for (const p of published) {
    const seg = (p.category || '').toLowerCase().includes('gemach') ? 'gemach' : 'provider';
    urls.push({ loc: `${origin}/${seg}/${p.slug || p.id}`, lastmod: p.updated_date, changefreq: 'weekly', priority: '0.8' });
  }
  for (const c of companies.filter(isPublished)) {
    urls.push({ loc: `${origin}/company/${c.slug || c.id}`, lastmod: c.updated_date, changefreq: 'monthly', priority: '0.5' });
  }

  const iso = (d) => { try { return new Date(d).toISOString().slice(0, 10); } catch { return null; } };
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${escapeHtml(u.loc)}</loc>${u.lastmod && iso(u.lastmod) ? `<lastmod>${iso(u.lastmod)}</lastmod>` : ''}<changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`).join('\n')}\n</urlset>\n`;
}

export function robots(origin) {
  return [
    'User-agent: *',
    'Allow: /',
    // Nothing here is a search result: signed-in surfaces and one-time links.
    'Disallow: /admin',
    'Disallow: /settings',
    'Disallow: /messages',
    'Disallow: /feed',
    'Disallow: /people',
    'Disallow: /saved',
    'Disallow: /add',
    'Disallow: /welcome',
    'Disallow: /join/',
    'Disallow: /reset-password',
    'Disallow: /api/',
    '',
    `Sitemap: ${origin}/sitemap.xml`,
    '',
  ].join('\n');
}
