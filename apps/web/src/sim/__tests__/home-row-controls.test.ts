import { describe, expect, it } from 'vitest'
import {
  DEFAULT_HOME_ROW_CONTROLS,
  applyHomeRowControlKey,
  derivesFromHomeRowControls,
  normalizeHomeRowControlKey,
  resolveHomeRowControlKey,
  stepHomeRowControls,
} from '../home-row-controls'

describe('normalizeHomeRowControlKey', () => {
  it('normalizes space variants to the simulator space token', () => {
    expect(normalizeHomeRowControlKey(' ')).toBe('space')
    expect(normalizeHomeRowControlKey('Space')).toBe('space')
    expect(normalizeHomeRowControlKey('Spacebar')).toBe('space')
  })

  it('lowercases single-character and modifier keys', () => {
    expect(normalizeHomeRowControlKey('A')).toBe('a')
    expect(normalizeHomeRowControlKey('Shift')).toBe('shift')
  })
})

describe('applyHomeRowControlKey', () => {
  it('tracks press and release state without disturbing the other controls', () => {
    const pressed = applyHomeRowControlKey(DEFAULT_HOME_ROW_CONTROLS, 'J', true)
    const released = applyHomeRowControlKey(pressed, 'j', false)

    expect(pressed).toMatchObject({
      weightLeft: false,
      leftBrake: false,
      rightBrake: true,
      weightRight: false,
      speedBar: false,
    })
    expect(pressed.rightBrakeTravel).toBe(0)
    expect(released).toEqual(DEFAULT_HOME_ROW_CONTROLS)
  })

  it('keeps the speed bar independent from steering inputs', () => {
    const afterBrake = applyHomeRowControlKey(DEFAULT_HOME_ROW_CONTROLS, 'F', true)
    const afterSpeed = applyHomeRowControlKey(afterBrake, 'Space', true)

    expect(afterSpeed).toMatchObject({
      weightLeft: false,
      leftBrake: true,
      rightBrake: false,
      weightRight: false,
      speedBar: true,
    })
    expect(afterSpeed.leftBrakeTravel).toBe(0)
    expect(afterSpeed.speedBarTravel).toBe(0)
  })

  it('can resolve the speed bar from the physical Space key code', () => {
    const pressed = applyHomeRowControlKey(
      DEFAULT_HOME_ROW_CONTROLS,
      'Unidentified',
      true,
      'Space',
    )

    expect(pressed.speedBar).toBe(true)
  })

  it('returns the same object for unmapped keys', () => {
    const next = applyHomeRowControlKey(DEFAULT_HOME_ROW_CONTROLS, 'Enter', true)
    expect(next).toBe(DEFAULT_HOME_ROW_CONTROLS)
  })
})

describe('resolveHomeRowControlKey', () => {
  it('falls back to the physical key code when the key value is unreliable', () => {
    expect(resolveHomeRowControlKey('Unidentified', 'Space')).toBe('space')
    expect(resolveHomeRowControlKey('Dead', 'Semicolon')).toBe(';')
  })

  it('uses the normalized key value when no control key code is present', () => {
    expect(resolveHomeRowControlKey('A')).toBe('a')
    expect(resolveHomeRowControlKey('Spacebar')).toBe('space')
    expect(resolveHomeRowControlKey('Enter')).toBeNull()
  })
})

describe('derivesFromHomeRowControls', () => {
  it('treats opposing inputs as neutral while preserving total pressure', () => {
    const metrics = derivesFromHomeRowControls(
      stepHomeRowControls({
        ...DEFAULT_HOME_ROW_CONTROLS,
        weightLeft: true,
        leftBrake: true,
        rightBrake: true,
        weightRight: true,
        speedBar: true,
      }, 0.5),
    )

    expect(metrics.brakeAverage).toBe(1)
    expect(metrics.brakeDifferential).toBe(0)
    expect(metrics.weightShift).toBe(0)
    expect(metrics.speedBarPressure).toBe(1)
  })

  it('keeps one-sided input directional', () => {
    const metrics = derivesFromHomeRowControls(
      stepHomeRowControls({
      ...DEFAULT_HOME_ROW_CONTROLS,
      rightBrake: true,
      }, 0.5),
    )

    expect(metrics.brakeAverage).toBe(0.5)
    expect(metrics.brakeDifferential).toBe(1)
    expect(metrics.weightShift).toBe(0)
    expect(metrics.speedBarPressure).toBe(0)
  })
})

describe('stepHomeRowControls', () => {
  it('builds analog brake, weight shift, and speed-bar travel over time', () => {
    const armed = {
      ...DEFAULT_HOME_ROW_CONTROLS,
      leftBrake: true,
      weightRight: true,
      speedBar: true,
    }

    const stepped = stepHomeRowControls(armed, 0.25)

    expect(stepped.leftBrakeTravel).toBeGreaterThan(0)
    expect(stepped.leftBrakeTravel).toBeLessThan(1)
    expect(stepped.weightShiftPosition).toBeGreaterThan(0)
    expect(stepped.weightShiftPosition).toBeLessThanOrEqual(1)
    expect(stepped.speedBarTravel).toBeGreaterThan(0)
    expect(stepped.speedBarTravel).toBeLessThan(1)
  })
})
