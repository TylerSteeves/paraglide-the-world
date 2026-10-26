import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Scene } from '@babylonjs/core/scene'

interface RagdollPart {
  node: TransformNode
  pos: Vector3
  vel: Vector3
  angVel: Vector3
  rot: Vector3
  radius: number
  attachedToTorso: boolean
  localOffset: Vector3
  bounceCount: number
  bleeds: boolean
}

interface BloodParticle {
  mesh: Mesh
  pos: Vector3
  vel: Vector3
  life: number
  maxLife: number
  scale: number
  active: boolean
}

interface BloodDecal {
  mesh: Mesh
  active: boolean
}

export class RagdollCrashSystem {
  private root: TransformNode
  private parts: RagdollPart[] = []
  private torsoPart!: RagdollPart
  private crumpledCanopy: Mesh
  private canopyPos: Vector3 = new Vector3()
  private canopyVel: Vector3 = new Vector3()
  private canopyRot: Vector3 = new Vector3()

  private bloodParticles: BloodParticle[] = []
  private bloodDecals: BloodDecal[] = []
  private nextDecalIdx: number = 0

  public isActive: boolean = false
  public crashElapsedSec: number = 0
  private sprayTimer: number = 0

  private bloodBrightMat: StandardMaterial
  private bloodDarkMat: StandardMaterial
  private boneMat: StandardMaterial
  private suitMat: StandardMaterial
  private pantsMat: StandardMaterial
  private helmetMat: StandardMaterial
  private visorMat: StandardMaterial
  private bootMat: StandardMaterial
  private soleMat: StandardMaterial
  private leatherMat: StandardMaterial
  private brassMat: StandardMaterial
  private tealMat: StandardMaterial

