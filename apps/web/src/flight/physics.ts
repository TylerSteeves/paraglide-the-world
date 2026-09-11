import type { HomeRowControlState } from '../sim/home-row-controls'
import { derivesFromHomeRowControls } from '../sim/home-row-controls'
import type { FlightAssistProfile } from '../sim/flight-assist'
import type { FlightSite } from '../sim/site-data'
import {
  getLocalAmbientAirState,
  getRidgeAirMass,
  getThermalAirMass,
  getTurbulenceVerticalGust,
} from './atmosphere'
import {
  approach,
  clamp,
  getMetersPerLongitudeDegree,
  toDegrees,
  toRadians,
  wrapDegrees,
} from './geometry'
import { getLandingRating, getLandingZoneMetrics } from './landing'
import { FLIGHT_TUNING } from './tuning'
import type { AmbientAirState, FlightPhase, FlightSimState } from './types'

const {
  attitude,
  baselineWing,
  controls: controlTuning,
  landing,
  phaseModel,
  stability,
} = FLIGHT_TUNING

export type FlightStepInput = {
  deltaSeconds: number
  controls: HomeRowControlState
  site: FlightSite
  terrainHeightMeters: number | null
  atmosphere?: AmbientAirState | null
  assist?: FlightAssistProfile | null
}

function getTargetAirspeedKmh(
  symmetricBrake: number,
  speedBarTravel: number,
  assist: FlightAssistProfile,
) {
  const targetAirspeed =
    baselineWing.trimAirspeedKmh +
    speedBarTravel * controlTuning.speedBarAirspeedGainKmh -
    symmetricBrake * controlTuning.symmetricBrakeAirspeedLossKmh -
    symmetricBrake * symmetricBrake * controlTuning.deepBrakeAirspeedLossKmh +
    (assist.inputResponsiveness - 0.9) * controlTuning.responsivenessAirspeedGainKmh

  return clamp(
    targetAirspeed,
    baselineWing.minControllableAirspeedKmh,
    baselineWing.maxAirspeedKmh,
  )
}

function getTurnRateDegPerSecond(bankDeg: number, airspeedKmh: number) {
  const airspeedMetersPerSecond = Math.max(
    airspeedKmh / 3.6,
    baselineWing.turnRateMinAirspeedMetersPerSecond,
  )
  const bankRadians = toRadians(bankDeg)

  return toDegrees((9.81 * Math.tan(bankRadians)) / airspeedMetersPerSecond)
}

function getAngleOfAttackDeg(
  pitchDeg: number,
  verticalSpeedMetersPerSecond: number,
  airspeedKmh: number,
  symmetricBrake: number,
  speedBarTravel: number,
  flareEffectiveness: number,
  turbulence: number,
) {
  const airspeedMetersPerSecond = Math.max(airspeedKmh / 3.6, 0.1)
  const flightPathAngleDeg = toDegrees(
    Math.atan2(verticalSpeedMetersPerSecond, airspeedMetersPerSecond),
  )

  return clamp(
    attitude.trimAngleOfAttackDeg +
      pitchDeg -
      flightPathAngleDeg +
      symmetricBrake * attitude.brakeAngleOfAttackGainDeg -
      speedBarTravel * attitude.speedBarAngleOfAttackLossDeg +
      flareEffectiveness * attitude.flareAngleOfAttackGainDeg +
      turbulence * attitude.turbulenceAngleOfAttackGainDeg,
    attitude.minAngleOfAttackDeg,
    attitude.maxAngleOfAttackDeg,
  )
}

function getAngleOfAttackStallWarning(angleOfAttackDeg: number) {
  return clamp(
    (angleOfAttackDeg - stability.stallAngleOfAttackStartDeg) /
      stability.stallAngleOfAttackRangeDeg,
    0,
    1,
  )
}

