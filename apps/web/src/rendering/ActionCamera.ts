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

  vec4 baseSample = texture2D(textureSampler, uvG);
  float rCol = texture2D(textureSampler, uvR).r;
  float gCol = baseSample.g;
  float bCol = texture2D(textureSampler, uvB).b;
  vec3 color = vec3(rCol, gCol, bCol);

  // Optical lens vignetting
  float vignette = 1.0 - vignetteStrength * smoothstep(0.48, 1.25, r);
  color *= clamp(vignette, 0.0, 1.0);

  gl_FragColor = vec4(color, baseSample.a);
}
`

if (typeof Effect !== 'undefined') {
  Effect.ShadersStore['actionCamFisheyePixelShader'] = fisheyeShaderCode
  Effect.ShadersStore['actionCamFisheyeFragmentShader'] = fisheyeShaderCode
}

export type LensMode = 'action-cam' | 'subtle' | 'linear'
export type CameraVantage = 'chase-360' | 'orbit-360' | 'shoulder-chase' | 'pilot-fpv' | 'front-selfie' | 'wide-chase'
export type CrashVantage = 'orbit' | 'cctv' | 'bystander' | 'pov'

export class ActionCamera {
  public camera: FreeCamera
  public postProcess: PostProcess
  public lensMode: LensMode = 'action-cam'
  public vantage: CameraVantage = 'chase-360'
  public crashVantage: CrashVantage = 'orbit'
  private fixedCctvPos: Vector3 | null = null
  private fixedBystanderPos: Vector3 | null = null
  public fisheyeStrength: number = 0.34 // Authentic GoPro MAX / Insta360 SuperView barrel distortion
  public chromaticAberration: number = 0.0024 // Wide-angle optical edge dispersion
  public vignetteStrength: number = 0.24 // Action-cam peripheral lens shading
  public orbitYawRad: number = 0 // 0 to 2*PI horizontal angle rotating around flyer
  public orbitPitchRad: number = 0 // -0.45 to +0.85 vertical elevation angle around flyer
  public isUserOrbiting: boolean = false
  private orbitHoldTimer: number = 0
  private baseFov: number = 1.85 // ~106° ultra-wide GoPro fisheye perspective (frames close-up pilot + canopy!)
  private smoothedTarget: Vector3
  private smoothedCamPos: Vector3
  private targetCamPos: Vector3
  private lookTarget: Vector3
  private prevSpeedMps: number = 17.2
  private elasticLag: number = 0
  private shakeTimer: number = 0
  private smoothedHorizonRoll: number = 0
  /** Eased upward view. The climb path points at the sky immediately; the camera should not. */
  private smoothedGazePitch: number = 0
  /** Wingsuit aim. The suit's speed wobbles; the chase stays on the line without whipping. */
  private suitBehind = new Vector3(0, 0, 1)
  private suitAim = new Vector3(0, 0, 1)
  private suitVertical = 0
  private suitCamLive = false
  private crashCamAngle: number = 0
  private crashShakeTimer: number = 0
  /** While a wipeout replays, the camera rides beside this point instead of the ragdoll. */
  public replayFocus: Vector3 | null = null

  constructor(scene: Scene) {
    this.camera = new FreeCamera('action-camera', new Vector3(70, 2395, 5), scene)
    this.camera.fov = 1.85
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

      // Preserve full top-to-bottom vertical FOV (rEdge = 0.5 -> rEdge2 = 0.25) so the overhead canopy is never cropped!
      const rEdge2 = 0.25
      const edgeDist =
        1.0 + this.fisheyeStrength * rEdge2 + (this.fisheyeStrength * 0.35) * (rEdge2 * rEdge2)
      const safeZoom = 1.0 / Math.max(1.0, edgeDist)

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
      this.fisheyeStrength = 0.34
      this.chromaticAberration = 0.0024
      this.vignetteStrength = 0.24
      this.baseFov = 1.85
    } else if (mode === 'subtle') {
      this.fisheyeStrength = 0.16
      this.chromaticAberration = 0.0012
      this.vignetteStrength = 0.14
      this.baseFov = 1.65
    } else {
      this.fisheyeStrength = 0.0
      this.chromaticAberration = 0.0
      this.vignetteStrength = 0.0
      this.baseFov = 1.38
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

  public cycleCrashVantage(): CrashVantage {
    if (this.crashVantage === 'orbit') this.crashVantage = 'cctv'
    else if (this.crashVantage === 'cctv') this.crashVantage = 'bystander'
    else if (this.crashVantage === 'bystander') this.crashVantage = 'pov'
    else this.crashVantage = 'orbit'
    return this.crashVantage
  }

  public setCrashVantage(v: CrashVantage): void {
    this.crashVantage = v
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
      const isRightClick = e.button === 2 || e.button === 1 || e.shiftKey
      if (isRightClick) {
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
    this.suitCamLive = false
    this.smoothedCamPos.copyFrom(this.targetCamPos)
    this.smoothedTarget.copyFrom(this.lookTarget)
    this.camera.position.copyFrom(this.targetCamPos)
    this.camera.setTarget(this.lookTarget)
  }

  public update(
    sim: ParagliderSimulation,
    dt: number,
    _parallaxRoll: number = 0,
    parallaxPitch: number = 0,
    _instantTwistRad: number = 0,
    snapIntensity: number = 0,
    ragdollPos?: Vector3,
  ) {
    // Multi-Angle Wipeout Camera Modes:
    // 1. Orbit: Dramatic impact shake + cinematic slow-orbit tracking of the tumbling ragdoll!
    // 2. CCTV: Elevated stationary drone/security camera watching the impact and bounce!
    // 3. Bystander: Low street/ground spectator camera looking up at the building impact.
    // 4. POV: Visceral tumbling pilot first-person view.
    if (sim.isCrashed && this.replayFocus) {
      const yaw = (sim.canopy.yawDeg * Math.PI) / 180
      const p = this.replayFocus
      this.targetCamPos.set(p.x + Math.cos(yaw) * 8.5, p.y + 2.4, p.z - Math.sin(yaw) * 8.5)
      this.lookTarget.set(p.x, p.y + 0.9, p.z)
      this.smoothedCamPos.copyFrom(this.targetCamPos)
      this.smoothedTarget.copyFrom(this.lookTarget)
      this.camera.position.copyFrom(this.smoothedCamPos)
      this.camera.upVector.copyFrom(Vector3.Up())
      this.camera.setTarget(this.smoothedTarget)
      return
    }

    if (sim.isCrashed && ragdollPos) {
      this.crashCamAngle += dt * 0.58
      this.crashShakeTimer += dt
      const impactShake = Math.max(0, 1.0 - this.crashShakeTimer * 1.6) * 0.65
      const shakeVec = new Vector3(
        Math.sin(this.crashShakeTimer * 55) * impactShake,
        Math.cos(this.crashShakeTimer * 62) * impactShake,
        Math.sin(this.crashShakeTimer * 48) * impactShake,
      )

      if (this.crashVantage === 'cctv') {
        if (!this.fixedCctvPos) {
          const yawRad = (sim.canopy.yawDeg * Math.PI) / 180
          this.fixedCctvPos = new Vector3(
            ragdollPos.x - Math.sin(yawRad) * 16.0 + Math.cos(yawRad) * 12.0,
            ragdollPos.y + 14.0,
            ragdollPos.z - Math.cos(yawRad) * 16.0 - Math.sin(yawRad) * 12.0,
          )
        }
        this.targetCamPos = this.fixedCctvPos.add(shakeVec)
        this.lookTarget = new Vector3(ragdollPos.x, ragdollPos.y + 0.35, ragdollPos.z)
      } else if (this.crashVantage === 'bystander') {
        if (!this.fixedBystanderPos) {
          const yawRad = (sim.canopy.yawDeg * Math.PI) / 180
          this.fixedBystanderPos = new Vector3(
            ragdollPos.x + Math.sin(yawRad) * 12.0 + Math.cos(yawRad) * 10.0,
            Math.max(ragdollPos.y - 12.0, ragdollPos.y - 6.0),
            ragdollPos.z + Math.cos(yawRad) * 12.0 - Math.sin(yawRad) * 10.0,
          )
        }
        this.targetCamPos = this.fixedBystanderPos.add(shakeVec)
        this.lookTarget = new Vector3(ragdollPos.x, ragdollPos.y + 0.5, ragdollPos.z)
      } else if (this.crashVantage === 'pov') {
        const yawRad = (sim.canopy.yawDeg * Math.PI) / 180 + this.crashCamAngle * 1.8
        this.targetCamPos = new Vector3(
          ragdollPos.x + Math.sin(yawRad) * 0.45,
          ragdollPos.y + 0.65,
          ragdollPos.z + Math.cos(yawRad) * 0.45,
        ).add(shakeVec)
        this.lookTarget = new Vector3(
          ragdollPos.x + Math.sin(yawRad + Math.PI * 0.5) * 8.0,
          ragdollPos.y - 1.2,
          ragdollPos.z + Math.cos(yawRad + Math.PI * 0.5) * 8.0,
        )
      } else {
        // Default: Orbit
        const yawRad = (sim.canopy.yawDeg * Math.PI) / 180 + this.crashCamAngle
        const camDist = 6.2
        const camHeight = 3.2
        this.targetCamPos = new Vector3(
          ragdollPos.x - Math.sin(yawRad) * camDist,
          ragdollPos.y + camHeight,
          ragdollPos.z - Math.cos(yawRad) * camDist,
        ).add(shakeVec)
        this.lookTarget = new Vector3(ragdollPos.x, ragdollPos.y + 0.35, ragdollPos.z)
      }

      const lerp = Math.min(1.0, 9.5 * dt)
      this.smoothedCamPos.x += (this.targetCamPos.x - this.smoothedCamPos.x) * lerp
      this.smoothedCamPos.y += (this.targetCamPos.y - this.smoothedCamPos.y) * lerp
      this.smoothedCamPos.z += (this.targetCamPos.z - this.smoothedCamPos.z) * lerp
      this.smoothedTarget.x += (this.lookTarget.x - this.smoothedTarget.x) * lerp
      this.smoothedTarget.y += (this.lookTarget.y - this.smoothedTarget.y) * lerp
      this.smoothedTarget.z += (this.lookTarget.z - this.smoothedTarget.z) * lerp

      this.camera.position.copyFrom(this.smoothedCamPos)
      this.camera.upVector.copyFrom(Vector3.Up())
      this.camera.setTarget(this.smoothedTarget)
      return
    }
    this.crashShakeTimer = 0
    this.fixedCctvPos = null
    this.fixedBystanderPos = null

    const pilotPos = new Vector3(sim.pilot.position.x, sim.pilot.position.y, sim.pilot.position.z)
    const canopyPos = new Vector3(sim.canopy.position.x, sim.canopy.position.y, sim.canopy.position.z)

    // Detection of vertical portrait aspect ratio
    const engine = this.camera.getEngine()
    const renderWidth = engine.getRenderWidth()
    const renderHeight = engine.getRenderHeight()
    const isPortrait = renderHeight >= renderWidth

    // Portrait framing scale factors: keep camera ultra-close to the flyer in both portrait and landscape!
    const portraitDistMult = isPortrait ? 1.08 : 1.0
    const portraitHeightMult = isPortrait ? 1.06 : 1.0

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
    const wingsuitCam = sim.currentWingType === 'wingsuit'

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

    // Horizontal flight heading vector for chase camera placement:
    // Keeps camera cleanly positioned behind and above the flyer regardless of steep vertical pitch/dive angles
    const vDirH = new Vector3(vDir.x, 0, vDir.z)
    const uFwdH = vDirH.lengthSquared() > 0.04 ? vDirH.normalize() : hFwd

    // Target elastic chase lag based on forward acceleration & speed surge
    const targetElasticLag = Math.max(-0.25, Math.min(0.95, forwardAcc * 0.12 + Math.max(0, speedKmh - trimSpeed) * 0.016))
    const lagFollow = wingsuitCam ? 3.5 : 10
    this.elasticLag += (targetElasticLag - this.elasticLag) * Math.min(1.0, lagFollow * dt)

    // Visceral Aerodynamic Micro-Vibration & High-Speed Airframe Shake
    this.shakeTimer += dt * 42.0
    const isSpeedwing = sim.currentWingType === 'speedwing'
    // Ground proximity boost for adrenaline rush:
    const agl = sim.telemetry.groundClearanceMeters || 100
    const proximityBoost = Math.max(0, 1.0 - agl / 25.0) // 1.0 at terrain deck, 0 at 25m+
    const speedRatio = Math.max(0, (speedKmh - 60.0) / 70.0)
    const buffetingIntensity = wingsuitCam
      ? 0
      : isSpeedwing
        ? Math.min(1.0, speedRatio * 0.85 + proximityBoost * 0.45 * Math.min(1.0, speedKmh / 80.0))
        : Math.min(1.0, Math.max(0, (speedKmh - 48.0) / 45.0) * 0.5)

    const shakeAmp = isSpeedwing ? 0.055 : 0.018
    const shake = new Vector3(
      Math.sin(this.shakeTimer * 1.3) * shakeAmp * buffetingIntensity,
      Math.cos(this.shakeTimer * 1.7) * (shakeAmp * 1.25) * buffetingIntensity,
      Math.sin(this.shakeTimer * 2.1) * (shakeAmp * 0.85) * buffetingIntensity,
    )

    const speedSurge = Math.max(0, speedKmh - (trimSpeed - 4.0))

    // Visceral Heaviness & G-Force Sensation (with dynamic seat-compression):
    const gForce = sim.telemetry.gForce || 1.0
    const snapHeaviness = snapIntensity * 0.25
    // Stomach-Turning Weightless Pushover Float:
    // When gForce drops below 1.0 (pushover into a dive), the camera experiences vertical floating inertia,
    // lingering higher above the falling pilot so the pilot visually drops toward the bottom of the screen!
    const stomachDropFloat = Math.max(0, 1.0 - gForce) * 0.65
    const gHeavinessComp = (gForce > 1.0
      ? Math.min(0.48, (gForce - 1.0) * 0.32)
      : -Math.min(0.55, (1.0 - gForce) * 0.45)) + snapHeaviness

    // Up & Down Heave: vertical climb in thermals lifts gaze; diving down tilts gaze into the fall-line
    const verticalMps = sim.telemetry.verticalSpeedMps || 0
    let downhillDescend = Math.max(0, -verticalMps / 4.5)
    let thermalClimb = Math.max(0, verticalMps / 4.5)

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

    // The suit's velocity chatters. Ease the aim and the behind-direction.
    // The camera still sits on the pilot, so a turn does not swing the view outside the line.
    let placeBehind = uFwdH
    let lookDir = vDir
    if (wingsuitCam) {
      if (!this.suitCamLive) {
        this.suitBehind.copyFrom(uFwdH)
        this.suitAim.copyFrom(vDir)
        this.suitVertical = verticalMps
        this.suitCamLive = true
      }
      const behindLerp = Math.min(1, 11 * dt)
      const aimLerp = Math.min(1, 6.5 * dt)
      const sinkLerp = Math.min(1, 4 * dt)
      this.suitBehind.x += (uFwdH.x - this.suitBehind.x) * behindLerp
      this.suitBehind.y = 0
      this.suitBehind.z += (uFwdH.z - this.suitBehind.z) * behindLerp
      if (this.suitBehind.lengthSquared() > 1e-4) this.suitBehind.normalize()
      this.suitAim.x += (vDir.x - this.suitAim.x) * aimLerp
      this.suitAim.y += (vDir.y - this.suitAim.y) * aimLerp
      this.suitAim.z += (vDir.z - this.suitAim.z) * aimLerp
      if (this.suitAim.lengthSquared() > 1e-4) this.suitAim.normalize()
      this.suitVertical += (verticalMps - this.suitVertical) * sinkLerp
      placeBehind = this.suitBehind
      lookDir = this.suitAim
      downhillDescend = Math.max(0, -this.suitVertical / 4.5)
      thermalClimb = Math.max(0, this.suitVertical / 4.5)
    } else {
      this.suitCamLive = false
    }

    // Steady rear framing: orbit is user-driven only; zero control-induced camera orbit
    const carveOrbitYaw = 0
    const effectiveYaw = this.orbitYawRad + carveOrbitYaw
    const effectivePitch = this.orbitPitchRad

    // Looking up tilts the view with the phone. Following the climb velocity
    // snaps from the horizon to straight overhead, so that aim eases and stops short of vertical.
    const pathPitch = Math.asin(Math.max(-1, Math.min(1, lookDir.y)))
    const phoneUp = Math.max(0, parallaxPitch)
    const lookingUp = phoneUp > 0.02 || pathPitch > 0.12
    if (lookingUp && this.smoothedGazePitch < 0) this.smoothedGazePitch = 0
    const gazeTarget = lookingUp
      ? Math.min(0.66, Math.max(0, pathPitch) * 0.22 + phoneUp * 0.7)
      : 0
    const gazeFollow = lookingUp ? 2.4 : 6.0
    this.smoothedGazePitch += (gazeTarget - this.smoothedGazePitch) * Math.min(1.0, gazeFollow * dt)

    // Look-down is the dive. Level flight leaves this at 0, so the chase stays as it was.
    const phoneDown = Math.max(0, -parallaxPitch)
    const diveView = lookingUp ? 0 : Math.max(phoneDown, Math.max(0, Math.min(1, sim.controls.speedBar ?? 0)))

    if (this.vantage === 'chase-360' || this.vantage === 'orbit-360') {
      // 1. Ultra-Close Insta360 / GoPro Fisheye Chase Rig:
      // Mounted right behind the pilot (~1.95m) with a 106°+ fisheye lens so the flyer is up-close and visceral
      // while the wide barrel lens bends upward to capture the arched canopy and suspension lines overhead!
      const diveTighten = Math.min(0.45, (Math.max(0, -verticalMps) / 25.0) * (isSpeedwing ? 0.45 : 0.35))
      // A dive stays behind the shoulders and looks down the nose. Looking up eases lower.
      const pitchHeightShift = this.smoothedGazePitch > 0.02
        ? -this.smoothedGazePitch * 1.05
        : diveView > 0.04
          ? -diveView * 0.28
          : -parallaxPitch * 1.65
      const dist = (1.95 * portraitDistMult) + this.elasticLag * 0.25 + Math.min(0.25, speedSurge * 0.008) - diveTighten
      const height = (1.12 * portraitHeightMult) + pitchHeightShift + Math.min(0.12, speedSurge * 0.006) + downhillDescend * 0.12 - gHeavinessComp * 0.65 + stomachDropFloat * 0.65

      const cosY = Math.cos(effectiveYaw)
      const sinY = Math.sin(effectiveYaw)
      const cosP = Math.cos(effectivePitch)
      const sinP = Math.sin(effectivePitch)

      // Horizontal offset direction rotated around flyer:
      // effectiveYaw = 0: points along -uFwdH (trailing behind)
      // effectiveYaw = PI/2: points along uRight (right side)
      // effectiveYaw = PI: points along uFwdH (front selfie)
      // effectiveYaw = 3*PI/2: points along -uRight (left side)
      const uH = placeBehind.scale(-cosY).add(uRight.scale(sinY))
      const upRef = Vector3.Up()
      const uOrbitDir = uH.scale(cosP).add(upRef.scale(sinP)).normalize()

      // Stay with the body. An outside-of-turn camera lag swung the view
      // into whatever you were trying to turn away from.
      this.targetCamPos = pilotPos
        .add(uOrbitDir.scale(dist))
        .add(upRef.scale(height * Math.max(0.2, 1.0 - Math.abs(sinP))))
        .add(shake)

      // Forward flight path line-of-sight: look target projects along the true flight vector.
      // A climb uses the eased gaze so the horizon tips up instead of flipping overhead.
      const lookDist = Math.min(120, 50.0 + (speedKmh / trimSpeed) * 20.0)
      const aimPitch = this.smoothedGazePitch
      const aimDir = placeBehind.scale(Math.cos(aimPitch)).add(Vector3.Up().scale(Math.sin(aimPitch)))
      const slopeDip = downhillDescend * 2.4 - thermalClimb * 2.0 + 0.6
      const tiltDip = -parallaxPitch * (lookDist * 0.90)
      const noseDown = Math.min(0.95, 0.18 + diveView * 0.92)
      const diveAim = placeBehind.scale(Math.cos(noseDown)).subtract(Vector3.Up().scale(Math.sin(noseDown)))
      const forwardLook = diveView > 0.04
        ? this.targetCamPos.add(diveAim.scale(Math.min(lookDist, 78))).add(turnLookAhead)
        : aimPitch > 0.015
          ? this.targetCamPos.add(aimDir.scale(lookDist)).add(turnLookAhead)
          : this.targetCamPos
            .add(lookDir.scale(lookDist))
            .subtract(Vector3.Up().scale(slopeDip + tiltDip))
            .add(turnLookAhead)

      const flyerCenter = pilotPos.add(tetherDiff.scale(0.5))
      const rotAngleMag = Math.abs(effectiveYaw) + Math.abs(effectivePitch)
      const lookFlyerWeight = Math.max(0, Math.min(1.0, rotAngleMag / 0.75 + (this.vantage === 'orbit-360' ? 0.6 : 0)))
      this.lookTarget = Vector3.Lerp(forwardLook, flyerCenter, lookFlyerWeight)
    } else if (this.vantage === 'shoulder-chase') {
      // 2. Over-the-Shoulder Action Chase:
      const dist = (3.1 * portraitDistMult) + this.elasticLag * 0.40
      const height = (1.25 * portraitHeightMult) + Math.min(0.12, speedSurge * 0.006) + downhillDescend * 0.15 - gHeavinessComp * 0.8
      this.targetCamPos = pilotPos
        .subtract(placeBehind.scale(dist))
        .add(uRight.scale(0.85))
        .add(Vector3.Up().scale(height))
        .add(shake)

      const lookDist = Math.min(120, 45.0 + (speedKmh / trimSpeed) * 18.0)
      const slopeDip = downhillDescend * 2.6 - thermalClimb * 1.8 + 1.0
      const tiltDip = -parallaxPitch * (lookDist * 0.40)
      const noseDown = Math.min(0.85, 0.12 + diveView * 0.8)
      const diveAim = placeBehind.scale(Math.cos(noseDown)).subtract(Vector3.Up().scale(Math.sin(noseDown)))
      this.lookTarget = diveView > 0.04
        ? this.targetCamPos.add(diveAim.scale(Math.min(lookDist, 70))).add(turnLookAhead)
        : this.targetCamPos
          .add(lookDir.scale(lookDist))
          .subtract(Vector3.Up().scale(slopeDip + tiltDip))
          .add(turnLookAhead)
    } else if (this.vantage === 'pilot-fpv') {
      // 3. Cockpit First-Person Pilot View:
      this.targetCamPos = pilotPos
        .add(uTether.scale(0.48 - gHeavinessComp * 0.5))
        .add(bodyFwd.scale(0.18))
        .add(shake)

      const slopeDip = downhillDescend * 2.2 - thermalClimb * 1.5
      const tiltDip = -parallaxPitch * 22.0
      this.lookTarget = this.targetCamPos
        .add(lookDir.scale(50.0))
        .subtract(uTether.scale(slopeDip + tiltDip))
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
        .subtract(placeBehind.scale(dist))
        .add(Vector3.Up().scale(height))
        .add(shake)

      const noseDown = Math.min(0.8, diveView * 0.85)
      const wideAim = diveView > 0.04
        ? placeBehind.scale(Math.cos(noseDown)).subtract(Vector3.Up().scale(Math.sin(noseDown)))
        : lookDir
      this.lookTarget = pilotPos
        .add(wideAim.scale(30.0))
        .add(Vector3.Up().scale(diveView > 0.04 ? 0.2 : 1.2))
        .add(turnLookAhead)
    }

    // Responsive spring-like follow smoothing
    // During weightless low-G pushover and steep descent, vertical follow relaxes slightly
    // so the pilot visibly plunges downward on screen before the camera tracks down!
    const isPlungingLowG = gForce < 0.90 && verticalMps < -2.5
    const camLerpY = isPlungingLowG ? Math.min(1.0, 7.8 * dt) : Math.min(1.0, 16.0 * dt)
    const camLerp = Math.min(1.0, 16.0 * dt)
    const lookLerp = Math.min(1.0, (wingsuitCam ? 9.0 : 20.0) * dt)
    this.smoothedCamPos.x += (this.targetCamPos.x - this.smoothedCamPos.x) * camLerp
    this.smoothedCamPos.y += (this.targetCamPos.y - this.smoothedCamPos.y) * camLerpY
    this.smoothedCamPos.z += (this.targetCamPos.z - this.smoothedCamPos.z) * camLerp
    this.camera.position.copyFrom(this.smoothedCamPos)

    this.smoothedTarget.x += (this.lookTarget.x - this.smoothedTarget.x) * lookLerp
    this.smoothedTarget.y += (this.lookTarget.y - this.smoothedTarget.y) * lookLerp
    this.smoothedTarget.z += (this.lookTarget.z - this.smoothedTarget.z) * lookLerp

    // Aerodynamic Coordinated Bank / Horizon Framing:
    // In straight trim flight, the horizon is 100% rock-solid and level on screen (zero visual slipping in the middle!).
    // In deep carving turns or spiral dives, the camera subtly banks with the turn (16% of glider bank)
    // to give authentic acro G-force sensation without shaking or slipping.
    const viewDir = this.smoothedTarget.subtract(this.smoothedCamPos).normalize()
    let camRight = Vector3.Cross(Vector3.Up(), viewDir)
    if (camRight.lengthSquared() < 0.001) {
      camRight = uRight
    } else {
      camRight.normalize()
    }
    const viewUp = Vector3.Cross(viewDir, camRight).normalize()

    // Aerodynamic bank: zero in trim flight, smoothly banking into steep carves/spirals
    const gliderBankRad = (sim.bankDeg * Math.PI) / 180
    const targetRoll = (sim.isLooping || sim.isRolling) ? 0 : (gliderBankRad * 0.16)
    const rollLerp = Math.min(1.0, (wingsuitCam ? 6.5 : 14.0) * dt)
    this.smoothedHorizonRoll += (targetRoll - this.smoothedHorizonRoll) * rollLerp

    const camUp = viewUp.scale(Math.cos(this.smoothedHorizonRoll)).add(camRight.scale(Math.sin(this.smoothedHorizonRoll))).normalize()
    this.camera.upVector.copyFrom(camUp)
    this.camera.setTarget(this.smoothedTarget)

    // Dynamic speed-tunnel FOV dilation: expands peripheral vision and creates visceral fisheye speed rush!
    const effectiveBaseFov = isPortrait ? 1.82 : this.baseFov
    // Plunge boost: in steep dives, FOV flares open even wider for stomach-dropping speed sensation!
    const plungeBoost = Math.min(0.22, (Math.max(0, -sim.telemetry.verticalSpeedMps - 2.5) / 25.0) * 0.22)
    const fovBoost = isSpeedwing
      ? Math.min(0.26, Math.pow(Math.max(0, speedKmh - 65.0) / 50.0, 1.1) * 0.18 + plungeBoost)
      : Math.min(0.22, Math.pow(Math.max(0, speedKmh - 45.0) / 45.0, 1.15) * 0.15 + plungeBoost)
    const snapFovBoost = snapIntensity * 0.05
    const loopFovBoost = (sim.isLooping || sim.isRolling) ? 0.08 : 0
    const gTunnelFov = Math.max(0, gForce - 1.2) * 0.015
    const targetFov = Math.min(2.08, effectiveBaseFov * (1.0 + fovBoost + snapFovBoost + loopFovBoost - gTunnelFov))
    const fovFollow = wingsuitCam ? 4.5 : 14
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1.0, fovFollow * dt)
  }
}
