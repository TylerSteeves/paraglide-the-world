import { Color3, Color4 } from '@babylonjs/core/Maths/math.color'
import { Vector3, Quaternion, Matrix } from '@babylonjs/core/Maths/math.vector'
import { Material } from '@babylonjs/core/Materials/material'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { LinesMesh } from '@babylonjs/core/Meshes/linesMesh'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Scene } from '@babylonjs/core/scene'
import '@babylonjs/core/Rendering/edgesRenderer'
import type { ParagliderSimulation } from '../physics/pendulum'
import type { WingKind } from '../physics/types'
import { clamp } from '../physics/vecmath'
import { ArticulatedPilot } from './ArticulatedPilot'
import { LnPalette, LnStyleManager } from './LnStyleManager'
import type { PilotSkin } from '../progression/PilotWardrobe'

export class ParagliderRig {
  private scene: Scene
  private canopyRoot: TransformNode
  private pilotRoot: TransformNode
  private pilotBodyPivot: TransformNode

  // Glider 3D Mesh
  private canopyMesh: Mesh | null = null
  private underMesh: Mesh | null = null
  public currentWingType: WingKind = 'paraglider'
  private canopyTopSpeedMat!: StandardMaterial
  private canopyTopXcMat!: StandardMaterial
  private canopyTopParamotorMat!: StandardMaterial
  private canopyUnderMat!: StandardMaterial
  private canopyUnderParamotorMat!: StandardMaterial
  private lineCanopyMat!: StandardMaterial
  private sailMat!: StandardMaterial
  private sailFrameMat!: StandardMaterial
  private ribLinesMesh: LinesMesh | null = null
  private leadingEdgeMesh: Mesh | null = null
  private trailingEdgeMesh: Mesh | null = null
  private sailBattens: Mesh[] = []
  private sailBattenTs: number[] = []
  private sailChordSpars: Mesh[] = []
  private sailChordCells: number[] = []

  // Hydrogen jet pack
  private paramotorNode!: TransformNode
  private drogueRoot!: TransformNode

  // Steampunk Blue Hydrogen Thrusters & Plasma Flames
  private flameMeshL!: Mesh
  private flameMeshR!: Mesh
  private thrusterBellL!: Mesh
  private thrusterBellR!: Mesh
  private flameMat!: StandardMaterial
  private h2CoreMat!: StandardMaterial
  private brassMat!: StandardMaterial
  private copperMat!: StandardMaterial

  // Stylized Articulated Pilot
  private pilotHeadNode: TransformNode
  private helmetMesh: Mesh
  private visorMesh: Mesh
  private travelerKit!: TransformNode
  private airmanBack: Mesh | null = null
  private airmanFront: Mesh | null = null
  private airmanSuit: Mesh | null = null
  private sculptedPilot: Mesh[] = []
  private neckMesh: Mesh
  private torsoMesh: Mesh
  private harnessMesh: Mesh
  private leftCarabinerMesh: Mesh
  private rightCarabinerMesh: Mesh
  private tempMat1: Matrix = new Matrix()
  private tempMat2: Matrix = new Matrix()
  private pilotSuitMat!: StandardMaterial
  private equippedSkin: PilotSkin | null = null
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
  private currentLeftHandPos: Vector3 = new Vector3(-0.26, 0.96, 0.06)
  private currentRightHandPos: Vector3 = new Vector3(0.26, 0.96, 0.06)
  private leftLegNode: TransformNode
  private rightLegNode: TransformNode
  private leftKneeNode: TransformNode
  private rightKneeNode: TransformNode
  private leftAnkleNode: TransformNode
  private rightAnkleNode: TransformNode
  private leftToggle: Mesh
  private rightToggle: Mesh
  private figure!: ArticulatedPilot
  // Same anchors the arm IK reaches for. Shoulder y sits on the jacket, not the old squat chest.
  private readonly shoulderL = new Vector3(-0.22, 0.46, 0.03)
  private readonly shoulderR = new Vector3(0.22, 0.46, 0.03)

  // Line Networks & Risers (visible by default for authentic tethered paragliding feel)
  public showSuspensionLines: boolean = false
  public pilotVisible: boolean = true
  private suspensionLinesMesh: LinesMesh | null = null
  private risersMesh: LinesMesh | null = null
  private brakeLinesMesh: LinesMesh | null = null

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

    this.lineCanopyMat = new StandardMaterial('canopy-line-mat', scene)
    this.lineCanopyMat.diffuseColor = new Color3(0.96, 0.95, 0.92)
    this.lineCanopyMat.backFaceCulling = false

    // Clear sail: sun through silk, the city showing through the cloth.
    this.sailMat = new StandardMaterial('clear-sail-mat', scene)
    this.sailMat.diffuseColor = new Color3(0.93, 0.9, 0.82)
    this.sailMat.emissiveColor = new Color3(0.38, 0.28, 0.14)
    this.sailMat.specularColor = new Color3(0.9, 0.74, 0.42)
    this.sailMat.specularPower = 28
    this.sailMat.alpha = 0.34
    this.sailMat.backFaceCulling = false
    this.sailMat.twoSidedLighting = true
    this.sailMat.disableDepthWrite = true
    this.sailMat.transparencyMode = Material.MATERIAL_ALPHABLEND

    this.sailFrameMat = new StandardMaterial('sail-frame-mat', scene)
    this.sailFrameMat.diffuseColor = new Color3(0.8, 0.46, 0.2)
    this.sailFrameMat.emissiveColor = new Color3(0.32, 0.14, 0.04)
    this.sailFrameMat.specularColor = new Color3(0.95, 0.68, 0.34)
    this.sailFrameMat.specularPower = 24
    this.sailFrameMat.backFaceCulling = false

    // Pilot Suit & Gear Materials
    this.pilotSuitMat = new StandardMaterial('pilot-suit-mat', scene)
    this.pilotSuitMat.diffuseColor = new Color3(0.86, 0.4, 0.14)
    this.pilotSuitMat.emissiveColor = new Color3(0.17, 0.08, 0.03)
    this.pilotSuitMat.specularColor = new Color3(0.06, 0.06, 0.06)

    this.helmetMat = new StandardMaterial('helmet-mat', scene)
    this.helmetMat.diffuseColor = new Color3(0.93, 0.9, 0.82)
    this.helmetMat.emissiveColor = new Color3(0.19, 0.18, 0.16)
    this.helmetMat.specularColor = new Color3(0.16, 0.12, 0.08)

    this.visorMat = new StandardMaterial('visor-mat', scene)
    this.visorMat.diffuseColor = new Color3(0.06, 0.07, 0.08)
    this.visorMat.emissiveColor = new Color3(0.16, 0.08, 0.02)
    this.visorMat.specularColor = new Color3(0.9, 0.72, 0.28)
    this.visorMat.alpha = 1

    const skinMat = new StandardMaterial('skin-mat', scene)
    skinMat.diffuseColor = new Color3(0.8, 0.62, 0.48)
    skinMat.specularColor = new Color3(0.08, 0.06, 0.05)
    skinMat.emissiveColor = new Color3(0.05, 0.03, 0.02)

    const hairMat = new StandardMaterial('pilot-hair-mat', scene)
    hairMat.diffuseColor = new Color3(0.62, 0.6, 0.56)
    hairMat.specularColor = new Color3(0.06, 0.06, 0.06)
    hairMat.emissiveColor = new Color3(0.05, 0.05, 0.045)

    const scarfMat = new StandardMaterial('pilot-scarf-mat', scene)
    scarfMat.diffuseColor = new Color3(0.86, 0.82, 0.7)
    scarfMat.specularColor = new Color3(0.06, 0.05, 0.04)

    const leatherMat = new StandardMaterial('pilot-leather-mat', scene)
    leatherMat.diffuseColor = new Color3(0.38, 0.22, 0.12)
    leatherMat.specularColor = new Color3(0.14, 0.09, 0.05)

    const metalMat = new StandardMaterial('metal-mat', scene)
    metalMat.diffuseColor = new Color3(0.85, 0.88, 0.94) // Anodized aluminum carabiners
    metalMat.specularColor = new Color3(0.95, 0.95, 0.95)

    this.bootMat = new StandardMaterial('boot-mat', scene)
    this.bootMat.diffuseColor = new Color3(0.48, 0.27, 0.13)
    this.bootMat.emissiveColor = new Color3(0.1, 0.05, 0.03)
    this.bootMat.specularColor = new Color3(0.1, 0.1, 0.1)

