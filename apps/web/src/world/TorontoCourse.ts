import type { RingCategory } from './CoinRings'

/**
 * Toronto in local flight space (launch at the origin, +Z toward heading 58°).
 * CN Tower (−25, 339), top 633 m MSL. Rogers Centre (−10, 111), roof 166 m.
 * First Canadian Place (−370, 1067), roof 382 m.
 *
 * The first line spirals close around the tower, then skims the Rogers glass
 * into the harbour elevator. The ring is the safe line. Inside it is concrete.
 * That column lifts back above the launch, where a second line passes the
 * east face of First Canadian Place into another column.
 */

const CN_X = -24.8
const CN_Z = 338.5
const ORBIT_M = 34
const SPIRAL_START_DEG = -80
const SPIRAL_TURNS = 1.72
const SPIRAL_Y0 = 668
const SPIRAL_Y1 = 236
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
    radius: 9.6 - u,
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

export const TORONTO_GATES: TorontoGate[] = [
  // High lead-in. The whole tower is ahead, the dome still below.
  lead(6, 688, 125, 'dive', 10.5),
  // One long descending spiral around the shaft.
  ...Array.from({ length: SPIRAL_COUNT }, (_, i) => spiralRing(i)),
  // West face of the dome, then around the south-west corner into the harbour.
  // Centers sit ~22 m off the solid glass. The hoop is safe. Drifting in is not.
  lead(-102, 200, 248, 'swoop', 8.6),
  lead(-90, 156, 148, 'swoop', 7.6),
  lead(-90, 134, 112, 'swoop', 7.4),
  lead(-90, 118, 80, 'swoop', 7.4),
  lead(-90, 108, 37, 'swoop', 8.2),
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
  hasPower = false,
): string {
  if (worldId === 'toronto') {
    if (total > 0 && collected >= total) return 'Skyline complete. Power up and roam the city.'
    if (collected >= 19) return 'Cross downtown to the second elevator. Stay off the glass.'
    if (collected >= 18) return 'Elevator up. Next rings are at the top. Look down or turn to fly out.'
    if (collected >= 13) return 'Skim the Rogers glass. Stay in the rings.'
    if (collected >= 1) {
      return hasPower
        ? 'Each ring boosts you. Cut inside the tower and you explode.'
        : 'Each ring boosts you. The amber wing is on this line.'
    }
    return hasPower
      ? 'Follow the rings. They boost your speed. Drift into a tower and you explode.'
      : 'Rings boost your speed. Drift into a tower and you explode. Grab the amber wing.'
  }
  if (total > 0 && collected >= total) return 'Line complete. Power up and roam.'
  if (SLOPE_WORLDS.has(worldId)) return 'Follow the rings down the mountain.'
  return 'Follow the rings through the city.'
}
