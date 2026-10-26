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

  // Just A major. A second root a fraction sharp makes a slow beat, like air moving.
  // Pitches never move. Speed only opens the next note.
  private readonly chordHz = [110, 110.4, 165, 220, 275, 330]
  private chordVoices: { osc: OscillatorNode; gain: GainNode }[] = []
  private chordPhase = 0

  /** Create the context inside a user gesture and pull it out of suspension. */
  public unlock(): void {
    this.init()
    const ctx = this.ctx
    if (!ctx) return
    if (ctx.state === 'suspended' || ctx.state === 'interrupted') {
      void ctx.resume()
    }
  }

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

      for (const hz of this.chordHz) {
        const osc = this.ctx.createOscillator()
        osc.type = 'sine'
        osc.frequency.value = hz
        const gain = this.ctx.createGain()
        gain.gain.value = 0
        osc.connect(gain)
        gain.connect(this.ctx.destination)
        osc.start()
        this.chordVoices.push({ osc, gain })
      }

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
      this.engineOsc.type = 'sine'
      this.engineOsc.frequency.value = 164.81

      this.engineSubOsc = this.ctx.createOscillator()
      this.engineSubOsc.type = 'sine'
      this.engineSubOsc.frequency.value = 110

      this.engineFilter = this.ctx.createBiquadFilter()
      this.engineFilter.type = 'lowpass'
      this.engineFilter.frequency.value = 480
      this.engineFilter.Q.value = 0.5

      this.engineGain = this.ctx.createGain()
      this.engineGain.gain.value = 0

      this.engineOsc.connect(this.engineFilter)
      this.engineSubOsc.connect(this.engineFilter)
      this.engineFilter.connect(this.engineGain)
      this.engineGain.connect(this.ctx.destination)
      this.engineOsc.start()
      this.engineSubOsc.start()

      // Kept silent. The jet is two quiet chord tones, not a hiss.
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
    _lineTensionN: number = 860,
    leftForceN: number = 0,
    rightForceN: number = 0,
    stallWarning: number = 0,
    isStalled: boolean = false,
    dt: number = 0.016,
    _staticChargeField: number = 0,
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

    if (this.ctx.state === 'suspended' || this.ctx.state === 'interrupted') {
      void this.ctx.resume()
    }

    // 0. Canopy Re-inflation Audio: Snap open on recovery from collapse
    if (this.wasCollapsedLastFrame && !isCollapsed) {
      this.playReinflationPop()
    }
    this.wasCollapsedLastFrame = isCollapsed

    // 1. A dark rush under a fixed chord. The noise stays quiet; the notes carry the intensity.
    const isSpeedwing = wingType === 'speedwing'
    const speedRatio = Math.max(0.1, Math.min(4.8, airspeedKmh / (isSpeedwing ? 70.0 : 42.0)))
    const gHeaviness = Math.max(0, gForce - 1.0)
    const zeroGFloat = Math.max(0, 1.0 - gForce)
    const plungeNoise = Math.max(0, -verticalSpeedMps - 6.0) / 24.0
    let targetGain = (0.018 + Math.pow(speedRatio, 1.35) * (isSpeedwing ? 0.05 : 0.032) + gHeaviness * 0.015 + plungeNoise * 0.03) * (1.0 - zeroGFloat * 0.4)
    let targetFreq = (140 + Math.pow(speedRatio, 1.05) * 90 + plungeNoise * 40) * (1.0 - zeroGFloat * 0.2)

    if (isCollapsed || collapseFrac > 0.05) {
      targetGain = 0.08 + collapseFrac * 0.04
      targetFreq = 180
    } else if (isStalled) {
      targetGain *= 0.35
      targetFreq = 120
    }

    this.windGain.gain.setTargetAtTime(Math.min(0.1, targetGain), this.ctx.currentTime, 0.12)
    this.windFilter.frequency.setTargetAtTime(Math.min(380, targetFreq), this.ctx.currentTime, 0.12)

    // A2, a slow-beating twin, E3, A3, C#4, E4. Same chord at every speed.
    const energy = Math.max(0, Math.min(1.7, (speedRatio - 0.2) * 0.72 + plungeNoise * 0.4 + gHeaviness * 0.1))
    this.chordPhase += dt * Math.PI * 2 * 0.2
    const breath = 0.86 + 0.14 * Math.sin(this.chordPhase)
    const open = (edge: number, width: number) => {
      const t = Math.max(0, Math.min(1, (energy - edge) / width))
      return t * t * (3 - 2 * t)
    }
    // A glide already holds A–E–A. Speed opens C# and the top E. Pitches stay put.
    let chord = [
      (0.045 + energy * 0.045) * breath,
      (0.03 + energy * 0.028) * breath,
      (0.025 + open(0.0, 0.45) * 0.05) * breath,
      open(0.15, 0.45) * 0.055 * breath,
      open(0.5, 0.45) * 0.032 * breath,
      open(0.9, 0.4) * 0.02 * breath,
    ]
    if (isStalled) {
      chord = chord.map((gain, i) => (i < 2 ? gain * 0.4 : 0))
    } else if (isCollapsed || collapseFrac > 0.05) {
      chord[0] = Math.min(0.05, chord[0] + 0.016)
      chord[1] = Math.min(0.032, chord[1] + 0.01)
      chord[2] = Math.min(0.028, chord[2] + 0.008)
      chord[3] *= 0.25
      chord[4] = 0
      chord[5] = 0
    } else if (zeroGFloat > 0.35) {
      const thin = 1 - zeroGFloat * 0.7
      chord = chord.map((gain) => gain * thin)
    }
    const chordNow = this.ctx.currentTime
    for (let i = 0; i < this.chordVoices.length; i++) {
      this.chordVoices[i].gain.gain.setTargetAtTime(chord[i] ?? 0, chordNow, 0.22)
    }

    // The high line whistle and the radio-static crackle read as noise, so they stay closed.
    this.lineWhistleGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05)
    if (this.staticCrackleGain) {
      this.staticCrackleGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05)
    }

    // 3. Cloth flutter only on a real brake pull or a collapse, not on ordinary G.
    const totalBrakeForce = leftForceN + rightForceN
    if (isCollapsed || collapseFrac > 0.05) {
      this.brakeFlutterGain.gain.setTargetAtTime(0.06 * collapseFrac, this.ctx.currentTime, 0.06)
      if (this.brakeFlutterFilter) {
        this.brakeFlutterFilter.frequency.setTargetAtTime(70, this.ctx.currentTime, 0.06)
      }
    } else if (totalBrakeForce > 40 && !isStalled) {
      const flutterGain = Math.min(0.07, ((totalBrakeForce - 40) / 180.0) * 0.07)
      this.brakeFlutterGain.gain.setTargetAtTime(flutterGain, this.ctx.currentTime, 0.06)
      if (this.brakeFlutterFilter) {
        this.brakeFlutterFilter.frequency.setTargetAtTime(52, this.ctx.currentTime, 0.06)
      }
    } else {
      this.brakeFlutterGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1)
    }

    // 4. Stall warning stays, quieter, and only once the wing is actually near a stall.
    if (stallWarning > 0.6 && !isStalled) {
      const buffetVol = Math.min(0.07, (stallWarning - 0.6) * 0.16)
      this.stallBuffetGain.gain.setTargetAtTime(buffetVol, this.ctx.currentTime, 0.05)
    } else {
      this.stallBuffetGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08)
    }

    // 5. Variometer: a soft chirp on a real climb, a rare low tone on a hard sink.
    const climbing = wingType !== 'speedwing' && verticalSpeedMps > 0.75 && !this.varioMuted
    // A wingsuit glide sinks the whole time. That is not a stall warning.
    const hardSink = wingType !== 'speedwing' && wingType !== 'wingsuit' && verticalSpeedMps < -4.5 && !this.varioMuted
    if (climbing || hardSink) {
      const climbRate = climbing ? Math.min(5.0, verticalSpeedMps) : 0
      const climbNotes = [440, 554.37, 659.25]
      const pitchHz = climbing ? climbNotes[climbRate < 1.6 ? 0 : climbRate < 3.2 ? 1 : 2] : 164.81
      const beepInterval = climbing ? Math.max(0.36, 0.95 - climbRate * 0.06) : 0.9
      const beepGain = climbing ? 0.04 : 0.022
      this.varioOsc.frequency.setTargetAtTime(pitchHz, this.ctx.currentTime, 0.06)
      this.varioTimer += dt
      if (this.varioTimer > beepInterval) this.varioTimer = 0
      const isBeeping = this.varioTimer < 0.14
      this.varioGain.gain.setTargetAtTime(isBeeping ? beepGain : 0, this.ctx.currentTime, 0.04)
    } else {
      this.varioGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08)
    }

    // 7. Hydrogen jet. A quiet fifth in the same chord, never a hiss.
    if (
      this.engineGain &&
      this.engineOsc &&
      this.engineSubOsc &&
      this.engineFilter &&
      this.propWashGain &&
      this.propWashFilter
    ) {
      this.propWashGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2)
      const throttleFrac = Math.max(0, Math.min(1, throttlePercent / 100))
      const lit = (wingType === 'paramotor' || wingType === 'paraglider') && engineRpm > 500 && throttleFrac > 0.08
      const level = lit ? throttleFrac * throttleFrac * 0.01 : 0
      this.engineOsc.frequency.setTargetAtTime(164.81, this.ctx.currentTime, 0.5)
      this.engineSubOsc.frequency.setTargetAtTime(110, this.ctx.currentTime, 0.5)
      this.engineGain.gain.setTargetAtTime(level, this.ctx.currentTime, 0.45)
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
      osc.type = 'sine'
      osc.frequency.setValueAtTime(659.25, this.ctx.currentTime) // E5
      osc.frequency.exponentialRampToValueAtTime(880, this.ctx.currentTime + 0.14) // A5

      gain.gain.setValueAtTime(0.06, this.ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.28)

      osc.connect(gain)
      gain.connect(this.ctx.destination)
      osc.start()
      osc.stop(this.ctx.currentTime + 0.28)
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

      subGain.gain.setValueAtTime(0.14, t0)
      subGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.22)

      subOsc.connect(subGain)
      subGain.connect(this.ctx.destination)
      subOsc.start(t0)
      subOsc.stop(t0 + 0.22)

      // 2. High-frequency line-snap / cloth snap
      const snapOsc = this.ctx.createOscillator()
      const snapGain = this.ctx.createGain()
      snapOsc.type = 'sine'
      snapOsc.frequency.setValueAtTime(480, t0)
      snapOsc.frequency.exponentialRampToValueAtTime(240, t0 + 0.08)

      snapGain.gain.setValueAtTime(0.04, t0)
      snapGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.09)

      snapOsc.connect(snapGain)
      snapGain.connect(this.ctx.destination)
      snapOsc.start(t0)
      snapOsc.stop(t0 + 0.09)
    } catch {
      // Ignore audio glitches
    }
  }

  public playGoreCrashSound(impactSpeedKmh: number = 60) {
    if (!this.initialized || !this.ctx) return
    try {
      const t0 = this.ctx.currentTime
      // Silence continuous flight loops
      this.windGain?.gain.setTargetAtTime(0.01, t0, 0.05)
      for (const voice of this.chordVoices) {
        voice.gain.gain.setTargetAtTime(0, t0, 0.05)
      }
      this.varioGain?.gain.setTargetAtTime(0, t0, 0.02)
      this.lineWhistleGain?.gain.setTargetAtTime(0, t0, 0.02)
      this.brakeFlutterGain?.gain.setTargetAtTime(0, t0, 0.02)
      this.engineGain?.gain.setTargetAtTime(0, t0, 0.03)
      this.propWashGain?.gain.setTargetAtTime(0, t0, 0.03)

      const intensity = Math.min(1.2, Math.max(0.75, impactSpeedKmh / 70.0))

      // One low thud, then a short muted chord. No crunch, no splat.
      const boomOsc = this.ctx.createOscillator()
      const boomGain = this.ctx.createGain()
      boomOsc.type = 'sine'
      boomOsc.frequency.setValueAtTime(78 * intensity, t0)
      boomOsc.frequency.exponentialRampToValueAtTime(36, t0 + 0.5)
      boomGain.gain.setValueAtTime(0.22, t0)
      boomGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.55)
      boomOsc.connect(boomGain)
      boomGain.connect(this.ctx.destination)
      boomOsc.start(t0)
      boomOsc.stop(t0 + 0.56)

      const stingNotes = [98.0, 146.83]
      for (const freq of stingNotes) {
        const osc = this.ctx.createOscillator()
        const gain = this.ctx.createGain()
        osc.type = 'sine'
        osc.frequency.setValueAtTime(freq, t0 + 0.16)
        const lp = this.ctx.createBiquadFilter()
        lp.type = 'lowpass'
        lp.frequency.setValueAtTime(280, t0 + 0.16)
        lp.frequency.exponentialRampToValueAtTime(120, t0 + 1.15)
        gain.gain.setValueAtTime(0.001, t0 + 0.16)
        gain.gain.linearRampToValueAtTime(0.045, t0 + 0.28)
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 1.2)
        osc.connect(lp)
        lp.connect(gain)
        gain.connect(this.ctx.destination)
        osc.start(t0 + 0.16)
        osc.stop(t0 + 1.25)
      }
    } catch {
      // Ignore audio glitches
    }
  }

  public playRagdollBounceSound(impactSpeed: number = 8) {
    if (!this.initialized || !this.ctx) return
    try {
      const t0 = this.ctx.currentTime
      const vol = Math.min(0.09, Math.max(0.03, impactSpeed / 48.0))

      const thudOsc = this.ctx.createOscillator()
      const thudGain = this.ctx.createGain()
      thudOsc.type = 'sine'
      thudOsc.frequency.setValueAtTime(70, t0)
      thudOsc.frequency.exponentialRampToValueAtTime(32, t0 + 0.18)
      thudGain.gain.setValueAtTime(vol, t0)
      thudGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.2)
      thudOsc.connect(thudGain)
      thudGain.connect(this.ctx.destination)
      thudOsc.start(t0)
      thudOsc.stop(t0 + 0.21)
    } catch {
      // Ignore audio glitches
    }
  }
}