  constructor(scene: Scene) {
    this.root = new TransformNode('ragdoll-crash-root', scene)

    // Vivid arterial crimson & deep gore materials
    this.bloodBrightMat = new StandardMaterial('gore-blood-bright', scene)
    this.bloodBrightMat.diffuseColor = new Color3(0.82, 0.03, 0.05)
    this.bloodBrightMat.emissiveColor = new Color3(0.32, 0.01, 0.02)
    this.bloodBrightMat.specularColor = new Color3(0.6, 0.15, 0.15)
    this.bloodBrightMat.backFaceCulling = false

    this.bloodDarkMat = new StandardMaterial('gore-blood-dark', scene)
    this.bloodDarkMat.diffuseColor = new Color3(0.52, 0.01, 0.03)
    this.bloodDarkMat.emissiveColor = new Color3(0.18, 0.0, 0.01)
    this.bloodDarkMat.specularColor = new Color3(0.4, 0.1, 0.1)
    this.bloodDarkMat.backFaceCulling = false

    this.boneMat = new StandardMaterial('gore-bone-mat', scene)
    this.boneMat.diffuseColor = new Color3(0.95, 0.92, 0.85)
    this.boneMat.emissiveColor = new Color3(0.2, 0.18, 0.15)

    // Same airman the flight uses: orange suit, white pants, pale helmet, brown boots.
    this.suitMat = this.paint(scene, 'ragdoll-suit-mat', new Color3(0.86, 0.4, 0.14))
    this.pantsMat = this.paint(scene, 'ragdoll-pants-mat', new Color3(0.9, 0.88, 0.82))
    this.helmetMat = this.paint(scene, 'ragdoll-helmet-mat', new Color3(0.93, 0.9, 0.82))
    this.visorMat = this.paint(scene, 'ragdoll-visor-mat', new Color3(0.06, 0.07, 0.08))
    this.bootMat = this.paint(scene, 'ragdoll-boot-mat', new Color3(0.48, 0.27, 0.13))
    this.soleMat = this.paint(scene, 'ragdoll-sole-mat', new Color3(0.18, 0.12, 0.08))
    this.leatherMat = this.paint(scene, 'ragdoll-leather-mat', new Color3(0.42, 0.24, 0.13))
    this.brassMat = this.paint(scene, 'ragdoll-brass-mat', new Color3(0.72, 0.52, 0.22))
    this.tealMat = this.paint(scene, 'ragdoll-teal-mat', new Color3(0.55, 0.78, 0.74))
    const suitMat = this.suitMat
    const helmetMat = this.helmetMat
    const visorMat = this.visorMat
    const bootMat = this.bootMat

    const canopyMat = new StandardMaterial('ragdoll-canopy-mat', scene)
    canopyMat.diffuseColor = new Color3(0.86, 0.4, 0.14)
    canopyMat.emissiveColor = canopyMat.diffuseColor.scale(0.2)
    canopyMat.backFaceCulling = false

    // 1. Orange suit torso, thin seat, neck stump. Not the old dark harness box.
    const torsoNode = new TransformNode('ragdoll-torso', scene)
    torsoNode.parent = this.root
    const chest = MeshBuilder.CreateSphere('rd-chest', { diameter: 0.42, segments: 12 }, scene)
    chest.scaling.set(0.94, 1.2, 0.72)
    chest.position.set(0, 0.06, 0.02)
    chest.material = suitMat
    chest.parent = torsoNode
    const waist = MeshBuilder.CreateCylinder('rd-waist', { height: 0.18, diameterTop: 0.28, diameterBottom: 0.32, tessellation: 10 }, scene)
    waist.position.set(0, -0.16, 0)
    waist.material = suitMat
    waist.parent = torsoNode
    const seat = MeshBuilder.CreateBox('rd-seat', { width: 0.26, height: 0.04, depth: 0.16 }, scene)
    seat.position.set(0, -0.28, -0.02)
    seat.material = this.leatherMat
    seat.parent = torsoNode
    const buckle = MeshBuilder.CreateBox('rd-buckle', { width: 0.055, height: 0.04, depth: 0.02 }, scene)
    buckle.position.set(0, 0.02, 0.16)
    buckle.material = this.brassMat
    buckle.parent = torsoNode
    const gorePatch = MeshBuilder.CreateSphere('rd-torso-gore', { diameter: 0.12, segments: 8 }, scene)
    gorePatch.position.set(0, 0.3, 0.02)
    gorePatch.material = this.bloodBrightMat
    gorePatch.parent = torsoNode

    this.torsoPart = {
      node: torsoNode,
      pos: new Vector3(),
      vel: new Vector3(),
      angVel: new Vector3(),
      rot: new Vector3(),
      radius: 0.38,
      attachedToTorso: false,
      localOffset: Vector3.Zero(),
      bounceCount: 0,
      bleeds: true,
    }
    this.parts.push(this.torsoPart)

    // 2. Pale helmet, teal crown, dark goggles. Same head as the flying airman.
    const headNode = new TransformNode('ragdoll-head', scene)
    headNode.parent = this.root
    const helmet = MeshBuilder.CreateSphere('rd-helmet', { diameter: 0.26, segments: 12 }, scene)
    helmet.scaling.set(1.02, 1.08, 1.0)
    helmet.material = helmetMat
    helmet.parent = headNode
    const crown = MeshBuilder.CreateSphere('rd-crown', { diameter: 0.16, segments: 10 }, scene)
    crown.scaling.set(1.05, 0.5, 0.9)
    crown.position.set(0, 0.1, 0.02)
    crown.material = this.tealMat
    crown.parent = headNode
    for (const side of [-1, 1]) {
      const lens = MeshBuilder.CreateSphere(`rd-lens-${side}`, { diameter: 0.074, segments: 8 }, scene)
      lens.scaling.set(1, 1, 0.45)
      lens.position.set(side * 0.04, 0.01, 0.11)
      lens.material = visorMat
      lens.parent = headNode
      const rim = MeshBuilder.CreateTorus(`rd-rim-${side}`, { diameter: 0.088, thickness: 0.012, tessellation: 12 }, scene)
      rim.position.set(side * 0.04, 0.01, 0.1)
      rim.material = this.brassMat
      rim.parent = headNode
    }
    const neckGore = MeshBuilder.CreateCylinder('rd-neck-gore', { height: 0.1, diameter: 0.1 }, scene)
    neckGore.position.set(0, -0.16, 0)
    neckGore.material = this.bloodBrightMat
    neckGore.parent = headNode

    this.parts.push({
      node: headNode,
      pos: new Vector3(),
      vel: new Vector3(),
      angVel: new Vector3(),
      rot: new Vector3(),
      radius: 0.20,
      attachedToTorso: false,
      localOffset: new Vector3(0, 0.45, 0.04),
      bounceCount: 0,
      bleeds: true,
    })

    // 3. Orange suited arms, leather gloves, shoulder stump.
    for (const side of [-1, 1]) {
      const armNode = new TransformNode(`ragdoll-arm-${side}`, scene)
      armNode.parent = this.root
      const upper = MeshBuilder.CreateCylinder(`rd-upper-${side}`, { height: 0.28, diameter: 0.11, tessellation: 10 }, scene)
      upper.position.y = 0.12
      upper.material = suitMat
      upper.parent = armNode
      const fore = MeshBuilder.CreateCylinder(`rd-fore-${side}`, { height: 0.24, diameter: 0.09, tessellation: 10 }, scene)
      fore.position.set(side * 0.04, -0.16, 0)
      fore.rotation.z = side * 0.4
      fore.material = suitMat
      fore.parent = armNode
      const glove = MeshBuilder.CreateBox(`rd-glove-${side}`, { width: 0.07, height: 0.08, depth: 0.05 }, scene)
      glove.position.set(side * 0.08, -0.3, 0)
      glove.material = this.leatherMat
      glove.parent = armNode
      const stump = MeshBuilder.CreateSphere(`rd-arm-gore-${side}`, { diameter: 0.12, segments: 6 }, scene)
      stump.position.set(0, 0.26, 0)
      stump.material = this.bloodBrightMat
      stump.parent = armNode
      const bone = MeshBuilder.CreateCylinder(`rd-arm-bone-${side}`, { height: 0.1, diameter: 0.04 }, scene)
      bone.position.set(0, 0.32, 0)
      bone.material = this.boneMat
      bone.parent = armNode

      this.parts.push({
        node: armNode,
        pos: new Vector3(),
        vel: new Vector3(),
        angVel: new Vector3(),
        rot: new Vector3(),
        radius: 0.18,
        attachedToTorso: false,
        localOffset: new Vector3(side * 0.34, 0.18, 0),
        bounceCount: 0,
        bleeds: true,
      })
    }

    // 4. White pants and brown boots. The old crash legs were a dark suit with red shoes.
    for (const side of [-1, 1]) {
      const legNode = new TransformNode(`ragdoll-leg-${side}`, scene)
      legNode.parent = this.root
      const thigh = MeshBuilder.CreateCylinder(`rd-thigh-${side}`, { height: 0.4, diameter: 0.14, tessellation: 10 }, scene)
      thigh.position.y = 0.16
      thigh.material = this.pantsMat
      thigh.parent = legNode
      const shin = MeshBuilder.CreateCylinder(`rd-shin-${side}`, { height: 0.36, diameter: 0.1, tessellation: 10 }, scene)
      shin.position.y = -0.18
      shin.material = this.pantsMat
      shin.parent = legNode
      const boot = MeshBuilder.CreateBox(`rd-boot-${side}`, { width: 0.12, height: 0.08, depth: 0.24 }, scene)
      boot.position.set(0, -0.4, 0.05)
      boot.material = bootMat
      boot.parent = legNode
      const sole = MeshBuilder.CreateBox(`rd-sole-${side}`, { width: 0.13, height: 0.03, depth: 0.26 }, scene)
      sole.position.set(0, -0.45, 0.05)
      sole.material = this.soleMat
      sole.parent = legNode
      const hipGore = MeshBuilder.CreateSphere(`rd-leg-gore-${side}`, { diameter: 0.12, segments: 6 }, scene)
      hipGore.position.set(0, 0.36, 0)
      hipGore.material = this.bloodBrightMat
      hipGore.parent = legNode
      const femur = MeshBuilder.CreateCylinder(`rd-femur-${side}`, { height: 0.1, diameter: 0.045 }, scene)
      femur.position.set(0, 0.42, 0)
      femur.material = this.boneMat
      femur.parent = legNode

      this.parts.push({
        node: legNode,
        pos: new Vector3(),
        vel: new Vector3(),
        angVel: new Vector3(),
        rot: new Vector3(),
        radius: 0.22,
        attachedToTorso: false,
        localOffset: new Vector3(side * 0.18, -0.45, 0.08),
        bounceCount: 0,
        bleeds: true,
      })
    }

    // 5. Crumpled Deflated Paraglider Canopy Sheet
    this.crumpledCanopy = MeshBuilder.CreateSphere('ragdoll-canopy', { diameter: 2.6, segments: 8 }, scene)
    this.crumpledCanopy.scaling.set(1.8, 0.22, 1.1)
    this.crumpledCanopy.material = canopyMat
    this.crumpledCanopy.parent = this.root

    // 6. Pool of 85 3D Arterial Blood Geyser Droplets
    for (let i = 0; i < 85; i++) {
      const drop = MeshBuilder.CreateSphere(`gore-drop-${i}`, { diameter: 0.22, segments: 6 }, scene)
      drop.material = i % 3 === 0 ? this.bloodDarkMat : this.bloodBrightMat
      drop.parent = this.root
      drop.setEnabled(false)
      this.bloodParticles.push({
        mesh: drop,
        pos: new Vector3(),
        vel: new Vector3(),
        life: 0,
        maxLife: 1.0,
        scale: 1.0,
        active: false,
      })
    }

    // 7. Pool of 50 Persistent Snow Blood Splatters
    for (let i = 0; i < 50; i++) {
      const splat = MeshBuilder.CreateDisc(`gore-splat-${i}`, { radius: 1.0, tessellation: 14 }, scene)
      splat.rotation.x = Math.PI * 0.5
      splat.material = i % 2 === 0 ? this.bloodBrightMat : this.bloodDarkMat
      splat.parent = this.root
      splat.setEnabled(false)
      this.bloodDecals.push({
        mesh: splat,
        active: false,
      })
    }

    this.root.setEnabled(false)
  }

