import { Color3, Color4 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture'
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem'
import type { Scene } from '@babylonjs/core/scene'
import type { ParagliderSimulation } from '../physics/pendulum'
import type { Rgb } from '../progression/PilotWardrobe'

/**
 * Wingtip vapor and a short hydrogen plume.
 * Particles hang in the air behind the wing, so a fast pass leaves a trail.
 * Cruise stays clean. The plume stays short so the chase camera can see past it.
 */
export class WingtipTrailSystem {
  private leftTip = new Vector3()
  private rightTip = new Vector3()
  private leftBell = new Vector3()
  private rightBell = new Vector3()
  private vaporL: ParticleSystem
  private vaporR: ParticleSystem
  private flameL: ParticleSystem
  private flameR: ParticleSystem
  private tint: Color3 = new Color3(0.95, 0.97, 1)

  constructor(scene: Scene) {
    const vaporTex = softDisc(scene, 'vapor-puff', 'rgba(255,255,255,0.85)', 'rgba(226,232,240,0.28)')
    const flameTex = softDisc(scene, 'h2-puff', 'rgba(255,255,255,0.95)', 'rgba(56,189,248,0.45)')

    this.vaporL = this.makeVapor(scene, 'vapor-l', this.leftTip, vaporTex)
    this.vaporR = this.makeVapor(scene, 'vapor-r', this.rightTip, vaporTex)
    this.flameL = this.makeFlame(scene, 'h2-l', this.leftBell, flameTex)
    this.flameR = this.makeFlame(scene, 'h2-r', this.rightBell, flameTex)
    this.paintVapor()
  }

  public setTrailColor(rgb: Rgb | null, _isEmissive: boolean = false): void {
    this.tint = rgb ? new Color3(rgb.r, rgb.g, rgb.b) : new Color3(0.95, 0.97, 1)
    this.paintVapor()
  }

  public setEnabled(enabled: boolean): void {
    const systems = [this.vaporL, this.vaporR, this.flameL, this.flameR]
    if (enabled) {
      for (const ps of systems) ps.start()
    } else {
      this.sleep()
      for (const ps of systems) ps.stop()
    }
  }

  public sleep(): void {
    this.vaporL.emitRate = 0
    this.vaporR.emitRate = 0
    this.flameL.emitRate = 0
    this.flameR.emitRate = 0
  }

  public update(
    sim: ParagliderSimulation,
    _dt: number,
    leftTipWorldPos: Vector3,
    rightTipWorldPos: Vector3,
    leftThrusterWorldPos?: Vector3,
    rightThrusterWorldPos?: Vector3,
  ): void {
    if (sim.isCrashed && !leftTipWorldPos) {
      this.sleep()
      return
    }

    this.leftTip.copyFrom(leftTipWorldPos)
    this.rightTip.copyFrom(rightTipWorldPos)

    const vel = sim.pilot.velocity
    const spd = Math.hypot(vel.x, vel.y, vel.z)
    const backX = spd > 2 ? -vel.x / spd : 0
    const backY = spd > 2 ? -vel.y / spd * 0.25 + 0.2 : 0.25
    const backZ = spd > 2 ? -vel.z / spd : -1
    const spanX = leftTipWorldPos.x - rightTipWorldPos.x
    const spanZ = leftTipWorldPos.z - rightTipWorldPos.z
    const span = Math.hypot(spanX, spanZ) || 1
    const outX = spanX / span
    const outZ = spanZ / span

    aim(this.vaporL, backX + outX * 0.35, backY, backZ + outZ * 0.35)
    aim(this.vaporR, backX - outX * 0.35, backY, backZ - outZ * 0.35)

    const speedKmh = sim.telemetry.airspeedKmh || 0
    const gForce = sim.telemetry.gForce || 1
    const fromSpeed = Math.max(0, (speedKmh - 78) / 55)
    const fromLoad = Math.max(0, (gForce - 1.45) / 1.3)
    const vapor = Math.min(1, fromSpeed * 0.75 + fromLoad)
    const rate = vapor * vapor * 140
    this.vaporL.emitRate = rate
    this.vaporR.emitRate = rate

    const thrust = sim.thrustNewtons || 0
    const burning = thrust > 80 && !!leftThrusterWorldPos && !!rightThrusterWorldPos
    if (burning && leftThrusterWorldPos && rightThrusterWorldPos) {
      this.leftBell.copyFrom(leftThrusterWorldPos)
      this.rightBell.copyFrom(rightThrusterWorldPos)
      const kick = 2.2 + Math.min(1, thrust / 400) * 3.5
      aim(this.flameL, backX * kick + outX * 0.15, backY * 0.3, backZ * kick + outZ * 0.15)
      aim(this.flameR, backX * kick - outX * 0.15, backY * 0.3, backZ * kick - outZ * 0.15)
      const flameRate = 40 + Math.min(1, (thrust - 80) / 500) * 160
      this.flameL.emitRate = flameRate
      this.flameR.emitRate = flameRate
    } else {
      this.flameL.emitRate = 0
      this.flameR.emitRate = 0
    }
  }

  public reset(): void {
    this.vaporL.reset()
    this.vaporR.reset()
    this.flameL.reset()
    this.flameR.reset()
    this.sleep()
  }

  public dispose(): void {
    this.vaporL.dispose()
    this.vaporR.dispose()
    this.flameL.dispose()
    this.flameR.dispose()
  }

  private paintVapor(): void {
    const hot = new Color4(
      0.75 + this.tint.r * 0.25,
      0.78 + this.tint.g * 0.22,
      0.82 + this.tint.b * 0.18,
      0.42,
    )
    const fade = new Color4(hot.r, hot.g, hot.b, 0)
    for (const ps of [this.vaporL, this.vaporR]) {
      ps.removeColorGradient(0)
      ps.removeColorGradient(0.18)
      ps.removeColorGradient(1)
      ps.addColorGradient(0, new Color4(1, 1, 1, 0.08))
      ps.addColorGradient(0.18, hot)
      ps.addColorGradient(1, fade)
    }
  }

  private makeVapor(scene: Scene, name: string, emitter: Vector3, tex: DynamicTexture): ParticleSystem {
    const ps = new ParticleSystem(name, 700, scene)
    ps.particleTexture = tex
    ps.emitter = emitter
    ps.createPointEmitter(new Vector3(0, 0.2, -1), new Vector3(0, 0.45, -1))
    ps.minLifeTime = 0.7
    ps.maxLifeTime = 1.5
    ps.minSize = 0.45
    ps.maxSize = 1.05
    ps.emitRate = 0
    ps.minEmitPower = 0.6
    ps.maxEmitPower = 1.8
    ps.updateSpeed = 0.016
    ps.gravity = new Vector3(0, 0.35, 0)
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD
    ps.addSizeGradient(0, 0.25)
    ps.addSizeGradient(0.35, 0.7)
    ps.addSizeGradient(1, 1.35)
    ps.start()
    return ps
  }

  private makeFlame(scene: Scene, name: string, emitter: Vector3, tex: DynamicTexture): ParticleSystem {
    const ps = new ParticleSystem(name, 240, scene)
    ps.particleTexture = tex
    ps.emitter = emitter
    ps.createPointEmitter(new Vector3(0, 0, -1), new Vector3(0, 0.1, -1))
    ps.minLifeTime = 0.08
    ps.maxLifeTime = 0.22
    ps.minSize = 0.05
    ps.maxSize = 0.14
    ps.emitRate = 0
    ps.minEmitPower = 1.2
    ps.maxEmitPower = 2.4
    ps.updateSpeed = 0.016
    ps.gravity = new Vector3(0, 0.15, 0)
    ps.blendMode = ParticleSystem.BLENDMODE_ADD
    ps.addSizeGradient(0, 0.45)
    ps.addSizeGradient(1, 1.2)
    ps.addColorGradient(0, new Color4(0.9, 0.98, 1, 0.9))
    ps.addColorGradient(0.35, new Color4(0.25, 0.75, 1, 0.55))
    ps.addColorGradient(1, new Color4(0.05, 0.25, 0.8, 0))
    ps.start()
    return ps
  }
}

function aim(ps: ParticleSystem, x: number, y: number, z: number): void {
  ps.direction1.set(x, y, z)
  ps.direction2.set(x * 0.7, y + 0.15, z * 0.7)
}

function softDisc(scene: Scene, name: string, core: string, mid: string): DynamicTexture {
  const tex = new DynamicTexture(name, { width: 64, height: 64 }, scene, false)
  const ctx = tex.getContext()
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, core)
  g.addColorStop(0.42, mid)
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.clearRect(0, 0, 64, 64)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  tex.hasAlpha = true
  tex.update(false)
  return tex
}
