import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import type { Scene } from '@babylonjs/core/scene'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { FlightWorld } from './types'
import { TORONTO_GATES } from './TorontoCourse'

export type RingCategory = 'dive' | 'carve' | 'thermal' | 'couloir' | 'acro' | 'swoop' | 'finish' | 'standard'

export type CoinRing = {
  root: TransformNode
  mesh: Mesh
  coreMesh: Mesh
  position: Vector3
  forward: Vector3
  radius: number
  collected: boolean
  baseRotationY: number
  category: RingCategory
  points: number
  collecting: boolean
  collectAnim: number
}

/**
 * Dynamic Flight Mechanics Course & Aerial Rings
 *
 * Whistler Olympic 7-Stage Course:
 * - Stage 1: Summit Chute & Steep Speed Dive (Cyan Gates - prompts diving, speed surges to 135+ km/h)
 * - Stage 2: High-G Centrifugal Sling Slalom (Amber Gold Gates - S-turns exercising slow-to-fast centrifugal whip)
 * - Stage 3: Thermal Elevator Corkscrew & Dynamic Flare (Emerald Green Gates - climbing 360° spiral updraft)
 * - Stage 4: Couloir & Chairlift Weave (Cobalt Blue Gates - high-speed terrain roller contour carving)
 * - Stage 5: Acro Bowl Arena (Electric Violet Gates - high aerial waves for loops and barrel rolls)
 * - Stage 6: Olympic Village Ground Swoop Highway (Radiant Platinum/Gold Gates - ultra low-altitude >120 km/h skim)
 * - Stage 7: Frozen Green Lake Flare & Grand Finish Arch (Regal Gold Crown Arch - victory touchdown flare)
 */
export class CoinRings {
  public rings: CoinRing[] = []
  private materials: Map<RingCategory, { ringMat: StandardMaterial; coreMat: StandardMaterial }> = new Map()
  private spawnedMeshes: (Mesh | TransformNode | any)[] = []
  public comboStreak: number = 0
  private prevPilotPos: Vector3 = new Vector3(0, 1860, 20)
  private hasPrevPos: boolean = false
  private funnelNudgeResult: Vector3 = new Vector3(0, 0, 0)
  /** City rings keep a descending line from the launch. Terrain updates must not pin them to the ground. */
  private skyGates: {
    x: number
    z: number
    drop01: number
    category: RingCategory
    radius: number
    points: number
    /** MSL altitude for an authored city line. Terrain refresh must not recompute it. */
    authoredY?: number
  }[] | null = null

