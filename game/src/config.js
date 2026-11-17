// config.js — every shared constant of SOLBAY HEAT in one place: the city grid, the palette,
// the tuning numbers the other modules read. Solbay is a square grid of streets around a
// downtown core, with a beach and the ocean along its south edge and an airstrip to the north.

export const CITY = {
  blockPitch: 46,          // metres between street centrelines
  halfBlocks: 4,           // streets run from -4..4 pitches each way (9 x 9 intersections)
  roadHalf: 7,             // half the width of a street
  laneOffset: 3.4,         // right-hand traffic lane offset from the centreline
  sidewalk: 2.6,           // sidewalk width around each block
  beachZ: 218,             // sand starts here (south edge)
  oceanZ: 252,             // water starts here
  northFenceZ: -218,       // airstrip / city limit to the north
};

export const WORLD_EDGE = 232; // players and cars are clamped inside this square

export function streetCoord(i) { return i * CITY.blockPitch; }
export function cityExtent() { return streetCoord(CITY.halfBlocks) + CITY.blockPitch / 2; }

// The sun-soaked palette: warm sand, teal water, coral and cream towers.
export const PALETTE = {
  sky: 0x8fd3f4,
  fog: 0xa8d4ec,
  sun: 0xffe3b3,
  ground: 0x9aa578,
  sand: 0xe8d193,
  ocean: 0x1e7f96,
  road: 0x33373d,
  roadLine: 0xf5d76e,
  sidewalk: 0xb9b3a4,
  buildingTints: [0xf2e3c9, 0xe8b4a0, 0xcfe0e8, 0xf5cf87, 0xd9c6e8, 0xa8d5ba, 0xf0f0f0, 0xe59a8f, 0x9fc6d8, 0xf7ead1],
  carPaints: [0xc0392b, 0x2471a3, 0xf39c12, 0x27ae60, 0xecf0f1, 0x2c3e50, 0x8e44ad, 0xd35400, 0x16a085, 0xbdc3c7, 0xfd79a8, 0x00b894],
  pedShirts: [0xff6b6b, 0xfeca57, 0x48dbfb, 0x1dd1a1, 0xf368e0, 0xff9f43, 0x54a0ff, 0x5f27cd, 0xffffff, 0x222f3e],
};

export const TUNING = {
  playerWalkSpeed: 5.2,
  playerSprintSpeed: 8.6,
  playerRadius: 0.45,
  playerHealth: 100,
  carAccel: 15,
  carBrake: 26,
  carDrag: 0.55,
  carTurnRate: 1.65,
  trafficSpeed: 10.5,
  policeSpeed: 17.5,
  wantedDecayPerSec: 0.055,
  bustedRange: 3.4,
  bustedFillPerSec: 0.55,
  pistolDamage: 34,
  pistolRange: 90,
  pistolCooldown: 0.24,
  magazine: 12,
};

export const SAVE_KEY = 'solbay-heat-save-v1';

// Original names used by the story. None of them come from any other game.
export const NAMES = {
  hero: 'RENO VALE',
  fixer: 'MARISOL CRUZ',
  mechanic: 'PIPER LANG',
  rival: 'THE CORSAIRS',
  club: 'CLUB AZAHAR',
  garage: "PIPER'S GARAGE",
};
