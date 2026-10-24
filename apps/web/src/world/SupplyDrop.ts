import { Color3 } from '@babylonjs/core/Maths/math.color'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { Scene } from '@babylonjs/core/scene'

/** A single glowing beacon. Fly through it to earn that city's suit and souvenir. */
export class SupplyDrop {
  private root: TransformNode
  private ring: Mesh
  private core: Mesh
  private baseY = 0
  private spin = 0
  enabled = false

  constructor(scene: Scene) {
    this.root = new TransformNode('supply-drop', scene)

    const ringMat = new StandardMaterial('supply-drop-ring', scene)
    ringMat.diffuseColor = new Color3(0.15, 0.85, 0.95)
    ringMat.emissiveColor = new Color3(0.2, 0.95, 1)
    ringMat.specularColor = new Color3(0.4, 0.4, 0.4)

    const coreMat = new StandardMaterial('supply-drop-core', scene)
    coreMat.diffuseColor = new Color3(1, 0.82, 0.25)
    coreMat.emissiveColor = new Color3(1, 0.7, 0.15)

    this.ring = MeshBuilder.CreateTorus('supply-drop-torus', { diameter: 14, thickness: 0.55, tessellation: 28 }, scene)
    this.ring.material = ringMat
    this.ring.parent = this.root

    this.core = MeshBuilder.CreateSphere('supply-drop-core', { diameter: 2.2, segments: 12 }, scene)
    this.core.material = coreMat
    this.core.parent = this.root

    this.root.setEnabled(false)
  }

  place(x: number, y: number, z: number): void {
    this.baseY = y
    this.root.position.set(x, y, z)
    this.root.setEnabled(true)
    this.enabled = true
  }

  hide(): void {
    this.enabled = false
    this.root.setEnabled(false)
  }

  update(dt: number, pilot: { x: number; y: number; z: number }): boolean {
    if (!this.enabled) return false
    this.spin += dt
    this.root.position.y = this.baseY + Math.sin(this.spin * 2.2) * 1.4
    this.ring.rotation.y += dt * 0.8
    this.ring.rotation.x = 1.15
    const dx = pilot.x - this.root.position.x
    const dy = pilot.y - this.root.position.y
    const dz = pilot.z - this.root.position.z
    if (dx * dx + dy * dy + dz * dz < 12 * 12) {
      this.hide()
      return true
    }
    return false
  }

  dispose(): void {
    this.root.dispose()
  }
}
