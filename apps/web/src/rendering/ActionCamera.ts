import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { Scene } from '@babylonjs/core/scene'
import { PostProcess } from '@babylonjs/core/PostProcesses/postProcess'
import { Effect } from '@babylonjs/core/Materials/effect'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import type { ParagliderSimulation } from '../physics/pendulum'

// GoPro / Action-Cam Fisheye Shader (Barrel Distortion + Chromatic Aberration + Vignette)
const fisheyeShaderCode = `
precision highp float;

varying vec2 vUV;
uniform sampler2D textureSampler;

uniform float aspectRatio;
uniform float strength;
uniform float chromaticAberration;
uniform float vignetteStrength;
uniform float zoom;

void main(void) {
  // Center UV at (0, 0)
  vec2 p = vUV - vec2(0.5);

  // Aspect-corrected coordinate for radially circular distortion
  vec2 coord = vec2(p.x * aspectRatio, p.y);
  float r = length(coord);
  float r2 = r * r;

  // Action-cam barrel distortion: expands outward towards frame periphery
  // Curves the horizon, mountain ridges, and paraglider lines
  float distortion = 1.0 + strength * r2 + (strength * 0.35) * (r2 * r2);

  // Zoom-compensated coordinates to fit screen without black borders
  vec2 dCoord = coord * distortion * zoom;

  // Base UV
  vec2 uvG = vec2(dCoord.x / aspectRatio, dCoord.y) + vec2(0.5);

  // Radial Chromatic Aberration (optical dispersion at wide angles)
  vec2 caOffset = coord * (chromaticAberration * r2);
  vec2 uvR = vec2((dCoord.x - caOffset.x) / aspectRatio, (dCoord.y - caOffset.y)) + vec2(0.5);
  vec2 uvB = vec2((dCoord.x + caOffset.x) / aspectRatio, (dCoord.y + caOffset.y)) + vec2(0.5);

  // Prevent wrapping artifacts
  uvR = clamp(uvR, vec2(0.001), vec2(0.999));
  uvG = clamp(uvG, vec2(0.001), vec2(0.999));
  uvB = clamp(uvB, vec2(0.001), vec2(0.999));

  float rCol = texture2D(textureSampler, uvR).r;
  float gCol = texture2D(textureSampler, uvG).g;
  float bCol = texture2D(textureSampler, uvB).b;
  vec3 color = vec3(rCol, gCol, bCol);

  // Optical lens vignetting (slight falloff in extreme periphery)
  float vignette = 1.0 - vignetteStrength * smoothstep(0.48, 1.25, r);
  color *= clamp(vignette, 0.0, 1.0);

  gl_FragColor = vec4(color, 1.0);
}
`

// Register shaders with Babylon.js Effect store
if (typeof Effect !== 'undefined') {
  Effect.ShadersStore['actionCamFisheyePixelShader'] = fisheyeShaderCode
  Effect.ShadersStore['actionCamFisheyeFragmentShader'] = fisheyeShaderCode
}

export type LensMode = 'action-cam' | 'subtle' | 'linear'
export type CameraVantage = 'selfie-pole' | 'helmet-fpv' | 'wide-chase'

export class ActionCamera {
  public camera: FreeCamera
  public postProcess: PostProcess
  public lensMode: LensMode = 'action-cam'
  public vantage: CameraVantage = 'selfie-pole'
  public fisheyeStrength: number = 0.28 // Authentic GoPro SuperView action-cam curvature
  public chromaticAberration: number = 0.0035 // Subtle optical glass dispersion
  public vignetteStrength: number = 0.34 // Peripheral lens shading
  private smoothedTarget: Vector3
  private smoothedCamPos: Vector3

