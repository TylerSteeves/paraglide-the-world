import { Color3, Color4 } from '@babylonjs/core/Maths/math.color'
import { Vector3, Quaternion, Matrix } from '@babylonjs/core/Maths/math.vector'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { LinesMesh } from '@babylonjs/core/Meshes/linesMesh'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Scene } from '@babylonjs/core/scene'
import '@babylonjs/core/Rendering/edgesRenderer'
import type { ParagliderSimulation } from '../physics/pendulum'
import { clamp } from '../physics/vecmath'
import { LnPalette, LnStyleManager } from './LnStyleManager'

export class ParagliderRig {
  private scene: Scene
  private canopyRoot: TransformNode
  private pilotRoot: TransformNode
  private pilotBodyPivot: TransformNode

  // Glider 3D Mesh
  private canopyMesh!: Mesh
  private underMesh!: Mesh
  public currentWingType: 'speedwing' | 'paraglider' | 'paramotor' = 'speedwing'
  private canopyTopSpeedMat!: StandardMaterial
  private canopyTopXcMat!: StandardMaterial
  private canopyTopParamotorMat!: StandardMaterial
  private canopyUnderMat!: StandardMaterial
  private canopyUnderParamotorMat!: StandardMaterial
  private propBlurMat!: StandardMaterial
  private lineCanopyMat!: StandardMaterial
  private ribLinesMesh: LinesMesh | null = null

  // Paramotor Frame & Propeller
  private paramotorNode!: TransformNode
  private propellerMesh!: Mesh
  private propBlurMesh!: Mesh

  // Stylized Articulated Pilot
  private helmetMesh: Mesh
  private visorMesh: Mesh
  private neckMesh: Mesh
  private torsoMesh: Mesh
  private harnessMesh: Mesh
  private leftCarabinerMesh: Mesh
  private rightCarabinerMesh: Mesh
  private tempMat1: Matrix = new Matrix()
  private tempMat2: Matrix = new Matrix()
  private pilotSuitMat!: StandardMaterial
  private helmetMat!: StandardMaterial
  private visorMat!: StandardMaterial
  private gloveMat!: StandardMaterial
  private toggleMat!: StandardMaterial
  private bootMat!: StandardMaterial
  private soleMat!: StandardMaterial
  private unsubscribeStyle: () => void
  private leftUpperArmMesh: Mesh
  private rightUpperArmMesh: Mesh
  private leftForearmMesh: Mesh
  private rightForearmMesh: Mesh
  private leftElbowMesh: Mesh
  private rightElbowMesh: Mesh
  private leftHandNode: TransformNode
  private rightHandNode: TransformNode
  private currentLeftHandPos: Vector3 = new Vector3(-0.28, 0.88, 0.06)
  private currentRightHandPos: Vector3 = new Vector3(0.28, 0.88, 0.06)
  private leftLegNode: TransformNode
  private rightLegNode: TransformNode
  private leftKneeNode: TransformNode
  private rightKneeNode: TransformNode

  // Line Networks & Risers
  private suspensionLinesMesh!: LinesMesh
  private risersMesh!: LinesMesh
  private brakeLinesMesh!: LinesMesh

  // Aerofoil Rib Paths
  private aLinePoints: Vector3[] = []
  private bLinePoints: Vector3[] = []
  private cLinePoints: Vector3[] = []
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

    this.canopyTopParamotorMat = new StandardMaterial('canopy-top-paramotor-mat', scene)
    this.canopyTopParamotorMat.diffuseColor = new Color3(0.0, 0.88, 1.0) // Electric Freeride cyan
    this.canopyTopParamotorMat.specularColor = new Color3(0.35, 0.35, 0.35)
    this.canopyTopParamotorMat.backFaceCulling = false

    this.canopyUnderMat = new StandardMaterial('canopy-under-mat', scene)
    this.canopyUnderMat.diffuseColor = new Color3(0.12, 0.72, 0.88) // Electric cyan under-surface
    this.canopyUnderMat.specularColor = new Color3(0.1, 0.1, 0.1)

    this.canopyUnderParamotorMat = new StandardMaterial('canopy-under-paramotor-mat', scene)
    this.canopyUnderParamotorMat.diffuseColor = new Color3(0.95, 0.96, 0.98) // Clean racing silver/white
    this.canopyUnderParamotorMat.specularColor = new Color3(0.2, 0.2, 0.2)

    this.propBlurMat = new StandardMaterial('prop-blur-mat', scene)
    this.propBlurMat.diffuseColor = new Color3(0.15, 0.15, 0.18)
    this.propBlurMat.alpha = 0
    this.propBlurMat.backFaceCulling = false

    this.lineCanopyMat = new StandardMaterial('canopy-line-mat', scene)
    this.lineCanopyMat.diffuseColor = new Color3(0.96, 0.95, 0.92)
    this.lineCanopyMat.backFaceCulling = false

    // Pilot Suit & Gear Materials
    this.pilotSuitMat = new StandardMaterial('pilot-suit-mat', scene)
    this.pilotSuitMat.diffuseColor = new Color3(0.15, 0.20, 0.28) // Deep charcoal navy flight suit
    this.pilotSuitMat.specularColor = new Color3(0.06, 0.06, 0.06)

    this.helmetMat = new StandardMaterial('helmet-mat', scene)
    this.helmetMat.diffuseColor = new Color3(0.98, 0.98, 1.0) // Gloss white action helmet
    this.helmetMat.specularColor = new Color3(0.9, 0.9, 0.95)

    this.visorMat = new StandardMaterial('visor-mat', scene)
    this.visorMat.diffuseColor = new Color3(0.04, 0.04, 0.06) // Mirrored iridium visor
    this.visorMat.specularColor = new Color3(0.95, 0.85, 0.35) // Gold sun glint

    const skinMat = new StandardMaterial('skin-mat', scene)
    skinMat.diffuseColor = new Color3(0.88, 0.68, 0.54) // Natural skin/neck

    const metalMat = new StandardMaterial('metal-mat', scene)
    metalMat.diffuseColor = new Color3(0.85, 0.88, 0.94) // Anodized aluminum carabiners
    metalMat.specularColor = new Color3(0.95, 0.95, 0.95)

    this.bootMat = new StandardMaterial('boot-mat', scene)
    this.bootMat.diffuseColor = new Color3(0.18, 0.22, 0.32) // Sport trail shoes
    this.bootMat.specularColor = new Color3(0.1, 0.1, 0.1)

