const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');
const seo = require('../seo');
const { DESTINATIONS } = require('../destinations');

for (const page of Object.values(seo.PAGES)) {
  const title = seo.fullTitle(page.title);
  assert.ok(title.length <= 60, title + ' ' + title.length);
  assert.ok(page.description.length <= 155, page.description + ' ' + page.description.length);
}
for (const d of DESTINATIONS) {
  const title = seo.fullTitle(d.title);
  assert.ok(title.length <= 60, title + ' ' + title.length);
  assert.ok(d.description.length <= 155, d.description);
  assert.ok(d.slug && d.id !== d.slug || d.slug === d.id);
}
for (const g of seo.GUIDES) {
  assert.ok(seo.fullTitle(g.title).length <= 60, g.title);
  assert.ok(g.description.length <= 155, g.description);
}
assert.strictEqual(seo.listingTitle('The Saltwater Terrace (Demo)'), 'The Saltwater Terrace day pass · Hotel Day Club');
assert.ok(!seo.listingTitle('The Saltwater Terrace (Demo)').includes('(Demo)'));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdc-seo-'));
const dbPath = path.join(dir, 'daypass.db');

function get(port, urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path: urlPath, headers }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}
function text(res) {
  const enc = res.headers['content-encoding'];
  if (enc === 'gzip') return zlib.gunzipSync(res.body).toString();
  if (enc === 'br') return zlib.brotliDecompressSync(res.body).toString();
  return res.body.toString();
}
function start(port, extra = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, ...extra, PORT: String(port), DB_PATH: dbPath, DATA_DIR: '', ADMIN_PASSWORD: 'seo-admin', DEMO_HOTEL_PASSWORD: 'seo-hotel' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    const timer = setTimeout(() => reject(new Error('server did not start\n' + log)), 15000);
    child.stdout.on('data', c => { log += c; if (log.includes('Hotel Day Club demo')) { clearTimeout(timer); resolve(child); } });
    child.stderr.on('data', c => { log += c; });
    child.on('exit', code => reject(new Error('server exited ' + code + '\n' + log)));
  });
}
function ld(html) {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1]));
  const flat = [];
  for (const block of blocks) {
    if (block['@graph']) flat.push(...block['@graph']);
    else flat.push(block);
  }
  return flat;
}
function titleOf(html) {
  const m = html.match(/<title>([^<]*)<\/title>/);
  assert.ok(m, 'missing title');
  return m[1].replace(/&amp;/g, '&').replace(/&#39;/g, "'");
}
function oneH1(html, where) {
  const n = (html.match(/<h1\b/g) || []).length;
  assert.strictEqual(n, 1, where + ' h1 ' + n);
}
function alts(html, where) {
  for (const tag of html.match(/<img\b[^>]*>/g) || []) {
    const alt = tag.match(/\balt="([^"]*)"/);
    assert.ok(alt && alt[1].trim(), where + ' ' + tag);
  }
}

