import { Color3 } from '@babylonjs/core/Maths/math.color'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { Scene } from '@babylonjs/core/scene'

/** Amber powered-wing pickup. Fly through it once and the throttle appears. */
export class PowerWingPickup {
  private root: TransformNode
  private ring: Mesh
  private blades: TransformNode
  private baseY = 0
  private spin = 0
  enabled = false

  constructor(scene: Scene) {
    this.root = new TransformNode('power-wing-pickup', scene)

    const ringMat = new StandardMaterial('power-wing-ring', scene)
    ringMat.diffuseColor = new Color3(0.95, 0.55, 0.08)
    ringMat.emissiveColor = new Color3(1, 0.62, 0.05)
    ringMat.specularColor = new Color3(0.45, 0.35, 0.1)

    const hubMat = new StandardMaterial('power-wing-hub', scene)
    hubMat.diffuseColor = new Color3(1, 0.92, 0.7)
    hubMat.emissiveColor = new Color3(1, 0.85, 0.45)

    const bladeMat = new StandardMaterial('power-wing-blade', scene)
    bladeMat.diffuseColor = new Color3(0.98, 0.78, 0.3)
    bladeMat.emissiveColor = new Color3(1, 0.72, 0.15)

    this.ring = MeshBuilder.CreateTorus(
      'power-wing-torus',
      { diameter: 16, thickness: 0.7, tessellation: 28 },
      scene,
    )
    this.ring.material = ringMat
    this.ring.parent = this.root

    const hub = MeshBuilder.CreateSphere('power-wing-hub', { diameter: 1.8, segments: 12 }, scene)
    hub.material = hubMat
    hub.parent = this.root

    this.blades = new TransformNode('power-wing-blades', scene)
    this.blades.parent = this.root
    for (const side of [-1, 1]) {
      const blade = MeshBuilder.CreateBox(
        'power-wing-blade',
        { width: 6.4, height: 0.22, depth: 0.85 },
        scene,
      )
      blade.material = bladeMat
      blade.position.x = side * 3.3
      blade.parent = this.blades
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
    this.spin += dt
    this.root.position.y = this.baseY + Math.sin(this.spin * 2.1) * 1.6
    this.ring.rotation.y += dt * 1.1
    this.ring.rotation.x = 1.15
    this.blades.rotation.z += dt * 9
    const dx = pilot.x - this.root.position.x
    const dy = pilot.y - this.root.position.y
    const dz = pilot.z - this.root.position.z
    if (dx * dx + dy * dy + dz * dz < 16 * 16) {
      this.hide()
      return true
    }
    return false
  }

  dispose(): void {
    this.root.dispose()
  }
}