function getGroundEffectFactor(groundClearanceMeters: number, airspeedKmh: number) {
  const heightFactor = clamp(
    (landing.groundEffectHeightMeters - groundClearanceMeters) /
      landing.groundEffectHeightMeters,
    0,
    1,
  )
  const speedFactor = clamp(
    (airspeedKmh - baselineWing.flareMinAirspeedKmh) /
      (baselineWing.bestGlideReferenceKmh - baselineWing.flareMinAirspeedKmh),
    0,
    1,
  )

  return heightFactor * speedFactor
}

function getGlideRatio(
  groundSpeedKmh: number,
  verticalSpeedMetersPerSecond: number,
) {
  if (verticalSpeedMetersPerSecond >= -0.05) {
    return 0
  }

  return (groundSpeedKmh / 3.6) / Math.max(-verticalSpeedMetersPerSecond, 0.05)
}

function getFlightPhase(
  elapsedSeconds: number,
  groundClearanceMeters: number,
  flareEffectiveness: number,
): FlightPhase {
  let flightPhase: FlightPhase =
    elapsedSeconds < phaseModel.launchDurationSeconds ? 'launch' : 'soaring'

  if (groundClearanceMeters < phaseModel.approachHeightMeters) {
    flightPhase = 'approach'
  }

  if (
    flareEffectiveness > phaseModel.flareEffectivenessThreshold &&
    groundClearanceMeters < phaseModel.flarePhaseHeightMeters
  ) {
    flightPhase = 'flare'
  }

  return flightPhase
}

export function createInitialFlightState(
  site: FlightSite,
  terrainHeightMeters: number = site.launchAltitudeMeters,
): FlightSimState {
  return {
    latitude: site.latitude,
    longitude: site.longitude,
    altitudeMeters: terrainHeightMeters + site.spawnAglMeters,
    terrainHeightMeters,
    headingDeg: site.prevailingWindHeadingDeg,
    bankDeg: 0,
    pitchDeg: attitude.trimPitchDeg,
    airspeedKmh: baselineWing.trimAirspeedKmh,
    groundSpeedKmh: baselineWing.trimAirspeedKmh,
    verticalSpeedMetersPerSecond: 0.1,
    angleOfAttackDeg: attitude.trimAngleOfAttackDeg,
    loadFactor: 1,
    glideRatio: baselineWing.bestGlideReferenceKmh / 3.6 / baselineWing.baselineSinkMetersPerSecond,
    ridgeLiftMetersPerSecond: site.baseRidgeLiftMetersPerSecond,
    thermalLiftMetersPerSecond: 0,
    airMassSinkMetersPerSecond: 0,
    groundClearanceMeters: site.spawnAglMeters,
    distanceKm: 0,
    elapsedSeconds: 0,
    turnRateDegPerSecond: 0,
    stallWarning: 0,
    flareEffectiveness: 0,
    landingZoneDistanceMeters: null,
    landingApproachErrorDeg: null,
    landingRating: 'none',
    flightPhase: 'launch',
    debug: {
      airDensityKgPerCubicMeter: 1.225,
      windGradientFactor: 1,
      groundEffectLiftMetersPerSecond: 0,
      baseSinkMetersPerSecond: 0,
      inducedTurnSinkMetersPerSecond: 0,
      brakeSinkMetersPerSecond: 0,
      stallSinkMetersPerSecond: 0,
      turbulenceLiftMetersPerSecond: 0,
      flareLiftMetersPerSecond: 0,
      totalSinkMetersPerSecond: 0,
    },
  }
}

export function resetFlightStateForSite(
  site: FlightSite,
  terrainHeightMeters: number | null,
) {
  return createInitialFlightState(
    site,
    terrainHeightMeters ?? site.launchAltitudeMeters,
  )
}

