import type { ThermalZone, Vector3Like, ThermalFluidSample } from './types'

/**
 * 3D Toroidal Atmospheric Convective Fluid Field
 *
 * Simulates real fluid dynamics of thermal convective bubbles:
 * 1. Convective Core: Hot, buoyant rising parcel (vy > 0, temp +5.5°C) with drafting suction
 * 2. Mass Continuity (div u = 0): Inward radial drafting suction (vr < 0) at base & mid levels,
 *    and outward expansion (vr > 0) near cloudbase
 * 3. Azimuthal Swirl (v_theta): Cyclonic circulation aiding paraglider centering
 * 4. Descending Cold Tail Collar (vy < 0, temp -3.4°C): Compensating downdraft wrapping around the bubble
 * 5. Triboelectric Static Electricity Field: Charge separation and ionization across the high-shear contact boundary
 */
export function calculateToroidalThermalFluid(
  thermals: ThermalZone[],
  sampleGroundH: (x: number, z: number) => number,
  x: number,
  y: number,
  z: number,
  timeSeconds: number = 0,
  windVector?: Vector3Like,
): ThermalFluidSample {
  const result: ThermalFluidSample = {
    velocity: { x: 0, y: 0, z: 0 },
    temperatureAnomalyC: 0,
    staticChargeField: 0,
    isDraftingZone: false,
  }

  if (!thermals || thermals.length === 0) {
    return result
  }

  const tiltRate = 0.22 // Wind tilt displacement per meter of height

  for (const t of thermals) {
    const groundH = sampleGroundH(t.center.x, t.center.z)
    const cloudbase = t.topAltitude ?? (t.center.y + 1500)

    if (y < groundH - 50 || y > cloudbase + 120) continue

    const hOffset = Math.max(0, y - groundH)
    const altFrac = Math.min(1.0, hOffset / Math.max(1, cloudbase - groundH))

    // Downwind tilt of the convective column
    const driftX = (windVector?.x ?? 0) * tiltRate * hOffset
    const driftZ = (windVector?.z ?? 0) * tiltRate * hOffset
    const curCenterX = t.center.x + driftX
    const curCenterZ = t.center.z + driftZ

    const dx = x - curCenterX
    const dz = z - curCenterZ
    const distHoriz = Math.hypot(dx, dz)

    // Conical thermal expansion toward cloudbase
    const expansion = 1.0 + ((t.expansionRatio ?? 2.0) - 1.0) * altFrac
    const curRadius = Math.max(15, t.radius * expansion)

    // Breathing bubble pulse: traveling convective waves ascending toward cloudbase
    const period = t.cyclePeriodSeconds ?? 60
    const phase = t.cyclePhaseOffset ?? 0
    const wavePhase = 2 * Math.PI * (timeSeconds / period - hOffset / 500) + phase
    const bubbleWave = Math.sin(wavePhase)
    // Continuous buoyant column with pulsating hot bubble surges: [0.60, 1.25]
    const bubbleFactor = 0.88 + 0.32 * bubbleWave

    // Horizontal radial and azimuthal unit vectors
    let rx = 0
    let rz = 0
    let tx = 0
    let tz = 0
    if (distHoriz > 0.001) {
      rx = dx / distHoriz
      rz = dz / distHoriz
      tx = -rz // Cyclonic rotation
      tz = rx
    }

    if (distHoriz < curRadius) {
      const radialFrac = distHoriz / curRadius
      const altFactor = Math.sin(altFrac * Math.PI * 0.88)

      // 1. Vertical Updraft (vy)
      let vy = 0
      if (radialFrac <= 0.45) {
        // High-lift sweet spot plateau
        const coreShape = 1.0 - 0.18 * Math.pow(radialFrac / 0.45, 2)
        vy = t.strengthMps * coreShape * bubbleFactor * (0.65 + altFactor * 0.55)
        result.temperatureAnomalyC += 5.5 * (1.0 - radialFrac) * (0.7 + 0.3 * bubbleWave)
        result.isDraftingZone = true
      } else {
        // Smooth buoyant carousel
        const normFrac = (radialFrac - 0.45) / 0.55
        const carouselShape = 0.85 * Math.max(0, 1.0 - Math.pow(normFrac, 1.6))
        vy = t.strengthMps * carouselShape * bubbleFactor * (0.65 + altFactor * 0.55)
        result.temperatureAnomalyC += 2.8 * (1.0 - normFrac)
      }

      // 2. Radial Inflow / Outflow (Mass continuity div u = 0)
      let vr = 0
      if (altFrac < 0.65) {
        // Inward drafting suction pulling glider and streamlines toward core
        vr = -0.32 * t.strengthMps * Math.sin(Math.PI * radialFrac) * (1.0 - altFrac / 0.8) * bubbleFactor
      } else {
        // Outward expansion / anvil spillover near cloudbase
        vr = 0.28 * t.strengthMps * Math.sin(Math.PI * radialFrac) * ((altFrac - 0.65) / 0.35)
      }

      // 3. Azimuthal Swirl (Cyclonic vorticity)
      const vTheta = 0.22 * t.strengthMps * radialFrac * Math.exp(-radialFrac) * (0.6 + 0.4 * altFactor)

      // Accumulate 3D velocity
      result.velocity.x += vr * rx + vTheta * tx
      result.velocity.y += vy
      result.velocity.z += vr * rz + vTheta * tz

      // 4. Triboelectric Static Electricity at Shear Boundary (r > 0.82 R)
      if (radialFrac >= 0.82) {
        const shearFrac = (radialFrac - 0.82) / 0.18
        const charge = shearFrac * 0.88 * Math.min(1.0, altFrac * 2.5)
        result.staticChargeField = Math.max(result.staticChargeField, charge)
      }
    } else if (distHoriz >= curRadius && distHoriz < curRadius * 1.45) {
      // 5. Compensating Descending "Cold Tail" Sink Collar
      const sinkFrac = 1.0 - (distHoriz - curRadius) / (curRadius * 0.45)
      const coldTailBoost = 1.0 + 0.4 * Math.max(0, -bubbleWave)
      const vySink = -2.2 * sinkFrac * coldTailBoost

      // Subtle outer entrainment suction into the sinking collar
      const vrSink = -0.12 * t.strengthMps * sinkFrac * (1.0 - altFrac)

      result.velocity.x += vrSink * rx
      result.velocity.y += vySink
      result.velocity.z += vrSink * rz

      result.temperatureAnomalyC -= 3.4 * sinkFrac
      const shearCharge = sinkFrac * 0.95 * Math.min(1.0, altFrac * 2.5)
      result.staticChargeField = Math.max(result.staticChargeField, shearCharge)
    }
  }

  return result
}