  constructor(scene: Scene, world: FlightWorld) {
    this.initMaterials(scene)

    const rawWaypoints: {
      x: number
      y: number
      z: number
      category: RingCategory
      radius: number
      points: number
    }[] = []

    const roldanilloWorld = world as any
    const isRoldanillo = typeof roldanilloWorld.sampleRidgeSpineX === 'function'

    if (isRoldanillo) {
      // --- 🇨🇴 ROLDANILLO XC RIDGE & THERMAL HIGHWAY ---
      for (let z = 50; z <= 4600; z += 80) {
        const spineX = roldanilloWorld.sampleRidgeSpineX(z)
        const x = spineX - 18 // Windward slope
        const groundY = world.sampleHeight(x, z)
        const clearance = 16.0 + Math.sin(z * 0.01) * 4.0
        rawWaypoints.push({ x, y: groundY + clearance, z, category: 'carve', radius: 4.8, points: 100 })

        // Thermal elevators at La Tulia, Piedra del Sol, Lago Calima
        if (z === 1130) {
          const thermalCenter = new Vector3(320, 2260, 1150)
          const baseAlt = world.sampleHeight(thermalCenter.x, thermalCenter.z) + 20
          for (let step = 0; step < 8; step++) {
            const angle = (step / 8) * Math.PI * 2
            const r = 110
            rawWaypoints.push({
              x: thermalCenter.x + Math.cos(angle) * r,
              y: baseAlt + step * 32,
              z: thermalCenter.z + Math.sin(angle) * r,
              category: 'thermal',
              radius: 5.4,
              points: 150,
            })
          }
        } else if (z === 2130) {
          const thermalCenter = new Vector3(-250, 2320, 2100)
          const baseAlt = world.sampleHeight(thermalCenter.x, thermalCenter.z) + 25
          for (let step = 0; step < 8; step++) {
            const angle = (step / 8) * Math.PI * 2
            const r = 120
            rawWaypoints.push({
              x: thermalCenter.x + Math.sin(angle) * r,
              y: baseAlt + step * 35,
              z: thermalCenter.z + Math.cos(angle) * r,
              category: 'thermal',
              radius: 5.4,
              points: 150,
            })
          }
        } else if (z === 4290) {
          const thermalCenter = new Vector3(-150, 2360, 4300)
          const baseAlt = world.sampleHeight(thermalCenter.x, thermalCenter.z) + 30
          for (let step = 0; step < 8; step++) {
            const angle = (step / 8) * Math.PI * 2
            const r = 130
            rawWaypoints.push({
              x: thermalCenter.x + Math.cos(angle) * r,
              y: baseAlt + step * 40,
              z: thermalCenter.z + Math.sin(angle) * r,
              category: 'thermal',
              radius: 5.8,
              points: 200,
            })
          }
        }
      }
    } else if (this.isToronto(world)) {
      for (const wp of this.buildTorontoCourse()) rawWaypoints.push(wp)
    } else if (this.isGlobeWorld(world)) {
      // A line of rings from the launch altitude down through the landmarks into the city.
      // The first stretch stays high so the opening view is still there, then the track descends.
      for (const wp of this.buildGlobeDescent(world)) rawWaypoints.push(wp)
    } else {
      // --- 🇨🇦 WHISTLER OLYMPIC 7-STAGE TERRAIN-CONTOURED FLOW COURSE ---
      // Every single gate is anchored directly to the mountain slope (world.sampleHeight(x, z) + clearance)
      // so holding the phone in neutral posture naturally surfs right down the ring line!
      const pisteCenter = (z: number) => Math.sin(z * 0.0028) * 32.0

      // Stage 1: Summit Headwall Launch & Flow Line (z = 75 to 355)
      // Placed right down the groomed piste at 13.0m AGL so you thread the first gates immediately on launch!
      const stage1Z = [75, 145, 215, 285, 355]
      stage1Z.forEach((z, idx) => {
        const pc = pisteCenter(z)
        const x = pc + Math.sin(idx * 0.65) * 8.0
        const gy = world.sampleHeight(x, z)
        rawWaypoints.push({
          x,
          y: gy + 13.0,
          z,
          category: 'dive',
          radius: 8.2,
          points: 100,
        })
      })

      // Stage 2: High-Alpine Carving Slalom (z = 430 to 790)
      // Smooth, rhythmic S-turns across the groomed snow bowl at 13.0m AGL
      for (let z = 430; z <= 790; z += 60) {
        const u = (z - 430) / (790 - 430)
        const sTurn = Math.sin(u * Math.PI * 2.0) * 26.0
        const x = pisteCenter(z) + sTurn
        const gy = world.sampleHeight(x, z)
        rawWaypoints.push({
          x,
          y: gy + 13.0,
          z,
          category: 'carve',
          radius: 8.2,
          points: 120,
        })
      }

      // Stage 3: Thermal Ridge Wave & Speed Boost (z = 855 to 1005)
      // Flowing ridge wave surfing the sun-facing bowl at 13.5m AGL
      const stage3Z = [855, 930, 1005]
      stage3Z.forEach((z, idx) => {
        const pc = pisteCenter(z)
        const x = pc + (idx % 2 === 0 ? -16.0 : 16.0)
        const gy = world.sampleHeight(x, z)
        rawWaypoints.push({
          x,
          y: gy + 13.5,
          z,
          category: 'thermal',
          radius: 8.5,
          points: 150,
        })
      })

      // Stage 4: Alpine Chalet Hamlet Proximity Weave (z = 1070 to 1430)
      // Weaving right between the timber ski chalets at rooftop height (13.0m AGL)!
      const chalets = [
        { z: 1070, dx: -14, dy: 13.0 },
        { z: 1145, dx: 14, dy: 13.0 },
        { z: 1220, dx: -15, dy: 13.0 },
        { z: 1295, dx: 15, dy: 13.0 },
        { z: 1370, dx: -12, dy: 13.0 },
        { z: 1440, dx: 0, dy: 13.5 },
      ]
      chalets.forEach((c) => {
        const pc = pisteCenter(c.z)
        const x = pc + c.dx
        const gy = world.sampleHeight(x, c.z)
        rawWaypoints.push({
          x,
          y: gy + c.dy,
          z: c.z,
          category: 'couloir',
          radius: 8.0,
          points: 150,
        })
      })

      // Stage 5: Acro Amphitheater Bowl (z = 1515 to 1905)
      // Fast alpine bowl gates at 14.0m AGL — hit a Barrel Roll or Loop through the violet hoops!
      for (let z = 1515; z <= 1905; z += 65) {
        const pc = pisteCenter(z)
        const x = pc + Math.sin(z * 0.012) * 20.0
        const gy = world.sampleHeight(x, z)
        rawWaypoints.push({
          x,
          y: gy + 14.0,
          z,
          category: 'acro',
          radius: 8.8,
          points: 200,
        })
      }

      // Stage 6: Olympic Village, Timber Bridge & Clock Tower Swoop (z = 1980 to 2420)
      // High-speed proximity run through the village, under the bridge arch, and past the Clock Tower!
      const village = [
        { z: 1980, x: pisteCenter(1980), yRel: 17.0, rad: 8.2 },
        { z: 2060, x: pisteCenter(2060), yRel: 12.5, rad: 7.8 },
        { z: 2140, x: pisteCenter(2140), yRel: 5.5, rad: 6.2 },  // Right under the Timber Ski Bridge arch!
        { z: 2210, x: -10, yRel: 12.0, rad: 7.8 },               // Buzzing past Grand Lodge balcony!
        { z: 2265, x: 4, yRel: 14.0, rad: 7.8 },                 // Skimming past the Olympic Clock Tower!
        { z: 2340, x: pisteCenter(2340), yRel: 14.0, rad: 8.0 },
        { z: 2420, x: pisteCenter(2420), yRel: 13.0, rad: 8.2 },
      ]
      village.forEach((v) => {
        const gy = world.sampleHeight(v.x, v.z)
        rawWaypoints.push({
          x: v.x,
          y: gy + v.yRel,
          z: v.z,
          category: 'swoop',
          radius: v.rad,
          points: 150,
        })
      })

      // Stage 7: Frozen Green Lake Skim & Grand Finish Arch (z = 2500 to 2800)
      const lakeZ = [2500, 2580, 2660, 2740]
      lakeZ.forEach((z) => {
        const gy = world.sampleHeight(0, z)
        rawWaypoints.push({
          x: 0,
          y: gy + 11.0,
          z,
          category: 'finish',
          radius: 8.5,
          points: 150,
        })
      })

      // Grand Finish Arch at z = 2800
      const finishGy = world.sampleHeight(0, 2800)
      rawWaypoints.push({
        x: 0,
        y: finishGy + 12.0,
        z: 2800,
        category: 'finish',
        radius: 13.0,
        points: 500,
      })
    }

    // Build 3D Orientated Gate Hoops along Tangent Vectors
    const totalWp = rawWaypoints.length
    for (let i = 0; i < totalWp; i++) {
      const wp = rawWaypoints[i]
      const pos = new Vector3(wp.x, wp.y, wp.z)

      // Calculate tangent forward direction along flight course
      let fwd: Vector3
      if (i < totalWp - 1) {
        const next = rawWaypoints[i + 1]
        fwd = new Vector3(next.x - wp.x, next.y - wp.y, next.z - wp.z).normalize()
      } else {
        const prev = rawWaypoints[i - 1]
        fwd = new Vector3(wp.x - prev.x, wp.y - prev.y, wp.z - prev.z).normalize()
      }

      // Root TransformNode positioned and oriented along course tangent
      const rootNode = new TransformNode(`gate-root-${i}`, scene)
      rootNode.position.copyFrom(pos)
      rootNode.lookAt(pos.add(fwd))
      this.spawnedMeshes.push(rootNode)

      // Get material for category
      const matPair = this.materials.get(wp.category) ?? this.materials.get('standard')!

      // Outer Torus Gate (Hoop)
      const isGrandFinish = i === totalWp - 1
      const torusDiameter = isGrandFinish ? 22.0 : wp.radius * 2.0
      const torusThickness = isGrandFinish ? 1.35 : 0.70

      const ringMesh = MeshBuilder.CreateTorus(
        `gate-hoop-${i}`,
        { diameter: torusDiameter, thickness: torusThickness, tessellation: isGrandFinish ? 36 : 28 },
        scene,
      )
      ringMesh.parent = rootNode
      ringMesh.rotation.x = Math.PI / 2 // Align torus opening with forward axis
      ringMesh.material = matPair.ringMat
      this.spawnedMeshes.push(ringMesh)

      // Inner Concentric Luminous Guide Ring
      const innerTorusDiameter = isGrandFinish ? 16.0 : wp.radius * 1.35
      const innerRingMesh = MeshBuilder.CreateTorus(
        `gate-inner-ring-${i}`,
        { diameter: innerTorusDiameter, thickness: 0.22, tessellation: isGrandFinish ? 32 : 24 },
        scene,
      )
      innerRingMesh.parent = rootNode
      innerRingMesh.rotation.x = Math.PI / 2
      innerRingMesh.material = matPair.ringMat
      this.spawnedMeshes.push(innerRingMesh)

      // 4 Holographic Inward Alignment Fins
      const finLen = isGrandFinish ? 3.0 : 1.5
      for (let f = 0; f < 4; f++) {
        const finAngle = (f * Math.PI) / 2
        const finDist = (torusDiameter * 0.5 + innerTorusDiameter * 0.5) * 0.5
        const fin = MeshBuilder.CreateBox(
          `gate-fin-${i}-${f}`,
          { width: 0.3, height: finLen, depth: 0.2 },
          scene,
        )
        fin.position.set(Math.sin(finAngle) * finDist, Math.cos(finAngle) * finDist, 0)
        fin.rotation.z = -finAngle
        fin.parent = rootNode
        fin.material = matPair.ringMat
        this.spawnedMeshes.push(fin)
      }

      // Inner Spinning Star/Shimmer Disc
      const discRadius = wp.radius * 0.40
      const coreDisc = MeshBuilder.CreateDisc(
        `gate-core-${i}`,
        { radius: discRadius, tessellation: 16 },
        scene,
      )
      coreDisc.parent = rootNode
      coreDisc.material = matPair.coreMat
      this.spawnedMeshes.push(coreDisc)

      this.rings.push({
        root: rootNode,
        mesh: ringMesh,
        coreMesh: coreDisc,
        position: pos,
        forward: fwd,
        radius: wp.radius,
        collected: false,
        baseRotationY: (i * 0.35) % (Math.PI * 2),
        category: wp.category,
        points: wp.points,
        collecting: false,
        collectAnim: 0,
      })
    }
  }

