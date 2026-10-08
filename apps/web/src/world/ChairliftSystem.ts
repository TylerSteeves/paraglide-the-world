import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import type { Scene } from '@babylonjs/core/scene'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { WhistlerMountain } from './WhistlerMountain'

export type ChairliftTower = {
  position: Vector3
  topY: number
}

export class ChairliftSystem {
  public towers: ChairliftTower[] = []
  private spawnedMeshes: (Mesh | any)[] = []

  constructor(scene: Scene, mountain: WhistlerMountain) {
    const metalMat = new StandardMaterial('lift-metal-mat', scene)
    metalMat.diffuseColor = new Color3(0.42, 0.46, 0.50) // Galvanized steel
    metalMat.specularColor = new Color3(0.35, 0.35, 0.35)

    const cableMat = new StandardMaterial('lift-cable-mat', scene)
    cableMat.diffuseColor = new Color3(0.12, 0.14, 0.16)

    const chairMat = new StandardMaterial('lift-chair-mat', scene)
    chairMat.diffuseColor = new Color3(0.92, 0.18, 0.12) // High-vis alpine red chairs

    this.spawnedMeshes.push(metalMat, cableMat, chairMat)

    // 1. Build 10 Towers stretching up the Mountain Bowl parallel to the ski piste
    const towerZPositions = [180, 420, 680, 940, 1200, 1460, 1720, 1980, 2240, 2460]

    const towerTopPoints: Vector3[] = []

    for (let i = 0; i < towerZPositions.length; i++) {
      const z = towerZPositions[i]
      const pisteCenter = Math.sin(z * 0.0028) * 32.0
      const x = pisteCenter - 46.0 // 46m to the west flank of the ski run
      const groundY = mountain.sampleHeight(x, z)
      const towerHeight = 18.0 // 18m tall towers

      // Pylon Column
      const pylon = MeshBuilder.CreateCylinder(
        `lift-pylon-${i}`,
        { height: towerHeight, diameterTop: 0.9, diameterBottom: 1.6, tessellation: 6 },
        scene,
      )
      pylon.position.set(x, groundY + towerHeight * 0.5, z)
      pylon.material = metalMat
      this.spawnedMeshes.push(pylon)

      // Crossarm at the top
      const crossarm = MeshBuilder.CreateBox(
        `lift-crossarm-${i}`,
        { width: 5.8, height: 0.7, depth: 0.7 },
        scene,
      )
      crossarm.position.set(x, groundY + towerHeight, z)
      crossarm.material = metalMat
      this.spawnedMeshes.push(crossarm)

      const topPos = new Vector3(x, groundY + towerHeight, z)
      towerTopPoints.push(topPos)
      this.towers.push({ position: topPos, topY: groundY + towerHeight })

      // Hanging chairs along the span
      if (i > 0) {
        const prevTop = towerTopPoints[i - 1]
        for (let c = 1; c <= 2; c++) {
          const t = c / 3
          const chairPos = Vector3.Lerp(prevTop, topPos, t)
          const sag = Math.sin(t * Math.PI) * 4.2
          chairPos.y -= sag

          const chairStem = MeshBuilder.CreateCylinder(
            `chair-stem-${i}-${c}`,
            { height: 1.8, diameter: 0.08 },
            scene,
          )
          chairStem.position.set(chairPos.x, chairPos.y - 0.9, chairPos.z)
          chairStem.material = cableMat
          this.spawnedMeshes.push(chairStem)

          const chairBench = MeshBuilder.CreateBox(
            `chair-bench-${i}-${c}`,
            { width: 1.6, height: 0.35, depth: 0.7 },
            scene,
          )
          chairBench.position.set(chairPos.x, chairPos.y - 1.8, chairPos.z)
          chairBench.material = chairMat
          this.spawnedMeshes.push(chairBench)
        }
      }
    }

    // 2. Cables Running through all Tower Tops with Natural Catenary Sag
    const cablePointsLeft: Vector3[] = []
    const cablePointsRight: Vector3[] = []

    for (let i = 0; i < towerTopPoints.length - 1; i++) {
      const pA = towerTopPoints[i]
      const pB = towerTopPoints[i + 1]

      for (let s = 0; s <= 6; s++) {
        const t = s / 6
        const pt = Vector3.Lerp(pA, pB, t)
        const sag = Math.sin(t * Math.PI) * 3.8
        pt.y -= sag

        cablePointsLeft.push(new Vector3(pt.x - 2.2, pt.y, pt.z))
        cablePointsRight.push(new Vector3(pt.x + 2.2, pt.y, pt.z))
      }
    }

    const cableLeft = MeshBuilder.CreateTube(
      'lift-cable-left',
      { path: cablePointsLeft, radius: 0.06, tessellation: 4 },
      scene,
    )
    cableLeft.material = cableMat
    this.spawnedMeshes.push(cableLeft)

    const cableRight = MeshBuilder.CreateTube(
      'lift-cable-right',
      { path: cablePointsRight, radius: 0.06, tessellation: 4 },
      scene,
    )
    cableRight.material = cableMat
    this.spawnedMeshes.push(cableRight)
  }

  public dispose(): void {
    for (const m of this.spawnedMeshes) {
      if (m && m.dispose) m.dispose(false, true)
    }
    this.spawnedMeshes = []
  }
}
