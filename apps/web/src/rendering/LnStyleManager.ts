import { Color3 } from '@babylonjs/core/Maths/math.color'

export type LnStyleId = 'pen-plotter' | 'cyber-vector' | 'infrared-flir' | 'monochrome' | 'aviation-topo' | 'photoreal'

export interface LnPalette {
  id: LnStyleId
  name: string
  shortLabel: string
  isLineMode: boolean
  isIrVision?: boolean
  canvasBackground: string
  backgroundRgb: Color3
  terrainBaseRgb: Color3
  minorContourRgb: Color3
  majorContourRgb: Color3
  ridgeEdgeRgb: Color3
  thermalStreamlineRgb: Color3
  celestialGridRgb: Color3
  canopyRibRgb: Color3
  canopyFillRgb: Color3
  suspensionLineRgb: Color3
  pilotSilhouetteRgb: Color3
  fogDensity: number
  minorIntervalMeters: number
  majorIntervalMeters: number
  longitudinalSpacingMeters: number
}

export const LN_PALETTES: Record<LnStyleId, LnPalette> = {
  'pen-plotter': {
    id: 'pen-plotter',
    name: 'Pen Plotter (Classic ln)',
    shortLabel: '✒️ PLOTTER',
    isLineMode: true,
    canvasBackground: '#f6f4ee',
    backgroundRgb: new Color3(0.965, 0.957, 0.933),
    terrainBaseRgb: new Color3(0.945, 0.933, 0.902),
    minorContourRgb: new Color3(0.18, 0.18, 0.22),    // 0.3mm India ink
    majorContourRgb: new Color3(0.68, 0.24, 0.12),    // Burnt sienna index lines
    ridgeEdgeRgb: new Color3(0.06, 0.06, 0.08),       // Bold crest outline
    thermalStreamlineRgb: new Color3(0.08, 0.48, 0.78), // Cyan drafting ink
    celestialGridRgb: new Color3(0.78, 0.75, 0.68),   // Architectural compass grid
    canopyRibRgb: new Color3(0.12, 0.12, 0.15),
    canopyFillRgb: new Color3(0.98, 0.97, 0.95),
    suspensionLineRgb: new Color3(0.15, 0.15, 0.18),
    pilotSilhouetteRgb: new Color3(0.12, 0.12, 0.15),
    fogDensity: 0.00018,
    minorIntervalMeters: 25.0,
    majorIntervalMeters: 100.0,
    longitudinalSpacingMeters: 80.0,
  },
  'cyber-vector': {
    id: 'cyber-vector',
    name: 'Cyber Vector (Radar Void)',
    shortLabel: '⚡ CYBER',
    isLineMode: true,
    canvasBackground: '#030712',
    backgroundRgb: new Color3(0.012, 0.027, 0.071),
    terrainBaseRgb: new Color3(0.024, 0.047, 0.102),
    minorContourRgb: new Color3(0.00, 0.94, 0.98),    // Neon cyan isolines
    majorContourRgb: new Color3(0.98, 0.80, 0.12),    // Solar amber index lines
    ridgeEdgeRgb: new Color3(0.24, 0.78, 1.00),       // Glowing ridge crest
    thermalStreamlineRgb: new Color3(0.72, 0.32, 1.00), // Ultraviolet thermal helix
    celestialGridRgb: new Color3(0.14, 0.22, 0.36),   // Deep radar compass rings
    canopyRibRgb: new Color3(0.00, 0.94, 0.98),
    canopyFillRgb: new Color3(0.02, 0.06, 0.14),
    suspensionLineRgb: new Color3(0.98, 0.80, 0.12),
    pilotSilhouetteRgb: new Color3(0.00, 0.94, 0.98),
    fogDensity: 0.00015,
    minorIntervalMeters: 16.0,
    majorIntervalMeters: 64.0,
    longitudinalSpacingMeters: 24.0,
  },
  'infrared-flir': {
    id: 'infrared-flir',
    name: 'FLIR Thermal IR (Heat Signatures)',
    shortLabel: '🕶️ FLIR IR',
    isLineMode: true,
    isIrVision: true,
    canvasBackground: '#050212',
    backgroundRgb: new Color3(0.02, 0.008, 0.07),       // Cryogenic cosmic space (-50°C)
    terrainBaseRgb: new Color3(0.12, 0.05, 0.22),      // Ambient cool indigo terrain
    minorContourRgb: new Color3(0.58, 0.12, 0.68),     // Radiometric purple/magenta isolines
    majorContourRgb: new Color3(0.98, 0.65, 0.15),     // Radiant flame amber index lines
    ridgeEdgeRgb: new Color3(0.95, 0.32, 0.18),        // Sunlit warm ridge heat
    thermalStreamlineRgb: new Color3(1.00, 0.94, 0.45),// Incandescent solar-gold core
    celestialGridRgb: new Color3(0.24, 0.09, 0.42),    // Infrared coordinate grid
    canopyRibRgb: new Color3(0.25, 0.88, 1.00),        // Aerogel aerodynamic rib
    canopyFillRgb: new Color3(0.04, 0.02, 0.10),
    suspensionLineRgb: new Color3(0.98, 0.85, 0.25),
    pilotSilhouetteRgb: new Color3(0.95, 0.28, 0.18),  // 37°C body heat
    fogDensity: 0.00016,
    minorIntervalMeters: 25.0,
    majorIntervalMeters: 100.0,
    longitudinalSpacingMeters: 80.0,
  },
  'monochrome': {
    id: 'monochrome',
    name: 'Unknown Pleasures (Minimalist)',
    shortLabel: '⚪ MONO',
    isLineMode: true,
    canvasBackground: '#000000',
    backgroundRgb: new Color3(0.0, 0.0, 0.0),
    terrainBaseRgb: new Color3(0.03, 0.03, 0.03),
    minorContourRgb: new Color3(0.85, 0.85, 0.88),    // Clean white contour slices
    majorContourRgb: new Color3(1.00, 1.00, 1.00),    // Bold white index lines
    ridgeEdgeRgb: new Color3(1.00, 1.00, 1.00),
    thermalStreamlineRgb: new Color3(0.65, 0.65, 0.70),
    celestialGridRgb: new Color3(0.18, 0.18, 0.20),
    canopyRibRgb: new Color3(1.00, 1.00, 1.00),
    canopyFillRgb: new Color3(0.05, 0.05, 0.05),
    suspensionLineRgb: new Color3(0.90, 0.90, 0.92),
    pilotSilhouetteRgb: new Color3(1.00, 1.00, 1.00),
    fogDensity: 0.00020,
    minorIntervalMeters: 20.0,
    majorIntervalMeters: 100.0,
    longitudinalSpacingMeters: 75.0,
  },
  'aviation-topo': {
    id: 'aviation-topo',
    name: 'Aeronautical Sectional Chart',
    shortLabel: '🧭 TOPO',
    isLineMode: true,
    canvasBackground: '#f8fafc',
    backgroundRgb: new Color3(0.97, 0.98, 0.99),
    terrainBaseRgb: new Color3(0.93, 0.95, 0.97),
    minorContourRgb: new Color3(0.55, 0.32, 0.08),    // Sepia topo isolines
    majorContourRgb: new Color3(0.32, 0.12, 0.02),    // Deep umber index lines
    ridgeEdgeRgb: new Color3(0.15, 0.20, 0.30),       // Slate crests
    thermalStreamlineRgb: new Color3(0.88, 0.22, 0.22), // Red thermal lift zone
    celestialGridRgb: new Color3(0.12, 0.48, 0.78),   // ICAO blue navigation radials
    canopyRibRgb: new Color3(0.15, 0.20, 0.30),
    canopyFillRgb: new Color3(0.98, 0.98, 0.99),
    suspensionLineRgb: new Color3(0.55, 0.32, 0.08),
    pilotSilhouetteRgb: new Color3(0.15, 0.20, 0.30),
    fogDensity: 0.00016,
    minorIntervalMeters: 25.0,
    majorIntervalMeters: 100.0,
    longitudinalSpacingMeters: 80.0,
  },
  'photoreal': {
    id: 'photoreal',
    name: 'Atmospheric Photoreal',
    shortLabel: '🌄 PHOTO',
    isLineMode: false,
    canvasBackground: '#0b151f',
    backgroundRgb: new Color3(0.043, 0.082, 0.122),
    terrainBaseRgb: new Color3(0.94, 0.96, 0.98), // Alpine snow base
    minorContourRgb: new Color3(0.15, 0.15, 0.15),
    majorContourRgb: new Color3(0.9, 0.8, 0.2),
    ridgeEdgeRgb: new Color3(0.2, 0.2, 0.2),
    thermalStreamlineRgb: new Color3(0.98, 0.55, 0.15),
    celestialGridRgb: new Color3(0.5, 0.6, 0.8),
    canopyRibRgb: new Color3(0.9, 0.1, 0.1),
    canopyFillRgb: new Color3(0.96, 0.15, 0.15),
    suspensionLineRgb: new Color3(0.95, 0.95, 0.95),
    pilotSilhouetteRgb: new Color3(0.1, 0.1, 0.12),
    fogDensity: 0.00008, // Crisp alpine atmosphere
    minorIntervalMeters: 25.0,
    majorIntervalMeters: 100.0,
    longitudinalSpacingMeters: 80.0,
  },
}