  private isGlobeWorld(world: FlightWorld): boolean {
    return typeof (world as { site?: { lat?: number } }).site?.lat === 'number'
  }

  private isToronto(world: FlightWorld): boolean {
    return (world as { site?: { id?: string } }).site?.id === 'toronto'
  }

  private buildTorontoCourse(): {
    x: number
    y: number
    z: number
    category: RingCategory
    radius: number
    points: number
  }[] {
    this.skyGates = TORONTO_GATES.map((g) => ({
      x: g.x,
      z: g.z,
      drop01: 0,
      category: g.category,
      radius: g.radius,
      points: g.points,
      authoredY: g.y,
    }))
    return TORONTO_GATES.map((g) => ({
      x: g.x,
      y: g.y,
      z: g.z,
      category: g.category,
      radius: g.radius,
      points: g.points,
    }))
  }

  /**
   * Polyline from the launch through each tall landmark, then a short run past the last one.
   * Height stays near the launch for the opening, then eases down to street level.
   */
  private buildGlobeDescent(world: FlightWorld): {
    x: number
    y: number
    z: number
    category: RingCategory
    radius: number
    points: number
  }[] {
    const launch = world.launchPosition
    const marks: { x: number; z: number; yMax: number }[] = []
    const tall = (world.obstacles ?? [])
      .filter((o) => o.z >= launch.z + 25 && o.yMax - o.yMin >= 55)
      .sort((a, b) => a.z - b.z)
    for (const o of tall) {
      const prev = marks[marks.length - 1]
      if (prev && Math.hypot(o.x - prev.x, o.z - prev.z) < 50) {
        if (o.yMax > prev.yMax) marks[marks.length - 1] = { x: o.x, z: o.z, yMax: o.yMax }
        continue
      }
      marks.push({ x: o.x, z: o.z, yMax: o.yMax })
    }

    const pts: { x: number; z: number }[] = [{ x: launch.x, z: launch.z + 70 }]
    for (const lm of marks) pts.push({ x: lm.x, z: lm.z })
    if (pts.length < 3) {
      pts.push({ x: launch.x + 36, z: launch.z + 640 })
      pts.push({ x: launch.x - 28, z: launch.z + 1280 })
    }
    const last = pts[pts.length - 1]
    const before = pts[pts.length - 2]
    const dx = last.x - before.x
    const dz = last.z - before.z
    const span = Math.hypot(dx, dz) || 1
    pts.push({
      x: last.x + (dx / span) * 340,
      z: last.z + (dz / span) * 340,
    })

    const segLens: number[] = []
    let total = 0
    for (let i = 1; i < pts.length; i++) {
      const sl = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z)
      segLens.push(sl)
      total += sl
    }
    const count = Math.max(9, Math.min(20, Math.round(total / 105)))
    this.skyGates = []
    for (let i = 0; i < count; i++) {
      const u = count === 1 ? 0 : i / (count - 1)
      const dist = u * total
      let acc = 0
      let x = pts[0].x
      let z = pts[0].z
      for (let s = 0; s < segLens.length; s++) {
        if (acc + segLens[s] >= dist || s === segLens.length - 1) {
          const t = segLens[s] < 1 ? 0 : Math.min(1, (dist - acc) / segLens[s])
          x = pts[s].x + (pts[s + 1].x - pts[s].x) * t
          z = pts[s].z + (pts[s + 1].z - pts[s].z) * t
          break
        }
        acc += segLens[s]
      }
      const category: RingCategory =
        i === count - 1 ? 'finish' : u < 0.3 ? 'dive' : u < 0.68 ? 'carve' : 'swoop'
      this.skyGates.push({
        x,
        z,
        drop01: u,
        category,
        radius: i === count - 1 ? 12 : 9.4 - u * 2.4,
        points: i === count - 1 ? 500 : 120,
      })
    }

