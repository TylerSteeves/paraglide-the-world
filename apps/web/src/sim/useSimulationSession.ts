import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'
import { ACTIVITY_MODES, type ActivityModeId } from '../data'
import { deriveMissionView } from '../lib/mission-engine'
import {
  COUNTRIES,
  getCountryContent,
  type CountryId,
} from '../lib/typing-content'
import {
  deriveTypingMetrics,
  normalizeTypingKey,
} from '../lib/typing-engine'
import { deriveWorldMetrics } from '../lib/world-engine'
import { deriveFlightAssistProfile } from './flight-assist'
import {
  getFlightScenario,
  type FlightScenarioId,
} from '../flight/scenarios'
import { resolveHomeRowControlKey } from './home-row-controls'
import {
  applySimulationKey,
  applySimulationTerrainSample,
  applySimulationWorldDataSnapshot,
  consumeSimulationFrame,
  createSimulationSessionState,
  FIXED_SIMULATION_STEP_MS,
  resetSimulationSession,
  selectSimulationScenario,
  selectSimulationSite,
  stepSimulationSession,
  type SimulationSessionState,
} from './simulation-runtime'
import { getFlightSite, type FlightSiteId } from './site-data'
import type { WorldDataSnapshot } from '@wilder-future/world-data-engine'

function isTextEntryTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  const tagName = target.tagName

  return (
    target.isContentEditable ||
    tagName === 'INPUT' ||
    tagName === 'TEXTAREA' ||
    tagName === 'SELECT'
  )
}

function getActivityMode(activityModeId: ActivityModeId) {
  return ACTIVITY_MODES.find((mode) => mode.id === activityModeId) ?? ACTIVITY_MODES[0]
}

function getTypingCountryId(countryId: string): CountryId {
  const matchedCountry = COUNTRIES.find((country) => country.id === countryId)
  return matchedCountry?.id ?? COUNTRIES[0].id
}

export function useSimulationSession(initialSiteId: FlightSiteId) {
  const [session, setSession] = useState<SimulationSessionState>(() =>
    createSimulationSessionState({ siteId: initialSiteId }),
  )
  const launchTerrainBootstrappedRef = useRef(false)
  const frameAccumulatorMsRef = useRef(0)
  const lastFrameTimestampRef = useRef<number | null>(null)
  const selectedSite = getFlightSite(session.siteId)
  const selectedScenario = getFlightScenario(session.scenarioId)
  const selectedCountry = getCountryContent(getTypingCountryId(selectedSite.countryId))
  const activityMode = getActivityMode(session.activityModeId)
  const typingMetrics = deriveTypingMetrics(session.typingSession)
  const worldMetrics = deriveWorldMetrics(session.worldSession, activityMode)
  const flightAssist = deriveFlightAssistProfile({
    activityMode,
    typingMetrics,
    worldMetrics,
    lastInput: session.typingSession.lastInput,
  })
  const missionView = deriveMissionView(
    session.missionSession,
    selectedCountry,
    activityMode,
    typingMetrics.accuracy,
    session.typingSession.mistakes,
  )

  const resetFrameClock = useCallback(() => {
    frameAccumulatorMsRef.current = 0
    lastFrameTimestampRef.current = null
  }, [])

  const selectSite = useCallback((siteId: FlightSiteId) => {
    launchTerrainBootstrappedRef.current = false
    resetFrameClock()
    setSession(selectSimulationSite(siteId))
  }, [resetFrameClock])

  const selectScenario = useCallback((scenarioId: FlightScenarioId | null) => {
    launchTerrainBootstrappedRef.current = false
    resetFrameClock()
    setSession((currentSession) =>
      selectSimulationScenario(currentSession, scenarioId),
    )
  }, [resetFrameClock])

  const resetRun = useCallback(() => {
    launchTerrainBootstrappedRef.current = true
    resetFrameClock()
    setSession((currentSession) => resetSimulationSession(currentSession))
  }, [resetFrameClock])

  const handleTerrainSample = useCallback((nextTerrainHeightMeters: number | null) => {
    setSession((currentSession) => {
      const result = applySimulationTerrainSample(
        currentSession,
        nextTerrainHeightMeters,
        launchTerrainBootstrappedRef.current,
      )

      if (result.didBootstrapLaunchTerrain) {
        launchTerrainBootstrappedRef.current = true
      }

      return result.state
    })
  }, [])

  const handleWorldDataSnapshot = useCallback(
    (snapshot: Readonly<WorldDataSnapshot>) => {
      setSession((currentSession) => {
        const result = applySimulationWorldDataSnapshot(
          currentSession,
          snapshot,
          launchTerrainBootstrappedRef.current,
        )

        if (result.didBootstrapLaunchTerrain) {
          launchTerrainBootstrappedRef.current = true
        }

        return result.state
      })
    },
    [],
  )

  const handleKeyChange = useEffectEvent((
    key: string,
    isPressed: boolean,
    code?: string,
  ) => {
    let handled = false

    setSession((currentSession) => {
      const result = applySimulationKey(currentSession, key, isPressed, code)
      handled = result.handled
      return result.state
    })

    return handled
  })

  const advanceFixedSteps = useEffectEvent((stepCount: number) => {
    if (stepCount <= 0) {
      return
    }

    setSession((currentSession) => {
      let nextSession = currentSession

      for (let stepIndex = 0; stepIndex < stepCount; stepIndex += 1) {
        nextSession = stepSimulationSession(nextSession, FIXED_SIMULATION_STEP_MS)
      }

      return nextSession
    })
  })

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTextEntryTarget(event.target)) {
        return
      }

      if (
        event.repeat &&
        (resolveHomeRowControlKey(event.key, event.code) != null ||
          normalizeTypingKey(event.key) != null ||
          event.key.toLowerCase() === 'r' ||
          event.key === 'Tab')
      ) {
        event.preventDefault()
        return
      }

      if (event.key.toLowerCase() === 'r') {
        event.preventDefault()
        resetRun()
        return
      }

      if (handleKeyChange(event.key, true, event.code)) {
        event.preventDefault()
      }
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      if (handleKeyChange(event.key, false, event.code)) {
        event.preventDefault()
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('keyup', handleKeyUp, true)

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('keyup', handleKeyUp, true)
    }
  }, [resetRun])

  useEffect(() => {
    let frameId = 0

    const handleAnimationFrame = (timestamp: number) => {
      const lastTimestamp = lastFrameTimestampRef.current
      lastFrameTimestampRef.current = timestamp

      if (lastTimestamp != null) {
        const frameStep = consumeSimulationFrame(
          frameAccumulatorMsRef.current,
          timestamp - lastTimestamp,
        )

        frameAccumulatorMsRef.current = frameStep.remainingAccumulatorMs
        advanceFixedSteps(frameStep.stepCount)
      }

      frameId = window.requestAnimationFrame(handleAnimationFrame)
    }

    frameId = window.requestAnimationFrame(handleAnimationFrame)

    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [])

  return {
    activityMode,
    controls: session.controls,
    flightAssist,
    flightState: session.flightState,
    missionView,
    resetRun,
    selectScenario,
    selectSite,
    selectedCountry,
    selectedScenario,
    selectedSite,
    terrainHeightMeters: session.terrainHeightMeters,
    typingMetrics,
    typingSession: session.typingSession,
    worldMetrics,
    worldSession: session.worldSession,
    worldDataSnapshot: session.worldDataSnapshot,
    lastTypingResult: session.lastTypingResult,
    handleTerrainSample,
    handleWorldDataSnapshot,
  }
}