    const sockMat = new StandardMaterial('sock-mat', scene)
    sockMat.diffuseColor = new Color3(0.08, 0.72, 0.45) // Sporty electric green/teal socks

    this.soleMat = new StandardMaterial('sole-mat', scene)
    this.soleMat.diffuseColor = new Color3(0.96, 0.96, 0.98) // White trail shoe EVA outsole
    this.soleMat.specularColor = new Color3(0.3, 0.3, 0.3)

    this.gloveMat = new StandardMaterial('glove-mat', scene)
    this.gloveMat.diffuseColor = new Color3(0.10, 0.12, 0.16) // Technical flight gloves
    this.gloveMat.specularColor = new Color3(0.15, 0.15, 0.15)

    this.toggleMat = new StandardMaterial('toggle-mat', scene)
    this.toggleMat.diffuseColor = new Color3(0.96, 0.24, 0.14) // Paraglider red brake toggle loops
    this.toggleMat.specularColor = new Color3(0.4, 0.4, 0.4)

    // Build initial Speedwing canopy & lines
    this.buildCanopyAndLines('speedwing')

    // Subscribe to line-art style manager
    this.unsubscribeStyle = LnStyleManager.getInstance().subscribe((palette) => {
      this.applyPalette(palette)
    })

    // 3. Build Organic Stylized Character Model (Sphere-Packed / Clean Proportions)
    // Head & Helmet
    this.helmetMesh = MeshBuilder.CreateSphere('pilot-helmet', { diameter: 0.38, segments: 14 }, scene)
    this.helmetMesh.position.set(0, 0.72, 0.04)
    this.helmetMesh.material = this.helmetMat
    this.helmetMesh.parent = this.pilotBodyPivot

    this.visorMesh = MeshBuilder.CreateSphere('pilot-visor', { diameter: 0.32, segments: 10 }, scene)
    this.visorMesh.scaling.set(1.04, 0.52, 0.88)
    this.visorMesh.position.set(0, 0.71, 0.16)
    this.visorMesh.material = this.visorMat
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
    this.torsoMesh.material = this.pilotSuitMat
    this.torsoMesh.parent = this.pilotBodyPivot

    // Seated Harness Pod
    this.harnessMesh = MeshBuilder.CreateSphere('pilot-harness-pod', { diameter: 0.65, segments: 10 }, scene)
    this.harnessMesh.scaling.set(0.88, 0.75, 1.15)
    this.harnessMesh.position.set(0, 0.08, -0.06)
    this.harnessMesh.rotation.x = 0.3
    this.harnessMesh.material = this.pilotSuitMat
    this.harnessMesh.parent = this.pilotBodyPivot

    // Carabiners rigidly mounted on harness frame (suspension line anchor points)
    this.leftCarabinerMesh = MeshBuilder.CreateTorus('carabiner-l', { diameter: 0.11, thickness: 0.022, tessellation: 16 }, scene)
    this.leftCarabinerMesh.position.set(-0.26, 0.34, 0.06)
    this.leftCarabinerMesh.material = metalMat
    this.leftCarabinerMesh.parent = this.pilotBodyPivot

    this.rightCarabinerMesh = MeshBuilder.CreateTorus('carabiner-r', { diameter: 0.11, thickness: 0.022, tessellation: 16 }, scene)
    this.rightCarabinerMesh.position.set(0.26, 0.34, 0.06)
    this.rightCarabinerMesh.material = metalMat
    this.rightCarabinerMesh.parent = this.pilotBodyPivot

    // Anatomical Articulated Arms (Shoulders -> Upper Arms -> Elbows -> Forearms -> Hands -> Brake Toggles)
    // Rounded deltoid shoulders
    const lShoulder = MeshBuilder.CreateSphere('shoulder-l', { diameter: 0.13, segments: 8 }, scene)
    lShoulder.position.set(-0.28, 0.44, 0.04)
    lShoulder.material = this.pilotSuitMat
    lShoulder.parent = this.pilotBodyPivot

    const rShoulder = MeshBuilder.CreateSphere('shoulder-r', { diameter: 0.13, segments: 8 }, scene)
    rShoulder.position.set(0.28, 0.44, 0.04)
    rShoulder.material = this.pilotSuitMat
    rShoulder.parent = this.pilotBodyPivot

    // Upper arm cylinders (oriented dynamically between shoulder and elbow)
    this.leftUpperArmMesh = MeshBuilder.CreateCylinder('upper-arm-l', { height: 1.0, diameter: 0.11, tessellation: 10 }, scene)
    this.leftUpperArmMesh.rotationQuaternion = new Quaternion()
    this.leftUpperArmMesh.material = this.pilotSuitMat
    this.leftUpperArmMesh.parent = this.pilotBodyPivot

    this.rightUpperArmMesh = MeshBuilder.CreateCylinder('upper-arm-r', { height: 1.0, diameter: 0.11, tessellation: 10 }, scene)
    this.rightUpperArmMesh.rotationQuaternion = new Quaternion()
    this.rightUpperArmMesh.material = this.pilotSuitMat
    this.rightUpperArmMesh.parent = this.pilotBodyPivot

    // Articulated elbow joints
    this.leftElbowMesh = MeshBuilder.CreateSphere('elbow-l', { diameter: 0.10, segments: 8 }, scene)
    this.leftElbowMesh.material = this.pilotSuitMat
    this.leftElbowMesh.parent = this.pilotBodyPivot

    this.rightElbowMesh = MeshBuilder.CreateSphere('elbow-r', { diameter: 0.10, segments: 8 }, scene)
    this.rightElbowMesh.material = this.pilotSuitMat
    this.rightElbowMesh.parent = this.pilotBodyPivot

    // Forearm cylinders (oriented dynamically between elbow and hand)
    this.leftForearmMesh = MeshBuilder.CreateCylinder('forearm-l', { height: 1.0, diameter: 0.095, tessellation: 10 }, scene)
    this.leftForearmMesh.rotationQuaternion = new Quaternion()
    this.leftForearmMesh.material = this.pilotSuitMat
    this.leftForearmMesh.parent = this.pilotBodyPivot

    this.rightForearmMesh = MeshBuilder.CreateCylinder('forearm-r', { height: 1.0, diameter: 0.095, tessellation: 10 }, scene)
    this.rightForearmMesh.rotationQuaternion = new Quaternion()
    this.rightForearmMesh.material = this.pilotSuitMat
    this.rightForearmMesh.parent = this.pilotBodyPivot

