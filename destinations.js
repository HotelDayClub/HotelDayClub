// Public destination cards. `areas` must match hotels.area exactly.
// An empty list means nothing is listed there, so the card is "Coming soon".
const DESTINATIONS = [
  { id: 'sydney-cbd', name: 'Sydney CBD', areas: ['CBD & Harbour'], icon: 'city' },
  { id: 'bondi', name: 'Bondi & Eastern Beaches', areas: ['Eastern Beaches'], icon: 'wave' },
  { id: 'manly', name: 'Manly & Northern Beaches', areas: ['Northern Beaches'], icon: 'beach' },
  { id: 'north-sydney', name: 'North Sydney', areas: ['North Sydney'], icon: 'skyline' },
  { id: 'eastern-suburbs', name: 'Eastern Suburbs', areas: ['Eastern Suburbs'], icon: 'palm' },
  { id: 'parramatta', name: 'Parramatta', areas: ['Parramatta'], icon: 'park' },
  { id: 'melbourne', name: 'Melbourne', areas: [], icon: 'laneway' },
  { id: 'brisbane', name: 'Brisbane', areas: [], icon: 'river' },
  { id: 'gold-coast', name: 'Gold Coast', areas: [], icon: 'coast' },
  { id: 'byron-bay', name: 'Byron Bay', areas: [], icon: 'lighthouse' },
  { id: 'cairns', name: 'Cairns & Port Douglas', areas: [], icon: 'reef' },
  { id: 'perth', name: 'Perth', areas: [], icon: 'sun' },
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

module.exports = { DESTINATIONS, destIcon };