  public setVisible(visible: boolean): void {
    this.root.setEnabled(visible)
  }

  /** Match the suit, helmet, goggles, and boots that are in the air. Pants stay white. */
  public dress(skin: {
    suit: { r: number; g: number; b: number }
    helmet: { r: number; g: number; b: number }
    visor: { r: number; g: number; b: number }
    boots: { r: number; g: number; b: number }
  }): void {
    this.paintOnto(this.suitMat, new Color3(skin.suit.r, skin.suit.g, skin.suit.b))
    this.paintOnto(this.helmetMat, new Color3(skin.helmet.r, skin.helmet.g, skin.helmet.b))
    this.paintOnto(this.visorMat, new Color3(skin.visor.r, skin.visor.g, skin.visor.b))
    this.paintOnto(this.bootMat, new Color3(skin.boots.r, skin.boots.g, skin.boots.b))
  }

  private paint(scene: Scene, name: string, color: Color3): StandardMaterial {
    const mat = new StandardMaterial(name, scene)
    this.paintOnto(mat, color)
    mat.specularColor = new Color3(0.08, 0.07, 0.06)
    return mat
  }

  private paintOnto(mat: StandardMaterial, color: Color3): void {
    mat.diffuseColor = color
    mat.emissiveColor = color.scale(0.2)
  }

