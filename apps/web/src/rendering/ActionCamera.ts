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
export type CameraVantage = 'chase-360' | 'orbit-360' | 'shoulder-chase' | 'pilot-fpv' | 'front-selfie' | 'wide-chase'

export class ActionCamera {
  public camera: FreeCamera
  public postProcess: PostProcess
  public lensMode: LensMode = 'action-cam'
  public vantage: CameraVantage = 'chase-360'
  public fisheyeStrength: number = 0.02 // Crisp flat perspective, no severe fishbowl warping
  public chromaticAberration: number = 0.0006 // Minimal optical dispersion
  public vignetteStrength: number = 0.16 // Subtle action-cam lens shading
  public orbitYawRad: number = 0 // 0 to 2*PI horizontal angle rotating around flyer
  public orbitPitchRad: number = 0 // -0.45 to +0.85 vertical elevation angle around flyer
  public isUserOrbiting: boolean = false
  private orbitHoldTimer: number = 0
  private baseFov: number = 1.34 // ~76.8 degrees wide forward perspective
  private smoothedTarget: Vector3
  private smoothedCamPos: Vector3
  private targetCamPos: Vector3
  private lookTarget: Vector3
  private prevSpeedMps: number = 17.2
  private elasticLag: number = 0
  private shakeTimer: number = 0
  private smoothedHorizonRoll: number = 0

