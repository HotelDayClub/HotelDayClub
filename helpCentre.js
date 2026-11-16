const { esc } = require('./util');
const { GuestCheckIn, FOOD_RULE, FREE_CANCEL } = require('./offering');
const seo = require('./seo');
const { LinkStyles } = require('./linkStyles');

const ICONS = {
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  card: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h4"/>',
  pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  car: '<rect x="4" y="3.5" width="16" height="17" rx="3"/><path d="M10 16.5v-9h2.8a2.6 2.6 0 0 1 0 5.2H10"/>',
  refresh: '<path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3"/><path d="M18 3v4h-4M6 21v-4h4"/>',
  hotel: '<path d="M4 20V5.5L12 3l8 2.5V20M4 20h16M9 20v-4h6v4M8 8h2M14 8h2M8 12h2M14 12h2"/>',
  mail: '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="m3.5 7 8.5 6.5L20.5 7"/>',
};

const STEPS = [
  ['Browse', 'Search by neighbourhood, date and what you want: pool, gym or spa. Each listing shows what\'s included and the pool rules.'],
  ['Book', `Pick a sun lounger, daybed, cabana or whatever that hotel offers. Add parking or gym access if you want. ${FOOD_RULE} Tick one box to accept the terms. The full risk warning, hotel rules and group rules are in a dropdown above it. Hot-day alerts and offers by email are optional, in a separate box left unticked. The total updates before you confirm. This demo doesn't charge a card.`],
  ['Show your QR code', `${GuestCheckIn.line()} The hours are on your confirmation.`],
  ['Enjoy', 'Your spot, for the hours that hotel has set. Add-ons stay optional.'],
];

const RAW_CATEGORIES = [
  {
    id: 'getting-started',
    title: 'Getting started',
    blurb: 'What a day pass is and how the site works.',
    icon: 'info',
    articles: [
      { id: 'do-i-need-to-book-a-room', q: 'Do I need to book a room?', html: 'No. A day pass is the pool, gym or spa for the hours that hotel has set. There is no room and no overnight stay.' },
      { id: 'what-does-the-pass-include', q: 'What does the pass include?', html: `Each hotel sets its own inclusions. The listing says what the pass covers for that date and those hours. ${FOOD_RULE} Treatments are not included unless the listing says so.` },
      { id: 'what-are-the-hours', q: 'What are the hours?', html: 'Each hotel sets its own hours. A day pass is not sold past the time a room-guests-only period starts. Late access, where a hotel offers it, starts only after that period ends and stops when the pool closes.' },
      { id: 'is-this-a-real-booking-site', q: 'Is this a real booking site?', from: 'faq:Is this a real booking site?' },
      { id: 'are-these-real-hotels', q: 'Are these real hotels?', from: 'faq:Are these real hotels?' },
    ],
  },
  {
    id: 'booking-and-payment',
    title: 'Booking and payment',
    blurb: 'Seating, add-ons, checkout and the demo payment.',
    icon: 'card',
    articles: [
      { id: 'does-this-demo-charge-a-card', q: 'Does this demo charge a card?', html: 'No. Checkout is a mock payment. No card is needed and nothing is charged.' },
      { id: 'which-seating-can-i-book', q: 'Which seating can I book?', html: 'Pick a sun lounger, daybed, cabana or whatever that hotel offers. Hotels set their own passes, prices and how many guests they take.' },
      { id: 'can-i-add-parking-or-other-extras', q: 'Can I add parking or other extras?', html: 'Add parking or gym access if you want. The total updates before you confirm. Add-ons stay optional.' },
      { id: 'what-do-i-accept-at-checkout', q: 'What do I accept at checkout?', from: 'faq:What do I accept at checkout?' },
      { id: 'who-can-book-and-can-children-come', q: 'Who can book, and can children come?', from: 'faq:Who can book, and can children come?' },
      { id: 'what-if-a-pass-is-sold-out', q: 'What if a pass is sold out?', html: 'The page says when a pass is sold out for that date, or when there are not enough left. The terms say that if a pass sells out at the same moment and we can\'t confirm the booking, the booking is not made. This demo doesn\'t take a real payment.' },
      { id: 'cant-find-booking-email', q: "Can't find your booking email?", html: 'Check your spam folder, or email us at {mail} with your name and booking date and we\'ll resend it.' },
    ],
  },
  {
    id: 'arriving',
    title: 'Arriving',
    blurb: 'Checking in and what to bring on the day.',
    icon: 'pin',
    articles: [
      {
        id: 'how-do-i-check-in',
        q: 'How do I check in?',
        html: `${GuestCheckIn.line()} The hours are on your confirmation. In this demo the confirmation stays on the page, and a confirmation email is sent to the address you give. Bring photo ID when the hotel asks for it.`,
      },
      { id: 'what-should-i-bring', q: 'What should I bring?', html: 'Photo ID when the hotel asks for it, swimwear and sunscreen.' },
      { id: 'do-i-need-a-towel', q: 'Do I need a towel?', html: 'No, towels are included unless the listing says to bring your own.' },
    ],
  },
  {
    id: 'changes-and-cancellations',
    title: 'Changes and cancellations',
    blurb: 'Free cancellation, date changes and closures.',
    icon: 'refresh',
    articles: [
      { id: 'can-i-cancel-for-free', q: 'Can I cancel for free?', from: 'faq:Can I cancel for free?' },
      { id: 'how-do-i-cancel-my-booking', q: 'How do I cancel my booking?', html: 'Cancel in your booking link or email {mail} with your booking code.' },
      { id: 'what-if-it-rains', q: 'What if it rains?', from: 'faq:What if it rains?' },
    ],
  },
  {
    id: 'for-hotels',
    title: 'For hotels',
    blurb: 'Listing a hotel pool, gym or spa.',
    icon: 'hotel',
    articles: [
      { id: 'how-does-a-hotel-join', q: 'How does a hotel join?', html: 'Hotels are invited. There is no sign-up form. Email {mail} and we will set up the login. Read more on the <a href="/for-hotels">For hotels</a> page.' },
    ],
  },
  {
    id: 'contact-us',
    title: 'Contact us',
    blurb: 'How to reach Hotel Day Club.',
    icon: 'mail',
    articles: [
      { id: 'how-do-i-contact-you', q: 'How do I contact you?', from: 'faq:How do I contact you?' },
    ],
  },
];

