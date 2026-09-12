import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { LinesMesh } from '@babylonjs/core/Meshes/linesMesh'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Scene } from '@babylonjs/core/scene'
import type { ParagliderSimulation } from '../physics/pendulum'

export class ParagliderRig {
  private scene: Scene
  private canopyRoot: TransformNode
  private pilotRoot: TransformNode
  private pilotBodyPivot: TransformNode

  // Glider 3D Mesh
  private canopyMesh!: Mesh
  private underMesh!: Mesh
  public currentWingType: 'speedwing' | 'paraglider' = 'speedwing'
  private canopyTopSpeedMat!: StandardMaterial
  private canopyTopXcMat!: StandardMaterial
  private canopyUnderMat!: StandardMaterial

  // Stylized Articulated Pilot
  private helmetMesh: Mesh
  private visorMesh: Mesh
  private neckMesh: Mesh
  private torsoMesh: Mesh
  private harnessMesh: Mesh
  private leftArmNode: TransformNode
  private rightArmNode: TransformNode
  private leftHandNode: TransformNode
  private rightHandNode: TransformNode
  private leftLegNode: TransformNode
  private rightLegNode: TransformNode
  private leftKneeNode: TransformNode
  private rightKneeNode: TransformNode

  // Line Networks
  private suspensionLinesMesh!: LinesMesh
  private brakeLinesMesh!: LinesMesh

  // Aerofoil Rib Paths
  private cellAttachmentPoints: Vector3[] = []
  private trailingEdgePoints: Vector3[] = []

