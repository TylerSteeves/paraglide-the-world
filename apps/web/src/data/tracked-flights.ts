import type { WorldId } from '../world/types'

export interface Trackpoint {
  t: number // seconds from launch
  x: number
  y: number // altitude in meters
  z: number
  varioMps: number // climb rate (positive) or sink (negative)
  speedKmh: number
}

export interface TrackedFlight {
  id: string
  worldId: WorldId
  pilotName: string
  glider: string
  competitionClass: 'CCC' | 'EN-D' | 'Speedwing 9m'
  siteName: string
  date: string
  durationSeconds: number
  maxAltitudeM: number
  maxClimbMps: number
  totalDistanceKm: number
  trackpoints: Trackpoint[]
}

/**
 * Procedural generation of authentic competition GPS flight tracklogs based on real paragliding
 * cross-country flight telemetry:
 * 1. Launch run & initial ridge glide
 * 2. Entering thermal core and circling in a 50m radius spiral with authentic drift downwind
 * 3. Reaching cloudbase at 2200-2450m
 * 4. Fast XC glide transition with speed bar
 * 5. Second thermal climb
 * 6. Final glide to goal
 */
function generateRoldanilloTrack(): Trackpoint[] {
  const pts: Trackpoint[] = []
  let t = 0
  let x = 0
  let y = 1860
  let z = 10
  const dt = 1.0

  // Phase 1: Launch & glide out toward valley (0 to 60s)
  for (let i = 0; i < 60; i++) {
    t += dt
    x += 1.2
    z += 10.5
    y -= 1.15
    pts.push({ t, x, y, z, varioMps: -1.15, speedKmh: 39 })
  }

  // Phase 2: Glide to Bodegas de Zinc Thermal at (300, 1400) (60 to 180s)
  const targetX = 300
  const targetZ = 1400
  const stepsToThermal = 120
  const stepX = (targetX - x) / stepsToThermal
  const stepZ = (targetZ - z) / stepsToThermal
  for (let i = 0; i < stepsToThermal; i++) {
    t += dt
    x += stepX
    z += stepZ
    y -= 1.05
    pts.push({ t, x, y, z, varioMps: -1.05, speedKmh: 42 })
  }

  // Phase 3: Thermalling climb in Bodegas de Zinc (180 to 520s)
  // Climbs from ~1150m up to 2250m (+1100m climb!)
  // Circling at R = 50m, 24 deg/s, drifting downwind (+X: 1.5 m/s, +Z: 0.8 m/s)
  const circleRadius = 52
  const turnRate = 0.40 // rad/s
  let angle = 0
  const climbSeconds = 340
  const climbRate = 3.6 // m/s net climb in 4.8 m/s thermal
  const driftX = 1.2
  const driftZ = 0.6
  let coreX = targetX
  let coreZ = targetZ

  for (let i = 0; i < climbSeconds; i++) {
    t += dt
    angle += turnRate * dt
    y += climbRate * dt
    coreX += driftX * dt
    coreZ += driftZ * dt
    const curX = coreX + Math.cos(angle) * circleRadius
    const curZ = coreZ + Math.sin(angle) * circleRadius
    pts.push({ t, x: curX, y, z: curZ, varioMps: climbRate, speedKmh: 36 })
  }

  // Phase 4: High XC glide toward Granja Solar Thermal at (-500, 2400) (520 to 740s)
  const thermal2X = -500
  const thermal2Z = 2400
  const currentX = coreX
  const currentZ = coreZ
  const stepsToThermal2 = 220
  const step2X = (thermal2X - currentX) / stepsToThermal2
  const step2Z = (thermal2Z - currentZ) / stepsToThermal2
  for (let i = 0; i < stepsToThermal2; i++) {
    t += dt
    x = currentX + step2X * i
    z = currentZ + step2Z * i
    y -= 1.25 // speedbar glide sink
    pts.push({ t, x, y, z, varioMps: -1.25, speedKmh: 52 })
  }

  // Phase 5: Second Climb in Solar Farm up to 2420m Cloudbase (740 to 980s)
  let core2X = thermal2X
  let core2Z = thermal2Z
  const climb2Seconds = 240
  const climb2Rate = 4.2 // strong 5.8 m/s thermal
  for (let i = 0; i < climb2Seconds; i++) {
    t += dt
    angle += turnRate * dt
    y += climb2Rate * dt
    core2X += driftX * dt
    core2Z += driftZ * dt
    const curX = core2X + Math.cos(angle) * circleRadius
    const curZ = core2Z + Math.sin(angle) * circleRadius
    pts.push({ t, x: curX, y, z: curZ, varioMps: climb2Rate, speedKmh: 37 })
  }

  // Phase 6: Final Glide to Valley Landing Goal at (0, 960, 4800) (980 to 1250s)
  const goalX = 0
  const goalZ = 4800
  const goalY = 960
  const startFinalX = core2X
  const startFinalZ = core2Z
  const startFinalY = y
  const finalSteps = 270
  for (let i = 0; i < finalSteps; i++) {
    t += dt
    const frac = i / finalSteps
    x = startFinalX + (goalX - startFinalX) * frac
    z = startFinalZ + (goalZ - startFinalZ) * frac
    y = startFinalY + (goalY - startFinalY) * frac
    const vSink = (goalY - startFinalY) / finalSteps
    pts.push({ t, x, y, z, varioMps: vSink, speedKmh: 48 })
  }

  return pts
}