    const sockMat = new StandardMaterial('sock-mat', scene)
    sockMat.diffuseColor = new Color3(0.42, 0.36, 0.3) // Wool sock above the boot

    this.soleMat = new StandardMaterial('sole-mat', scene)
    this.soleMat.diffuseColor = new Color3(0.18, 0.12, 0.08) // Leather boot sole
    this.soleMat.specularColor = new Color3(0.08, 0.06, 0.04)

    this.gloveMat = new StandardMaterial('glove-mat', scene)
    this.gloveMat.diffuseColor = new Color3(0.36, 0.22, 0.13) // Leather flight gloves
    this.gloveMat.specularColor = new Color3(0.1, 0.08, 0.05)

    this.toggleMat = new StandardMaterial('toggle-mat', scene)
    this.toggleMat.diffuseColor = new Color3(0.96, 0.24, 0.14) // Paraglider red brake toggle loops
    this.toggleMat.specularColor = new Color3(0.4, 0.4, 0.4)

    // Steampunk Brass & Copper Materials
    this.brassMat = new StandardMaterial('steampunk-brass-mat', scene)
    this.brassMat.diffuseColor = new Color3(0.85, 0.65, 0.22)
    this.brassMat.specularColor = new Color3(0.95, 0.85, 0.45)

    this.copperMat = new StandardMaterial('steampunk-copper-mat', scene)
    this.copperMat.diffuseColor = new Color3(0.78, 0.42, 0.22)
    this.copperMat.specularColor = new Color3(0.85, 0.55, 0.35)

    // Cryogenic Hydrogen Energy Core & Neon Blue Plasma Flame Materials
    this.h2CoreMat = new StandardMaterial('h2-core-mat', scene)
    this.h2CoreMat.diffuseColor = new Color3(0.05, 0.75, 0.95)
    this.h2CoreMat.emissiveColor = new Color3(0.15, 0.85, 1.0)
    this.h2CoreMat.specularColor = new Color3(0.95, 0.95, 1.0)
    this.h2CoreMat.alpha = 0.88

    this.flameMat = new StandardMaterial('h2-plasma-flame-mat', scene)
    this.flameMat.diffuseColor = new Color3(0.55, 0.9, 1)
    this.flameMat.emissiveColor = new Color3(0.25, 0.75, 1)
    this.flameMat.specularColor = new Color3(0, 0, 0)
    this.flameMat.alpha = 0.7
    this.flameMat.backFaceCulling = false

    // The flight starts under the chute. The suit is a pickup.
    this.buildCanopyAndLines('paraglider')

    // Subscribe to line-art style manager
    this.unsubscribeStyle = LnStyleManager.getInstance().subscribe((palette) => {
      this.applyPalette(palette)
    })

    // 3. Build Anatomically Proportional Human Character Model
    // Dynamic Head & Helmet Pivot (Articulated to look into turns and apexes)
    this.pilotHeadNode = new TransformNode('pilot-head-node', scene)
    this.pilotHeadNode.position.set(0, 0.58, 0.03)
    this.pilotHeadNode.parent = this.pilotBodyPivot

    // Leather flying cap. It sits back so the face, beard, and goggles read in profile.
    this.helmetMesh = MeshBuilder.CreateSphere('pilot-helmet', { diameter: 0.26, segments: 14 }, scene)
    this.helmetMesh.scaling.set(1.02, 0.78, 0.92)
    this.helmetMesh.position.set(0, 0.16, -0.03)
    this.helmetMesh.material = this.helmetMat
    this.helmetMesh.parent = this.pilotHeadNode

    for (const side of [-1, 1]) {
      const flap = MeshBuilder.CreateSphere(`pilot-ear-flap-${side}`, { diameter: 0.09, segments: 8 }, scene)
      flap.scaling.set(0.42, 0.95, 0.7)
      flap.position.set(side * 0.11, 0.1, -0.01)
      flap.material = this.helmetMat
      flap.parent = this.pilotHeadNode
    }

    const hairLock = MeshBuilder.CreateCylinder('pilot-hair-lock', { height: 0.16, diameterTop: 0.015, diameterBottom: 0.07, tessellation: 8 }, scene)
    hairLock.rotation.x = -0.9
    hairLock.rotation.z = 0.25
    hairLock.position.set(0.03, 0.27, -0.05)
    hairLock.material = hairMat
    hairLock.parent = this.pilotHeadNode
    for (const [name, x, y, z, d] of [
      ['a', -0.05, 0.24, -0.08, 0.1],
      ['b', 0.06, 0.22, -0.1, 0.09],
      ['c', 0.0, 0.27, -0.02, 0.08],
    ] as const) {
      const clump = MeshBuilder.CreateSphere(`pilot-hair-${name}`, { diameter: d, segments: 6 }, scene)
      clump.position.set(x, y, z)
      clump.material = hairMat
      clump.parent = this.pilotHeadNode
    }

    const face = MeshBuilder.CreateSphere('pilot-face', { diameter: 0.16, segments: 12 }, scene)
    face.scaling.set(0.92, 1.05, 0.82)
    face.position.set(0, 0.09, 0.055)
    face.material = skinMat
    face.parent = this.pilotHeadNode

    const nose = MeshBuilder.CreateSphere('pilot-nose', { diameter: 0.038, segments: 8 }, scene)
    nose.scaling.set(0.8, 0.9, 1.15)
    nose.position.set(0, 0.1, 0.125)
    nose.material = skinMat
    nose.parent = this.pilotHeadNode

    // Goggle rims stay brass when a city suit recolors the coat and the cap.
    const goggleY = 0.125
    const goggleZ = 0.112
    this.visorMesh = MeshBuilder.CreateSphere('pilot-visor', { diameter: 0.052, segments: 10 }, scene)
    this.visorMesh.scaling.set(1, 1, 0.38)
    this.visorMesh.position.set(-0.042, goggleY, goggleZ + 0.006)
    this.visorMesh.material = this.visorMat
    this.visorMesh.parent = this.pilotHeadNode
    const lensR = MeshBuilder.CreateSphere('pilot-goggle-lens-r', { diameter: 0.052, segments: 10 }, scene)
    lensR.scaling.set(1, 1, 0.38)
    lensR.position.set(0.042, goggleY, goggleZ + 0.006)
    lensR.material = this.visorMat
    lensR.parent = this.pilotHeadNode
    for (const side of [-1, 1]) {
      const rim = MeshBuilder.CreateTorus(`pilot-goggle-rim-${side}`, { diameter: 0.068, thickness: 0.012, tessellation: 14 }, scene)
      rim.position.set(side * 0.042, goggleY, goggleZ)
      rim.material = this.brassMat
      rim.parent = this.pilotHeadNode
    }
    const goggleStrap = MeshBuilder.CreateBox('pilot-goggle-strap', { width: 0.2, height: 0.016, depth: 0.14 }, scene)
    goggleStrap.position.set(0, 0.23, -0.02)
    goggleStrap.material = leatherMat
    goggleStrap.parent = this.pilotHeadNode
    const goggleBridge = MeshBuilder.CreateBox('pilot-goggle-bridge', { width: 0.028, height: 0.012, depth: 0.012 }, scene)
    goggleBridge.position.set(0, goggleY, goggleZ)
    goggleBridge.material = this.brassMat
    goggleBridge.parent = this.pilotHeadNode

    const beard = MeshBuilder.CreateSphere('pilot-beard', { diameter: 0.12, segments: 10 }, scene)
    beard.scaling.set(1.05, 1.15, 0.72)
    beard.position.set(0, 0.02, 0.07)
    beard.material = hairMat
    beard.parent = this.pilotHeadNode
    const beardTip = MeshBuilder.CreateSphere('pilot-beard-tip', { diameter: 0.07, segments: 8 }, scene)
    beardTip.position.set(0, -0.03, 0.06)
    beardTip.material = hairMat
    beardTip.parent = this.pilotHeadNode
    const mustache = MeshBuilder.CreateSphere('pilot-mustache', { diameter: 0.055, segments: 8 }, scene)
    mustache.scaling.set(1.7, 0.45, 0.7)
    mustache.position.set(0, 0.075, 0.115)
    mustache.material = hairMat
    mustache.parent = this.pilotHeadNode

    // Cervical neck, wrapped by the scarf. One tail hangs off the shoulder.
    this.neckMesh = MeshBuilder.CreateCylinder('pilot-neck', { height: 0.12, diameter: 0.13, tessellation: 12 }, scene)
    this.neckMesh.position.set(0, 0.01, -0.01)
    this.neckMesh.material = skinMat
    this.neckMesh.parent = this.pilotHeadNode

