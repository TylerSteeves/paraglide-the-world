export type HomeRowControlState = {
  weightLeft: boolean
  leftBrake: boolean
  rightBrake: boolean
  weightRight: boolean
  speedBar: boolean
  leftBrakeTravel: number
  rightBrakeTravel: number
  weightShiftPosition: number
  speedBarTravel: number
}

export type HomeRowControlMetrics = {
  leftBrakeTravel: number
  rightBrakeTravel: number
  symmetricBrake: number
  brakeAverage: number
  brakeDifferential: number
  weightShift: number
  speedBarTravel: number
  speedBarPressure: number
}

export const DEFAULT_HOME_ROW_CONTROLS: HomeRowControlState = {
  weightLeft: false,
  leftBrake: false,
  rightBrake: false,
  weightRight: false,
  speedBar: false,
  leftBrakeTravel: 0,
  rightBrakeTravel: 0,
  weightShiftPosition: 0,
  speedBarTravel: 0,
}

export const HOME_ROW_CONTROL_GUIDE = [
  { keyLabel: 'A', description: 'weight shift left' },
  { keyLabel: 'F', description: 'left brake' },
  { keyLabel: 'J', description: 'right brake' },
  { keyLabel: ';', description: 'weight shift right' },
  { keyLabel: 'Space', description: 'speed bar' },
] as const

export type HomeRowControlKey = 'a' | 'f' | 'j' | ';' | 'space'

const HOME_ROW_CONTROL_CODES: Record<string, HomeRowControlKey> = {
  KeyA: 'a',
  KeyF: 'f',
  KeyJ: 'j',
  Semicolon: ';',
  Space: 'space',
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function approach(current: number, target: number, maxStep: number) {
  if (current < target) {
    return Math.min(current + maxStep, target)
  }

  return Math.max(current - maxStep, target)
}

export function normalizeHomeRowControlKey(key: string) {
  if (key === ' ' || key === 'Spacebar') {
    return 'space'
  }

  return key.toLowerCase()
}

export function resolveHomeRowControlKey(
  key: string,
  code?: string,
): HomeRowControlKey | null {
  if (typeof code === 'string') {
    const controlKey = HOME_ROW_CONTROL_CODES[code]

    if (controlKey) {
      return controlKey
    }
  }

  const normalizedKey = normalizeHomeRowControlKey(key)

  switch (normalizedKey) {
    case 'a':
    case 'f':
    case 'j':
    case ';':
    case 'space':
      return normalizedKey
    default:
      return null
  }
}

export function applyHomeRowControlKey(
  controls: HomeRowControlState,
  key: string,
  isPressed: boolean,
  code?: string,
): HomeRowControlState {
  const normalizedKey = resolveHomeRowControlKey(key, code)

  switch (normalizedKey) {
    case 'a':
      return { ...controls, weightLeft: isPressed }
    case 'f':
      return { ...controls, leftBrake: isPressed }
    case 'j':
      return { ...controls, rightBrake: isPressed }
    case ';':
      return { ...controls, weightRight: isPressed }
    case 'space':
      return { ...controls, speedBar: isPressed }
    default:
      return controls
  }
}

function getBrakeTravel(pressed: boolean, travel: number | undefined) {
  return typeof travel === 'number' ? travel : pressed ? 1 : 0
}

function getWeightShiftPosition(
  weightLeft: boolean,
  weightRight: boolean,
  position: number | undefined,
) {
  return typeof position === 'number'
    ? position
    : (weightRight ? 1 : 0) - (weightLeft ? 1 : 0)
}

function getSpeedBarTravel(pressed: boolean, travel: number | undefined) {
  return typeof travel === 'number' ? travel : pressed ? 1 : 0
}

export function stepHomeRowControls(
  controls: HomeRowControlState,
  deltaSeconds: number,
): HomeRowControlState {
  const leftBrakeTarget = controls.leftBrake ? 1 : 0
  const rightBrakeTarget = controls.rightBrake ? 1 : 0
  const weightTarget = (controls.weightRight ? 1 : 0) - (controls.weightLeft ? 1 : 0)
  const speedBarTarget = controls.speedBar ? 1 : 0
  const brakeStep = deltaSeconds * 2.8
  const brakeReleaseStep = deltaSeconds * 4.8
  const weightStep = deltaSeconds * 4.2
  const weightReleaseStep = deltaSeconds * 6
  const speedBarStep = deltaSeconds * 2
  const speedBarReleaseStep = deltaSeconds * 3

  return {
    ...controls,
    leftBrakeTravel: clamp(
      approach(
        controls.leftBrakeTravel,
        leftBrakeTarget,
        controls.leftBrake ? brakeStep : brakeReleaseStep,
      ),
      0,
      1,
    ),
    rightBrakeTravel: clamp(
      approach(
        controls.rightBrakeTravel,
        rightBrakeTarget,
        controls.rightBrake ? brakeStep : brakeReleaseStep,
      ),
      0,
      1,
    ),
    weightShiftPosition: clamp(
      approach(
        controls.weightShiftPosition,
        weightTarget,
        weightTarget === 0 ? weightReleaseStep : weightStep,
      ),
      -1,
      1,
    ),
    speedBarTravel: clamp(
      approach(
        controls.speedBarTravel,
        speedBarTarget,
        controls.speedBar ? speedBarStep : speedBarReleaseStep,
      ),
      0,
      1,
    ),
  }
}

export function derivesFromHomeRowControls(
  controls: HomeRowControlState,
): HomeRowControlMetrics {
  const leftBrakeTravel = getBrakeTravel(controls.leftBrake, controls.leftBrakeTravel)
  const rightBrakeTravel = getBrakeTravel(
    controls.rightBrake,
    controls.rightBrakeTravel,
  )
  const weightShiftPosition = getWeightShiftPosition(
    controls.weightLeft,
    controls.weightRight,
    controls.weightShiftPosition,
  )
  const speedBarTravel = getSpeedBarTravel(controls.speedBar, controls.speedBarTravel)
  const brakeAverage = (leftBrakeTravel + rightBrakeTravel) / 2

  return {
    leftBrakeTravel,
    rightBrakeTravel,
    symmetricBrake: brakeAverage,
    brakeAverage,
    brakeDifferential: rightBrakeTravel - leftBrakeTravel,
    weightShift: weightShiftPosition,
    speedBarTravel,
    speedBarPressure: speedBarTravel,
  }
}
