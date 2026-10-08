import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Scene } from '@babylonjs/core/scene'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { LinesMesh } from '@babylonjs/core/Meshes/linesMesh'
import type { WorldId } from '../world/types'
import { LnPalette, LnStyleManager } from './LnStyleManager'

export interface SkyPalette {
  zenith: Color3
  midSky: Color3
  horizon: Color3
  hazeGround: Color3
  fogColor: Color3
  fogDensity: number
  sunColor: Color3
}

export const SKY_PRESETS: Record<WorldId, SkyPalette> = {
  // 🇨🇴 Roldanillo: Warm tropical valley atmosphere, golden thermal haze
  roldanillo: {
    zenith: new Color3(0.08, 0.32, 0.72),
    midSky: new Color3(0.38, 0.62, 0.88),
    horizon: new Color3(0.85, 0.88, 0.85),
    hazeGround: new Color3(0.65, 0.68, 0.60),
    fogColor: new Color3(0.78, 0.84, 0.86),
    fogDensity: 0.00012,
    sunColor: new Color3(1.0, 0.92, 0.78),
  },
  // 🇨🇦 Whistler: Crisp high-latitude alpine sky, cool crystalline air
  whistler: {
    zenith: new Color3(0.05, 0.24, 0.68),
    midSky: new Color3(0.32, 0.58, 0.88),
    horizon: new Color3(0.78, 0.85, 0.94),
    hazeGround: new Color3(0.60, 0.70, 0.80),
    fogColor: new Color3(0.74, 0.82, 0.92),
    fogDensity: 0.00010,
    sunColor: new Color3(1.0, 0.96, 0.88),
  },
  // 🇳🇵 Himalayas: Extreme high-altitude thin air, deep ultraviolet-cobalt zenith
  himalayas: {
    zenith: new Color3(0.03, 0.16, 0.52),
    midSky: new Color3(0.24, 0.48, 0.82),
    horizon: new Color3(0.82, 0.85, 0.90),
    hazeGround: new Color3(0.55, 0.58, 0.62),
    fogColor: new Color3(0.76, 0.82, 0.88),
    fogDensity: 0.00008,
    sunColor: new Color3(1.0, 0.98, 0.92),
  },
}

export class AtmosphericSky {
  private scene: Scene
  private skyDome: Mesh
  private skyMaterial: StandardMaterial
  private sunBillboard: Mesh
  private sunMat: StandardMaterial
  private celestialGridMesh: LinesMesh | null = null
  private cloudbaseGridMesh: LinesMesh | null = null
  private currentWorldId: WorldId = 'roldanillo'
  private unsubscribeStyle: () => void

  constructor(scene: Scene, initialWorld: WorldId = 'roldanillo') {
    this.scene = scene
    this.currentWorldId = initialWorld

    // 1. Build Inverted Hemispherical Sky Dome (diameter 16,000m)
    this.skyDome = MeshBuilder.CreateSphere(
      'atmospheric-sky-dome',
      { diameter: 16000, segments: 24, sideOrientation: 1 },
      scene,
    )
    this.skyDome.infiniteDistance = true
    this.skyDome.renderingGroupId = 0

    this.skyMaterial = new StandardMaterial('atmospheric-sky-mat', scene)
    this.skyMaterial.disableLighting = true
    this.skyMaterial.backFaceCulling = false
    this.skyMaterial.specularColor = new Color3(0, 0, 0)
    this.skyDome.material = this.skyMaterial

    // 2. Build Sun Glowing Orb
    this.sunBillboard = MeshBuilder.CreateDisc(
      'sun-orb',
      { radius: 240, tessellation: 32 },
      scene,
    )
    this.sunMat = new StandardMaterial('sun-mat', scene)
    this.sunMat.emissiveColor = new Color3(1.0, 0.98, 0.85)
    this.sunMat.disableLighting = true
    this.sunBillboard.material = this.sunMat
    this.sunBillboard.infiniteDistance = true
    this.sunBillboard.position = new Vector3(4500, 3200, -2800)
    this.sunBillboard.billboardMode = Mesh.BILLBOARDMODE_ALL

    // 3. Build Celestial Lines & Cloudbase Ceiling Grid for LN Line Mode
    this.buildCelestialLines()
    this.buildCloudbaseGrid()

    // 4. Configure Atmospheric Fog on Scene
    scene.fogMode = Scene.FOGMODE_EXP2

    // Subscribe to style changes
    this.unsubscribeStyle = LnStyleManager.getInstance().subscribe((palette) => {
      this.applyPalette(palette)
    })

    this.applyWorld(initialWorld)
  }

