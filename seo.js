const { esc } = require('./util');

const ORIGIN = 'https://www.hoteldayclub.com.au';
const BRAND = 'Hotel Day Club';
const SUFFIX = ' · ' + BRAND;
const DEFAULT_IMAGE = ORIGIN + '/assets/og-image-1200x630.png';
const LOGO = ORIGIN + '/assets/android-chrome-512.png';
const PUBLISHED = '2026-10-24';

const PAGES = {
  home: {
    path: '/',
    title: 'Hotel day passes in Australia',
    description: 'Book a hotel pool, spa or gym for the day in Australia, no room needed. We\'re launching soon, so join the waitlist.',
  },
  hotels: {
    path: '/for-hotels',
    title: 'List a hotel pool in Australia',
    description: 'List a hotel pool, gym or spa for local day guests in Australia. You set the hours, the prices and how many people you take.',
  },
  how: {
    path: '/how-it-works',
    title: 'How hotel day passes work',
    description: 'How a hotel day pass works in Australia: choose a pool, gym or spa, book the day, and check in at the desk. No room needed.',
  },
  faq: {
    path: '/faq',
    title: 'Hotel day pass questions',
    description: 'Answers about hotel day passes in Australia: cancellation, what to bring, age rules, and how to contact Hotel Day Club.',
  },
  contact: {
    path: '/contact',
    title: 'Contact us',
    description: 'Send a message to Hotel Day Club about a booking, a change, a cancellation or a hotel in Australia. We\'ll reply by email.',
  },
  privacy: {
    path: '/privacy',
    title: 'Privacy policy',
    crumb: 'Privacy policy',
    description: 'How Hotel Day Club handles personal information for day-pass bookings, the waitlist and site analytics in Australia.',
  },
  terms: {
    path: '/terms',
    title: 'Customer terms',
    crumb: 'Customer terms',
    description: 'Customer terms for booking a hotel pool, gym or spa day pass with Hotel Day Club in Australia. Draft, pending legal review.',
  },
  refunds: {
    path: '/refunds',
    title: 'Cancellation and refunds',
    crumb: 'Cancellation and refunds',
    description: 'Cancellation and refund rules for a Hotel Day Club day pass, including the 24-hour window and hotel closures.',
  },
  risk: {
    path: '/risk',
    title: 'Guest risk warning',
    crumb: 'Risk warning',
    description: 'Guest risk warning for a hotel pool, gym or spa day pass booked with Hotel Day Club. Draft, pending legal review.',
  },
  guides: {
    path: '/guides',
    title: 'Hotel day pass guides',
    description: 'Short guides to hotel day passes in Australia: what a day pass is, and how to choose a pool, gym or spa for the day.',
  },
};

const GUIDES = [
  {
    slug: 'what-is-a-hotel-day-pass',
    h1: 'What is a hotel day pass?',
    title: 'What is a hotel day pass?',
    description: 'A hotel day pass is a day at a hotel pool, gym or spa without booking a room. Here is how that works in Australia.',
    paras: [
      'A hotel day pass is time at a hotel without an overnight stay. You book the pool, the gym, the spa or a daybed for set hours, then check in at the desk.',
      'The hotel decides what is included. One listing might be a lounger and a towel. Another might add a gym session or a treatment. The page should say which, and it should show the price before you confirm.',
      'Hotel Day Club is a way to find those passes across Australia. We are the booking side. The hotel still runs the pool, sets the rules and takes the guest on the day.',
      'This website is a demo. The hotels you can open today are fictional examples with stock photos. They are not partners, and a booking on this site does not take a payment. Join the waitlist if you want a note when a real pass is available near you.',
    ],
  },
  {
    slug: 'how-to-choose-a-hotel-pool-day-pass',
    h1: 'How to choose a hotel pool day pass',
    title: 'How to choose a hotel pool day pass',
    description: 'How to choose a hotel pool day pass in Australia: hours, what is included, who can come, and what the listing should spell out.',
    paras: [
      'Start with the hours. A day pass is not a room, and it is not the whole day unless the hotel says so. The listing should show when you can arrive and when you have to leave.',
      'Read what is included before you compare prices. Pool, gym, spa, towel, parking and food credit are different things. A lower price that leaves them out is not the same pass.',
      'Check who can come. The person booking needs to be 18 or over. Each hotel sets its own age rule and kids’ hours, and those belong on the listing and in the risk warning.',
      'Look at the pool itself. Indoor or outdoor, heated or not, and whether rain on its own closes it. Rain is not a closure by itself. If the hotel closes the facility, the refund page is the place that explains the choice you get.',
      'We do not publish star ratings or review counts. Use the hours, the inclusions and the price on the page. On this demo, treat every hotel as an example. The photos are stock, and no real booking is taken.',
    ],
  },
];

