import { Color4 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { SolidParticleSystem } from '@babylonjs/core/Particles/solidParticleSystem'
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial'
import { Effect } from '@babylonjs/core/Materials/effect'
import type { LinesMesh } from '@babylonjs/core/Meshes/linesMesh'
import type { Scene } from '@babylonjs/core/scene'
import type { ThermalZone, Vector3Like } from '../world/types'
import { calculateToroidalThermalFluid } from '../world/ThermalFluidDynamics'
import { LnPalette, LnStyleManager } from './LnStyleManager'

const SPLAT_VERTEX_SHADER = `
precision highp float;

attribute vec3 position;
attribute vec4 color;
attribute vec2 uv;

uniform mat4 worldViewProjection;

varying vec4 vColor;
varying vec2 vUV;

void main(void) {
    vColor = color;
    vUV = uv;
    gl_Position = worldViewProjection * vec4(position, 1.0);
}
`

const SPLAT_FRAGMENT_SHADER = `
precision highp float;

varying vec4 vColor;
varying vec2 vUV;

uniform float uIrIntensity;

void main(void) {
    // Coordinate relative to quad center in [-1, 1]
    vec2 centered = vUV * 2.0 - 1.0;
    float distSq = dot(centered, centered);
    if (distSq > 1.0) {
        discard;
    }

    // Analytical 3D Gaussian decay: exp(-3.0 * r^2) as used in Gaussian Splatting
    float gaussianAlpha = exp(-3.0 * distSq);
    float alpha = vColor.a * gaussianAlpha;

    vec3 rgb = vColor.rgb;
    if (uIrIntensity > 0.5) {
        // High-contrast radiometric glow in FLIR IR mode
        rgb *= 1.25;
    }

    gl_FragColor = vec4(rgb, alpha);
}
`

interface SplatMeta {
  assignedThermalIdx: number
  relRadiusFrac: number
  targetRadius: number
  baseAltitude: number
  azimuthRad: number
  baseScale: number
  speedMult: number
}

/**
 * 3D Toroidal Gaussian Splat Fluid Visualization System
 *
 * Inspired by Spirula Studio (Gaussian Splatting) & Hill's vortex convective physics.
 * Renders 1,400+ dynamic oriented Gaussian splats flowing along the 3D fluid vector field:
 * - Hot Convective Core: Incandescent White-Gold (+54°C)
 * - Buoyant Carousel: Flame Amber / Radiant Orange (+42°C)
 * - High-Shear Roll Margin: Radiant Magenta / Electric Violet (+28°C)
 * - Descending Cold Tail: Deep Translucent Cobalt / Cyan Blue (-4°C)
 * - Triboelectric Ionization Filaments arcing across the shear boundary
 */
export class ToroidalFluidSplatSystem {
  private scene: Scene
  private getThermals: () => ThermalZone[]
  private getGroundH: (x: number, z: number) => number
  private sps: SolidParticleSystem
  private splatMaterial: ShaderMaterial
  private splatMeta: SplatMeta[] = []
  private splatCount = 1400

  // Static electricity ionization filaments
  private arcMesh: LinesMesh
  private arcLines: Vector3[][] = []
  private arcColors: Color4[][] = []
  private arcCount = 28
  private arcTimer = 0

  private simulationTime = 0
  private unsubscribeStyle: () => void

  constructor(
    scene: Scene,
    getThermals: () => ThermalZone[],
    getGroundH: (x: number, z: number) => number,
  ) {
    this.scene = scene
    this.getThermals = getThermals
    this.getGroundH = getGroundH

    // 1. Register Shaders
    if (!Effect.ShadersStore['toroidalSplatVertexShader']) {
      Effect.ShadersStore['toroidalSplatVertexShader'] = SPLAT_VERTEX_SHADER
      Effect.ShadersStore['toroidalSplatFragmentShader'] = SPLAT_FRAGMENT_SHADER
    }

    this.splatMaterial = new ShaderMaterial(
      'toroidal-splat-mat',
      scene,
      {
        vertex: 'toroidalSplat',
        fragment: 'toroidalSplat',
      },
      {
        attributes: ['position', 'color', 'uv'],
        uniforms: ['worldViewProjection', 'uIrIntensity'],
        needAlphaBlending: true,
      },
    )
    this.splatMaterial.backFaceCulling = false
    this.splatMaterial.setFloat('uIrIntensity', LnStyleManager.getInstance().isIrGoggles ? 1.0 : 0.0)

    // 2. Build SolidParticleSystem (SPS)
    this.sps = new SolidParticleSystem('toroidal-splats-sps', scene, {
      updatable: true,
      isPickable: false,
    })

    const planeProto = MeshBuilder.CreatePlane('splat-quad', { size: 1.0 }, scene)
    this.sps.addShape(planeProto, this.splatCount)
    planeProto.dispose()

    const mesh = this.sps.buildMesh()
    mesh.material = this.splatMaterial
    mesh.isPickable = false
    mesh.alwaysSelectAsActiveMesh = true
    if (this.scene.activeCamera) {
      this.sps.billboard = true
    }

    // 3. Initialize Splat Distribution across active thermals
    this.initSplats()

    // 4. Build Static Electricity Ionization Filaments (Arc Lines)
    for (let i = 0; i < this.arcCount; i++) {
      const linePts = [new Vector3(0, 0, 0), new Vector3(0, 0, 0), new Vector3(0, 0, 0), new Vector3(0, 0, 0)]
      this.arcLines.push(linePts)
      this.arcColors.push([
        new Color4(0.4, 0.9, 1.0, 0.0),
        new Color4(0.9, 0.6, 1.0, 0.0),
        new Color4(1.0, 1.0, 1.0, 0.0),
        new Color4(0.2, 0.6, 1.0, 0.0),
      ])
    }

    this.arcMesh = MeshBuilder.CreateLineSystem(
      'electrostatic-arcs',
      {
        lines: this.arcLines,
        colors: this.arcColors,
        updatable: true,
      },
      scene,
    )
    this.arcMesh.isPickable = false
    this.arcMesh.alwaysSelectAsActiveMesh = true

    // 5. Subscribe to Visual Style Changes
    this.unsubscribeStyle = LnStyleManager.getInstance().subscribe((palette) => {
      this.applyPalette(palette)
    })
  }

  private initSplats() {
    const thermals = this.getThermals()
    const numThermals = Math.max(1, thermals.length)

    for (let i = 0; i < this.splatCount; i++) {
      const thIdx = i % numThermals
      const th = thermals[thIdx] ?? {
        center: { x: 0, y: 1000, z: 0 },
        radius: 300,
        topAltitude: 2600,
      }

      const groundH = this.getGroundH(th.center.x, th.center.z)
      const cloudbase = th.topAltitude ?? (th.center.y + 1500)
      const colHeight = Math.max(200, cloudbase - groundH)

      // Random distribution:
      // 35% in warm core (r <= 0.45 R)
      // 35% in convective carousel (0.45 R < r <= 0.95 R)
      // 30% in descending cold tail sink collar (0.95 R < r <= 1.40 R)
      let rFrac = 0
      const rPick = Math.random()
      if (rPick < 0.35) {
        rFrac = Math.sqrt(Math.random()) * 0.45
      } else if (rPick < 0.70) {
        rFrac = 0.45 + Math.random() * 0.50
      } else {
        rFrac = 0.95 + Math.random() * 0.45
      }

      const azimuth = Math.random() * Math.PI * 2
      const altFrac = Math.random()
      const y = groundH + 30 + altFrac * colHeight

      const expansion = 1.0 + 1.0 * altFrac
      const curRadius = th.radius * expansion
      const r = curRadius * rFrac

      const px = th.center.x + Math.cos(azimuth) * r
      const pz = th.center.z + Math.sin(azimuth) * r

      const particle = this.sps.particles[i]
      particle.position.set(px, y, pz)

      const baseScale = 22.0 + Math.random() * 16.0
      particle.scale.set(baseScale, baseScale, baseScale)

      this.splatMeta.push({
        assignedThermalIdx: thIdx,
        relRadiusFrac: rFrac,
        targetRadius: curRadius,
        baseAltitude: groundH,
        azimuthRad: azimuth,
        baseScale,
        speedMult: 0.85 + Math.random() * 0.35,
      })
    }

    this.sps.setParticles()
  }

  public applyPalette(pal: LnPalette): void {
    const isIr = pal.isIrVision === true
    this.splatMaterial.setFloat('uIrIntensity', isIr ? 1.0 : 0.0)
  }

  public update(dt: number, windVector?: Vector3Like, staticChargeField: number = 0): void {
    if (this.scene.activeCamera && !this.sps.billboard) {
      this.sps.billboard = true
    }

    this.simulationTime += dt
    const thermals = this.getThermals()
    if (!thermals || thermals.length === 0) return

    const lnStyle = LnStyleManager.getInstance()
    const isIr = lnStyle.isIrGoggles
    const isLine = lnStyle.palette.isLineMode

    const camPos = this.scene.activeCamera?.position

    // Update splats
    for (let i = 0; i < this.splatCount; i++) {
      const p = this.sps.particles[i]
      const meta = this.splatMeta[i]
      const th = thermals[meta.assignedThermalIdx] ?? thermals[0]

      const fluid = calculateToroidalThermalFluid(
        thermals,
        this.getGroundH,
        p.position.x,
        p.position.y,
        p.position.z,
        this.simulationTime,
        windVector,
      )

      // Move splat along 3D fluid velocity
      const vx = fluid.velocity.x * meta.speedMult
      const vy = fluid.velocity.y * meta.speedMult
      const vz = fluid.velocity.z * meta.speedMult

      p.position.x += vx * dt * 2.2
      p.position.y += vy * dt * 2.2
      p.position.z += vz * dt * 2.2

      // Check column bounds for recycling
      const groundH = this.getGroundH(th.center.x, th.center.z)
      const cloudbase = th.topAltitude ?? (th.center.y + 1500)

      const dx = p.position.x - th.center.x
      const dz = p.position.z - th.center.z
      const distHoriz = Math.hypot(dx, dz)
      const maxColRadius = th.radius * 2.4

      // Recycle if reached cloudbase, fallen below ground, or dispersed outside
      if (p.position.y > cloudbase + 80 || p.position.y < groundH + 15 || distHoriz > maxColRadius) {
        const altFrac = Math.random() * 0.25 // Reset toward base/inflow
        p.position.y = groundH + 20 + altFrac * (cloudbase - groundH)

        const resetRadiusPick = Math.random()
        let newRFrac = 0
        if (resetRadiusPick < 0.4) {
          newRFrac = Math.sqrt(Math.random()) * 0.45 // Core
        } else if (resetRadiusPick < 0.75) {
          newRFrac = 0.45 + Math.random() * 0.50 // Mid
        } else {
          newRFrac = 1.0 + Math.random() * 0.35 // Cold tail
        }
        meta.relRadiusFrac = newRFrac
        const azimuth = Math.random() * Math.PI * 2
        meta.azimuthRad = azimuth
        const r = th.radius * (1.0 + altFrac) * newRFrac

        p.position.x = th.center.x + Math.cos(azimuth) * r
        p.position.z = th.center.z + Math.sin(azimuth) * r
      }

      // Splat Elongation along 3D fluid velocity vector (Gaussian ellipsoid)
      const speed = Math.sqrt(vx * vx + vy * vy + vz * vz)
      const stretch = 1.0 + Math.min(2.8, speed * 0.32)
      p.scale.y = meta.baseScale * stretch
      p.scale.x = meta.baseScale * 0.82

      // Billboard rotation to align with fluid direction in screen/world space
      if (Math.abs(vx) + Math.abs(vz) > 0.05) {
        p.rotation.z = Math.atan2(vx, vy)
      }

      // Proximity culling: Keep visual field clear!
      // Only render subtle micro-wisps when within 80m of the pilot / camera
      let distToCam = 9999
      if (camPos) {
        const cdx = p.position.x - camPos.x
        const cdy = p.position.y - camPos.y
        const cdz = p.position.z - camPos.z
        distToCam = Math.sqrt(cdx * cdx + cdy * cdy + cdz * cdz)
      }

      if (!isIr && distToCam > 80.0) {
        // Completely transparent outside 80m proximity
        p.color = new Color4(0, 0, 0, 0)
        continue
      }

      // Color Coordination: Heat Signatures
      const tempDelta = fluid.temperatureAnomalyC
      const charge = fluid.staticChargeField

      if (isIr) {
        // FLIR Radiometric Thermal IR Palette
        if (tempDelta > 3.6) {
          p.color = new Color4(1.0, 0.98, 0.72, 0.72)
        } else if (tempDelta > 1.2) {
          p.color = new Color4(0.98, 0.56, 0.12, 0.62)
        } else if (charge > 0.42) {
          p.color = new Color4(0.85, 0.18, 0.78, 0.68)
        } else if (tempDelta < -0.6) {
          p.color = new Color4(0.08, 0.56, 0.95, 0.55)
        } else {
          p.color = new Color4(0.72, 0.65, 0.35, 0.32)
        }
      } else {
        // Subtle, delicate micro-wisps when within 80m of lift
        const proxFactor = Math.max(0, 1.0 - distToCam / 80.0)
        const alpha = proxFactor * 0.14
        if (isLine) {
          const pal = lnStyle.palette
          p.color = new Color4(pal.thermalStreamlineRgb.r, pal.thermalStreamlineRgb.g, pal.thermalStreamlineRgb.b, alpha)
        } else {
          p.color = new Color4(0.92, 0.94, 0.97, alpha)
        }
      }
    }

    this.sps.setParticles()

    // 6. Update Electrostatic Ionization Filaments (Arc Lines - only in IR mode)
    if (isIr) {
      this.arcMesh.isVisible = true
      this.updateElectrostaticArcs(dt, thermals, staticChargeField, isIr)
    } else {
      this.arcMesh.isVisible = false
    }
  }

  private updateElectrostaticArcs(
    dt: number,
    thermals: ThermalZone[],
    staticChargeField: number,
    isIr: boolean,
  ): void {
    this.arcTimer += dt
    // Regenerate arcs every 0.08s (flickering electric discharge)
    const shouldFlicker = this.arcTimer > 0.08
    if (shouldFlicker) {
      this.arcTimer = 0
    }

    const baseAlpha = Math.min(0.95, Math.max(0.12, staticChargeField * 0.95))
    const numThermals = thermals.length

    for (let a = 0; a < this.arcCount; a++) {
      if (shouldFlicker) {
        const th = thermals[a % numThermals]
        const groundH = this.getGroundH(th.center.x, th.center.z)
        const cloudbase = th.topAltitude ?? (th.center.y + 1500)

        // Arcs originate at the shear margin (r ~ 0.90 R) and arc across into the cold tail (r ~ 1.15 R)
        const altFrac = 0.25 + Math.random() * 0.65
        const curRadius = th.radius * (1.0 + 1.0 * altFrac)
        const arcY = groundH + altFrac * (cloudbase - groundH)

        const angle = Math.random() * Math.PI * 2
        const rStart = curRadius * (0.88 + Math.random() * 0.08) // Warm shear edge
        const rEnd = curRadius * (1.08 + Math.random() * 0.14) // Cold tail margin

        const startX = th.center.x + Math.cos(angle) * rStart
        const startZ = th.center.z + Math.sin(angle) * rStart
        const endX = th.center.x + Math.cos(angle + 0.15) * rEnd
        const endZ = th.center.z + Math.sin(angle + 0.15) * rEnd

        // 4 jagged points per filament
        const pts = this.arcLines[a]
        pts[0].set(startX, arcY, startZ)
        pts[1].set(
          startX + (endX - startX) * 0.33 + (Math.random() - 0.5) * 12.0,
          arcY + (Math.random() - 0.5) * 8.0,
          startZ + (endZ - startZ) * 0.33 + (Math.random() - 0.5) * 12.0,
        )
        pts[2].set(
          startX + (endX - startX) * 0.66 + (Math.random() - 0.5) * 12.0,
          arcY + (Math.random() - 0.5) * 8.0,
          startZ + (endZ - startZ) * 0.66 + (Math.random() - 0.5) * 12.0,
        )
        pts[3].set(endX, arcY + (Math.random() - 0.5) * 6.0, endZ)

        // Arc colors: electric cyan and violet ionization
        const colArray = this.arcColors[a]
        const colPick = Math.random()
        const colR = colPick > 0.5 ? 0.35 : 0.88
        const colG = colPick > 0.5 ? 0.88 : 0.42
        const colB = 1.0

        colArray[0].set(colR, colG, colB, 0.0)
        colArray[1].set(colR, colG, colB, baseAlpha)
        colArray[2].set(1.0, 1.0, 1.0, baseAlpha * 1.1) // Hot incandescent spark center
        colArray[3].set(colR, colG, colB, 0.0)
      }
    }

    if (shouldFlicker) {
      MeshBuilder.CreateLineSystem(
        'electrostatic-arcs',
        {
          lines: this.arcLines,
          colors: this.arcColors,
          instance: this.arcMesh,
        },
        this.scene,
      )
    }

    // Hide or show arcs depending on whether atmospheric charge is active
    this.arcMesh.setEnabled(staticChargeField > 0.08 || isIr)
  }

  public dispose(): void {
    this.unsubscribeStyle()
    this.sps.dispose()
    this.arcMesh.dispose()
    this.splatMaterial.dispose()
  }
}
