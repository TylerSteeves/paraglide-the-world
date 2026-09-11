export type GoogleWorldMode = 'standard-2d' | 'premium-3d'

export type WorldMode = 'godogen-3d' | GoogleWorldMode

export const DEFAULT_GOOGLE_WORLD_MODE: GoogleWorldMode = 'standard-2d'

export const DEFAULT_WORLD_MODE: WorldMode = 'godogen-3d'

export const GOOGLE_WORLD_MODE_OPTIONS: Array<{
  id: GoogleWorldMode
  label: string
  summary: string
}> = [
  {
    id: 'standard-2d',
    label: 'Standard 2D',
    summary: 'Google satellite tiles with the same flight model and chase camera.',
  },
  {
    id: 'premium-3d',
    label: 'Premium 3D',
    summary: 'Google photorealistic 3D tiles for the full Earth-flying presentation.',
  },
]

export const WORLD_MODE_OPTIONS: Array<{
  id: WorldMode
  label: string
  summary: string
}> = [
  {
    id: 'godogen-3d',
    label: 'Instant 3D',
    summary:
      'A vivid procedural mountain world that launches immediately with no map key.',
  },
  ...GOOGLE_WORLD_MODE_OPTIONS,
]

export function isGoogleWorldMode(mode: WorldMode): mode is GoogleWorldMode {
  return mode === 'standard-2d' || mode === 'premium-3d'
}
