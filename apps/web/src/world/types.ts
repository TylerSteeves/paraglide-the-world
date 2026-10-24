export type WorldId =
  | 'whistler'
  | 'sf'
  | 'rio'
  | 'manhattan'
  | 'paris'
  | 'egypt'
  | 'rome'
  | 'london'
  | 'toronto'
  | 'matterhorn'
  | 'chamonix'
  | 'yosemite'
  | 'dubai'
  | 'roldanillo'
  | 'himalayas'
  | 'custom-gps'

export interface Vector3Like {
  x: number
  y: number
  z: number
}

export type ThermalZone = {
  name?: string
  center: Vector3Like
  radius: number
  strengthMps: number
  cyclePeriodSeconds?: number
  cyclePhaseOffset?: number
  surfaceType?: string
  topAltitude?: number
  expansionRatio?: number
  /** Steady vertical elevator. No wind lean, no sink collar. */
  columnLift?: boolean
}

export interface ThermalFluidSample {
  velocity: Vector3Like          // 3D fluid velocity vector (vx, vy, vz) in m/s
  temperatureAnomalyC: number    // Temperature delta: +5.5°C in warm core, -3.2°C in cold tail
  staticChargeField: number      // Atmospheric electrostatic space charge [0, 1]
  isDraftingZone: boolean        // True in convective core & buoyant wake
}

export type WorldObstacleType =
  | 'tree'
  | 'chalet'
  | 'boulder'
  | 'tower'
  | 'lodge'
  | 'bridge-pier'
  | 'bridge-deck'
  | 'pole'

export interface WorldObstacle {
  type: WorldObstacleType
  name: string
  x: number
  yMin: number
  yMax: number
  z: number
  radius: number
  halfWidth?: number
  halfDepth?: number
  /** Footprint in world x/z. When set, only the interior of this shape is solid. */
  ring?: ReadonlyArray<{ x: number; z: number }>
}

export interface FlightWorld {
  readonly launchPosition: Vector3Like
  readonly launchHeadingDeg: number
  readonly terrainMesh?: any
  readonly thermals?: ThermalZone[]
  readonly obstacles?: WorldObstacle[]
  sampleHeight(x: number, z: number): number
  sampleUpdraft(x: number, y: number, z: number, timeSeconds?: number, windVector?: Vector3Like): number
  sampleRidgeLift?(x: number, y: number, z: number, windDir: Vector3Like, windSpeedMps: number): number
  sampleVenturi?(x: number, y: number, z: number, baseWind: Vector3Like): Vector3Like
  sampleThermalFluidVelocity?(
    x: number,
    y: number,
    z: number,
    timeSeconds?: number,
    windVector?: Vector3Like,
  ): ThermalFluidSample
  checkPhotorealCollision?(x: number, y: number, z: number): string | null
  dispose(): void
}