  public triggerCrash(
    pilotPos: { x: number; y: number; z: number },
    pilotVel: { x: number; y: number; z: number },
    canopyPos: { x: number; y: number; z: number },
    impactSpeedKmh: number,
    sampleTerrainHeight: (x: number, z: number) => number,
  ): void {
    this.isActive = true
    this.crashElapsedSec = 0
    this.sprayTimer = 0
    this.root.setEnabled(true)

    const violentImpact = impactSpeedKmh >= 42
    const speedScale = Math.max(1.0, impactSpeedKmh / 48.0)

    // Ensure initial ragdoll spawn is slightly above terrain so it bounces violently down the mountain
    const groundY = sampleTerrainHeight(pilotPos.x, pilotPos.z)
    const startY = Math.max(groundY + 0.65, pilotPos.y)

    for (let i = 0; i < this.parts.length; i++) {
      const part = this.parts[i]
      part.bounceCount = 0
      part.node.setEnabled(true)
      part.pos.set(
        pilotPos.x + part.localOffset.x,
        startY + part.localOffset.y,
        pilotPos.z + part.localOffset.z,
      )

      if (i === 0) {
        // Torso launches forward & upward into a violent cartwheel down the slope
        part.attachedToTorso = false
        part.vel.set(
          pilotVel.x * 0.78 + (Math.random() - 0.5) * 4.5,
          Math.max(4.5, Math.abs(pilotVel.y) * 0.55 + 3.8 * speedScale),
          pilotVel.z * 0.78 + (Math.random() - 0.5) * 4.5,
        )
        part.angVel.set(
          (Math.random() > 0.5 ? 1 : -1) * (9.5 + Math.random() * 8.0),
          (Math.random() - 0.5) * 10.0,
          (Math.random() > 0.5 ? 1 : -1) * (8.5 + Math.random() * 8.0),
        )
      } else {
        // Limbs and helmet rip loose on high-speed impact or detach on first bounce!
        const detachNow = violentImpact && (i === 1 || Math.random() < 0.78)
        part.attachedToTorso = !detachNow
        part.vel.set(
          pilotVel.x * 0.82 + part.localOffset.x * 14.0 + (Math.random() - 0.5) * 11.0 * speedScale,
          Math.max(5.5, Math.abs(pilotVel.y) * 0.65 + (4.5 + Math.random() * 6.5) * speedScale),
          pilotVel.z * 0.82 + (Math.random() - 0.5) * 11.0 * speedScale,
        )
        part.angVel.set(
          (Math.random() - 0.5) * 24.0,
          (Math.random() - 0.5) * 24.0,
          (Math.random() - 0.5) * 24.0,
        )
      }

      part.rot.set(Math.random() * 3.14, Math.random() * 3.14, Math.random() * 3.14)
      part.node.position.copyFrom(part.pos)
      part.node.rotation.copyFrom(part.rot)
    }

    // Crumpled canopy collapses onto the snow behind the wreck
    this.canopyPos.set(canopyPos.x, Math.max(groundY + 1.2, canopyPos.y), canopyPos.z)
    this.canopyVel.set(pilotVel.x * 0.45, Math.min(-2.0, pilotVel.y * 0.5), pilotVel.z * 0.45)
    this.canopyRot.set(0, 0, 0)
    this.crumpledCanopy.position.copyFrom(this.canopyPos)
    this.crumpledCanopy.setEnabled(true)

    // Erupt massive initial blood geyser & lay down big impact splatter on the snow!
    this.spawnBloodBurst(this.torsoPart.pos, 42, 13.0 * speedScale)
    this.spawnSnowSplatter(pilotPos.x, pilotPos.z, 2.2 * speedScale, sampleTerrainHeight)
    this.spawnSnowSplatter(pilotPos.x + 1.1, pilotPos.z + 0.9, 1.5 * speedScale, sampleTerrainHeight)
  }

