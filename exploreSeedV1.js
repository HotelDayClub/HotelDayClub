// Demo Explore copy as first seeded (PRs #97 and #98). Used only by the one-time
// demo Explore migration to tell untouched seed text from hotel edits.
const { FOOD_RULE } = require('./offering');

const DEMO_SEED_V1 = {
  'saltwater-terrace': {
    intro: 'A short look at the main areas of this example hotel. Your pass covers the pool and seating during the hours below; the bar is on site and not included.',
    areas: [
      { name: 'The Pool', line: 'Outdoor, heated', details: 'An outdoor heated pool. Access is during the hours on your pass. Towels, showers and change rooms are listed under Included in your pass.', hours: '10am–4pm', photo: 'infinity-palms.jpg', kind: 'pool' },
      { name: 'The Terrace', line: 'Loungers, daybeds and cabanas around the pool', details: 'Sun loungers, daybeds and cabanas are booked as a day pass. How many people each one fits is listed on the pass.', hours: '10am–4pm', photo: 'hero-loungers.jpg', kind: 'other' },
      { name: 'Pool bar', line: 'A bar at the hotel, next to the pool.', details: 'A bar at the hotel, next to the pool. ' + FOOD_RULE, hours: 'During pass hours, 10am–4pm', photo: 'loungers-snacks.jpg', kind: 'bar' },
    ],
  },
  'skyline-rooftop': {
    intro: 'A short look at this example rooftop hotel. Your pass covers the pool during the hours below; the bar is on site and not included.',
    areas: [
      { name: 'Rooftop pool', line: 'Heated pool with city views', details: 'A heated rooftop pool. Access is during the hours on your pass.', hours: '11am–4pm', photo: 'rooftop-city.jpg', kind: 'pool' },
      { name: 'Pool deck', line: 'Loungers and chairs on the roof', details: 'Day passes include a lounger or pool chair on the deck.', hours: '11am–4pm', photo: 'hero-loungers.jpg', kind: 'other' },
      { name: 'Rooftop bar', line: 'A bar on the roof', details: 'A bar on the roof. ' + FOOD_RULE, hours: 'During pass hours, 11am–4pm', photo: 'loungers-snacks.jpg', kind: 'bar' },
    ],
  },
  'harbourside-lido': {
    intro: 'A short look at this example lido. Your pass covers the pool hall; the café is on site and not included.',
    areas: [
      { name: 'Glass-roof pool', line: 'Light-filled indoor pool', details: 'A pool under a glass roof. Steam room and sauna access are listed under Included in your pass when your pass includes them.', hours: '9am–6pm', photo: 'glass-roof-pool.jpg', kind: 'pool' },
      { name: 'Lido deck', line: 'Loungers beside the pool', details: 'Loungers around the pool hall are booked as a day pass.', hours: '9am–6pm', photo: 'indoor-spa-pool.jpg', kind: 'other' },
      { name: 'Café', line: 'A café in the pool hall', details: 'A café in the pool hall. ' + FOOD_RULE, hours: 'During pass hours, 9am–6pm', photo: 'loungers-snacks.jpg', kind: 'cafe' },
    ],
  },
  'palm-court': {
    intro: 'A short look at this example lagoon hotel. Your pass covers the pool and gardens during the hours below; the café is on site and not included.',
    areas: [
      { name: 'Lagoon pool', line: 'Outdoor lagoon with shallow end', details: 'A lagoon pool ringed by palms. The shallow end suits families when children are welcome.', hours: '10am–5pm', photo: 'tropical-resort.jpg', kind: 'pool' },
      { name: 'Garden terrace', line: 'Loungers and shade in the gardens', details: 'Loungers and daybeds in the palm gardens are booked as a day pass.', hours: '10am–5pm', photo: 'thatched-umbrellas.jpg', kind: 'other' },
      { name: 'Pool café', line: 'A café beside the lagoon', details: 'A café beside the lagoon. ' + FOOD_RULE, hours: 'During pass hours, 10am–5pm', photo: 'loungers-snacks.jpg', kind: 'cafe' },
    ],
  },
  'manly-sands': {
    intro: 'A short look at this example beachfront hotel. Your pass covers the pool during the hours below; the kiosk is on site and not included.',
    areas: [
      { name: 'Magnesium pool', line: 'Outdoor pool steps from the beach', details: 'A magnesium pool beside the sand. Towels and showers are listed under Included in your pass.', hours: '10am–4pm', photo: 'infinity-palms.jpg', kind: 'pool' },
      { name: 'Beach deck', line: 'Loungers and daybeds facing the water', details: 'Sun loungers and canopy daybeds are booked as a day pass.', hours: '10am–4pm', photo: 'daybed-canopy.jpg', kind: 'other' },
      { name: 'Kiosk', line: 'A kiosk by the pool', details: 'A kiosk by the pool. ' + FOOD_RULE, hours: 'During pass hours, 10am–4pm', photo: 'loungers-snacks.jpg', kind: 'bar' },
    ],
  },
  'bayview-spa': {
    intro: 'A short look at this example bathhouse. Your pass covers the pools and bathhouse during the hours below.',
    areas: [
      { name: 'Bathhouse', line: 'Hot and cold plunge pools', details: 'A calm bathhouse with hot and cold plunge. General entry covers the bathhouse and outdoor pool.', hours: '9am–4pm', photo: 'spa-steps.jpg', kind: 'spa' },
      { name: 'Outdoor pool', line: 'Heated outdoor pool in the garden', details: 'A heated outdoor pool beside the garden. Cabanas are booked as a separate pass.', hours: '9am–4pm', photo: 'indoor-spa-pool.jpg', kind: 'pool' },
      { name: 'Garden lounge', line: 'Quiet loungers in the garden', details: 'Loungers in the garden are included with general entry during your pass hours.', hours: '9am–4pm', photo: 'hero-loungers.jpg', kind: 'other' },
    ],
  },
};

module.exports = { DEMO_SEED_V1 };
