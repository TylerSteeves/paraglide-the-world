import { Color4 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { LinesMesh } from '@babylonjs/core/Meshes/linesMesh'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { Scene } from '@babylonjs/core/scene'
import '@babylonjs/core/Rendering/edgesRenderer'
import { LnPalette, LnStyleManager } from './LnStyleManager'
import { TopographicLineMaterial } from './TopographicLineMaterial'
import type { WorldId } from '../world/types'

export class LineArtTerrain {
  private scene: Scene
  private terrainMesh: Mesh
  private topoMaterial: TopographicLineMaterial
  private ridgeLinesMesh: LinesMesh | null = null
  private triggerOutlinesMesh: LinesMesh | null = null
  private unsubscribeStyle: () => void

  constructor(scene: Scene, terrainMesh: Mesh, worldId: WorldId) {
    this.scene = scene
    this.terrainMesh = terrainMesh

    // Attach Topographic Line Shader Material
    this.topoMaterial = new TopographicLineMaterial('terrain-topo-mat', scene)
    this.terrainMesh.material = this.topoMaterial.material

    // Enable sharp geometric crease edge rendering on the terrain mesh
    try {
      this.terrainMesh.enableEdgesRendering(0.92) // Angle threshold for ridge creases
      this.terrainMesh.edgesWidth = 1.8
    } catch (e) {
      console.warn('Terrain edges renderer warning:', e)
    }

    // Generate physical vector line systems (Ridge crests and thermal trigger outlines)
    this.buildRidgeCrestLines(worldId)
    this.buildTriggerOutlines(worldId)

    // Subscribe to style changes
    this.unsubscribeStyle = LnStyleManager.getInstance().subscribe((palette) => {
      this.applyPalette(palette)
    })
  }

  private buildRidgeCrestLines(worldId: WorldId): void {
    if (this.ridgeLinesMesh) {
      this.ridgeLinesMesh.dispose()
      this.ridgeLinesMesh = null
    }

    const ridgePaths: Vector3[][] = []

    if (worldId === 'roldanillo') {
      // Roldanillo main launch ridge crest & canyon cliffs
      const crestPath: Vector3[] = []
      for (let x = -3800; x <= 3800; x += 60) {
        // Parametric backbone of the launch mountain
        const z = -200 + Math.sin(x * 0.0012) * 180 + Math.sin(x * 0.0035) * 80
        const y = 1860 - Math.pow(Math.abs(x) / 3800, 1.8) * 620 + Math.sin(x * 0.005) * 45
        crestPath.push(new Vector3(x, y + 1.2, z))
      }
      ridgePaths.push(crestPath)

      // Canyon gorge rims
      const canyonWest: Vector3[] = []
      const canyonEast: Vector3[] = []
      for (let dist = -400; dist <= 400; dist += 40) {
        canyonWest.push(new Vector3(-650 - 140, 1250 - Math.abs(dist) * 0.4, 350 + dist))
        canyonEast.push(new Vector3(-650 + 140, 1250 - Math.abs(dist) * 0.4, 350 + dist))
      }
      ridgePaths.push(canyonWest)
      ridgePaths.push(canyonEast)
    } else if (worldId === 'whistler') {
      // Whistler peak razor-spine
      const crestWhistler: Vector3[] = []
      for (let t = -2400; t <= 2400; t += 50) {
        const x = t
        const z = Math.sin(t * 0.0015) * 320
        const y = 2182 - Math.pow(Math.abs(t) / 2400, 2.0) * 850
        crestWhistler.push(new Vector3(x, y + 1.5, z))
      }
      ridgePaths.push(crestWhistler)
    } else {
      // Himalayas extreme high spine
      const himalayasSpine: Vector3[] = []
      for (let t = -4200; t <= 4200; t += 70) {
        const x = t
        const z = -400 + Math.sin(t * 0.0008) * 600
        const y = 3280 - Math.pow(Math.abs(t) / 4200, 1.6) * 1200
        himalayasSpine.push(new Vector3(x, y + 2.0, z))
      }
      ridgePaths.push(himalayasSpine)
    }

    if (ridgePaths.length > 0) {
      this.ridgeLinesMesh = MeshBuilder.CreateLineSystem(
        'lineart-ridge-crests',
        { lines: ridgePaths, updatable: true },
        this.scene,
      )
    }
  }

  private buildTriggerOutlines(worldId: WorldId): void {
    if (this.triggerOutlinesMesh) {
      this.triggerOutlinesMesh.dispose()
      this.triggerOutlinesMesh = null
    }

    const outlines: Vector3[][] = []

    if (worldId === 'roldanillo') {
      // Solar Farm rectangular boundary
      const sX = -500
      const sZ = 2400
      const sY = 966 + 1.0
      const sW = 220
      const sH = 160
      outlines.push([
        new Vector3(sX - sW, sY, sZ - sH),
        new Vector3(sX + sW, sY, sZ - sH),
        new Vector3(sX + sW, sY, sZ + sH),
        new Vector3(sX - sW, sY, sZ + sH),
        new Vector3(sX - sW, sY, sZ - sH),
      ])

      // Industrial Roofs outline
      const rX = 300
      const rZ = 1400
      const rY = 964 + 1.0
      const rW = 160
      const rH = 120
      outlines.push([
        new Vector3(rX - rW, rY, rZ - rH),
        new Vector3(rX + rW, rY, rZ - rH),
        new Vector3(rX + rW, rY, rZ + rH),
        new Vector3(rX - rW, rY, rZ + rH),
        new Vector3(rX - rW, rY, rZ - rH),
      ])

      // Launch Pad circle on summit
      const launchCircle: Vector3[] = []
      const lX = 0
      const lZ = -120
      const lY = 1860 + 1.0
      const lR = 45
      for (let a = 0; a <= 360; a += 15) {
        const rad = (a * Math.PI) / 180
        launchCircle.push(new Vector3(lX + Math.cos(rad) * lR, lY, lZ + Math.sin(rad) * lR))
      }
      outlines.push(launchCircle)
    }

    if (outlines.length > 0) {
      this.triggerOutlinesMesh = MeshBuilder.CreateLineSystem(
        'lineart-trigger-outlines',
        { lines: outlines, updatable: true },
        this.scene,
      )
    }
  }

  public applyPalette(pal: LnPalette): void {
    this.topoMaterial.applyPalette(pal)

    // Update edge rendering color
    try {
      const edgeCol = pal.ridgeEdgeRgb
      this.terrainMesh.edgesColor = new Color4(edgeCol.r, edgeCol.g, edgeCol.b, pal.isLineMode ? 0.95 : 0.4)
      this.terrainMesh.edgesWidth = pal.isLineMode ? 2.2 : 1.2
    } catch {}

    if (this.ridgeLinesMesh) {
      this.ridgeLinesMesh.color = pal.ridgeEdgeRgb
      this.ridgeLinesMesh.setEnabled(pal.isLineMode)
    }

    if (this.triggerOutlinesMesh) {
      this.triggerOutlinesMesh.color = pal.majorContourRgb
      this.triggerOutlinesMesh.setEnabled(pal.isLineMode)
    }
  }

  public update(cameraPosition: Vector3): void {
    this.topoMaterial.update(cameraPosition)
  }

  public dispose(): void {
    this.unsubscribeStyle()
    this.topoMaterial.dispose()
    if (this.ridgeLinesMesh) this.ridgeLinesMesh.dispose()
    if (this.triggerOutlinesMesh) this.triggerOutlinesMesh.dispose()
  }
}