function siteIndexable() {
  if (!Object.prototype.hasOwnProperty.call(process.env, 'SITE_INDEXABLE')) return true;
  const raw = String(process.env.SITE_INDEXABLE).trim();
  if (!raw) return true;
  return !/^(0|false|off|no)$/i.test(raw);
}

function legalPagesIndexable() {
  const raw = String(process.env.LEGAL_PAGES_INDEXABLE || '').trim();
  if (!raw) return false;
  return /^(1|true|on|yes)$/i.test(raw);
}

function robotsContent(index) {
  if (!siteIndexable()) return 'noindex, nofollow';
  if (index === 'follow') return 'noindex, follow';
  if (index === false) return 'noindex, nofollow';
  return 'index, follow';
}

function fullTitle(lead) {
  let text = String(lead || '').replace(/\s+/g, ' ').trim();
  if (!text) text = BRAND;
  if (text === BRAND || text.endsWith(SUFFIX)) {
    return text.length <= 60 ? text : text.slice(0, 59).trimEnd() + '…';
  }
  const max = 60 - SUFFIX.length;
  if (text.length > max) text = text.slice(0, max - 1).trimEnd() + '…';
  const out = text + SUFFIX;
  return out.length <= 60 ? out : out.slice(0, 59).trimEnd() + '…';
}

function clampDesc(s) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (t.length <= 155) return t;
  return t.slice(0, 154).trimEnd() + '…';
}

function absolute(p) {
  if (!p) return ORIGIN + '/';
  if (/^https?:\/\//i.test(p)) return p.split('?')[0];
  const path = p.startsWith('/') ? p : '/' + p;
  return ORIGIN + path.split('?')[0];
}

function shortName(name) {
  return String(name || '').replace(/\s*\(Demo\)\s*$/i, '').trim();
}

function listingTitle(name) {
  return fullTitle(shortName(name) + ' day pass');
}

function listingDescription(h) {
  const name = shortName(h.name);
  const demo = Number(h.is_demo) === 1;
  const text = demo
    ? `${name} is a fictional example in ${h.area}. Stock photos. No real booking is taken on this demo.`
    : `${h.tagline}. Book a day pass at ${name} in ${h.area}, Australia.`;
  return clampDesc(text);
}

function pageCopy(key) {
  const page = PAGES[key];
  if (!page) return null;
  return {
    path: page.path,
    documentTitle: fullTitle(page.title),
    description: clampDesc(page.description),
    crumb: page.crumb || page.title,
  };
}

function crumbs(items) {
  const list = [{ name: 'Home', path: '/' }, ...items];
  return {
    '@type': 'BreadcrumbList',
    itemListElement: list.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: absolute(item.path),
    })),
  };
}

function graph(...nodes) {
  return { '@context': 'https://schema.org', '@graph': nodes.filter(Boolean) };
}

function homeJsonLd(email) {
  return graph(
    {
      '@type': 'Organization',
      name: BRAND,
      url: ORIGIN + '/',
      logo: LOGO,
      email,
      contactPoint: {
        '@type': 'ContactPoint',
        email,
        contactType: 'customer support',
        areaServed: 'AU',
      },
    },
    { '@type': 'WebSite', name: BRAND, url: ORIGIN + '/' },
  );
}

function listingJsonLd(h, { from, image }) {
  const demo = Number(h.is_demo) === 1;
  const name = shortName(h.name);
  const path = '/h/' + h.slug;
  const nodes = [crumbs([{ name, path }])];
  if (!demo) {
    nodes.push({
      '@type': 'LodgingBusiness',
      name,
      url: absolute(path),
      image,
      address: { '@type': 'PostalAddress', addressLocality: h.area, addressCountry: 'AU' },
    });
    nodes.push({
      '@type': 'Product',
      name: name + ' day pass',
      image,
      url: absolute(path),
      offers: {
        '@type': 'Offer',
        price: String(from || 0),
        priceCurrency: 'AUD',
        url: absolute(path),
        availability: 'https://schema.org/InStock',
      },
    });
  }
  return graph(...nodes);
}

function articleJsonLd(guide) {
  const path = '/guides/' + guide.slug;
  return graph(
    crumbs([{ name: 'Guides', path: '/guides' }, { name: guide.h1, path }]),
    {
      '@type': 'Article',
      headline: guide.h1,
      datePublished: PUBLISHED,
      dateModified: PUBLISHED,
      image: DEFAULT_IMAGE,
      author: { '@type': 'Organization', name: BRAND, url: ORIGIN + '/' },
      publisher: {
        '@type': 'Organization',
        name: BRAND,
        url: ORIGIN + '/',
        logo: { '@type': 'ImageObject', url: LOGO },
      },
      mainEntityOfPage: absolute(path),
    },
  );
}

