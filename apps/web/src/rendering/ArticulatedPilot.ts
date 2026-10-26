import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3, Quaternion, Matrix } from '@babylonjs/core/Maths/math.vector'
import { Material } from '@babylonjs/core/Materials/material'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer'
import type { Scene } from '@babylonjs/core/scene'

const SIDES = 12
const UPPER_LEN = 0.29
const FORE_LEN = 0.26

type Station = { y: number; rx: number; rz: number; z?: number }

// Elliptical limb. Local +Y runs from the first station to the last.
// After the index fix, a side vertex normal points away from the Y axis.
function createTube(name: string, scene: Scene, stations: Station[], material: Material): Mesh {
  const positions: number[] = []
  const indices: number[] = []
  for (const station of stations) {
    for (let s = 0; s < SIDES; s++) {
      const a = (s / SIDES) * Math.PI * 2
      positions.push(Math.cos(a) * station.rx, station.y, Math.sin(a) * station.rz + (station.z ?? 0))
    }
  }
  const rings = stations.length
  for (let i = 0; i < rings - 1; i++) {
    for (let s = 0; s < SIDES; s++) {
      const s2 = (s + 1) % SIDES
      const a = i * SIDES + s
      const b = i * SIDES + s2
      const c = (i + 1) * SIDES + s
      const d = (i + 1) * SIDES + s2
      indices.push(a, b, d, a, d, c)
    }
  }
  const cap = (ring: number, y: number, z: number, outward: number) => {
    const center = positions.length / 3
    positions.push(0, y, z)
    for (let s = 0; s < SIDES; s++) {
      const s2 = (s + 1) % SIDES
      const a = ring * SIDES + s
      const b = ring * SIDES + s2
      if (outward > 0) indices.push(center, b, a)
      else indices.push(center, a, b)
    }
  }
  cap(0, stations[0].y, stations[0].z ?? 0, -1)
  cap(rings - 1, stations[rings - 1].y, stations[rings - 1].z ?? 0, 1)

  const normals = new Array<number>(positions.length).fill(0)
  VertexData.ComputeNormals(positions, indices, normals)
  // Vertex 0 sits on local +X. Its normal must point that way too.
  if (normals[0] * positions[0] + normals[2] * positions[2] < 0) {
    for (let i = 0; i < indices.length; i += 3) {
      const swap = indices[i]
      indices[i] = indices[i + 1]
      indices[i + 1] = swap
    }
    VertexData.ComputeNormals(positions, indices, normals)
  }

  const mesh = new Mesh(name, scene)
  const data = new VertexData()
  data.positions = positions
  data.indices = indices
  data.normals = normals
  data.applyToMesh(mesh)
  mesh.material = material
  mesh.isPickable = false
  mesh.rotationQuaternion = new Quaternion()
  return mesh
}

function solid(name: string, scene: Scene, color: Color3, emissive: number): StandardMaterial {
  const mat = new StandardMaterial(name, scene)
  mat.diffuseColor = color
  mat.emissiveColor = color.scale(emissive)
  mat.specularColor = new Color3(0.08, 0.07, 0.06)
  return mat
}

/**
 * Jointed pilot. Arms are placed on the same shoulder → elbow → hand
 * targets the brake IK already solves. Legs hang off the existing hip and
 * knee nodes, so the harness, flare, and wingsuit poses move them.
 *
 * Limb local +Y points along the bone. Local +Z stays as close as possible
 * to the pivot's forward (+Z), which keeps the arm from rolling as it bends.
 */
export class ArticulatedPilot {
  private readonly bodyGear: TransformNode
  private readonly seat: Mesh
  private readonly upperL: Mesh
  private readonly upperR: Mesh
  private readonly foreL: Mesh
  private readonly foreR: Mesh
  private readonly elbowL: Mesh
  private readonly elbowR: Mesh
  private readonly cuffL: Mesh
  private readonly cuffR: Mesh
  private readonly gloveL: Mesh
  private readonly gloveR: Mesh
  private readonly wingL: Mesh
  private readonly wingR: Mesh
  private readonly wingPosL = new Float32Array(9)
  private readonly wingPosR = new Float32Array(9)
  private readonly leftHip: TransformNode
  private readonly rightHip: TransformNode

