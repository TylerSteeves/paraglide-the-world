import type { ParagliderSimulation } from './pendulum'
import type { TrickName, TrickState } from './types'

export class TrickDetector {
  public state: TrickState
  private lastRollSign: number = 0
  private wingoverCount: number = 0
  private spiralDuration: number = 0
  private footDragDistance: number = 0
  private reverseKiteDuration: number = 0
  private lastTumbleStreak: number = 0

  constructor() {
    this.state = {
      activeTrick: 'None',
      trickPoints: 0,
      trickCombo: 0,
      comboTimer: 0,
      proximityMultiplier: 1.0,
      announcementText: '',
      announcementTimer: 0,
    }
  }

  public update(sim: ParagliderSimulation, dt: number, _obstacleSystem?: any): TrickState {
    const bankDeg = Math.abs(sim.canopy.rollDeg)
    const gForce = sim.pilot.gForce
    const sinkRate = -sim.canopy.velocity.y
    const clearance = sim.telemetry.groundClearanceMeters
    const speed = sim.telemetry.airspeedKmh

    let detected: TrickName = 'None'
    let pointsToAdd = 0

    // 1. Wingover Detection: High bank angle alternating sides (>75°)
    const currentRollSign = Math.sign(sim.canopy.rollDeg)
    if (bankDeg > 75) {
      if (this.lastRollSign !== 0 && currentRollSign !== this.lastRollSign) {
        this.wingoverCount++
        detected = 'Wingover'
        pointsToAdd = 500 * this.wingoverCount
        this.announce(`DEEP WINGOVER x${this.wingoverCount}! +${pointsToAdd}`)
      }
      this.lastRollSign = currentRollSign
    }

    // 2. Deep Spiral: Sustained steep bank (>65°), high sink (>8m/s), high Gs
    if (bankDeg > 65 && sinkRate > 8.0 && gForce > 2.2) {
      this.spiralDuration += dt
      if (this.spiralDuration > 1.2) {
        detected = 'Deep Spiral'
        pointsToAdd = Math.round(600 * dt * gForce)
        if (Math.floor(this.spiralDuration * 2) % 2 === 0) {
          this.announce(`🌀 DEEP SPIRAL! ${gForce.toFixed(1)}G`)
        }
      }
    } else {
      this.spiralDuration = 0
    }

    // 3. Infinite Tumbling & Looping (Backflips over the wing)
    if (sim.isLinesSlack) {
      detected = 'Slack Line Tuck'
      this.announce('⚠️ SLACK LINES! CANOPY DEFLATED')
    } else if (sim.tumbleStreak > 0) {
      detected = 'Infinite Tumble'
      if (sim.tumbleStreak !== this.lastTumbleStreak) {
        pointsToAdd = 3000 * sim.tumbleStreak
        this.announce(`🔥 INFINITE TUMBLE x${sim.tumbleStreak}! +${pointsToAdd} PTS (${gForce.toFixed(1)}G)`)
        this.lastTumbleStreak = sim.tumbleStreak
      }
    } else {
      this.lastTumbleStreak = 0
    }

    // 4. Asymmetric SAT / Negative Spin Corkscrew
    if (sim.asymmetricStallSide !== 'none' && Math.abs(sim.canopy.yawDeg) > 0) {
      detected = 'Asymmetric SAT'
      pointsToAdd = Math.round(450 * dt)
      this.announce('🌪️ ASYMMETRIC SAT / NEGATIVE SPIN!')
    }

    // 5. Dune Foot Drag & Ground Skimming
    if (sim.isFootDragging && speed > 18) {
      detected = 'Foot Drag'
      const stepDist = (speed / 3.6) * dt
      this.footDragDistance += stepDist
      pointsToAdd = Math.round(stepDist * 80)
      if (Math.floor(this.footDragDistance) % 15 === 0) {
        this.announce(`🦶 DUNE FOOT DRAG! ${Math.round(this.footDragDistance)}m`)
      }
    } else {
      this.footDragDistance = 0
    }

    // 6. Reverse Dune Kiting (Flying / Hovering facing the wing)
    if (sim.telemetry.isReverseStance && clearance < 12.0 && speed > 10) {
      detected = 'Reverse Dune Kite'
      this.reverseKiteDuration += dt
      pointsToAdd = Math.round(250 * dt)
      if (this.reverseKiteDuration > 1.5 && Math.floor(this.reverseKiteDuration) % 3 === 0) {
        this.announce('🪁 REVERSE DUNE KITING!')
      }
    } else {
      this.reverseKiteDuration = 0
    }

    // 7. High-Speed Speed Swoop (< 3.5m clearance, >60 km/h)
    if (clearance < 3.5 && clearance > 0.6 && speed > 60 && sinkRate < 2.5 && !sim.isFootDragging) {
      detected = 'Speed Swoop'
      pointsToAdd = Math.round(500 * dt)
      this.announce(`⚡ HIGH-SPEED SWOOP! ${Math.round(speed)} KM/H`)
    }

    // Proximity Multiplier: Closer to terrain = higher score multiplier
    if (clearance < 8.0 && clearance > 0.4) {
      this.state.proximityMultiplier = Math.min(
        5.0,
        1.0 + (8.0 - clearance) * 0.55,
      )
    } else {
      this.state.proximityMultiplier = 1.0
    }

    // Accumulate points
    if (pointsToAdd > 0) {
      const finalPoints = Math.round(pointsToAdd * this.state.proximityMultiplier)
      this.state.trickPoints += finalPoints
      sim.telemetry.score += finalPoints
      this.state.trickCombo++
      this.state.comboTimer = 4.0
    }

    // Timers
    if (this.state.comboTimer > 0) {
      this.state.comboTimer -= dt
      if (this.state.comboTimer <= 0) {
        this.state.trickCombo = 0
        this.wingoverCount = 0
      }
    }

    if (this.state.announcementTimer > 0) {
      this.state.announcementTimer -= dt
      if (this.state.announcementTimer <= 0) {
        this.state.announcementText = ''
      }
    }

    this.state.activeTrick = detected
    return this.state
  }

  public announce(text: string): void {
    this.state.announcementText = text
    this.state.announcementTimer = 2.4
  }
}