    // Hand transform nodes (travel vertically along risers from pulley level to hips)
    this.leftHandNode = new TransformNode('hand-node-l', scene)
    this.leftHandNode.position.copyFrom(this.currentLeftHandPos)
    this.leftHandNode.parent = this.pilotBodyPivot

    this.rightHandNode = new TransformNode('hand-node-r', scene)
    this.rightHandNode.position.copyFrom(this.currentRightHandPos)
    this.rightHandNode.parent = this.pilotBodyPivot

    // Flight gloves & brake toggles
    const lGlove = MeshBuilder.CreateBox('glove-l', { width: 0.08, height: 0.12, depth: 0.08 }, scene)
    lGlove.material = this.gloveMat
    lGlove.parent = this.leftHandNode

    const rGlove = MeshBuilder.CreateBox('glove-r', { width: 0.08, height: 0.12, depth: 0.08 }, scene)
    rGlove.material = this.gloveMat
    rGlove.parent = this.rightHandNode

    // Brake toggle handles (gripped in pilot hands)
    const lToggle = MeshBuilder.CreateTorus('toggle-l', { diameter: 0.085, thickness: 0.016, tessellation: 16 }, scene)
    lToggle.rotation.x = Math.PI * 0.5
    lToggle.material = this.toggleMat
    lToggle.parent = this.leftHandNode

    const rToggle = MeshBuilder.CreateTorus('toggle-r', { diameter: 0.085, thickness: 0.016, tessellation: 16 }, scene)
    rToggle.rotation.x = Math.PI * 0.5
    rToggle.material = this.toggleMat
    rToggle.parent = this.rightHandNode

    // Articulated Legs & Boots (Connected Anatomical Hierarchy - Zero Gaps)
    // Hip anchors
    this.leftLegNode = new TransformNode('leg-root-l', scene)
    this.leftLegNode.position.set(-0.14, 0.08, 0.08)
    this.leftLegNode.rotation.x = 0.55 // Natural forward recline
    this.leftLegNode.parent = this.pilotBodyPivot

    this.rightLegNode = new TransformNode('leg-root-r', scene)
    this.rightLegNode.position.set(0.14, 0.08, 0.08)
    this.rightLegNode.rotation.x = 0.55
    this.rightLegNode.parent = this.pilotBodyPivot

    // Thigh cylinders along local -Y of leg node
    const lThigh = MeshBuilder.CreateCylinder('thigh-l', { height: 0.44, diameter: 0.16, tessellation: 10 }, scene)
    lThigh.position.set(0, -0.22, 0)
    lThigh.material = this.pilotSuitMat
    lThigh.parent = this.leftLegNode

    const rThigh = MeshBuilder.CreateCylinder('thigh-r', { height: 0.44, diameter: 0.16, tessellation: 10 }, scene)
    rThigh.position.set(0, -0.22, 0)
    rThigh.material = this.pilotSuitMat
    rThigh.parent = this.rightLegNode

    // Knee joints: anchored at exact distal end of thighs (0, -0.44, 0)
    this.leftKneeNode = new TransformNode('knee-l', scene)
    this.leftKneeNode.position.set(0, -0.44, 0)
    this.leftKneeNode.rotation.x = -0.75 // Default seated knee bend
    this.leftKneeNode.parent = this.leftLegNode

    this.rightKneeNode = new TransformNode('knee-r', scene)
    this.rightKneeNode.position.set(0, -0.44, 0)
    this.rightKneeNode.rotation.x = -0.75
    this.rightKneeNode.parent = this.rightLegNode

    // Knee joint spheres seamlessly bridging thigh and shin
    const lKneeCap = MeshBuilder.CreateSphere('kneecap-l', { diameter: 0.16, segments: 10 }, scene)
    lKneeCap.material = this.pilotSuitMat
    lKneeCap.parent = this.leftKneeNode

    const rKneeCap = MeshBuilder.CreateSphere('kneecap-r', { diameter: 0.16, segments: 10 }, scene)
    rKneeCap.material = this.pilotSuitMat
    rKneeCap.parent = this.rightKneeNode

    // Shin cylinders along local -Y of knee node
    const lShin = MeshBuilder.CreateCylinder('shin-l', { height: 0.42, diameter: 0.14, tessellation: 10 }, scene)
    lShin.position.set(0, -0.21, 0)
    lShin.material = this.pilotSuitMat
    lShin.parent = this.leftKneeNode

    const rShin = MeshBuilder.CreateCylinder('shin-r', { height: 0.42, diameter: 0.14, tessellation: 10 }, scene)
    rShin.position.set(0, -0.21, 0)
    rShin.material = this.pilotSuitMat
    rShin.parent = this.rightKneeNode

    // Ankle socks at distal end of shin
    const lSock = MeshBuilder.CreateCylinder('sock-l', { height: 0.10, diameter: 0.15, tessellation: 10 }, scene)
    lSock.position.set(0, -0.36, 0)
    lSock.material = sockMat
    lSock.parent = this.leftKneeNode

    const rSock = MeshBuilder.CreateCylinder('sock-r', { height: 0.10, diameter: 0.15, tessellation: 10 }, scene)
    rSock.position.set(0, -0.36, 0)
    rSock.material = sockMat
    rSock.parent = this.rightKneeNode

    // Ankle joints: anchored at exact distal end of shins (0, -0.42, 0)
    const lAnkleNode = new TransformNode('ankle-l', scene)
    lAnkleNode.position.set(0, -0.42, 0)
    lAnkleNode.parent = this.leftKneeNode

    const rAnkleNode = new TransformNode('ankle-r', scene)
    rAnkleNode.position.set(0, -0.42, 0)
    rAnkleNode.parent = this.rightKneeNode

    // Athletic Trail Running Shoes
    const lBoot = MeshBuilder.CreateBox('boot-l', { width: 0.15, height: 0.12, depth: 0.32 }, scene)
    lBoot.position.set(0, -0.04, 0.08)
    lBoot.material = this.bootMat
    lBoot.parent = lAnkleNode

    const lSole = MeshBuilder.CreateBox('sole-l', { width: 0.16, height: 0.04, depth: 0.34 }, scene)
    lSole.position.set(0, -0.10, 0.08)
    lSole.material = this.soleMat
    lSole.parent = lAnkleNode

