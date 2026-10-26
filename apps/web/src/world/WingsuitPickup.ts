import { Color3 } from '@babylonjs/core/Maths/math.color'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Scene } from '@babylonjs/core/scene'

/** Wingsuit waiting in the updraft. Fly through it and the suit goes on. */
export class WingsuitPickup {
  private root: TransformNode
  private wing: TransformNode
  private baseY = 0
  private phase = 0
  enabled = false

  constructor(scene: Scene) {
    this.root = new TransformNode('wingsuit-pickup', scene)

    const ringMat = new StandardMaterial('wingsuit-ring', scene)
    ringMat.diffuseColor = new Color3(0.82, 0.9, 0.96)
    ringMat.emissiveColor = new Color3(0.45, 0.72, 0.95)
    ringMat.specularColor = new Color3(0.4, 0.45, 0.5)

    const membraneMat = new StandardMaterial('wingsuit-membrane', scene)
    membraneMat.diffuseColor = new Color3(0.93, 0.55, 0.28)
    membraneMat.emissiveColor = new Color3(0.72, 0.28, 0.08)
    membraneMat.specularColor = new Color3(0.35, 0.22, 0.12)
    membraneMat.backFaceCulling = false

    const bodyMat = new StandardMaterial('wingsuit-body', scene)
    bodyMat.diffuseColor = new Color3(0.96, 0.93, 0.86)
    bodyMat.emissiveColor = new Color3(0.55, 0.48, 0.32)

    const ring = MeshBuilder.CreateTorus(
      'wingsuit-torus',
      { diameter: 18, thickness: 0.55, tessellation: 28 },
      scene,
    )
    ring.material = ringMat
    ring.rotation.x = Math.PI / 2
    ring.parent = this.root

    this.wing = new TransformNode('wingsuit-wing', scene)
    this.wing.parent = this.root

    const body = MeshBuilder.CreateCapsule(
      'wingsuit-torso',
      { radius: 0.45, height: 2.4, tessellation: 8 },
      scene,
    )
    body.material = bodyMat
    body.rotation.x = Math.PI / 2
    body.parent = this.wing

    for (const side of [-1, 1] as const) {
      const panel = MeshBuilder.CreateBox(
        'wingsuit-panel',
        { width: 5.2, height: 0.12, depth: 1.7 },
        scene,
      )
      panel.material = membraneMat
      panel.position.x = side * 3.1
      panel.rotation.z = side * -0.18
      panel.parent = this.wing
    }

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
    this.phase += dt
    this.root.position.y = this.baseY + Math.sin(this.phase * 1.4) * 1.8
    this.wing.rotation.y += dt * 0.45
    this.wing.rotation.z = Math.sin(this.phase * 1.6) * 0.08
    const dx = pilot.x - this.root.position.x
    const dy = pilot.y - this.root.position.y
    const dz = pilot.z - this.root.position.z
    if (dx * dx + dy * dy + dz * dz < 18 * 18) {
      this.hide()
      return true
    }
    return false
  }

  dispose(): void {
    this.root.dispose()
  }
}