  private readonly yAxis = new Vector3()
  private readonly zAxis = new Vector3()
  private readonly xAxis = new Vector3()
  private readonly tmp = new Vector3()
  private readonly mid = new Vector3()
  private readonly basis = new Matrix()
  private readonly front = new Vector3(0, 0, 1)
  private readonly up = new Vector3(0, 1, 0)
  private readonly sideFallback = new Vector3(1, 0, 0)

  constructor(
    scene: Scene,
    pivot: TransformNode,
    head: TransformNode,
    leftLeg: TransformNode,
    rightLeg: TransformNode,
    leftKnee: TransformNode,
    rightKnee: TransformNode,
    shoulderL: Vector3,
    shoulderR: Vector3,
    suit: Material,
    helmet: Material,
    visor: Material,
    boot: Material,
    sole: Material,
    glove: Material,
    brass: Material,
  ) {
    const pants = solid('airman-pants', scene, new Color3(0.9, 0.88, 0.82), 0.22)
    const leather = solid('airman-leather', scene, new Color3(0.42, 0.24, 0.13), 0.16)
    const teal = solid('airman-teal', scene, new Color3(0.55, 0.78, 0.74), 0.28)
    const wingMat = solid('airman-wing', scene, new Color3(0.9, 0.42, 0.16), 0.45)
    wingMat.alpha = 0.78
    wingMat.backFaceCulling = false
    wingMat.transparencyMode = Material.MATERIAL_ALPHABLEND

    this.bodyGear = new TransformNode('airman-body', scene)
    this.bodyGear.parent = pivot

    // The rear of the hip station is the butt. A separate ball read as a lump.
    const torso = createTube('airman-torso', scene, [
      { y: -0.02, rx: 0.115, rz: 0.08, z: -0.015 },
      { y: 0.045, rx: 0.14, rz: 0.1, z: -0.04 },
      { y: 0.13, rx: 0.12, rz: 0.088, z: -0.01 },
      { y: 0.26, rx: 0.15, rz: 0.105 },
      { y: 0.4, rx: 0.185, rz: 0.11 },
      { y: 0.54, rx: 0.055, rz: 0.05 },
    ], suit)
    torso.position.z = 0.01
    torso.parent = this.bodyGear

    this.seat = MeshBuilder.CreateBox('airman-seat', { width: 0.26, height: 0.035, depth: 0.16 }, scene)
    this.seat.position.set(0, -0.04, -0.02)
    this.seat.material = leather
    this.seat.isPickable = false
    this.seat.parent = this.bodyGear

    for (const side of [-1, 1]) {
      const strap = MeshBuilder.CreateBox(`airman-strap-${side}`, { width: 0.028, height: 0.34, depth: 0.02 }, scene)
      strap.position.set(side * 0.07, 0.3, 0.13)
      strap.rotation.z = side * -0.12
      strap.material = leather
      strap.isPickable = false
      strap.parent = this.bodyGear
    }
    const belt = MeshBuilder.CreateBox('airman-belt', { width: 0.3, height: 0.035, depth: 0.02 }, scene)
    belt.position.set(0, 0.16, 0.125)
    belt.material = leather
    belt.isPickable = false
    belt.parent = this.bodyGear
    const buckle = MeshBuilder.CreateBox('airman-buckle', { width: 0.055, height: 0.04, depth: 0.02 }, scene)
    buckle.position.set(0, 0.2, 0.14)
    buckle.material = brass
    buckle.isPickable = false
    buckle.parent = this.bodyGear

    const bag = MeshBuilder.CreateBox('airman-satchel', { width: 0.11, height: 0.14, depth: 0.06 }, scene)
    bag.position.set(0.16, 0.08, 0.02)
    bag.material = leather
    bag.isPickable = false
    bag.parent = this.bodyGear
    const pouch = MeshBuilder.CreateBox('airman-pouch', { width: 0.08, height: 0.1, depth: 0.05 }, scene)
    pouch.position.set(-0.15, 0.06, 0.04)
    pouch.material = leather
    pouch.isPickable = false
    pouch.parent = this.bodyGear

    const cap = (name: string, at: Vector3) => {
      const mesh = MeshBuilder.CreateSphere(name, { diameter: 0.13, segments: 10 }, scene)
      mesh.position.copyFrom(at)
      mesh.material = suit
      mesh.isPickable = false
      mesh.parent = pivot
      return mesh
    }
    cap('airman-shoulder-l', shoulderL)
    cap('airman-shoulder-r', shoulderR)

    this.upperL = createTube('airman-upper-l', scene, upperStations(), suit)
    this.upperR = createTube('airman-upper-r', scene, upperStations(), suit)
    this.foreL = createTube('airman-fore-l', scene, foreStations(), suit)
    this.foreR = createTube('airman-fore-r', scene, foreStations(), suit)
    for (const limb of [this.upperL, this.upperR, this.foreL, this.foreR]) limb.parent = pivot

    const joint = (name: string) => {
      const mesh = MeshBuilder.CreateSphere(name, { diameter: 0.086, segments: 8 }, scene)
      mesh.material = suit
      mesh.isPickable = false
      mesh.parent = pivot
      return mesh
    }
    this.elbowL = joint('airman-elbow-l')
    this.elbowR = joint('airman-elbow-r')

    const cuff = (name: string) => {
      const mesh = MeshBuilder.CreateCylinder(name, { height: 0.045, diameter: 0.074, tessellation: 10 }, scene)
      mesh.material = pants
      mesh.isPickable = false
      mesh.rotationQuaternion = new Quaternion()
      mesh.parent = pivot
      return mesh
    }
    this.cuffL = cuff('airman-cuff-l')
    this.cuffR = cuff('airman-cuff-r')

    const hand = (name: string) => {
      const mesh = MeshBuilder.CreateBox(name, { width: 0.07, height: 0.09, depth: 0.055 }, scene)
      mesh.material = glove
      mesh.isPickable = false
      mesh.rotationQuaternion = new Quaternion()
      mesh.parent = pivot
      return mesh
    }
    this.gloveL = hand('airman-glove-l')
    this.gloveR = hand('airman-glove-r')

    const hem = (name: string, leg: TransformNode) => {
      const mesh = createTube(name, scene, [
        { y: 0.0, rx: 0.066, rz: 0.06 },
        { y: -0.045, rx: 0.062, rz: 0.056 },
      ], suit)
      mesh.parent = leg
      return mesh
    }
    hem('airman-hem-l', leftLeg)
    hem('airman-hem-r', rightLeg)

    const thigh = (name: string, leg: TransformNode) => {
      const mesh = createTube(name, scene, [
        { y: 0.0, rx: 0.072, rz: 0.07 },
        { y: -0.12, rx: 0.088, rz: 0.08 },
        { y: -0.28, rx: 0.08, rz: 0.074 },
        { y: -0.44, rx: 0.062, rz: 0.058 },
      ], pants)
      mesh.parent = leg
      return mesh
    }
    thigh('airman-thigh-l', leftLeg)
    thigh('airman-thigh-r', rightLeg)

    const shin = (name: string, knee: TransformNode) => {
      const mesh = createTube(name, scene, [
        { y: 0.0, rx: 0.058, rz: 0.055 },
        { y: -0.18, rx: 0.05, rz: 0.048 },
        { y: -0.42, rx: 0.042, rz: 0.04 },
      ], pants)
      mesh.parent = knee
      return mesh
    }
    shin('airman-shin-l', leftKnee)
    shin('airman-shin-r', rightKnee)

    for (const knee of [leftKnee, rightKnee]) {
      const pad = MeshBuilder.CreateSphere(`airman-kneepad-${knee.name}`, { diameter: 0.09, segments: 8 }, scene)
      pad.scaling.set(1.15, 0.7, 0.55)
      pad.position.set(0, -0.02, 0.06)
      pad.material = leather
      pad.isPickable = false
      pad.parent = knee
    }

    this.attachBoot('l', leftKnee, boot, sole, scene)
    this.attachBoot('r', rightKnee, boot, sole, scene)

    const shell = MeshBuilder.CreateSphere('airman-helmet', { diameter: 0.26, segments: 14 }, scene)
    shell.scaling.set(1.02, 1.08, 1.0)
    shell.position.set(0, 0.12, 0.0)
    shell.material = helmet
    shell.isPickable = false
    shell.parent = head

    const crown = MeshBuilder.CreateSphere('airman-crown', { diameter: 0.16, segments: 10 }, scene)
    crown.scaling.set(1.05, 0.5, 0.9)
    crown.position.set(0, 0.22, 0.02)
    crown.material = teal
    crown.isPickable = false
    crown.parent = head

    const chin = MeshBuilder.CreateSphere('airman-chin', { diameter: 0.12, segments: 8 }, scene)
    chin.scaling.set(0.85, 0.5, 0.6)
    chin.position.set(0, 0.02, 0.07)
    chin.material = helmet
    chin.isPickable = false
    chin.parent = head

    for (const side of [-1, 1]) {
      const lens = MeshBuilder.CreateSphere(`airman-lens-${side}`, { diameter: 0.074, segments: 10 }, scene)
      lens.scaling.set(1, 1, 0.45)
      lens.position.set(side * 0.04, 0.11, 0.108)
      lens.material = visor
      lens.isPickable = false
      lens.parent = head
      const rim = MeshBuilder.CreateTorus(`airman-rim-${side}`, { diameter: 0.088, thickness: 0.012, tessellation: 14 }, scene)
      rim.position.set(side * 0.04, 0.11, 0.1)
      rim.material = brass
      rim.isPickable = false
      rim.parent = head
    }
    const bridge = MeshBuilder.CreateBox('airman-bridge', { width: 0.03, height: 0.012, depth: 0.012 }, scene)
    bridge.position.set(0, 0.11, 0.112)
    bridge.material = brass
    bridge.isPickable = false
    bridge.parent = head

    this.wingL = this.makeWing('airman-wing-l', scene, wingMat, pivot)
    this.wingR = this.makeWing('airman-wing-r', scene, wingMat, pivot)
    this.leftHip = leftLeg
    this.rightHip = rightLeg
  }

