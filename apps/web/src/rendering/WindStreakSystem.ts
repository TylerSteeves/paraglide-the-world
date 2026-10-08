import { Color4 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import type { LinesMesh } from '@babylonjs/core/Meshes/linesMesh'
import type { Scene } from '@babylonjs/core/scene'
import type { ParagliderSimulation } from '../physics/pendulum'
import { LnStyleManager } from './LnStyleManager'

type Streak = {
  relPos: Vector3 // Local offset relative to canopy center
  lengthScale: number
  speedVariance: number
}

/**
 * 3D Wind Streak System
 * Generates dynamic aerodynamic wind streamlines that rush backwards past the paraglider
 * as forward airspeed increases, providing visceral visual confirmation of forward motion.
 */
export class WindStreakSystem {
  private lineMesh: LinesMesh
  private streaks: Streak[] = []
  private streakCount = 220
  private lines: Vector3[][] = []
  private colors: Color4[][] = []
  private scene: Scene

  constructor(scene: Scene) {
    this.scene = scene

    // Initialize 220 aerodynamic streamlines focused around pilot harness and wing
    for (let i = 0; i < this.streakCount; i++) {
      // 60% concentrated around pilot boots and harness, 40% around wing canopy & risers
      const isPilotStream = i < 132
      const x = isPilotStream
        ? (Math.random() - 0.5) * 5.0
        : (Math.random() - 0.5) * 13.0
      const y = isPilotStream
        ? -7.2 + Math.random() * 4.2
        : -2.5 + Math.random() * 4.5
      const z = -6.0 + Math.random() * 26.0

      this.streaks.push({
        relPos: new Vector3(x, y, z),
        lengthScale: 0.95 + Math.random() * 0.85,
        speedVariance: 0.92 + Math.random() * 0.35,
      })

      // Two points per streak: head and tail
      this.lines.push([new Vector3(0, 0, 0), new Vector3(0, 0, -1)])
      const alpha = 0.35 + Math.random() * 0.45
      this.colors.push([
        new Color4(0.94, 0.98, 1.0, alpha),
        new Color4(0.48, 0.78, 1.0, 0.0), // Electric aerodynamic blue fade at tail
      ])
    }

    this.lineMesh = MeshBuilder.CreateLineSystem(
      'wind-streaks',
      {
        lines: this.lines,
        colors: this.colors,
        updatable: true,
      },
      scene,
    )
    this.lineMesh.isPickable = false
    this.lineMesh.alwaysSelectAsActiveMesh = true
  }

  public update(sim: ParagliderSimulation, dt: number) {
    const airspeedKmh = sim.telemetry.airspeedKmh
    const trimSpeed = sim.wing.trimSpeedKmh || 46.0

    // Only visible when flying forward (> 18 km/h)
    if (airspeedKmh < 18) {
      this.lineMesh.setEnabled(false)
      return
    }
    this.lineMesh.setEnabled(true)

    // Airspeed in m/s
    const airspeedMps = airspeedKmh / 3.6

    // Global intensity: subtle and crisp, keeping the central visual field clear
    const baseAlpha = Math.min(0.65, 0.22 + Math.max(0, (airspeedKmh - 30) / 38.0) * 0.40)

    // Glider forward and right axes in world space
    const yawRad = (sim.canopy.yawDeg * Math.PI) / 180
    const pitchRad = (sim.canopy.pitchDeg * Math.PI) / 180

    // Heading forward vector
    const fwd = new Vector3(
      Math.sin(yawRad) * Math.cos(pitchRad),
      -Math.sin(pitchRad),
      Math.cos(yawRad) * Math.cos(pitchRad),
    ).normalize()

    // 3D flight trajectory vector (Matches camera Focus of Expansion)
    const pVel = new Vector3(sim.pilot.velocity.x, sim.pilot.velocity.y, sim.pilot.velocity.z)
    const velMag = pVel.length()
    const flightDir = velMag > 1.2 ? pVel.scale(1.0 / velMag) : fwd

    const right = new Vector3(Math.cos(yawRad), 0, -Math.sin(yawRad)).normalize()
    const up = Vector3.Cross(right, flightDir).normalize()

    const canopyPos = new Vector3(
      sim.canopy.position.x,
      sim.canopy.position.y,
      sim.canopy.position.z,
    )

    // Tail streak length: scales dynamically with forward airspeed (up to 4.8m on bar/dive)
    const streakDuration = 0.08 + Math.max(0, (airspeedKmh - trimSpeed) / 30.0) * 0.08

    for (let i = 0; i < this.streakCount; i++) {
      const s = this.streaks[i]

      // Move streak backward relative to airflow
      s.relPos.z -= airspeedMps * s.speedVariance * dt

      // Wrap around forward when passed behind
      if (s.relPos.z < -8.0) {
        s.relPos.z = 18.0 + Math.random() * 5.0
        const isPilotStream = i < 132
        s.relPos.x = isPilotStream
          ? (Math.random() - 0.5) * 5.0
          : (Math.random() - 0.5) * 13.0
        s.relPos.y = isPilotStream
          ? -7.2 + Math.random() * 4.2
          : -2.5 + Math.random() * 4.5
      }

      // Convert local coordinate to world space
      // Head position
      const headWorld = canopyPos
        .add(right.scale(s.relPos.x))
        .add(up.scale(s.relPos.y))
        .add(flightDir.scale(s.relPos.z))

      // Tail position extends backwards along airflow with drafting curvature
      const tailLen = airspeedMps * streakDuration * s.lengthScale
      const vx = sim.telemetry.thermalFluidVx ?? 0
      const vy = sim.telemetry.thermalFluidVy ?? 0
      const vz = sim.telemetry.thermalFluidVz ?? 0
      const draftCurve = new Vector3(vx * 0.14, vy * 0.08, vz * 0.14)
      const tailWorld = headWorld.subtract(flightDir.scale(tailLen)).add(draftCurve)

      this.lines[i][0].copyFrom(headWorld)
      this.lines[i][1].copyFrom(tailWorld)

      // Fade streak edges and modulate alpha with speed
      const distFromFront = Math.max(0, Math.min(1.0, (20.0 - s.relPos.z) / 4.0))
      const distFromBack = Math.max(0, Math.min(1.0, (s.relPos.z - -7.0) / 4.0))
      const edgeFade = distFromFront * distFromBack

      // Modulate streamline color based on thermal heat signature
      const tempDelta = sim.telemetry.thermalTempAnomalyC ?? 0
      const isIr = LnStyleManager.getInstance().isIrGoggles
      let headR = 0.94
      let headG = 0.98
      let headB = 1.0

      if (isIr) {
        if (tempDelta > 2.5) {
          headR = 1.0; headG = 0.94; headB = 0.45 // Incandescent Gold
        } else if (tempDelta < -0.8) {
          headR = 0.15; headG = 0.65; headB = 1.0 // Cobalt Cold Tail
        } else {
          headR = 0.98; headG = 0.58; headB = 0.15 // Radiant Amber
        }
      } else if (tempDelta > 2.5) {
        // Hot thermal core: radiant golden sunlit streamlines
        headR = 1.0; headG = 0.88; headB = 0.45
      } else if (tempDelta < -0.8) {
        // Cold tail sink: crisp chilled cyan streamlines
        headR = 0.35; headG = 0.75; headB = 1.0
      }

      this.colors[i][0].r = headR
      this.colors[i][0].g = headG
      this.colors[i][0].b = headB
      this.colors[i][0].a = baseAlpha * edgeFade
      this.colors[i][1].a = 0.0
    }

    // Fast GPU line buffer update
    MeshBuilder.CreateLineSystem(
      'wind-streaks',
      {
        lines: this.lines,
        colors: this.colors,
        instance: this.lineMesh,
      },
      this.scene,
    )
  }

  public dispose() {
    this.lineMesh.dispose()
  }
}
