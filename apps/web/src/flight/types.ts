export type FlightPhase =
  | 'launch'
  | 'soaring'
  | 'approach'
  | 'flare'
  | 'landed'
  | 'crashed'

export type LandingRating = 'none' | 'smooth' | 'firm' | 'hard' | 'crash'

export type FlightDebugTelemetry = {
  airDensityKgPerCubicMeter: number
  windGradientFactor: number
  groundEffectLiftMetersPerSecond: number
  baseSinkMetersPerSecond: number
  inducedTurnSinkMetersPerSecond: number
  brakeSinkMetersPerSecond: number
  stallSinkMetersPerSecond: number
  turbulenceLiftMetersPerSecond: number
  flareLiftMetersPerSecond: number
  totalSinkMetersPerSecond: number
}

export type FlightSimState = {
  latitude: number
  longitude: number
  altitudeMeters: number
  terrainHeightMeters: number
  headingDeg: number
  bankDeg: number
  pitchDeg: number
  airspeedKmh: number
  groundSpeedKmh: number
  verticalSpeedMetersPerSecond: number
  angleOfAttackDeg: number
  loadFactor: number
  glideRatio: number
  ridgeLiftMetersPerSecond: number
  thermalLiftMetersPerSecond: number
  airMassSinkMetersPerSecond: number
  groundClearanceMeters: number
  distanceKm: number
  elapsedSeconds: number
  turnRateDegPerSecond: number
  stallWarning: number
  flareEffectiveness: number
  landingZoneDistanceMeters: number | null
  landingApproachErrorDeg: number | null
  landingRating: LandingRating
  flightPhase: FlightPhase
  debug: FlightDebugTelemetry
}

export type AmbientAirState = {
  windHeadingDeg: number
  windSpeedKmh: number
  turbulence: number
}
