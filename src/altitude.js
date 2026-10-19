// Squashed scale, No Man's Sky style: near the water a metre is a metre, but
// every few dozen metres of climb multiplies the real-world altitude, so a
// jump of a few hundred game metres reaches orbit.

const SCALE_HEIGHT = 45;

export const EARTH_RADIUS = 6_371_000;
export const MOON_DISTANCE = 384_400_000;

// Real-world altitude in metres for a game height.
export function realAltitude(y) {
  if (y <= 0) return y;
  return y * Math.exp(y / SCALE_HEIGHT);
}

// How many real metres one game metre is worth at this height (the
// derivative of realAltitude), used for the pulse-drive speed readout.
export function scaleAt(y) {
  if (y <= 0) return 1;
  return Math.exp(y / SCALE_HEIGHT) * (1 + y / SCALE_HEIGHT);
}

export function formatAltitude(metres) {
  const m = Math.abs(metres);
  if (m < 1000) return `${Math.round(m)} m`;
  if (m < 100_000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m / 1000).toLocaleString('en-US')} km`;
}

// Real trivia on the way up. Each shows once per run, the first time you pass it.
export const MARKERS = [
  { at: 828, name: 'Burj Khalifa', fact: 'Taller than the tallest building on Earth.' },
  { at: 8_849, name: 'Mount Everest', fact: 'Higher than the summit of Everest.' },
  { at: 11_000, name: 'Airliners', fact: 'Passenger jets cruise about here.' },
  { at: 39_000, name: 'Stratos', fact: "Felix Baumgartner skydived from 39 km in 2012." },
  { at: 100_000, name: 'Kármán line', fact: 'Welcome to space. The atmosphere is behind you.' },
  { at: 408_000, name: 'Space Station', fact: 'The ISS circles Earth here about every 90 minutes.' },
  { at: 540_000, name: 'Hubble', fact: 'The Hubble Space Telescope orbits at about 540 km.' },
  { at: 20_200_000, name: 'GPS satellites', fact: 'GPS satellites orbit here, twice a day.' },
  { at: 35_786_000, name: 'Geostationary orbit', fact: 'One lap a day: satellites here hang over one spot.' },
];

// Markers crossed between two real altitudes, going up.
export function markersPassed(from, to) {
  return MARKERS.filter((m) => from < m.at && to >= m.at);
}
