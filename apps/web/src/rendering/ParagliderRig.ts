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

  private canopyMesh: Mesh
  private leftHandNode: TransformNode
  private rightHandNode: TransformNode
  private leftArmMesh: Mesh
  private rightArmMesh: Mesh
  private leftForearmMesh: Mesh
  private rightForearmMesh: Mesh

  // Carabiners and Riser Hardware (Firmly attached to harness)
  private leftCarabiner: Mesh
  private rightCarabiner: Mesh
  private leftRiserStrap: Mesh
  private rightRiserStrap: Mesh
  private leftPulleyRing: Mesh
  private rightPulleyRing: Mesh

  // Full Dynamic Suspension & Brake Line Cascades (36 lines total)
  private suspensionLinesMesh: LinesMesh
  private brakeLinesMesh: LinesMesh

  private frontRibbonPath: Vector3[] = []
  private midRibbonPath: Vector3[] = []
  private backRibbonPath: Vector3[] = []
  private originalBackRibbonPath: Vector3[] = []
  private originalFrontRibbonPath: Vector3[] = []

  constructor(scene: Scene) {
    this.scene = scene

    this.canopyRoot = new TransformNode('canopy-root', scene)
    this.pilotRoot = new TransformNode('pilot-root', scene)

    // 1. Build Materials (Vibrant Stylized Alpine Look)
    const canopyMat = new StandardMaterial('canopy-mat', scene)
    canopyMat.diffuseColor = new Color3(0.98, 0.35, 0.12) // Sunset orange
    canopyMat.specularColor = new Color3(0.12, 0.12, 0.12)
    canopyMat.backFaceCulling = false

    const pilotJacketMat = new StandardMaterial('jacket-mat', scene)
    pilotJacketMat.diffuseColor = new Color3(0.08, 0.45, 0.65) // Alpine teal jacket

    const harnessMat = new StandardMaterial('harness-mat', scene)
    harnessMat.diffuseColor = new Color3(0.12, 0.15, 0.18) // Dark charcoal harness

    const helmetMat = new StandardMaterial('helmet-mat', scene)
    helmetMat.diffuseColor = new Color3(0.98, 0.25, 0.15) // High-vis orange helmet

    const metalMat = new StandardMaterial('carabiner-metal-mat', scene)
    metalMat.diffuseColor = new Color3(0.82, 0.86, 0.92) // Silver alloy
    metalMat.specularColor = new Color3(0.9, 0.9, 0.95)

    const riserWebbingMat = new StandardMaterial('riser-webbing-mat', scene)
    riserWebbingMat.diffuseColor = new Color3(0.06, 0.08, 0.12) // Heavy-duty black riser webbing

    // 2. Build Curved Paraglider Canopy (24 span segments - 8.8m speedwing)
    const spanSteps = 24
    const halfSpan = 4.4 // 8.8m span
    for (let i = 0; i <= spanSteps; i++) {
      const t = i / spanSteps
      const x = -halfSpan + t * halfSpan * 2
      const normX = Math.abs(x) / halfSpan

      // Parabolic arch and aerodynamic sweep (wingtips sweep backward -Z)
      const archY = (1 - Math.pow(normX, 1.8)) * 1.55
      const sweepZ = Math.pow(normX, 1.6) * 0.65

      // Forward is +Z (leading edge with A-lines), rear is -Z (trailing edge with brakes)
      const leading = new Vector3(x, archY, 1.15 - sweepZ)
      const mid = new Vector3(x, archY + 0.22, 0.05 - sweepZ)
      const trailing = new Vector3(x, archY - 0.08, -1.15 - sweepZ)

      this.frontRibbonPath.push(leading)
      this.originalFrontRibbonPath.push(leading.clone())
      this.midRibbonPath.push(mid)
      this.backRibbonPath.push(trailing.clone())
      this.originalBackRibbonPath.push(trailing.clone())
    }

    this.canopyMesh = MeshBuilder.CreateRibbon(
      'canopy-ribbon',
      {
        pathArray: [this.frontRibbonPath, this.midRibbonPath, this.backRibbonPath],
        updatable: true,
        sideOrientation: Mesh.DOUBLESIDE,
      },
      scene,
    )
    this.canopyMesh.parent = this.canopyRoot
    this.canopyMesh.material = canopyMat

    // 3. Build Pilot Model (Torso, Helmet, Harness, Legs)
    const torso = MeshBuilder.CreateCylinder(
      'pilot-torso',
      { height: 0.85, diameterTop: 0.42, diameterBottom: 0.48, tessellation: 8 },
      scene,
    )
    torso.parent = this.pilotRoot
    torso.position.set(0, 0.45, 0.05)
    torso.rotation.x = Math.PI / 10
    torso.material = pilotJacketMat

    const helmet = MeshBuilder.CreateSphere(
      'pilot-helmet',
      { diameter: 0.38, segments: 10 },
      scene,
    )
    helmet.parent = this.pilotRoot
    helmet.position.set(0, 0.95, 0.12)
    helmet.material = helmetMat

    const harness = MeshBuilder.CreateCapsule(
      'pilot-harness',
      { height: 1.1, radius: 0.32 },
      scene,
    )
    harness.parent = this.pilotRoot
    harness.position.set(0, 0.05, 0)
    harness.rotation.x = Math.PI / 3.4
    harness.material = harnessMat

    // Legs stretched forward in pod harness
    for (const side of [-1, 1]) {
      const leg = MeshBuilder.CreateCapsule(
        `pilot-leg-${side}`,
        { height: 1.05, radius: 0.12 },
        scene,
      )
      leg.parent = this.pilotRoot
      leg.position.set(side * 0.16, -0.32, 0.45)
      leg.rotation.x = Math.PI / 2.5
      leg.material = harnessMat
    }

    // 4. Alloy Carabiners & Webbing Risers (Firmly attached to harness chest)
    this.leftCarabiner = MeshBuilder.CreateTorus(
      'carabiner-left',
      { diameter: 0.11, thickness: 0.03, tessellation: 16 },
      scene,
    )
    this.leftCarabiner.parent = this.pilotRoot
    this.leftCarabiner.position.set(-0.24, 0.58, 0.16)
    this.leftCarabiner.rotation.x = Math.PI / 6
    this.leftCarabiner.material = metalMat

    this.rightCarabiner = MeshBuilder.CreateTorus(
      'carabiner-right',
      { diameter: 0.11, thickness: 0.03, tessellation: 16 },
      scene,
    )
    this.rightCarabiner.parent = this.pilotRoot
    this.rightCarabiner.position.set(0.24, 0.58, 0.16)
    this.rightCarabiner.rotation.x = Math.PI / 6
    this.rightCarabiner.material = metalMat

    // Main Riser Webbing Straps (Webbing tubes rising up ~0.47m from carabiners)
    this.leftRiserStrap = MeshBuilder.CreateCylinder(
      'riser-strap-left',
      { height: 0.48, diameter: 0.038, tessellation: 6 },
      scene,
    )
    this.leftRiserStrap.parent = this.pilotRoot
    this.leftRiserStrap.position.set(-0.26, 0.81, 0.17)
    this.leftRiserStrap.rotation.z = -0.08
    this.leftRiserStrap.material = riserWebbingMat

    this.rightRiserStrap = MeshBuilder.CreateCylinder(
      'riser-strap-right',
      { height: 0.48, diameter: 0.038, tessellation: 6 },
      scene,
    )
    this.rightRiserStrap.parent = this.pilotRoot
    this.rightRiserStrap.position.set(0.26, 0.81, 0.17)
    this.rightRiserStrap.rotation.z = 0.08
    this.rightRiserStrap.material = riserWebbingMat

    // Brake Guide Pulley Rings (mounted on rear of risers)
    this.leftPulleyRing = MeshBuilder.CreateTorus(
      'pulley-left',
      { diameter: 0.07, thickness: 0.018, tessellation: 12 },
      scene,
    )
    this.leftPulleyRing.parent = this.pilotRoot
    this.leftPulleyRing.position.set(-0.27, 0.88, 0.14)
    this.leftPulleyRing.material = metalMat

    this.rightPulleyRing = MeshBuilder.CreateTorus(
      'pulley-right',
      { diameter: 0.07, thickness: 0.018, tessellation: 12 },
      scene,
    )
    this.rightPulleyRing.parent = this.pilotRoot
    this.rightPulleyRing.position.set(0.27, 0.88, 0.14)
    this.rightPulleyRing.material = metalMat

    // 5. Articulated Pilot Arms (Decoupled from Torso - Fixed Shoulder Sockets)
    this.leftArmMesh = MeshBuilder.CreateCylinder(
      'left-upper-arm',
      { height: 1.0, diameter: 0.13, tessellation: 8 },
      scene,
    )
    this.leftArmMesh.parent = this.pilotRoot
    this.leftArmMesh.material = pilotJacketMat

    this.leftForearmMesh = MeshBuilder.CreateCylinder(
      'left-forearm',
      { height: 1.0, diameter: 0.11, tessellation: 8 },
      scene,
    )
    this.leftForearmMesh.parent = this.pilotRoot
    this.leftForearmMesh.material = pilotJacketMat

    this.leftHandNode = new TransformNode('left-hand', scene)
    this.leftHandNode.parent = this.pilotRoot
    const leftHandGlove = MeshBuilder.CreateSphere(
      'left-glove',
      { diameter: 0.15, segments: 8 },
      scene,
    )
    leftHandGlove.parent = this.leftHandNode
    leftHandGlove.material = helmetMat

    this.rightArmMesh = MeshBuilder.CreateCylinder(
      'right-upper-arm',
      { height: 1.0, diameter: 0.13, tessellation: 8 },
      scene,
    )
    this.rightArmMesh.parent = this.pilotRoot
    this.rightArmMesh.material = pilotJacketMat

    this.rightForearmMesh = MeshBuilder.CreateCylinder(
      'right-forearm',
      { height: 1.0, diameter: 0.11, tessellation: 8 },
      scene,
    )
    this.rightForearmMesh.parent = this.pilotRoot
    this.rightForearmMesh.material = pilotJacketMat

    this.rightHandNode = new TransformNode('right-hand', scene)
    this.rightHandNode.parent = this.pilotRoot
    const rightHandGlove = MeshBuilder.CreateSphere(
      'right-glove',
      { diameter: 0.15, segments: 8 },
      scene,
    )
    rightHandGlove.parent = this.rightHandNode
    rightHandGlove.material = helmetMat

    // 6. Build Initial Dynamic Line Cascades (26 Suspension Lines + 10 Brake Cascade Lines)
    const initialLines = this.buildLineCoordinates()

    this.suspensionLinesMesh = MeshBuilder.CreateLineSystem(
      'suspension-lines',
      {
        lines: initialLines.suspension,
        updatable: true,
      },
      scene,
    )
    this.suspensionLinesMesh.color = new Color3(0.92, 0.95, 1.0) // Silver/white Dyneema lines

    this.brakeLinesMesh = MeshBuilder.CreateLineSystem(
      'brake-lines',
      {
        lines: initialLines.brake,
        updatable: true,
      },
      scene,
    )
    this.brakeLinesMesh.color = new Color3(1.0, 0.45, 0.1) // Fluorescent orange acro brake line
  }

  private alignLimb(mesh: Mesh, start: Vector3, end: Vector3, diameter: number) {
    const diff = end.subtract(start)
    const len = diff.length()
    if (len < 0.001) return
    mesh.position.copyFrom(start.add(diff.scale(0.5)))
    mesh.scaling.set(diameter / 0.12, len, diameter / 0.12)
    if (!mesh.rotationQuaternion) {
      mesh.rotationQuaternion = new Quaternion()
    }
    const dir = diff.scale(1 / len)
    Quaternion.FromUnitVectorsToRef(Vector3.Up(), dir, mesh.rotationQuaternion)
  }

  private buildLineCoordinates(sim?: ParagliderSimulation): { suspension: Vector3[][]; brake: Vector3[][] } {
    const canopyMatrix = this.canopyRoot.getWorldMatrix()
    const pilotMatrix = this.pilotRoot.getWorldMatrix()

    const isLeftSlack = sim ? (sim.isLinesSlack || sim.leftLineTensionNewtons < 25) : false
    const isRightSlack = sim ? (sim.isLinesSlack || sim.rightLineTensionNewtons < 25) : false

    // Key attachment points on the harness in world coordinates
    const leftCarabinerWorld = Vector3.TransformCoordinates(
      new Vector3(-0.24, 0.58, 0.16),
      pilotMatrix,
    )
    const rightCarabinerWorld = Vector3.TransformCoordinates(
      new Vector3(0.24, 0.58, 0.16),
      pilotMatrix,
    )
    const leftRiserTopWorld = Vector3.TransformCoordinates(
      new Vector3(-0.28, 1.05, 0.18),
      pilotMatrix,
    )
    const rightRiserTopWorld = Vector3.TransformCoordinates(
      new Vector3(0.28, 1.05, 0.18),
      pilotMatrix,
    )
    const leftPulleyWorld = Vector3.TransformCoordinates(
      new Vector3(-0.27, 0.88, 0.14),
      pilotMatrix,
    )
    const rightPulleyWorld = Vector3.TransformCoordinates(
      new Vector3(0.27, 0.88, 0.14),
      pilotMatrix,
    )

    const leftHandWorld = this.leftHandNode.getAbsolutePosition()
    const rightHandWorld = this.rightHandNode.getAbsolutePosition()

    const suspension: Vector3[][] = []

    // Helper to generate line with optional sag when slack
    const makeLine = (pTop: Vector3, pBottom: Vector3, isSlack: boolean) => {
      if (isSlack) {
        const mid = Vector3.Lerp(pTop, pBottom, 0.5).add(new Vector3(0, -0.32, 0.08))
        return [pTop, mid, pBottom]
      }
      return [pTop, pBottom]
    }

    // Riser webbing link from carabiners to line maillons
    suspension.push([leftCarabinerWorld, leftRiserTopWorld])
    suspension.push([rightCarabinerWorld, rightRiserTopWorld])

    // A-lines (Leading edge front ribbon)
    const leftAIndices = [2, 5, 8, 11]
    for (const idx of leftAIndices) {
      const pt = Vector3.TransformCoordinates(this.frontRibbonPath[idx], canopyMatrix)
      suspension.push(makeLine(pt, leftRiserTopWorld, isLeftSlack))
    }
    const rightAIndices = [13, 16, 19, 22]
    for (const idx of rightAIndices) {
      const pt = Vector3.TransformCoordinates(this.frontRibbonPath[idx], canopyMatrix)
      suspension.push(makeLine(pt, rightRiserTopWorld, isRightSlack))
    }

    // B-lines (Mid chord ribbon)
    const leftBIndices = [2, 5, 8, 11]
    for (const idx of leftBIndices) {
      const pt = Vector3.TransformCoordinates(this.midRibbonPath[idx], canopyMatrix)
      suspension.push(makeLine(pt, leftRiserTopWorld, isLeftSlack))
    }
    const rightBIndices = [13, 16, 19, 22]
    for (const idx of rightBIndices) {
      const pt = Vector3.TransformCoordinates(this.midRibbonPath[idx], canopyMatrix)
      suspension.push(makeLine(pt, rightRiserTopWorld, isRightSlack))
    }

    // C-lines (Rear chord ribbon)
    const leftCIndices = [3, 6, 9]
    for (const idx of leftCIndices) {
      const pt = Vector3.TransformCoordinates(this.backRibbonPath[idx], canopyMatrix)
      suspension.push(makeLine(pt, leftRiserTopWorld, isLeftSlack))
    }
    const rightCIndices = [15, 18, 21]
    for (const idx of rightCIndices) {
      const pt = Vector3.TransformCoordinates(this.backRibbonPath[idx], canopyMatrix)
      suspension.push(makeLine(pt, rightRiserTopWorld, isRightSlack))
    }

    // Stabilo lines (Wingtips)
    suspension.push(
      makeLine(
        Vector3.TransformCoordinates(this.frontRibbonPath[0], canopyMatrix),
        leftRiserTopWorld,
        isLeftSlack,
      ),
    )
    suspension.push(
      makeLine(
        Vector3.TransformCoordinates(this.frontRibbonPath[24], canopyMatrix),
        rightRiserTopWorld,
        isRightSlack,
      ),
    )

    // Brake Cascades (Trailing Edge Fan -> Collector Knot -> Pulley Ring -> Pilot Hands)
    const brake: Vector3[][] = []

    // Left Brake Fan
    const leftBrakeIndices = [1, 3, 5]
    const leftBrakePts = leftBrakeIndices.map((idx) =>
      Vector3.TransformCoordinates(this.backRibbonPath[idx], canopyMatrix),
    )
    const leftBrakeMid = leftBrakePts[1]
    const leftCollectorWorld = Vector3.Lerp(leftPulleyWorld, leftBrakeMid, 0.42)

    for (const pt of leftBrakePts) {
      brake.push([pt, leftCollectorWorld])
    }
    brake.push([leftCollectorWorld, leftPulleyWorld])
    brake.push([leftPulleyWorld, leftHandWorld])

    // Right Brake Fan
    const rightBrakeIndices = [19, 21, 23]
    const rightBrakePts = rightBrakeIndices.map((idx) =>
      Vector3.TransformCoordinates(this.backRibbonPath[idx], canopyMatrix),
    )
    const rightBrakeMid = rightBrakePts[1]
    const rightCollectorWorld = Vector3.Lerp(rightPulleyWorld, rightBrakeMid, 0.42)

    for (const pt of rightBrakePts) {
      brake.push([pt, rightCollectorWorld])
    }
    brake.push([rightCollectorWorld, rightPulleyWorld])
    brake.push([rightPulleyWorld, rightHandWorld])

    return { suspension, brake }
  }

  public update(sim: ParagliderSimulation) {
    // 1. Position and Orient Canopy
    this.canopyRoot.position.set(
      sim.canopy.position.x,
      sim.canopy.position.y,
      sim.canopy.position.z,
    )
    const yawRad = (sim.canopy.yawDeg * Math.PI) / 180
    const pitchRad = (sim.canopy.pitchDeg * Math.PI) / 180
    const rollRad = (sim.canopy.rollDeg * Math.PI) / 180
    this.canopyRoot.rotation.set(pitchRad, yawRad, -rollRad)

    // 2. Position and Orient Pilot (Rock-Solid Seated Posture in Harness)
    this.pilotRoot.position.set(
      sim.pilot.position.x,
      sim.pilot.position.y,
      sim.pilot.position.z,
    )
    const pilotRollRad = (sim.pilot.pendulumRollDeg * Math.PI) / 180
    const pilotPitchRad = (sim.pilot.pendulumPitchDeg * Math.PI) / 180

    // Coupled harness posture: The harness hangs strictly along the suspension lines
    // In flips and rolls, the pilot and wing rotate as a unified aero-mechanical unit!
    const harnessPitch = -0.16 + pitchRad + pilotPitchRad
    const harnessRoll = -rollRad - pilotRollRad
    this.pilotRoot.rotation.set(harnessPitch, yawRad, harnessRoll)

    // 3. Articulate Pilot Arms Driven by Left & Right Brakes (Fixed Torso Anchors)
    const leftBrakeT = sim.controls.leftBrake
    const rightBrakeT = sim.controls.rightBrake

    // Fixed shoulder socket anchors on the torso (never moves when arms articulate!)
    const leftShoulder = new Vector3(-0.24, 0.65, 0.08)
    const rightShoulder = new Vector3(0.24, 0.65, 0.08)

    // Dynamic hand & elbow positions in pilot local space
    // Brake = 0: Hand reaches up to toggle near riser pulley (y = 0.86)
    // Brake = 1: Hand pulls down to hip level (y = 0.22)
    const leftHandPos = new Vector3(
      -0.30 + leftBrakeT * 0.04,
      0.86 - leftBrakeT * 0.64,
      0.16 - leftBrakeT * 0.12,
    )
    const leftElbowPos = new Vector3(
      -0.38 + leftBrakeT * 0.06,
      0.54 - leftBrakeT * 0.14,
      0.06 - leftBrakeT * 0.10,
    )

    const rightHandPos = new Vector3(
      0.30 - rightBrakeT * 0.04,
      0.86 - rightBrakeT * 0.64,
      0.16 - rightBrakeT * 0.12,
    )
    const rightElbowPos = new Vector3(
      0.38 - rightBrakeT * 0.06,
      0.54 - rightBrakeT * 0.14,
      0.06 - rightBrakeT * 0.10,
    )

    // Position glove nodes
    this.leftHandNode.position.copyFrom(leftHandPos)
    this.rightHandNode.position.copyFrom(rightHandPos)

    // Align upper arms: shoulder to elbow
    this.alignLimb(this.leftArmMesh, leftShoulder, leftElbowPos, 0.13)
    this.alignLimb(this.rightArmMesh, rightShoulder, rightElbowPos, 0.13)

    // Align forearms: elbow to hand
    this.alignLimb(this.leftForearmMesh, leftElbowPos, leftHandPos, 0.11)
    this.alignLimb(this.rightForearmMesh, rightElbowPos, rightHandPos, 0.11)

    // 4. Dynamic Trailing Edge Flex, Horseshoe Stall, Asymmetric Collapse & Slack Frontal Tuck
    const isStall = sim.isStalled
    const isSlack = sim.isLinesSlack
    const leftCollapse = sim.canopy.leftWingCollapse || 0
    const rightCollapse = sim.canopy.rightWingCollapse || 0

    // Front edge: deflates and tucks if lines go slack, or if that wing half collapses
    for (let i = 0; i < this.frontRibbonPath.length; i++) {
      const origFront = this.originalFrontRibbonPath[i]
      const t = i / (this.frontRibbonPath.length - 1)

      let sideCollapse = 0
      if (t < 0.48) {
        sideCollapse = leftCollapse * Math.sin((t / 0.48) * Math.PI)
      } else if (t > 0.52) {
        sideCollapse = rightCollapse * Math.sin(((1 - t) / 0.48) * Math.PI)
      }

      if (isSlack) {
        const tuck = Math.sin(t * Math.PI) * 0.7
        this.frontRibbonPath[i].y = origFront.y - tuck - sideCollapse * 0.75
        this.frontRibbonPath[i].z = origFront.z - tuck * 0.45 - sideCollapse * 0.45
      } else {
        this.frontRibbonPath[i].y = origFront.y - sideCollapse * 0.75
        this.frontRibbonPath[i].z = origFront.z - sideCollapse * 0.45
      }
    }

    // Back edge: deflects with brakes, horseshoes in full stall, or crumples in asymmetric collapse
    for (let i = 0; i < this.backRibbonPath.length; i++) {
      const orig = this.originalBackRibbonPath[i]
      const t = i / (this.backRibbonPath.length - 1) // 0 (left tip) to 1 (right tip)

      let brakeFlex = 0
      if (t < 0.5) {
        const leftInfluence = Math.pow((0.5 - t) * 2, 1.4)
        brakeFlex = sim.canopy.leftTrailingEdgeFlex * leftInfluence * 0.55
      } else {
        const rightInfluence = Math.pow((t - 0.5) * 2, 1.4)
        brakeFlex = sim.canopy.rightTrailingEdgeFlex * rightInfluence * 0.55
      }

      let asymTuck = 0
      if (t < 0.48) {
        asymTuck = leftCollapse * Math.sin((t / 0.48) * Math.PI) * 1.35
      } else if (t > 0.52) {
        asymTuck = rightCollapse * Math.sin(((1 - t) / 0.48) * Math.PI) * 1.35
      }

      if (isStall) {
        const horseshoe = Math.sin(t * Math.PI) * 0.95
        this.backRibbonPath[i].y = orig.y - 0.85 - horseshoe
        this.backRibbonPath[i].z = orig.z + 0.9 + horseshoe * 0.6
      } else {
        this.backRibbonPath[i].y = orig.y - brakeFlex - asymTuck
        this.backRibbonPath[i].z = orig.z + brakeFlex * 0.25 + asymTuck * 0.65
      }
    }

    // Update Ribbon Geometry
    MeshBuilder.CreateRibbon(
      'canopy-ribbon',
      {
        pathArray: [this.frontRibbonPath, this.midRibbonPath, this.backRibbonPath],
        instance: this.canopyMesh,
      },
      this.scene,
    )

    // 5. Update Dynamic 36-Line Cascades (Anchored to Carabiners and Hands with Slack Sag)
    const lineCoords = this.buildLineCoordinates(sim)

    MeshBuilder.CreateLineSystem(
      'suspension-lines',
      {
        lines: lineCoords.suspension,
        instance: this.suspensionLinesMesh,
      },
      this.scene,
    )

    MeshBuilder.CreateLineSystem(
      'brake-lines',
      {
        lines: lineCoords.brake,
        instance: this.brakeLinesMesh,
      },
      this.scene,
    )
  }
}
