import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Scene } from '@babylonjs/core/scene'
import type {
  FlightWorld,
  ThermalFluidSample,
  ThermalZone,
  Vector3Like,
  WorldId,
  WorldObstacle,
} from './types'
import { calculateToroidalThermalFluid } from './ThermalFluidDynamics'
import {
  GodsEyeGlobeEngine,
  lonLatToTileXY,
  type DecodedOpenFreeMapBuilding,
} from './GodsEyeGlobeEngine'
import { LnStyleManager } from '../rendering/LnStyleManager'
import { TORONTO_ELEVATORS } from './TorontoCourse'
import { StreetNameLayer } from './StreetNames'

function decimateRing(
  ring: Array<{ x: number; z: number }>,
  maxPts: number,
): Array<{ x: number; z: number }> {
  if (ring.length <= maxPts) return ring.map((p) => ({ x: p.x, z: p.z }))
  const out: Array<{ x: number; z: number }> = []
  const step = ring.length / maxPts
  for (let i = 0; i < maxPts; i++) {
    const p = ring[Math.floor(i * step)]
    out.push({ x: p.x, z: p.z })
  }
  return out
}

export interface EarthSiteSpec {
  id: WorldId
  name: string
  shortLabel: string
  countryFlag: string
  lat: number
  lon: number
  /** Real-world compass heading (degrees clockwise from North) corresponding to local +Z downhill flight corridor */
  headingDeg: number
  /** Real-world ground elevation (meters MSL) at launch coordinate */
  launchElevationM: number
  /** Extra altitude above ground at launch (e.g., launching from a skyscraper spire or cliff) */
  launchAglM?: number
  /** Real-world vertical drop (meters) over the 3km flight corridor */
  verticalDropM: number
  archetype: 'urban-canyon' | 'coastal-mountain' | 'alpine-horn' | 'granite-wall'
  description: string
}

export const GLOBAL_EARTH_SITES: Record<string, EarthSiteSpec> = {
  manhattan: {
    id: 'manhattan',
    name: 'Downtown New York — Financial District & 1WTC',
    shortLabel: '🇺🇸 Downtown NYC',
    countryFlag: '🇺🇸',
    lat: 40.7136,
    lon: -74.0148,
    headingDeg: 118, // Southeast right past One World Trade Center (541m) through the Wall Street skyscraper canyon!
    launchElevationM: 8,
    launchAglM: 340,
    verticalDropM: 8,
    archetype: 'urban-canyon',
    description:
      'Dive past One World Trade Center (541m) through the dense 3D skyscraper canyons of Downtown Manhattan & Wall Street!',
  },
  rio: {
    id: 'rio',
    name: 'Rio de Janeiro — Corcovado & Sugarloaf',
    shortLabel: '🇧🇷 Rio 3D',
    countryFlag: '🇧🇷',
    lat: -22.9519,
    lon: -43.2105,
    headingDeg: 112,
    launchElevationM: 704,
    launchAglM: 42,
    verticalDropM: 695,
    archetype: 'coastal-mountain',
    description:
      'Launch beside Christ the Redeemer (704m MSL) over Botafogo Bay, Sugarloaf Mountain, and 3D Rio skyscrapers!',
  },
  paris: {
    id: 'paris',
    name: 'Paris — Eiffel Tower & Champ de Mars',
    shortLabel: '🇫🇷 Paris 3D',
    countryFlag: '🇫🇷',
    lat: 48.8604,
    lon: 2.2912,
    headingDeg: 135, // Southeast from Trocadéro right past the 330m Eiffel Tower down the Champ de Mars!
    launchElevationM: 33,
    launchAglM: 285,
    verticalDropM: 28,
    archetype: 'urban-canyon',
    description:
      'Launch over the Seine at Trocadéro and carve right past the 330m Eiffel Tower across the Haussmannian rooftops of Paris!',
  },
  egypt: {
    id: 'egypt',
    name: 'Egypt — Great Pyramids of Giza & Sphinx',
    shortLabel: '🇪🇬 Egypt Giza',
    countryFlag: '🇪🇬',
    lat: 29.9825,
    lon: 31.1375,
    headingDeg: 218, // Southwest directly across Khufu (Great Pyramid), Khafre, and Menkaure!
    launchElevationM: 68,
    launchAglM: 195,
    verticalDropM: 55,
    archetype: 'granite-wall',
    description:
      'Soar in desert thermals over the 139m Great Pyramid of Khufu, Pyramid of Khafre, and the Great Sphinx of Giza!',
  },
  rome: {
    id: 'rome',
    name: 'Rome — Colosseum & Roman Forum',
    shortLabel: '🇮🇹 Rome 3D',
    countryFlag: '🇮🇹',
    lat: 41.8894,
    lon: 12.4962,
    headingDeg: 292, // West-Northwest directly over the Colosseum, Roman Forum, and Altare della Patria!
    launchElevationM: 22,
    launchAglM: 155,
    verticalDropM: 18,
    archetype: 'urban-canyon',
    description:
      'Swoop low over the ancient Roman Colosseum, Imperial Fora, Vittoriano, and terracotta domes of Rome!',
  },
  london: {
    id: 'london',
    name: 'London — The Shard, Tower Bridge & City',
    shortLabel: '🇬🇧 London 3D',
    countryFlag: '🇬🇧',
    lat: 51.5032,
    lon: -0.0725,
    headingDeg: 308, // Northwest past Tower Bridge & The Shard (310m) into the City of London financial towers!
    launchElevationM: 8,
    launchAglM: 255,
    verticalDropM: 8,
    archetype: 'urban-canyon',
    description:
      'Carve past Tower Bridge and the 310m Shard across the River Thames into the Gherkin and Walkie-Talkie skyscrapers!',
  },
  toronto: {
    id: 'toronto',
    name: 'Toronto — CN Tower & Financial District',
    shortLabel: '🇨🇦 Toronto 3D',
    countryFlag: '🇨🇦',
    lat: 43.6408,
    lon: -79.3905,
    headingDeg: 58, // East-northeast, the CN Tower standing ahead. Launch sits above the tip.
    launchElevationM: 82,
    launchAglM: 620,
    verticalDropM: 10,
    archetype: 'urban-canyon',
    description:
      'Circle the CN Tower, drop onto the Rogers Centre, then ride the elevator back up for another line through downtown.',
  },
  sf: {
    id: 'sf',
    name: 'San Francisco — Golden Gate Bridge',
    shortLabel: '🇺🇸 SF Bridge',
    countryFlag: '🇺🇸',
    lat: 37.8305,
    lon: -122.4808,
    headingDeg: 171,
    launchElevationM: 95,
    launchAglM: 185,
    verticalDropM: 90,
    archetype: 'coastal-mountain',
    description:
      'Launch from the Marin Headlands and swoop between the 227m International Orange towers of the Golden Gate Bridge!',
  },
  chamonix: {
    id: 'chamonix',
    name: 'Chamonix — Aiguille du Midi',
    shortLabel: '🇫🇷 Chamonix',
    countryFlag: '🇫🇷',
    lat: 45.8793,
    lon: 6.8874,
    headingDeg: 338,
    launchElevationM: 3790,
    launchAglM: 32,
    verticalDropM: 2150,
    archetype: 'alpine-horn',
    description:
      'Speed-fly from Aiguille du Midi (3,842m MSL) down real quantized-mesh Mont Blanc glaciers into Chamonix valley!',
  },
  matterhorn: {
    id: 'matterhorn',
    name: 'Zermatt — The Matterhorn East Face',
    shortLabel: '🇨🇭 Matterhorn',
    countryFlag: '🇨🇭',
    lat: 45.9766,
    lon: 7.6585,
    headingDeg: 52,
    launchElevationM: 3820,
    launchAglM: 35,
    verticalDropM: 1850,
    archetype: 'alpine-horn',
    description:
      'Drop down the real 3D East Face & Hörnli Ridge of the Matterhorn toward Zermatt village!',
  },
  yosemite: {
    id: 'yosemite',
    name: 'Yosemite — Half Dome Granite Dive',
    shortLabel: '🇺🇸 Yosemite',
    countryFlag: '🇺🇸',
    lat: 37.7459,
    lon: -119.5332,
    headingDeg: 248,
    launchElevationM: 2680,
    launchAglM: 28,
    verticalDropM: 1450,
    archetype: 'granite-wall',
    description:
      'Plunge off the sheer northwest granite face of Half Dome (2,694m MSL) into real 3D Yosemite Valley!',
  },
  dubai: {
    id: 'dubai',
    name: 'Dubai — Burj Khalifa & Sheikh Zayed',
    shortLabel: '🇦🇪 Dubai 3D',
    countryFlag: '🇦🇪',
    lat: 25.1972,
    lon: 55.2744,
    headingDeg: 215,
    launchElevationM: 10,
    launchAglM: 480,
    verticalDropM: 8,
    archetype: 'urban-canyon',
    description:
      'Launch off the Burj Khalifa spire and carve through real OpenFreeMap 3D Downtown Dubai towers!',
  },
}

