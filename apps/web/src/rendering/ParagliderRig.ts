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
  private pilotHeadNode: TransformNode
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

  // Line Networks & Risers (clean screen mode default: lines hidden)
  public showSuspensionLines: boolean = false
  private suspensionLinesMesh!: LinesMesh
  private risersMesh!: LinesMesh
  private brakeLinesMesh!: LinesMesh

  // Aerofoil Rib Paths
  private aLinePoints: Vector3[] = []
  private bLinePoints: Vector3[] = []
  private cLinePoints: Vector3[] = []
  private cellAttachmentPoints: Vector3[] = []
  private trailingEdgePoints: Vector3[] = []

  // Base undeformed ribbon and suspension coordinates for dynamic collapse
  private baseUpperLE: Vector3[] = []
  private baseUpperTE: Vector3[] = []
  private baseLowerLE: Vector3[] = []
  private baseLowerTE: Vector3[] = []
  private deformedUpperLE: Vector3[] = []
  private deformedUpperTE: Vector3[] = []
  private deformedLowerLE: Vector3[] = []
  private deformedLowerTE: Vector3[] = []
  private baseALinePoints: Vector3[] = []
  private baseBLinePoints: Vector3[] = []
  private baseCLinePoints: Vector3[] = []
  private wasCollapsed: boolean = false

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

    // 3. Build Anatomically Proportional Human Character Model
    // Dynamic Head & Helmet Pivot (Articulated to look into turns and apexes)
    this.pilotHeadNode = new TransformNode('pilot-head-node', scene)
    this.pilotHeadNode.position.set(0, 0.52, 0.03)
    this.pilotHeadNode.parent = this.pilotBodyPivot

    // Aerodynamic full-face speed/acro helmet (realistic human head scale ~0.25m)
    this.helmetMesh = MeshBuilder.CreateSphere('pilot-helmet', { diameter: 0.27, segments: 14 }, scene)
    this.helmetMesh.scaling.set(0.92, 1.06, 1.16) // Streamlined aerodynamic oval
    this.helmetMesh.position.set(0, 0.13, 0.01)
    this.helmetMesh.material = this.helmetMat
    this.helmetMesh.parent = this.pilotHeadNode

    // Integrated curved aero visor
    this.visorMesh = MeshBuilder.CreateSphere('pilot-visor', { diameter: 0.24, segments: 12 }, scene)
    this.visorMesh.scaling.set(0.96, 0.48, 0.88)
    this.visorMesh.position.set(0, 0.12, 0.09)
    this.visorMesh.material = this.visorMat
    this.visorMesh.parent = this.pilotHeadNode

    // Full-face aerodynamic chin guard
    const chinGuard = MeshBuilder.CreateBox('pilot-chin-guard', { width: 0.13, height: 0.07, depth: 0.10 }, scene)
    chinGuard.position.set(0, 0.04, 0.08)
    chinGuard.material = this.helmetMat
    chinGuard.parent = this.pilotHeadNode

    // Cervical neck & collar
    this.neckMesh = MeshBuilder.CreateCylinder('pilot-neck', { height: 0.12, diameter: 0.13, tessellation: 12 }, scene)
    this.neckMesh.position.set(0, 0.01, -0.01)
    this.neckMesh.material = skinMat
    this.neckMesh.parent = this.pilotHeadNode

    // Anatomical Athletic Chest & Flight Suit Torso (~0.44m shoulder breadth)
    this.torsoMesh = MeshBuilder.CreateSphere('pilot-chest', { diameter: 0.44, segments: 12 }, scene)
    this.torsoMesh.scaling.set(0.94, 1.22, 0.72)
    this.torsoMesh.position.set(0, 0.28, 0.02)
    this.torsoMesh.rotation.x = 0.22 // Natural athletic seated recline
    this.torsoMesh.material = this.pilotSuitMat
    this.torsoMesh.parent = this.pilotBodyPivot

    // Tapered athletic waist & abdominal core
    const waistMesh = MeshBuilder.CreateCylinder('pilot-waist', { height: 0.16, diameterTop: 0.30, diameterBottom: 0.35, tessellation: 12 }, scene)
    waistMesh.position.set(0, 0.13, 0.01)
    waistMesh.material = this.pilotSuitMat
    waistMesh.parent = this.pilotBodyPivot

    // Modern Seated Acro / Pod Harness Bucket (Supports lumbar & wraps thighs)
    this.harnessMesh = MeshBuilder.CreateSphere('pilot-harness-pod', { diameter: 0.54, segments: 12 }, scene)
    this.harnessMesh.scaling.set(0.88, 0.82, 1.25)
    this.harnessMesh.position.set(0, 0.04, -0.06)
    this.harnessMesh.rotation.x = 0.28
    this.harnessMesh.material = this.pilotSuitMat
    this.harnessMesh.parent = this.pilotBodyPivot

    // Carabiners rigidly mounted at realistic riser hang points
    this.leftCarabinerMesh = MeshBuilder.CreateTorus('carabiner-l', { diameter: 0.095, thickness: 0.018, tessellation: 16 }, scene)
    this.leftCarabinerMesh.position.set(-0.22, 0.36, 0.05)
    this.leftCarabinerMesh.material = metalMat
    this.leftCarabinerMesh.parent = this.pilotBodyPivot

    this.rightCarabinerMesh = MeshBuilder.CreateTorus('carabiner-r', { diameter: 0.095, thickness: 0.018, tessellation: 16 }, scene)
    this.rightCarabinerMesh.position.set(0.22, 0.36, 0.05)
    this.rightCarabinerMesh.material = metalMat
    this.rightCarabinerMesh.parent = this.pilotBodyPivot

    // Anatomical Articulated Arms (Shoulders -> Upper Arms -> Elbows -> Forearms -> Hands -> Brake Toggles)
    // Athletic deltoid shoulders
    const lShoulder = MeshBuilder.CreateSphere('shoulder-l', { diameter: 0.11, segments: 10 }, scene)
    lShoulder.position.set(-0.23, 0.44, 0.03)
    lShoulder.material = this.pilotSuitMat
    lShoulder.parent = this.pilotBodyPivot

    const rShoulder = MeshBuilder.CreateSphere('shoulder-r', { diameter: 0.11, segments: 10 }, scene)
    rShoulder.position.set(0.23, 0.44, 0.03)
    rShoulder.material = this.pilotSuitMat
    rShoulder.parent = this.pilotBodyPivot

    // Upper arm cylinders (oriented dynamically between shoulder and elbow)
    this.leftUpperArmMesh = MeshBuilder.CreateCylinder('upper-arm-l', { height: 1.0, diameter: 0.088, tessellation: 10 }, scene)
    this.leftUpperArmMesh.rotationQuaternion = new Quaternion()
    this.leftUpperArmMesh.material = this.pilotSuitMat
    this.leftUpperArmMesh.parent = this.pilotBodyPivot

    this.rightUpperArmMesh = MeshBuilder.CreateCylinder('upper-arm-r', { height: 1.0, diameter: 0.088, tessellation: 10 }, scene)
    this.rightUpperArmMesh.rotationQuaternion = new Quaternion()
    this.rightUpperArmMesh.material = this.pilotSuitMat
    this.rightUpperArmMesh.parent = this.pilotBodyPivot

    // Articulated anatomical elbow joints
    this.leftElbowMesh = MeshBuilder.CreateSphere('elbow-l', { diameter: 0.082, segments: 8 }, scene)
    this.leftElbowMesh.material = this.pilotSuitMat
    this.leftElbowMesh.parent = this.pilotBodyPivot

    this.rightElbowMesh = MeshBuilder.CreateSphere('elbow-r', { diameter: 0.082, segments: 8 }, scene)
    this.rightElbowMesh.material = this.pilotSuitMat
    this.rightElbowMesh.parent = this.pilotBodyPivot

    // Forearm cylinders (oriented dynamically between elbow and hand)
    this.leftForearmMesh = MeshBuilder.CreateCylinder('forearm-l', { height: 1.0, diameter: 0.076, tessellation: 10 }, scene)
    this.leftForearmMesh.rotationQuaternion = new Quaternion()
    this.leftForearmMesh.material = this.pilotSuitMat
    this.leftForearmMesh.parent = this.pilotBodyPivot

    this.rightForearmMesh = MeshBuilder.CreateCylinder('forearm-r', { height: 1.0, diameter: 0.076, tessellation: 10 }, scene)
    this.rightForearmMesh.rotationQuaternion = new Quaternion()
    this.rightForearmMesh.material = this.pilotSuitMat
    this.rightForearmMesh.parent = this.pilotBodyPivot

    // Hand transform nodes (travel vertically along risers from pulley level down past hips)
    this.currentLeftHandPos = new Vector3(-0.24, 0.86, 0.05)
    this.currentRightHandPos = new Vector3(0.24, 0.86, 0.05)
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
    const numCells = isXc ? 42 : (isParamotor ? 34 : 30)
    const halfSpan = isXc ? 5.1 : (isParamotor ? 4.2 : 3.8)
    const chord = isXc ? 1.85 : (isParamotor ? 1.75 : 1.55)
    const lineDrop = isXc ? -4.6 : (isParamotor ? -3.9 : -3.6)

    const upperRibbon: Vector3[] = []
    const lowerRibbon: Vector3[] = []

    for (let c = 0; c <= numCells; c++) {
      const u = c / numCells
      const x = -halfSpan + u * halfSpan * 2
      const normX = Math.abs(x) / halfSpan

      // Elliptical arch and aerodynamic wingtip sweep
      const archY = (1 - Math.pow(normX, 1.9)) * (isXc ? 1.45 : (isParamotor ? 1.35 : 1.25))
      const sweepZ = Math.pow(normX, 1.7) * (isXc ? 0.75 : (isParamotor ? 0.65 : 0.58))
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

    this.baseUpperLE = upperRibbon.filter((_, idx) => idx % 2 === 0)
    this.baseUpperTE = upperRibbon.filter((_, idx) => idx % 2 === 1)
    this.baseLowerLE = lowerRibbon.filter((_, idx) => idx % 2 === 0)
    this.baseLowerTE = lowerRibbon.filter((_, idx) => idx % 2 === 1)
    this.baseALinePoints = this.aLinePoints.map(p => p.clone())
    this.baseBLinePoints = this.bLinePoints.map(p => p.clone())
    this.baseCLinePoints = this.cLinePoints.map(p => p.clone())

    this.deformedUpperLE = this.baseUpperLE.map(p => p.clone())
    this.deformedUpperTE = this.baseUpperTE.map(p => p.clone())
    this.deformedLowerLE = this.baseLowerLE.map(p => p.clone())
    this.deformedLowerTE = this.baseLowerTE.map(p => p.clone())

    this.canopyMesh = MeshBuilder.CreateRibbon(
      'rig-canopy-top',
      { pathArray: [this.baseUpperLE, this.baseUpperTE], updatable: true },
      this.scene,
    )
    this.canopyMesh.material = isXc
      ? this.canopyTopXcMat
      : (isParamotor ? this.canopyTopParamotorMat : this.canopyTopSpeedMat)
    this.canopyMesh.parent = this.canopyRoot

    this.underMesh = MeshBuilder.CreateRibbon(
      'rig-canopy-under',
      { pathArray: [this.baseLowerLE, this.baseLowerTE], updatable: true },
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

    const build4PtLine = (pt: Vector3, apex: Vector3): Vector3[] => [
      pt.clone(),
      pt.scale(0.66).add(apex.scale(0.34)),
      pt.scale(0.34).add(apex.scale(0.66)),
      apex.clone(),
    ]

    const linesData: Vector3[][] = []
    const lineColors: Color4[][] = []
    const colA = new Color4(0.96, 0.88, 0.88, 1.0)
    const colB = new Color4(0.96, 0.94, 0.82, 1.0)
    const colC = new Color4(0.85, 0.88, 0.94, 1.0)

    for (const pt of this.aLinePoints) {
      linesData.push(build4PtLine(pt, pt.x < 0 ? leftAApex : rightAApex))
      lineColors.push([colA, colA, colA, colA])
    }
    for (const pt of this.bLinePoints) {
      linesData.push(build4PtLine(pt, pt.x < 0 ? leftBApex : rightBApex))
      lineColors.push([colB, colB, colB, colB])
    }
    for (const pt of this.cLinePoints) {
      linesData.push(build4PtLine(pt, pt.x < 0 ? leftCApex : rightCApex))
      lineColors.push([colC, colC, colC, colC])
    }

    this.suspensionLinesMesh = MeshBuilder.CreateLineSystem(
      'rig-suspension-lines',
      { lines: linesData, colors: lineColors, updatable: true },
      this.scene,
    )
    this.suspensionLinesMesh.parent = this.canopyRoot
    this.suspensionLinesMesh.setEnabled(this.showSuspensionLines)

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
    this.risersMesh.setEnabled(this.showSuspensionLines)

    const brakeLinesData: Vector3[][] = [
      build4PtLine(this.trailingEdgePoints[2] || new Vector3(-3, 0, 0), leftCarabinerPos),
      build4PtLine(this.trailingEdgePoints[numCells - 2] || new Vector3(3, 0, 0), rightCarabinerPos),
    ]
    this.brakeLinesMesh = MeshBuilder.CreateLineSystem(
      'rig-brake-lines',
      { lines: brakeLinesData, updatable: true },
      this.scene,
    )
    this.brakeLinesMesh.setEnabled(this.showSuspensionLines)
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

  public setSuspensionLinesVisible(visible: boolean): void {
    this.showSuspensionLines = visible
    if (this.suspensionLinesMesh) this.suspensionLinesMesh.setEnabled(visible)
    if (this.risersMesh) this.risersMesh.setEnabled(visible)
    if (this.brakeLinesMesh) this.brakeLinesMesh.setEnabled(visible)
  }

  public toggleSuspensionLines(): boolean {
    this.setSuspensionLinesVisible(!this.showSuspensionLines)
    return this.showSuspensionLines
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

    // 1. 180° Reverse Stance Harness Swivel & Anatomical Body Leaning into Turns
    const reverseYawRad = (sim.pilot.reverseStanceYawDeg * Math.PI) / 180
    const weightShift = sim.controls.weightShift || 0
    const speedBar = sim.controls.speedBar || 0
    const leftBrake = sim.controls.leftBrake
    const rightBrake = sim.controls.rightBrake
    const symBrake = Math.min(leftBrake, rightBrake)
    const pullingA = sim.controls.pullingA ?? 0
    const pullingB = sim.controls.pullingB ?? 0
    const collapseFrac = sim.telemetry.collapseFrac ?? 0
    const isLinesSlack = sim.telemetry.isLinesSlack ?? (collapseFrac > 0.15)
    const t = performance.now() * 0.001

    // Canopy Ribbon Deformation & Dynamic Collapse Mechanics
    if (collapseFrac > 0.005) {
      this.wasCollapsed = true
      const halfSpan = this.currentWingType === 'paraglider' ? 5.9 : (this.currentWingType === 'paramotor' ? 4.7 : 4.4)

      const deformPoint = (pBase: Vector3, _isUpper: boolean, isLE: boolean): Vector3 => {
        const normX = Math.min(1.0, Math.abs(pBase.x) / halfSpan)
        // Span contraction: wingtips pinch inward into horseshoe shape
        const pinch = 1.0 - collapseFrac * 0.42 * Math.pow(normX, 1.4)
        const x = pBase.x * pinch

        // Vertical collapse: center sags, wingtips fold down dramatically like deflated cloth
        const tipDrop = collapseFrac * (2.8 * Math.pow(normX, 2.2) + 0.6)
        const flutter = Math.sin(t * 22 + pBase.x * 3.2) * (0.12 * collapseFrac)
        const y = pBase.y - tipDrop + flutter

        // Depth crumpling: leading edge rolls downward/backward under airflow detachment
        const leCurl = isLE ? -collapseFrac * 0.38 * (1.0 - normX * 0.4) : collapseFrac * 0.18
        const chordFlutter = Math.cos(t * 18 + pBase.x * 2.8) * (0.08 * collapseFrac)
        const z = pBase.z + leCurl + chordFlutter

        return new Vector3(x, y, z)
      }

      for (let i = 0; i < this.baseUpperLE.length; i++) {
        const pUle = deformPoint(this.baseUpperLE[i], true, true)
        const pUte = deformPoint(this.baseUpperTE[i], true, false)
        const pLle = deformPoint(this.baseLowerLE[i], false, true)
        const pLte = deformPoint(this.baseLowerTE[i], false, false)

        this.deformedUpperLE[i].copyFrom(pUle)
        this.deformedUpperTE[i].copyFrom(pUte)
        this.deformedLowerLE[i].copyFrom(pLle)
        this.deformedLowerTE[i].copyFrom(pLte)
      }

      if (this.canopyMesh) {
        MeshBuilder.CreateRibbon(
          'rig-canopy-top',
          { pathArray: [this.deformedUpperLE, this.deformedUpperTE], instance: this.canopyMesh },
          this.scene,
        )
      }
      if (this.underMesh) {
        MeshBuilder.CreateRibbon(
          'rig-canopy-under',
          { pathArray: [this.deformedLowerLE, this.deformedLowerTE], instance: this.underMesh },
          this.scene,
        )
      }

      // Update cell ribs
      if (this.ribLinesMesh) {
        const numCells = this.deformedUpperLE.length - 1
        const ribLines: Vector3[][] = []
        for (let c = 0; c <= numCells; c++) {
          const topLe = this.deformedUpperLE[c]
          const topTe = this.deformedUpperTE[c]
          const btmTe = this.deformedLowerTE[c]
          const btmLe = this.deformedLowerLE[c]
          ribLines.push([topLe, topTe, btmTe, btmLe, topLe])
        }
        MeshBuilder.CreateLineSystem(
          'rig-cell-ribs',
          { lines: ribLines, instance: this.ribLinesMesh },
          this.scene,
        )
      }

      // Update line attachment points to match deformed under-surface
      for (let k = 0; k < this.aLinePoints.length; k++) {
        const cellIdx = k * 2
        if (cellIdx < this.deformedLowerLE.length) {
          const dle = this.deformedLowerLE[cellIdx]
          const dte = this.deformedLowerTE[cellIdx]
          this.aLinePoints[k].copyFrom(dle.scale(0.85).add(dte.scale(0.15)))
          this.bLinePoints[k].copyFrom(dle.scale(0.40).add(dte.scale(0.60)))
          this.cLinePoints[k].copyFrom(dle.scale(0.08).add(dte.scale(0.92)))
        }
      }
    } else if (this.wasCollapsed) {
      // Instant crisp snap-recovery back to pristine aerodynamic form!
      if (this.canopyMesh) {
        MeshBuilder.CreateRibbon(
          'rig-canopy-top',
          { pathArray: [this.baseUpperLE, this.baseUpperTE], instance: this.canopyMesh },
          this.scene,
        )
      }
      if (this.underMesh) {
        MeshBuilder.CreateRibbon(
          'rig-canopy-under',
          { pathArray: [this.baseLowerLE, this.baseLowerTE], instance: this.underMesh },
          this.scene,
        )
      }
      if (this.ribLinesMesh) {
        const numCells = this.baseUpperLE.length - 1
        const ribLines: Vector3[][] = []
        for (let c = 0; c <= numCells; c++) {
          const topLe = this.baseUpperLE[c]
          const topTe = this.baseUpperTE[c]
          const btmTe = this.baseLowerTE[c]
          const btmLe = this.baseLowerTE[c]
          ribLines.push([topLe, topTe, btmTe, btmLe, topLe])
        }
        MeshBuilder.CreateLineSystem(
          'rig-cell-ribs',
          { lines: ribLines, instance: this.ribLinesMesh },
          this.scene,
        )
      }
      for (let k = 0; k < this.aLinePoints.length; k++) {
        this.aLinePoints[k].copyFrom(this.baseALinePoints[k])
        this.bLinePoints[k].copyFrom(this.baseBLinePoints[k])
        this.cLinePoints[k].copyFrom(this.baseCLinePoints[k])
      }
      this.wasCollapsed = false
    }

    // 1. Natural Anatomical Pilot Articulation in the Harness
    // The pilot is securely seated in the harness bucket suspended directly from the carabiners.
    // Torso weight-shifts naturally into turns without lunging forward or twisting out of the line pyramid!
    const targetBodyRoll = -weightShift * 0.20 // ~11° authentic athletic weight shift
    const targetBodyPosX = -weightShift * 0.05 // 5cm subtle hip shift inside harness
    let targetBodyPitch = symBrake * 0.08 - speedBar * 0.08 // Snug, natural seated recline
    if (collapseFrac > 0.15) {
      targetBodyPitch = 0.15 * collapseFrac
    }
    const targetBodyPosZ = 0 // Securely suspended under carabiners - zero artificial forward lunge!
    const targetBodyYaw = reverseYawRad + weightShift * 0.08 // Torso naturally stays aligned with risers

    // Organic Anatomical Pilot Follow: Smooth athletic weight shift into harness
    const rigDt = clamp(this.scene.getEngine().getDeltaTime() * 0.001 || 0.016, 0.001, 0.05)
    const bodyFollowFactor = Math.min(1.0, 7.5 * rigDt)
    this.pilotBodyPivot.rotation.z += (targetBodyRoll - this.pilotBodyPivot.rotation.z) * bodyFollowFactor
    this.pilotBodyPivot.rotation.x += (targetBodyPitch - this.pilotBodyPivot.rotation.x) * bodyFollowFactor
    this.pilotBodyPivot.rotation.y += (targetBodyYaw - this.pilotBodyPivot.rotation.y) * bodyFollowFactor
    this.pilotBodyPivot.position.x += (targetBodyPosX - this.pilotBodyPivot.position.x) * bodyFollowFactor
    this.pilotBodyPivot.position.z += (targetBodyPosZ - this.pilotBodyPivot.position.z) * bodyFollowFactor

    // Dynamic Head Tracking: Pilot smoothly looks through the turn apex
    const targetHeadYaw = weightShift * 0.45 // ~26° head rotation looking through apex
    const targetHeadPitch = -sim.telemetry.verticalSpeedMps * 0.02
    const headFollowFactor = Math.min(1.0, 8.5 * rigDt)
    this.pilotHeadNode.rotation.y += (targetHeadYaw - this.pilotHeadNode.rotation.y) * headFollowFactor
    this.pilotHeadNode.rotation.x += (targetHeadPitch - this.pilotHeadNode.rotation.x) * headFollowFactor

    // 2. Anatomical Arm & Dynamic Brake Toggle Articulation
    // Hands up at trim: reaching straight UP overhead to brake pulleys (Y = 0.86m, X = ±0.24m)
    // Pulling down: inside hand drives all the way down past the hip/seatboard (Y ~ 0.04m)
    const computeHandTarget = (side: number, brake: number) => {
      let targetX = side * (0.24 + brake * 0.05)
      let targetY = 0.86 - brake * 0.82
      let targetZ = 0.05 - brake * 0.06

      if (collapseFrac > 0.15) {
        // In freefall, arms drop limp as lines go slack
        targetY = 0.86 - 0.52 * collapseFrac
        targetX = side * (0.24 - 0.06 * collapseFrac)
        targetZ = 0.05 - 0.08 * collapseFrac
      } else {
        // Dynamic riser reach when that hand's brake toggle is released
        if (brake < 0.20 && (pullingA > 0.05 || speedBar > 0.05)) {
          const pushFrac = Math.max(pullingA, speedBar) * (1.0 - brake / 0.20)
          targetZ += pushFrac * 0.14
          targetY += pushFrac * 0.04
        } else if (brake < 0.20 && pullingB > 0.05) {
          const pullFrac = pullingB * (1.0 - brake / 0.20)
          targetY -= pullFrac * 0.30
        }
      }
      return new Vector3(targetX, targetY, targetZ)
    }

    const targetLeftHand = computeHandTarget(-1, leftBrake)
    const targetRightHand = computeHandTarget(1, rightBrake)

    // Instant Real-Time Arm Tracking:
    const handLerpFactor = 0.95
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
      const L1 = 0.29 // Upper arm length
      const L2 = 0.26 // Forearm length
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

    const leftShoulder = new Vector3(-0.23, 0.44, 0.03)
    const rightShoulder = new Vector3(0.23, 0.44, 0.03)

    updateArmIK(leftShoulder, this.currentLeftHandPos, -1, this.leftUpperArmMesh, this.leftForearmMesh, this.leftElbowMesh)
    updateArmIK(rightShoulder, this.currentRightHandPos, 1, this.rightUpperArmMesh, this.rightForearmMesh, this.rightElbowMesh)

    // 3. Dynamic Leg Articulation (Forward kinematic angles & Speedbar Extension)
    const isDiving = sim.canopy.airspeedKmh > 75 || speedBar > 0.3
    const isSkimming = sim.isFootDragging

    let targetHipAngle = 0.55  // Seated recline
    let targetKneeAngle = -0.75 // Seated knee flex

    if (collapseFrac > 0.15) {
      // Freefall plunge: legs dangle loose vertically with air resistance
      targetHipAngle = 0.20 * (1 - collapseFrac)
      targetKneeAngle = -0.30 * (1 - collapseFrac)
    } else if (speedBar > 0.05) {
      // Speedbar push: legs extend forward smoothly to press the stirrup, maintaining athletic knee flex
      targetHipAngle = 0.58 + speedBar * 0.18
      targetKneeAngle = -0.70 + speedBar * 0.35
    } else if (symBrake > 0.20) {
      // Dynamic flare: pilot sits back into harness with knees flexed
      targetHipAngle = 0.48 - symBrake * 0.12
      targetKneeAngle = -0.80
    } else if (isSkimming) {
      targetHipAngle = 0.75   // Extend legs down towards terrain
      targetKneeAngle = -0.35 // Slightly straightened knees to skim
    } else if (isDiving) {
      targetHipAngle = 0.64
      targetKneeAngle = -0.45
    }

    // Carve Leg Asymmetry: inside leg relaxes slightly, outside leg extends to brace against harness
    const legAsymmetry = weightShift * 0.22
    const targetLeftHip = targetHipAngle - legAsymmetry
    const targetRightHip = targetHipAngle + legAsymmetry

    const legFollowFactor = 0.80 // Snappy, responsive leg kinematics!
    this.leftLegNode.rotation.x += (targetLeftHip - this.leftLegNode.rotation.x) * legFollowFactor
    this.rightLegNode.rotation.x += (targetRightHip - this.rightLegNode.rotation.x) * legFollowFactor
    this.leftKneeNode.rotation.x += (targetKneeAngle - this.leftKneeNode.rotation.x) * legFollowFactor
    this.rightKneeNode.rotation.x += (targetKneeAngle - this.rightKneeNode.rotation.x) * legFollowFactor

    // 4. Update Dynamic Suspension Lines & Risers (if visible)
    if (!this.showSuspensionLines) {
      if (this.suspensionLinesMesh && this.suspensionLinesMesh.isEnabled()) this.suspensionLinesMesh.setEnabled(false)
      if (this.risersMesh && this.risersMesh.isEnabled()) this.risersMesh.setEnabled(false)
      if (this.brakeLinesMesh && this.brakeLinesMesh.isEnabled()) this.brakeLinesMesh.setEnabled(false)
      return
    }

    if (this.suspensionLinesMesh && !this.suspensionLinesMesh.isEnabled()) this.suspensionLinesMesh.setEnabled(true)
    if (this.risersMesh && !this.risersMesh.isEnabled()) this.risersMesh.setEnabled(true)
    if (this.brakeLinesMesh && !this.brakeLinesMesh.isEnabled()) this.brakeLinesMesh.setEnabled(true)

    // Synchronize world matrices before computing local carabiner attachment points
    this.canopyRoot.computeWorldMatrix(true)
    this.pilotRoot.computeWorldMatrix(true)
    this.leftCarabinerMesh.computeWorldMatrix(true)
    this.rightCarabinerMesh.computeWorldMatrix(true)

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

    const buildDynamic4PtLine = (pt: Vector3, apex: Vector3): Vector3[] => {
      const mid1 = pt.scale(0.66).add(apex.scale(0.34))
      const mid2 = pt.scale(0.34).add(apex.scale(0.66))
      if (isLinesSlack || collapseFrac > 0.08) {
        // Line slack catenary sag and flutter wave!
        const sag = Math.max(0.25, collapseFrac * 1.1)
        const wave1 = Math.sin(t * 18 + pt.x * 2.8) * 0.14 * sag
        const wave2 = Math.cos(t * 22 + pt.x * 2.8) * 0.16 * sag
        mid1.y -= sag * 0.55
        mid1.x += wave1
        mid1.z += wave2
        mid2.y -= sag * 0.75
        mid2.x -= wave2
        mid2.z += wave1
      }
      return [pt, mid1, mid2, apex]
    }

    const updatedLines: Vector3[][] = []
    for (const pt of this.aLinePoints) {
      updatedLines.push(buildDynamic4PtLine(pt, pt.x < 0 ? leftAApex : rightAApex))
    }
    for (const pt of this.bLinePoints) {
      updatedLines.push(buildDynamic4PtLine(pt, pt.x < 0 ? leftBApex : rightBApex))
    }
    for (const pt of this.cLinePoints) {
      updatedLines.push(buildDynamic4PtLine(pt, pt.x < 0 ? leftCApex : rightCApex))
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
    const ptL = this.trailingEdgePoints[2] || new Vector3(-3, 0, 0)
    const ptR = this.trailingEdgePoints[numCells - 3] || new Vector3(3, 0, 0)
    const updatedBrakes: Vector3[][] = [
      buildDynamic4PtLine(ptL, leftHandLocal),
      buildDynamic4PtLine(ptR, rightHandLocal),
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
