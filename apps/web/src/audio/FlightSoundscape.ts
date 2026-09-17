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

    // 1. Modulate Wind Noise: Clean laminar rush during flight; dull low rumble during stall
    const speedRatio = Math.max(0.1, Math.min(3.0, airspeedKmh / 54.0))
    let targetGain = 0.05 * speedRatio + (gForce - 1) * 0.06
    let targetFreq = 280 + speedRatio * 520 + (gForce - 1) * 260

    if (isStalled) {
      // Stall breakaway: laminar airflow detaches! Highs vanish, dull turbulence remains
      targetGain *= 0.4
      targetFreq = 220
    }

    this.windGain.gain.setTargetAtTime(Math.min(0.45, targetGain), this.ctx.currentTime, 0.08)
    this.windFilter.frequency.setTargetAtTime(targetFreq, this.ctx.currentTime, 0.08)

    // 2. Aeolian Line Whistle (Singing Lines)
    // Resonates when lines are taut and fast; cuts out when lines go slack
    const isSlack = lineTensionN < 250 || isStalled
    if (isSlack || airspeedKmh < 35) {
      this.lineWhistleGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05)
    } else {
      const tensionFrac = Math.min(2.5, lineTensionN / 860.0)
      const whistleFreq = 1800 + (airspeedKmh / 60.0) * 550 + (tensionFrac - 1.0) * 850
      const whistleGain = Math.min(0.06, 0.012 * speedRatio * Math.min(1.8, tensionFrac))
      this.lineWhistleOsc.frequency.setTargetAtTime(whistleFreq, this.ctx.currentTime, 0.05)
      this.lineWhistleGain.gain.setTargetAtTime(whistleGain, this.ctx.currentTime, 0.06)
    }

    // 3. Trailing Edge Flutter & Cloth Billow (Physical Sub-Bass Chassis Vibration)
    // Low-frequency acoustic hum (48 - 75 Hz) that physically shakes the phone in your hands
    const totalBrakeForce = leftForceN + rightForceN
    if (totalBrakeForce > 8 && !isStalled) {
      const flutterGain = Math.min(0.22, (totalBrakeForce / 120.0) * 0.18)
      this.brakeFlutterGain.gain.setTargetAtTime(flutterGain, this.ctx.currentTime, 0.04)
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

    // 5. Variometer Logic: Climb = Beeping Tones; Sink = Low Growl

    if (verticalSpeedMps > 0.4) {
      // Climbing!
      const climbRate = Math.min(6.0, verticalSpeedMps)
      const pitchHz = 620 + climbRate * 180
      const beepInterval = Math.max(0.12, 0.45 - climbRate * 0.05)

      this.varioOsc.frequency.setTargetAtTime(pitchHz, this.ctx.currentTime, 0.03)

      this.varioTimer += dt
      if (this.varioTimer > beepInterval * 2) {
        this.varioTimer = 0
      }

      // Beep on/off pulse
      const isBeeping = this.varioTimer < beepInterval && !this.varioMuted
      this.varioGain.gain.setTargetAtTime(isBeeping ? 0.09 : 0, this.ctx.currentTime, 0.015)
    } else if (verticalSpeedMps < -2.4 && !this.varioMuted) {
      // Strong sink (> 2.4 m/s sink) -> low sink tone
      const sinkPitch = Math.max(220, 420 + verticalSpeedMps * 35)
      this.varioOsc.frequency.setTargetAtTime(sinkPitch, this.ctx.currentTime, 0.05)
      this.varioGain.gain.setTargetAtTime(0.05, this.ctx.currentTime, 0.05)
    } else {
      // Near neutral glide -> quiet
      this.varioGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05)
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
}