    const scarf = MeshBuilder.CreateTorus('pilot-scarf', { diameter: 0.2, thickness: 0.042, tessellation: 12 }, scene)
    scarf.scaling.set(1.05, 0.62, 1.05)
    scarf.position.set(0, 0.0, 0.02)
    scarf.material = scarfMat
    scarf.parent = this.pilotHeadNode
    const scarfTail = MeshBuilder.CreateBox('pilot-scarf-tail', { width: 0.07, height: 0.24, depth: 0.02 }, scene)
    scarfTail.rotation.z = 0.45
    scarfTail.rotation.x = 0.3
    scarfTail.position.set(0.1, -0.1, -0.04)
    scarfTail.material = scarfMat
    scarfTail.parent = this.pilotHeadNode

    // Anatomical Athletic Chest & Flight Suit Torso (~0.44m shoulder breadth)
    this.torsoMesh = MeshBuilder.CreateSphere('pilot-chest', { diameter: 0.44, segments: 12 }, scene)
    this.torsoMesh.scaling.set(0.94, 1.22, 0.72)
    this.torsoMesh.position.set(0, 0.28, 0.02)
    this.torsoMesh.rotation.x = 0.22 // Natural athletic seated recline
    this.torsoMesh.material = this.pilotSuitMat
    this.torsoMesh.parent = this.pilotBodyPivot

    // Sculpted chest impact plate
    const chestPlate = MeshBuilder.CreateBox('pilot-chest-plate', { width: 0.26, height: 0.22, depth: 0.05 }, scene)
    chestPlate.position.set(0, 0.29, 0.17)
    chestPlate.rotation.x = 0.22
    chestPlate.material = this.pilotSuitMat
    chestPlate.parent = this.pilotBodyPivot

    // Cross harness nylon webbing straps & center buckle
    const strapL = MeshBuilder.CreateBox('pilot-strap-l', { width: 0.038, height: 0.30, depth: 0.035 }, scene)
    strapL.position.set(-0.10, 0.31, 0.16)
    strapL.rotation.z = -0.24
    strapL.rotation.x = 0.22
    strapL.material = this.gloveMat
    strapL.parent = this.pilotBodyPivot

    const strapR = MeshBuilder.CreateBox('pilot-strap-r', { width: 0.038, height: 0.30, depth: 0.035 }, scene)
    strapR.position.set(0.10, 0.31, 0.16)
    strapR.rotation.z = 0.24
    strapR.rotation.x = 0.22
    strapR.material = this.gloveMat
    strapR.parent = this.pilotBodyPivot

    const centerBuckle = MeshBuilder.CreateBox('pilot-center-buckle', { width: 0.07, height: 0.06, depth: 0.03 }, scene)
    centerBuckle.position.set(0, 0.30, 0.20)
    centerBuckle.material = this.brassMat
    centerBuckle.parent = this.pilotBodyPivot

    for (const side of [-1, 1]) {
      const lapel = MeshBuilder.CreateBox(`pilot-lapel-${side}`, { width: 0.045, height: 0.2, depth: 0.018 }, scene)
      lapel.position.set(side * 0.07, 0.34, 0.185)
      lapel.rotation.z = side * -0.45
      lapel.rotation.x = 0.22
      lapel.material = this.pilotSuitMat
      lapel.parent = this.pilotBodyPivot
    }
    for (let i = 0; i < 4; i++) {
      const button = MeshBuilder.CreateSphere(`pilot-button-${i}`, { diameter: 0.022, segments: 6 }, scene)
      button.position.set(0, 0.4 - i * 0.055, 0.205)
      button.material = this.brassMat
      button.parent = this.pilotBodyPivot
    }
    const watch = MeshBuilder.CreateCylinder('pilot-watch', { height: 0.012, diameter: 0.05, tessellation: 12 }, scene)
    watch.rotation.x = Math.PI / 2
    watch.position.set(0.09, 0.27, 0.2)
    watch.material = this.brassMat
    watch.parent = this.pilotBodyPivot

    // Tapered athletic waist & abdominal core
    const waistMesh = MeshBuilder.CreateCylinder('pilot-waist', { height: 0.16, diameterTop: 0.30, diameterBottom: 0.35, tessellation: 12 }, scene)
    waistMesh.position.set(0, 0.13, 0.01)
    waistMesh.material = this.pilotSuitMat
    waistMesh.parent = this.pilotBodyPivot

    // Modern Seated Acro / Pod Harness Bucket (Supports lumbar & wraps thighs)
    this.harnessMesh = MeshBuilder.CreateSphere('pilot-harness-pod', { diameter: 0.5, segments: 12 }, scene)
    this.harnessMesh.scaling.set(0.82, 0.5, 1.02)
    this.harnessMesh.position.set(0, -0.02, -0.02)
    this.harnessMesh.rotation.x = 0.2
    this.harnessMesh.material = leatherMat
    this.harnessMesh.parent = this.pilotBodyPivot

    for (const side of [-1, 1]) {
      const tail = MeshBuilder.CreateBox(`pilot-coat-tail-${side}`, { width: 0.11, height: 0.26, depth: 0.016 }, scene)
      tail.position.set(side * 0.08, 0.02, -0.15)
      tail.rotation.x = 0.4
      tail.material = this.pilotSuitMat
      tail.parent = this.pilotBodyPivot
    }

    const satchel = MeshBuilder.CreateBox('pilot-satchel', { width: 0.13, height: 0.15, depth: 0.07 }, scene)
    satchel.position.set(-0.26, 0.16, 0.02)
    satchel.rotation.z = 0.12
    satchel.material = leatherMat
    satchel.parent = this.pilotBodyPivot
    const satchelFlap = MeshBuilder.CreateBox('pilot-satchel-flap', { width: 0.13, height: 0.05, depth: 0.016 }, scene)
    satchelFlap.position.set(-0.26, 0.22, 0.05)
    satchelFlap.rotation.x = -0.5
    satchelFlap.material = leatherMat
    satchelFlap.parent = this.pilotBodyPivot
    const satchelBuckle = MeshBuilder.CreateSphere('pilot-satchel-buckle', { diameter: 0.028, segments: 6 }, scene)
    satchelBuckle.position.set(-0.26, 0.2, 0.06)
    satchelBuckle.material = this.brassMat
    satchelBuckle.parent = this.pilotBodyPivot

    // Bedroll on the back while dropping. The hydrogen pack takes this spot under the chute.
    this.travelerKit = new TransformNode('traveler-kit', scene)
    this.travelerKit.parent = this.pilotBodyPivot
    const bedroll = MeshBuilder.CreateCylinder('pilot-bedroll', { height: 0.36, diameter: 0.11, tessellation: 12 }, scene)
    bedroll.rotation.z = Math.PI / 2
    bedroll.position.set(0, 0.4, -0.2)
    bedroll.material = leatherMat
    bedroll.parent = this.travelerKit
    const bedrollStrap = MeshBuilder.CreateBox('pilot-bedroll-strap', { width: 0.4, height: 0.016, depth: 0.03 }, scene)
    bedrollStrap.position.set(0, 0.4, -0.2)
    bedrollStrap.material = this.pilotSuitMat
    bedrollStrap.parent = this.travelerKit

    // Carabiners rigidly mounted at realistic riser hang points
    this.leftCarabinerMesh = MeshBuilder.CreateTorus('carabiner-l', { diameter: 0.095, thickness: 0.018, tessellation: 16 }, scene)
    this.leftCarabinerMesh.position.set(-0.12, 0.34, 0.16)
    this.leftCarabinerMesh.material = metalMat
    this.leftCarabinerMesh.parent = this.pilotBodyPivot

    this.rightCarabinerMesh = MeshBuilder.CreateTorus('carabiner-r', { diameter: 0.095, thickness: 0.018, tessellation: 16 }, scene)
    this.rightCarabinerMesh.position.set(0.12, 0.34, 0.16)
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
    this.currentLeftHandPos = new Vector3(-0.26, 0.96, 0.06)
    this.currentRightHandPos = new Vector3(0.26, 0.96, 0.06)
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

    for (const hand of [this.leftHandNode, this.rightHandNode]) {
      const band = MeshBuilder.CreateTorus(`glove-band-${hand.name}`, { diameter: 0.072, thickness: 0.01, tessellation: 10 }, scene)
      band.rotation.x = Math.PI / 2
      band.position.y = 0.045
      band.material = this.brassMat
      band.parent = hand
    }