export function stepFlightState(
  currentState: FlightSimState,
  input: FlightStepInput,
): FlightSimState {
  const controls = derivesFromHomeRowControls(input.controls)
  const assist = input.assist ?? {
    inputResponsiveness: 0.9,
    coordinationAssist: 0,
    turbulenceDamping: 0,
    recoveryAssist: 0,
  }
  const atmosphere = input.atmosphere ?? {
    windHeadingDeg: input.site.prevailingWindHeadingDeg,
    windSpeedKmh: input.site.windSpeedKmh,
    turbulence: 0.16,
  }
  const terrainHeightMeters =
    input.terrainHeightMeters ?? currentState.terrainHeightMeters

  if (currentState.flightPhase === 'landed' || currentState.flightPhase === 'crashed') {
    return {
      ...currentState,
      altitudeMeters: terrainHeightMeters,
      terrainHeightMeters,
      airspeedKmh: 0,
      groundSpeedKmh: 0,
      verticalSpeedMetersPerSecond: 0,
      angleOfAttackDeg: 0,
      loadFactor: 1,
      glideRatio: 0,
      groundClearanceMeters: 0,
      bankDeg: approach(currentState.bankDeg, 0, input.deltaSeconds * 18),
      pitchDeg: approach(currentState.pitchDeg, 0, input.deltaSeconds * 12),
      turnRateDegPerSecond: 0,
      elapsedSeconds: currentState.elapsedSeconds + input.deltaSeconds,
      debug: {
        ...currentState.debug,
        windGradientFactor: 0,
        groundEffectLiftMetersPerSecond: 0,
        turbulenceLiftMetersPerSecond: 0,
        flareLiftMetersPerSecond: 0,
      },
    }
  }

  const localAtmosphere = getLocalAmbientAirState(
    atmosphere,
    currentState.altitudeMeters,
    currentState.groundClearanceMeters,
  )
  const effectiveTurbulence = clamp(
    localAtmosphere.turbulence * (1 - assist.turbulenceDamping),
    0,
    1,
  )
  let airspeedKmh = approach(
    currentState.airspeedKmh,
    getTargetAirspeedKmh(
      controls.symmetricBrake,
      controls.speedBarTravel,
      assist,
    ),
    input.deltaSeconds *
      controlTuning.airspeedResponseRate *
      assist.inputResponsiveness,
  )
  const controlStallWarning = clamp(
    (controls.symmetricBrake - stability.stallBrakeStart) /
      stability.stallBrakeRange +
      (stability.stallAirspeedReferenceKmh - airspeedKmh) /
        stability.stallAirspeedRangeKmh -
      controls.speedBarTravel * stability.speedBarStallRelief -
      assist.recoveryAssist * stability.recoveryAssistStallRelief,
    0,
    1,
  )
  const estimatedAngleOfAttackDeg = getAngleOfAttackDeg(
    currentState.pitchDeg,
    currentState.verticalSpeedMetersPerSecond,
    airspeedKmh,
    controls.symmetricBrake,
    controls.speedBarTravel,
    0,
    effectiveTurbulence,
  )
  const stallWarning = Math.max(
    controlStallWarning,
    getAngleOfAttackStallWarning(estimatedAngleOfAttackDeg),
  )
  const controlAuthority = clamp(
    assist.inputResponsiveness +
      assist.coordinationAssist * stability.coordinationAuthorityGain -
      stallWarning * stability.stallAuthorityPenalty,
    stability.controlAuthorityFloor,
    stability.controlAuthorityCeiling,
  )
  const gustBankDeg =
    Math.sin(currentState.elapsedSeconds * 1.9 + currentState.headingDeg / 23) *
    effectiveTurbulence *
    stability.gustRollMagnitudeDeg
  const targetBankDeg = clamp(
    (controls.brakeDifferential * controlTuning.brakeToRollDeg +
      controls.weightShift * controlTuning.weightShiftAuthorityDeg) *
      controlAuthority +
      gustBankDeg,
    -stability.bankLimitDeg,
    stability.bankLimitDeg,
  )
  const bankDeg = approach(
    currentState.bankDeg,
    targetBankDeg,
    input.deltaSeconds *
      (controlTuning.bankResponseRate +
        assist.coordinationAssist * controlTuning.coordinationBankResponseGain),
  )
  const turnRateDegPerSecond =
    getTurnRateDegPerSecond(bankDeg, airspeedKmh) *
    (1 - stallWarning * stability.stallTurnRatePenalty)
  const headingDeg = wrapDegrees(
    currentState.headingDeg + turnRateDegPerSecond * input.deltaSeconds,
  )
  const ridgeAirMass = getRidgeAirMass(
    currentState.latitude,
    currentState.longitude,
    localAtmosphere.windHeadingDeg,
    localAtmosphere.windSpeedKmh,
    input.site,
  )
  const thermalAirMass = getThermalAirMass(
    currentState.latitude,
    currentState.longitude,
    currentState.elapsedSeconds,
    localAtmosphere,
    input.site,
  )
  const turbulenceLiftMetersPerSecond = getTurbulenceVerticalGust(
    currentState.elapsedSeconds,
    currentState.latitude,
    currentState.longitude,
    effectiveTurbulence,
  )
  const speedDeviation = airspeedKmh - baselineWing.trimAirspeedKmh
  const baseSinkMetersPerSecond =
    baselineWing.baselineSinkMetersPerSecond +
    (speedDeviation * speedDeviation) / baselineWing.speedToSinkCurveDivisor
  const bankRadians = toRadians(bankDeg)
  const loadFactor = 1 / Math.max(Math.cos(bankRadians), stability.loadFactorCosFloor)
  const inducedTurnSinkMetersPerSecond =
    Math.max(0, loadFactor - 1) * stability.inducedTurnSinkMultiplier
  const brakeSinkMetersPerSecond =
    controls.symmetricBrake * controlTuning.brakeSinkLinearMetersPerSecond +
    controls.symmetricBrake *
      controls.symmetricBrake *
      controlTuning.brakeSinkQuadraticMetersPerSecond
  const stallSinkMetersPerSecond =
    stallWarning * stallWarning * stability.stallSinkMultiplier
  const lowAltitudeFactor = clamp(
    (phaseModel.flareArmingHeightMeters - currentState.groundClearanceMeters) /
      phaseModel.flareArmingHeightMeters,
    0,
    1,
  )
  const flareCommand = clamp(
    (controls.symmetricBrake - landing.flareBrakeStart) / landing.flareBrakeRange,
    0,
    1,
  )
  const flareEffectiveness =
    flareCommand * lowAltitudeFactor * (1 - stallWarning * stability.flareStallPenalty)
  const flareLiftMetersPerSecond =
    flareEffectiveness *
    clamp(
      (landing.flareLiftHeightMeters - currentState.groundClearanceMeters) /
        landing.flareLiftHeightMeters,
      0,
      1,
    ) *
    landing.flareLiftMultiplier
  const flareDragKmh =
    flareEffectiveness *
    clamp(
      (landing.flareDragHeightMeters - currentState.groundClearanceMeters) /
        landing.flareDragHeightMeters,
      0,
      1,
    ) *
    landing.flareDragMultiplierKmh

  airspeedKmh = clamp(
    airspeedKmh - flareDragKmh,
    baselineWing.flareMinAirspeedKmh,
    baselineWing.maxAirspeedKmh,
  )
  const groundEffectFactor = getGroundEffectFactor(
    currentState.groundClearanceMeters,
    airspeedKmh,
  )
  const groundEffectLiftMetersPerSecond =
    groundEffectFactor * landing.groundEffectLiftMultiplier
  const groundEffectSinkReliefMetersPerSecond =
    groundEffectFactor * landing.groundEffectSinkRelief

  const airMassSinkMetersPerSecond =
    ridgeAirMass.leeSinkMetersPerSecond + thermalAirMass.sinkMetersPerSecond
  const totalSinkMetersPerSecond =
    baseSinkMetersPerSecond +
    inducedTurnSinkMetersPerSecond +
    brakeSinkMetersPerSecond +
    stallSinkMetersPerSecond +
    airMassSinkMetersPerSecond -
    groundEffectSinkReliefMetersPerSecond
  const verticalSpeedMetersPerSecond =
    thermalAirMass.liftMetersPerSecond +
    ridgeAirMass.ridgeLiftMetersPerSecond +
    turbulenceLiftMetersPerSecond +
    flareLiftMetersPerSecond -
    totalSinkMetersPerSecond +
    groundEffectLiftMetersPerSecond
  const targetPitchDeg = clamp(
    attitude.trimPitchDeg +
      controls.speedBarTravel * attitude.speedBarPitchGainDeg -
      controls.symmetricBrake * attitude.symmetricBrakePitchLossDeg +
      stallWarning * attitude.stallPitchGainDeg +
      flareEffectiveness * attitude.flarePitchGainDeg -
      effectiveTurbulence * attitude.turbulencePitchGainDeg,
    attitude.minPitchDeg,
    attitude.maxPitchDeg,
  )
  const pitchDeg = approach(
    currentState.pitchDeg,
    targetPitchDeg,
    input.deltaSeconds * attitude.pitchResponseRate,
  )
  const angleOfAttackDeg = getAngleOfAttackDeg(
    pitchDeg,
    verticalSpeedMetersPerSecond,
    airspeedKmh,
    controls.symmetricBrake,
    controls.speedBarTravel,
    flareEffectiveness,
    effectiveTurbulence,
  )
  const headingRad = toRadians(headingDeg)
  const windHeadingRad = toRadians(localAtmosphere.windHeadingDeg)
  const airspeedMetersPerSecond = airspeedKmh / 3.6
  const windMetersPerSecond = localAtmosphere.windSpeedKmh / 3.6
  const eastMetersPerSecond =
    Math.sin(headingRad) * airspeedMetersPerSecond +
    Math.sin(windHeadingRad) * windMetersPerSecond
  const northMetersPerSecond =
    Math.cos(headingRad) * airspeedMetersPerSecond +
    Math.cos(windHeadingRad) * windMetersPerSecond
  const groundSpeedKmh = Math.hypot(eastMetersPerSecond, northMetersPerSecond) * 3.6
  const glideRatio = getGlideRatio(
    groundSpeedKmh,
    verticalSpeedMetersPerSecond,
  )
  const nextLatitude =
    currentState.latitude +
    (northMetersPerSecond * input.deltaSeconds) / 111_320
  const nextLongitude =
    currentState.longitude +
    (eastMetersPerSecond * input.deltaSeconds) /
      getMetersPerLongitudeDegree(currentState.latitude)
  const unclampedAltitudeMeters =
    currentState.altitudeMeters + verticalSpeedMetersPerSecond * input.deltaSeconds
  const landingMetrics = getLandingZoneMetrics(
    nextLatitude,
    nextLongitude,
    headingDeg,
    input.site.landingZone,
  )

  if (
    unclampedAltitudeMeters <=
    terrainHeightMeters + landing.touchdownHeightMarginMeters
  ) {
    const touchdownVerticalSpeedMetersPerSecond =
      verticalSpeedMetersPerSecond *
      (1 -
        clamp(
          flareEffectiveness * landing.touchdownVerticalRelief,
          0,
          landing.touchdownVerticalRelief,
        ))
    const touchdownGroundSpeedKmh =
      groundSpeedKmh *
      (1 -
        clamp(
          flareEffectiveness * landing.touchdownGroundRelief,
          0,
          landing.touchdownGroundRelief,
        ))
    const landingRating = getLandingRating(
      touchdownVerticalSpeedMetersPerSecond,
      touchdownGroundSpeedKmh,
      bankDeg,
      landingMetrics,
    )

    return {
      latitude: nextLatitude,
      longitude: nextLongitude,
      altitudeMeters: terrainHeightMeters,
      terrainHeightMeters,
      headingDeg,
      bankDeg: landingRating === 'smooth' || landingRating === 'firm' ? 0 : bankDeg,
      pitchDeg: landingRating === 'smooth' ? 0 : pitchDeg,
      airspeedKmh: 0,
      groundSpeedKmh: 0,
      verticalSpeedMetersPerSecond: 0,
      angleOfAttackDeg,
      loadFactor,
      glideRatio: 0,
      ridgeLiftMetersPerSecond: ridgeAirMass.ridgeLiftMetersPerSecond,
      thermalLiftMetersPerSecond: thermalAirMass.liftMetersPerSecond,
      airMassSinkMetersPerSecond,
      groundClearanceMeters: 0,
      distanceKm:
        currentState.distanceKm +
        (groundSpeedKmh * input.deltaSeconds) / 3_600,
      elapsedSeconds: currentState.elapsedSeconds + input.deltaSeconds,
      turnRateDegPerSecond: 0,
      stallWarning,
      flareEffectiveness,
      landingZoneDistanceMeters: landingMetrics?.distanceMeters ?? null,
      landingApproachErrorDeg: landingMetrics?.approachErrorDeg ?? null,
      landingRating,
      flightPhase: landingRating === 'crash' ? 'crashed' : 'landed',
      debug: {
        airDensityKgPerCubicMeter: localAtmosphere.airDensityKgPerCubicMeter,
        windGradientFactor: localAtmosphere.windGradientFactor,
        groundEffectLiftMetersPerSecond,
        baseSinkMetersPerSecond,
        inducedTurnSinkMetersPerSecond,
        brakeSinkMetersPerSecond,
        stallSinkMetersPerSecond,
        turbulenceLiftMetersPerSecond,
        flareLiftMetersPerSecond,
        totalSinkMetersPerSecond,
      },
    }
  }

  const altitudeMeters = unclampedAltitudeMeters
  const groundClearanceMeters = altitudeMeters - terrainHeightMeters

  return {
    latitude: nextLatitude,
    longitude: nextLongitude,
    altitudeMeters,
    terrainHeightMeters,
    headingDeg,
    bankDeg,
    pitchDeg,
    airspeedKmh,
    groundSpeedKmh,
    verticalSpeedMetersPerSecond,
    angleOfAttackDeg,
    loadFactor,
    glideRatio,
    ridgeLiftMetersPerSecond: ridgeAirMass.ridgeLiftMetersPerSecond,
    thermalLiftMetersPerSecond: thermalAirMass.liftMetersPerSecond,
    airMassSinkMetersPerSecond,
    groundClearanceMeters,
    distanceKm:
      currentState.distanceKm +
      (groundSpeedKmh * input.deltaSeconds) / 3_600,
    elapsedSeconds: currentState.elapsedSeconds + input.deltaSeconds,
    turnRateDegPerSecond,
    stallWarning,
    flareEffectiveness,
    landingZoneDistanceMeters: landingMetrics?.distanceMeters ?? null,
    landingApproachErrorDeg: landingMetrics?.approachErrorDeg ?? null,
    landingRating: 'none',
    flightPhase: getFlightPhase(
      currentState.elapsedSeconds + input.deltaSeconds,
      groundClearanceMeters,
      flareEffectiveness,
    ),
    debug: {
      airDensityKgPerCubicMeter: localAtmosphere.airDensityKgPerCubicMeter,
      windGradientFactor: localAtmosphere.windGradientFactor,
      groundEffectLiftMetersPerSecond,
      baseSinkMetersPerSecond,
      inducedTurnSinkMetersPerSecond,
      brakeSinkMetersPerSecond,
      stallSinkMetersPerSecond,
      turbulenceLiftMetersPerSecond,
      flareLiftMetersPerSecond,
      totalSinkMetersPerSecond,
    },
  }
}
