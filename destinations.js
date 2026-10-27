// Public destination cards. `areas` must match hotels.area exactly.
// An empty list means nothing is listed there, so the card is "Coming soon".
// `id` is the waitlist value. `slug` is the public URL under /destinations/.
const DESTINATIONS = [
  {
    id: 'sydney-cbd', slug: 'sydney', name: 'Sydney CBD', areas: ['CBD & Harbour'], icon: 'city',
    title: 'Sydney hotel pool day passes',
    description: 'Hotel pool, gym and spa day passes in the Sydney CBD. No room needed. Example listings here are fictional until a hotel joins.',
    intro: 'A hotel pool, gym or spa in the Sydney CBD, for the day, without booking a room. Anything listed below is a fictional example. It does not mean a hotel has signed up.',
  },
  {
    id: 'bondi', slug: 'bondi', name: 'Bondi & Eastern Beaches', areas: ['Eastern Beaches'], icon: 'wave',
    title: 'Bondi hotel pool day passes',
    description: 'Pool and spa day passes around Bondi and the Eastern Beaches. Example listings are fictional until a hotel joins Hotel Day Club.',
    intro: 'Day passes for a hotel pool or spa around Bondi and the Eastern Beaches. The cards below are fictional examples with stock photos, not hotels that have joined.',
  },
  {
    id: 'manly', slug: 'manly', name: 'Manly & Northern Beaches', areas: ['Northern Beaches'], icon: 'beach',
    title: 'Manly hotel pool day passes',
    description: 'Hotel pool day passes in Manly and the Northern Beaches. Example listings are fictional until a hotel joins Hotel Day Club.',
    intro: 'A hotel pool for the day in Manly and the Northern Beaches, with no overnight stay. Listings here are examples so you can see the shape of a page. No hotel has signed up.',
  },
  {
    id: 'north-sydney', slug: 'north-sydney', name: 'North Sydney', areas: ['North Sydney'], icon: 'skyline',
    title: 'North Sydney hotel day passes',
    description: 'Hotel pool and gym day passes in North Sydney. Example listings are fictional until a hotel joins Hotel Day Club.',
    intro: 'North Sydney day passes cover a hotel pool or gym for set hours. The example on this page is fictional. It is here to show the listing, not a partnership.',
  },
  {
    id: 'eastern-suburbs', slug: 'eastern-suburbs', name: 'Eastern Suburbs', areas: ['Eastern Suburbs'], icon: 'palm',
    title: 'Eastern Suburbs hotel day passes',
    description: 'Hotel pool and spa day passes in the Eastern Suburbs. Example listings are fictional until a hotel joins Hotel Day Club.',
    intro: 'Pool and spa day passes in the Eastern Suburbs, booked for the day. The example listing is not a real hotel, and the photos are stock.',
  },
  {
    id: 'parramatta', slug: 'parramatta', name: 'Parramatta', areas: ['Parramatta'], icon: 'park',
    title: 'Parramatta hotel day passes',
    description: 'Hotel pool day passes in Parramatta. Example listings are fictional until a hotel joins Hotel Day Club.',
    intro: 'A Parramatta hotel pool for the day, without a room. The example listing is fictional and is not a hotel that has agreed to take day guests.',
  },
  {
    id: 'melbourne', slug: 'melbourne', name: 'Melbourne', areas: ['Melbourne'], icon: 'laneway',
    title: 'Melbourne hotel day passes',
    description: 'Hotel pool, gym and spa day passes in Melbourne are not listed yet. Join the waitlist and we will write when a hotel is ready.',
    intro: 'Melbourne is on the list of places Hotel Day Club wants to cover. There is no hotel listing here yet, and none of the example hotels on the homepage are in Melbourne.',
  },
  {
    id: 'brisbane', slug: 'brisbane', name: 'Brisbane', areas: ['Brisbane'], icon: 'river',
    title: 'Brisbane hotel day passes',
    description: 'Hotel pool, gym and spa day passes in Brisbane are not listed yet. Join the waitlist and we will write when a hotel is ready.',
    intro: 'Brisbane day passes are not open. This page is a place to land while we talk to hotels. Nothing here is a booking you can make today.',
  },
  {
    id: 'gold-coast', slug: 'gold-coast', name: 'Gold Coast', areas: ['Gold Coast'], icon: 'coast',
    title: 'Gold Coast hotel day passes',
    description: 'Hotel pool and spa day passes on the Gold Coast are not listed yet. Join the waitlist and we will write when a hotel is ready.',
    intro: 'The Gold Coast is a natural fit for a pool day pass, and there is no listing here yet. Join the waitlist if you want a note when a hotel is ready.',
  },
  {
    id: 'byron-bay', slug: 'byron-bay', name: 'Byron Bay', areas: ['Byron Bay'], icon: 'lighthouse',
    title: 'Byron Bay hotel day passes',
    description: 'Hotel pool and spa day passes in Byron Bay are not listed yet. Join the waitlist and we will write when a hotel is ready.',
    intro: 'Byron Bay is coming later. There is no example listing for this coast, and no hotel here has joined Hotel Day Club.',
  },
  {
    id: 'cairns', slug: 'cairns', name: 'Cairns & Port Douglas', areas: ['Cairns & Port Douglas'], icon: 'reef',
    title: 'Cairns and Port Douglas day passes',
    description: 'Hotel pool day passes in Cairns and Port Douglas are not listed yet. Join the waitlist and we will write when a hotel is ready.',
    intro: 'Cairns and Port Douglas are on the map for later. There is no pool day pass to book here yet.',
  },
  {
    id: 'perth', slug: 'perth', name: 'Perth', areas: ['Perth'], icon: 'sun',
    title: 'Perth hotel day passes',
    description: 'Hotel pool, gym and spa day passes in Perth are not listed yet. Join the waitlist and we will write when a hotel is ready.',
    intro: 'Perth day passes are not listed. This page is only a marker. We will use it when a hotel there is ready to take day guests.',
  },
];

