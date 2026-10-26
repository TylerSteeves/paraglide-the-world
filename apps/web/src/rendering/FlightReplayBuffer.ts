import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { ParagliderSimulation } from '../physics/pendulum'

export interface ReplayFrame {
  t: number
  pilotPos: Vector3
  pilotVel: Vector3
  canopyPos: Vector3
  canopyYaw: number
  canopyPitch: number
  canopyRoll: number
  qx: number
  qy: number
  qz: number
  qw: number
  speedKmh: number
  gForce: number
  thrust: number
  drogue: number
  collapse: number
  weightShift: number
  leftBrake: number
  rightBrake: number
  speedBar: number
  pullingA: number
  pullingB: number
}

/**
 * Last few seconds of the flight, played back by time.
 * Samples are interpolated, so a slow playback does not step from pose to pose.
 */
export class FlightReplayBuffer {
  private readonly windowSec = 4
  private frames: ReplayFrame[] = []
  private savedWipeout: ReplayFrame[] = []
  private scratch: ReplayFrame = emptyFrame()

  public isReplaying: boolean = false
  public playbackSpeed: number = 0.35
  private playT: number = 0
  private holdSec: number = 0

  public record(sim: ParagliderSimulation): void {
    if (this.isReplaying || sim.isCrashed) return

    const t = sim.telemetry.flightDurationSeconds || 0
    const q = sim.canopy.quaternion
    this.frames.push({
      t,
      pilotPos: new Vector3(sim.pilot.position.x, sim.pilot.position.y, sim.pilot.position.z),
      pilotVel: new Vector3(sim.pilot.velocity.x, sim.pilot.velocity.y, sim.pilot.velocity.z),
      canopyPos: new Vector3(sim.canopy.position.x, sim.canopy.position.y, sim.canopy.position.z),
      canopyYaw: sim.canopy.yawDeg,
      canopyPitch: sim.canopy.pitchDeg,
      canopyRoll: sim.canopy.rollDeg,
      qx: q.x,
      qy: q.y,
      qz: q.z,
      qw: q.w,
      speedKmh: sim.telemetry.airspeedKmh || 45,
      gForce: sim.telemetry.gForce || 1,
      thrust: sim.thrustNewtons,
      drogue: sim.drogueOpen,
      collapse: sim.collapseFrac,
      weightShift: sim.controls.weightShift || 0,
      leftBrake: sim.controls.leftBrake || 0,
      rightBrake: sim.controls.rightBrake || 0,
      speedBar: sim.controls.speedBar || 0,
      pullingA: sim.controls.pullingA || 0,
      pullingB: sim.controls.pullingB || 0,
    })

    const oldest = t - this.windowSec
    while (this.frames.length > 2 && this.frames[0].t < oldest) this.frames.shift()
  }

  public snapshotCrash(): void {
    this.savedWipeout = this.frames.map(cloneFrame)
  }

  public startReplay(speed: number = 0.35): boolean {
    if (this.savedWipeout.length < 8) return false
    this.isReplaying = true
    this.playbackSpeed = speed
    this.playT = this.savedWipeout[0].t
    this.holdSec = 0
    return true
  }

  public stopReplay(): void {
    this.isReplaying = false
    this.holdSec = 0
  }

  /** Interpolated pose, or null once the pass and a short hold on the hit are done. */
  public step(dt: number): ReplayFrame | null {
    const frames = this.savedWipeout
    if (!this.isReplaying || frames.length < 2) return null

    const end = frames[frames.length - 1].t
    const stepDt = Math.min(0.05, Math.max(0, dt))
    this.playT += stepDt * this.playbackSpeed
    if (this.playT >= end) {
      this.holdSec += stepDt
      if (this.holdSec > 0.45) return null
      return copyInto(this.scratch, frames[frames.length - 1])
    }

    let i = 1
    while (i < frames.length - 1 && frames[i].t < this.playT) i++
    const a = frames[i - 1]
    const b = frames[i]
    const u = Math.min(1, Math.max(0, (this.playT - a.t) / Math.max(1e-4, b.t - a.t)))
    return blendInto(this.scratch, a, b, u)
  }

