import type { AmbientAirState } from './types'
import {
  clamp,
  getAngleDeltaDegrees,
  getGroundDistanceMeters,
  getLocalOffsetMeters,
  offsetPositionByMeters,
  projectOffsetMeters,
  toRadians,
  wrapDegrees,
} from './geometry'
import { FLIGHT_TUNING } from './tuning'
import type { FlightSite, RidgeBand, ThermalSource } from '../sim/site-data'

export type RidgeAirMass = {
  ridgeLiftMetersPerSecond: number
  leeSinkMetersPerSecond: number
}

export type ThermalAirMass = {
  liftMetersPerSecond: number
  sinkMetersPerSecond: number
}

export type LocalAmbientAirState = AmbientAirState & {
  windGradientFactor: number
  airDensityKgPerCubicMeter: number
}

const { liftSources } = FLIGHT_TUNING

function getWindwardNormalHeadingDeg(ridge: RidgeBand, windHeadingDeg: number) {
  const normalA = wrapDegrees(ridge.axisHeadingDeg + 90)
  const normalB = wrapDegrees(ridge.axisHeadingDeg - 90)
  const upwindHeadingDeg = wrapDegrees(windHeadingDeg + 180)

  return Math.abs(getAngleDeltaDegrees(normalA, upwindHeadingDeg)) <=
    Math.abs(getAngleDeltaDegrees(normalB, upwindHeadingDeg))
    ? normalA
    : normalB
}

export function getRidgeAirMass(
  latitude: number,
  longitude: number,
  windHeadingDeg: number,
  windSpeedKmh: number,
  site: FlightSite,
): RidgeAirMass {
  if (!site.ridge) {
    const distanceFromLaunchMeters = getGroundDistanceMeters(
      latitude,
      longitude,
      site.latitude,
      site.longitude,
    )
    const ridgeAlignment =
      Math.cos(toRadians(windHeadingDeg - site.prevailingWindHeadingDeg))
    const terrainWindow = clamp(
      1 - distanceFromLaunchMeters / liftSources.fallbackRidgeTerrainWindowMeters,
      0,
      1,
    )
    const windFactor = clamp(
      (windSpeedKmh - liftSources.fallbackRidgeWindStartKmh) /
        liftSources.fallbackRidgeWindRangeKmh,
      0,
      liftSources.fallbackRidgeWindCap,
    )

    return {
      ridgeLiftMetersPerSecond:
        Math.max(0, ridgeAlignment) *
        site.baseRidgeLiftMetersPerSecond *
        terrainWindow *
        windFactor,
      leeSinkMetersPerSecond: 0,
    }
  }

  const windFactor = clamp(
    (windSpeedKmh - liftSources.ridgeWindStartKmh) /
      liftSources.ridgeWindRangeKmh,
    0,
    liftSources.ridgeWindCap,
  )
  const offset = getLocalOffsetMeters(
    latitude,
    longitude,
    site.ridge.latitude,
    site.ridge.longitude,
  )
  const alongMeters = projectOffsetMeters(offset, site.ridge.axisHeadingDeg)
  const windwardNormalHeadingDeg = getWindwardNormalHeadingDeg(
    site.ridge,
    windHeadingDeg,
  )
  const crossWindwardMeters = projectOffsetMeters(offset, windwardNormalHeadingDeg)
  const alongFactor = clamp(
    1 - Math.abs(alongMeters) / (site.ridge.lengthMeters / 2),
    0,
    1,
  )

  if (alongFactor <= 0) {
    return {
      ridgeLiftMetersPerSecond: 0,
      leeSinkMetersPerSecond: 0,
    }
  }

  if (crossWindwardMeters >= 0) {
    const depthFactor = clamp(
      1 - crossWindwardMeters / site.ridge.windwardDepthMeters,
      0,
      1,
    )

    return {
      ridgeLiftMetersPerSecond:
        site.ridge.peakLiftMetersPerSecond *
        alongFactor *
        depthFactor *
        windFactor,
      leeSinkMetersPerSecond: 0,
    }
  }

  const leeFactor = clamp(
    1 - Math.abs(crossWindwardMeters) / site.ridge.leeDepthMeters,
    0,
    1,
  )

  return {
    ridgeLiftMetersPerSecond: 0,
    leeSinkMetersPerSecond:
      site.ridge.leeSinkMetersPerSecond * alongFactor * leeFactor * windFactor,
  }
}

export function getDriftedThermalCenter(
  thermal: ThermalSource,
  atmosphere: AmbientAirState,
  elapsedSeconds: number,
) {
  const driftScale =
    thermal.driftFactor ?? liftSources.defaultThermalDriftFactor
  const driftMeters =
    (atmosphere.windSpeedKmh / 3.6) * elapsedSeconds * driftScale
  const headingRadians = toRadians(atmosphere.windHeadingDeg)

  return offsetPositionByMeters(
    thermal.latitude,
    thermal.longitude,
    Math.sin(headingRadians) * driftMeters,
    Math.cos(headingRadians) * driftMeters,
  )
}