const PATHS = {
  city: '<path d="M4 20V9l5-3v14"/><path d="M9 20V4l6 3v13"/><path d="M15 20v-8l5 2v6"/><path d="M3 20h18"/>',
  wave: '<path d="M3 15c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2"/><path d="M3 19c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2"/>',
  beach: '<path d="M4 18c2.5-3 5-3 8 0s5.5 3 8 0"/><path d="M12 14V5"/><path d="M12 7c3 1 4 3 4 3"/>',
  skyline: '<path d="M3 20h18"/><path d="M6 20V8h4v12"/><path d="M10 20V4h5v16"/><path d="M15 20v-7h4v7"/>',
  palm: '<path d="M12 21V11"/><path d="M12 11C8 10 6 7 5 4c3 1 5 2 7 4 2-2 4-3 7-4-1 3-3 6-7 7z"/>',
  park: '<path d="M4 18h16"/><path d="M7 18V9l5-4 5 4v9"/><path d="M10 18v-4h4v4"/>',
  laneway: '<path d="M5 20V7l4-3v16"/><path d="M9 20V9l6-2v13"/><path d="M15 20V8l4 1v11"/>',
  river: '<path d="M4 8c3 2 5 2 8 0s5-2 8 0"/><path d="M4 13c3 2 5 2 8 0s5-2 8 0"/><path d="M4 18c3 2 5 2 8 0s5-2 8 0"/>',
  coast: '<path d="M3 16c2 2 4 2 6 0s4-2 6 0 4 2 6 0"/><circle cx="17" cy="7" r="2.2"/>',
  lighthouse: '<path d="M10 20V9l2-4 2 4v11"/><path d="M8 20h8"/><path d="M9 12h6"/><path d="M4 9h4M16 9h4"/>',
  reef: '<path d="M4 16c2-4 4-4 6 0"/><path d="M10 16c1.5-5 4-6 7-3"/><path d="M8 20h10"/><circle cx="16" cy="8" r="1.4"/>',
  sun: '<circle cx="12" cy="12" r="3.2"/><path d="M12 4v2M12 18v2M4 12h2M18 12h2M6.2 6.2l1.4 1.4M16.4 16.4l1.4 1.4M17.8 6.2l-1.4 1.4M7.6 16.4l-1.4 1.4"/>',
};

function destIcon(kind) {
  const body = PATHS[kind] || PATHS.sun;
  return `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
}

function destinationBySlug(slug) {
  return DESTINATIONS.find(d => d.slug === slug) || null;
}

module.exports = { DESTINATIONS, destIcon, destinationBySlug };