function jsonLdScript(data) {
  if (!data) return '';
  const json = JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028');
  return `<script type="application/ld+json">${json}</script>`;
}

function verificationTags() {
  const bits = [];
  const g = String(process.env.GOOGLE_SITE_VERIFICATION || '').trim();
  const b = String(process.env.BING_SITE_VERIFICATION || '').trim();
  if (/^[A-Za-z0-9_-]{6,128}$/.test(g)) bits.push(`<meta name="google-site-verification" content="${g}">`);
  if (/^[A-Za-z0-9_-]{6,128}$/.test(b)) bits.push(`<meta name="msvalidate.01" content="${b}">`);
  return bits.join('');
}

function headMeta({ documentTitle, description, robots, canonicalUrl, image, imageAlt, imageWidth, imageHeight, jsonld, ogType = 'website' }) {
  const title = esc(documentTitle || fullTitle(BRAND));
  const desc = clampDesc(description || '');
  const img = image || DEFAULT_IMAGE;
  const bits = [
    `<title>${title}</title>`,
    desc ? `<meta name="description" content="${esc(desc)}">` : '',
    `<meta name="robots" content="${esc(robots || 'noindex, nofollow')}">`,
    '<meta name="theme-color" content="#0E1E3A">',
    canonicalUrl ? `<link rel="canonical" href="${esc(canonicalUrl)}">` : '',
    '<link rel="icon" href="/favicon.ico" sizes="48x48">',
    '<link rel="icon" href="/assets/hdc-icon.svg" type="image/svg+xml">',
    '<link rel="icon" href="/assets/favicon-32.png" type="image/png" sizes="32x32">',
    '<link rel="icon" href="/assets/favicon-16.png" type="image/png" sizes="16x16">',
    '<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">',
    '<link rel="manifest" href="/site.webmanifest">',
    `<meta property="og:locale" content="en_AU">`,
    `<meta property="og:site_name" content="${esc(BRAND)}">`,
    `<meta property="og:type" content="${esc(ogType)}">`,
    `<meta property="og:title" content="${title}">`,
    desc ? `<meta property="og:description" content="${esc(desc)}">` : '',
    canonicalUrl ? `<meta property="og:url" content="${esc(canonicalUrl)}">` : '',
    `<meta property="og:image" content="${esc(img)}">`,
    imageWidth ? `<meta property="og:image:width" content="${Number(imageWidth)}">` : '',
    imageHeight ? `<meta property="og:image:height" content="${Number(imageHeight)}">` : '',
    `<meta property="og:image:alt" content="${esc(imageAlt || 'Hotel day passes for a pool, gym or spa')}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${title}">`,
    desc ? `<meta name="twitter:description" content="${esc(desc)}">` : '',
    `<meta name="twitter:image" content="${esc(img)}">`,
    verificationTags(),
    jsonLdScript(jsonld),
  ];
  return bits.filter(Boolean).join('');
}

function robotsTxt() {
  if (!siteIndexable()) return 'User-agent: *\nAllow: /favicon.ico\nDisallow: /\n';
  return [
    'User-agent: *',
    'Allow: /favicon.ico',
    'Allow: /',
    'Disallow: /admin',
    'Disallow: /hotel',
    'Disallow: /checkout',
    'Disallow: /api',
    'Disallow: /booking/',
    'Disallow: /healthz',
    'Sitemap: ' + ORIGIN + '/sitemap.xml',
    '',
  ].join('\n');
}