  private buildCelestialLines(): void {
    const lines: Vector3[][] = []
    const R = 7500

    // Horizon Ring with Compass Ticks
    const horizonRing: Vector3[] = []
    for (let a = 0; a <= 360; a += 5) {
      const rad = (a * Math.PI) / 180
      const pt = new Vector3(Math.cos(rad) * R, 0, Math.sin(rad) * R)
      horizonRing.push(pt)

      // Compass Cardinal & Major Ticks
      if (a % 15 === 0) {
        const tickHeight = a % 90 === 0 ? 180 : 80
        lines.push([pt, new Vector3(Math.cos(rad) * R, tickHeight, Math.sin(rad) * R)])
      }
    }
    lines.push(horizonRing)

    // Celestial Elevation Rings at 30° and 60°
    const ring30: Vector3[] = []
    const ring60: Vector3[] = []
    const r30 = R * Math.cos((30 * Math.PI) / 180)
    const y30 = R * Math.sin((30 * Math.PI) / 180)
    const r60 = R * Math.cos((60 * Math.PI) / 180)
    const y60 = R * Math.sin((60 * Math.PI) / 180)

    for (let a = 0; a <= 360; a += 10) {
      const rad = (a * Math.PI) / 180
      ring30.push(new Vector3(Math.cos(rad) * r30, y30, Math.sin(rad) * r30))
      ring60.push(new Vector3(Math.cos(rad) * r60, y60, Math.sin(rad) * r60))
    }
    lines.push(ring30)
    lines.push(ring60)

    // Sun Arc (Solar Path Meridian)
    const sunArc: Vector3[] = []
    for (let t = -90; t <= 90; t += 5) {
      const rad = (t * Math.PI) / 180
      sunArc.push(new Vector3(Math.sin(rad) * R * 0.8, Math.cos(rad) * R * 0.85, -Math.sin(rad) * R * 0.5))
    }
    lines.push(sunArc)

    this.celestialGridMesh = MeshBuilder.CreateLineSystem(
      'lineart-celestial-grid',
      { lines, updatable: true },
      this.scene,
    )
    this.celestialGridMesh.infiniteDistance = true
    this.celestialGridMesh.renderingGroupId = 0
  }

  private buildCloudbaseGrid(): void {
    const lines: Vector3[][] = []
    const cloudbaseY = 2450 // Real-world cloudbase inversion height in meters
    const extent = 5000
    const step = 250

    // Square contour grid lines forming cloud ceiling
    for (let x = -extent; x <= extent; x += step) {
      lines.push([new Vector3(x, cloudbaseY, -extent), new Vector3(x, cloudbaseY, extent)])
    }
    for (let z = -extent; z <= extent; z += step) {
      lines.push([new Vector3(-extent, cloudbaseY, z), new Vector3(extent, cloudbaseY, z)])
    }

    this.cloudbaseGridMesh = MeshBuilder.CreateLineSystem(
      'lineart-cloudbase-grid',
      { lines, updatable: true },
      this.scene,
    )
  }