  pose(
    shoulderL: Vector3, elbowL: Vector3, handL: Vector3,
    shoulderR: Vector3, elbowR: Vector3, handR: Vector3,
    wingsuit: boolean,
    fpv: boolean,
  ): void {
    this.bodyGear.setEnabled(!fpv)
    this.seat.setEnabled(!fpv && !wingsuit)
    this.wingL.setEnabled(wingsuit && !fpv)
    this.wingR.setEnabled(wingsuit && !fpv)

    this.placeLimb(this.upperL, shoulderL, elbowL, UPPER_LEN)
    this.placeLimb(this.upperR, shoulderR, elbowR, UPPER_LEN)
    this.placeLimb(this.foreL, elbowL, handL, FORE_LEN)
    this.placeLimb(this.foreR, elbowR, handR, FORE_LEN)
    this.elbowL.position.copyFrom(elbowL)
    this.elbowR.position.copyFrom(elbowR)
    this.placeCuff(this.cuffL, this.gloveL, elbowL, handL)
    this.placeCuff(this.cuffR, this.gloveR, elbowR, handR)

    if (wingsuit && !fpv) {
      this.writeWing(this.wingL, this.wingPosL, shoulderL, handL, this.leftHip.position)
      this.writeWing(this.wingR, this.wingPosR, shoulderR, handR, this.rightHip.position)
    }
  }