    const rBoot = MeshBuilder.CreateBox('boot-r', { width: 0.15, height: 0.12, depth: 0.32 }, scene)
    rBoot.position.set(0, -0.04, 0.08)
    rBoot.material = this.bootMat
    rBoot.parent = rAnkleNode

    const rSole = MeshBuilder.CreateBox('sole-r', { width: 0.16, height: 0.04, depth: 0.34 }, scene)
    rSole.position.set(0, -0.10, 0.08)
    rSole.material = this.soleMat
    rSole.parent = rAnkleNode

    // 4. Build Powered Slalom Paramotor Rig (Ozone Freeride 2 Power Unit)
    this.paramotorNode = new TransformNode('paramotor-rig', scene)
    this.paramotorNode.parent = this.pilotBodyPivot

    const cageMat = new StandardMaterial('paramotor-cage-mat', scene)
    cageMat.diffuseColor = new Color3(0.85, 0.88, 0.92) // Titanium frame
    cageMat.specularColor = new Color3(0.9, 0.9, 0.9)

    const engineMat = new StandardMaterial('paramotor-engine-mat', scene)
    engineMat.diffuseColor = new Color3(0.2, 0.22, 0.25) // Cast aluminum 2-stroke engine
    engineMat.specularColor = new Color3(0.5, 0.5, 0.5)

    const propMat = new StandardMaterial('paramotor-prop-mat', scene)
    propMat.diffuseColor = new Color3(0.08, 0.08, 0.1) // High-gloss carbon fiber
    propMat.specularColor = new Color3(0.8, 0.8, 0.8)

    // Outer Titanium Hoop Cage (1.40m diameter)
    const cageHoop = MeshBuilder.CreateTorus('paramotor-cage-hoop', { diameter: 1.40, thickness: 0.022, tessellation: 32 }, scene)
    cageHoop.position.set(0, 0.38, -0.42)
    cageHoop.material = cageMat
    cageHoop.parent = this.paramotorNode

    // Engine Block & Reduction Drive Hub
    const engineBlock = MeshBuilder.CreateBox('paramotor-engine', { width: 0.22, height: 0.28, depth: 0.24 }, scene)
    engineBlock.position.set(0, 0.32, -0.32)
    engineBlock.material = engineMat
    engineBlock.parent = this.paramotorNode

    // 2-Stroke Tuned Expansion Chamber Exhaust
    const exhaust = MeshBuilder.CreateTorus('paramotor-exhaust', { diameter: 0.32, thickness: 0.045, tessellation: 20 }, scene)
    exhaust.position.set(0.12, 0.22, -0.34)
    exhaust.rotation.y = 0.4
    exhaust.material = cageMat
    exhaust.parent = this.paramotorNode

    // Fuel Tank
    const fuelTank = MeshBuilder.CreateBox('paramotor-tank', { width: 0.24, height: 0.16, depth: 0.18 }, scene)
    fuelTank.position.set(0, 0.08, -0.28)
    const tankMat = new StandardMaterial('paramotor-tank-mat', scene)
    tankMat.diffuseColor = new Color3(0.9, 0.92, 0.95)
    fuelTank.material = tankMat
    fuelTank.parent = this.paramotorNode