function sitemapDocument(urls) {
  const body = urls.map(u => `  <url><loc>${xml(u.loc)}</loc><lastmod>${xml(u.lastmod)}</lastmod></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

function xml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

const CANONICAL_HOSTS = new Set(['hoteldayclub.com.au', 'www.hoteldayclub.com.au']);

function canonicalRedirect(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const pathOnly = String(req.path || '').split('?')[0];
  if (pathOnly === '/healthz') return next();
  const host = String(req.headers.host || '').replace(/:\d+$/, '').toLowerCase();
  if (host === 'hotel-day-club.onrender.com') return res.redirect(301, ORIGIN + req.originalUrl);
  if (!CANONICAL_HOSTS.has(host)) return next();
  const proto = String(req.get('x-forwarded-proto') || req.protocol || '').split(',')[0].trim().toLowerCase();
  if (host === 'www.hoteldayclub.com.au' && proto === 'https') return next();
  res.redirect(301, ORIGIN + req.originalUrl);
}

function plain(html) {
  return String(html).replace(/<[^>]+>/g, '');
}

function faqItems(mailHtml, mailText) {
  return [
    { q: 'Is this a real booking site?', html: 'No. This is a demo. Listings are examples. No real bookings or payments are taken.' },
    { q: 'Are these real hotels?', html: 'No. The example listings use neighbourhood names in Australia. They are not participating hotels, and the photos are stock photos.' },
    { q: 'Can I cancel for free?', html: 'Yes, if you cancel at least 24 hours before your access hours start. Checkout and your confirmation show the time for the date you chose. If you book inside that 24 hours, there is no free-cancellation window. A free date change may be available once, subject to availability. If the hotel closes or limits the facility you booked, you choose a full refund or a free rebooking. Nothing in the policy limits your rights under the Australian Consumer Law.' },
    { q: 'What if it rains?', html: 'Rain on its own is not a closure. The listing says whether the pool is indoor, outdoor, heated or unheated. If the hotel decides to close, you get the choice above.' },
    { q: 'Who can book, and can children come?', html: "The person booking needs to be 18 or over. Each hotel sets its own age rules and kids' hours. They are on the listing and in the risk warning before you pay. An adult on the booking supervises each child." },
    { q: 'What do I accept at checkout?', html: 'Three separate boxes: the hotel\'s pool rules, the <a href="/terms">customer terms</a> (including the <a href="/refunds">refund policy</a> and <a href="/privacy">privacy notice</a>), and the <a href="/risk">risk warning</a> for that hotel. The warning is shown in full on checkout. Marketing email is optional and is not required.' },
    { q: 'What are the hours?', html: 'Each hotel sets its own hours. A day pass is not sold past the time a room-guests-only period starts. Late access, where a hotel offers it, starts only after that period ends and stops when the pool closes.' },
    { q: 'What should I bring?', html: 'Swimwear, and sunscreen if the pool is outdoors. The listing says if a towel is included and if photo ID is required.' },
    { q: 'Do you sell gift cards or pass packs?', html: "Not on this demo. If we offer gift cards later, they'll be valid for at least 3 years from purchase." },
    { q: 'Do you show ratings or reviews?', html: 'No. Listings say New. This site does not publish star ratings or review counts.' },
    { q: 'How do I contact you?', html: `Email ${mailHtml} for a booking, a complaint, or a privacy request.`, text: `Email ${mailText} for a booking, a complaint, or a privacy request.` },
  ];
}

function faqHtml(mailHtml) {
  const blocks = faqItems(mailHtml).map((item, i) => `<details${i === 0 ? ' open' : ''}><summary>${esc(item.q)}</summary><p>${item.html}</p></details>`).join('\n');
  return `<div class="wrap sec"><h1 class="l-title">Hotel day pass questions</h1>
<p class="lead">Short answers, in line with the <a href="/terms">customer terms</a> and the <a href="/refunds">cancellation and refund policy</a>. Both of those pages are drafts.</p>
<div class="faq">
${blocks}
</div>
<p>For a booking, a change or a cancellation, use the <a href="/contact">contact form</a>.</p></div>`;
}

function faqJsonLd(mailText) {
  const mainEntity = faqItems('', mailText).map(item => ({
    '@type': 'Question',
    name: item.q,
    acceptedAnswer: { '@type': 'Answer', text: item.text || plain(item.html) },
  }));
  const copy = pageCopy('faq');
  return graph(crumbs([{ name: 'Hotel day pass questions', path: copy.path }]), { '@type': 'FAQPage', mainEntity });
}

function guideBySlug(slug) {
  return GUIDES.find(g => g.slug === slug) || null;
}

function guideIndexHtml() {
  const cards = GUIDES.map(g => `<article class="fh-card"><h2><a href="/guides/${g.slug}">${esc(g.h1)}</a></h2><p>${esc(g.description)}</p></article>`).join('');
  return `<div class="wrap sec"><h1 class="l-title">Hotel day pass guides</h1>
<p class="lead">Two short notes on day passes in Australia. No rankings, and no hotels named as partners.</p>
<div class="fh-grid">${cards}</div></div>`;
}

function guideHtml(guide) {
  const body = guide.paras.map(p => `<p>${esc(p)}</p>`).join('');
  return `<div class="wrap sec"><p class="eyebrow-s"><a href="/guides">Guides</a></p>
<h1 class="l-title">${esc(guide.h1)}</h1>
<p class="lead">${esc(guide.description)}</p>
${body}
<p><a href="/how-it-works">How day passes work</a> · <a href="/faq">Questions</a></p></div>`;
}

module.exports = {
  ORIGIN, DEFAULT_IMAGE, LOGO, PAGES, GUIDES,
  siteIndexable, legalPagesIndexable, robotsContent, fullTitle, clampDesc, absolute, shortName,
  listingTitle, listingDescription, pageCopy, crumbs, graph, homeJsonLd, listingJsonLd, articleJsonLd,
  headMeta, robotsTxt, sitemapDocument, canonicalRedirect,
  faqHtml, faqJsonLd, guideBySlug, guideIndexHtml, guideHtml,
};