  constructor(scene: Scene) {
    this.scene = scene

    this.canopyRoot = new TransformNode('canopy-root', scene)
    this.pilotRoot = new TransformNode('pilot-root', scene)
    this.pilotBodyPivot = new TransformNode('pilot-body-pivot', scene)
    this.pilotBodyPivot.parent = this.pilotRoot

    // 1. High-End Stylized Materials
    this.canopyTopSpeedMat = new StandardMaterial('canopy-top-speed-mat', scene)
    this.canopyTopSpeedMat.diffuseColor = new Color3(0.96, 0.18, 0.12) // Neon speedwing crimson
    this.canopyTopSpeedMat.specularColor = new Color3(0.25, 0.25, 0.25)
    this.canopyTopSpeedMat.backFaceCulling = false

    this.canopyTopXcMat = new StandardMaterial('canopy-top-xc-mat', scene)
    this.canopyTopXcMat.diffuseColor = new Color3(0.98, 0.74, 0.14) // Sunburst Himalayan gold
    this.canopyTopXcMat.specularColor = new Color3(0.35, 0.35, 0.35)
    this.canopyTopXcMat.backFaceCulling = false

    this.canopyUnderMat = new StandardMaterial('canopy-under-mat', scene)
    this.canopyUnderMat.diffuseColor = new Color3(0.12, 0.72, 0.88) // Electric cyan under-surface
    this.canopyUnderMat.specularColor = new Color3(0.1, 0.1, 0.1)

    // Pilot Suit & Gear Materials
    const pilotSuitMat = new StandardMaterial('pilot-suit-mat', scene)
    pilotSuitMat.diffuseColor = new Color3(0.15, 0.20, 0.28) // Deep charcoal navy flight suit
    pilotSuitMat.specularColor = new Color3(0.06, 0.06, 0.06)

    const helmetMat = new StandardMaterial('helmet-mat', scene)
    helmetMat.diffuseColor = new Color3(0.98, 0.98, 1.0) // Gloss white action helmet
    helmetMat.specularColor = new Color3(0.9, 0.9, 0.95)

    const visorMat = new StandardMaterial('visor-mat', scene)
    visorMat.diffuseColor = new Color3(0.04, 0.04, 0.06) // Mirrored iridium visor
    visorMat.specularColor = new Color3(0.95, 0.85, 0.35) // Gold sun glint

    const skinMat = new StandardMaterial('skin-mat', scene)
    skinMat.diffuseColor = new Color3(0.88, 0.68, 0.54) // Natural skin/neck

    const metalMat = new StandardMaterial('metal-mat', scene)
    metalMat.diffuseColor = new Color3(0.85, 0.88, 0.94) // Anodized aluminum carabiners
    metalMat.specularColor = new Color3(0.95, 0.95, 0.95)

    const bootMat = new StandardMaterial('boot-mat', scene)
    bootMat.diffuseColor = new Color3(0.18, 0.22, 0.32) // Sport trail shoes
    bootMat.specularColor = new Color3(0.1, 0.1, 0.1)

    const sockMat = new StandardMaterial('sock-mat', scene)
    sockMat.diffuseColor = new Color3(0.08, 0.72, 0.45) // Sporty electric green/teal socks

    const soleMat = new StandardMaterial('sole-mat', scene)
    soleMat.diffuseColor = new Color3(0.96, 0.96, 0.98) // White trail shoe EVA outsole
    soleMat.specularColor = new Color3(0.3, 0.3, 0.3)

    // Build initial Speedwing canopy & lines
    this.buildCanopyAndLines('speedwing')

    // 3. Build Organic Stylized Character Model (Sphere-Packed / Clean Proportions)
    // Head & Helmet
    this.helmetMesh = MeshBuilder.CreateSphere('pilot-helmet', { diameter: 0.38, segments: 14 }, scene)
    this.helmetMesh.position.set(0, 0.72, 0.04)
    this.helmetMesh.material = helmetMat
    this.helmetMesh.parent = this.pilotBodyPivot

    this.visorMesh = MeshBuilder.CreateSphere('pilot-visor', { diameter: 0.32, segments: 10 }, scene)
    this.visorMesh.scaling.set(1.04, 0.52, 0.88)
    this.visorMesh.position.set(0, 0.71, 0.16)
    this.visorMesh.material = visorMat
    this.visorMesh.parent = this.pilotBodyPivot

    // Neck / Buff
    this.neckMesh = MeshBuilder.CreateCylinder('pilot-neck', { height: 0.15, diameter: 0.22, tessellation: 10 }, scene)
    this.neckMesh.position.set(0, 0.54, 0.02)
    this.neckMesh.material = skinMat
    this.neckMesh.parent = this.pilotBodyPivot

    // Torso / Flight Jacket (Sculpted with rounded chest)
    this.torsoMesh = MeshBuilder.CreateSphere('pilot-chest', { diameter: 0.56, segments: 10 }, scene)
    this.torsoMesh.scaling.set(0.95, 1.25, 0.82)
    this.torsoMesh.position.set(0, 0.28, 0.02)
    this.torsoMesh.rotation.x = 0.25 // Natural seated recline
    this.torsoMesh.material = pilotSuitMat
    this.torsoMesh.parent = this.pilotBodyPivot

    // Seated Harness Pod
    this.harnessMesh = MeshBuilder.CreateSphere('pilot-harness-pod', { diameter: 0.65, segments: 10 }, scene)
    this.harnessMesh.scaling.set(0.88, 0.75, 1.15)
    this.harnessMesh.position.set(0, 0.08, -0.06)
    this.harnessMesh.rotation.x = 0.3
    this.harnessMesh.material = pilotSuitMat
    this.harnessMesh.parent = this.pilotBodyPivot

    // Carabiners at hips
    const leftCarabiner = MeshBuilder.CreateTorus('carabiner-l', { diameter: 0.11, thickness: 0.022, tessellation: 16 }, scene)
    leftCarabiner.position.set(-0.26, 0.34, 0.06)
    leftCarabiner.material = metalMat
    leftCarabiner.parent = this.pilotBodyPivot

    const rightCarabiner = MeshBuilder.CreateTorus('carabiner-r', { diameter: 0.11, thickness: 0.022, tessellation: 16 }, scene)
    rightCarabiner.position.set(0.26, 0.34, 0.06)
    rightCarabiner.material = metalMat
    rightCarabiner.parent = this.pilotBodyPivot

    // Arms & Hands (Mounted at shoulders, extending to risers at ear/shoulder level)
    this.leftArmNode = new TransformNode('arm-root-l', scene)
    this.leftArmNode.position.set(-0.32, 0.44, 0.04)
    this.leftArmNode.parent = this.pilotBodyPivot

    this.rightArmNode = new TransformNode('arm-root-r', scene)
    this.rightArmNode.position.set(0.32, 0.44, 0.04)
    this.rightArmNode.parent = this.pilotBodyPivot

    const lUpperArm = MeshBuilder.CreateCylinder('upper-arm-l', { height: 0.32, diameter: 0.11 }, scene)
    lUpperArm.position.set(-0.06, 0.04, 0.02)
    lUpperArm.rotation.z = 0.4
    lUpperArm.rotation.x = -0.3
    lUpperArm.material = pilotSuitMat
    lUpperArm.parent = this.leftArmNode

    const rUpperArm = MeshBuilder.CreateCylinder('upper-arm-r', { height: 0.32, diameter: 0.11 }, scene)
    rUpperArm.position.set(0.06, 0.04, 0.02)
    rUpperArm.rotation.z = -0.4
    rUpperArm.rotation.x = -0.3
    rUpperArm.material = pilotSuitMat
    rUpperArm.parent = this.rightArmNode

    this.leftHandNode = new TransformNode('hand-node-l', scene)
    this.leftHandNode.position.set(-0.14, 0.16, 0.05)
    this.leftHandNode.parent = this.leftArmNode

    this.rightHandNode = new TransformNode('hand-node-r', scene)
    this.rightHandNode.position.set(0.14, 0.16, 0.05)
    this.rightHandNode.parent = this.rightArmNode

    const lGlove = MeshBuilder.CreateSphere('glove-l', { diameter: 0.11 }, scene)
    lGlove.material = pilotSuitMat
    lGlove.parent = this.leftHandNode

    const rGlove = MeshBuilder.CreateSphere('glove-r', { diameter: 0.11 }, scene)
    rGlove.material = pilotSuitMat
    rGlove.parent = this.rightHandNode

    // Articulated Legs & Boots (Prominent for Pilot FPV and Foot Drags!)
    this.leftLegNode = new TransformNode('leg-root-l', scene)
    this.leftLegNode.position.set(-0.14, 0.08, 0.10)
    this.leftLegNode.parent = this.pilotBodyPivot

    this.rightLegNode = new TransformNode('leg-root-r', scene)
    this.rightLegNode.position.set(0.14, 0.08, 0.10)
    this.rightLegNode.parent = this.pilotBodyPivot

    // Thighs
    const lThigh = MeshBuilder.CreateCylinder('thigh-l', { height: 0.48, diameter: 0.17, tessellation: 8 }, scene)
    lThigh.position.set(0, -0.16, 0.20)
    lThigh.rotation.x = -0.85 // Reclined forward
    lThigh.material = pilotSuitMat
    lThigh.parent = this.leftLegNode

    const rThigh = MeshBuilder.CreateCylinder('thigh-r', { height: 0.48, diameter: 0.17, tessellation: 8 }, scene)
    rThigh.position.set(0, -0.16, 0.20)
    rThigh.rotation.x = -0.85
    rThigh.material = pilotSuitMat
    rThigh.parent = this.rightLegNode

    // Knees & Shins
    this.leftKneeNode = new TransformNode('knee-l', scene)
    this.leftKneeNode.position.set(0, -0.32, 0.40)
    this.leftKneeNode.parent = this.leftLegNode

    this.rightKneeNode = new TransformNode('knee-r', scene)
    this.rightKneeNode.position.set(0, -0.32, 0.40)
    this.rightKneeNode.parent = this.rightLegNode

    const lShin = MeshBuilder.CreateCylinder('shin-l', { height: 0.48, diameter: 0.15, tessellation: 8 }, scene)
    lShin.position.set(0, -0.22, 0.12)
    lShin.rotation.x = 0.42 // Legs extend naturally forward
    lShin.material = pilotSuitMat
    lShin.parent = this.leftKneeNode

    const rShin = MeshBuilder.CreateCylinder('shin-r', { height: 0.48, diameter: 0.15, tessellation: 8 }, scene)
    rShin.position.set(0, -0.22, 0.12)
    rShin.rotation.x = 0.42
    rShin.material = pilotSuitMat
    rShin.parent = this.rightKneeNode

    // Ankle Sport Socks (Visible in FPV foot skimming)
    const lSock = MeshBuilder.CreateCylinder('sock-l', { height: 0.12, diameter: 0.165, tessellation: 8 }, scene)
    lSock.position.set(0, -0.38, 0.12)
    lSock.material = sockMat
    lSock.parent = this.leftKneeNode

    const rSock = MeshBuilder.CreateCylinder('sock-r', { height: 0.12, diameter: 0.165, tessellation: 8 }, scene)
    rSock.position.set(0, -0.38, 0.12)
    rSock.material = sockMat
    rSock.parent = this.rightKneeNode

    // Detailed Runner Shoes with Athletic Soles
    const lBoot = MeshBuilder.CreateBox('boot-l', { width: 0.16, height: 0.14, depth: 0.36 }, scene)
    lBoot.position.set(0, -0.46, 0.22)
    lBoot.material = bootMat
    lBoot.parent = this.leftKneeNode

    const lSole = MeshBuilder.CreateBox('sole-l', { width: 0.17, height: 0.05, depth: 0.38 }, scene)
    lSole.position.set(0, -0.53, 0.22)
    lSole.material = soleMat
    lSole.parent = this.leftKneeNode

    const rBoot = MeshBuilder.CreateBox('boot-r', { width: 0.16, height: 0.14, depth: 0.36 }, scene)
    rBoot.position.set(0, -0.46, 0.22)
    rBoot.material = bootMat
    rBoot.parent = this.rightKneeNode

    const rSole = MeshBuilder.CreateBox('sole-r', { width: 0.17, height: 0.05, depth: 0.38 }, scene)
    rSole.position.set(0, -0.53, 0.22)
    rSole.material = soleMat
    rSole.parent = this.rightKneeNode

  }

