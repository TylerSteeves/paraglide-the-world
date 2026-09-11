export class FlightSoundscape {
  private ctx: AudioContext | null = null
  private windGain: GainNode | null = null
  private windFilter: BiquadFilterNode | null = null
  private varioOsc: OscillatorNode | null = null
  private varioGain: GainNode | null = null
  private varioTimer: number = 0
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

      this.initialized = true
    } catch (err) {
      console.warn('Web Audio could not be initialized:', err)
    }
  }

  public update(airspeedKmh: number, verticalSpeedMps: number, gForce: number, dt: number) {
    if (!this.initialized || !this.ctx || !this.windGain || !this.windFilter || !this.varioGain || !this.varioOsc) {
      return
    }

    if (this.ctx.state === 'suspended') {
      this.ctx.resume()
    }

    // 1. Modulate Wind Noise Volume and Cutoff with Speed & Gs
    const speedRatio = Math.max(0.1, Math.min(2.0, airspeedKmh / 38.0))
    const targetGain = 0.04 * speedRatio + (gForce - 1) * 0.05
    this.windGain.gain.setTargetAtTime(Math.min(0.35, targetGain), this.ctx.currentTime, 0.08)

    const targetFreq = 260 + speedRatio * 380 + (gForce - 1) * 220
    this.windFilter.frequency.setTargetAtTime(targetFreq, this.ctx.currentTime, 0.08)

    // 2. Variometer Logic: Climb = Beeping Tones; Sink = Low Growl
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
      const isBeeping = this.varioTimer < beepInterval
      this.varioGain.gain.setTargetAtTime(isBeeping ? 0.08 : 0, this.ctx.currentTime, 0.015)
    } else if (verticalSpeedMps < -2.4) {
      // Strong sink (> 2.4 m/s sink) -> low sink tone
      const sinkPitch = Math.max(220, 420 + verticalSpeedMps * 35)
      this.varioOsc.frequency.setTargetAtTime(sinkPitch, this.ctx.currentTime, 0.05)
      this.varioGain.gain.setTargetAtTime(0.05, this.ctx.currentTime, 0.05)
    } else {
      // Near neutral glide -> quiet
      this.varioGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05)
    }
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