  private spawnBloodBurst(origin: Vector3, count: number, maxSpeed: number): void {
    let spawned = 0
    for (let i = 0; i < this.bloodParticles.length && spawned < count; i++) {
      const p = this.bloodParticles[i]
      if (!p.active) {
        p.active = true
        p.life = 0
        p.maxLife = 0.75 + Math.random() * 0.95
        p.scale = 0.7 + Math.random() * 1.45
        p.pos.copyFrom(origin)
        p.pos.x += (Math.random() - 0.5) * 0.35
        p.pos.y += (Math.random() - 0.2) * 0.35
        p.pos.z += (Math.random() - 0.5) * 0.35

        const theta = Math.random() * Math.PI * 2
        const spd = (0.3 + Math.random() * 0.7) * maxSpeed
        p.vel.set(
          Math.cos(theta) * spd * 0.75,
          3.2 + Math.random() * spd * 0.95,
          Math.sin(theta) * spd * 0.75,
        )

        p.mesh.position.copyFrom(p.pos)
        p.mesh.scaling.setAll(p.scale)
        p.mesh.setEnabled(true)
        spawned++
      }
    }
  }

  private spawnSnowSplatter(
    x: number,
    z: number,
    radius: number,
    sampleTerrainHeight: (x: number, z: number) => number,
  ): void {
    const decal = this.bloodDecals[this.nextDecalIdx]
    this.nextDecalIdx = (this.nextDecalIdx + 1) % this.bloodDecals.length

    const hC = sampleTerrainHeight(x, z)
    const eps = 1.0
    const dhdx = (sampleTerrainHeight(x + eps, z) - sampleTerrainHeight(x - eps, z)) / (2 * eps)
    const dhdz = (sampleTerrainHeight(x, z + eps) - sampleTerrainHeight(x, z - eps)) / (2 * eps)

    decal.active = true
    decal.mesh.position.set(x, hC + 0.08 + (this.nextDecalIdx % 7) * 0.006, z)
    // Tilt disc to match the mountain slope
    decal.mesh.rotation.set(Math.PI * 0.5 - Math.atan(dhdz), 0, Math.atan(dhdx))
    const stretch = 1.0 + Math.random() * 0.55
    decal.mesh.scaling.set(radius, radius * stretch, 1.0)
    decal.mesh.setEnabled(true)
  }