    // Brake toggle handles (gripped in pilot hands)
    this.leftToggle = MeshBuilder.CreateTorus('toggle-l', { diameter: 0.085, thickness: 0.016, tessellation: 16 }, scene)
    this.leftToggle.rotation.x = Math.PI * 0.5
    this.leftToggle.material = this.toggleMat
    this.leftToggle.parent = this.leftHandNode

    this.rightToggle = MeshBuilder.CreateTorus('toggle-r', { diameter: 0.085, thickness: 0.016, tessellation: 16 }, scene)
    this.rightToggle.rotation.x = Math.PI * 0.5
    this.rightToggle.material = this.toggleMat
    this.rightToggle.parent = this.rightHandNode

    // Articulated Legs & Boots (Connected Anatomical Hierarchy - Zero Gaps)
    // Hip anchors
    this.leftLegNode = new TransformNode('leg-root-l', scene)
    this.leftLegNode.position.set(-0.1, 0.03, 0.045)
    // Negative pitch sends the thigh forward. Negative roll splays it outward.
    this.leftLegNode.rotation.x = -1.02
    this.leftLegNode.rotation.z = -0.16
    this.leftLegNode.parent = this.pilotBodyPivot

    this.rightLegNode = new TransformNode('leg-root-r', scene)
    this.rightLegNode.position.set(0.1, 0.03, 0.045)
    this.rightLegNode.rotation.x = -1.02
    this.rightLegNode.rotation.z = 0.16
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
    this.leftKneeNode.rotation.x = 0.62 // Soft bend: the shin hangs, it does not tuck under the seat
    this.leftKneeNode.parent = this.leftLegNode

    this.rightKneeNode = new TransformNode('knee-r', scene)
    this.rightKneeNode.position.set(0, -0.44, 0)
    this.rightKneeNode.rotation.x = 0.62
    this.rightKneeNode.parent = this.rightLegNode

    // Knee joint spheres seamlessly bridging thigh and shin
    const lKneeCap = MeshBuilder.CreateSphere('kneecap-l', { diameter: 0.14, segments: 10 }, scene)
    lKneeCap.material = this.pilotSuitMat
    lKneeCap.parent = this.leftKneeNode

    const rKneeCap = MeshBuilder.CreateSphere('kneecap-r', { diameter: 0.14, segments: 10 }, scene)
    rKneeCap.material = this.pilotSuitMat
    rKneeCap.parent = this.rightKneeNode

    for (const knee of [this.leftKneeNode, this.rightKneeNode]) {
      const pad = MeshBuilder.CreateSphere(`knee-pad-${knee.name}`, { diameter: 0.1, segments: 8 }, scene)
      pad.scaling.set(1.15, 0.7, 0.85)
      pad.position.set(0, 0.01, 0.06)
      pad.material = leatherMat
      pad.parent = knee
    }

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
    this.leftAnkleNode = new TransformNode('ankle-l', scene)
    this.leftAnkleNode.position.set(0, -0.42, 0)
    this.leftAnkleNode.parent = this.leftKneeNode

    this.rightAnkleNode = new TransformNode('ankle-r', scene)
    this.rightAnkleNode.position.set(0, -0.42, 0)
    this.rightAnkleNode.parent = this.rightKneeNode

    // Athletic Trail Running Shoes
    const lBoot = MeshBuilder.CreateBox('boot-l', { width: 0.15, height: 0.12, depth: 0.32 }, scene)
    lBoot.position.set(0, -0.04, 0.08)
    lBoot.material = this.bootMat
    lBoot.parent = this.leftAnkleNode

    const lSole = MeshBuilder.CreateBox('sole-l', { width: 0.16, height: 0.04, depth: 0.34 }, scene)
    lSole.position.set(0, -0.10, 0.08)
    lSole.material = this.soleMat
    lSole.parent = this.leftAnkleNode

    const rBoot = MeshBuilder.CreateBox('boot-r', { width: 0.15, height: 0.12, depth: 0.32 }, scene)
    rBoot.position.set(0, -0.04, 0.08)
    rBoot.material = this.bootMat
    rBoot.parent = this.rightAnkleNode

    const rSole = MeshBuilder.CreateBox('sole-r', { width: 0.16, height: 0.04, depth: 0.34 }, scene)
    rSole.position.set(0, -0.10, 0.08)
    rSole.material = this.soleMat
    rSole.parent = this.rightAnkleNode

    for (const ankle of [this.leftAnkleNode, this.rightAnkleNode]) {
      const cuff = MeshBuilder.CreateCylinder(`boot-cuff-${ankle.name}`, { height: 0.05, diameter: 0.155, tessellation: 10 }, scene)
      cuff.position.set(0, 0.03, 0.02)
      cuff.material = leatherMat
      cuff.parent = ankle
      const buckle = MeshBuilder.CreateBox(`boot-buckle-${ankle.name}`, { width: 0.04, height: 0.022, depth: 0.01 }, scene)
      buckle.position.set(0, -0.02, 0.25)
      buckle.material = this.brassMat
      buckle.parent = ankle
    }

    // 4. Build Steampunk Futuristic Blue Hydrogen Jetpack Unit
    this.paramotorNode = new TransformNode('paramotor-rig', scene)
    this.paramotorNode.parent = this.pilotBodyPivot

    const engineMat = new StandardMaterial('paramotor-engine-mat', scene)
    engineMat.diffuseColor = new Color3(0.2, 0.22, 0.25)
    engineMat.specularColor = new Color3(0.5, 0.5, 0.5)

    // Central jet body between the hydrogen tanks.
    const engineBlock = MeshBuilder.CreateBox('paramotor-engine', { width: 0.24, height: 0.28, depth: 0.24 }, scene)
    engineBlock.position.set(0, 0.32, -0.32)
    engineBlock.material = engineMat
    engineBlock.parent = this.paramotorNode

    // Dual Cryogenic Spherical Hydrogen Tanks (Left & Right) with Brass Rings & Cyan Energy Windows
    const h2TankL = MeshBuilder.CreateSphere('h2-tank-l', { diameter: 0.26, segments: 14 }, scene)
    h2TankL.position.set(-0.25, 0.36, -0.30)
    h2TankL.material = this.h2CoreMat
    h2TankL.parent = this.paramotorNode

    const h2RingL = MeshBuilder.CreateTorus('h2-ring-l', { diameter: 0.27, thickness: 0.02, tessellation: 20 }, scene)
    h2RingL.position.copyFrom(h2TankL.position)
    h2RingL.material = this.brassMat
    h2RingL.parent = this.paramotorNode

    const h2TankR = MeshBuilder.CreateSphere('h2-tank-r', { diameter: 0.26, segments: 14 }, scene)
    h2TankR.position.set(0.25, 0.36, -0.30)
    h2TankR.material = this.h2CoreMat
    h2TankR.parent = this.paramotorNode

    const h2RingR = MeshBuilder.CreateTorus('h2-ring-r', { diameter: 0.27, thickness: 0.02, tessellation: 20 }, scene)
    h2RingR.position.copyFrom(h2TankR.position)
    h2RingR.material = this.brassMat
    h2RingR.parent = this.paramotorNode

    // Copper curved conduit pipes
    const pipeL = MeshBuilder.CreateCylinder('pipe-l', { height: 0.22, diameter: 0.025, tessellation: 10 }, scene)
    pipeL.position.set(-0.14, 0.28, -0.32)
    pipeL.rotation.z = Math.PI * 0.3
    pipeL.material = this.copperMat
    pipeL.parent = this.paramotorNode

    const pipeR = MeshBuilder.CreateCylinder('pipe-r', { height: 0.22, diameter: 0.025, tessellation: 10 }, scene)
    pipeR.position.set(0.14, 0.28, -0.32)
    pipeR.rotation.z = -Math.PI * 0.3
    pipeR.material = this.copperMat
    pipeR.parent = this.paramotorNode

    // Dual Analog Brass Pressure Gauges
    const gaugeL = MeshBuilder.CreateCylinder('h2-gauge-l', { height: 0.04, diameter: 0.09, tessellation: 14 }, scene)
    gaugeL.position.set(-0.24, 0.52, -0.28)
    gaugeL.rotation.x = Math.PI * 0.5
    gaugeL.material = this.brassMat
    gaugeL.parent = this.paramotorNode

    const gaugeR = MeshBuilder.CreateCylinder('h2-gauge-r', { height: 0.04, diameter: 0.09, tessellation: 14 }, scene)
    gaugeR.position.set(0.24, 0.52, -0.28)
    gaugeR.rotation.x = Math.PI * 0.5
    gaugeR.material = this.brassMat
    gaugeR.parent = this.paramotorNode