const LOCAL_STORAGE_API_KEY = 'ptw_google_maps_api_key'

export function getConfiguredGoogleMapsApiKey(): string {
  try {
    const saved = localStorage.getItem(LOCAL_STORAGE_API_KEY)?.trim()
    if (saved) return saved
  } catch {
    // Ignore storage errors
  }
  const envKey = (import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY?.trim() || ''
  if (envKey && envKey !== 'your_google_maps_platform_key') {
    return envKey
  }
  return ''
}

export function setConfiguredGoogleMapsApiKey(key: string): void {
  try {
    const cleaned = key.trim()
    if (cleaned) {
      localStorage.setItem(LOCAL_STORAGE_API_KEY, cleaned)
    } else {
      localStorage.removeItem(LOCAL_STORAGE_API_KEY)
    }
  } catch {
    // Ignore storage errors
  }
}

/**
 * 2D Ear-Clipping Polygon Triangulator for arbitrary concave / L-shaped OpenFreeMap building roofs.
 * Assumes `pts` is ordered counter-clockwise in `(x, z)` (`signedArea2D > 0`).
 * Returns flat array of local vertex indices `[i0, i1, i2, ...]`.
 */
function triangulatePolygon2D(pts: Array<{ x: number; z: number }>): number[] {
  const n = pts.length
  if (n < 3) return []
  if (n === 3) return [0, 1, 2]

  const indices: number[] = []
  const avail: number[] = []
  for (let i = 0; i < n; i++) avail.push(i)

  const cross2D = (
    ax: number,
    az: number,
    bx: number,
    bz: number,
    cx: number,
    cz: number,
  ) => (bx - ax) * (cz - az) - (bz - az) * (cx - ax)

  const ptInTri = (
    px: number,
    pz: number,
    ax: number,
    az: number,
    bx: number,
    bz: number,
    cx: number,
    cz: number,
  ) => {
    const c1 = cross2D(ax, az, bx, bz, px, pz)
    const c2 = cross2D(bx, bz, cx, cz, px, pz)
    const c3 = cross2D(cx, cz, ax, az, px, pz)
    return c1 >= -1e-5 && c2 >= -1e-5 && c3 >= -1e-5
  }

  let guard = n * 3
  let curr = 0
  while (avail.length > 3 && guard-- > 0) {
    const m = avail.length
    const iPrev = avail[(curr + m - 1) % m]
    const iCurr = avail[curr % m]
    const iNext = avail[(curr + 1) % m]

    const a = pts[iPrev]
    const b = pts[iCurr]
    const c = pts[iNext]

    if (cross2D(a.x, a.z, b.x, b.z, c.x, c.z) > 1e-4) {
      let isEar = true
      for (let j = 0; j < m; j++) {
        const idx = avail[j]
        if (idx === iPrev || idx === iCurr || idx === iNext) continue
        const p = pts[idx]
        if (ptInTri(p.x, p.z, a.x, a.z, b.x, b.z, c.x, c.z)) {
          isEar = false
          break
        }
      }
      if (isEar) {
        // In Babylon left-handed coords with +Y up, (iPrev, iNext, iCurr) faces +Y upward
        indices.push(iPrev, iNext, iCurr)
        avail.splice(curr % m, 1)
        curr = 0
        continue
      }
    }
    curr++
  }

  if (avail.length === 3) {
    indices.push(avail[0], avail[2], avail[1])
  }
  return indices
}

export class GoogleEarthWorld implements FlightWorld {
  public readonly launchPosition: Vector3Like
  public readonly launchHeadingDeg: number = 0
  public readonly thermals: ThermalZone[] = []
  public readonly obstacles: WorldObstacle[] = []
  public terrainMesh!: Mesh
  public site: EarthSiteSpec

  private scene: Scene
  private spawnedNodes: (Mesh | TransformNode | any)[] = []
  private isDisposed = false
  private unsubscribeStyle: (() => void) | null = null

  // Fast O(1) 65x65 DEM height grid in meters MSL (zero per-frame Cesium raycast stalls!)
  private demGridMsl: Float32Array | null = null
  private readonly demCols = 65
  private readonly demRows = 65
  private readonly meshWidth = 3600
  private readonly meshDepth = 3600
  private readonly meshCenterZ = 1400

  private onTerrainUpdatedCallbacks: (() => void)[] = []
  public statusMessage = ''
  private streetNames: StreetNameLayer
  private streetFetchToken = 0
  private streetFetchBusy = false
  private lastStreetLat = Number.NaN
  private lastStreetLon = Number.NaN

  constructor(
    scene: Scene,
    siteOrId: WorldId | EarthSiteSpec = 'rio',
    onStatusChange?: (msg: string) => void,
  ) {
    this.scene = scene
    this.streetNames = new StreetNameLayer(scene)
    if (typeof siteOrId === 'string') {
      this.site = GLOBAL_EARTH_SITES[siteOrId] || GLOBAL_EARTH_SITES.rio
    } else {
      this.site = siteOrId
    }

    const globe = GodsEyeGlobeEngine.getInstance()
    globe.setSiteOrigin(this.site.lat, this.site.lon, this.site.headingDeg)
    globe.setActive(true)
    const optionalKey = getConfiguredGoogleMapsApiKey()
    void globe.setOptionalGoogleApiKey(optionalKey || null)

    const launchGroundY = this.sampleHeight(0, 20)
    const agl = this.site.launchAglM ?? 28
    this.launchPosition = {
      x: 0,
      y: launchGroundY + agl,
      z: 20,
    }

    this.initThermals()
    this.buildTerrainMesh()
    this.registerSignatureLandmarkObstacles()

    // Check if we are flying near the Golden Gate Bridge (San Francisco `37.82, -122.478`)
    if (
      Math.abs(this.site.lat - 37.82) < 0.04 &&
      Math.abs(this.site.lon - -122.478) < 0.04
    ) {
      this.buildGoldenGateBridge3D()
    }

    // Hide the local Babylon heightmap in Photoreal mode so the real Cesium 3D Globe shines through!
    const updateTerrainVisibility = () => {
      if (!this.terrainMesh || this.isDisposed) return
      const pal = LnStyleManager.getInstance().palette
      this.terrainMesh.visibility = pal.isLineMode || pal.isIrVision ? 1.0 : 0.0
    }
    updateTerrainVisibility()
    this.unsubscribeStyle = LnStyleManager.getInstance().subscribe(() => {
      updateTerrainVisibility()
    })

    void this.streamKeylessGodsEyeWorldData(onStatusChange)
  }

  public onTerrainUpdated(cb: () => void): void {
    this.onTerrainUpdatedCallbacks.push(cb)
  }

  public localXZToLatLon(x: number, z: number): { lat: number; lon: number } {
    const { lat, lon } = GodsEyeGlobeEngine.getInstance().localToLatLonAlt(
      x,
      0,
      z,
    )
    return { lat, lon }
  }

  public latLonToLocalXZ(lat: number, lon: number): { x: number; z: number } {
    return GodsEyeGlobeEngine.getInstance().latLonToLocalXZ(lat, lon)
  }

  /**
   * Pure O(1) bilinear lookup in `demGridMsl` (<0.0002ms per call).
   * Eliminates per-frame `Cesium.Globe.getHeight()` quadtree stalls for 60fps smoothness!
   */
  public sampleHeight(x: number, z: number): number {
    if (this.demGridMsl) {
      const minX = -this.meshWidth * 0.5
      const minZ = this.meshCenterZ - this.meshDepth * 0.5
      const u = Math.max(0, Math.min(1, (x - minX) / this.meshWidth))
      const v = Math.max(0, Math.min(1, (z - minZ) / this.meshDepth))
      const gx = u * (this.demCols - 1)
      const gz = v * (this.demRows - 1)
      const ix = Math.min(this.demCols - 2, Math.floor(gx))
      const iz = Math.min(this.demRows - 2, Math.floor(gz))
      const fx = gx - ix
      const fz = gz - iz

      const h00 = this.demGridMsl[iz * this.demCols + ix]
      const h10 = this.demGridMsl[iz * this.demCols + ix + 1]
      const h01 = this.demGridMsl[(iz + 1) * this.demCols + ix]
      const h11 = this.demGridMsl[(iz + 1) * this.demCols + ix + 1]
      const h0 = h00 * (1 - fx) + h10 * fx
      const h1 = h01 * (1 - fx) + h11 * fx
      return h0 * (1 - fz) + h1 * fz
    }

    const t = Math.max(0, Math.min(1, z / 3000))
    return Math.max(0, this.site.launchElevationM - t * this.site.verticalDropM)
  }

  /**
   * Checks live collision against the loaded Google Photorealistic 3D Tileset surface
   * (buildings, skyscrapers, pyramids, Eiffel Tower, Colosseum, bridges, etc.).
   */
  public checkPhotorealCollision(_x: number, _y: number, _z: number): string | null {
    // A height sample of the photo mesh hits coarse tiles in open streets and
    // detonates the wing in mid-air. City solidity has to be authored per course.
    return null
  }

  /**
   * Registers immediate solid collision volumes for the world's iconic monuments
   * at their exact WGS84 coordinates so they are 100% solid from frame 0.
   */
  private registerSignatureLandmarkObstacles(): void {
    const landmarks: Array<{
      id: string
      name: string
      lat: number
      lon: number
      baseMsl: number
      heightM: number
      halfW: number
      halfD: number
    }> = [
      // Downtown NYC
      { id: 'manhattan', name: 'One World Trade Center (541m)', lat: 40.7127, lon: -74.0134, baseMsl: 6, heightM: 541, halfW: 32, halfD: 32 },
      { id: 'manhattan', name: '3 World Trade Center (329m)', lat: 40.7116, lon: -74.0117, baseMsl: 6, heightM: 329, halfW: 26, halfD: 26 },
      { id: 'manhattan', name: '4 World Trade Center (298m)', lat: 40.7108, lon: -74.0119, baseMsl: 6, heightM: 298, halfW: 25, halfD: 25 },
      { id: 'manhattan', name: 'Woolworth Building (241m)', lat: 40.7124, lon: -74.0083, baseMsl: 8, heightM: 241, halfW: 26, halfD: 26 },
      { id: 'manhattan', name: '70 Pine Street Tower (290m)', lat: 40.7065, lon: -74.0076, baseMsl: 6, heightM: 290, halfW: 24, halfD: 24 },
      // Paris
      { id: 'paris', name: 'Eiffel Tower (330m)', lat: 48.8584, lon: 2.2945, baseMsl: 33, heightM: 330, halfW: 48, halfD: 48 },
      // Egypt (Giza Pyramids & Sphinx)
      { id: 'egypt', name: 'Great Pyramid of Khufu (139m)', lat: 29.9792, lon: 31.1342, baseMsl: 65, heightM: 139, halfW: 112, halfD: 112 },
      { id: 'egypt', name: 'Pyramid of Khafre (136m)', lat: 29.9759, lon: 31.1308, baseMsl: 68, heightM: 136, halfW: 105, halfD: 105 },
      { id: 'egypt', name: 'Pyramid of Menkaure (65m)', lat: 29.9725, lon: 31.1283, baseMsl: 70, heightM: 65, halfW: 54, halfD: 54 },
      { id: 'egypt', name: 'Great Sphinx of Giza', lat: 29.9753, lon: 31.1376, baseMsl: 60, heightM: 22, halfW: 36, halfD: 18 },
      // Rome
      { id: 'rome', name: 'Roman Colosseum (48m)', lat: 41.8902, lon: 12.4922, baseMsl: 22, heightM: 48, halfW: 88, halfD: 76 },
      { id: 'rome', name: 'Altare della Patria (Vittoriano)', lat: 41.8946, lon: 12.4832, baseMsl: 28, heightM: 70, halfW: 65, halfD: 55 },
      // London
      { id: 'london', name: 'The Shard (310m)', lat: 51.5045, lon: -0.0865, baseMsl: 6, heightM: 310, halfW: 34, halfD: 34 },
      { id: 'london', name: 'Tower Bridge Towers (65m)', lat: 51.5055, lon: -0.0754, baseMsl: 2, heightM: 65, halfW: 32, halfD: 120 },
      { id: 'london', name: '20 Fenchurch Walkie-Talkie (160m)', lat: 51.5114, lon: -0.0836, baseMsl: 14, heightM: 160, halfW: 32, halfD: 32 },
      { id: 'london', name: '30 St Mary Axe Gherkin (180m)', lat: 51.5145, lon: -0.0803, baseMsl: 15, heightM: 180, halfW: 28, halfD: 28 },
      // Toronto
      { id: 'toronto', name: 'CN Tower (553m)', lat: 43.6426, lon: -79.3871, baseMsl: 80, heightM: 553, halfW: 12, halfD: 12 },
      { id: 'toronto', name: 'Rogers Centre SkyDome (86m)', lat: 43.6414, lon: -79.3894, baseMsl: 80, heightM: 86, halfW: 62, halfD: 55 },
      { id: 'toronto', name: 'First Canadian Place (298m)', lat: 43.6487, lon: -79.3817, baseMsl: 84, heightM: 298, halfW: 34, halfD: 34 },
      // Rio
      { id: 'rio', name: 'Christ the Redeemer Statue (38m)', lat: -22.9519, lon: -43.2105, baseMsl: 700, heightM: 38, halfW: 14, halfD: 14 },
    ]

    for (const lm of landmarks) {
      if (this.site.id !== lm.id) continue
      const xz = this.latLonToLocalXZ(lm.lat, lm.lon)
      // Don't block the exact launch point at (0, 20)
      if (Math.hypot(xz.x, xz.z - 20) < 26) continue
      this.obstacles.push({
        type: 'tower',
        name: lm.name,
        x: xz.x,
        yMin: lm.baseMsl,
        yMax: lm.baseMsl + lm.heightM,
        z: xz.z,
        radius: Math.max(lm.halfW, lm.halfD),
        halfWidth: lm.halfW,
        halfDepth: lm.halfD,
      })
    }
  }

  private initThermals(): void {
    if (this.site.id === 'toronto') {
      for (const col of TORONTO_ELEVATORS) {
        const gy = this.sampleHeight(col.x, col.z)
        this.thermals.push({
          name: col.name,
          center: { x: col.x, y: gy, z: col.z },
          radius: col.radius,
          strengthMps: col.strengthMps,
          surfaceType: 'dark-asphalt',
          topAltitude: gy + col.riseM,
          expansionRatio: 1.04,
          columnLift: true,
        })
      }
      return
    }
    const spots = [
      {
        name: `${this.site.shortLabel} Updraft Core`,
        x: 25,
        z: 580,
        radius: 145,
        strength: 6.4,
      },
      {
        name: `${this.site.shortLabel} Mid-Run Thermal`,
        x: -30,
        z: 1380,
        radius: 155,
        strength: 6.8,
      },
      {
        name: `${this.site.shortLabel} Valley Lift`,
        x: 18,
        z: 2150,
        radius: 150,
        strength: 6.0,
      },
    ]
    for (let i = 0; i < spots.length; i++) {
      const s = spots[i]
      const gy = this.sampleHeight(s.x, s.z)
      this.thermals.push({
        name: s.name,
        center: { x: s.x, y: gy, z: s.z },
        radius: s.radius,
        strengthMps: s.strength,
        cyclePeriodSeconds: 180,
        cyclePhaseOffset: i * 1.7,
        surfaceType:
          this.site.archetype === 'urban-canyon' ? 'dark-asphalt' : 'dry-rock',
        topAltitude: gy + 1200,
        expansionRatio: 0.25,
      })
    }
  }

  private refreshThermalsHeight(): void {
    for (const t of this.thermals) {
      const gy = this.sampleHeight(t.center.x, t.center.z)
      const rise = t.columnLift ? (t.topAltitude ?? t.center.y + 900) - t.center.y : 1200
      t.center.y = gy
      t.topAltitude = gy + rise
    }
  }

  public sampleUpdraft(
    x: number,
    y: number,
    z: number,
    timeSeconds: number = 0,
    windVector: Vector3Like = { x: 0, y: 0, z: 0 },
  ): number {
    return this.sampleThermalFluidVelocity(x, y, z, timeSeconds, windVector)
      .velocity.y
  }

  public sampleThermalFluidVelocity(
    x: number,
    y: number,
    z: number,
    timeSeconds: number = 0,
    windVector: Vector3Like = { x: 0, y: 0, z: 0 },
  ): ThermalFluidSample {
    return calculateToroidalThermalFluid(
      this.thermals,
      (gx, gz) => this.sampleHeight(gx, gz),
      x,
      y,
      z,
      timeSeconds,
      windVector,
    )
  }

  public sampleRidgeLift(
    x: number,
    y: number,
    z: number,
    windDir: Vector3Like,
    windSpeedMps: number,
  ): number {
    const groundY = this.sampleHeight(x, z)
    const agl = y - groundY
    if (agl < 0 || agl > 280) return 0
    const eps = 8.0
    const dhdx =
      (this.sampleHeight(x + eps, z) - this.sampleHeight(x - eps, z)) /
      (2 * eps)
    const dhdz =
      (this.sampleHeight(x, z + eps) - this.sampleHeight(x, z - eps)) /
      (2 * eps)
    const windwardDot = -(windDir.x * dhdx + windDir.z * dhdz)
    if (windwardDot <= 0) return 0
    const decay = Math.exp(-agl / 110.0)
    return Math.min(8.0, windwardDot * windSpeedMps * 0.65 * decay)
  }

  public sampleVenturi(
    x: number,
    y: number,
    z: number,
    baseWind: Vector3Like,
  ): Vector3Like {
    const groundY = this.sampleHeight(x, z)
    const agl = Math.max(0, y - groundY)
    const factor = 1 + 0.25 * Math.exp(-agl / 70)
    return {
      x: baseWind.x * factor,
      y: baseWind.y,
      z: baseWind.z * factor,
    }
  }

  private buildTerrainMesh(): void {
    this.terrainMesh = MeshBuilder.CreateGround(
      `earth-terrain-${this.site.id}`,
      {
        width: this.meshWidth,
        height: this.meshDepth,
        subdivisions: 64,
        updatable: true,
      },
      this.scene,
    )
    this.terrainMesh.position.z = this.meshCenterZ
    this.spawnedNodes.push(this.terrainMesh)

    this.refreshTerrainVertices()

    const mat = new StandardMaterial(
      `earth-terrain-mat-${this.site.id}`,
      this.scene,
    )
    mat.diffuseColor = new Color3(0.2, 0.25, 0.3)
    mat.specularColor = new Color3(0.02, 0.02, 0.02)
    this.terrainMesh.material = mat
    this.spawnedNodes.push(mat)
  }

  private refreshTerrainVertices(): void {
    const positions = this.terrainMesh.getVerticesData(
      VertexBuffer.PositionKind,
    )
    if (!positions) return
    const indices = this.terrainMesh.getIndices()
    const normals = new Float32Array(positions.length)

    for (let i = 0; i < positions.length; i += 3) {
      const vx = positions[i]
      const vz = positions[i + 2] + this.meshCenterZ
      positions[i + 1] = this.sampleHeight(vx, vz)
    }

    if (indices) {
      VertexData.ComputeNormals(positions, indices, normals)
      this.terrainMesh.updateVerticesData(VertexBuffer.PositionKind, positions)
      this.terrainMesh.updateVerticesData(VertexBuffer.NormalKind, normals)
    }
    this.terrainMesh.refreshBoundingInfo()
  }

  /**
   * 🌉 3D GOLDEN GATE BRIDGE (San Francisco):
   * Constructs the iconic 227m International Orange Art Deco North & South Suspension Towers,
   * 67m-high Highway Deck, Sweeping Parabolic Main Suspension Cables, and Vertical Suspender Ropes
   * at their exact real-world GPS coordinates across the Golden Gate Strait!
   */
  private buildGoldenGateBridge3D(): void {
    // Exact WGS84 coordinates of the Golden Gate Bridge towers & anchorages
    const northAnchorage = this.latLonToLocalXZ(37.8324, -122.4806)
    const northTower = this.latLonToLocalXZ(37.8256, -122.4792)
    const southTower = this.latLonToLocalXZ(37.8142, -122.4776)
    const southAnchorage = this.latLonToLocalXZ(37.8078, -122.4763)

    const intlOrangeMat = new StandardMaterial('ggb-intl-orange', this.scene)
    // Calibrated for 2.6x sun + 1.35x ambient so it renders as rich International Orange (#C0362C) without blowing out
    intlOrangeMat.diffuseColor = new Color3(0.42, 0.11, 0.09)
    intlOrangeMat.emissiveColor = new Color3(0.04, 0.01, 0.008)
    intlOrangeMat.specularColor = new Color3(0.08, 0.04, 0.03)
    this.spawnedNodes.push(intlOrangeMat)

    const deckMat = new StandardMaterial('ggb-deck-mat', this.scene)
    deckMat.diffuseColor = new Color3(0.14, 0.16, 0.19)
    deckMat.specularColor = new Color3(0.05, 0.05, 0.06)
    this.spawnedNodes.push(deckMat)

    const pierMat = new StandardMaterial('ggb-pier-mat', this.scene)
    pierMat.diffuseColor = new Color3(0.32, 0.31, 0.29)
    pierMat.specularColor = new Color3(0.05, 0.05, 0.05)
    this.spawnedNodes.push(pierMat)

    const dx = southTower.x - northTower.x
    const dz = southTower.z - northTower.z
    const bridgeYaw = Math.atan2(dx, dz)

    const deckY = 67 // 67m above mean high water
    const towerTopY = 227 // 227m above water
    const halfSpanWidth = 13.7 // 27.4m total bridge width

    const perpX = Math.cos(bridgeYaw)
    const perpZ = -Math.sin(bridgeYaw)

    const ggbNodes: Array<Mesh | TransformNode> = []

    // Build North & South 227m Art Deco Twin-Leg Towers with horizontal cross-bracing struts
    for (const [idx, tPos] of [northTower, southTower].entries()) {
      const root = new TransformNode(`ggb-tower-${idx}`, this.scene)
      root.position.set(tPos.x, 0, tPos.z)
      root.rotation.y = bridgeYaw
      this.spawnedNodes.push(root)
      ggbNodes.push(root)

      // Concrete fender pier at water level
      const pier = MeshBuilder.CreateBox(
        `ggb-pier-${idx}`,
        { width: 42, height: 16, depth: 20 },
        this.scene,
      )
      pier.position.y = 6
      pier.material = pierMat
      pier.parent = root
      this.spawnedNodes.push(pier)

      // East & West Art Deco stepped steel shafts
      for (const side of [-1, 1]) {
        const leg = MeshBuilder.CreateBox(
          `ggb-leg-${idx}-${side}`,
          { width: 5.5, height: towerTopY, depth: 8.5 },
          this.scene,
        )
        leg.position.set(side * halfSpanWidth, towerTopY * 0.5, 0)
        leg.material = intlOrangeMat
        leg.parent = root
        this.spawnedNodes.push(leg)
      }

      // 4 Art Deco horizontal portal cross-struts above the roadway + 2 below
      for (const strutY of [28, 52, 98, 138, 178, 216]) {
        const strut = MeshBuilder.CreateBox(
          `ggb-strut-${idx}-${strutY}`,
          { width: halfSpanWidth * 2 + 5, height: 6.5, depth: 6.0 },
          this.scene,
        )
        strut.position.set(0, strutY, 0)
        strut.material = intlOrangeMat
        strut.parent = root
        this.spawnedNodes.push(strut)
      }

      // Register tower obstacle so hitting a tower triggers the GTA ragdoll crash!
      this.obstacles.push({
        type: 'tower',
        name:
          idx === 0
            ? 'Golden Gate Bridge North Tower (227m)'
            : 'Golden Gate Bridge South Tower (227m)',
        x: tPos.x,
        yMin: 0,
        yMax: towerTopY + 4,
        z: tPos.z,
        radius: 18,
        halfWidth: 18,
        halfDepth: 9,
      })
    }

    // Build 2,737m Roadway Deck & Red Side Trusses from North Anchorage to South Anchorage
    const fullDx = southAnchorage.x - northAnchorage.x
    const fullDz = southAnchorage.z - northAnchorage.z
    const fullLen = Math.hypot(fullDx, fullDz)
    const midX = (northAnchorage.x + southAnchorage.x) * 0.5
    const midZ = (northAnchorage.z + southAnchorage.z) * 0.5

    const deck = MeshBuilder.CreateBox(
      'ggb-road-deck',
      { width: halfSpanWidth * 2, height: 5.5, depth: fullLen },
      this.scene,
    )
    deck.position.set(midX, deckY, midZ)
    deck.rotation.y = bridgeYaw
    deck.material = deckMat
    this.spawnedNodes.push(deck)
    ggbNodes.push(deck)

    for (const side of [-1, 1]) {
      const truss = MeshBuilder.CreateBox(
        `ggb-side-truss-${side}`,
        { width: 1.8, height: 7.5, depth: fullLen },
        this.scene,
      )
      truss.position.set(
        midX + perpX * side * halfSpanWidth,
        deckY + 1.2,
        midZ + perpZ * side * halfSpanWidth,
      )
      truss.rotation.y = bridgeYaw
      truss.material = intlOrangeMat
      this.spawnedNodes.push(truss)
      ggbNodes.push(truss)
    }

    // Build Sweeping Parabolic Main Suspension Cables & Vertical Suspender Ropes
    const cableLines: Vector3[][] = []
    const steps = 44
    for (const side of [-1, 1]) {
      const offsetX = perpX * side * halfSpanWidth
      const offsetZ = perpZ * side * halfSpanWidth
      const mainCablePts: Vector3[] = []

      for (let s = 0; s <= steps; s++) {
        const u = s / steps
        const px =
          northAnchorage.x + (southAnchorage.x - northAnchorage.x) * u + offsetX
        const pz =
          northAnchorage.z + (southAnchorage.z - northAnchorage.z) * u + offsetZ

        // Catenary curve profile across North Side Span (0..0.24), Main Span (0.24..0.76), South Side Span (0.76..1.0)
        let cableY = deckY + 8
        if (u < 0.24) {
          const t = u / 0.24
          cableY = deckY + 6 + (towerTopY - (deckY + 6)) * (t * t)
        } else if (u <= 0.76) {
          const t = (u - 0.5) / 0.26 // -1 at North Tower, 0 at center, +1 at South Tower
          cableY = deckY + 9 + (towerTopY - (deckY + 9)) * (t * t)
        } else {
          const t = (1.0 - u) / 0.24
          cableY = deckY + 6 + (towerTopY - (deckY + 6)) * (t * t)
        }

        const topPt = new Vector3(px, cableY, pz)
        mainCablePts.push(topPt)

        // Vertical suspender rope down to deck
        if (s > 0 && s < steps) {
          cableLines.push([topPt, new Vector3(px, deckY + 2, pz)])
        }
      }

      // Thicker-looking twin main cable bundle
      cableLines.push(mainCablePts)
      cableLines.push(
        mainCablePts.map((p) => new Vector3(p.x, p.y + 0.9, p.z)),
      )
    }

    const cablesMesh = MeshBuilder.CreateLineSystem(
      'ggb-suspension-cables',
      { lines: cableLines },
      this.scene,
    )
    cablesMesh.color = new Color3(0.82, 0.25, 0.2)
    this.spawnedNodes.push(cablesMesh)
    ggbNodes.push(cablesMesh)

    const syncBridgeVisibility = () => {
      if (this.isDisposed) return
      const pal = LnStyleManager.getInstance().palette
      const hasPhotoreal = GodsEyeGlobeEngine.getInstance().hasPhotoreal3DTiles()
      const showSyntheticBridge = pal.isLineMode || pal.isIrVision || !hasPhotoreal
      for (const n of ggbNodes) {
        n.setEnabled(showSyntheticBridge)
      }
    }
    syncBridgeVisibility()
    GodsEyeGlobeEngine.getInstance().onTilesetReady(syncBridgeVisibility)
    const unsubGgb = LnStyleManager.getInstance().subscribe(syncBridgeVisibility)
    const prevUnsub = this.unsubscribeStyle
    this.unsubscribeStyle = () => {
      prevUnsub?.()
      unsubGgb()
    }
  }

  private async streamKeylessGodsEyeWorldData(
    onStatusChange?: (msg: string) => void,
  ): Promise<void> {
    onStatusChange?.(
      `🌍 God's Eye View 3D Globe: Streaming ${this.site.shortLabel}...`,
    )

    await this.streamGlobalDemElevation()
    if (this.isDisposed) return

    const updatedLaunchGroundY = this.sampleHeight(0, 20)
    const agl = this.site.launchAglM ?? 28
    this.launchPosition.y = updatedLaunchGroundY + agl
    this.refreshThermalsHeight()

    const ofmData =
      await GodsEyeGlobeEngine.getInstance().fetchOpenFreeMapFeatures(
        this.site.lat,
        this.site.lon,
      )
    if (this.isDisposed) return

    if (ofmData.buildings.length > 0) {
      this.buildRealOpenFreeMapPolygons(ofmData.buildings)
      this.statusMessage = `🛰️ God's Eye 3D Globe • ${ofmData.buildings.length} Real 3D Buildings (${this.site.shortLabel})`
    } else {
      this.statusMessage = `🛰️ God's Eye 3D Globe • Keyless 3D Terrain & Satellite (${this.site.shortLabel})`
    }
    this.refreshStreetNames(this.site.lat, this.site.lon, true)
    onStatusChange?.(this.statusMessage)

    for (const cb of this.onTerrainUpdatedCallbacks) {
      cb()
    }
  }

  /**
   * Extrudes real OpenStreetMap building polygons in the exact same clean, untextured
   * stylized-realism 3D aesthetic as the rest of the sim (`WhistlerMountain`, `ParagliderRig`):
   * 1. Calibrated daylight albedo (`0.22–0.42` range) for the sim's `2.6x` sun + `1.35x` hemisphere lighting
   *    (eliminates blown-out neon window checkerboards and plastic glare).
   * 2. Per-building architectural vertex colors (`VertexBuffer.ColorKind`) with baked street-to-roof
   *    vertical Ambient Occlusion (`0.62x` foundation shadow -> `1.0x` sunlit upper stories) so buildings
   *    sit naturally into the satellite terrain below.
   * 3. 3D Pitched Hip Roofs (terracotta, cedar shingle, or alpine slate) on low-rise houses/chalets,
   *    plus recessed 3D roof parapets on mid/high-rise towers.
   * 4. Automatic `LnStyleManager` synchronization so buildings match Photoreal, Line-Art (`LN`), and Thermal (`IR`) modes.
   */
  private buildRealOpenFreeMapPolygons(
    buildings: DecodedOpenFreeMapBuilding[],
  ): void {
    const wallMat = new StandardMaterial(
      `ofm-clean-walls-${this.site.id}`,
      this.scene,
    )
    // Vertex colors carry the calibrated albedo; white diffuseColor multiplies 1:1 with vertex colors
    wallMat.diffuseColor = new Color3(1, 1, 1)
    wallMat.specularColor = new Color3(0.06, 0.06, 0.07)
    wallMat.specularPower = 48
    wallMat.backFaceCulling = false
    wallMat.twoSidedLighting = true
    this.spawnedNodes.push(wallMat)

    const roofMat = new StandardMaterial(
      `ofm-clean-roofs-${this.site.id}`,
      this.scene,
    )
    roofMat.diffuseColor = new Color3(1, 1, 1)
    roofMat.specularColor = new Color3(0.04, 0.04, 0.05)
    roofMat.specularPower = 32
    roofMat.backFaceCulling = false
    roofMat.twoSidedLighting = true
    this.spawnedNodes.push(roofMat)

    const wallPositions: number[] = []
    const wallNormals: number[] = []
    const wallColors: number[] = []
    const wallIndices: number[] = []

    const roofPositions: number[] = []
    const roofNormals: number[] = []
    const roofColors: number[] = []
    const roofIndices: number[] = []

    // Regional architectural palettes calibrated for `sunLight (2.6) + ambientLight (1.35)`
    // (Albedo values around 0.22–0.38 render as natural 0.65–0.96 daylight tones under the scene lights)
    const isAlpine =
      this.site.archetype === 'alpine-horn' ||
      this.site.id === 'matterhorn' ||
      this.site.id === 'chamonix'

    const lowRiseWallPalette: Array<[number, number, number]> = isAlpine
      ? [
          [0.34, 0.25, 0.18], // Rich alpine cedar timber (matches WhistlerMountain chalet wood!)
          [0.38, 0.36, 0.33], // Warm mountain river stone & plaster
          [0.31, 0.23, 0.16], // Aged larch wood cabin
          [0.4, 0.38, 0.34], // Sunlit alpine chalet stucco
        ]
      : [
          [0.39, 0.37, 0.33], // Warm sunlit cream stucco (SF Marina / Rio / Mediterranean)
          [0.36, 0.33, 0.29], // Sandstone & travertine masonry
          [0.34, 0.36, 0.37], // Crisp coastal white-slate
          [0.35, 0.26, 0.22], // Warm terracotta brick facade
          [0.33, 0.35, 0.33], // Soft sage-stone residential
        ]

    const midRiseWallPalette: Array<[number, number, number]> = [
      [0.35, 0.34, 0.31], // Warm limestone & architectural concrete
      [0.31, 0.33, 0.36], // Cool granite & daylight steel
      [0.34, 0.27, 0.23], // Classic urban brick & brownstone
      [0.37, 0.35, 0.32], // Sunlit travertine stone
    ]

    const highRiseWallPalette: Array<[number, number, number]> = [
      [0.22, 0.28, 0.34], // Sleek daylight sky-reflective curtain wall glass
      [0.27, 0.3, 0.33], // Anodized champagne-silver steel tower
      [0.2, 0.25, 0.31], // Deep architectural slate-blue glass
      [0.3, 0.31, 0.32], // Modernist limestone & glass monolith
    ]

    const pitchedRoofPalette: Array<[number, number, number]> = isAlpine
      ? [
          [0.42, 0.44, 0.46], // Alpine snow-dusted slate roof
          [0.24, 0.23, 0.22], // Dark mountain charcoal shingle
          [0.3, 0.23, 0.18], // Weathered cedar shake roof
        ]
      : [
          [0.34, 0.19, 0.14], // Classic terracotta clay tile roof (SF / Rio)
          [0.23, 0.25, 0.27], // Architectural weathered slate roof
          [0.28, 0.22, 0.18], // Warm mission shingle roof
          [0.29, 0.3, 0.31], // Light gravel / concrete deck
        ]

    // Register solid collision obstacles for up to 1,800 buildings across the flight zone,
    // and generate fallback visual mesh geometry for the 320 most prominent buildings
    const maxObstacleBuildings = Math.min(buildings.length, 1800)
    const maxMeshBuildings = 320

    for (let bIdx = 0; bIdx < maxObstacleBuildings; bIdx++) {
      const b = buildings[bIdx]
      const centerXZ = this.latLonToLocalXZ(b.centerLat, b.centerLon)

      const launchAgl = this.site.launchAglM ?? 28
      if (launchAgl < 80 && Math.hypot(centerXZ.x, centerXZ.z - 20) < 18) {
        continue
      }

      // Cesium globe height is WGS84 ellipsoid. Flight altitude is mean sea level,
      // so subtract geoid undulation or the collision box sits tens of meters off the mesh.
      const globeEllip = GodsEyeGlobeEngine.getInstance().sampleGlobeTerrainHeight(
        b.centerLat,
        b.centerLon,
      )
      let groundY = this.sampleHeight(centerXZ.x, centerXZ.z)
      if (globeEllip !== null && globeEllip > -500 && globeEllip < 9000) {
        const msl =
          globeEllip -
          GodsEyeGlobeEngine.getInstance().getGeoidUndulationMeters(b.centerLat, b.centerLon)
        if (msl > -120 && msl < 8850) groundY = msl
      }

      const baseH = groundY + b.minHeightM - 4.0 // sink 4m into terrain so foundations never float
      const topH = groundY + b.heightM
      if (topH <= baseH + 2) continue

      // Convert ring to local (x, z) and simplify tiny segments < 1.5m
      const rawRing: Array<{ x: number; z: number }> = []
      let minX = Infinity
      let maxX = -Infinity
      let minZ = Infinity
      let maxZ = -Infinity

      for (const pt of b.footprintLatLon) {
        const xz = this.latLonToLocalXZ(pt.lat, pt.lon)
        if (rawRing.length > 0) {
          const prev = rawRing[rawRing.length - 1]
          if (Math.hypot(xz.x - prev.x, xz.z - prev.z) < 1.5) continue
        }
        rawRing.push(xz)
        if (xz.x < minX) minX = xz.x
        if (xz.x > maxX) maxX = xz.x
        if (xz.z < minZ) minZ = xz.z
        if (xz.z > maxZ) maxZ = xz.z
      }
      if (rawRing.length < 3) continue

      const spanW = maxX - minX
      const spanD = maxZ - minZ

      // The box is only a broad search. The ring is the solid shape.
      const boxX = (minX + maxX) * 0.5
      const boxZ = (minZ + maxZ) * 0.5
      const halfW = Math.max(1.2, spanW * 0.5)
      const halfD = Math.max(1.2, spanD * 0.5)
      if (
        Math.abs(boxX) < 1700 &&
        boxZ > -500 &&
        boxZ < 3500 &&
        this.obstacles.length < 2000
      ) {
        this.obstacles.push({
          type: b.heightM >= 25 ? 'tower' : 'chalet',
          name:
            b.heightM >= 80
              ? `${this.site.shortLabel} Skyscraper (${Math.round(b.heightM)}m)`
              : `${this.site.shortLabel} Building (${Math.round(b.heightM)}m)`,
          x: boxX,
          yMin: groundY - 2,
          yMax: topH + 0.4,
          z: boxZ,
          radius: Math.max(halfW, halfD),
          halfWidth: halfW,
          halfDepth: halfD,
          ring: decimateRing(rawRing, 24),
        })
      }

      if (bIdx >= maxMeshBuildings) continue

      // Enforce consistent counter-clockwise winding in (x, z) via signed shoelace area
      let signedArea2 = 0
      for (let i = 0; i < rawRing.length; i++) {
        const p0 = rawRing[i]
        const p1 = rawRing[(i + 1) % rawRing.length]
        signedArea2 += p0.x * p1.z - p1.x * p0.z
      }
      if (Math.abs(signedArea2) < 8.0) continue
      if (signedArea2 < 0) {
        rawRing.reverse()
      }

      // Deterministic per-building hash for natural neighborhood variety
      const hash = Math.abs(
        Math.floor(b.centerLat * 12582917 + b.centerLon * 7340033 + bIdx * 31),
      )

      const wallRgb =
        b.heightM >= 42
          ? highRiseWallPalette[hash % highRiseWallPalette.length]
          : b.heightM >= 15
            ? midRiseWallPalette[hash % midRiseWallPalette.length]
            : lowRiseWallPalette[hash % lowRiseWallPalette.length]

      // Ground-contact Ambient Occlusion (0.62x at street level -> 1.0x at roof level)
      const baseAo = 0.62
      const topAo = 1.0

      // 1. Extrude clean flat-shaded perimeter walls with baked vertical AO vertex colors
      for (let i = 0; i < rawRing.length; i++) {
        const p0 = rawRing[i]
        const p1 = rawRing[(i + 1) % rawRing.length]
        const dx = p1.x - p0.x
        const dz = p1.z - p0.z
        const segLen = Math.hypot(dx, dz)
        if (segLen < 1.0) continue

        const nx = dz / segLen
        const nz = -dx / segLen

        // Subtle directional warm/cool tint per wall orientation for crisp 3D form definition
        const faceShade = 0.94 + 0.06 * (nx * -0.45 + nz * 0.28)
        const rBase = wallRgb[0] * baseAo * faceShade
        const gBase = wallRgb[1] * baseAo * faceShade
        const bBase = wallRgb[2] * baseAo * faceShade

        const rTop = wallRgb[0] * topAo * faceShade
        const gTop = wallRgb[1] * topAo * faceShade
        const bTop = wallRgb[2] * topAo * faceShade

        const baseVertIdx = wallPositions.length / 3
        wallPositions.push(
          p0.x,
          baseH,
          p0.z,
          p1.x,
          baseH,
          p1.z,
          p1.x,
          topH,
          p1.z,
          p0.x,
          topH,
          p0.z,
        )
        wallNormals.push(nx, 0, nz, nx, 0, nz, nx, 0, nz, nx, 0, nz)
        wallColors.push(
          rBase,
          gBase,
          bBase,
          1,
          rBase,
          gBase,
          bBase,
          1,
          rTop,
          gTop,
          bTop,
          1,
          rTop,
          gTop,
          bTop,
          1,
        )
        wallIndices.push(
          baseVertIdx,
          baseVertIdx + 1,
          baseVertIdx + 2,
          baseVertIdx,
          baseVertIdx + 2,
          baseVertIdx + 3,
        )
      }

      // 2. Build 3D Roof:
      const isCompactLowRise =
        b.heightM < 15 &&
        rawRing.length <= 8 &&
        Math.max(spanW, spanD) < 34 &&
        Math.min(spanW, spanD) > 4

      const roofRgb =
        b.heightM < 18
          ? pitchedRoofPalette[hash % pitchedRoofPalette.length]
          : [0.22, 0.24, 0.26] // Clean dark architectural roof deck for mid/high-rises

      if (isCompactLowRise) {
        let cx = 0
        let cz = 0
        for (const p of rawRing) {
          cx += p.x
          cz += p.z
        }
        cx /= rawRing.length
        cz /= rawRing.length
        const pitchPeakH =
          topH + Math.min(4.2, Math.max(2.0, Math.min(spanW, spanD) * 0.22))

        for (let i = 0; i < rawRing.length; i++) {
          const p0 = rawRing[i]
          const p1 = rawRing[(i + 1) % rawRing.length]

          // Compute sloped roof triangle normal
          const ux = p1.x - p0.x
          const uy = 0
          const uz = p1.z - p0.z
          const vx = cx - p0.x
          const vy = pitchPeakH - topH
          const vz = cz - p0.z
          let rnx = uy * vz - uz * vy
          let rny = uz * vx - ux * vz
          let rnz = ux * vy - uy * vx
          if (rny < 0) {
            rnx = -rnx
            rny = -rny
            rnz = -rnz
          }
          const nLen = Math.hypot(rnx, rny, rnz) || 1
          rnx /= nLen
          rny /= nLen
          rnz /= nLen

          const baseIdx = roofPositions.length / 3
          roofPositions.push(
            p0.x,
            topH,
            p0.z,
            p1.x,
            topH,
            p1.z,
            cx,
            pitchPeakH,
            cz,
          )
          roofNormals.push(rnx, rny, rnz, rnx, rny, rnz, rnx, rny, rnz)
          roofColors.push(
            roofRgb[0] * 0.92,
            roofRgb[1] * 0.92,
            roofRgb[2] * 0.92,
            1,
            roofRgb[0] * 0.92,
            roofRgb[1] * 0.92,
            roofRgb[2] * 0.92,
            1,
            roofRgb[0] * 1.06,
            roofRgb[1] * 1.06,
            roofRgb[2] * 1.06,
            1,
          )
          roofIndices.push(baseIdx, baseIdx + 2, baseIdx + 1)
        }
      } else {
        const roofTris = triangulatePolygon2D(rawRing)
        if (roofTris.length >= 3) {
          const roofBaseIdx = roofPositions.length / 3
          for (let i = 0; i < rawRing.length; i++) {
            const p = rawRing[i]
            roofPositions.push(p.x, topH, p.z)
            roofNormals.push(0, 1, 0)
            roofColors.push(roofRgb[0], roofRgb[1], roofRgb[2], 1)
          }
          for (let i = 0; i < roofTris.length; i++) {
            roofIndices.push(roofBaseIdx + roofTris[i])
          }
        }
      }
    }

    const createdBuildingMeshes: Mesh[] = []

    if (wallPositions.length > 0) {
      const wallMesh = new Mesh(`ofm-buildings-walls`, this.scene)
      const vData = new VertexData()
      vData.positions = wallPositions
      vData.normals = wallNormals
      vData.colors = wallColors
      vData.indices = wallIndices
      vData.applyToMesh(wallMesh, false)

      wallMesh.useVertexColors = true
      wallMesh.material = wallMat
      wallMesh.alwaysSelectAsActiveMesh = true
      wallMesh.freezeWorldMatrix()
      this.spawnedNodes.push(wallMesh)
      createdBuildingMeshes.push(wallMesh)
    }

    if (roofPositions.length > 0) {
      const roofMesh = new Mesh(`ofm-buildings-roofs`, this.scene)
      const rData = new VertexData()
      rData.positions = roofPositions
      rData.normals = roofNormals
      rData.colors = roofColors
      rData.indices = roofIndices
      rData.applyToMesh(roofMesh, false)

      roofMesh.useVertexColors = true
      roofMesh.material = roofMat
      roofMesh.alwaysSelectAsActiveMesh = true
      roofMesh.freezeWorldMatrix()
      this.spawnedNodes.push(roofMesh)
      createdBuildingMeshes.push(roofMesh)
    }

    // Sync building appearance with LnStyleManager and hide synthetic meshes when real Google 3D Tiles are active!
    const syncBuildingStyle = () => {
      if (this.isDisposed) return
      const pal = LnStyleManager.getInstance().palette
      const hasPhotoreal = GodsEyeGlobeEngine.getInstance().hasPhotoreal3DTiles()

      if (pal.isLineMode) {
        wallMat.diffuseColor = pal.backgroundRgb
        wallMat.emissiveColor = pal.minorContourRgb.scale(0.35)
        roofMat.diffuseColor = pal.backgroundRgb
        roofMat.emissiveColor = pal.majorContourRgb.scale(0.35)
        for (const m of createdBuildingMeshes) {
          m.setEnabled(true)
          m.useVertexColors = false
          m.enableEdgesRendering(0.88)
          m.edgesWidth = 2.2
          m.edgesColor = pal.majorContourRgb.toColor4(0.95)
        }
      } else if (pal.isIrVision) {
        wallMat.diffuseColor = new Color3(0.25, 0.08, 0.38)
        wallMat.emissiveColor = new Color3(0.55, 0.18, 0.42)
        roofMat.diffuseColor = new Color3(0.85, 0.35, 0.12)
        roofMat.emissiveColor = new Color3(0.75, 0.28, 0.08)
        for (const m of createdBuildingMeshes) {
          m.setEnabled(true)
          m.useVertexColors = false
          m.disableEdgesRendering()
        }
      } else {
        wallMat.diffuseColor = new Color3(1, 1, 1)
        wallMat.emissiveColor = new Color3(0, 0, 0)
        roofMat.diffuseColor = new Color3(1, 1, 1)
        roofMat.emissiveColor = new Color3(0, 0, 0)
        for (const m of createdBuildingMeshes) {
          // Hide procedural extruded buildings when the actual Google Photorealistic 3D Tileset is active!
          m.setEnabled(!hasPhotoreal)
          m.useVertexColors = true
          m.disableEdgesRendering()
        }
      }
    }
    syncBuildingStyle()
    GodsEyeGlobeEngine.getInstance().onTilesetReady(syncBuildingStyle)
    const unsubBldg = LnStyleManager.getInstance().subscribe(syncBuildingStyle)
    const prevUnsub = this.unsubscribeStyle
    this.unsubscribeStyle = () => {
      prevUnsub?.()
      unsubBldg()
    }
  }

  private async streamGlobalDemElevation(): Promise<void> {
    try {
      const zoom = 12
      const n = Math.pow(2, zoom)
      const centerLatLon = this.localXZToLatLon(0, 900)
      const centerTile = lonLatToTileXY(
        centerLatLon.lon,
        centerLatLon.lat,
        zoom,
      )
      const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${zoom}/${centerTile.x}/${centerTile.y}.png`

      const img = await new Promise<HTMLImageElement | null>((resolve) => {
        const el = new Image()
        el.crossOrigin = 'anonymous'
        el.onload = () => resolve(el)
        el.onerror = () => resolve(null)
        el.src = url
      })
      if (!img || this.isDisposed) return

      const canvas = document.createElement('canvas')
      canvas.width = 256
      canvas.height = 256
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.drawImage(img, 0, 0)
      img.src = ''
      const imgData = ctx.getImageData(0, 0, 256, 256).data
      canvas.width = 1
      canvas.height = 1

      const grid = new Float32Array(this.demCols * this.demRows)
      const minX = -this.meshWidth * 0.5
      const minZ = this.meshCenterZ - this.meshDepth * 0.5

      for (let r = 0; r < this.demRows; r++) {
        const z = minZ + (r / (this.demRows - 1)) * this.meshDepth
        for (let c = 0; c < this.demCols; c++) {
          const x = minX + (c / (this.demCols - 1)) * this.meshWidth
          const { lat, lon } = this.localXZToLatLon(x, z)

          const latRad = (lat * Math.PI) / 180
          const exactTileX = ((lon + 180) / 360) * n
          const exactTileY =
            ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) /
              2) *
            n

          const px = Math.max(
            0,
            Math.min(255, Math.floor((exactTileX - centerTile.x) * 256)),
          )
          const py = Math.max(
            0,
            Math.min(255, Math.floor((exactTileY - centerTile.y) * 256)),
          )
          const idx = (py * 256 + px) * 4
          const R = imgData[idx]
          const G = imgData[idx + 1]
          const B = imgData[idx + 2]
          const A = imgData[idx + 3]

          if (A > 0) {
            const hMeters = R * 256 + G + B / 256 - 32768
            grid[r * this.demCols + c] = Math.max(0, Math.min(8850, hMeters))
          } else {
            grid[r * this.demCols + c] = this.site.launchElevationM
          }
        }
      }

      this.demGridMsl = grid
      this.refreshTerrainVertices()
    } catch {
      // Fallback profile active
    }
  }

  /** New names appear as you roam. A short move keeps the signs you already have. */
  public refreshStreetNames(lat: number, lon: number, force = false): void {
    if (this.isDisposed || this.streetFetchBusy) return
    if (!force && Number.isFinite(this.lastStreetLat)) {
      const dLat = (lat - this.lastStreetLat) * 111320
      const dLon = (lon - this.lastStreetLon) * 111320 * Math.cos((lat * Math.PI) / 180)
      if (Math.hypot(dLat, dLon) < 700) return
    }
    this.streetFetchBusy = true
    this.lastStreetLat = lat
    this.lastStreetLon = lon
    const token = ++this.streetFetchToken
    void GodsEyeGlobeEngine.getInstance()
      .fetchNamedStreets(lat, lon)
      .then((streets) => {
        this.streetFetchBusy = false
        if (this.isDisposed || token !== this.streetFetchToken) return
        this.streetNames.setStreets(streets, (streetLat, streetLon) => {
          const xz = this.latLonToLocalXZ(streetLat, streetLon)
          const inside = Math.abs(xz.x) < 1700 && xz.z > -300 && xz.z < 3100
          const ground = inside
            ? this.sampleHeight(xz.x, xz.z)
            : (GodsEyeGlobeEngine.getInstance().sampleGlobeTerrainHeight(streetLat, streetLon) ??
              this.site.launchElevationM)
          return { x: xz.x, y: ground + 1.6, z: xz.z }
        }, this.site.headingDeg)
      })
      .catch(() => {
        this.streetFetchBusy = false
      })
  }

  public dispose(): void {
    this.isDisposed = true
    this.streetNames.dispose()
    if (this.unsubscribeStyle) {
      this.unsubscribeStyle()
      this.unsubscribeStyle = null
    }
    for (const node of this.spawnedNodes) {
      if (node && typeof node.dispose === 'function') {
        node.dispose()
      }
    }
    this.spawnedNodes = []
    this.obstacles.length = 0
  }
}