(async () => {
  const port = 3321;
  const child = await start(port, { GOOGLE_SITE_VERIFICATION: 'googleverify123', BING_SITE_VERIFICATION: 'BING123456' });
  try {
    const home = text(await get(port, '/'));
    assert.ok(home.includes('content="index, follow"'));
    assert.ok(!home.includes('noindex'));
    assert.ok(titleOf(home).length <= 60, titleOf(home));
    assert.strictEqual(titleOf(home), 'Hotel day passes in Australia · Hotel Day Club');
    assert.ok(home.includes('rel="canonical" href="https://www.hoteldayclub.com.au/"'));
    const homeDesc = 'Book a hotel pool, spa or gym for the day in Australia, no room needed. We&#39;re launching soon, so join the waitlist.';
    assert.ok(home.includes('<h1 class="kicker">Hotel day passes in Australia</h1>'));
    assert.ok(home.includes('<h2 class="hero-line">Take the day <em>off.</em><br>Swim till&nbsp;six.</h2>'));
    assert.ok(home.includes('How a hotel day pass works'));
    assert.ok(home.includes('<h2>Destinations</h2>'));
    assert.ok(home.includes('Questions about hotel day passes'));
    assert.ok(home.includes(`name="description" content="${homeDesc}"`));
    assert.ok(home.includes(`property="og:description" content="${homeDesc}"`));
    assert.ok(home.includes(`name="twitter:description" content="${homeDesc}"`));
    assert.ok(home.includes('Demo site'));
    const footer = home.slice(home.indexOf('<footer'));
    for (const d of DESTINATIONS) assert.ok(footer.includes(`href="/destinations/${d.slug}"`), d.slug);
    assert.ok(footer.includes('href="/guides"'));
    for (const g of seo.GUIDES) assert.ok(footer.includes(`href="/guides/${g.slug}"`), g.slug);
    assert.ok(home.includes('og:locale" content="en_AU"'));
    assert.ok(home.includes('name="theme-color" content="#0E1E3A"'));
    assert.ok(home.includes('href="/site.webmanifest"'));
    assert.ok(home.includes('apple-touch-icon'));
    assert.ok(home.includes('content="googleverify123"'));
    assert.ok(home.includes('name="msvalidate.01" content="BING123456"'));
    assert.ok(home.includes('https://www.hoteldayclub.com.au/assets/og-image-1200x630.png'));
    assert.ok(home.includes('src="/assets/hdc-lockup-dark.svg"'));
    assert.ok(home.includes('src="/assets/hdc-lockup-light.svg"'));
    assert.ok(home.includes('alt="Hotel Day Club"'));
    assert.ok(!home.includes('logo-mark'));
    assert.ok(home.includes('href="/assets/hdc-icon.svg"'));
    assert.ok(!home.includes('href="/admin"'));
    assert.ok(!home.includes('href="/hotel"'));
    assert.ok(home.includes('href="/guides"'));
    assert.ok(home.includes('href="/destinations/gold-coast"'));
    assert.ok(!home.includes('fonts.googleapis.com'));
    assert.ok(!home.includes('googletagmanager.com'));
    oneH1(home, 'home');
    alts(home, 'home');
    const homeLd = ld(home);
    assert.ok(homeLd.some(n => n['@type'] === 'Organization' && n.email === 'hello@hoteldayclub.com.au'));
    assert.ok(homeLd.some(n => n['@type'] === 'WebSite'));
    assert.ok(!homeLd.some(n => n['@type'] === 'SearchAction' || n.potentialAction));
    assert.ok(!JSON.stringify(homeLd).includes('aggregateRating'));
    assert.ok(!home.includes('rel="preconnect" href="https://www.googletagmanager.com"'));

    const robots = text(await get(port, '/robots.txt'));
    assert.ok(/^User-agent: \*$/m.test(robots));
    assert.ok(/^Allow: \/$/m.test(robots));
    assert.ok(robots.includes('Disallow: /admin'));
    assert.ok(robots.includes('Disallow: /hotel'));
    assert.ok(robots.includes('Disallow: /checkout'));
    assert.ok(robots.includes('Disallow: /api'));
    assert.ok(robots.includes('Disallow: /booking/'));
    assert.ok(robots.includes('Disallow: /healthz'));
    assert.ok(robots.includes('Sitemap: https://www.hoteldayclub.com.au/sitemap.xml'));
    assert.ok(!/^Disallow: \/\s*$/m.test(robots));
    assert.ok(robots.includes('Allow: /favicon.ico'));
    assert.ok(!/Disallow:\s*\/favicon\.ico/.test(robots));

    const ico = await get(port, '/favicon.ico');
    assert.strictEqual(ico.status, 200);
    assert.ok(String(ico.headers['content-type']).startsWith('image/x-icon'), ico.headers['content-type']);
    assert.ok(String(ico.headers['cache-control']).includes('max-age=86400'));
    assert.ok(!ico.body.includes(Buffer.from('<html')));
    assert.strictEqual(ico.body.readUInt16LE(0), 0);
    assert.strictEqual(ico.body.readUInt16LE(2), 1);
    const count = ico.body.readUInt16LE(4);
    const sizes = [];
    for (let i = 0; i < count; i++) {
      const w = ico.body.readUInt8(6 + i * 16);
      sizes.push(w === 0 ? 256 : w);
    }
    assert.deepStrictEqual(sizes, [16, 32, 48]);
    assert.ok(home.includes('href="/favicon.ico"'));

    function pngSize(body) {
      assert.strictEqual(body.readUInt32BE(12), 0x49484452);
      return { width: body.readUInt32BE(16), height: body.readUInt32BE(20) };
    }
    const touch = await get(port, '/assets/apple-touch-icon.png');
    assert.strictEqual(touch.status, 200);
    assert.ok(String(touch.headers['content-type']).startsWith('image/png'), touch.headers['content-type']);
    assert.deepStrictEqual(pngSize(touch.body), { width: 180, height: 180 });
    const og = await get(port, '/assets/og-image-1200x630.png');
    assert.strictEqual(og.status, 200);
    assert.ok(String(og.headers['content-type']).startsWith('image/png'), og.headers['content-type']);
    assert.deepStrictEqual(pngSize(og.body), { width: 1200, height: 630 });
    const manifest = JSON.parse(text(await get(port, '/site.webmanifest')));
    for (const icon of manifest.icons) {
      const file = await get(port, icon.src);
      assert.strictEqual(file.status, 200, icon.src);
      assert.ok(String(file.headers['content-type']).startsWith('image/png'));
    }
    async function assertLocalAssets(html, label) {
      const urls = new Set();
      const re = /(?:src|href)="(\/(?:assets|favicon)[^"#?]*)"/g;
      let match;
      while ((match = re.exec(html))) urls.add(match[1]);
      for (const url of urls) {
        const res = await get(port, url);
        assert.strictEqual(res.status, 200, label + ' ' + url);
      }
    }
    await assertLocalAssets(home, 'home');
    const hotelsPage = text(await get(port, '/for-hotels'));
    assert.ok(hotelsPage.includes('src="/assets/hdc-lockup-dark.svg"'));
    assert.ok(!hotelsPage.includes('hdc-lockup-light.svg'));
    await assertLocalAssets(hotelsPage, 'for-hotels');
    const listingPage = text(await get(port, '/h/saltwater-terrace'));
    assert.ok(listingPage.includes('src="/assets/hdc-lockup-dark.svg"'));
    assert.ok(!listingPage.includes('hdc-lockup-light.svg'));
    await assertLocalAssets(listingPage, 'listing');

    const map = text(await get(port, '/sitemap.xml'));
    assert.ok(map.includes('https://www.hoteldayclub.com.au/faq'));
    assert.ok(map.includes('https://www.hoteldayclub.com.au/destinations/sydney'));
    assert.ok(map.includes('https://www.hoteldayclub.com.au/guides/what-is-a-hotel-day-pass'));
    assert.ok(map.includes('<lastmod>'));
    assert.ok(!map.includes('/h/saltwater-terrace'));
    assert.ok(!map.includes('/privacy'));
    assert.ok(!map.includes('/terms'));
    assert.ok(!map.includes('/refunds'));
    assert.ok(!map.includes('/risk'));
    assert.ok(!map.includes('/checkout'));
    assert.ok(!map.includes('/admin'));
    assert.ok(!map.includes('healthz'));
    assert.ok(!map.includes('/hotel'));
    const privacy = text(await get(port, '/privacy'));
    assert.ok(privacy.includes('content="noindex, follow"'));
    assert.ok(privacy.includes('href="/privacy"'));
    assert.ok(home.includes('href="/privacy"') && home.includes('href="/terms"') && home.includes('href="/refunds"') && home.includes('href="/risk"'));

    const demo = text(await get(port, '/h/saltwater-terrace?date=2099-01-01'));
    assert.ok(demo.includes('content="noindex, follow"'));
    assert.ok(demo.includes('rel="canonical" href="https://www.hoteldayclub.com.au/h/saltwater-terrace"'));
    assert.ok(!demo.includes('2099-01-01'));
    assert.ok(demo.includes('Fictional demo listing'));
    assert.ok(demo.includes('Stock photo, not this hotel'));
    const demoLd = JSON.stringify(ld(demo));
    assert.ok(!demoLd.includes('LodgingBusiness'));
    assert.ok(!demoLd.includes('"Product"'));
    assert.ok(!demoLd.includes('aggregateRating'));
    oneH1(demo, 'listing');
    alts(demo, 'listing');
    assert.ok(titleOf(demo).length <= 60);

    const sydney = text(await get(port, '/destinations/sydney'));
    assert.ok(sydney.includes('content="index, follow"'));
    assert.ok(sydney.includes('Sydney hotel pool day passes'));
    assert.ok(sydney.includes('fictional'));
    assert.ok(sydney.includes('href="/h/harbourside-lido"'));
    assert.ok(sydney.includes('rel="canonical" href="https://www.hoteldayclub.com.au/destinations/sydney"'));
    oneH1(sydney, 'sydney');
    assert.strictEqual((await get(port, '/destinations/nope')).status, 404);

    const melbourne = text(await get(port, '/destinations/melbourne'));
    assert.ok(melbourne.includes('Coming soon'));
    assert.ok(melbourne.includes('href="/?destination=melbourne#waitlist"'));
    assert.ok(!melbourne.includes('Saltwater Terrace'));

    const guides = text(await get(port, '/guides'));
    assert.ok(guides.includes('content="index, follow"'));
    assert.ok(guides.includes('/guides/how-to-choose-a-hotel-pool-day-pass'));
    oneH1(guides, 'guides');
    const article = text(await get(port, '/guides/what-is-a-hotel-day-pass'));
    const articleLd = ld(article);
    const art = articleLd.find(n => n['@type'] === 'Article');
    assert.ok(art);
    assert.strictEqual(art.datePublished, '2026-10-24');
    assert.strictEqual(art.author['@type'], 'Organization');
    assert.ok(!JSON.stringify(articleLd).includes('"Person"'));
    assert.ok(article.includes('content="index, follow"'));
    oneH1(article, 'article');
    assert.strictEqual((await get(port, '/guides/not-a-guide')).status, 404);

    const missing = await get(port, '/this-page-is-not-real');
    assert.strictEqual(missing.status, 404);
    const missingHtml = text(missing);
    assert.ok(missingHtml.includes('Page not found'));
    assert.ok(missingHtml.includes('href="/"'));
    assert.ok(missingHtml.includes('href="/faq"'));
    assert.ok(!missingHtml.includes('Cannot GET'));
    assert.ok(missingHtml.includes('noindex'));
    assert.ok(!missingHtml.includes('rel="canonical"'));
    oneH1(missingHtml, '404');

    const api = await get(port, '/api/not-a-route');
    assert.strictEqual(api.status, 404);
    assert.strictEqual(JSON.parse(text(api)).error, 'not found');

    const css = await get(port, '/app.css');
    assert.ok(String(css.headers['cache-control']).includes('max-age=86400'));
    const svg = await get(port, '/assets/hdc-lockup-dark.svg');
    assert.ok(String(svg.headers['cache-control']).includes('max-age=2592000'));

    const gz = await get(port, '/', { 'Accept-Encoding': 'gzip' });
    assert.strictEqual(gz.headers['content-encoding'], 'gzip');
    assert.ok(text(gz).includes('Hotel day passes in Australia'));
    const br = await get(port, '/faq', { 'Accept-Encoding': 'br' });
    assert.strictEqual(br.headers['content-encoding'], 'br');
    assert.ok(text(br).includes('content="index, follow"'));
    const plain = await get(port, '/faq');
    assert.ok(!plain.headers['content-encoding']);
    const faq = text(plain);
    assert.ok(faq.includes('at least 3 years'));
    assert.ok(faq.includes('<h1 class="l-title">Hotel day pass questions</h1>'));
    const faqPage = ld(faq).find(n => n['@type'] === 'FAQPage');
    assert.ok(faqPage);
    const visibleQa = [...faq.matchAll(/<summary>([^<]*)<\/summary><p>([\s\S]*?)<\/p>/g)];
    assert.strictEqual(faqPage.mainEntity.length, visibleQa.length);
    const decode = s => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
    faqPage.mainEntity.forEach((item, i) => {
      assert.strictEqual(item['@type'], 'Question');
      assert.strictEqual(item.acceptedAnswer['@type'], 'Answer');
      assert.strictEqual(item.name, decode(visibleQa[i][1]));
      assert.strictEqual(item.acceptedAnswer.text.replace(/\s+/g, ' ').trim(), decode(visibleQa[i][2]));
    });

    const apex = await get(port, '/faq?x=1', { Host: 'hoteldayclub.com.au', 'X-Forwarded-Proto': 'http' });
    assert.strictEqual(apex.status, 301);
    assert.strictEqual(apex.headers.location, 'https://www.hoteldayclub.com.au/faq?x=1');
    const wwwHttp = await get(port, '/for-hotels', { Host: 'www.hoteldayclub.com.au', 'X-Forwarded-Proto': 'http' });
    assert.strictEqual(wwwHttp.status, 301);
    assert.strictEqual(wwwHttp.headers.location, 'https://www.hoteldayclub.com.au/for-hotels');
    const wwwHttps = await get(port, '/for-hotels', { Host: 'www.hoteldayclub.com.au', 'X-Forwarded-Proto': 'https' });
    assert.strictEqual(wwwHttps.status, 200);
    const local = await get(port, '/faq');
    assert.strictEqual(local.status, 200);

    const hiw = text(await get(port, '/how-it-works'));
    assert.ok(hiw.includes('href="/hotel"'));
    assert.ok(hiw.includes('href="/guides"'));
    assert.strictEqual(titleOf(hiw), 'How hotel day passes work · Hotel Day Club');

    const live = new Database(dbPath);
    live.prepare("UPDATE hotels SET is_demo=0 WHERE slug='saltwater-terrace'").run();
    live.close();
    const real = text(await get(port, '/h/saltwater-terrace'));
    assert.ok(real.includes('content="index, follow"'));
    assert.ok(!real.includes('noindex'));
    assert.ok(!real.includes('Fictional demo listing'));
    const realLd = ld(real);
    assert.ok(realLd.some(n => n['@type'] === 'Product' || n['@type'] === 'LodgingBusiness'));
    const offer = JSON.stringify(realLd);
    assert.ok(offer.includes('"priceCurrency":"AUD"'));
    assert.ok(!offer.includes('aggregateRating'));
    assert.ok(!offer.includes('reviewCount'));
    const map2 = text(await get(port, '/sitemap.xml'));
    assert.ok(map2.includes('/h/saltwater-terrace'));
    assert.ok(!map2.includes('/h/skyline-rooftop'));
  } finally {
    child.kill('SIGTERM');
  }

  const offPort = 3322;
  const off = await start(offPort, { SITE_INDEXABLE: 'false' });
  try {
    const home = text(await get(offPort, '/'));
    assert.ok(home.includes('content="noindex, nofollow"'));
    const robots = text(await get(offPort, '/robots.txt'));
    assert.ok(/^Disallow: \/$/m.test(robots));
    assert.ok(robots.includes('Allow: /favicon.ico'));
    assert.ok(!robots.includes('Sitemap:'));
    const map = text(await get(offPort, '/sitemap.xml'));
    assert.ok(!map.includes('<loc>'));
  } finally {
    off.kill('SIGTERM');
  }

  const gaPort = 3323;
  const ga = await start(gaPort, { NODE_ENV: 'production' });
  try {
    const home = text(await get(gaPort, '/'));
    assert.ok(home.includes('<link rel="preconnect" href="https://www.googletagmanager.com">'));
    assert.ok(home.includes('https://www.googletagmanager.com/gtag/js?id=G-9F5ZH1T4YN'));
    assert.ok(home.indexOf('gtag/js') < home.indexOf('</head>'));
    assert.ok(!home.includes('fonts.googleapis.com'));
    const hotel = text(await get(gaPort, '/hotel/login'));
    assert.ok(!hotel.includes('googletagmanager.com'));
    assert.ok(hotel.includes('noindex'));
  } finally {
    ga.kill('SIGTERM');
  }
  const legalPort = 3324;
  const legalOn = await start(legalPort, { LEGAL_PAGES_INDEXABLE: 'true' });
  try {
    const terms = text(await get(legalPort, '/terms'));
    assert.ok(terms.includes('content="index, follow"'));
    assert.ok(!terms.includes('noindex'));
    const map = text(await get(legalPort, '/sitemap.xml'));
    for (const pathName of ['/privacy', '/terms', '/refunds', '/risk']) {
      assert.ok(map.includes('https://www.hoteldayclub.com.au' + pathName), pathName);
    }
  } finally {
    legalOn.kill('SIGTERM');
  }
  console.log('seo checks passed');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
