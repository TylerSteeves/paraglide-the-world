import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { Material } from '@babylonjs/core/Materials/material'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture'
import type { Scene } from '@babylonjs/core/scene'
import type { NamedStreet } from './GodsEyeGlobeEngine'

export type StreetAnchor = { x: number; y: number; z: number }

/**
 * Street names painted on the road. They lie flat and run along the street.
 * `corridorHeadingDeg` is the compass bearing of local +Z.
 */
export class StreetNameLayer {
  private meshes: Mesh[] = []
  private materials: StandardMaterial[] = []
  private textures: DynamicTexture[] = []

  constructor(private scene: Scene) {}

  public setStreets(
    streets: NamedStreet[],
    anchor: (lat: number, lon: number) => StreetAnchor,
    corridorHeadingDeg: number,
  ): void {
    this.dispose()
    for (let i = 0; i < streets.length; i++) {
      const street = streets[i]
      const at = anchor(street.lat, street.lon)
      const tex = new DynamicTexture(`street-tex-${i}`, { width: 512, height: 128 }, this.scene, false)
      tex.hasAlpha = true
      const ctx = tex.getContext() as unknown as CanvasRenderingContext2D
      ctx.clearRect(0, 0, 512, 128)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      let fontPx = 84
      ctx.font = `700 ${fontPx}px system-ui, sans-serif`
      while (ctx.measureText(street.name).width > 490 && fontPx > 36) {
        fontPx -= 4
        ctx.font = `700 ${fontPx}px system-ui, sans-serif`
      }
      ctx.lineWidth = Math.max(8, fontPx * 0.14)
      ctx.lineJoin = 'round'
      ctx.strokeStyle = 'rgba(2, 6, 23, 0.92)'
      ctx.strokeText(street.name, 256, 64)
      ctx.fillStyle = '#f8fafc'
      ctx.fillText(street.name, 256, 64)
      tex.update()

      const textPx = Math.max(1, ctx.measureText(street.name).width)
      const letterM =
        street.roadClass === 'motorway' || street.roadClass === 'trunk'
          ? 20
          : street.roadClass === 'primary' || street.roadClass === 'secondary'
            ? 15
            : 11
      const alongM = letterM * (textPx / fontPx)

      const mat = new StandardMaterial(`street-mat-${i}`, this.scene)
      mat.diffuseColor = Color3.Black()
      mat.emissiveTexture = tex
      mat.opacityTexture = tex
      mat.disableLighting = true
      mat.backFaceCulling = true
      mat.specularColor = Color3.Black()
      mat.transparencyMode = Material.MATERIAL_ALPHATESTANDBLEND
      mat.alphaCutOff = 0.4

      const plane = MeshBuilder.CreateGround(
        `street-${i}`,
        { width: alongM * (512 / textPx), height: letterM * (128 / fontPx) },
        this.scene,
      )
      plane.material = mat
      plane.position.set(at.x, at.y, at.z)
      plane.rotation.y = labelYawRad(street.bearingDeg, corridorHeadingDeg)
      plane.isPickable = false

      this.textures.push(tex)
      this.materials.push(mat)
      this.meshes.push(plane)
    }
  }

  public dispose(): void {
    for (const mesh of this.meshes) mesh.dispose()
    for (const mat of this.materials) mat.dispose()
    for (const tex of this.textures) tex.dispose()
    this.meshes = []
    this.materials = []
    this.textures = []
  }
}

/** Yaw that lays the label along the street, tops of the letters toward north. */
function labelYawRad(bearingDeg: number, corridorHeadingDeg: number): number {
  const heading = (corridorHeadingDeg * Math.PI) / 180
  const rel = ((bearingDeg - corridorHeadingDeg) * Math.PI) / 180
  let theta = Math.atan2(-Math.cos(rel), Math.sin(rel))
  const upNorth = Math.cos(theta + heading)
  const readNorth = -Math.sin(theta + heading)
  if (upNorth < -0.02 || (Math.abs(upNorth) <= 0.02 && readNorth < 0)) theta += Math.PI
  return theta
}