  constructor(scene: Scene) {
    this.camera = new FreeCamera('action-camera', new Vector3(70, 2395, 5), scene)
    this.camera.fov = 1.34
    this.camera.minZ = 0.05
    this.camera.maxZ = 9500
    this.camera.inputs.clear()
    scene.activeCamera = this.camera

    this.smoothedTarget = new Vector3(70, 2392, 65)
    this.smoothedCamPos = new Vector3(70, 2395, 5)
    this.targetCamPos = new Vector3(70, 2395, 5)
    this.lookTarget = new Vector3(70, 2392, 65)

    const canvas = scene.getEngine().getRenderingCanvas()
    if (canvas) {
      this.attachOrbitControls(canvas)
    }

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
      this.fisheyeStrength = 0.02
      this.chromaticAberration = 0.0006
      this.vignetteStrength = 0.16
      this.baseFov = 1.34
    } else if (mode === 'subtle') {
      this.fisheyeStrength = 0.0
      this.chromaticAberration = 0.0
      this.vignetteStrength = 0.10
      this.baseFov = 1.28
    } else {
      this.fisheyeStrength = 0.0
      this.chromaticAberration = 0.0
      this.vignetteStrength = 0.0
      this.baseFov = 1.22
    }
    this.camera.fov = this.baseFov
  }

  public cycleVantage(): CameraVantage {
    if (this.vantage === 'chase-360') {
      this.setVantage('orbit-360')
    } else if (this.vantage === 'orbit-360') {
      this.setVantage('shoulder-chase')
    } else if (this.vantage === 'shoulder-chase') {
      this.setVantage('pilot-fpv')
    } else if (this.vantage === 'pilot-fpv') {
      this.setVantage('front-selfie')
    } else if (this.vantage === 'front-selfie') {
      this.setVantage('wide-chase')
    } else {
      this.setVantage('chase-360')
    }
    return this.vantage
  }

  public setVantage(v: CameraVantage) {
    this.vantage = v
    this.setLensMode(this.lensMode)
  }

  public rotateOrbit(deltaYaw: number, deltaPitch: number) {
    this.orbitYawRad = (this.orbitYawRad + deltaYaw) % (Math.PI * 2)
    this.orbitPitchRad = Math.max(-0.65, Math.min(1.15, this.orbitPitchRad + deltaPitch))
    this.isUserOrbiting = true
    this.orbitHoldTimer = 5.0
  }

  public resetOrbit() {
    this.orbitYawRad = 0
    this.orbitPitchRad = 0
    this.isUserOrbiting = false
    this.orbitHoldTimer = 0
  }

  public attachOrbitControls(element: HTMLElement) {
    let isDragging = false
    let startX = 0
    let startY = 0

    element.addEventListener('pointerdown', (e) => {
      const isUpperScreen = e.clientY < window.innerHeight * 0.45
      const isRightClick = e.button === 2 || e.button === 1 || e.shiftKey
      if (isRightClick || (isUpperScreen && e.pointerType === 'touch')) {
        isDragging = true
        startX = e.clientX
        startY = e.clientY
        this.isUserOrbiting = true
      }
    })

    window.addEventListener('pointermove', (e) => {
      if (!isDragging) return
      const dx = e.clientX - startX
      const dy = e.clientY - startY
      startX = e.clientX
      startY = e.clientY

      const rotSpeedH = (Math.PI * 2.2) / Math.max(300, window.innerWidth)
      const rotSpeedV = (Math.PI * 1.4) / Math.max(300, window.innerHeight)
      this.rotateOrbit(dx * rotSpeedH, -dy * rotSpeedV)
    })

    const stopDrag = () => {
      if (isDragging) {
        isDragging = false
        this.isUserOrbiting = false
      }
    }
    window.addEventListener('pointerup', stopDrag)
    window.addEventListener('pointercancel', stopDrag)
  }

  public snap() {
    this.smoothedHorizonRoll = 0
    this.smoothedCamPos.copyFrom(this.targetCamPos)
    this.smoothedTarget.copyFrom(this.lookTarget)
    this.camera.position.copyFrom(this.targetCamPos)
    this.camera.setTarget(this.lookTarget)
  }

  public update(
    sim: ParagliderSimulation,
    dt: number,
    _parallaxRoll: number = 0,
    _parallaxPitch: number = 0,
    instantTwistRad: number = 0,
    snapIntensity: number = 0,
  ) {
    const pilotPos = new Vector3(sim.pilot.position.x, sim.pilot.position.y, sim.pilot.position.z)
    const canopyPos = new Vector3(sim.canopy.position.x, sim.canopy.position.y, sim.canopy.position.z)

    // Detection of vertical portrait aspect ratio
    const engine = this.camera.getEngine()
    const renderWidth = engine.getRenderWidth()
    const renderHeight = engine.getRenderHeight()
    const isPortrait = renderHeight >= renderWidth

    // Portrait framing scale factors: elevate and pull back slightly to keep canopy and slope framed
    const portraitDistMult = isPortrait ? 1.25 : 1.0
    const portraitHeightMult = isPortrait ? 1.35 : 1.0

    // Tether vector (points up along suspension lines toward canopy)
    const tetherDiff = canopyPos.subtract(pilotPos)
    const tetherLen = tetherDiff.length()
    const uTether = tetherLen > 0.1 ? tetherDiff.scale(1 / tetherLen) : Vector3.Up()

    // Glider forward heading vector
    const yawRad = (sim.canopy.yawDeg * Math.PI) / 180
    const hFwd = new Vector3(Math.sin(yawRad), 0, Math.cos(yawRad))

    let uRight = Vector3.Cross(hFwd, uTether)
    if (uRight.lengthSquared() < 0.01) {
      uRight = new Vector3(Math.cos(yawRad), 0, -Math.sin(yawRad))
    } else {
      uRight.normalize()
    }
    const uFwd = Vector3.Cross(uTether, uRight).normalize()

    // Pilot body orientation (supporting 180° reverse stance swivel)
    const reverseYawRad = ((sim.pilot.reverseStanceYawDeg || 0) * Math.PI) / 180
    const bodyFwd = uFwd.scale(Math.cos(reverseYawRad)).add(uRight.scale(Math.sin(reverseYawRad)))

    const speedKmh = sim.telemetry.airspeedKmh
    const trimSpeed = sim.wing.trimSpeedKmh || 46.0
    const speedMps = speedKmh / 3.6

    // Pilot 3D velocity vector (True kinematic flight trajectory)
    const pVel = new Vector3(sim.pilot.velocity.x, sim.pilot.velocity.y, sim.pilot.velocity.z)
    const velMag = pVel.length()

    // 3D flight velocity unit vector (Pins the motion Focus of Expansion / Vanishing Point)
    let vDir: Vector3
    if (velMag > 1.2) {
      vDir = pVel.scale(1.0 / velMag)
    } else {
      // Nominal trim glide path (-1.53 m/s sink on 17.15 m/s forward ~ 11:1 glide ratio)
      const nominalGlideAngle = -0.089 // ~ -5.1 degrees
      vDir = uFwd.scale(Math.cos(nominalGlideAngle)).add(Vector3.Up().scale(Math.sin(nominalGlideAngle))).normalize()
    }

    // Forward acceleration estimation for elastic chase lag
    const forwardAcc = dt > 0.0001 ? (speedMps - this.prevSpeedMps) / dt : 0
    this.prevSpeedMps = speedMps

    // Target elastic chase lag based on forward acceleration & speed surge
    const targetElasticLag = Math.max(-0.25, Math.min(0.95, forwardAcc * 0.12 + Math.max(0, speedKmh - trimSpeed) * 0.016))
    this.elasticLag += (targetElasticLag - this.elasticLag) * Math.min(1.0, 10.0 * dt)

    // Visceral Aerodynamic Micro-Vibration & High-Speed Airframe Shake
    this.shakeTimer += dt * 36.0
    const buffetingIntensity = Math.min(1.0, Math.max(0, (speedKmh - 48.0) / 45.0))
    const shake = new Vector3(
      Math.sin(this.shakeTimer * 1.3) * 0.016 * buffetingIntensity,
      Math.cos(this.shakeTimer * 1.7) * 0.022 * buffetingIntensity,
      Math.sin(this.shakeTimer * 2.1) * 0.014 * buffetingIntensity,
    )

    const speedSurge = Math.max(0, speedKmh - (trimSpeed - 4.0))

    // Visceral Heaviness & G-Force Sensation (with dynamic seat-compression):
    const gForce = sim.telemetry.gForce || 1.0
    const snapHeaviness = snapIntensity * 0.25
    const gHeavinessComp = (gForce > 1.0
      ? Math.min(0.48, (gForce - 1.0) * 0.32)
      : -Math.min(0.42, (1.0 - gForce) * 0.40)) + snapHeaviness

    // Up & Down Heave: vertical climb in thermals lifts gaze; diving down tilts down the fall-line
    const verticalMps = sim.telemetry.verticalSpeedMps || 0
    const downhillDescend = Math.max(0, -verticalMps / 5.5)
    const thermalClimb = Math.max(0, verticalMps / 4.5)

    // Rock-steady look target: look ahead along flight path with zero control-induced camera twitching
    const turnLookAhead = Vector3.Zero()

    // Soft return to rear chase if not actively orbiting and in standard chase mode
    if (!this.isUserOrbiting && this.vantage !== 'orbit-360') {
      if (this.orbitHoldTimer > 0) {
        this.orbitHoldTimer -= dt
      } else {
        const decayRate = 1.6
        this.orbitYawRad += (0 - this.orbitYawRad) * Math.min(1.0, decayRate * dt)
        this.orbitPitchRad += (0 - this.orbitPitchRad) * Math.min(1.0, decayRate * dt)
      }
    }

    // Steady rear framing: orbit is user-driven only; zero control-induced camera orbit
    const carveOrbitYaw = 0
    const effectiveYaw = this.orbitYawRad + carveOrbitYaw
    const effectivePitch = this.orbitPitchRad

    if (this.vantage === 'chase-360' || this.vantage === 'orbit-360') {
      // 1. Forward Driver & 360° Rotating Orbit Perspective:
      // Perfectly frames the flyer from any angle, rotating 360° around the pilot and canopy!
      const verticalMps = sim.canopy.verticalSpeedMps || 0
      const diveTighten = Math.min(0.45, (Math.max(0, -verticalMps) / 25.0) * 0.45)
      const dist = (2.65 * portraitDistMult) + this.elasticLag * 0.45 + Math.min(0.40, speedSurge * 0.012) - diveTighten
      const height = (0.95 * portraitHeightMult) + Math.min(0.20, speedSurge * 0.008) + downhillDescend * 0.22 - gHeavinessComp

      const cosY = Math.cos(effectiveYaw)
      const sinY = Math.sin(effectiveYaw)
      const cosP = Math.cos(effectivePitch)
      const sinP = Math.sin(effectivePitch)

      // Horizontal offset direction rotated around flyer:
      // effectiveYaw = 0: points along -vDir (trailing behind)
      // effectiveYaw = PI/2: points along uRight (right side)
      // effectiveYaw = PI: points along vDir (front selfie)
      // effectiveYaw = 3*PI/2: points along -uRight (left side)
      const uH = vDir.scale(-cosY).add(uRight.scale(sinY))
      const upRef = (sim.isLooping || sim.isRolling) ? Vector3.Up() : uTether
      const uOrbitDir = uH.scale(cosP).add(upRef.scale(sinP)).normalize()

      this.targetCamPos = pilotPos
        .add(uOrbitDir.scale(dist))
        .add(upRef.scale(height * Math.max(0.2, 1.0 - Math.abs(sinP))))
        .add(shake)

      // Forward flight path line-of-sight: look target projects ahead down the slope,
      // blended smoothly towards flyer center as orbit angle rotates to side/front
      const lookDist = 55.0 + (speedKmh / trimSpeed) * 25.0
      const slopeDip = downhillDescend * 2.8 - thermalClimb * 2.2
      const forwardLook = this.targetCamPos
        .add(vDir.scale(lookDist))
        .subtract(uTether.scale(slopeDip))
        .add(turnLookAhead)

      const flyerCenter = pilotPos.add(uTether.scale(0.75))
      const rotAngleMag = Math.abs(effectiveYaw) + Math.abs(effectivePitch)
      const lookFlyerWeight = Math.max(0, Math.min(1.0, rotAngleMag / 0.75 + (this.vantage === 'orbit-360' ? 0.6 : 0)))
      this.lookTarget = Vector3.Lerp(forwardLook, flyerCenter, lookFlyerWeight)
    } else if (this.vantage === 'shoulder-chase') {
      // 2. Over-the-Shoulder Action Chase:
      const dist = (2.15 * portraitDistMult) + this.elasticLag * 0.45
      const height = (0.75 * portraitHeightMult) + Math.min(0.12, speedSurge * 0.006) + downhillDescend * 0.15 - gHeavinessComp * 0.8
      this.targetCamPos = pilotPos
        .subtract(vDir.scale(dist))
        .add(uRight.scale(0.70))
        .add(uTether.scale(height))
        .add(shake)

      const lookDist = 50.0 + (speedKmh / trimSpeed) * 20.0
      const slopeDip = downhillDescend * 2.0 - thermalClimb * 1.8
      this.lookTarget = this.targetCamPos
        .add(vDir.scale(lookDist))
        .subtract(uTether.scale(slopeDip))
        .add(turnLookAhead)
    } else if (this.vantage === 'pilot-fpv') {
      // 3. Cockpit First-Person Pilot View:
      this.targetCamPos = pilotPos
        .add(uTether.scale(0.48 - gHeavinessComp * 0.5))
        .add(bodyFwd.scale(0.18))
        .add(shake)

      const slopeDip = downhillDescend * 1.5 - thermalClimb * 1.5
      this.lookTarget = this.targetCamPos
        .add(vDir.scale(50.0))
        .subtract(uTether.scale(slopeDip))
        .add(turnLookAhead)
    } else if (this.vantage === 'front-selfie') {
      // 4. Action Selfie Pole:
      this.targetCamPos = pilotPos
        .add(uFwd.scale(2.6 + this.elasticLag * 0.4))
        .add(uTether.scale(0.35 - gHeavinessComp * 0.6))
        .add(shake)

      this.lookTarget = pilotPos.add(uTether.scale(1.20))
    } else {
      // 5. Wide 3rd-Person Cinematic Chase:
      const dist = (4.8 * portraitDistMult) + this.elasticLag
      const height = (1.55 * portraitHeightMult) - Math.min(0.20, speedSurge * 0.008) - gHeavinessComp
      this.targetCamPos = pilotPos
        .subtract(vDir.scale(dist))
        .add(uTether.scale(height))
        .add(shake)

      this.lookTarget = pilotPos
        .add(vDir.scale(30.0))
        .add(uTether.scale(1.2))
        .add(turnLookAhead)
    }

    // Responsive spring-like follow smoothing
    const camLerp = Math.min(1.0, 16.0 * dt)
    const lookLerp = Math.min(1.0, 20.0 * dt)
    this.smoothedCamPos.x += (this.targetCamPos.x - this.smoothedCamPos.x) * camLerp
    this.smoothedCamPos.y += (this.targetCamPos.y - this.smoothedCamPos.y) * camLerp
    this.smoothedCamPos.z += (this.targetCamPos.z - this.smoothedCamPos.z) * camLerp
    this.camera.position.copyFrom(this.smoothedCamPos)

    this.smoothedTarget.x += (this.lookTarget.x - this.smoothedTarget.x) * lookLerp
    this.smoothedTarget.y += (this.lookTarget.y - this.smoothedTarget.y) * lookLerp
    this.smoothedTarget.z += (this.lookTarget.z - this.smoothedTarget.z) * lookLerp

    // Rock-Steady Horizon Lock:
    // Keeps the world horizon completely steady in real physical space.
    // As the phone is tilted or rotated in the player's hands, the camera's upVector
    // counter-rolls by instantTwistRad so the landscape and horizon outside do not move.
    const viewDir = this.smoothedTarget.subtract(this.smoothedCamPos).normalize()
    let camRight = Vector3.Cross(Vector3.Up(), viewDir)
    if (camRight.lengthSquared() < 0.001) {
      camRight = Vector3.Right()
    } else {
      camRight.normalize()
    }
    const viewUp = Vector3.Cross(viewDir, camRight).normalize()
    const targetRoll = instantTwistRad || 0
    const rollLerp = Math.min(1.0, 22.0 * dt)
    this.smoothedHorizonRoll += (targetRoll - this.smoothedHorizonRoll) * rollLerp

    const camUp = viewUp.scale(Math.cos(this.smoothedHorizonRoll)).add(camRight.scale(Math.sin(this.smoothedHorizonRoll))).normalize()
    this.camera.upVector.copyFrom(camUp)
    this.camera.setTarget(this.smoothedTarget)

    // Dynamic speed-tunnel FOV dilation: expands peripheral vision and creates forward speed rush
    const effectiveBaseFov = isPortrait ? 1.25 : this.baseFov
    const speedDelta = Math.max(0, speedKmh - 42.0)
    const fovBoost = Math.min(0.42, Math.pow(speedDelta / 50.0, 1.15) * 0.38)
    const snapFovBoost = snapIntensity * 0.08
    const loopFovBoost = (sim.isLooping || sim.isRolling) ? 0.12 : 0
    const gTunnelFov = Math.max(0, gForce - 1.2) * 0.025
    const targetFov = Math.min(1.52, effectiveBaseFov * (1.0 + fovBoost + snapFovBoost + loopFovBoost - gTunnelFov))
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1.0, 12.0 * dt)
  }
}