  // from → to is the bone. The mesh is authored centered on Y with this length.
  private placeLimb(mesh: Mesh, from: Vector3, to: Vector3, authored: number): void {
    to.subtractToRef(from, this.yAxis)
    const len = this.yAxis.length()
    if (len < 1e-4) return
    this.yAxis.scaleInPlace(1 / len)
    this.mid.copyFrom(from)
    this.mid.addInPlace(to)
    this.mid.scaleInPlace(0.5)
    mesh.position.copyFrom(this.mid)
    mesh.scaling.y = len / authored
    this.aimInto(this.yAxis, mesh.rotationQuaternion!)
  }

  private placeCuff(cuff: Mesh, glove: Mesh, elbow: Vector3, hand: Vector3): void {
    hand.subtractToRef(elbow, this.yAxis)
    const len = this.yAxis.length()
    if (len < 1e-4) return
    this.yAxis.scaleInPlace(1 / len)
    this.aimInto(this.yAxis, cuff.rotationQuaternion!)
    glove.rotationQuaternion!.copyFrom(cuff.rotationQuaternion!)
    this.tmp.copyFrom(this.yAxis).scaleInPlace(0.04)
    cuff.position.copyFrom(hand).subtractInPlace(this.tmp)
    glove.position.copyFrom(hand)
  }

