import type { WorldDataSnapshot } from '@wilder-future/world-data-engine'
import type { AmbientAirState } from '../flight/types'
import type { FlightSite } from '../sim/site-data'

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

export function snapshotToAmbientAir(
  snapshot: Readonly<WorldDataSnapshot> | null,
): AmbientAirState | null {
  const atmosphere = snapshot?.domains.atmosphere?.data

  if (!atmosphere) {
    return null
  }

  return {
    // The flight model advects toward a heading; providers use meteorological
    // direction-from convention, so this boundary owns the 180-degree conversion.
    windHeadingDeg: (atmosphere.windDirectionFromDeg + 180) % 360,
    windSpeedKmh: Math.max(0, atmosphere.windSpeedMps * 3.6),
    turbulence: clamp(atmosphere.turbulence01 ?? 0.16, 0, 1),
  }
}

export function applySnapshotToFlightSite(
  site: FlightSite,
  snapshot: Readonly<WorldDataSnapshot> | null,
): FlightSite {
  const atmosphere = snapshotToAmbientAir(snapshot)
  const terrain = snapshot?.domains.terrain?.data

  if (!atmosphere && !terrain) {
    return site
  }

  const thermalScale =
    terrain?.thermalPotential01 == null
      ? 1
      : 0.35 + clamp(terrain.thermalPotential01, 0, 1) * 1.3
  const windScale = atmosphere
    ? clamp(atmosphere.windSpeedKmh / Math.max(site.windSpeedKmh, 1), 0.45, 1.8)
    : 1

  return {
    ...site,
    // Open-Meteo's elevation is a coarse weather-grid coordinate, not a launch
    // surface. Authored/Cesium terrain remains authoritative in this app.
    prevailingWindHeadingDeg:
      atmosphere?.windHeadingDeg ?? site.prevailingWindHeadingDeg,
    windSpeedKmh: atmosphere?.windSpeedKmh ?? site.windSpeedKmh,
    baseRidgeLiftMetersPerSecond:
      site.baseRidgeLiftMetersPerSecond * windScale,
    ridge: site.ridge
      ? {
          ...site.ridge,
          peakLiftMetersPerSecond: site.ridge.peakLiftMetersPerSecond * windScale,
          leeSinkMetersPerSecond: site.ridge.leeSinkMetersPerSecond * windScale,
        }
      : undefined,
    thermals: site.thermals.map((thermal) => ({
      ...thermal,
      liftMetersPerSecond: thermal.liftMetersPerSecond * thermalScale,
    })),
  }
}

export function getSnapshotValidUntil(snapshot: Readonly<WorldDataSnapshot>) {
  const validUntil = [
    snapshot.domains.atmosphere?.time.validUntil,
    snapshot.domains.terrain?.time.validUntil,
  ]
    .filter((value): value is string => value != null)
    .map((value) => Date.parse(value))
    .filter(Number.isFinite)

  return validUntil.length > 0 ? new Date(Math.min(...validUntil)).toISOString() : null
}

export function getSnapshotKind(snapshot: Readonly<WorldDataSnapshot>) {
  if (snapshot.delivery.mode === 'replay') {
    return 'replay' as const
  }

  const atmosphereNature = snapshot.domains.atmosphere?.time.nature

  if (atmosphereNature) {
    return atmosphereNature
  }

  if (snapshot.delivery.mode === 'authored-fallback') {
    return 'authored' as const
  }

  return snapshot.domains.terrain?.time.nature ?? ('authored' as const)
}

