export type Vector3D = {
  x: number
  y: number
  z: number
}

export type FlightControls = {
  leftBrake: number // 0 (up / trim) to 1 (buried / stall)
  rightBrake: number
  leftBrakeRate: number // d(brake)/dt (for dynamic snap tricks)
  rightBrakeRate: number
  weightShift: number // -1 (lean left) to +1 (lean right)
  speedBar: number // 0 to 1
}

export type CanopyState = {
  position: Vector3D
  velocity: Vector3D
  quaternion: { x: number; y: number; z: number; w: number }
  rollDeg: number
  pitchDeg: number
  yawDeg: number
  airspeedKmh: number
  verticalSpeedMps: number
  angleOfAttackDeg: number
  leftTrailingEdgeFlex: number // 0 to 1
  rightTrailingEdgeFlex: number
  leftWingCollapse: number // 0 (inflated) to 1 (collapsed / tucked)
  rightWingCollapse: number
  asymmetricStallSide: 'none' | 'left' | 'right'
  isNegativeSpin: boolean
}

export type PilotState = {
  position: Vector3D
  velocity: Vector3D
  pendulumRollDeg: number // angle relative to canopy vertical
  pendulumPitchDeg: number
  angularVelocityRoll: number
  angularVelocityPitch: number
  gForce: number
  harnessWeightShift: number
}

export type AtmosphereState = {
  windVector: Vector3D
  windSpeedKmh: number
  windHeadingDeg: number
  turbulence: number
  thermalUpdraftMps: number
  ridgeLiftMps: number
}

export type TrickName =
  | 'None'
  | 'Wingover'
  | 'Deep Spiral'
  | 'Dynamic Stall'
  | 'Asymmetric SAT'
  | 'Speed Swoop'
  | 'Wire Thread'
  | 'Proximity Skim'
  | 'Tumble / Loop'
  | 'Infinity Tumble'
  | 'Front Flip'
  | 'Front Tumble'
  | 'Slack Line Tuck'

export type TrickState = {
  activeTrick: TrickName
  trickPoints: number
  trickCombo: number
  comboTimer: number
  proximityMultiplier: number
  announcementText: string
  announcementTimer: number
}

export type FlightTelemetry = {
  altitudeMeters: number
  terrainHeightMeters: number
  groundClearanceMeters: number
  airspeedKmh: number
  groundSpeedKmh: number
  verticalSpeedMps: number
  glideRatio: number
  gForce: number
  distanceMeters: number
  flightDurationSeconds: number
  score: number
  ringsCollected: number
  lineTensionNewtons: number
  leftLineTensionNewtons: number
  rightLineTensionNewtons: number
  isLinesSlack: boolean
  asymmetricStallSide: 'none' | 'left' | 'right'
  isNegativeSpin: boolean
  tumbleStreak: number
}