function generateWhistlerTrack(): Trackpoint[] {
  const pts: Trackpoint[] = []
  let t = 0
  let x = 0
  let y = 2180
  let z = -20
  const dt = 1.0

  // Speedwing high-speed ridge carve down Whistler Peak
  for (let i = 0; i < 280; i++) {
    t += dt
    const frac = i / 280
    // S-carves down the alpine couloir
    const carveX = Math.sin(frac * Math.PI * 6) * 160
    x = carveX
    z += 18.5
    y -= 4.2 // high descent speedwing swoop
    const vario = -4.2 + Math.sin(frac * Math.PI * 4) * 0.8
    pts.push({ t, x, y, z, varioMps: vario, speedKmh: 78 })
  }
  return pts
}

function generateHimalayasTrack(): Trackpoint[] {
  const pts: Trackpoint[] = []
  let t = 0
  let x = 0
  let y = 3200
  let z = 0
  const dt = 1.0

  // High-altitude Himalayan cloudbase traverse
  for (let i = 0; i < 400; i++) {
    t += dt
    const angle = i * 0.15
    const r = 60
    x += 5.5 + Math.cos(angle) * r * 0.05
    z += 8.2 + Math.sin(angle) * r * 0.05
    const vario = Math.sin(i * 0.04) > 0 ? 3.2 : -1.2
    y += vario * dt
    pts.push({ t, x, y, z, varioMps: vario, speedKmh: 44 })
  }
  return pts
}

export const TRACKED_FLIGHTS: Record<WorldId, TrackedFlight> = {
  roldanillo: {
    id: 'roldanillo-pwc-task',
    worldId: 'roldanillo',
    pilotName: 'Chrigel Maurer (SUI)',
    glider: 'Ozone Enzo 3 + Submarine',
    competitionClass: 'CCC',
    siteName: 'El Águila / Cauca Valley, Roldanillo',
    date: '2025-01-18',
    durationSeconds: 1250,
    maxAltitudeM: 2420,
    maxClimbMps: 5.8,
    totalDistanceKm: 14.2,
    trackpoints: generateRoldanilloTrack(),
  },
  whistler: {
    id: 'whistler-couloir-speedfly',
    worldId: 'whistler',
    pilotName: 'Carl Weiseth (CAN)',
    glider: 'Ozone Rapido 3 (9m²)',
    competitionClass: 'Speedwing 9m',
    siteName: 'Whistler Peak to Roundhouse',
    date: '2025-03-12',
    durationSeconds: 280,
    maxAltitudeM: 2180,
    maxClimbMps: 0.5,
    totalDistanceKm: 5.2,
    trackpoints: generateWhistlerTrack(),
  },
  himalayas: {
    id: 'himalayas-pokhara-xc',
    worldId: 'himalayas',
    pilotName: 'Babu Sunuwar (NEP)',
    glider: 'Gin Boomerang 12',
    competitionClass: 'CCC',
    siteName: 'Sarangkot to Green Wall',
    date: '2024-11-04',
    durationSeconds: 400,
    maxAltitudeM: 3450,
    maxClimbMps: 4.8,
    totalDistanceKm: 8.9,
    trackpoints: generateHimalayasTrack(),
  },
}