    // Dual Canted Vector Rocket Thruster Bells
    this.thrusterBellL = MeshBuilder.CreateCylinder('thruster-bell-l', { height: 0.22, diameterTop: 0.10, diameterBottom: 0.16, tessellation: 16 }, scene)
    this.thrusterBellL.position.set(-0.26, 0.22, -0.44)
    this.thrusterBellL.rotation.x = -Math.PI * 0.5
    this.thrusterBellL.rotation.y = -0.12 // Canted outward
    this.thrusterBellL.material = this.brassMat
    this.thrusterBellL.parent = this.paramotorNode

    this.thrusterBellR = MeshBuilder.CreateCylinder('thruster-bell-r', { height: 0.22, diameterTop: 0.10, diameterBottom: 0.16, tessellation: 16 }, scene)
    this.thrusterBellR.position.set(0.26, 0.22, -0.44)
    this.thrusterBellR.rotation.x = -Math.PI * 0.5
    this.thrusterBellR.rotation.y = 0.12
    this.thrusterBellR.material = this.brassMat
    this.thrusterBellR.parent = this.paramotorNode

    // Short blue tongue out the back of each bell. +Y on the cone is aft (−Z).
    this.flameMeshL = MeshBuilder.CreateCylinder('flame-cone-l', { height: 0.36, diameterTop: 0.02, diameterBottom: 0.09, tessellation: 12 }, scene)
    this.flameMeshL.rotation.x = -Math.PI / 2
    this.flameMeshL.position.set(-0.26, 0.2, -0.64)
    this.flameMeshL.material = this.flameMat
    this.flameMeshL.parent = this.paramotorNode
    this.flameMeshL.setEnabled(false)

    this.flameMeshR = MeshBuilder.CreateCylinder('flame-cone-r', { height: 0.36, diameterTop: 0.02, diameterBottom: 0.09, tessellation: 12 }, scene)
    this.flameMeshR.rotation.x = -Math.PI / 2
    this.flameMeshR.position.set(0.26, 0.2, -0.64)
    this.flameMeshR.material = this.flameMat
    this.flameMeshR.parent = this.paramotorNode
    this.flameMeshR.setEnabled(false)