  public update(
    dt: number,
    sampleTerrainHeight: (x: number, z: number) => number,
    onBounce?: (impactSpeed: number) => void,
  ): void {
    if (!this.isActive) return
    const stepDt = Math.min(dt, 0.04)
    this.crashElapsedSec += stepDt
    this.sprayTimer += stepDt

    const gravity = -24.5

    // Arterial blood fountain spurts from tumbling torso during first 2.8 seconds
    if (this.crashElapsedSec < 2.8 && this.sprayTimer > 0.055) {
      this.sprayTimer = 0
      this.spawnBloodBurst(this.torsoPart.pos, 5, 6.8)
    }

    // 1. Step Multi-Body Ragdoll Parts
    for (let i = 0; i < this.parts.length; i++) {
      const part = this.parts[i]
      if (i > 0 && part.attachedToTorso) {
        // Follow torso until a hard bounce rips it loose
        part.pos.set(
          this.torsoPart.pos.x + part.localOffset.x,
          this.torsoPart.pos.y + part.localOffset.y,
          this.torsoPart.pos.z + part.localOffset.z,
        )
        part.rot.set(
          this.torsoPart.rot.x + i * 0.4,
          this.torsoPart.rot.y - i * 0.3,
          this.torsoPart.rot.z + Math.sin(this.crashElapsedSec * 18 + i) * 0.9,
        )
        part.node.position.copyFrom(part.pos)
        part.node.rotation.copyFrom(part.rot)
        continue
      }

      part.vel.y += gravity * stepDt
      // Air drag
      part.vel.scaleInPlace(Math.max(0.85, 1.0 - 0.18 * stepDt))
      part.pos.addInPlace(part.vel.scale(stepDt))
      part.rot.addInPlace(part.angVel.scale(stepDt))

      const groundY = sampleTerrainHeight(part.pos.x, part.pos.z)
      if (part.pos.y <= groundY + part.radius) {
        part.pos.y = groundY + part.radius

        // Compute terrain slope gradient so ragdoll tumbles downhill!
        const eps = 1.2
        const dhdx = (sampleTerrainHeight(part.pos.x + eps, part.pos.z) - sampleTerrainHeight(part.pos.x - eps, part.pos.z)) / (2 * eps)
        const dhdz = (sampleTerrainHeight(part.pos.x, part.pos.z + eps) - sampleTerrainHeight(part.pos.x, part.pos.z - eps)) / (2 * eps)

        const impactSpd = Math.hypot(part.vel.x, part.vel.y, part.vel.z)
        if (part.vel.y < -2.4) {
          part.bounceCount++
          const restitution = i === 0 ? 0.48 : 0.54
          part.vel.y = Math.min(9.5, -part.vel.y * restitution + 1.2)
          // Kick downhill along slope gradient
          part.vel.x = part.vel.x * 0.78 - dhdx * 5.2 + (Math.random() - 0.5) * 2.5
          part.vel.z = part.vel.z * 0.78 - dhdz * 5.2 + (Math.random() - 0.5) * 2.5

          part.angVel.set(
            part.vel.z * 1.4 + (Math.random() - 0.5) * 12.0,
            (Math.random() - 0.5) * 10.0,
            -part.vel.x * 1.4 + (Math.random() - 0.5) * 12.0,
          )

          // Paint snow crimson at every bounce!
          if (part.bounceCount <= 7) {
            const splatRadius = i === 0 ? (0.85 + Math.random() * 0.85) : (0.48 + Math.random() * 0.45)
            this.spawnSnowSplatter(part.pos.x, part.pos.z, splatRadius, sampleTerrainHeight)
            this.spawnBloodBurst(part.pos, i === 0 ? 14 : 6, 7.5)
          }

          // Rip remaining attached limbs loose on torso bounce!
          if (i === 0) {
            if (onBounce && part.bounceCount <= 5) {
              onBounce(impactSpd)
            }
            for (let k = 1; k < this.parts.length; k++) {
              if (this.parts[k].attachedToTorso && Math.random() < 0.65) {
                this.parts[k].attachedToTorso = false
                this.parts[k].vel.copyFrom(part.vel)
                this.parts[k].vel.x += (Math.random() - 0.5) * 9.0
                this.parts[k].vel.y += 3.0 + Math.random() * 4.5
                this.parts[k].vel.z += (Math.random() - 0.5) * 9.0
              }
            }
          }
        } else {
          // Sliding & rolling down steep snow slope
          part.vel.y = 0
          part.vel.x = (part.vel.x - dhdx * 9.5 * stepDt) * Math.max(0, 1.0 - 2.2 * stepDt)
          part.vel.z = (part.vel.z - dhdz * 9.5 * stepDt) * Math.max(0, 1.0 - 2.2 * stepDt)
          part.angVel.scaleInPlace(Math.max(0, 1.0 - 3.5 * stepDt))
        }
      }

      part.node.position.copyFrom(part.pos)
      part.node.rotation.copyFrom(part.rot)
    }

    // 2. Step Crumpled Canopy
    this.canopyVel.y += -11.0 * stepDt
    this.canopyVel.scaleInPlace(Math.max(0.8, 1.0 - 1.4 * stepDt))
    this.canopyPos.addInPlace(this.canopyVel.scale(stepDt))
    const canGround = sampleTerrainHeight(this.canopyPos.x, this.canopyPos.z)
    if (this.canopyPos.y <= canGround + 0.25) {
      this.canopyPos.y = canGround + 0.25
      this.canopyVel.setAll(0)
    }
    this.crumpledCanopy.position.copyFrom(this.canopyPos)

    // 3. Step 3D Blood Droplets
    for (let i = 0; i < this.bloodParticles.length; i++) {
      const p = this.bloodParticles[i]
      if (!p.active) continue
      p.life += stepDt
      if (p.life >= p.maxLife) {
        p.active = false
        p.mesh.setEnabled(false)
        continue
      }
      p.vel.y += gravity * 0.85 * stepDt
      p.pos.addInPlace(p.vel.scale(stepDt))
      const gY = sampleTerrainHeight(p.pos.x, p.pos.z)
      if (p.pos.y <= gY + 0.05) {
        p.active = false
        p.mesh.setEnabled(false)
        if (Math.random() < 0.28) {
          this.spawnSnowSplatter(p.pos.x, p.pos.z, 0.35 + Math.random() * 0.45, sampleTerrainHeight)
        }
        continue
      }
      p.mesh.position.copyFrom(p.pos)
    }
  }

  public getTorsoPosition(): Vector3 {
    return this.torsoPart.pos
  }

  public reset(): void {
    this.isActive = false
    this.crashElapsedSec = 0
    this.root.setEnabled(false)
    for (const p of this.bloodParticles) {
      p.active = false
      p.mesh.setEnabled(false)
    }
    for (const d of this.bloodDecals) {
      d.active = false
      d.mesh.setEnabled(false)
    }
  }
}
