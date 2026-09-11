import type { ParagliderSimulation } from './pendulum'
import type { TrickName, TrickState } from './types'

export class TrickDetector {
  public state: TrickState
  private lastRollSign: number = 0
  private wingoverCount: number = 0
  private spiralDuration: number = 0

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

  public update(sim: ParagliderSimulation, dt: number): TrickState {
    const bankDeg = Math.abs(sim.canopy.rollDeg)
    const gForce = sim.pilot.gForce
    const sinkRate = -sim.canopy.velocity.y
    const clearance = sim.telemetry.groundClearanceMeters
    const speed = sim.telemetry.airspeedKmh

    let detected: TrickName = 'None'
    let pointsToAdd = 0

    // 1. Wingover Detection: High bank angle alternating sides
    const currentRollSign = Math.sign(sim.canopy.rollDeg)
    if (bankDeg > 75) {
      if (this.lastRollSign !== 0 && currentRollSign !== this.lastRollSign) {
        this.wingoverCount++
        detected = 'Wingover'
        pointsToAdd = 400 * this.wingoverCount
        this.announce(`WINGOVER x${this.wingoverCount}! +${pointsToAdd}`)
      }
      this.lastRollSign = currentRollSign
    } else if (bankDeg < 30) {
      // reset wingover combo if wings level for more than 4s
    }

    // 2. Deep Spiral: Sustained steep bank, high sink rate, high Gs
    if (bankDeg > 65 && sinkRate > 8.0 && gForce > 2.0) {
      this.spiralDuration += dt
      if (this.spiralDuration > 1.2) {
        detected = 'Deep Spiral'
        pointsToAdd = Math.round(500 * dt * gForce)
        if (Math.floor(this.spiralDuration * 2) % 2 === 0) {
          this.announce(`DEEP SPIRAL! ${gForce.toFixed(1)}G`)
        }
      }
    } else {
      this.spiralDuration = 0
    }

    // 3. Acro Tumbling & Looping (Front Flips & Infinity Tumbles)
    if (sim.isLinesSlack) {
      detected = 'Slack Line Tuck'
      this.announce('⚠️ SLACK LINES! CANOPY TUCK')
    } else if (sim.tumbleStreak > 0) {
      const isFrontLoop = sim.pilot.angularVelocityPitch < 0
      if (isFrontLoop) {
        if (sim.tumbleStreak === 1) {
          detected = 'Front Flip'
          pointsToAdd = 2000
          this.announce('⚡ FRONT FLIP / FRONT TUMBLE! +2000')
        } else {
          detected = 'Front Tumble'
          pointsToAdd = 3000 * sim.tumbleStreak
          this.announce(`⚡ RHYTHMIC FRONT TUMBLE x${sim.tumbleStreak}! +${pointsToAdd}`)
        }
      } else {
        if (sim.tumbleStreak === 1) {
          detected = 'Tumble / Loop'
          pointsToAdd = 1500
          this.announce('FULL TUMBLE / LOOP! +1500')
        } else {
          detected = 'Infinity Tumble'
          pointsToAdd = 2500 * sim.tumbleStreak
          this.announce(`🔥 INFINITY TUMBLE x${sim.tumbleStreak}! +${pointsToAdd}`)
        }
      }
    } else if (sim.isStalled) {
      detected = 'Dynamic Stall'
      this.announce(`FULL STALL! PLUMMETING ${sinkRate.toFixed(1)} M/S!`)
    } else if (sim.surgeTimer > 0.8 && speed > 65) {
      detected = 'Speed Swoop'
      this.announce(`SURGE DIVE RECOVERY! ${Math.round(speed)} KM/H!`)
    }

    // 4. Speed Swoop / Ground Flare: High speed skimming < 4m off the deck
    if (clearance < 4.0 && clearance > 0.4 && speed > 42 && sinkRate < 1.0) {
      detected = 'Speed Swoop'
      pointsToAdd = Math.round(350 * dt)
      this.announce('HIGH-SPEED SWOOP!')
    }

    // 4. Proximity Multiplier: Closer to terrain/trees = higher multiplier
    if (clearance < 8.0 && clearance > 0.5) {
      this.state.proximityMultiplier = Math.min(
        4.0,
        1.0 + (8.0 - clearance) * 0.45,
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
      this.state.comboTimer = 3.5
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

  private announce(text: string) {
    this.state.announcementText = text
    this.state.announcementTimer = 2.0
  }
}
