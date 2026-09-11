import { describe, expect, it } from 'vitest'
import {
  applySimulationTerrainSample,
  applySimulationWorldDataSnapshot,
  consumeSimulationFrame,
  createSimulationSessionState,
  FIXED_SIMULATION_STEP_MS,
  MAX_SIMULATION_FRAME_DELTA_MS,
  MAX_SIMULATION_STEPS_PER_FRAME,
  resetSimulationSession,
  selectSimulationScenario,
  stepSimulationSession,
} from '../simulation-runtime'
import { getFlightSite } from '../site-data'
import {
  AuthoredProvider,
  createWorldDataEngine,
} from '@wilder-future/world-data-engine'
import { createAuthoredWorldRecord } from '../../world-data/authored-records'

describe('applySimulationTerrainSample', () => {
  it('bootstraps the launch terrain on the first sample and rebuilds the scenario state', () => {
    const session = createSimulationSessionState({
      siteId: 'rome',
      scenarioId: 'approach',
    })

    const result = applySimulationTerrainSample(session, 305, false)

    expect(result.didBootstrapLaunchTerrain).toBe(true)
    expect(result.state.siteId).toBe('istanbul')
    expect(result.state.launchTerrainHeightMeters).toBe(305)
    expect(result.state.terrainHeightMeters).toBe(305)
    expect(result.state.flightState.terrainHeightMeters).toBe(305)
    expect(result.state.worldSession.windHeading).toBe(
      result.state.scenarioAtmosphere?.windHeadingDeg,
    )
  })

  it('updates only the live terrain after launch terrain has already been bootstrapped', () => {
    const bootstrapped = applySimulationTerrainSample(
      createSimulationSessionState({
        siteId: 'lauterbrunnen',
        launchTerrainHeightMeters: 1_520,
      }),
      1_520,
      false,
    ).state

    const moved = applySimulationTerrainSample(bootstrapped, 915, true)

    expect(moved.didBootstrapLaunchTerrain).toBe(false)
    expect(moved.state.launchTerrainHeightMeters).toBe(1_520)
    expect(moved.state.terrainHeightMeters).toBe(915)
  })
})

describe('resetSimulationSession', () => {
  it('resets from the launch terrain baseline instead of the latest in-flight terrain sample', () => {
    const site = getFlightSite('lauterbrunnen')
    const bootstrapped = applySimulationTerrainSample(
      createSimulationSessionState({
        siteId: site.id,
        launchTerrainHeightMeters: 1_515,
      }),
      1_530,
      false,
    ).state
    const moved = applySimulationTerrainSample(bootstrapped, 940, true).state

    const reset = resetSimulationSession(moved)

    expect(reset.launchTerrainHeightMeters).toBe(1_530)
    expect(reset.terrainHeightMeters).toBe(1_530)
    expect(reset.flightState.altitudeMeters).toBe(1_530 + site.spawnAglMeters)
    expect(reset.flightState.terrainHeightMeters).toBe(1_530)
  })
})

describe('applySimulationWorldDataSnapshot', () => {
  it('pins one resolved immutable snapshot before fixed-step simulation begins', async () => {
    const site = getFlightSite('lauterbrunnen')
    const engine = createWorldDataEngine({
      providers: [
        new AuthoredProvider({ records: [createAuthoredWorldRecord(site)] }),
      ],
      clock: () => new Date('2026-08-24T21:15:00.000Z'),
    })
    const snapshot = await engine.getSnapshot({
      location: {
        latitudeDeg: site.latitude,
        longitudeDeg: site.longitude,
        elevationMslM: site.launchAltitudeMeters,
      },
      at: '2026-08-24T21:15:00.000Z',
      domains: ['terrain', 'atmosphere'],
    })
    const applied = applySimulationWorldDataSnapshot(
      createSimulationSessionState({ siteId: site.id }),
      snapshot,
      false,
    )
    const stepped = stepSimulationSession(applied.state, FIXED_SIMULATION_STEP_MS)

    expect(applied.didBootstrapLaunchTerrain).toBe(true)
    expect(stepped.worldDataSnapshot).toBe(snapshot)
    expect(stepped.worldDataSnapshot?.deterministicFingerprint).toBe(
      snapshot.deterministicFingerprint,
    )
    expect(stepped.worldSession.windSpeedKmh).toBe(site.windSpeedKmh)
    expect(Object.isFrozen(stepped.worldDataSnapshot)).toBe(true)
  })
})

describe('selectSimulationScenario', () => {
  it('seeds same-site scenarios from the launch terrain baseline, not the current terrain under the glider', () => {
    const bootstrapped = applySimulationTerrainSample(
      createSimulationSessionState({
        siteId: 'lauterbrunnen',
        launchTerrainHeightMeters: 1_500,
      }),
      1_548,
      false,
    ).state
    const moved = applySimulationTerrainSample(bootstrapped, 970, true).state

    const scenario = selectSimulationScenario(moved, 'ridge-pass')

    expect(scenario.siteId).toBe('lauterbrunnen')
    expect(scenario.launchTerrainHeightMeters).toBe(1_548)
    expect(scenario.terrainHeightMeters).toBe(1_548)
    expect(scenario.flightState.terrainHeightMeters).toBe(1_548)
  })
})

describe('consumeSimulationFrame', () => {
  it('converts buffered wall time into fixed simulation steps', () => {
    const result = consumeSimulationFrame(5, 45)

    expect(result.stepCount).toBe(2)
    expect(result.remainingAccumulatorMs).toBeCloseTo(10)
  })

  it('caps long hitches so the runtime cannot spiral into an unbounded catch-up loop', () => {
    const result = consumeSimulationFrame(0, 500)

    expect(result.clampedFrameDeltaMs).toBe(MAX_SIMULATION_FRAME_DELTA_MS)
    expect(result.stepCount).toBe(MAX_SIMULATION_STEPS_PER_FRAME)
    expect(result.stepCount * FIXED_SIMULATION_STEP_MS).toBe(
      MAX_SIMULATION_FRAME_DELTA_MS,
    )
    expect(result.remainingAccumulatorMs).toBeLessThan(FIXED_SIMULATION_STEP_MS)
  })
})