export type StyleChangeListener = (palette: LnPalette) => void

export class LnStyleManager {
  private static instance: LnStyleManager | null = null
  private currentStyleId: LnStyleId = 'cyber-vector' // Default to Cyber Vector (Radar Void Warp Grid)!
  private listeners: Set<StyleChangeListener> = new Set()

  private constructor() {}

  public static getInstance(): LnStyleManager {
    if (!LnStyleManager.instance) {
      LnStyleManager.instance = new LnStyleManager()
    }
    return LnStyleManager.instance
  }

  public get currentStyle(): LnStyleId {
    return this.currentStyleId
  }

  private irGogglesActive: boolean = false

  public get isIrGoggles(): boolean {
    return this.irGogglesActive || this.currentStyleId === 'infrared-flir'
  }

  public toggleIrGoggles(): boolean {
    this.irGogglesActive = !this.irGogglesActive
    if (typeof document !== 'undefined') {
      if (this.irGogglesActive) {
        document.body.classList.add('ir-goggles-active')
      } else {
        document.body.classList.remove('ir-goggles-active')
      }
    }
    this.notify()
    return this.irGogglesActive
  }

  public get palette(): LnPalette {
    if (this.irGogglesActive) {
      return {
        ...LN_PALETTES['infrared-flir'],
        isIrVision: true,
      }
    }
    return {
      ...LN_PALETTES[this.currentStyleId],
      isIrVision: this.currentStyleId === 'infrared-flir',
    }
  }