function faqHtmlByQuestion(question, mailHtml) {
  const item = seo.faqItems(mailHtml).find(row => row.q === question);
  return item ? item.html : '';
}

class HelpCentre {
  static categories() {
    return RAW_CATEGORIES;
  }

  static resolveHtml(article, mailHtml) {
    if (article.html) {
      return String(article.html).split('{mail}').join(mailHtml);
    }
    if (article.from && article.from.startsWith('faq:')) {
      const q = article.from.slice(4);
      return faqHtmlByQuestion(q, mailHtml);
    }
    return '';
  }

  static relatedLinks(cat, articleId) {
    return cat.articles
      .filter(a => a.id !== articleId)
      .map(a => `<a href="#${esc(a.id)}">${esc(a.q)}</a>`)
      .join(' · ');
  }

  static icon(name) {
    const path = ICONS[name] || ICONS.info;
    return `<svg class="hc-ico" viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
  }

  static stepsHtml() {
    const items = STEPS.map((row, i) => `<li><span class="hc-num" aria-hidden="true">${i + 1}</span><h3>${esc(row[0])}</h3><p>${esc(row[1])}</p></li>`).join('');
    return `<section class="wrap hc-steps" id="guests" aria-labelledby="hc-steps-h"><h2 id="hc-steps-h">For guests</h2><ol>${items}</ol>
<p class="hc-cta"><a class="btn btn-coral" href="/#explore">Browse pools</a></p>
<p class="hc-guides">${LinkStyles.sectionAction('/guides', 'Guides to hotel day passes')}</p></section>`;
  }

  static cardsHtml() {
    const cards = RAW_CATEGORIES.map(cat => {
      const n = cat.articles.length;
      return `<li class="hc-card"><span class="hc-ico-wrap">${HelpCentre.icon(cat.icon)}</span><h3><a href="#${esc(cat.id)}">${esc(cat.title)}</a></h3><p>${esc(cat.blurb)}</p><p class="hc-n">${n} article${n === 1 ? '' : 's'}</p></li>`;
    }).join('');
    return `<section class="wrap" aria-labelledby="hc-cat-h"><h2 id="hc-cat-h">Browse by topic</h2><ul class="hc-cards">${cards}</ul></section>`;
  }

  static listHtml(mailHtml) {
    const secs = RAW_CATEGORIES.map(cat => {
      const arts = cat.articles.map(art => {
        const ans = HelpCentre.resolveHtml(art, mailHtml);
        const rel = HelpCentre.relatedLinks(cat, art.id);
        const relLine = rel ? `<p class="hc-rel">Related: ${rel}</p>` : '';
        return `<details class="hc-art" id="${esc(art.id)}"><summary><span>${esc(art.q)}</span><i class="faq-plus" aria-hidden="true"></i></summary><div class="hc-ans"><p>${ans}</p>${relLine}</div></details>`;
      }).join('');
      const n = cat.articles.length;
      return `<details class="hc-sec" id="${esc(cat.id)}"><summary><span class="hc-sec-t">${HelpCentre.icon(cat.icon)}<span><span class="h">${esc(cat.title)}</span><span class="d">${esc(cat.blurb)}</span></span></span><span class="hc-sec-n">${n}</span></summary><div class="hc-arts">${arts}</div></details>`;
    }).join('');
    return `<section class="wrap hc-list" id="faq" aria-label="All help articles">${secs}<p class="hc-none" id="hc-none" hidden>No articles match. Try another word, or email us.</p></section>`;
  }

  static bottomHtml(mailHtml, mailLink) {
    return `<section class="wrap hc-bottom">
<div class="hc-contact">${HelpCentre.icon('mail')}<div><h2>Contact us</h2><p>Email us for a booking, a complaint, or a privacy request.</p><a class="btn hc-btn" href="mailto:hello@hoteldayclub.com.au">Email hello@hoteldayclub.com.au</a> <a class="btn btn-line" href="/contact">Use the contact form</a></div></div>
<a class="hc-hotels" id="partners" href="/for-hotels"><span class="hc-eyebrow2">For hotels</span><span class="h">Run a hotel? Hotels are invited.</span><span>Read about listing a pool, gym or spa</span></a>
<p class="hc-full">All questions on one page: <a href="/faq">Hotel day pass questions</a></p></section>`;
  }

  static heroHtml() {
    return `<section class="hc-hero"><div class="wrap"><p class="eyebrow-s">How it works</p><h1 class="l-title">Help centre</h1><p class="lead">Short answers about hotel day passes in Australia.</p>
<form class="hc-search" role="search" action="/how-it-works" onsubmit="return false"><label for="hc-q">Search help articles</label><div class="hc-field"><svg class="hc-ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.7"/></svg><input id="hc-q" type="search" placeholder="Search help articles" autocomplete="off"></div><p id="hc-count" class="hc-count" aria-live="polite"></p></form></div></section>`;
  }

  static scripts() {
    return `<script>(function(){
var q=document.getElementById('hc-q');if(!q)return;
var arts=[].slice.call(document.querySelectorAll('.hc-art')),
  secs=[].slice.call(document.querySelectorAll('.hc-sec')),
  countEl=document.getElementById('hc-count'),
  noneEl=document.getElementById('hc-none'),
  open=[];
function openFromHash(){
  var id=(location.hash||'').replace(/^#/,'');if(!id)return;
  var art=document.getElementById(id);
  if(art&&art.classList.contains('hc-art')){
    var sec=art.closest('details.hc-sec');
    if(sec){sec.open=true;art.open=true;art.scrollIntoView({block:'start'});art.classList.add('is-open');}
  }
}
function onInput(){
  var term=q.value.trim().toLowerCase(),n=0;
  arts.forEach(function(a){
    var hit=!term||a.querySelector('summary').textContent.toLowerCase().indexOf(term)>-1;
    a.hidden=!hit;
    if(hit)n++;
    if(term&&hit){var s=a.closest('details.hc-sec');if(s)s.open=true;}
  });
  secs.forEach(function(s){s.hidden=!!term&&!s.querySelector('.hc-art:not([hidden])');});
  countEl.textContent=term?(n+(n===1?' article matches':' articles match')):'';
  if(noneEl)noneEl.hidden=!(term&&!n);
  if(!term){open.forEach(function(p){if(!p.el.open)p.el.open=p.was;});open=[];}
}
secs.forEach(function(s){s.addEventListener('toggle',function(){if(!q.value.trim())return;});});
q.addEventListener('input',onInput);
window.addEventListener('hashchange',openFromHash);
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',openFromHash);else openFromHash();
})();</script>`;
  }

  static pageHtml(mailHtml) {
    const mailLink = mailHtml;
    return `${HelpCentre.heroHtml()}${HelpCentre.stepsHtml()}${HelpCentre.cardsHtml()}${HelpCentre.listHtml(mailLink)}${HelpCentre.bottomHtml(mailHtml, mailLink)}${HelpCentre.scripts()}`;
  }

  static articleIds() {
    return RAW_CATEGORIES.flatMap(c => c.articles.map(a => a.id));
  }

  static freeCancelText() {
    return FREE_CANCEL;
  }
}

module.exports = { HelpCentre, STEPS, RAW_CATEGORIES };