export function getThermalAirMass(
  latitude: number,
  longitude: number,
  elapsedSeconds: number,
  atmosphere: AmbientAirState,
  site: FlightSite,
): ThermalAirMass {
  return site.thermals.reduce(
    (accumulator, thermal) => {
      const thermalCenter = getDriftedThermalCenter(
        thermal,
        atmosphere,
        elapsedSeconds,
      )
      const distanceMeters = getGroundDistanceMeters(
        latitude,
        longitude,
        thermalCenter.latitude,
        thermalCenter.longitude,
      )
      const coreRadiusMeters =
        thermal.coreRadiusMeters ??
        thermal.radiusMeters * liftSources.thermalCoreRadiusMultiplier

      if (distanceMeters <= coreRadiusMeters) {
        const coreFactor = clamp(1 - distanceMeters / coreRadiusMeters, 0, 1)
        return {
          liftMetersPerSecond:
            accumulator.liftMetersPerSecond +
            thermal.liftMetersPerSecond *
              (liftSources.thermalCoreBaseFraction +
                coreFactor * liftSources.thermalCoreCenteringBonus),
          sinkMetersPerSecond: accumulator.sinkMetersPerSecond,
        }
      }

      if (distanceMeters <= thermal.radiusMeters) {
        const edgeFactor = clamp(
          1 - (distanceMeters - coreRadiusMeters) /
            Math.max(thermal.radiusMeters - coreRadiusMeters, 1),
          0,
          1,
        )

        return {
          liftMetersPerSecond:
            accumulator.liftMetersPerSecond +
            thermal.liftMetersPerSecond *
              edgeFactor *
              edgeFactor *
              liftSources.thermalEdgeLiftFraction,
          sinkMetersPerSecond: accumulator.sinkMetersPerSecond,
        }
      }

      const sinkRingMetersPerSecond = thermal.sinkRingMetersPerSecond ?? 0
      const sinkRingRadiusMeters =
        thermal.radiusMeters * liftSources.thermalSinkRingRadiusMultiplier

      if (sinkRingMetersPerSecond <= 0 || distanceMeters > sinkRingRadiusMeters) {
        return accumulator
      }

      const sinkFactor = clamp(
        1 - (distanceMeters - thermal.radiusMeters) /
          Math.max(sinkRingRadiusMeters - thermal.radiusMeters, 1),
        0,
        1,
      )

      return {
        liftMetersPerSecond: accumulator.liftMetersPerSecond,
        sinkMetersPerSecond:
          accumulator.sinkMetersPerSecond +
          sinkRingMetersPerSecond * sinkFactor,
      }
    },
    {
      liftMetersPerSecond: 0,
      sinkMetersPerSecond: 0,
    },
  )
}

export function getTurbulenceVerticalGust(
  elapsedSeconds: number,
  latitude: number,
  longitude: number,
  turbulence: number,
) {
  const phase = elapsedSeconds * 1.55 + latitude * 34 + longitude * 41
  const secondaryPhase = elapsedSeconds * 2.7 + latitude * 12 - longitude * 19

  return (
    (Math.sin(phase) * liftSources.turbulencePrimaryMix +
      Math.sin(secondaryPhase) * liftSources.turbulenceSecondaryMix) *
    turbulence *
    liftSources.turbulenceVerticalGustScale
  )
}

export function getAirDensityKgPerCubicMeter(altitudeMeters: number) {
  return 1.225 * Math.exp(-Math.max(0, altitudeMeters) / 8_500)
}

export function getLocalAmbientAirState(
  atmosphere: AmbientAirState,
  altitudeMeters: number,
  groundClearanceMeters: number,
): LocalAmbientAirState {
  const normalizedHeight = clamp(
    groundClearanceMeters / liftSources.windGradientReferenceHeightMeters,
    0,
    1,
  )
  const windGradientFactor =
    liftSources.windGradientSurfaceFactor +
    (1 - liftSources.windGradientSurfaceFactor) *
      Math.pow(normalizedHeight, liftSources.windGradientExponent)
  const airDensityKgPerCubicMeter = getAirDensityKgPerCubicMeter(altitudeMeters)

  return {
    windHeadingDeg: atmosphere.windHeadingDeg,
    windSpeedKmh: atmosphere.windSpeedKmh * windGradientFactor,
    turbulence: clamp(
      atmosphere.turbulence +
        (1 - normalizedHeight) * liftSources.surfaceTurbulenceBoost,
      0,
      1,
    ),
    windGradientFactor,
    airDensityKgPerCubicMeter,
  }
}