  public setStyle(id: LnStyleId): void {
    if (this.currentStyleId === id) return
    this.currentStyleId = id
    const pal = this.palette

    // Apply document canvas background color
    if (typeof document !== 'undefined') {
      document.body.style.backgroundColor = pal.canvasBackground
      const renderCanvas = document.getElementById('renderCanvas')
      if (renderCanvas) {
        renderCanvas.style.backgroundColor = pal.canvasBackground
      }
      if (pal.isLineMode) {
        document.body.classList.add('ln-mode-active')
        document.body.classList.remove('photoreal-mode')
      } else {
        document.body.classList.remove('ln-mode-active')
        document.body.classList.add('photoreal-mode')
      }
      document.body.setAttribute('data-ln-style', id)
    }

    this.notify()
  }

  public cycleStyle(): LnPalette {
    const sequence: LnStyleId[] = ['pen-plotter', 'cyber-vector', 'infrared-flir', 'monochrome', 'aviation-topo', 'photoreal']
    const nextIdx = (sequence.indexOf(this.currentStyleId) + 1) % sequence.length
    this.setStyle(sequence[nextIdx])
    return this.palette
  }

  public subscribe(listener: StyleChangeListener): () => void {
    this.listeners.add(listener)
    listener(this.palette)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    const pal = this.palette
    for (const listener of this.listeners) {
      try {
        listener(pal)
      } catch (err) {
        console.error('Error in LnStyleManager listener:', err)
      }
    }
  }
}
