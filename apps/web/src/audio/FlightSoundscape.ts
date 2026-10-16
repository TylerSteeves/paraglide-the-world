export class FlightSoundscape {
  private ctx: AudioContext | null = null
  private windGain: GainNode | null = null
  private windFilter: BiquadFilterNode | null = null
  private varioOsc: OscillatorNode | null = null
  private varioGain: GainNode | null = null
  private varioTimer: number = 0

  // 3. Aeolian Line Whistle (Singing Lines under tension)
  private lineWhistleOsc: OscillatorNode | null = null
  private lineWhistleGain: GainNode | null = null

  // 4. Trailing Edge Flutter & Cloth Billow (Physical Sub-Bass Chassis Vibration)
  private brakeFlutterGain: GainNode | null = null
  private brakeFlutterFilter: BiquadFilterNode | null = null

  // 5. Pre-Stall Buffet (Throbbing Aerodynamic Shudder)
  private stallBuffetOsc: OscillatorNode | null = null
  private stallBuffetGain: GainNode | null = null

  // 6. Triboelectric Ionization & Shear Static Crackle
  private staticCrackleGain: GainNode | null = null
  private staticCrackleFilter: BiquadFilterNode | null = null

  // 7. Paramotor 2-Stroke Tuned Engine & Propeller Wash Synthesizer
  private engineOsc: OscillatorNode | null = null
  private engineSubOsc: OscillatorNode | null = null
  private engineFilter: BiquadFilterNode | null = null
  private engineGain: GainNode | null = null
  private propWashGain: GainNode | null = null
  private propWashFilter: BiquadFilterNode | null = null

  private wasCollapsedLastFrame: boolean = false
  private initialized: boolean = false

  public init() {
    if (this.initialized) return

    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      this.ctx = new AudioCtx()

      // 1. Procedural Wind Rush (Filtered White Noise)
      const bufferSize = this.ctx.sampleRate * 2
      const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate)
      const output = noiseBuffer.getChannelData(0)
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1
      }

      const whiteNoise = this.ctx.createBufferSource()
      whiteNoise.buffer = noiseBuffer
      whiteNoise.loop = true

      this.windFilter = this.ctx.createBiquadFilter()
      this.windFilter.type = 'lowpass'
      this.windFilter.frequency.value = 350

      this.windGain = this.ctx.createGain()
      this.windGain.gain.value = 0.05

      whiteNoise.connect(this.windFilter)
      this.windFilter.connect(this.windGain)
      this.windGain.connect(this.ctx.destination)
      whiteNoise.start()

      // 2. Procedural Variometer Beep (Sine Oscillator)
      this.varioOsc = this.ctx.createOscillator()
      this.varioOsc.type = 'sine'
      this.varioOsc.frequency.value = 650

      this.varioGain = this.ctx.createGain()
      this.varioGain.gain.value = 0

      this.varioOsc.connect(this.varioGain)
      this.varioGain.connect(this.ctx.destination)
      this.varioOsc.start()

      // 3. Aeolian Line Whistle (High-tension singing lines at 1800-3200 Hz)
      this.lineWhistleOsc = this.ctx.createOscillator()
      this.lineWhistleOsc.type = 'sine'
      this.lineWhistleOsc.frequency.value = 2200

      this.lineWhistleGain = this.ctx.createGain()
      this.lineWhistleGain.gain.value = 0

      this.lineWhistleOsc.connect(this.lineWhistleGain)
      this.lineWhistleGain.connect(this.ctx.destination)
      this.lineWhistleOsc.start()

      // 4. Trailing Edge Flutter (Sub-bass cloth vibration: 48 Hz - 75 Hz)
      const flutterNoise = this.ctx.createBufferSource()
      flutterNoise.buffer = noiseBuffer
      flutterNoise.loop = true

      this.brakeFlutterFilter = this.ctx.createBiquadFilter()
      this.brakeFlutterFilter.type = 'lowpass'
      this.brakeFlutterFilter.frequency.value = 68

      this.brakeFlutterGain = this.ctx.createGain()
      this.brakeFlutterGain.gain.value = 0

      flutterNoise.connect(this.brakeFlutterFilter)
      this.brakeFlutterFilter.connect(this.brakeFlutterGain)
      this.brakeFlutterGain.connect(this.ctx.destination)
      flutterNoise.start()

      // 5. Pre-Stall Buffet (34 Hz pulsating aerodynamic shudder)
      this.stallBuffetOsc = this.ctx.createOscillator()
      this.stallBuffetOsc.type = 'triangle'
      this.stallBuffetOsc.frequency.value = 34

      this.stallBuffetGain = this.ctx.createGain()
      this.stallBuffetGain.gain.value = 0

      this.stallBuffetOsc.connect(this.stallBuffetGain)
      this.stallBuffetGain.connect(this.ctx.destination)
      this.stallBuffetOsc.start()

      // 6. Triboelectric RF Static Crackle (5.4 kHz bandpass filtered noise)
      const crackleNoise = this.ctx.createBufferSource()
      crackleNoise.buffer = noiseBuffer
      crackleNoise.loop = true

      this.staticCrackleFilter = this.ctx.createBiquadFilter()
      this.staticCrackleFilter.type = 'bandpass'
      this.staticCrackleFilter.frequency.value = 5400
      this.staticCrackleFilter.Q.value = 4.0

      this.staticCrackleGain = this.ctx.createGain()
      this.staticCrackleGain.gain.value = 0

      crackleNoise.connect(this.staticCrackleFilter)
      this.staticCrackleFilter.connect(this.staticCrackleGain)
      this.staticCrackleGain.connect(this.ctx.destination)
      crackleNoise.start()

      // 7. Paramotor 2-Stroke Tuned Pipe Engine Synthesizer (Vittorazi Moster 185)
      this.engineOsc = this.ctx.createOscillator()
      this.engineOsc.type = 'sawtooth'
      this.engineOsc.frequency.value = 32

      this.engineSubOsc = this.ctx.createOscillator()
      this.engineSubOsc.type = 'triangle'
      this.engineSubOsc.frequency.value = 16

      this.engineFilter = this.ctx.createBiquadFilter()
      this.engineFilter.type = 'bandpass'
      this.engineFilter.frequency.value = 240
      this.engineFilter.Q.value = 2.8

      this.engineGain = this.ctx.createGain()
      this.engineGain.gain.value = 0

      this.engineOsc.connect(this.engineFilter)
      this.engineSubOsc.connect(this.engineFilter)
      this.engineFilter.connect(this.engineGain)
      this.engineGain.connect(this.ctx.destination)
      this.engineOsc.start()
      this.engineSubOsc.start()

      // Propeller Wash Noise (carbon prop thrust chop)
      const propNoise = this.ctx.createBufferSource()
      propNoise.buffer = noiseBuffer
      propNoise.loop = true

      this.propWashFilter = this.ctx.createBiquadFilter()
      this.propWashFilter.type = 'bandpass'
      this.propWashFilter.frequency.value = 450
      this.propWashFilter.Q.value = 1.8

      this.propWashGain = this.ctx.createGain()
      this.propWashGain.gain.value = 0

      propNoise.connect(this.propWashFilter)
      this.propWashFilter.connect(this.propWashGain)
      this.propWashGain.connect(this.ctx.destination)
      propNoise.start()

      this.initialized = true
    } catch (err) {
      console.warn('Web Audio could not be initialized:', err)
    }
  }

  public update(
    airspeedKmh: number,
    verticalSpeedMps: number,
    gForce: number,
    lineTensionN: number = 860,
    leftForceN: number = 0,
    rightForceN: number = 0,
    stallWarning: number = 0,
    isStalled: boolean = false,
    dt: number = 0.016,
    staticChargeField: number = 0,
    engineRpm: number = 0,
    throttlePercent: number = 0,
    wingType: string = 'paraglider',
    isCollapsed: boolean = false,
    collapseFrac: number = 0,
  ) {
    if (
      !this.initialized ||
      !this.ctx ||
      !this.windGain ||
      !this.windFilter ||
      !this.varioGain ||
      !this.varioOsc ||
      !this.lineWhistleGain ||
      !this.lineWhistleOsc ||
      !this.brakeFlutterGain ||
      !this.stallBuffetGain
    ) {
      return
    }

    if (this.ctx.state === 'suspended') {
      this.ctx.resume()
    }

    // 0. Canopy Re-inflation Audio: Snap open on recovery from collapse
    if (this.wasCollapsedLastFrame && !isCollapsed) {
      this.playReinflationPop()
    }
    this.wasCollapsedLastFrame = isCollapsed

    // 1. Modulate Wind Noise: Clean laminar rush; exhilarating roar on surges & G-turns; quiet float on zero-G; screaming roar on freefall
    const isSpeedwing = wingType === 'speedwing'
    const speedRatio = Math.max(0.1, Math.min(4.8, airspeedKmh / (isSpeedwing ? 70.0 : 42.0)))
    const gHeaviness = Math.max(0, gForce - 1.0)
    const zeroGFloat = Math.max(0, 1.0 - gForce)
    // Plunge rush: in steep dives, wind screams with roaring airframe pressure!
    const plungeNoise = Math.max(0, -verticalSpeedMps - 3.0) / 20.0
    let targetGain = (0.08 + Math.pow(speedRatio, 1.45) * (isSpeedwing ? 0.32 : 0.18) + gHeaviness * 0.22 + plungeNoise * 0.35) * (1.0 - zeroGFloat * 0.35)
    let targetFreq = (340 + Math.pow(speedRatio, 1.55) * (isSpeedwing ? 1650 : 1050) + gHeaviness * 650 + plungeNoise * 1800) * (1.0 - zeroGFloat * 0.25)

    if (isCollapsed || collapseFrac > 0.05) {
      // Freefall plunge: screaming wind roar as pilot plummets downward!
      targetGain = 0.52 + collapseFrac * 0.22
      targetFreq = 850 + collapseFrac * 850
    } else if (isStalled) {
      // Stall breakaway: laminar airflow detaches! Highs vanish, dull turbulence remains
      targetGain *= 0.35
      targetFreq = 220
    }

    this.windGain.gain.setTargetAtTime(Math.min(0.96, targetGain), this.ctx.currentTime, 0.04)
    this.windFilter.frequency.setTargetAtTime(Math.min(5500, targetFreq), this.ctx.currentTime, 0.04)

    // 2. Aeolian Line Whistle (Singing Lines)
    // Resonates when lines are taut and fast; cuts out when lines go slack or wing collapses
    const isSlack = lineTensionN < 250 || isStalled || isCollapsed || collapseFrac > 0.05
    if (isSlack || airspeedKmh < 28) {
      this.lineWhistleGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05)
    } else {
      const tensionFrac = Math.min(3.5, lineTensionN / 860.0)
      const baseWhistle = isSpeedwing ? 2200 : 1600
      const whistleFreq = baseWhistle + (airspeedKmh / 45.0) * (isSpeedwing ? 1650 : 950) + (tensionFrac - 1.0) * 1100 + plungeNoise * 850
      const whistleGain = Math.min(isSpeedwing ? 0.26 : 0.14, (0.024 * speedRatio + plungeNoise * 0.08) * Math.min(2.5, tensionFrac))
      this.lineWhistleOsc.frequency.setTargetAtTime(whistleFreq, this.ctx.currentTime, 0.035)
      this.lineWhistleGain.gain.setTargetAtTime(whistleGain, this.ctx.currentTime, 0.04)
    }

    // 3. Trailing Edge Flutter & High-G Line Tension Groan & Deflated Canopy Buffeting
    const totalBrakeForce = leftForceN + rightForceN
    const gTensionLoad = Math.max(0, gForce - 1.2) * 0.20
    if (isCollapsed || collapseFrac > 0.05) {
      // Deflated canopy cloth flutters and snaps violently in freefall airstream!
      const clothFlutter = 0.30 * collapseFrac
      this.brakeFlutterGain.gain.setTargetAtTime(clothFlutter, this.ctx.currentTime, 0.04)
      if (this.brakeFlutterFilter) {
        this.brakeFlutterFilter.frequency.setTargetAtTime(82, this.ctx.currentTime, 0.04)
      }
    } else if ((totalBrakeForce > 8 || gTensionLoad > 0.01) && !isStalled) {
      const flutterGain = Math.min(0.28, (totalBrakeForce / 120.0) * 0.18 + gTensionLoad)
      this.brakeFlutterGain.gain.setTargetAtTime(flutterGain, this.ctx.currentTime, 0.04)
      if (this.brakeFlutterFilter) {
        this.brakeFlutterFilter.frequency.setTargetAtTime(55 + gTensionLoad * 45, this.ctx.currentTime, 0.04)
      }
    } else {
      this.brakeFlutterGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08)
    }

    // 4. Pre-Stall Buffet (Pulsing 34 Hz Aerodynamic Shudder)
    if (stallWarning > 0.45 && !isStalled) {
      const buffetVol = Math.min(0.24, (stallWarning - 0.45) * 0.45)
      this.stallBuffetGain.gain.setTargetAtTime(buffetVol, this.ctx.currentTime, 0.03)
    } else {
      this.stallBuffetGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.06)
    }

    // 5. Variometer Logic: Hyper-sensitive paraglider thermalling
    if (wingType !== 'speedwing' && verticalSpeedMps > 0.08) {
      // Climbing in thermal updraft! (Threshold lowered to +0.08 m/s for instant feedback)
      const climbRate = Math.min(8.0, verticalSpeedMps)
      const pitchHz = 520 + climbRate * 195
      const beepInterval = Math.max(0.08, 0.45 - climbRate * 0.065)

      this.varioOsc.frequency.setTargetAtTime(pitchHz, this.ctx.currentTime, 0.025)

      this.varioTimer += dt
      if (this.varioTimer > beepInterval * 2) {
        this.varioTimer = 0
      }

      // Musical Beep on/off pulse
      const isBeeping = this.varioTimer < beepInterval && !this.varioMuted
      this.varioGain.gain.setTargetAtTime(isBeeping ? 0.11 : 0, this.ctx.currentTime, 0.012)
    } else if (verticalSpeedMps < -1.25 && !this.varioMuted && wingType !== 'speedwing') {
      // Sinking air warning for paraglider XC mode
      const sinkPitch = Math.max(160, 360 + (verticalSpeedMps + 1.25) * 42)
      this.varioOsc.frequency.setTargetAtTime(sinkPitch, this.ctx.currentTime, 0.04)
      this.varioGain.gain.setTargetAtTime(0.05, this.ctx.currentTime, 0.04)
    } else {
      // Quiet laminar float in neutral glide
      this.varioGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.04)
    }

    // 6. Triboelectric RF Static Crackle at Thermal Shear Margin
    if (this.staticCrackleGain && staticChargeField > 0.12) {
      // Sporadic burst ionization crackles
      const crackleBurst = Math.random() < staticChargeField * 0.45 ? 0.045 * staticChargeField : 0.002 * staticChargeField
      this.staticCrackleGain.gain.setTargetAtTime(crackleBurst, this.ctx.currentTime, 0.015)
    } else if (this.staticCrackleGain) {
      this.staticCrackleGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05)
    }

    // 7. Paramotor Engine Sound Dynamics (Vittorazi Moster 185 2-Stroke)
    if (
      this.engineGain &&
      this.engineOsc &&
      this.engineSubOsc &&
      this.engineFilter &&
      this.propWashGain &&
      this.propWashFilter
    ) {
      if (wingType === 'paramotor' && engineRpm > 500) {
        // Firing frequency f0 = RPM / 60 (2-stroke single cylinder fires once per rev)
        const firingFreq = Math.max(25, Math.min(145, engineRpm / 60))
        this.engineOsc.frequency.setTargetAtTime(firingFreq, this.ctx.currentTime, 0.03)
        this.engineSubOsc.frequency.setTargetAtTime(firingFreq * 0.5, this.ctx.currentTime, 0.03)

        // Expansion chamber resonant frequency shifts upward under high throttle / RPM
        const throttleFrac = Math.max(0, Math.min(1, throttlePercent / 100))
        const pipeFreq = 180 + throttleFrac * 360 + (engineRpm / 8400) * 220
        this.engineFilter.frequency.setTargetAtTime(pipeFreq, this.ctx.currentTime, 0.04)

        // Engine volume: idle burble (0.07) to wide-open scream (0.26)
        const targetVol = 0.07 + throttleFrac * 0.20
        this.engineGain.gain.setTargetAtTime(targetVol, this.ctx.currentTime, 0.04)

        // Propeller chop and wash noise
        const propVol = 0.02 + Math.pow(throttleFrac, 1.4) * 0.15
        this.propWashGain.gain.setTargetAtTime(propVol, this.ctx.currentTime, 0.04)
        this.propWashFilter.frequency.setTargetAtTime(320 + throttleFrac * 680, this.ctx.currentTime, 0.04)
      } else {
        this.engineGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08)
        this.propWashGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08)
      }
    }
  }

  public varioMuted: boolean = false

  public toggleVario(): boolean {
    this.varioMuted = !this.varioMuted
    if (this.varioGain && this.ctx && this.varioMuted) {
      this.varioGain.gain.setValueAtTime(0, this.ctx.currentTime)
    }
    return this.varioMuted
  }

  public playCoinSound() {
    if (!this.initialized || !this.ctx) return
    try {
      const osc = this.ctx.createOscillator()
      const gain = this.ctx.createGain()
      osc.type = 'triangle'
      osc.frequency.setValueAtTime(987.77, this.ctx.currentTime) // B5
      osc.frequency.exponentialRampToValueAtTime(1318.51, this.ctx.currentTime + 0.12) // E6

      gain.gain.setValueAtTime(0.18, this.ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.25)

      osc.connect(gain)
      gain.connect(this.ctx.destination)
      osc.start()
      osc.stop(this.ctx.currentTime + 0.25)
    } catch {
      // Ignore audio glitches
    }
  }

  public playReinflationPop() {
    if (!this.initialized || !this.ctx) return
    try {
      const t0 = this.ctx.currentTime
      // 1. Low-mid canvas thump (punchy pressurization)
      const subOsc = this.ctx.createOscillator()
      const subGain = this.ctx.createGain()
      subOsc.type = 'sine'
      subOsc.frequency.setValueAtTime(140, t0)
      subOsc.frequency.exponentialRampToValueAtTime(45, t0 + 0.18)

      subGain.gain.setValueAtTime(0.38, t0)
      subGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.22)

      subOsc.connect(subGain)
      subGain.connect(this.ctx.destination)
      subOsc.start(t0)
      subOsc.stop(t0 + 0.22)

      // 2. High-frequency line-snap / cloth snap
      const snapOsc = this.ctx.createOscillator()
      const snapGain = this.ctx.createGain()
      snapOsc.type = 'triangle'
      snapOsc.frequency.setValueAtTime(1200, t0)
      snapOsc.frequency.exponentialRampToValueAtTime(350, t0 + 0.08)

      snapGain.gain.setValueAtTime(0.24, t0)
      snapGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.09)

      snapOsc.connect(snapGain)
      snapGain.connect(this.ctx.destination)
      snapOsc.start(t0)
      snapOsc.stop(t0 + 0.09)
    } catch {
      // Ignore audio glitches
    }
  }
}