  constructor(scene: Scene) {
    // Mount ultra-wide action camera behind pilot
    this.camera = new FreeCamera('action-camera', new Vector3(0, 1850, -5), scene)
    this.camera.fov = 1.62 // ~93° vertical / ~125° horizontal GoPro SuperView optics
    this.camera.minZ = 0.15
    this.camera.maxZ = 8500
    this.camera.inputs.clear() // Handled purely programmatically
    scene.activeCamera = this.camera

    this.smoothedTarget = new Vector3(0, 1850, 10)
    this.smoothedCamPos = new Vector3(0, 1850, -5)

    // Attach Fisheye Lens PostProcess to the Action Camera
    this.postProcess = new PostProcess(
      'actionCamFisheye',
      'actionCamFisheye',
      ['aspectRatio', 'strength', 'chromaticAberration', 'vignetteStrength', 'zoom'],
      null,
      1.0,
      this.camera,
      Texture.BILINEAR_SAMPLINGMODE,
      scene.getEngine(),
      false,
    )

    this.postProcess.onApply = (effect) => {
      const engine = scene.getEngine()
      const width = this.postProcess.width || engine.getRenderWidth()
      const height = this.postProcess.height || engine.getRenderHeight()
      const aspect = width / Math.max(1, height)

      // Closed-form safe zoom: Guarantees screen is 100% filled across any aspect ratio
      const rCorner = 0.5 * Math.sqrt(aspect * aspect + 1.0)
      const rCorner2 = rCorner * rCorner
      const cornerDist =
        1.0 + this.fisheyeStrength * rCorner2 + (this.fisheyeStrength * 0.35) * (rCorner2 * rCorner2)
      const safeZoom = 1.0 / Math.max(1.0, cornerDist)

      effect.setFloat('aspectRatio', aspect)
      effect.setFloat('strength', this.fisheyeStrength)
      effect.setFloat('chromaticAberration', this.chromaticAberration)
      effect.setFloat('vignetteStrength', this.vignetteStrength)
      effect.setFloat('zoom', safeZoom)
    }
  }

  public cycleLensMode(): LensMode {
    if (this.lensMode === 'action-cam') {
      this.setLensMode('subtle')
    } else if (this.lensMode === 'subtle') {
      this.setLensMode('linear')
    } else {
      this.setLensMode('action-cam')
    }
    return this.lensMode
  }

  public setLensMode(mode: LensMode) {
    this.lensMode = mode
    if (mode === 'action-cam') {
      this.fisheyeStrength = 0.28
      this.chromaticAberration = 0.0035
      this.vignetteStrength = 0.34
      this.camera.fov = this.vantage === 'helmet-fpv' ? 2.05 : 1.92
    } else if (mode === 'subtle') {
      this.fisheyeStrength = 0.14
      this.chromaticAberration = 0.0018
      this.vignetteStrength = 0.20
      this.camera.fov = this.vantage === 'helmet-fpv' ? 1.90 : 1.78
    } else {
      // Linear (Rectilinear)
      this.fisheyeStrength = 0.0
      this.chromaticAberration = 0.0
      this.vignetteStrength = 0.0
      this.camera.fov = this.vantage === 'helmet-fpv' ? 1.75 : 1.65
    }
  }

  public cycleVantage(): CameraVantage {
    if (this.vantage === 'selfie-pole') {
      this.setVantage('helmet-fpv')
    } else if (this.vantage === 'helmet-fpv') {
      this.setVantage('wide-chase')
    } else {
      this.setVantage('selfie-pole')
    }
    return this.vantage
  }

  public setVantage(v: CameraVantage) {
    this.vantage = v
    this.setLensMode(this.lensMode) // Reapply appropriate FOV
  }