    this.paramotorNode.setEnabled(false)
    this.buildDrogue(scene)
    this.mountPaintedAirman()
    this.figure = new ArticulatedPilot(
      scene,
      this.pilotBodyPivot,
      this.pilotHeadNode,
      this.leftLegNode,
      this.rightLegNode,
      this.leftKneeNode,
      this.rightKneeNode,
      this.shoulderL,
      this.shoulderR,
      this.pilotSuitMat,
      this.helmetMat,
      this.visorMat,
      this.bootMat,
      this.soleMat,
      this.gloveMat,
      this.brassMat,
    )
  }

  // Painted stand-in. It faces the camera so the chase view shows the pilot, not an edge-on card.
  private mountPaintedAirman(): void {
    this.airmanBack = this.makeAirmanCard('airman-back', '/models/airman-back.png', 1.3, 1.8)
    this.airmanSuit = this.makeAirmanCard('airman-suit', '/models/airman-suit.png', 2.05, 1.8)
    this.airmanFront = this.makeAirmanCard('airman-front', '/models/airman-front.png', 1.15, 1.8)
    const keep = new Set<Mesh>([this.flameMeshL, this.flameMeshR, this.airmanBack, this.airmanFront, this.airmanSuit])
    this.sculptedPilot = this.pilotBodyPivot.getChildMeshes(false).filter((mesh) => !keep.has(mesh as Mesh)) as Mesh[]
    this.hideSculptedPilot()
  }

  private hideSculptedPilot(): void {
    for (const mesh of this.sculptedPilot) mesh.setEnabled(false)
  }

  private makeAirmanCard(name: string, url: string, width: number, height: number): Mesh {
    const mesh = MeshBuilder.CreatePlane(name, { width, height }, this.scene)
    mesh.position.y = 0.25
    mesh.billboardMode = Mesh.BILLBOARDMODE_ALL
    mesh.parent = this.pilotBodyPivot
    mesh.isPickable = false
    mesh.setEnabled(false)
    const tex = new Texture(url, this.scene, false, true)
    tex.hasAlpha = true
    const mat = new StandardMaterial(`${name}-mat`, this.scene)
    mat.diffuseTexture = tex
    mat.emissiveTexture = tex
    mat.useAlphaFromDiffuseTexture = true
    mat.transparencyMode = Material.MATERIAL_ALPHATEST
    mat.alphaCutOff = 0.35
    mat.disableLighting = true
    mat.backFaceCulling = false
    mat.specularColor = Color3.Black()
    mesh.material = mat
    return mesh
  }

  /**
   * Small trailing sock, low behind the pack. Babylon +Z is forward.
   * The chase camera is only about 2 m back, so a disc facing it fills the lens.
   */
  private buildDrogue(scene: Scene) {
    this.drogueRoot = new TransformNode('drogue-root', scene)
    this.drogueRoot.parent = this.pilotBodyPivot
    this.drogueRoot.position.set(0, 0.08, -0.62)

    const cloth = new StandardMaterial('drogue-cloth', scene)
    cloth.diffuseColor = new Color3(0.96, 0.91, 0.78)
    cloth.emissiveColor = new Color3(0.32, 0.2, 0.08)
    cloth.specularColor = new Color3(0.18, 0.14, 0.08)
    cloth.backFaceCulling = false

    const lineMat = new StandardMaterial('drogue-line', scene)
    lineMat.diffuseColor = new Color3(0.45, 0.32, 0.16)
    lineMat.specularColor = new Color3(0.1, 0.1, 0.1)

    const sock = MeshBuilder.CreateSphere('drogue-sock', { diameter: 0.34, segments: 12 }, scene)
    sock.scaling.set(0.8, 0.55, 1.55)
    sock.position.set(0, -0.06, -0.28)
    sock.material = cloth
    sock.parent = this.drogueRoot

    const mouth = MeshBuilder.CreateTorus('drogue-mouth', { diameter: 0.26, thickness: 0.016, tessellation: 16 }, scene)
    mouth.position.set(0, -0.04, -0.08)
    mouth.rotation.x = Math.PI / 2
    mouth.material = cloth
    mouth.parent = this.drogueRoot

    const anchor = new Vector3(0, 0.06, 0.08)
    for (let i = 0; i < 3; i++) {
      const a = (i - 1) * 0.7
      const end = new Vector3(Math.sin(a) * 0.12, -0.04, -0.08)
      const dir = end.subtract(anchor)
      const len = Math.max(0.05, dir.length())
      const shroud = MeshBuilder.CreateCylinder(`drogue-line-${i}`, { height: len, diameter: 0.008, tessellation: 6 }, scene)
      shroud.position.copyFrom(anchor.add(end).scaleInPlace(0.5))
      const dirN = dir.scale(1 / len)
      const axis = Vector3.Cross(Vector3.Up(), dirN)
      const axisLen = axis.length()
      if (axisLen < 1e-4) {
        if (dirN.y < 0) shroud.rotation.x = Math.PI
      } else {
        shroud.rotationQuaternion = Quaternion.RotationAxis(axis.scaleInPlace(1 / axisLen), Math.acos(Math.max(-1, Math.min(1, dirN.y))))
      }
      shroud.material = lineMat
      shroud.parent = this.drogueRoot
    }

    this.drogueRoot.setEnabled(false)
  }

  public buildCanopyAndLines(wingType: WingKind) {
    this.currentWingType = wingType
    if (this.canopyMesh) this.canopyMesh.dispose()
    if (this.underMesh) this.underMesh.dispose()
    if (this.suspensionLinesMesh) this.suspensionLinesMesh.dispose()
    if (this.risersMesh) this.risersMesh.dispose()
    if (this.brakeLinesMesh) this.brakeLinesMesh.dispose()
    if (this.ribLinesMesh) this.ribLinesMesh.dispose()
    this.disposeSailFrame()
    this.canopyMesh = null
    this.underMesh = null
    this.suspensionLinesMesh = null
    this.risersMesh = null
    this.brakeLinesMesh = null
    this.ribLinesMesh = null

    this.aLinePoints = []
    this.bLinePoints = []
    this.cLinePoints = []
    this.cellAttachmentPoints = []
    this.trailingEdgePoints = []
    this.baseUpperLE = []
    this.baseUpperTE = []
    this.baseLowerLE = []
    this.baseLowerTE = []
    this.wasCollapsed = false

    // The suit has no cloth overhead. Pulling the chute rebuilds the canopy.
    if (wingType === 'wingsuit') return

    const isXc = wingType === 'paraglider'
    const isParamotor = wingType === 'paramotor'
    const numCells = isXc ? 42 : (isParamotor ? 34 : 30)
    const halfSpan = isXc ? 5.1 : (isParamotor ? 4.2 : 3.8)
    const chord = isXc ? 1.85 : (isParamotor ? 1.75 : 1.55)
    const lineDrop = isXc ? -3.3 : (isParamotor ? -3.1 : -2.9)

    const upperRibbon: Vector3[] = []
    const lowerRibbon: Vector3[] = []

    for (let c = 0; c <= numCells; c++) {
      const u = c / numCells
      const x = -halfSpan + u * halfSpan * 2
      const normX = Math.abs(x) / halfSpan

      // Elliptical arch. The chute tapers to a point and the tips rake back.
      const archY = (1 - Math.pow(normX, 1.9)) * (isXc ? 1.45 : (isParamotor ? 1.35 : 1.25))
      const sweepZ = Math.pow(normX, isXc ? 1.25 : 1.7) * (isXc ? 1.45 : (isParamotor ? 0.65 : 0.58))
      const taperChord = chord * (1 - Math.pow(normX, isXc ? 1.2 : 1) * (isXc ? 0.9 : (isParamotor ? 0.38 : 0.42)))
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

    if (isXc) this.buildClearSailFrame()

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

  // Copper tubes share the cloth's point count so a collapse can instance-update them.
  private buildClearSailFrame(): void {
    const le = this.baseUpperLE
    const te = this.baseUpperTE
    if (le.length < 2 || te.length !== le.length) return

    this.leadingEdgeMesh = this.makeSailTube('sail-leading-edge', le, 0.05, 6, (index) => this.leadingEdgeRadius(index))
    this.trailingEdgeMesh = this.makeSailTube('sail-trailing-edge', te, 0.022, 4)

    this.sailBattens = []
    this.sailBattenTs = [0.32, 0.68]
    for (const t of this.sailBattenTs) {
      this.sailBattens.push(this.makeSailTube(`sail-batten-${t}`, this.battenPath(le, te, t), 0.02, 4))
    }

    this.sailChordSpars = []
    this.sailChordCells = []
    const last = le.length - 1
    for (const cell of [0, 6, 12, 18, 24, 30, 36, 42]) {
      if (cell > last) continue
      this.sailChordCells.push(cell)
      this.sailChordSpars.push(this.makeSailTube(`sail-chord-${cell}`, this.chordPath(le, te, cell), 0.016, 4))
    }
  }

  private refreshClearSailFrame(le: Vector3[], te: Vector3[]): void {
    if (!this.leadingEdgeMesh || le.length < 2 || te.length !== le.length || le.length !== this.baseUpperLE.length) return
    MeshBuilder.CreateTube('sail-leading-edge', {
      path: le,
      radiusFunction: (index) => this.leadingEdgeRadius(index),
      instance: this.leadingEdgeMesh,
    }, this.scene)
    if (this.trailingEdgeMesh) {
      MeshBuilder.CreateTube('sail-trailing-edge', { path: te, instance: this.trailingEdgeMesh }, this.scene)
    }
    for (let i = 0; i < this.sailBattens.length; i++) {
      const t = this.sailBattenTs[i] ?? 0.5
      MeshBuilder.CreateTube('sail-batten', {
        path: this.battenPath(le, te, t),
        instance: this.sailBattens[i],
      }, this.scene)
    }
    for (let i = 0; i < this.sailChordSpars.length; i++) {
      const cell = this.sailChordCells[i]
      if (cell === undefined || cell >= le.length) continue
      MeshBuilder.CreateTube('sail-chord', {
        path: this.chordPath(le, te, cell),
        instance: this.sailChordSpars[i],
      }, this.scene)
    }
  }

  private setSailFrameVisible(visible: boolean): void {
    this.leadingEdgeMesh?.setEnabled(visible)
    this.trailingEdgeMesh?.setEnabled(visible)
    for (const mesh of this.sailBattens) mesh.setEnabled(visible)
    for (const mesh of this.sailChordSpars) mesh.setEnabled(visible)
  }

  private disposeSailFrame(): void {
    this.leadingEdgeMesh?.dispose()
    this.trailingEdgeMesh?.dispose()
    for (const mesh of this.sailBattens) mesh.dispose()
    for (const mesh of this.sailChordSpars) mesh.dispose()
    this.leadingEdgeMesh = null
    this.trailingEdgeMesh = null
    this.sailBattens = []
    this.sailBattenTs = []
    this.sailChordSpars = []
    this.sailChordCells = []
  }

  private makeSailTube(
    name: string,
    path: Vector3[],
    radius: number,
    tessellation: number,
    radiusFunction?: (index: number, distance: number) => number,
  ): Mesh {
    const mesh = MeshBuilder.CreateTube(name, {
      path,
      radius,
      tessellation,
      radiusFunction,
      cap: Mesh.CAP_ALL,
      updatable: true,
    }, this.scene)
    mesh.material = this.sailFrameMat
    mesh.parent = this.canopyRoot
    mesh.isPickable = false
    return mesh
  }

  private leadingEdgeRadius(index: number): number {
    const denom = Math.max(1, this.baseUpperLE.length - 1)
    const edge = Math.abs(index / denom * 2 - 1)
    return 0.05 * (1 - edge * edge * 0.78)
  }

  private battenPath(le: Vector3[], te: Vector3[], t: number): Vector3[] {
    const path: Vector3[] = []
    for (let i = 0; i < le.length; i++) {
      const a = le[i]
      const b = te[i]
      path.push(a && b ? Vector3.Lerp(a, b, t) : new Vector3())
    }
    return path
  }

  // A 2-point tube needs a real tangent. Keep two points and nudge a pinched tip apart.
  private chordPath(le: Vector3[], te: Vector3[], cell: number): Vector3[] {
    const a = le[cell] ?? new Vector3()
    const b = te[cell] ?? a.clone().add(new Vector3(0, 0, 0.05))
    if (Vector3.DistanceSquared(a, b) < 0.0025) {
      return [a.clone(), a.clone().add(new Vector3(0, 0, 0.05))]
    }
    return [a.clone(), b.clone()]
  }

  public setSuspensionLinesVisible(visible: boolean): void {
    this.showSuspensionLines = visible
    if (this.suspensionLinesMesh) this.suspensionLinesMesh.setEnabled(visible && this.pilotVisible)
    if (this.risersMesh) this.risersMesh.setEnabled(visible && this.pilotVisible)
    if (this.brakeLinesMesh) this.brakeLinesMesh.setEnabled(visible && this.pilotVisible)
  }

  public getWingtipPositions(): { left: Vector3; right: Vector3 } {
    if (this.currentWingType === 'wingsuit') {
      // Vapor comes off the hands. The arms are the wing.
      this.leftHandNode.computeWorldMatrix(true)
      this.rightHandNode.computeWorldMatrix(true)
      return {
        left: this.leftHandNode.getAbsolutePosition(),
        right: this.rightHandNode.getAbsolutePosition(),
      }
    }
    const isXc = this.currentWingType === 'paraglider'
    const isParamotor = this.currentWingType === 'paramotor'
    const halfSpan = isXc ? 5.1 : (isParamotor ? 4.7 : 4.4)
    const normX = 1.0
    const archY = (1 - Math.pow(normX, 1.9)) * (isXc ? 1.45 : (isParamotor ? 1.35 : 1.25))
    const sweepZ = Math.pow(normX, isXc ? 1.25 : 1.7) * (isXc ? 1.54 : (isParamotor ? 0.65 : 0.58))

    this.canopyRoot.computeWorldMatrix(true)
    const mat = this.canopyRoot.getWorldMatrix()
    const leftLocal = new Vector3(-halfSpan, archY, sweepZ)
    const rightLocal = new Vector3(halfSpan, archY, sweepZ)
    return {
      left: Vector3.TransformCoordinates(leftLocal, mat),
      right: Vector3.TransformCoordinates(rightLocal, mat),
    }
  }

  public getThrusterPositions(): { left: Vector3; right: Vector3 } | undefined {
    if (!this.paramotorNode || !this.paramotorNode.isEnabled()) return undefined
    this.paramotorNode.computeWorldMatrix(true)
    const mat = this.paramotorNode.getWorldMatrix()
    const beta = this.currentWingType === 'wingsuit' ? this.pilotBodyPivot.rotation.x : 0
    const along = this.currentWingType === 'wingsuit' ? 0.7 : 0.34
    const leftLocal = new Vector3(-0.26, 0.22 - Math.sin(beta) * along, -0.44 - Math.cos(beta) * along)
    const rightLocal = new Vector3(0.26, 0.22 - Math.sin(beta) * along, -0.44 - Math.cos(beta) * along)
    return {
      left: Vector3.TransformCoordinates(leftLocal, mat),
      right: Vector3.TransformCoordinates(rightLocal, mat),
    }
  }

  public setPilotVisible(visible: boolean): void {
    this.pilotVisible = visible
    this.pilotRoot.setEnabled(visible)
    this.canopyRoot.setEnabled(visible)
    if (this.suspensionLinesMesh) this.suspensionLinesMesh.setEnabled(this.showSuspensionLines && visible)
    if (this.risersMesh) this.risersMesh.setEnabled(this.showSuspensionLines && visible)
    if (this.brakeLinesMesh) this.brakeLinesMesh.setEnabled(this.showSuspensionLines && visible)
  }

  public toggleSuspensionLines(): boolean {
    this.setSuspensionLinesVisible(!this.showSuspensionLines)
    return this.showSuspensionLines
  }

  public applySkin(skin: PilotSkin): void {
    this.equippedSkin = skin
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
        const canopyTint = this.equippedSkin?.canopy
        if (canopyTint) {
          const tint = new Color3(canopyTint.r, canopyTint.g, canopyTint.b)
          this.canopyTopSpeedMat.diffuseColor = tint
          this.canopyTopXcMat.diffuseColor = tint
          this.canopyTopParamotorMat.diffuseColor = tint
        } else {
          this.canopyTopSpeedMat.diffuseColor = new Color3(0.96, 0.18, 0.12)
          this.canopyTopXcMat.diffuseColor = new Color3(0.98, 0.74, 0.14)
          this.canopyTopParamotorMat.diffuseColor = new Color3(0.0, 0.88, 1.0)
        }
        this.canopyMesh.material = isXc
          ? this.canopyTopXcMat
          : (isParamotor ? this.canopyTopParamotorMat : this.canopyTopSpeedMat)
        this.underMesh.material = isParamotor ? this.canopyUnderParamotorMat : this.canopyUnderMat
        try {
          this.canopyMesh.disableEdgesRendering()
          this.underMesh.disableEdgesRendering()
        } catch {}
        if (isXc) {
          const tint = this.equippedSkin?.canopy
          if (tint) {
            this.sailMat.diffuseColor = new Color3(0.55 + tint.r * 0.4, 0.5 + tint.g * 0.35, 0.42 + tint.b * 0.28)
            this.sailMat.emissiveColor = new Color3(0.16 + tint.r * 0.22, 0.12 + tint.g * 0.16, 0.06 + tint.b * 0.1)
          } else {
            this.sailMat.diffuseColor = new Color3(0.93, 0.9, 0.82)
            this.sailMat.emissiveColor = new Color3(0.38, 0.28, 0.14)
          }
          this.canopyMesh.material = this.sailMat
          this.underMesh.material = this.sailMat
          this.setSailFrameVisible(true)
        } else {
          this.setSailFrameVisible(false)
        }
      }
    }

    if (isLine) this.setSailFrameVisible(false)

    if (this.ribLinesMesh) {
      const clearSail = isXc && !isLine
      this.ribLinesMesh.color = clearSail ? new Color3(0.55, 0.32, 0.14) : pal.canopyRibRgb
      this.ribLinesMesh.setEnabled(isLine || clearSail)
    }

    if (this.suspensionLinesMesh && isLine) {
      this.suspensionLinesMesh.color = pal.suspensionLineRgb
    }
    if (this.brakeLinesMesh) {
      this.brakeLinesMesh.color = isLine ? pal.majorContourRgb : new Color3(0.98, 0.42, 0.12)
    }

    const skin = this.equippedSkin
    if (this.pilotSuitMat) {
      this.pilotSuitMat.diffuseColor = isLine
        ? new Color3(0.12, 0.14, 0.18)
        : skin
          ? new Color3(skin.suit.r, skin.suit.g, skin.suit.b)
          : new Color3(0.86, 0.4, 0.14)
      this.pilotSuitMat.emissiveColor = this.pilotSuitMat.diffuseColor.scale(0.2)
    }
    if (this.helmetMat) {
      this.helmetMat.diffuseColor = isLine
        ? new Color3(0.95, 0.95, 0.98)
        : skin
          ? new Color3(skin.helmet.r, skin.helmet.g, skin.helmet.b)
          : new Color3(0.93, 0.9, 0.82)
      this.helmetMat.emissiveColor = this.helmetMat.diffuseColor.scale(0.2)
    }
    if (this.visorMat) {
      this.visorMat.diffuseColor = skin && !isLine
        ? new Color3(skin.visor.r, skin.visor.g, skin.visor.b)
        : new Color3(0.04, 0.04, 0.06)
      if (skin?.style === 'neon') {
        this.visorMat.emissiveColor = new Color3(0.0, 0.95, 1.0)
        this.visorMat.specularColor = new Color3(0.0, 0.95, 1.0)
      } else if (skin?.style === 'steampunk') {
        this.visorMat.emissiveColor = new Color3(0.28, 0.14, 0.03)
        this.visorMat.specularColor = new Color3(0.95, 0.8, 0.35)
      } else if (skin?.style === 'gold') {
        this.visorMat.emissiveColor = new Color3(0.2, 0.15, 0.02)
        this.visorMat.specularColor = new Color3(0.98, 0.85, 0.35)
      } else if (skin?.style === 'carbon') {
        this.visorMat.emissiveColor = new Color3(0.2, 0.02, 0.03)
        this.visorMat.specularColor = new Color3(0.95, 0.1, 0.15)
      } else {
        this.visorMat.emissiveColor = Color3.Black()
        this.visorMat.specularColor = isLine ? pal.majorContourRgb : new Color3(0.95, 0.85, 0.35)
      }
    }
    if (this.gloveMat) {
      this.gloveMat.diffuseColor = new Color3(0.36, 0.22, 0.13)
    }
    if (this.bootMat) {
      this.bootMat.diffuseColor = skin && !isLine
        ? new Color3(skin.boots.r, skin.boots.g, skin.boots.b)
        : new Color3(0.48, 0.27, 0.13)
      this.bootMat.emissiveColor = this.bootMat.diffuseColor.scale(0.2)
    }
    if (this.soleMat) {
      this.soleMat.diffuseColor = new Color3(0.18, 0.12, 0.08)
    }
    if (this.toggleMat) {
      this.toggleMat.diffuseColor = new Color3(0.95, 0.24, 0.14)
    }
  }

  public update(sim: ParagliderSimulation, vantage: string = 'pilot-fpv'): void {
    if (sim.currentWingType !== this.currentWingType) {
      this.buildCanopyAndLines(sim.currentWingType)
    }

    const isWingsuit = sim.currentWingType === 'wingsuit'
    const isParamotor = sim.currentWingType === 'paramotor'
    const isParaglider = sim.currentWingType === 'paraglider'
    // The pack rides under the chute. The suit is a bare drop.
    const isPowered = isParaglider || isParamotor
    if (this.paramotorNode) {
      this.paramotorNode.setEnabled(isPowered)
    }
    if (this.travelerKit) this.travelerKit.setEnabled(!isPowered)
    if (this.paramotorNode) {

      // Hydrogen jets. Length follows throttle. No propeller.
      if (this.flameMeshL && this.flameMeshR) {
        const thrustFrac = clamp((sim.thrustNewtons - 80) / 420, 0, 1)
        const lit = thrustFrac > 0.04
        const t = performance.now() * 0.001
        const flicker = 0.82 + Math.sin(t * 42) * 0.1 + Math.sin(t * 17) * 0.06
        const scaleY = (0.55 + thrustFrac * 0.9) * flicker
        this.flameMeshL.scaling.set(1, scaleY, 1)
        this.flameMeshR.scaling.set(1, scaleY, 1)
        if (isWingsuit) {
          // Body pitch swings the back upward. Aim the bells down the spine so the burn stays aft.
          const beta = this.pilotBodyPivot.rotation.x
          const aimX = -Math.PI / 2 - beta
          this.thrusterBellL.rotation.x = aimX
          this.thrusterBellR.rotation.x = aimX
          this.flameMeshL.rotation.x = aimX
          this.flameMeshR.rotation.x = aimX
          const along = 0.32 + 0.18 * scaleY
          const axisY = -Math.sin(beta)
          const axisZ = -Math.cos(beta)
          this.flameMeshL.position.set(-0.26, 0.22 + axisY * along, -0.44 + axisZ * along)
          this.flameMeshR.position.set(0.26, 0.22 + axisY * along, -0.44 + axisZ * along)
        } else {
          this.thrusterBellL.rotation.x = -Math.PI / 2
          this.thrusterBellR.rotation.x = -Math.PI / 2
          this.flameMeshL.rotation.x = -Math.PI / 2
          this.flameMeshR.rotation.x = -Math.PI / 2
          const aft = -0.5 - 0.18 * scaleY
          this.flameMeshL.position.y = 0.2
          this.flameMeshR.position.y = 0.2
          this.flameMeshL.position.z = aft
          this.flameMeshR.position.z = aft
        }
        this.flameMeshL.setEnabled(lit)
        this.flameMeshR.setEnabled(lit)
      }
    }

    if (this.drogueRoot) {
      const open = isParamotor || isParaglider ? sim.drogueOpen : 0
      const show = open > 0.04
      this.drogueRoot.setEnabled(show)
      if (show) {
        const s = 0.2 + open * 0.8
        this.drogueRoot.scaling.set(s, s, s)
      }
    }

    // FPV hides the helmet so the camera is not inside it. Arms and legs stay.
    const isFpv = vantage === 'pilot-fpv'
    this.hideSculptedPilot()
    this.airmanFront?.setEnabled(false)
    this.airmanSuit?.setEnabled(false)
    this.airmanBack?.setEnabled(false)
    this.pilotHeadNode.setEnabled(!isFpv)
    this.torsoMesh.setEnabled(false)

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

      this.refreshClearSailFrame(this.deformedUpperLE, this.deformedUpperTE)

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
      this.refreshClearSailFrame(this.baseUpperLE, this.baseUpperTE)
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
    // +1.2 rad about local X tips the spine from the tether (+Y) toward +Z.
    // +Z is forward on this rig, and the chest rotates toward -Y, so the suit flies belly-down.
    // Looking down is a dive. +X pitches the chest from the tether toward forward,
    // so the suit and the harness both nose down instead of sitting in the glide.
    const divePose = clamp(speedBar, 0, 1)
    let targetBodyPitch = sim.currentWingType === 'wingsuit'
      ? 1.2 + divePose * 0.62
      : symBrake * 0.08 + divePose * 0.78
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
    const targetHeadPitch = clamp(
      -sim.telemetry.verticalSpeedMps * 0.012 + divePose * (sim.currentWingType === 'wingsuit' ? 0.32 : 0.48),
      -0.3,
      0.7,
    )
    const headFollowFactor = Math.min(1.0, 8.5 * rigDt)
    this.pilotHeadNode.rotation.y += (targetHeadYaw - this.pilotHeadNode.rotation.y) * headFollowFactor
    this.pilotHeadNode.rotation.x += (targetHeadPitch - this.pilotHeadNode.rotation.x) * headFollowFactor

    // Trim holds both hands straight up on the toggles. A turn drops the
    // inside hand from there. Reach stays inside 0.55 m.
    const computeHandTarget = (side: number, brake: number) => {
      if (sim.currentWingType === 'wingsuit' && collapseFrac <= 0.15) {
        // Arms sweep aft as the dive steepens. Stay inside the 0.55 m reach.
        return new Vector3(
          side * (0.73 - divePose * 0.22),
          0.4 - divePose * 0.16,
          -0.1 - divePose * 0.28,
        )
      }

      let targetX = side * (0.26 + brake * 0.04)
      let targetY = 0.96 - brake * 0.78
      let targetZ = 0.06 - brake * 0.08

      if (collapseFrac > 0.15) {
        targetY = 0.96 - 0.62 * collapseFrac
        targetX = side * (0.26 + 0.08 * collapseFrac)
        targetZ = 0.06 - 0.1 * collapseFrac
      } else {
        const inside = Math.max(0, side * weightShift)
        targetY -= inside * 0.58
        targetX += side * inside * 0.06
        targetZ -= inside * 0.04
        if (brake < 0.2 && (pullingA > 0.05 || speedBar > 0.05)) {
          const pushFrac = Math.max(pullingA, speedBar) * (1.0 - brake / 0.2)
          targetZ += pushFrac * 0.18
          targetY -= pushFrac * 0.22
        } else if (brake < 0.2 && pullingB > 0.05) {
          const pullFrac = pullingB * (1.0 - brake / 0.2)
          targetY -= pullFrac * 0.2
        }
      }
      if (targetY < 0.02) targetY = 0.02
      if (targetY > 0.98) targetY = 0.98
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

    updateArmIK(this.shoulderL, this.currentLeftHandPos, -1, this.leftUpperArmMesh, this.leftForearmMesh, this.leftElbowMesh)
    updateArmIK(this.shoulderR, this.currentRightHandPos, 1, this.rightUpperArmMesh, this.rightForearmMesh, this.rightElbowMesh)

    // 3. Dynamic Leg Articulation
    const isSkimming = sim.isFootDragging

    // Negative hip pitch swings the thigh forward, out of the seat, for the
    // harness hang. A dive opens that hinge: positive pitch trails the thigh
    // aft and the knee straightens, the way a skydiver's legs stream behind.
    const seatedHip = -1.02
    const hangKnee = 0.62
    let targetHipAngle = seatedHip
    let targetKneeAngle = hangKnee

    if (sim.currentWingType === 'wingsuit' && collapseFrac <= 0.15) {
      targetHipAngle = 0.15 + divePose * 0.85
      targetKneeAngle = 0.22 * (1 - divePose)
    } else if (collapseFrac > 0.15) {
      targetHipAngle = -0.15 * (1 - collapseFrac)
      targetKneeAngle = 0.2 * (1 - collapseFrac)
    } else if (isSkimming) {
      targetHipAngle = -0.22
      targetKneeAngle = 0.16
    } else if (divePose > 0.02) {
      const extend = Math.pow(divePose, 0.6)
      const trailHip = 0.9
      const trailKnee = 0.08
      targetHipAngle = seatedHip + extend * (trailHip - seatedHip)
      targetKneeAngle = hangKnee + extend * (trailKnee - hangKnee)
    } else if (symBrake > 0.2) {
      targetHipAngle = -1.16
      targetKneeAngle = 0.82
    }

    // Outside thigh reaches forward. Inside thigh stays more bent.
    const legAsymmetry = weightShift * 0.18
    const targetLeftHip = targetHipAngle - legAsymmetry
    const targetRightHip = targetHipAngle + legAsymmetry

    const legFollowFactor = 0.80 // Snappy, responsive leg kinematics!
    this.leftLegNode.rotation.x += (targetLeftHip - this.leftLegNode.rotation.x) * legFollowFactor
    this.rightLegNode.rotation.x += (targetRightHip - this.rightLegNode.rotation.x) * legFollowFactor
    this.leftKneeNode.rotation.x += (targetKneeAngle - this.leftKneeNode.rotation.x) * legFollowFactor
    this.rightKneeNode.rotation.x += (targetKneeAngle - this.rightKneeNode.rotation.x) * legFollowFactor

    const suited = sim.currentWingType === 'wingsuit'
    this.harnessMesh.setEnabled(false)
    this.leftCarabinerMesh.setEnabled(!suited && !isFpv)
    this.rightCarabinerMesh.setEnabled(!suited && !isFpv)
    this.leftToggle.setEnabled(!suited && !isFpv)
    this.rightToggle.setEnabled(!suited && !isFpv)
    this.figure.pose(
      this.shoulderL, this.leftElbowMesh.position, this.currentLeftHandPos,
      this.shoulderR, this.rightElbowMesh.position, this.currentRightHandPos,
      suited,
      isFpv,
    )

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
    this.disposeSailFrame()
    if (this.ribLinesMesh) this.ribLinesMesh.dispose()
    if (this.canopyMesh) this.canopyMesh.dispose()
    if (this.underMesh) this.underMesh.dispose()
    if (this.suspensionLinesMesh) this.suspensionLinesMesh.dispose()
    if (this.risersMesh) this.risersMesh.dispose()
    if (this.brakeLinesMesh) this.brakeLinesMesh.dispose()
  }
}