  public buildCanopyAndLines(wingType: 'speedwing' | 'paraglider') {
    this.currentWingType = wingType
    if (this.canopyMesh) this.canopyMesh.dispose()
    if (this.underMesh) this.underMesh.dispose()
    if (this.suspensionLinesMesh) this.suspensionLinesMesh.dispose()
    if (this.brakeLinesMesh) this.brakeLinesMesh.dispose()

    this.cellAttachmentPoints = []
    this.trailingEdgePoints = []

    const isXc = wingType === 'paraglider'
    const numCells = isXc ? 44 : 32
    const halfSpan = isXc ? 5.9 : 4.4 // 11.8m XC vs 8.8m Speedwing
    const chord = isXc ? 2.45 : 2.35
    const lineDrop = isXc ? -6.8 : -5.0

    const upperRibbon: Vector3[] = []
    const lowerRibbon: Vector3[] = []

    for (let c = 0; c <= numCells; c++) {
      const u = c / numCells
      const x = -halfSpan + u * halfSpan * 2
      const normX = Math.abs(x) / halfSpan

      // Elliptical arch and aerodynamic wingtip sweep
      const archY = (1 - Math.pow(normX, 1.9)) * (isXc ? 1.75 : 1.58)
      const sweepZ = Math.pow(normX, 1.7) * (isXc ? 0.95 : 0.75)
      const taperChord = chord * (1 - normX * (isXc ? 0.35 : 0.42))
      const maxThick = taperChord * (isXc ? 0.17 : 0.16)

      // Leading edge (+Z) and Trailing edge (-Z)
      const leZ = sweepZ + taperChord * 0.48
      const teZ = sweepZ - taperChord * 0.52

      upperRibbon.push(new Vector3(x, archY + maxThick * 0.65, leZ))
      upperRibbon.push(new Vector3(x, archY, teZ))

      lowerRibbon.push(new Vector3(x, archY - maxThick * 0.35, leZ))
      lowerRibbon.push(new Vector3(x, archY - 0.02, teZ))

      if (c % 2 === 0) {
        this.cellAttachmentPoints.push(new Vector3(x, archY - maxThick * 0.32, (leZ + teZ) * 0.5))
      }
      this.trailingEdgePoints.push(new Vector3(x, archY, teZ))
    }

    this.canopyMesh = MeshBuilder.CreateRibbon(
      'rig-canopy-top',
      { pathArray: [upperRibbon.filter((_, idx) => idx % 2 === 0), upperRibbon.filter((_, idx) => idx % 2 === 1)], updatable: true },
      this.scene,
    )
    this.canopyMesh.material = isXc ? this.canopyTopXcMat : this.canopyTopSpeedMat
    this.canopyMesh.parent = this.canopyRoot

    this.underMesh = MeshBuilder.CreateRibbon(
      'rig-canopy-under',
      { pathArray: [lowerRibbon.filter((_, idx) => idx % 2 === 0), lowerRibbon.filter((_, idx) => idx % 2 === 1)], updatable: true },
      this.scene,
    )
    this.underMesh.material = this.canopyUnderMat
    this.underMesh.parent = this.canopyRoot

    const linesData: Vector3[][] = []
    const leftCarabinerPos = new Vector3(-0.26, lineDrop, 0.06)
    const rightCarabinerPos = new Vector3(0.26, lineDrop, 0.06)

    for (const pt of this.cellAttachmentPoints) {
      const target = pt.x < 0 ? leftCarabinerPos : rightCarabinerPos
      linesData.push([pt, target])
    }

    this.suspensionLinesMesh = MeshBuilder.CreateLineSystem(
      'rig-suspension-lines',
      { lines: linesData, updatable: true },
      this.scene,
    )
    this.suspensionLinesMesh.color = new Color3(0.88, 0.92, 0.98)
    this.suspensionLinesMesh.parent = this.canopyRoot

    const brakeLinesData: Vector3[][] = [
      [this.trailingEdgePoints[2], leftCarabinerPos],
      [this.trailingEdgePoints[numCells - 2], rightCarabinerPos],
    ]
    this.brakeLinesMesh = MeshBuilder.CreateLineSystem(
      'rig-brake-lines',
      { lines: brakeLinesData, updatable: true },
      this.scene,
    )
    this.brakeLinesMesh.color = new Color3(0.98, 0.42, 0.12)
    this.brakeLinesMesh.parent = this.canopyRoot
  }

