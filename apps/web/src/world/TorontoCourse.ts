import type { RingCategory } from './CoinRings'

/**
 * Toronto in local flight space (launch at the origin, +Z toward heading 58°).
 * CN Tower (−25, 339), top 633 m MSL. Rogers Centre (−10, 111), roof 166 m.
 * First Canadian Place (−370, 1067), roof 382 m.
 *
 * The first line is a wide lap around the tower, then a straight dive down
 * its west side into the harbour elevator. The lap is the turn a coin-boosted
 * wing can hold. Inside the lap, the shaft is still concrete.
 * That column lifts back above the launch, where a second line passes the
 * east face of First Canadian Place into another column.
 */

const CN_X = -24.8
const CN_Z = 338.5
// 120 m is a lap a moderate bank can hold, including the coin boost.
// The old 34 m corkscrew needed a full-stick dive the whole way around.
const ORBIT_M = 120
const SPIRAL_START_DEG = -12
const SPIRAL_TURNS = 1.55
const SPIRAL_Y0 = 658
const SPIRAL_Y1 = 400
const SPIRAL_COUNT = 12

function spiralRing(i: number): TorontoGate {
  const u = i / (SPIRAL_COUNT - 1)
  const deg = SPIRAL_START_DEG + SPIRAL_TURNS * 360 * u
  const a = (deg * Math.PI) / 180
  const category: RingCategory = u < 0.22 ? 'dive' : u < 0.72 ? 'carve' : 'swoop'
  return {
    x: CN_X + Math.cos(a) * ORBIT_M,
    y: SPIRAL_Y0 + (SPIRAL_Y1 - SPIRAL_Y0) * u,
    z: CN_Z + Math.sin(a) * ORBIT_M,
    category,
    radius: 11.2 - u * 1.6,
    points: 120,
  }
}

export type TorontoGate = {
  x: number
  y: number
  z: number
  category: RingCategory
  radius: number
  points: number
}

export type TorontoElevator = {
  name: string
  x: number
  z: number
  radius: number
  strengthMps: number
  /** Height of the column above the ground under it. */
  riseM: number
}

const lead = (x: number, y: number, z: number, category: RingCategory, radius = 9.2): TorontoGate => ({
  x,
  y,
  z,
  category,
  radius,
  points: category === 'thermal' ? 180 : 120,
})

export const TORONTO_ELEVATORS: TorontoElevator[] = [
  {
    name: 'Harbour Elevator',
    x: 156,
    z: -6,
    radius: 92,
    strengthMps: 42,
    riseM: 820,
  },
  {
    name: 'Downtown Elevator',
    x: -188,
    z: 1488,
    radius: 96,
    strengthMps: 42,
    riseM: 820,
  },
]

/**
 * The wingsuit waits in the harbour column, just under the cap.
 * Ground height comes from the world, because the column is measured from it.
 */
/** Harbour column. The wingsuit sits just under its cap. */
export const TORONTO_WINGSUIT_COLUMN = TORONTO_ELEVATORS[0]

export function torontoWingsuitPickup(groundY: number): { x: number; y: number; z: number } {
  const col = TORONTO_WINGSUIT_COLUMN
  return { x: col.x, y: groundY + col.riseM - 55, z: col.z }
}

/** Amber wing on the early spiral, just above the ring the line already flies through. */
export const TORONTO_POWER_WING = (() => {
  const u = 3 / (SPIRAL_COUNT - 1)
  const deg = SPIRAL_START_DEG + SPIRAL_TURNS * 360 * u
  const a = (deg * Math.PI) / 180
  return {
    x: CN_X + Math.cos(a) * ORBIT_M,
    y: SPIRAL_Y0 + (SPIRAL_Y1 - SPIRAL_Y0) * u + 8,
    z: CN_Z + Math.sin(a) * ORBIT_M,
  }
})()

const FIRST_RING = spiralRing(0)
const LEAD_A = (SPIRAL_START_DEG * Math.PI) / 180
const LEAD_TX = -Math.sin(LEAD_A)
const LEAD_TZ = Math.cos(LEAD_A)
const LEAD_BACK = 115

export const TORONTO_GATES: TorontoGate[] = [
  // On the arrival tangent, so the first coin is straight ahead of the launch.
  lead(FIRST_RING.x - LEAD_TX * LEAD_BACK, 676, FIRST_RING.z - LEAD_TZ * LEAD_BACK, 'dive', 12.5),
  // One wide lap. A light look-down holds the drop. A moderate bank holds the turn.
  ...Array.from({ length: SPIRAL_COUNT }, (_, i) => spiralRing(i)),
  // The lap ends high on the west side. These five are the dive to the elevator,
  // in a line you can see ahead, clear of the dome.
  lead(-150, 360, 220, 'swoop', 16),
  lead(-130, 300, 120, 'swoop', 16),
  lead(-112, 230, 30, 'swoop', 15),
  lead(-20, 175, 8, 'swoop', 15),
  lead(60, 145, -6, 'swoop', 14),
  // Inside the harbour column. 15 m from (156, −6).
  lead(142, 124, -2, 'thermal', 12),
  // After the climb: a second line, high, toward the financial district.
  // First ring sits just outside the column near the top of the lift.
  lead(104, 858, 100, 'carve', 16),
  lead(230, 817, 150, 'carve'),
  lead(310, 774, 270, 'carve'),
  lead(200, 725, 390, 'carve'),
  lead(60, 677, 470, 'swoop'),
  lead(-50, 634, 560, 'swoop'),
  lead(-130, 588, 690, 'swoop'),
  lead(-200, 541, 830, 'swoop'),
  lead(-250, 497, 970, 'swoop'),
  lead(-318, 330, 1067, 'swoop', 8.0),
  lead(-230, 408, 1240, 'swoop'),
  lead(-170, 368, 1360, 'swoop'),
  // Inside the downtown column. 35 m from (−188, 1488).
  lead(-176, 339, 1455, 'thermal', 13),
]

const SLOPE_WORLDS = new Set([
  'whistler',
  'roldanillo',
  'himalayas',
  'matterhorn',
  'chamonix',
  'yosemite',
])

/** One line for the HUD. Toronto names the beat you are in. */
export function flightObjective(
  worldId: string,
  collected: number,
  total: number,
): string {
  if (worldId === 'toronto') {
    if (total > 0 && collected >= total) return 'Skyline complete. Power up and roam the city.'
    if (collected >= 19) return 'Cross downtown to the second elevator. Stay off the glass.'
    if (collected >= 18) return 'Elevator up. Next rings are at the top. Look down or turn to fly out.'
    if (collected >= 13) return 'Dive the line down to the elevator. Stay in the rings.'
    if (collected >= 1) return 'Each ring boosts you. Cut inside the tower and you explode.'
    return 'Ride the rings down to the harbour elevator. The wingsuit is at the top.'
  }
  if (total > 0 && collected >= total) return 'Line complete. Power up and roam.'
  if (SLOPE_WORLDS.has(worldId)) return 'Follow the rings down the mountain.'
  return 'Follow the rings through the city.'
}