  public reset(): void {
    this.frames = []
    this.savedWipeout = []
    this.isReplaying = false
    this.holdSec = 0
  }
}

function emptyFrame(): ReplayFrame {
  return {
    t: 0,
    pilotPos: new Vector3(),
    pilotVel: new Vector3(),
    canopyPos: new Vector3(),
    canopyYaw: 0,
    canopyPitch: 0,
    canopyRoll: 0,
    qx: 0,
    qy: 0,
    qz: 0,
    qw: 1,
    speedKmh: 0,
    gForce: 1,
    thrust: 0,
    drogue: 0,
    collapse: 0,
    weightShift: 0,
    leftBrake: 0,
    rightBrake: 0,
    speedBar: 0,
    pullingA: 0,
    pullingB: 0,
  }
}

function cloneFrame(f: ReplayFrame): ReplayFrame {
  return {
    ...f,
    pilotPos: f.pilotPos.clone(),
    pilotVel: f.pilotVel.clone(),
    canopyPos: f.canopyPos.clone(),
  }
}

function copyInto(out: ReplayFrame, f: ReplayFrame): ReplayFrame {
  out.t = f.t
  out.pilotPos.copyFrom(f.pilotPos)
  out.pilotVel.copyFrom(f.pilotVel)
  out.canopyPos.copyFrom(f.canopyPos)
  out.canopyYaw = f.canopyYaw
  out.canopyPitch = f.canopyPitch
  out.canopyRoll = f.canopyRoll
  out.qx = f.qx
  out.qy = f.qy
  out.qz = f.qz
  out.qw = f.qw
  out.speedKmh = f.speedKmh
  out.gForce = f.gForce
  out.thrust = f.thrust
  out.drogue = f.drogue
  out.collapse = f.collapse
  out.weightShift = f.weightShift
  out.leftBrake = f.leftBrake
  out.rightBrake = f.rightBrake
  out.speedBar = f.speedBar
  out.pullingA = f.pullingA
  out.pullingB = f.pullingB
  return out
}

function blendInto(out: ReplayFrame, a: ReplayFrame, b: ReplayFrame, u: number): ReplayFrame {
  out.t = a.t + (b.t - a.t) * u
  Vector3.LerpToRef(a.pilotPos, b.pilotPos, u, out.pilotPos)
  Vector3.LerpToRef(a.pilotVel, b.pilotVel, u, out.pilotVel)
  Vector3.LerpToRef(a.canopyPos, b.canopyPos, u, out.canopyPos)
  out.canopyYaw = lerpAngle(a.canopyYaw, b.canopyYaw, u)
  out.canopyPitch = a.canopyPitch + (b.canopyPitch - a.canopyPitch) * u
  out.canopyRoll = lerpAngle(a.canopyRoll, b.canopyRoll, u)
  const qa = new Quaternion(a.qx, a.qy, a.qz, a.qw)
  const qb = new Quaternion(b.qx, b.qy, b.qz, b.qw)
  const q = Quaternion.Slerp(qa, qb, u)
  out.qx = q.x
  out.qy = q.y
  out.qz = q.z
  out.qw = q.w
  out.speedKmh = a.speedKmh + (b.speedKmh - a.speedKmh) * u
  out.gForce = a.gForce + (b.gForce - a.gForce) * u
  out.thrust = a.thrust + (b.thrust - a.thrust) * u
  out.drogue = a.drogue + (b.drogue - a.drogue) * u
  out.collapse = a.collapse + (b.collapse - a.collapse) * u
  out.weightShift = a.weightShift + (b.weightShift - a.weightShift) * u
  out.leftBrake = a.leftBrake + (b.leftBrake - a.leftBrake) * u
  out.rightBrake = a.rightBrake + (b.rightBrake - a.rightBrake) * u
  out.speedBar = a.speedBar + (b.speedBar - a.speedBar) * u
  out.pullingA = a.pullingA + (b.pullingA - a.pullingA) * u
  out.pullingB = a.pullingB + (b.pullingB - a.pullingB) * u
  return out
}

function lerpAngle(a: number, b: number, u: number): number {
  let d = b - a
  d = ((((d + 180) % 360) + 360) % 360) - 180
  return a + d * u
}