  public applyPalette(pal: LnPalette): void {
    if (pal.isIrVision) {
      // Infrared FLIR Sky: Cryogenic obsidian zenith to amethyst horizon
      const irZenith = new Color3(0.015, 0.005, 0.06)
      const irMid = new Color3(0.08, 0.03, 0.18)
      const irHorizon = new Color3(0.18, 0.08, 0.32)

      const positions = this.skyDome.getVerticesData(VertexBuffer.PositionKind)
      if (positions) {
        const colors: number[] = []
        const radius = 8000
        for (let i = 0; i < positions.length; i += 3) {
          const y = positions[i + 1]
          const normY = Math.max(-1, Math.min(1, y / radius))
          let c: Color3
          if (normY > 0.35) {
            const t = (normY - 0.35) / 0.65
            c = Color3.Lerp(irMid, irZenith, t)
          } else if (normY >= 0.0) {
            const t = normY / 0.35
            c = Color3.Lerp(irHorizon, irMid, t)
          } else {
            c = irHorizon
          }
          colors.push(c.r, c.g, c.b, 1.0)
        }
        this.skyDome.setVerticesData(VertexBuffer.ColorKind, colors, true)
      }

      this.scene.clearColor = irZenith.toColor4(1.0)
      this.scene.fogColor = irHorizon
      this.scene.fogDensity = 0.00016
      this.sunMat.emissiveColor = new Color3(1.0, 0.98, 0.90)

      if (this.celestialGridMesh) {
        this.celestialGridMesh.color = new Color3(0.25, 0.65, 0.85)
        this.celestialGridMesh.setEnabled(true)
      }
      if (this.cloudbaseGridMesh) {
        this.cloudbaseGridMesh.color = new Color3(0.95, 0.35, 0.15)
        this.cloudbaseGridMesh.setEnabled(true)
      }
    } else if (pal.isLineMode) {
      // Line Mode: Set background paper/void uniform tone
      const positions = this.skyDome.getVerticesData(VertexBuffer.PositionKind)
      if (positions) {
        const colors: number[] = []
        for (let i = 0; i < positions.length; i += 3) {
          colors.push(pal.backgroundRgb.r, pal.backgroundRgb.g, pal.backgroundRgb.b, 1.0)
        }
        this.skyDome.setVerticesData(VertexBuffer.ColorKind, colors, true)
      }

      this.scene.clearColor = pal.backgroundRgb.toColor4(1.0)
      this.scene.fogColor = pal.backgroundRgb
      this.scene.fogDensity = pal.fogDensity

      // Sun disc styling in Line Mode
      this.sunMat.emissiveColor = pal.majorContourRgb

      // Enable Celestial Grid and Cloudbase Grid
      if (this.celestialGridMesh) {
        this.celestialGridMesh.color = pal.celestialGridRgb
        this.celestialGridMesh.setEnabled(true)
      }
      if (this.cloudbaseGridMesh) {
        this.cloudbaseGridMesh.color = pal.celestialGridRgb
        this.cloudbaseGridMesh.setEnabled(true)
      }
    } else {
      // Photoreal Mode: Restore Rayleigh atmospheric scattering gradient
      if (this.celestialGridMesh) this.celestialGridMesh.setEnabled(false)
      if (this.cloudbaseGridMesh) this.cloudbaseGridMesh.setEnabled(false)
      this.sunMat.emissiveColor = new Color3(1.0, 0.98, 0.85)
      this.applyWorld(this.currentWorldId)
    }
  }

  public applyWorld(worldId: WorldId) {
    this.currentWorldId = worldId
    const pal = LnStyleManager.getInstance().palette

    if (pal.isLineMode) {
      this.applyPalette(pal)
      return
    }

    const palette = SKY_PRESETS[worldId] || SKY_PRESETS.roldanillo

    // Paint Sky Dome vertices with Rayleigh atmospheric scattering gradient
    const positions = this.skyDome.getVerticesData(VertexBuffer.PositionKind)
    if (positions) {
      const colors: number[] = []
      const radius = 8000

      for (let i = 0; i < positions.length; i += 3) {
        const y = positions[i + 1]
        const normY = Math.max(-1, Math.min(1, y / radius))

        let c: Color3
        if (normY > 0.35) {
          const t = (normY - 0.35) / 0.65
          c = Color3.Lerp(palette.midSky, palette.zenith, t)
        } else if (normY >= 0.0) {
          const t = normY / 0.35
          c = Color3.Lerp(palette.horizon, palette.midSky, t)
        } else {
          const t = Math.min(1, Math.abs(normY) * 2.5)
          c = Color3.Lerp(palette.horizon, palette.hazeGround, t)
        }

        colors.push(c.r, c.g, c.b, 1.0)
      }

      this.skyDome.setVerticesData(VertexBuffer.ColorKind, colors, true)
    }

    // Set Scene Fog
    this.scene.fogColor = palette.fogColor
    this.scene.fogDensity = palette.fogDensity
    this.scene.clearColor = palette.horizon.toColor4(1.0)
  }

  public update(pilotPos: Vector3) {
    // Keep sun billboard relative to camera view
    this.sunBillboard.position.x = pilotPos.x + 4500
    this.sunBillboard.position.y = pilotPos.y + 3200
    this.sunBillboard.position.z = pilotPos.z - 2800

    if (this.cloudbaseGridMesh) {
      // Cloudbase grid gently floats above pilot
      this.cloudbaseGridMesh.position.x = Math.floor(pilotPos.x / 250) * 250
      this.cloudbaseGridMesh.position.z = Math.floor(pilotPos.z / 250) * 250
    }
  }

  public dispose() {
    this.unsubscribeStyle()
    this.skyDome.dispose()
    this.sunBillboard.dispose()
    if (this.celestialGridMesh) this.celestialGridMesh.dispose()
    if (this.cloudbaseGridMesh) this.cloudbaseGridMesh.dispose()
  }
}