  // `dir` is unit length along the bone and is not retained.
  private aimInto(dir: Vector3, out: Quaternion): void {
    this.yAxis.copyFrom(dir)
    const along = Vector3.Dot(this.front, this.yAxis)
    this.yAxis.scaleToRef(along, this.tmp)
    this.zAxis.copyFrom(this.front).subtractInPlace(this.tmp)
    if (this.zAxis.lengthSquared() < 1e-6) {
      const upAlong = Vector3.Dot(this.up, this.yAxis)
      this.yAxis.scaleToRef(upAlong, this.tmp)
      this.zAxis.copyFrom(this.up).subtractInPlace(this.tmp)
      if (this.zAxis.lengthSquared() < 1e-6) this.zAxis.copyFrom(this.sideFallback)
    }
    this.zAxis.normalize()
    Vector3.CrossToRef(this.yAxis, this.zAxis, this.xAxis)
    this.xAxis.normalize()
    Matrix.FromXYZAxesToRef(this.xAxis, this.yAxis, this.zAxis, this.basis)
    Quaternion.FromRotationMatrixToRef(this.basis, out)
  }

  private attachBoot(side: string, knee: TransformNode, boot: Material, sole: Material, scene: Scene): void {
    const ankle = new TransformNode(`airman-ankle-${side}`, scene)
    ankle.position.set(0, -0.42, 0)
    ankle.parent = knee
    const shaft = MeshBuilder.CreateCylinder(`airman-shaft-${side}`, { height: 0.12, diameter: 0.1, tessellation: 10 }, scene)
    shaft.position.set(0, 0.02, 0.02)
    shaft.material = boot
    shaft.isPickable = false
    shaft.parent = ankle
    const foot = MeshBuilder.CreateBox(`airman-foot-${side}`, { width: 0.11, height: 0.07, depth: 0.22 }, scene)
    foot.position.set(0, -0.045, 0.07)
    foot.material = boot
    foot.isPickable = false
    foot.parent = ankle
    const heel = MeshBuilder.CreateBox(`airman-heel-${side}`, { width: 0.09, height: 0.045, depth: 0.08 }, scene)
    heel.position.set(0, -0.04, -0.02)
    heel.material = boot
    heel.isPickable = false
    heel.parent = ankle
    const outsole = MeshBuilder.CreateBox(`airman-sole-${side}`, { width: 0.12, height: 0.028, depth: 0.26 }, scene)
    outsole.position.set(0, -0.085, 0.05)
    outsole.material = sole
    outsole.isPickable = false
    outsole.parent = ankle
  }

  private makeWing(name: string, scene: Scene, material: Material, pivot: TransformNode): Mesh {
    const mesh = new Mesh(name, scene)
    const data = new VertexData()
    data.positions = [0, 0, 0, 0, 0, 0, 0, 0, 0]
    data.indices = [0, 1, 2]
    data.normals = [0, 0, -1, 0, 0, -1, 0, 0, -1]
    data.applyToMesh(mesh, true)
    mesh.material = material
    mesh.isPickable = false
    mesh.parent = pivot
    mesh.setEnabled(false)
    return mesh
  }

  private writeWing(mesh: Mesh, pos: Float32Array, shoulder: Vector3, hand: Vector3, hip: Vector3): void {
    pos[0] = shoulder.x
    pos[1] = shoulder.y
    pos[2] = shoulder.z - 0.03
    pos[3] = hand.x
    pos[4] = hand.y
    pos[5] = hand.z - 0.03
    pos[6] = hip.x
    pos[7] = hip.y - 0.05
    pos[8] = hip.z - 0.03
    mesh.updateVerticesData(VertexBuffer.PositionKind, pos)
  }
}

function upperStations(): Station[] {
  const h = UPPER_LEN * 0.5
  return [
    { y: -h, rx: 0.066, rz: 0.058 },
    { y: -h * 0.3, rx: 0.06, rz: 0.052 },
    { y: h * 0.35, rx: 0.05, rz: 0.044 },
    { y: h, rx: 0.044, rz: 0.04 },
  ]
}

function foreStations(): Station[] {
  const h = FORE_LEN * 0.5
  return [
    { y: -h, rx: 0.046, rz: 0.042 },
    { y: 0, rx: 0.038, rz: 0.034 },
    { y: h * 0.65, rx: 0.032, rz: 0.03 },
    { y: h, rx: 0.03, rz: 0.028 },
  ]
}