  public update(sim: ParagliderSimulation, dt: number) {
    const pilotPos = new Vector3(sim.pilot.position.x, sim.pilot.position.y, sim.pilot.position.z)
    const canopyPos = new Vector3(sim.canopy.position.x, sim.canopy.position.y, sim.canopy.position.z)

    // Tether vector (from pilot carabiners up to canopy center)
    const tetherDiff = canopyPos.subtract(pilotPos)
    const tetherLen = tetherDiff.length()
    const uTether = tetherLen > 0.1 ? tetherDiff.scale(1 / tetherLen) : Vector3.Up()

    // Yaw heading of the glider
    const yawRad = (sim.canopy.yawDeg * Math.PI) / 180
    const hFwd = new Vector3(Math.sin(yawRad), 0, Math.cos(yawRad))

    // Construct orthonormal harness frame:
    // uRight = hFwd x uTether (normalized)
    const uRight = Vector3.Cross(hFwd, uTether).normalize()
    // uFwd = uTether x uRight (forward perpendicular to lines)
    const uFwd = Vector3.Cross(uTether, uRight).normalize()

    // Camera shake during full stall or high-speed dive
    const shake = Vector3.Zero()
    if (sim.isStalled) {
      shake.set(
        (Math.random() - 0.5) * 0.15,
        (Math.random() - 0.5) * 0.15,
        (Math.random() - 0.5) * 0.15,
      )
    } else if (sim.telemetry.airspeedKmh > 75) {
      const highSpeedShake = (sim.telemetry.airspeedKmh - 75) * 0.0018
      shake.set(
        (Math.random() - 0.5) * highSpeedShake,
        (Math.random() - 0.5) * highSpeedShake,
        0,
      )
    }

    let targetCamPos: Vector3
    let lookTarget: Vector3

    if (this.vantage === 'helmet-fpv') {
      // 1. Helmet Action Cam (First-Person):
      // Mounted on helmet forehead looking down and forward along flight path
      targetCamPos = pilotPos
        .add(uTether.scale(1.02))
        .add(uFwd.scale(0.18))
        .add(shake)

      lookTarget = pilotPos
        .add(uFwd.scale(18.0))
        .add(uTether.scale(1.0))
    } else if (this.vantage === 'wide-chase') {
      // 2. Wide Chase Cam:
      // Cinematic chase view 6.5m behind and 2.2m above
      targetCamPos = pilotPos
        .subtract(uFwd.scale(6.5))
        .add(uTether.scale(2.2))
        .add(shake)

      lookTarget = pilotPos
        .add(uFwd.scale(12.0))
        .add(uTether.scale(1.6))
    } else {
      // 3. Harness Selfie Pole / Action Follow Cam (Default - as in Facebook Reels):
      // Positioned 4.1m behind harness, elevated 1.35m above harness center
      // Frames the entire 8.8m speedwing overhead, with the pilot seated in authentic scale below!
      targetCamPos = pilotPos
        .subtract(uFwd.scale(4.1))
        .add(uTether.scale(1.35))
        .add(shake)

      lookTarget = pilotPos
        .add(uFwd.scale(14.0))
        .add(uTether.scale(2.2))
    }

    // Smooth spring interpolation for natural cinematic action-cam inertia
    const lerpSpeed = Math.min(1.0, 18.0 * dt)
    this.smoothedCamPos.x += (targetCamPos.x - this.smoothedCamPos.x) * lerpSpeed
    this.smoothedCamPos.y += (targetCamPos.y - this.smoothedCamPos.y) * lerpSpeed
    this.smoothedCamPos.z += (targetCamPos.z - this.smoothedCamPos.z) * lerpSpeed
    this.camera.position.copyFrom(this.smoothedCamPos)

    this.smoothedTarget.x += (lookTarget.x - this.smoothedTarget.x) * lerpSpeed
    this.smoothedTarget.y += (lookTarget.y - this.smoothedTarget.y) * lerpSpeed
    this.smoothedTarget.z += (lookTarget.z - this.smoothedTarget.z) * lerpSpeed

    this.camera.upVector.copyFrom(uTether)
    this.camera.setTarget(this.smoothedTarget)

    // Dynamic FOV: Widens slightly with forward airspeed for high-speed alpine tunnel vision
    const speedAboveTrim = Math.max(0, sim.telemetry.airspeedKmh - 55)
    const baseFov = this.vantage === 'helmet-fpv' ? 1.75 : 1.62
    const targetFov = baseFov + Math.min(0.18, speedAboveTrim * 0.003)
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1.0, 10 * dt)
  }
}