  public update(sim: ParagliderSimulation, vantage: string = 'pilot-fpv'): void {
    if (sim.currentWingType !== this.currentWingType) {
      this.buildCanopyAndLines(sim.currentWingType)
    }

    // In pilot FPV, disable head and torso to eliminate camera clipping while keeping legs, boots, arms, and harness visible
    const isFpv = vantage === 'pilot-fpv'
    this.helmetMesh.setEnabled(!isFpv)
    this.visorMesh.setEnabled(!isFpv)
    this.neckMesh.setEnabled(!isFpv)
    this.torsoMesh.setEnabled(!isFpv)

    // 1. Position & Orientation
    this.canopyRoot.position.set(
      sim.canopy.position.x,
      sim.canopy.position.y,
      sim.canopy.position.z,
    )

    const yawRad = (sim.canopy.yawDeg * Math.PI) / 180
    const pitchRad = (sim.canopy.pitchDeg * Math.PI) / 180
    const rollRad = (sim.canopy.rollDeg * Math.PI) / 180

    this.canopyRoot.rotationQuaternion = Quaternion.RotationYawPitchRoll(
      yawRad,
      pitchRad,
      -rollRad,
    )

    this.pilotRoot.position.set(
      sim.pilot.position.x,
      sim.pilot.position.y,
      sim.pilot.position.z,
    )

    const pilotPitchRad = (sim.pilot.pendulumPitchDeg * Math.PI) / 180
    const pilotRollRad = (sim.pilot.pendulumRollDeg * Math.PI) / 180
    this.pilotRoot.rotationQuaternion = Quaternion.RotationYawPitchRoll(
      yawRad,
      pilotPitchRad,
      -pilotRollRad,
    )

    // 180° Reverse Stance Harness Swivel
    const reverseYawRad = (sim.pilot.reverseStanceYawDeg * Math.PI) / 180
    this.pilotBodyPivot.rotation.y = reverseYawRad

    // 2. Dynamic Arm & Brake Handle Movement
    const leftBrake = sim.controls.leftBrake
    const rightBrake = sim.controls.rightBrake

    this.leftArmNode.rotation.x = -leftBrake * 0.95
    this.rightArmNode.rotation.x = -rightBrake * 0.95

    // 3. Dynamic Leg Articulation (Reacts to G-Force, Dive, and Foot Dragging)
    const isDiving = sim.canopy.airspeedKmh > 80
    const isSkimming = sim.isFootDragging

    let targetHipAngle = 0.0
    let targetKneeAngle = 0.0

    if (isSkimming) {
      targetHipAngle = 0.45 // Extend legs forward & down into sand
      targetKneeAngle = -0.2
    } else if (isDiving) {
      targetHipAngle = -0.85 // Tucked back streamlined
      targetKneeAngle = 0.95
    }

    this.leftLegNode.rotation.x += (targetHipAngle - this.leftLegNode.rotation.x) * 0.18
    this.rightLegNode.rotation.x += (targetHipAngle - this.rightLegNode.rotation.x) * 0.18
    this.leftKneeNode.rotation.x += (targetKneeAngle - this.leftKneeNode.rotation.x) * 0.18
    this.rightKneeNode.rotation.x += (targetKneeAngle - this.rightKneeNode.rotation.x) * 0.18

    // 4. Update Dynamic Suspension Lines
    const pilotLocalPos = this.canopyRoot
      .getWorldMatrix()
      .clone()
      .invert()
    const leftCarabinerWorld = this.leftArmNode.getAbsolutePosition()
    const rightCarabinerWorld = this.rightArmNode.getAbsolutePosition()

    const leftCarabinerLocal = Vector3.TransformCoordinates(leftCarabinerWorld, pilotLocalPos)
    const rightCarabinerLocal = Vector3.TransformCoordinates(rightCarabinerWorld, pilotLocalPos)

    const updatedLines: Vector3[][] = []
    for (const pt of this.cellAttachmentPoints) {
      const target = pt.x < 0 ? leftCarabinerLocal : rightCarabinerLocal
      updatedLines.push([pt, target])
    }

    MeshBuilder.CreateLineSystem(
      'rig-suspension-lines',
      { lines: updatedLines, instance: this.suspensionLinesMesh },
      this.scene,
    )

    const leftHandWorld = this.leftHandNode.getAbsolutePosition()
    const rightHandWorld = this.rightHandNode.getAbsolutePosition()
    const leftHandLocal = Vector3.TransformCoordinates(leftHandWorld, pilotLocalPos)
    const rightHandLocal = Vector3.TransformCoordinates(rightHandWorld, pilotLocalPos)

    const numCells = 32
    const updatedBrakes: Vector3[][] = [
      [this.trailingEdgePoints[2], leftHandLocal],
      [this.trailingEdgePoints[numCells - 2], rightHandLocal],
    ]
    MeshBuilder.CreateLineSystem(
      'rig-brake-lines',
      { lines: updatedBrakes, instance: this.brakeLinesMesh },
      this.scene,
    )
  }
}
