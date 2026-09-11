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

  // Optical lens vignetting
  float vignette = 1.0 - vignetteStrength * smoothstep(0.48, 1.25, r);
  color *= clamp(vignette, 0.0, 1.0);

  gl_FragColor = vec4(color, 1.0);
}
`

if (typeof Effect !== 'undefined') {
  Effect.ShadersStore['actionCamFisheyePixelShader'] = fisheyeShaderCode
  Effect.ShadersStore['actionCamFisheyeFragmentShader'] = fisheyeShaderCode
}

export type LensMode = 'action-cam' | 'subtle' | 'linear'
export type CameraVantage = 'pilot-fpv' | 'shoulder-chase' | 'front-selfie' | 'wide-chase'

export class ActionCamera {
  public camera: FreeCamera
  public postProcess: PostProcess
  public lensMode: LensMode = 'action-cam'
  public vantage: CameraVantage = 'pilot-fpv'
  public fisheyeStrength: number = 0.28 // Authentic GoPro SuperView action-cam curvature
  public chromaticAberration: number = 0.0035 // Optical glass dispersion
  public vignetteStrength: number = 0.34 // Peripheral lens shading
  private smoothedTarget: Vector3
  private smoothedCamPos: Vector3
  private targetCamPos: Vector3
  private lookTarget: Vector3

  constructor(scene: Scene) {
    this.camera = new FreeCamera('action-camera', new Vector3(0, 2050, -5), scene)
    this.camera.fov = 1.95
    this.camera.minZ = 0.05
    this.camera.maxZ = 9500
    this.camera.inputs.clear()
    scene.activeCamera = this.camera

    this.smoothedTarget = new Vector3(0, 2050, 10)
    this.smoothedCamPos = new Vector3(0, 2050, -5)
    this.targetCamPos = new Vector3(0, 2050, -5)
    this.lookTarget = new Vector3(0, 2050, 10)

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
      this.camera.fov = 1.95
    } else if (mode === 'subtle') {
      this.fisheyeStrength = 0.14
      this.chromaticAberration = 0.0018
      this.vignetteStrength = 0.20
      this.camera.fov = 1.80
    } else {
      this.fisheyeStrength = 0.0
      this.chromaticAberration = 0.0
      this.vignetteStrength = 0.0
      this.camera.fov = 1.65
    }
  }

  public cycleVantage(): CameraVantage {
    if (this.vantage === 'pilot-fpv') {
      this.setVantage('shoulder-chase')
    } else if (this.vantage === 'shoulder-chase') {
      this.setVantage('front-selfie')
    } else if (this.vantage === 'front-selfie') {
      this.setVantage('wide-chase')
    } else {
      this.setVantage('pilot-fpv')
    }
    return this.vantage
  }

  public setVantage(v: CameraVantage) {
    this.vantage = v
    this.setLensMode(this.lensMode)
  }

  public snap() {
    this.smoothedCamPos.copyFrom(this.targetCamPos)
    this.smoothedTarget.copyFrom(this.lookTarget)
    this.camera.position.copyFrom(this.targetCamPos)
    this.camera.setTarget(this.lookTarget)
  }

  public update(sim: ParagliderSimulation, dt: number) {
    const pilotPos = new Vector3(sim.pilot.position.x, sim.pilot.position.y, sim.pilot.position.z)
    const canopyPos = new Vector3(sim.canopy.position.x, sim.canopy.position.y, sim.canopy.position.z)

    // Tether vector (points up along suspension lines toward canopy)
    const tetherDiff = canopyPos.subtract(pilotPos)
    const tetherLen = tetherDiff.length()
    const uTether = tetherLen > 0.1 ? tetherDiff.scale(1 / tetherLen) : Vector3.Up()

    // Glider forward heading vector
    const yawRad = (sim.canopy.yawDeg * Math.PI) / 180
    const hFwd = new Vector3(Math.sin(yawRad), 0, Math.cos(yawRad))

    const uRight = Vector3.Cross(hFwd, uTether).normalize()
    const uFwd = Vector3.Cross(uTether, uRight).normalize()

    // Pilot body orientation (supporting 180° reverse stance swivel)
    const reverseYawRad = ((sim.pilot.reverseStanceYawDeg || 0) * Math.PI) / 180
    const bodyFwd = uFwd.scale(Math.cos(reverseYawRad)).add(uRight.scale(Math.sin(reverseYawRad)))

    // Camera shake during full stall or high-speed dive
    const shake = Vector3.Zero()
    if (sim.isStalled || sim.isLinesSlack) {
      shake.set(
        (Math.random() - 0.5) * 0.18,
        (Math.random() - 0.5) * 0.18,
        (Math.random() - 0.5) * 0.18,
      )
    } else if (sim.telemetry.airspeedKmh > 75) {
      const highSpeedShake = (sim.telemetry.airspeedKmh - 75) * 0.0018
      shake.set(
        (Math.random() - 0.5) * highSpeedShake,
        (Math.random() - 0.5) * highSpeedShake,
        0,
      )
    }

    if (this.vantage === 'pilot-fpv') {
      // 1. First-Person Pilot Chest / Mouth Mount (Reference Reel: media_1789151841324.jpg):
      // Mounted right at chest harness forward point, angled downward ~16° to frame outstretched legs & running shoes in foreground!
      this.targetCamPos = pilotPos
        .add(uTether.scale(0.58))
        .add(bodyFwd.scale(0.36))
        .add(shake)

      this.lookTarget = this.targetCamPos
        .add(bodyFwd.scale(16.0))
        .subtract(uTether.scale(4.2))
    } else if (this.vantage === 'shoulder-chase') {
      // 2. Over-the-Shoulder Action Chase (Reference Reel media_1789151847537.jpg):
      // Mounted 2.1m behind and 1.05m to the right, framing helmet, arms on brake toggles, and terrain!
      this.targetCamPos = pilotPos
        .subtract(uFwd.scale(2.1))
        .add(uRight.scale(1.05))
        .add(uTether.scale(1.10))
        .add(shake)

      this.lookTarget = pilotPos
        .add(uFwd.scale(18.0))
        .add(uRight.scale(0.32))
        .subtract(uTether.scale(0.4))
    } else if (this.vantage === 'front-selfie') {
      // 3. Action Selfie Pole (Reference Reel media_1789151832334.jpg & acro tumbling):
      // 2.9m in front on selfie pole, looking back at shoes, pilot, and the speedwing canopy!
      this.targetCamPos = pilotPos
        .add(uFwd.scale(2.9))
        .add(uTether.scale(0.25))
        .add(shake)

      this.lookTarget = pilotPos
        .add(uTether.scale(1.55))
    } else {
      // 4. Wide 3rd-Person Cinematic Chase:
      // Framed 6.2m behind and 2.4m up, viewing the entire speedwing, suspension lines, and landscape
      this.targetCamPos = pilotPos
        .subtract(uFwd.scale(6.2))
        .add(uTether.scale(2.4))
        .add(shake)

      this.lookTarget = pilotPos
        .add(uFwd.scale(12.0))
        .add(uTether.scale(2.2))
    }

    const lerpSpeed = Math.min(1.0, 22.0 * dt)
    this.smoothedCamPos.x += (this.targetCamPos.x - this.smoothedCamPos.x) * lerpSpeed
    this.smoothedCamPos.y += (this.targetCamPos.y - this.smoothedCamPos.y) * lerpSpeed
    this.smoothedCamPos.z += (this.targetCamPos.z - this.smoothedCamPos.z) * lerpSpeed
    this.camera.position.copyFrom(this.smoothedCamPos)

    this.smoothedTarget.x += (this.lookTarget.x - this.smoothedTarget.x) * lerpSpeed
    this.smoothedTarget.y += (this.lookTarget.y - this.smoothedTarget.y) * lerpSpeed
    this.smoothedTarget.z += (this.lookTarget.z - this.smoothedTarget.z) * lerpSpeed

    this.camera.upVector.copyFrom(uTether)
    this.camera.setTarget(this.smoothedTarget)

    const speedAboveTrim = Math.max(0, sim.telemetry.airspeedKmh - 50)
    const baseFov = 1.88
    const targetFov = baseFov + Math.min(0.20, speedAboveTrim * 0.003)
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1.0, 10 * dt)
  }
}
