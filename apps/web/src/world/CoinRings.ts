import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import type { Scene } from '@babylonjs/core/scene'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { FlightWorld } from './types'

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
    } else {
      // --- 🇨🇦 WHISTLER OLYMPIC 7-STAGE BIG SKY & ALPINE ARCHITECTURE FLIGHT COURSE ---
      const pisteCenter = (z: number) => Math.sin(z * 0.0028) * 32.0

      // Stage 1: Summit Launch & Big Sky Speed Dive (z = 65 to 330)
      // Suspended high in the big open alpine sky (>95m clearance over summit headwall)
      const stage1 = [
        { z: 65, x: 0, y: 1845 },
        { z: 130, x: 10, y: 1815 },
        { z: 195, x: 22, y: 1775 },
        { z: 260, x: 28, y: 1730 },
        { z: 330, x: 26, y: 1680 },
      ]
      stage1.forEach((w) =>
        rawWaypoints.push({
          x: w.x,
          y: w.y,
          z: w.z,
          category: 'dive',
          radius: 6.0,
          points: 100,
        }),
      )

      // Stage 2: High-Alpine Centrifugal Slalom (z = 375 to 775)
      // Sweeping S-turns carving back and forth across the big sky bowl (80m-120m clearance)
      for (let z = 375; z <= 775; z += 50) {
        const u = (z - 375) / (775 - 375)
        const sTurn = Math.sin(u * Math.PI * 2.0) * 52.0
        const drift = u * -115.0
        const x = pisteCenter(z) + sTurn + drift
        const y = 1640 - u * 180
        rawWaypoints.push({
          x,
          y,
          z,
          category: 'carve',
          radius: 6.2,
          points: 120,
        })
      }

      // Stage 3: Whistler Peak Thermal Elevator Corkscrew (z = 810 to 970)
      // Located at Whistler Thermal #2 (-100, 1340, 880).
      // Climbs in a buoyant 360° updraft spiral from 1460m up to 1555m!
      const thCenter = { x: -100, z: 880 }
      const thR = 65.0
      for (let i = 0; i <= 8; i++) {
        const t = i / 8
        const angle = -Math.PI / 2 + t * Math.PI * 2
        const zDrift = t * 90
        const x = thCenter.x + Math.cos(angle) * thR
        const z = thCenter.z + Math.sin(angle) * thR * 0.7 + zDrift
        const y = 1460 + t * 95
        rawWaypoints.push({
          x,
          y,
          z,
          category: 'thermal',
          radius: 6.5,
          points: 150,
        })
      }

      // Stage 4: Alpine Chalet Hamlet Proximity Deek (z = 1030 to 1430)
      // Weaving between the 10 cedar chalets, buzzing just above the pitched snow roofs!
      const chalets = [
        { z: 1050, dx: -28, dy: 28 },
        { z: 1130, dx: 26, dy: 26 },
        { z: 1210, dx: -24, dy: 25 },
        { z: 1290, dx: 25, dy: 24 },
        { z: 1370, dx: -22, dy: 24 },
        { z: 1430, dx: 0, dy: 30 },
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
          radius: 6.0,
          points: 150,
        })
      })

      // Stage 5: Acro Bowl Arena (z = 1490 to 1930)
      // Soaring over the massive alpine amphitheater in elevated acrobatic waves!
      for (let z = 1490; z <= 1930; z += 55) {
        const pc = pisteCenter(z)
        const x = pc + Math.sin(z * 0.015) * 26.0
        const gy = world.sampleHeight(x, z)
        const wave = Math.sin(((z - 1490) / 440) * Math.PI * 2) * 12.0
        rawWaypoints.push({
          x,
          y: gy + 62.0 + wave,
          z,
          category: 'acro',
          radius: 7.2,
          points: 200,
        })
      }

      // Stage 6: Olympic Village, Bridge Archway & Clock Tower (z = 1980 to 2420)
      // High-speed proximity carve under the timber bridge and past the clock tower!
      const village = [
        { z: 1980, x: pisteCenter(1980), yRel: 32, rad: 6.0 },
        { z: 2060, x: pisteCenter(2060), yRel: 18, rad: 5.5 },
        { z: 2140, x: pisteCenter(2140), yRel: 4.8, rad: 3.4 }, // Under Timber Ski Bridge arch!
        { z: 2210, x: -16, yRel: 12, rad: 5.8 },                 // Past Grand Lodge balcony!
        { z: 2260, x: 0, yRel: 14, rad: 5.8 },                   // Past Alpine Clock Tower!
        { z: 2340, x: pisteCenter(2340), yRel: 10, rad: 6.0 },
        { z: 2420, x: pisteCenter(2420), yRel: 8, rad: 6.0 },
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

      // Stage 7: Frozen Green Lake Flare & Grand Finish Arch (z = 2500 to 2800)
      // Flat skimming across the frozen lake to the majestic victory arch!
      const lakeZ = [2500, 2580, 2660, 2740]
      lakeZ.forEach((z) => {
        rawWaypoints.push({
          x: 0,
          y: 646 - ((z - 2500) / 240) * 3,
          z,
          category: 'finish',
          radius: 6.2,
          points: 150,
        })
      })

      // Grand Finish Arch at z = 2800
      rawWaypoints.push({
        x: 0,
        y: 648,
        z: 2800,
        category: 'finish',
        radius: 11.0,
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
    return this.rings.filter((r) => r.collected).length
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
  ): { ringCollected: boolean; points: number; speedBonus: boolean; category?: RingCategory; liftBoost?: boolean } {
    let ringCollected = false
    let points = 0
    let speedBonus = false
    let liftBoost = false
    let hitCategory: RingCategory | undefined

    for (const ring of this.rings) {
      if (ring.collected) continue

      // Expanding burst pop animation
      if (ring.collecting) {
        ring.collectAnim += dt * 3.5
        const scale = 1.0 + ring.collectAnim * 0.8
        ring.root.scaling.set(scale, scale, scale)
        if (ring.collectAnim >= 1.0) {
          ring.collected = true
          ring.collecting = false
          ring.root.setEnabled(false)
        }
        continue
      }

      // Rotate inner shimmer disc in the gate plane
      ring.baseRotationY += dt * 2.4
      ring.coreMesh.rotation.z = ring.baseRotationY

      // Distance check to paraglider pilot
      const dx = pilotPos.x - ring.position.x
      const dy = pilotPos.y - ring.position.y
      const dz = pilotPos.z - ring.position.z
      const distSq = dx * dx + dy * dy + dz * dz

      // Collection radius (generous 7.5m - 10.0m)
      const collectDist = ring.radius + 3.8
      if (distSq < collectDist * collectDist) {
        ring.collecting = true
        ringCollected = true
        liftBoost = true
        hitCategory = ring.category
        this.comboStreak++

        // Base points with combo multiplier
        const comboMult = Math.min(5, this.comboStreak)
        points = ring.points * comboMult

        // High-speed swoop bonus: flying through at >105 km/h awards bonus points!
        if (airspeedKmh > 105.0 && (ring.category === 'dive' || ring.category === 'swoop' || ring.category === 'carve')) {
          points += 150
          speedBonus = true
        }
      }
    }

    return { ringCollected, points, speedBonus, category: hitCategory, liftBoost }
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
