import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import type { Scene } from '@babylonjs/core/scene'

export type SphereSphereDef = {
  center: Vector3
  radius: number
  color?: Color3
}

export class SpherePackingMeshBuilder {
  /**
   * Creates an organic stylized tree canopy by packing overlapping spheres of varying radii,
   * producing a lush, puffy, stylized crown.
   */
  public static createTreeCanopy(
    name: string,
    scene: Scene,
    baseRadius: number = 2.8,
    foliageColor: Color3 = new Color3(0.18, 0.52, 0.26),
  ): Mesh | null {
    const spheres: Mesh[] = []
    const mat = new StandardMaterial(`${name}-mat`, scene)
    mat.diffuseColor = foliageColor
    mat.specularColor = new Color3(0.05, 0.05, 0.05)
    mat.backFaceCulling = false

    // Central core sphere
    const core = MeshBuilder.CreateSphere(`${name}-core`, { diameter: baseRadius * 2, segments: 10 }, scene)
    core.position = new Vector3(0, baseRadius * 1.1, 0)
    spheres.push(core)

    // Clustered satellite spheres packed around the core
    const clusterCount = 7
    for (let i = 0; i < clusterCount; i++) {
      const angle = (i / clusterCount) * Math.PI * 2 + (Math.sin(i * 3.7) * 0.4)
      const dist = baseRadius * 0.65
      const rad = baseRadius * (0.55 + ((i % 3) * 0.15))
      const yOffset = baseRadius * (0.8 + ((i % 2) * 0.5))

      const sat = MeshBuilder.CreateSphere(
        `${name}-sat-${i}`,
        { diameter: rad * 2, segments: 8 },
        scene,
      )
      sat.position = new Vector3(
        Math.cos(angle) * dist,
        yOffset,
        Math.sin(angle) * dist,
      )
      spheres.push(sat)
    }

    // Top cap sphere for conical pine/deciduous crown
    const topCap = MeshBuilder.CreateSphere(`${name}-top`, { diameter: baseRadius * 1.3, segments: 8 }, scene)
    topCap.position = new Vector3(0, baseRadius * 1.8, 0)
    spheres.push(topCap)

    const merged = Mesh.MergeMeshes(spheres, true, true, undefined, false, true)
    if (merged) {
      merged.material = mat
      merged.name = name
    }
    return merged
  }

  /**
   * Creates a fluffy, stylized volumetric cloud composed of packed smooth spheres.
   */
  public static createPuffyCloud(
    name: string,
    scene: Scene,
    length: number = 85,
    cloudColor: Color3 = new Color3(0.96, 0.98, 1.0),
  ): Mesh | null {
    const spheres: Mesh[] = []
    const mat = new StandardMaterial(`${name}-mat`, scene)
    mat.diffuseColor = cloudColor
    mat.emissiveColor = new Color3(0.12, 0.14, 0.18) // subtle ambient glow
    mat.specularColor = new Color3(0.08, 0.08, 0.1)
    mat.backFaceCulling = false

    // Number of packed spheres along the cloud body
    const numSpheres = 12
    for (let i = 0; i < numSpheres; i++) {
      const t = (i / (numSpheres - 1)) * 2 - 1 // -1 to +1
      const x = t * (length * 0.48)
      // Radius tapers at cloud edges, bulbous in middle
      const taper = 1 - (t * t * 0.6)
      const rad = (length * 0.22) * taper * (0.8 + Math.sin(i * 2.1) * 0.25)
      const y = Math.sin(i * 1.7) * (rad * 0.3)
      const z = Math.cos(i * 2.3) * (rad * 0.35)

      const sphere = MeshBuilder.CreateSphere(
        `${name}-part-${i}`,
        { diameter: rad * 2, segments: 10 },
        scene,
      )
      sphere.position = new Vector3(x, y, z)
      spheres.push(sphere)
    }

    const merged = Mesh.MergeMeshes(spheres, true, true, undefined, false, true)
    if (merged) {
      merged.material = mat
      merged.name = name
    }
    return merged
  }

  /**
   * Creates a rounded boulder/rock outcropping from packed intersecting ellipsoids.
   */
  public static createBoulderCluster(
    name: string,
    scene: Scene,
    size: number = 6.0,
    rockColor: Color3 = new Color3(0.52, 0.48, 0.44),
  ): Mesh | null {
    const spheres: Mesh[] = []
    const mat = new StandardMaterial(`${name}-mat`, scene)
    mat.diffuseColor = rockColor
    mat.specularColor = new Color3(0.04, 0.04, 0.04)

    const count = 4
    for (let i = 0; i < count; i++) {
      const rad = size * (0.45 + i * 0.15)
      const s = MeshBuilder.CreateSphere(`${name}-rock-${i}`, { diameter: rad * 2, segments: 8 }, scene)
      s.scaling = new Vector3(1.1, 0.75, 1.25)
      s.position = new Vector3(
        (i - 1.5) * (size * 0.3),
        rad * 0.5,
        Math.sin(i * 2) * (size * 0.2),
      )
      spheres.push(s)
    }

    const merged = Mesh.MergeMeshes(spheres, true, true, undefined, false, true)
    if (merged) {
      merged.material = mat
      merged.name = name
    }
    return merged
  }
}