    // Radial Titanium Struts (4 spokes connecting engine frame to outer hoop)
    const spokeAngles = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4]
    spokeAngles.forEach((ang, idx) => {
      const spoke = MeshBuilder.CreateCylinder(`paramotor-spoke-${idx}`, { height: 0.65, diameter: 0.016 }, scene)
      spoke.position.set(Math.cos(ang) * 0.35, 0.38 + Math.sin(ang) * 0.35, -0.38)
      spoke.rotation.z = ang + Math.PI / 2
      spoke.material = cageMat
      spoke.parent = this.paramotorNode
    })

    // Carbon Fiber 2-Blade Propeller (1.30m prop)
    this.propellerMesh = new Mesh('paramotor-propeller', scene)
    this.propellerMesh.position.set(0, 0.38, -0.45)
    this.propellerMesh.parent = this.paramotorNode

    const blade1 = MeshBuilder.CreateBox('prop-blade-1', { width: 0.11, height: 0.62, depth: 0.02 }, scene)
    blade1.position.set(0, 0.31, 0)
    blade1.rotation.y = 0.22 // Pitch angle
    blade1.material = propMat
    blade1.parent = this.propellerMesh

    const blade2 = MeshBuilder.CreateBox('prop-blade-2', { width: 0.11, height: 0.62, depth: 0.02 }, scene)
    blade2.position.set(0, -0.31, 0)
    blade2.rotation.y = -0.22
    blade2.material = propMat
    blade2.parent = this.propellerMesh

    const propHub = MeshBuilder.CreateCylinder('prop-hub', { height: 0.06, diameter: 0.12 }, scene)
    propHub.rotation.x = Math.PI / 2
    propHub.material = cageMat
    propHub.parent = this.propellerMesh

    // High-Speed Motion Blur Propeller Disc
    this.propBlurMesh = MeshBuilder.CreateDisc('paramotor-prop-blur', { radius: 0.65, tessellation: 32 }, scene)
    this.propBlurMesh.position.set(0, 0.38, -0.46)
    this.propBlurMesh.material = this.propBlurMat
    this.propBlurMesh.parent = this.paramotorNode

    this.paramotorNode.setEnabled(false)
  }

  public buildCanopyAndLines(wingType: 'speedwing' | 'paraglider' | 'paramotor') {
    this.currentWingType = wingType
    if (this.canopyMesh) this.canopyMesh.dispose()
    if (this.underMesh) this.underMesh.dispose()
    if (this.suspensionLinesMesh) this.suspensionLinesMesh.dispose()
    if (this.risersMesh) this.risersMesh.dispose()
    if (this.brakeLinesMesh) this.brakeLinesMesh.dispose()

    this.aLinePoints = []
    this.bLinePoints = []
    this.cLinePoints = []
    this.cellAttachmentPoints = []
    this.trailingEdgePoints = []

    const isXc = wingType === 'paraglider'
    const isParamotor = wingType === 'paramotor'
    const numCells = isXc ? 44 : (isParamotor ? 36 : 32)
    const halfSpan = isXc ? 5.9 : (isParamotor ? 4.7 : 4.4)
    const chord = isXc ? 2.45 : (isParamotor ? 2.25 : 2.35)
    const lineDrop = isXc ? -6.8 : (isParamotor ? -5.6 : -5.0)

    const upperRibbon: Vector3[] = []
    const lowerRibbon: Vector3[] = []

    for (let c = 0; c <= numCells; c++) {
      const u = c / numCells
      const x = -halfSpan + u * halfSpan * 2
      const normX = Math.abs(x) / halfSpan

      // Elliptical arch and aerodynamic wingtip sweep
      const archY = (1 - Math.pow(normX, 1.9)) * (isXc ? 1.75 : (isParamotor ? 1.62 : 1.58))
      const sweepZ = Math.pow(normX, 1.7) * (isXc ? 0.95 : (isParamotor ? 0.82 : 0.75))
      const taperChord = chord * (1 - normX * (isXc ? 0.35 : (isParamotor ? 0.38 : 0.42)))
      const maxThick = taperChord * (isXc ? 0.17 : (isParamotor ? 0.155 : 0.16))

      // Leading edge (+Z) and Trailing edge (-Z)
      const leZ = sweepZ + taperChord * 0.48
      const teZ = sweepZ - taperChord * 0.52

      upperRibbon.push(new Vector3(x, archY + maxThick * 0.65, leZ))
      upperRibbon.push(new Vector3(x, archY, teZ))

      lowerRibbon.push(new Vector3(x, archY - maxThick * 0.35, leZ))
      lowerRibbon.push(new Vector3(x, archY - 0.02, teZ))

      if (c % 2 === 0) {
        const aPt = new Vector3(x, archY - maxThick * 0.35, leZ * 0.85 + teZ * 0.15)
        const bPt = new Vector3(x, archY - maxThick * 0.30, leZ * 0.40 + teZ * 0.60)
        const cPt = new Vector3(x, archY - maxThick * 0.15, leZ * 0.08 + teZ * 0.92)
        this.aLinePoints.push(aPt)
        this.bLinePoints.push(bPt)
        this.cLinePoints.push(cPt)
        this.cellAttachmentPoints.push(bPt)
      }
      this.trailingEdgePoints.push(new Vector3(x, archY, teZ))
    }

    this.canopyMesh = MeshBuilder.CreateRibbon(
      'rig-canopy-top',
      { pathArray: [upperRibbon.filter((_, idx) => idx % 2 === 0), upperRibbon.filter((_, idx) => idx % 2 === 1)], updatable: true },
      this.scene,
    )
    this.canopyMesh.material = isXc
      ? this.canopyTopXcMat
      : (isParamotor ? this.canopyTopParamotorMat : this.canopyTopSpeedMat)
    this.canopyMesh.parent = this.canopyRoot

    this.underMesh = MeshBuilder.CreateRibbon(
      'rig-canopy-under',
      { pathArray: [lowerRibbon.filter((_, idx) => idx % 2 === 0), lowerRibbon.filter((_, idx) => idx % 2 === 1)], updatable: true },
      this.scene,
    )
    this.underMesh.material = isParamotor ? this.canopyUnderParamotorMat : this.canopyUnderMat
    this.underMesh.parent = this.canopyRoot

    const leftCarabinerPos = new Vector3(-0.26, lineDrop, 0.06)
    const rightCarabinerPos = new Vector3(0.26, lineDrop, 0.06)

    const leftAApex = leftCarabinerPos.add(new Vector3(0, 0.55, 0.08))
    const rightAApex = rightCarabinerPos.add(new Vector3(0, 0.55, 0.08))
    const leftBApex = leftCarabinerPos.add(new Vector3(0, 0.55, 0.00))
    const rightBApex = rightCarabinerPos.add(new Vector3(0, 0.55, 0.00))
    const leftCApex = leftCarabinerPos.add(new Vector3(0, 0.55, -0.08))
    const rightCApex = rightCarabinerPos.add(new Vector3(0, 0.55, -0.08))

    const linesData: Vector3[][] = []
    const lineColors: Color4[][] = []
    const colA = new Color4(0.96, 0.88, 0.88, 1.0)
    const colB = new Color4(0.96, 0.94, 0.82, 1.0)
    const colC = new Color4(0.85, 0.88, 0.94, 1.0)

    for (const pt of this.aLinePoints) {
      linesData.push([pt, pt.x < 0 ? leftAApex : rightAApex])
      lineColors.push([colA, colA])
    }
    for (const pt of this.bLinePoints) {
      linesData.push([pt, pt.x < 0 ? leftBApex : rightBApex])
      lineColors.push([colB, colB])
    }
    for (const pt of this.cLinePoints) {
      linesData.push([pt, pt.x < 0 ? leftCApex : rightCApex])
      lineColors.push([colC, colC])
    }

    this.suspensionLinesMesh = MeshBuilder.CreateLineSystem(
      'rig-suspension-lines',
      { lines: linesData, colors: lineColors, updatable: true },
      this.scene,
    )
    this.suspensionLinesMesh.parent = this.canopyRoot

    // Authentic 3-Branch Risers (Red A-Riser, Gold B-Riser, Charcoal C-Riser)
    const risersData: Vector3[][] = [
      [leftCarabinerPos, leftAApex],
      [leftCarabinerPos, leftBApex],
      [leftCarabinerPos, leftCApex],
      [rightCarabinerPos, rightAApex],
      [rightCarabinerPos, rightBApex],
      [rightCarabinerPos, rightCApex],
    ]
    const riserColors: Color4[][] = [
      [new Color4(0.96, 0.15, 0.15, 1.0), new Color4(0.96, 0.15, 0.15, 1.0)], // Left Red A-Riser
      [new Color4(0.98, 0.78, 0.15, 1.0), new Color4(0.98, 0.78, 0.15, 1.0)], // Left Gold B-Riser
      [new Color4(0.32, 0.36, 0.44, 1.0), new Color4(0.32, 0.36, 0.44, 1.0)], // Left Slate C-Riser
      [new Color4(0.96, 0.15, 0.15, 1.0), new Color4(0.96, 0.15, 0.15, 1.0)], // Right Red A-Riser
      [new Color4(0.98, 0.78, 0.15, 1.0), new Color4(0.98, 0.78, 0.15, 1.0)], // Right Gold B-Riser
      [new Color4(0.32, 0.36, 0.44, 1.0), new Color4(0.32, 0.36, 0.44, 1.0)], // Right Slate C-Riser
    ]
    this.risersMesh = MeshBuilder.CreateLineSystem(
      'rig-risers',
      { lines: risersData, colors: riserColors, updatable: true },
      this.scene,
    )
    this.risersMesh.parent = this.canopyRoot

    const brakeLinesData: Vector3[][] = [
      [this.trailingEdgePoints[2], leftCarabinerPos],
      [this.trailingEdgePoints[numCells - 2], rightCarabinerPos],
    ]
    this.brakeLinesMesh = MeshBuilder.CreateLineSystem(
      'rig-brake-lines',
      { lines: brakeLinesData, updatable: true },
      this.scene,
    )
    if (this.ribLinesMesh) this.ribLinesMesh.dispose()

    const ribLines: Vector3[][] = []
    for (let c = 0; c <= numCells; c++) {
      const topLe = upperRibbon[c * 2]
      const topTe = upperRibbon[c * 2 + 1]
      const btmTe = lowerRibbon[c * 2 + 1]
      const btmLe = lowerRibbon[c * 2]
      ribLines.push([topLe, topTe, btmTe, btmLe, topLe])
    }
    this.ribLinesMesh = MeshBuilder.CreateLineSystem(
      'rig-cell-ribs',
      { lines: ribLines, updatable: true },
      this.scene,
    )
    this.ribLinesMesh.parent = this.canopyRoot

    this.applyPalette(LnStyleManager.getInstance().palette)
  }

  public applyPalette(pal: LnPalette): void {
    const isLine = pal.isLineMode
    const isXc = this.currentWingType === 'paraglider'

    if (this.canopyMesh && this.underMesh) {
      if (isLine) {
        this.lineCanopyMat.diffuseColor = pal.canopyFillRgb
        this.canopyMesh.material = this.lineCanopyMat
        this.underMesh.material = this.lineCanopyMat
        try {
          this.canopyMesh.enableEdgesRendering(0.95)
          this.underMesh.enableEdgesRendering(0.95)
          this.canopyMesh.edgesWidth = 2.0
          this.underMesh.edgesWidth = 2.0
          this.canopyMesh.edgesColor = new Color4(pal.canopyRibRgb.r, pal.canopyRibRgb.g, pal.canopyRibRgb.b, 0.95)
          this.underMesh.edgesColor = new Color4(pal.canopyRibRgb.r, pal.canopyRibRgb.g, pal.canopyRibRgb.b, 0.95)
        } catch {}
      } else {
        const isParamotor = this.currentWingType === 'paramotor'
        this.canopyMesh.material = isXc
          ? this.canopyTopXcMat
          : (isParamotor ? this.canopyTopParamotorMat : this.canopyTopSpeedMat)
        this.underMesh.material = isParamotor ? this.canopyUnderParamotorMat : this.canopyUnderMat
        try {
          this.canopyMesh.disableEdgesRendering()
          this.underMesh.disableEdgesRendering()
        } catch {}
      }
    }

    if (this.ribLinesMesh) {
      this.ribLinesMesh.color = pal.canopyRibRgb
      this.ribLinesMesh.setEnabled(isLine)
    }

    if (this.suspensionLinesMesh && isLine) {
      this.suspensionLinesMesh.color = pal.suspensionLineRgb
    }
    if (this.brakeLinesMesh) {
      this.brakeLinesMesh.color = isLine ? pal.majorContourRgb : new Color3(0.98, 0.42, 0.12)
    }

    if (this.pilotSuitMat) {
      this.pilotSuitMat.diffuseColor = isLine ? new Color3(0.12, 0.14, 0.18) : new Color3(0.15, 0.20, 0.28)
    }
    if (this.helmetMat) {
      this.helmetMat.diffuseColor = isLine ? new Color3(0.95, 0.95, 0.98) : new Color3(0.98, 0.98, 1.0)
    }
    if (this.visorMat) {
      this.visorMat.diffuseColor = new Color3(0.04, 0.04, 0.06)
      this.visorMat.specularColor = isLine ? pal.majorContourRgb : new Color3(0.95, 0.85, 0.35)
    }
    if (this.gloveMat) {
      this.gloveMat.diffuseColor = new Color3(0.10, 0.11, 0.14)
    }
    if (this.bootMat) {
      this.bootMat.diffuseColor = new Color3(0.16, 0.19, 0.25)
    }
    if (this.soleMat) {
      this.soleMat.diffuseColor = new Color3(0.95, 0.95, 0.97)
    }
    if (this.toggleMat) {
      this.toggleMat.diffuseColor = new Color3(0.95, 0.24, 0.14)
    }
  }

  public update(sim: ParagliderSimulation, vantage: string = 'pilot-fpv'): void {
    if (sim.currentWingType !== this.currentWingType) {
      this.buildCanopyAndLines(sim.currentWingType)
    }

    const isParamotor = sim.currentWingType === 'paramotor'
    if (this.paramotorNode) {
      this.paramotorNode.setEnabled(isParamotor)
      if (isParamotor && this.propellerMesh) {
        const rpm = sim.telemetry.engineRpm ?? 2000
        const radPerSec = (rpm * 2 * Math.PI) / 60
        this.propellerMesh.rotation.z += radPerSec * 0.016
        if (this.propBlurMat) {
          const blurAlpha = clamp((rpm - 2200) / 4500, 0, 0.45)
          this.propBlurMat.alpha = blurAlpha
        }
      }
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

    const cQ = sim.canopy.quaternion
    const qCanopy = new Quaternion(cQ.x, cQ.y, cQ.z, cQ.w)
    this.canopyRoot.rotationQuaternion = qCanopy

    this.pilotRoot.position.set(
      sim.pilot.position.x,
      sim.pilot.position.y,
      sim.pilot.position.z,
    )

    // Pilot World Orientation: First-Principles "Weight on a String" Law
    // The pilot sits in an under-slung harness suspended from the canopy by the line pyramid.
    // The harness vertical (+Y) axis is physically forced to align with the suspension vector (pilot to canopy).
    // The pilot forward (+Z) axis aligns with the canopy heading, projected perpendicular to the tether.
    const pilotPos = this.pilotRoot.position
    const canopyPos = this.canopyRoot.position
    const tetherVec = canopyPos.subtract(pilotPos)
    const tetherLen = tetherVec.length()

    if (tetherLen > 0.1) {
      const uUp = tetherVec.scale(1.0 / tetherLen) // local +Y along suspension lines to canopy
      
      // Canopy forward direction in world space (+Z rotated by canopy quaternion)
      const canopyFwd = Vector3.TransformCoordinates(new Vector3(0, 0, 1), Matrix.FromQuaternionToRef(qCanopy, this.tempMat1))
      
      // Project canopy forward onto plane perpendicular to uUp
      const fwdDotUp = Vector3.Dot(canopyFwd, uUp)
      let uFwd = canopyFwd.subtract(uUp.scale(fwdDotUp))
      if (uFwd.lengthSquared() < 1e-4) {
        uFwd = Vector3.Cross(uUp, new Vector3(1, 0, 0))
      }
      uFwd.normalize()

      // Right vector: uUp x uFwd
      const uRight = Vector3.Cross(uUp, uFwd).normalize()

      Matrix.FromXYZAxesToRef(uRight, uUp, uFwd, this.tempMat2)
      if (!this.pilotRoot.rotationQuaternion) {
        this.pilotRoot.rotationQuaternion = new Quaternion()
      }
      Quaternion.FromRotationMatrixToRef(this.tempMat2, this.pilotRoot.rotationQuaternion)
    }

    // 180° Reverse Stance Harness Swivel
    const reverseYawRad = (sim.pilot.reverseStanceYawDeg * Math.PI) / 180
    this.pilotBodyPivot.rotation.y = reverseYawRad

    // 2. Anatomical Arm & Dynamic Brake Toggle Articulation
    const leftBrake = sim.controls.leftBrake
    const rightBrake = sim.controls.rightBrake
    const pullingA = sim.controls.pullingA ?? 0
    const pullingB = sim.controls.pullingB ?? 0

    // Compute target hand position in pilot body coordinates
    // Hands up at trim: reaching straight UP overhead to the brake pulleys (Y = 0.88m, X = ±0.28m)
    // When left brake is pulled, left hand travels down along rear riser to hip (Y = 0.08m)
    // The opposite hand stays pinned STRAIGHT UP at 0.88m!
    const computeHandTarget = (side: number, brake: number) => {
      let targetX = side * (0.28 + brake * 0.04)
      let targetY = 0.88 - brake * 0.80
      let targetZ = 0.06 - brake * 0.04

      if (pullingA > 0.05) {
        // Reaching up and pushing forward on A-risers (Speed / Forward Inflation)
        targetX = side * 0.28
        targetY = 0.88 + pullingA * 0.05
        targetZ = 0.06 + pullingA * 0.12
      } else if (pullingB > 0.05) {
        // Reaching up and pulling down on B-risers towards chest (B-Line Stall)
        targetX = side * 0.28
        targetY = 0.88 - pullingB * 0.32
        targetZ = 0.06
      }
      return new Vector3(targetX, targetY, targetZ)
    }

    const targetLeftHand = computeHandTarget(-1, leftBrake)
    const targetRightHand = computeHandTarget(1, rightBrake)

    // Dynamic hand tracking: scales tracking velocity with wrist snap intensity
    const activeBrakeRate = Math.max(Math.abs(sim.controls.leftBrakeRate || 0), Math.abs(sim.controls.rightBrakeRate || 0))
    const handLerpFactor = Math.max(0.35, Math.min(0.95, 0.35 + activeBrakeRate * 0.04))
    this.currentLeftHandPos.x += (targetLeftHand.x - this.currentLeftHandPos.x) * handLerpFactor
    this.currentLeftHandPos.y += (targetLeftHand.y - this.currentLeftHandPos.y) * handLerpFactor
    this.currentLeftHandPos.z += (targetLeftHand.z - this.currentLeftHandPos.z) * handLerpFactor

    this.currentRightHandPos.x += (targetRightHand.x - this.currentRightHandPos.x) * handLerpFactor
    this.currentRightHandPos.y += (targetRightHand.y - this.currentRightHandPos.y) * handLerpFactor
    this.currentRightHandPos.z += (targetRightHand.z - this.currentRightHandPos.z) * handLerpFactor

    this.leftHandNode.position.copyFrom(this.currentLeftHandPos)
    this.rightHandNode.position.copyFrom(this.currentRightHandPos)

    // Solve 2-segment analytical IK: Shoulder -> Upper Arm -> Elbow -> Forearm -> Hand
    const updateArmIK = (
      shoulder: Vector3,
      hand: Vector3,
      side: number,
      upperArmMesh: Mesh,
      forearmMesh: Mesh,
      elbowMesh: Mesh,
    ) => {
      const L1 = 0.27 // Upper arm length
      const L2 = 0.25 // Forearm length
      const diff = hand.subtract(shoulder)
      const D = Math.max(0.08, Math.min(L1 + L2 - 0.005, diff.length()))
      const u = diff.scale(1 / D)

      // Law of cosines for elbow interior angle
      const cosTheta = Math.max(-1, Math.min(1, (L1 * L1 + D * D - L2 * L2) / (2 * L1 * D)))
      const dProj = L1 * cosTheta
      const hElbow = Math.sqrt(Math.max(0, L1 * L1 - dProj * dProj))

      // Preferred elbow flexion plane:
      // When reaching straight UP (hand.y > 0.65), elbow flexes slightly outward and forward
      // When pulling down towards chest/hips, elbow bends naturally outward and back
      const isReachingUp = hand.y > 0.65
      const bend = isReachingUp
        ? new Vector3(side * 0.70, -0.15, -0.25).normalize()
        : new Vector3(side * 0.80, -0.30, -0.45).normalize()

      const dot = Vector3.Dot(bend, u)
      let perp = bend.subtract(u.scale(dot))
      if (perp.lengthSquared() > 0.0001) {
        perp.normalize()
      } else {
        perp = new Vector3(side, 0, 0)
      }

      const elbow = shoulder.add(u.scale(dProj)).add(perp.scale(hElbow))
      elbowMesh.position.copyFrom(elbow)

      // Upper arm: connects shoulder to elbow
      const upperDiff = elbow.subtract(shoulder)
      const upperLen = upperDiff.length()
      if (upperLen > 0.001) {
        const upperDir = upperDiff.scale(1 / upperLen)
        upperArmMesh.position.copyFrom(shoulder.add(elbow).scale(0.5))
        upperArmMesh.scaling.set(1.0, upperLen, 1.0)
        Quaternion.FromUnitVectorsToRef(Vector3.Up(), upperDir, upperArmMesh.rotationQuaternion!)
      }

      // Forearm: connects elbow to hand
      const foreDiff = hand.subtract(elbow)
      const foreLen = foreDiff.length()
      if (foreLen > 0.001) {
        const foreDir = foreDiff.scale(1 / foreLen)
        forearmMesh.position.copyFrom(elbow.add(hand).scale(0.5))
        forearmMesh.scaling.set(1.0, foreLen, 1.0)
        Quaternion.FromUnitVectorsToRef(Vector3.Up(), foreDir, forearmMesh.rotationQuaternion!)
      }
    }

    const leftShoulder = new Vector3(-0.28, 0.44, 0.04)
    const rightShoulder = new Vector3(0.28, 0.44, 0.04)

    updateArmIK(leftShoulder, this.currentLeftHandPos, -1, this.leftUpperArmMesh, this.leftForearmMesh, this.leftElbowMesh)
    updateArmIK(rightShoulder, this.currentRightHandPos, 1, this.rightUpperArmMesh, this.rightForearmMesh, this.rightElbowMesh)

    // 3. Dynamic Leg Articulation (Forward kinematic angles)
    const isDiving = sim.canopy.airspeedKmh > 80
    const isSkimming = sim.isFootDragging

    let targetHipAngle = 0.55  // Seated recline
    let targetKneeAngle = -0.75 // Seated knee flex

    if (isSkimming) {
      targetHipAngle = 0.90   // Extend legs forward & down into sand
      targetKneeAngle = -0.20 // Straighten knees to skim
    } else if (isDiving) {
      targetHipAngle = -0.25  // Tucked back streamlined
      targetKneeAngle = 1.05  // Knees tucked back under harness
    }

    this.leftLegNode.rotation.x += (targetHipAngle - this.leftLegNode.rotation.x) * 0.18
    this.rightLegNode.rotation.x += (targetHipAngle - this.rightLegNode.rotation.x) * 0.18
    this.leftKneeNode.rotation.x += (targetKneeAngle - this.leftKneeNode.rotation.x) * 0.18
    this.rightKneeNode.rotation.x += (targetKneeAngle - this.rightKneeNode.rotation.x) * 0.18

    // 4. Update Dynamic Suspension Lines & Risers
    const pilotLocalPos = this.canopyRoot
      .getWorldMatrix()
      .clone()
      .invert()
    const leftCarabinerWorld = this.leftCarabinerMesh.getAbsolutePosition()
    const rightCarabinerWorld = this.rightCarabinerMesh.getAbsolutePosition()

    const leftCarabinerLocal = Vector3.TransformCoordinates(leftCarabinerWorld, pilotLocalPos)
    const rightCarabinerLocal = Vector3.TransformCoordinates(rightCarabinerWorld, pilotLocalPos)

    const aPullOffset = pullingA * 0.15
    const bPullOffset = pullingB * -0.22

    const leftAApex = leftCarabinerLocal.add(new Vector3(0, 0.55 + aPullOffset, 0.08 + aPullOffset * 0.5))
    const rightAApex = rightCarabinerLocal.add(new Vector3(0, 0.55 + aPullOffset, 0.08 + aPullOffset * 0.5))
    const leftBApex = leftCarabinerLocal.add(new Vector3(0, 0.55 + bPullOffset, 0.00))
    const rightBApex = rightCarabinerLocal.add(new Vector3(0, 0.55 + bPullOffset, 0.00))
    const leftCApex = leftCarabinerLocal.add(new Vector3(0, 0.55, -0.08))
    const rightCApex = rightCarabinerLocal.add(new Vector3(0, 0.55, -0.08))

    const updatedLines: Vector3[][] = []
    for (const pt of this.aLinePoints) {
      updatedLines.push([pt, pt.x < 0 ? leftAApex : rightAApex])
    }
    for (const pt of this.bLinePoints) {
      updatedLines.push([pt, pt.x < 0 ? leftBApex : rightBApex])
    }
    for (const pt of this.cLinePoints) {
      updatedLines.push([pt, pt.x < 0 ? leftCApex : rightCApex])
    }

    if (this.suspensionLinesMesh) {
      MeshBuilder.CreateLineSystem(
        'rig-suspension-lines',
        { lines: updatedLines, instance: this.suspensionLinesMesh },
        this.scene,
      )
    }

    const updatedRisers: Vector3[][] = [
      [leftCarabinerLocal, leftAApex],
      [leftCarabinerLocal, leftBApex],
      [leftCarabinerLocal, leftCApex],
      [rightCarabinerLocal, rightAApex],
      [rightCarabinerLocal, rightBApex],
      [rightCarabinerLocal, rightCApex],
    ]
    if (this.risersMesh) {
      MeshBuilder.CreateLineSystem(
        'rig-risers',
        { lines: updatedRisers, instance: this.risersMesh },
        this.scene,
      )
    }

    const leftHandWorld = this.leftHandNode.getAbsolutePosition()
    const rightHandWorld = this.rightHandNode.getAbsolutePosition()
    const leftHandLocal = Vector3.TransformCoordinates(leftHandWorld, pilotLocalPos)
    const rightHandLocal = Vector3.TransformCoordinates(rightHandWorld, pilotLocalPos)

    const numCells = this.trailingEdgePoints.length > 2 ? this.trailingEdgePoints.length : 32
    const updatedBrakes: Vector3[][] = [
      [this.trailingEdgePoints[2] || new Vector3(-3, 0, 0), leftHandLocal],
      [this.trailingEdgePoints[numCells - 3] || new Vector3(3, 0, 0), rightHandLocal],
    ]
    if (this.brakeLinesMesh) {
      MeshBuilder.CreateLineSystem(
        'rig-brake-lines',
        { lines: updatedBrakes, instance: this.brakeLinesMesh },
        this.scene,
      )
    }
  }

  public dispose(): void {
    this.unsubscribeStyle?.()
    if (this.ribLinesMesh) this.ribLinesMesh.dispose()
    if (this.canopyMesh) this.canopyMesh.dispose()
    if (this.underMesh) this.underMesh.dispose()
    if (this.suspensionLinesMesh) this.suspensionLinesMesh.dispose()
    if (this.risersMesh) this.risersMesh.dispose()
    if (this.brakeLinesMesh) this.brakeLinesMesh.dispose()
  }
}