    return this.solveSkyPositions(world).map((p, i) => ({
      x: p.x,
      y: p.y,
      z: p.z,
      category: this.skyGates![i].category,
      radius: this.skyGates![i].radius,
      points: this.skyGates![i].points,
    }))
  }

  private skyAltitude(world: FlightWorld, x: number, z: number, u: number): number {
    const launchY = world.launchPosition.y
    const groundY = world.sampleHeight(x, z)
    const endY = groundY + 42
    const hold = 0.2
    let drop01: number
    if (u <= hold) {
      drop01 = (u / hold) * 0.05
    } else {
      const t = (u - hold) / (1 - hold)
      const s = t * t * (3 - 2 * t)
      drop01 = 0.05 + s * 0.95
    }
    const y = launchY - 8 - drop01 * Math.max(0, launchY - 8 - endY)
    return Math.max(y, groundY + 24)
  }

  /**
   * Slide a ring out of a tall crash solid only when the ring is at that
   * building's height. Street footprints do not explode you, so they must not
   * push an authored line off the glass.
   */
  private dodgeSolids(world: FlightWorld, x: number, y: number, z: number): number {
    const obstacles = world.obstacles ?? []
    for (let pass = 0; pass < 4; pass++) {
      let moved = false
      for (const o of obstacles) {
        if (o.ring && o.ring.length >= 3) continue
        if (o.yMax - o.yMin < 40) continue
        if (y > o.yMax + 14 || y < o.yMin - 4) continue
        const hw = (o.halfWidth ?? o.radius) + 8
        const hd = (o.halfDepth ?? o.radius) + 8
        if (Math.abs(x - o.x) >= hw || Math.abs(z - o.z) >= hd) continue
        x = x >= o.x ? o.x + hw : o.x - hw
        moved = true
      }
      if (!moved) break
    }
    return x
  }

  private solveSkyPositions(world: FlightWorld): { x: number; y: number; z: number }[] {
    const gates = this.skyGates ?? []
    return gates.map((g) => {
      if (g.authoredY != null) {
        const y = g.authoredY
        return { x: this.dodgeSolids(world, g.x, y, g.z), y, z: g.z }
      }
      const y = this.skyAltitude(world, g.x, g.z, g.drop01)
      const x = this.dodgeSolids(world, g.x, y, g.z)
      const yAt = this.skyAltitude(world, x, g.z, g.drop01)
      return { x: this.dodgeSolids(world, x, yAt, g.z), y: yAt, z: g.z }
    })
  }

  private placeSkyGates(world: FlightWorld): void {
    const placed = this.solveSkyPositions(world)
    for (let i = 0; i < this.rings.length && i < placed.length; i++) {
      const p = placed[i]
      this.rings[i].position.set(p.x, p.y, p.z)
      this.rings[i].root.position.copyFrom(this.rings[i].position)
    }
    for (let i = 0; i < this.rings.length; i++) {
      const ring = this.rings[i]
      const next = this.rings[i + 1]?.position
      const prev = this.rings[i - 1]?.position
      const fwd = next ? next.subtract(ring.position) : ring.position.subtract(prev ?? ring.position)
      if (fwd.lengthSquared() < 1e-4) continue
      fwd.normalize()
      ring.forward.copyFrom(fwd)
      ring.root.lookAt(ring.position.add(ring.forward))
    }
  }

  private initMaterials(scene: Scene) {
    const createMat = (name: string, diff: Color3, emis: Color3, spec: Color3, alpha: number = 1.0) => {
      const mat = new StandardMaterial(name, scene)
      mat.diffuseColor = diff
      mat.emissiveColor = emis
      mat.specularColor = spec
      mat.alpha = alpha
      this.spawnedMeshes.push(mat)
      return mat
    }

    // Standard Gold
    const goldRing = createMat('mat-gold-ring', new Color3(1.0, 0.84, 0.18), new Color3(0.75, 0.55, 0.10), new Color3(0.9, 0.85, 0.5))
    const goldCore = createMat('mat-gold-core', new Color3(1.0, 0.95, 0.6), new Color3(0.9, 0.75, 0.2), new Color3(0.9, 0.9, 0.9), 0.55)
    this.materials.set('standard', { ringMat: goldRing, coreMat: goldCore })

    // Dive: Electric Neon Cyan (Prompts tip forward into speed dive)
    const diveRing = createMat('mat-dive-ring', new Color3(0.12, 0.88, 1.0), new Color3(0.08, 0.72, 0.95), new Color3(0.8, 0.95, 1.0))
    const diveCore = createMat('mat-dive-core', new Color3(0.4, 0.95, 1.0), new Color3(0.2, 0.85, 1.0), new Color3(1.0, 1.0, 1.0), 0.60)
    this.materials.set('dive', { ringMat: diveRing, coreMat: diveCore })

    // Carve: Fiery Amber / Orange (High-G centrifugal sling slalom)
    const carveRing = createMat('mat-carve-ring', new Color3(1.0, 0.52, 0.10), new Color3(0.92, 0.40, 0.05), new Color3(1.0, 0.75, 0.4))
    const carveCore = createMat('mat-carve-core', new Color3(1.0, 0.75, 0.3), new Color3(0.95, 0.55, 0.1), new Color3(1.0, 0.9, 0.6), 0.60)
    this.materials.set('carve', { ringMat: carveRing, coreMat: carveCore })

    // Thermal: Soaring Emerald Green (360° climbing thermal elevator)
    const thermalRing = createMat('mat-thermal-ring', new Color3(0.15, 0.95, 0.45), new Color3(0.10, 0.80, 0.35), new Color3(0.6, 1.0, 0.7))
    const thermalCore = createMat('mat-thermal-core', new Color3(0.4, 1.0, 0.6), new Color3(0.2, 0.9, 0.45), new Color3(0.9, 1.0, 0.9), 0.55)
    this.materials.set('thermal', { ringMat: thermalRing, coreMat: thermalCore })

    // Couloir: Ice Blue (High-speed contour carving along chairlift)
    const couloirRing = createMat('mat-couloir-ring', new Color3(0.35, 0.82, 0.98), new Color3(0.20, 0.65, 0.92), new Color3(0.7, 0.9, 1.0))
    const couloirCore = createMat('mat-couloir-core', new Color3(0.6, 0.9, 1.0), new Color3(0.3, 0.75, 0.95), new Color3(1.0, 1.0, 1.0), 0.55)
    this.materials.set('couloir', { ringMat: couloirRing, coreMat: couloirCore })

    // Acro: Electric Violet / Magenta (Barrel rolls and loops in alpine amphitheater)
    const acroRing = createMat('mat-acro-ring', new Color3(0.88, 0.25, 0.98), new Color3(0.72, 0.15, 0.85), new Color3(0.95, 0.6, 1.0))
    const acroCore = createMat('mat-acro-core', new Color3(0.95, 0.5, 1.0), new Color3(0.85, 0.25, 0.95), new Color3(1.0, 0.8, 1.0), 0.65)
    this.materials.set('acro', { ringMat: acroRing, coreMat: acroCore })

    // Swoop: Radiant Platinum / Diamond Gold (Low-altitude corduroy ground skim)
    const swoopRing = createMat('mat-swoop-ring', new Color3(1.0, 0.96, 0.85), new Color3(0.95, 0.88, 0.55), new Color3(1.0, 1.0, 0.9))
    const swoopCore = createMat('mat-swoop-core', new Color3(1.0, 0.98, 0.9), new Color3(0.95, 0.92, 0.7), new Color3(1.0, 1.0, 1.0), 0.65)
    this.materials.set('swoop', { ringMat: swoopRing, coreMat: swoopCore })

    // Finish: Regal Royal Gold Grand Arch (Lake touchdown finish)
    const finishRing = createMat('mat-finish-ring', new Color3(1.0, 0.82, 0.15), new Color3(0.98, 0.75, 0.20), new Color3(1.0, 0.92, 0.6))
    const finishCore = createMat('mat-finish-core', new Color3(1.0, 0.95, 0.5), new Color3(0.98, 0.85, 0.3), new Color3(1.0, 1.0, 0.8), 0.70)
    this.materials.set('finish', { ringMat: finishRing, coreMat: finishCore })
  }

  public get totalCoins(): number {
    return this.rings.length
  }

  public get collectedCount(): number {
    return this.rings.filter((r) => r.collected || r.collecting).length
  }

  public reset(): void {
    this.comboStreak = 0
    for (const ring of this.rings) {
      ring.collected = false
      ring.collecting = false
      ring.collectAnim = 0
      ring.root.scaling.set(1.0, 1.0, 1.0)
      ring.root.setEnabled(true)
    }
  }

  public update(
    pilotPos: Vector3,
    dt: number,
    airspeedKmh: number = 0,
  ): {
    ringCollected: boolean
    points: number
    speedBonus: boolean
    category?: RingCategory
    liftBoost?: boolean
    funnelNudge: Vector3
  } {
    let ringCollected = false
    let points = 0
    let speedBonus = false
    let liftBoost = false
    let hitCategory: RingCategory | undefined

    this.funnelNudgeResult.set(0, 0, 0)

    if (!this.hasPrevPos) {
      this.prevPilotPos.copyFrom(pilotPos)
      this.hasPrevPos = true
    }

    const p0 = this.prevPilotPos
    const p1 = pilotPos
    const segX = p1.x - p0.x
    const segY = p1.y - p0.y
    const segZ = p1.z - p0.z

    let foundNextGate = false
    const pulseTime = performance.now() * 0.006

    for (const ring of this.rings) {
      if (ring.collected) continue

      // Expanding burst pop animation
      if (ring.collecting) {
        ring.collectAnim += dt * 3.8
        const scale = 1.0 + ring.collectAnim * 0.9
        ring.root.scaling.set(scale, scale, scale)
        if (ring.collectAnim >= 1.0) {
          ring.collected = true
          ring.collecting = false
          ring.root.setEnabled(false)
        }
        continue
      }

      // On an authored city line the next ring is the next one in order, even when the
      // path turns back. Mountain courses still highlight the next gate ahead in z.
      const isNext = this.skyGates ? true : ring.position.z >= p1.z - 8.0
      if (!foundNextGate && isNext) {
        foundNextGate = true
        const pulse = 1.08 + Math.sin(pulseTime) * 0.08
        ring.root.scaling.set(pulse, pulse, pulse)
      } else {
        ring.root.scaling.set(1.0, 1.0, 1.0)
      }

      // Rotate inner shimmer disc in the gate plane
      ring.baseRotationY += dt * 2.6
      ring.coreMesh.rotation.z = ring.baseRotationY

      // --- 1. Continuous Plane-Crossing + Dual Body (Pilot & Canopy) Distance Detection ---
      const cx = ring.position.x
      const cy = ring.position.y
      const cz = ring.position.z
      const nx = ring.forward.x
      const ny = ring.forward.y
      const nz = ring.forward.z

      // Signed distance of previous and current pilot positions from the hoop's plane
      const d0 = (p0.x - cx) * nx + (p0.y - cy) * ny + (p0.z - cz) * nz
      const d1 = (p1.x - cx) * nx + (p1.y - cy) * ny + (p1.z - cz) * nz

      let isHit = false
      const collectRadius = ring.radius + 6.2

      // Check plane crossing between frames (catches 180+ km/h dives without tunneling)
      if ((d0 <= 0 && d1 >= 0) || (d0 >= 0 && d1 <= 0)) {
        const denom = d1 - d0
        if (Math.abs(denom) > 1e-5) {
          const t = -d0 / denom
          if (t >= -0.15 && t <= 1.15) {
            const ix = p0.x + t * segX
            const iy = p0.y + t * segY
            const iz = p0.z + t * segZ
            const idx = ix - cx
            const idy = iy - cy
            const idz = iz - cz
            const idyCanopy = (iy + 2.2) - cy
            const distPilotSq = idx * idx + idy * idy + idz * idz
            const distRigCenterSq = idx * idx + idyCanopy * idyCanopy + idz * idz
            if (Math.min(distPilotSq, distRigCenterSq) <= collectRadius * collectRadius) {
              isHit = true
            }
          }
        }
      }

      // Point proximity fallback check (testing both pilot and rig midpoint)
      if (!isHit) {
        const dx = p1.x - cx
        const dy = p1.y - cy
        const dyMid = (p1.y + 2.2) - cy
        const dz = p1.z - cz
        const distSq = dx * dx + Math.min(dy * dy, dyMid * dyMid) + dz * dz
        if (distSq <= collectRadius * collectRadius) {
          isHit = true
        }
      }

      if (isHit) {
        ring.collecting = true
        ringCollected = true
        liftBoost = true
        hitCategory = ring.category
        this.comboStreak++

        // Base points with combo multiplier
        const comboMult = Math.min(5, this.comboStreak)
        points = ring.points * comboMult

        // High-speed swoop bonus: flying through at >90 km/h awards bonus points!
        if (airspeedKmh > 90.0 && (ring.category === 'dive' || ring.category === 'swoop' || ring.category === 'carve')) {
          points += 150
          speedBonus = true
        }
      } else {
        // --- 2. Aerodynamic Slipstream Funnel Assist ---
        // When approaching from upstream (up to 60m away), gently guide trajectory toward hoop center
        if (d1 < -0.5 && d1 > -60.0) {
          const dx = p1.x - cx
          const dy = (p1.y + 1.5) - cy
          const dz = p1.z - cz
          // Radial vector perpendicular to forward normal
          const rx = dx - d1 * nx
          const ry = dy - d1 * ny
          const rz = dz - d1 * nz
          const radialDist = Math.sqrt(rx * rx + ry * ry + rz * rz)
          const coneRadius = ring.radius * 3.8 + 8.0

          if (radialDist < coneRadius && radialDist > 0.05) {
            const approachWeight = 1.0 - (-d1 / 60.0)
            const coneWeight = 1.0 - (radialDist / coneRadius)
            const strength = 4.5 * approachWeight * coneWeight * dt
            const pullFactor = Math.min(0.08, strength / radialDist)
            this.funnelNudgeResult.x -= rx * pullFactor
            this.funnelNudgeResult.y -= ry * pullFactor
            this.funnelNudgeResult.z -= rz * pullFactor
          }
        }
      }
    }

    this.prevPilotPos.copyFrom(pilotPos)
    return {
      ringCollected,
      points,
      speedBonus,
      category: hitCategory,
      liftBoost,
      funnelNudge: this.funnelNudgeResult,
    }
  }

  public reanchorToTerrain(world: FlightWorld): void {
    if (this.skyGates) {
      this.placeSkyGates(world)
      return
    }
    for (const ring of this.rings) {
      const gy = world.sampleHeight(ring.position.x, ring.position.z)
      const clearance = ring.category === 'finish' ? 11.5 : 13.5
      ring.position.y = gy + clearance
      ring.root.position.y = ring.position.y
    }
  }

  public dispose(): void {
    for (const m of this.spawnedMeshes) {
      if (m && m.dispose) m.dispose(false, true)
    }
    this.spawnedMeshes = []
    this.rings = []
    this.materials.clear()
  }
}
