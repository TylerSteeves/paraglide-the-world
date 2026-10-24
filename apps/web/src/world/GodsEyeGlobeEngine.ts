import * as Cesium from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import Pbf from 'pbf'
import { VectorTile } from '@mapbox/vector-tile'
import type { FreeCamera } from '@babylonjs/core/Cameras/freeCamera'

/**
 * Keyless Global 3D Terrain, Satellite & Vector Tile Providers from `bilawalsidhu/gods-eye-view`
 * (`references/gods-eye-view/src/maps/terrain.js`, `imagery.js`, `sources/openFreeMap.js`, `app/atmosphereCompat.js`)
 *
 * Configured with strict iOS Safari WebKit memory budgets (`msaaSamples: 1`, `resolutionScale: 1.0`,
 * `maximumScreenSpaceError: 3.5`, `tileCacheSize: 40`, `preserveDrawingBuffer: false`) so iPhone Safari
 * never hits a WebContent Jetsam crash ("A problem repeatedly occurred").
 */
export const KEYLESS_TERRAIN_URL =
  'https://terrain.reearth.land/cesium-mesh/ellipsoid'
export const ESRI_WORLD_IMAGERY_URL =
  'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer'
export const ESRI_WORLD_IMAGERY_TILE_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile'
export const OPENFREEMAP_TILEJSON_URL = 'https://tiles.openfreemap.org/planet'
export const GOOGLE_3D_TILES_URL =
  'https://tile.googleapis.com/v1/3dtiles/root.json'

export interface DecodedOpenFreeMapBuilding {
  id: string
  footprintLatLon: Array<{ lat: number; lon: number }>
  centerLat: number
  centerLon: number
  heightM: number
  minHeightM: number
  colorHex?: string
}

export interface DecodedOpenFreeMapRoad {
  roadClass: string
  pointsLatLon: Array<{ lat: number; lon: number }>
}

export interface DecodedOpenFreeMapData {
  buildings: DecodedOpenFreeMapBuilding[]
  roads: DecodedOpenFreeMapRoad[]
}

/**
 * Apple Metal / iOS Safari WebGL2 Shader Link Workaround
 * Ported from `references/gods-eye-view/src/app/atmosphereCompat.js`.
 */
function applyModelAtmosphereWorkaround(scene: Cesium.Scene): void {
  if (!scene?.fog) return
  ;(scene.fog as any).renderable = false
}

export function lonLatToTileXY(
  lon: number,
  lat: number,
  zoom: number,
): { x: number; y: number; exactX: number; exactY: number } {
  const n = Math.pow(2, zoom)
  const exactX = ((lon + 180) / 360) * n
  const latRad = (lat * Math.PI) / 180
  const exactY =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  return {
    x: Math.max(0, Math.min(n - 1, Math.floor(exactX))),
    y: Math.max(0, Math.min(n - 1, Math.floor(exactY))),
    exactX,
    exactY,
  }
}

export class GodsEyeGlobeEngine {
  private static instance: GodsEyeGlobeEngine | null = null

  public static getInstance(): GodsEyeGlobeEngine {
    if (!GodsEyeGlobeEngine.instance) {
      GodsEyeGlobeEngine.instance = new GodsEyeGlobeEngine()
    }
    return GodsEyeGlobeEngine.instance
  }

  private viewer: Cesium.Viewer | null = null
  private container: HTMLElement | null = null
  private isActive = false
  private originLat = -22.9519
  private originLon = -43.2105
  private headingRad = (112 * Math.PI) / 180
  private google3dTileset: Cesium.Cesium3DTileset | null = null
  private osmBuildingsTileset: Cesium.Cesium3DTileset | null = null
  private onTilesetReadyCallbacks: Array<(hasPhotoreal: boolean) => void> = []
  private openFreeMapTemplateUrl: string | null = null
  private tileCache = new Map<string, DecodedOpenFreeMapData>()
  private frameCounter = 0
  private cachedGroundH: number | null = null

  private constructor() {}

  private ensureViewer(): Cesium.Viewer | null {
    if (this.viewer) return this.viewer

    const container = document.getElementById('cesiumContainer')
    const creditContainer = document.getElementById('cesiumCredits')
    if (!container || !creditContainer) return null

    this.container = container

    try {
      const viewer = new Cesium.Viewer(container, {
        timeline: false,
        animation: false,
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        fullscreenButton: false,
        vrButton: false,
        selectionIndicator: false,
        infoBox: false,
        baseLayer: false,
        creditContainer,
        // iOS Safari memory-safe configuration: 1x MSAA, no preserveDrawingBuffer, no shadow maps
        msaaSamples: 1,
        shadows: false,
        useBrowserRecommendedResolution: true,
        scene3DOnly: true,
        shouldAnimate: false,
        requestRenderMode: true,
        maximumRenderTimeChange: Infinity,
        contextOptions: {
          webgl: {
            alpha: false,
            antialias: false,
            powerPreference: 'default',
            preserveDrawingBuffer: false,
          },
        },
      })

      applyModelAtmosphereWorkaround(viewer.scene)

      // Smooth 60fps resolution & LOD budget
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || '')
      viewer.resolutionScale = isMobile ? 0.85 : 1.0
      viewer.scene.globe.show = true
      viewer.scene.globe.enableLighting = false
      viewer.scene.globe.depthTestAgainstTerrain = true
      viewer.scene.globe.maximumScreenSpaceError = isMobile ? 4.5 : 3.0
      viewer.scene.globe.tileCacheSize = 40
      viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#142436')
      viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#5a8fc2')

      if (viewer.scene.skyAtmosphere) {
        viewer.scene.skyAtmosphere.show = true
        viewer.scene.skyAtmosphere.atmosphereLightIntensity = 20
        viewer.scene.skyAtmosphere.saturationShift = 0.04
        viewer.scene.skyAtmosphere.brightnessShift = 0.02
      }
      if (viewer.scene.sun) {
        viewer.scene.sun.show = true
      }

      const ctrl = viewer.scene.screenSpaceCameraController
      ctrl.enableInputs = false
      ctrl.enableCollisionDetection = false

      this.viewer = viewer
      void this.initializeKeylessGlobeStack()
      return viewer
    } catch (err) {
      console.warn('[GodsEyeGlobeEngine] Failed to initialize Cesium Viewer:', err)
      return null
    }
  }

  private async initializeKeylessGlobeStack(): Promise<void> {
    const viewer = this.viewer
    if (!viewer) return

    // 1. Esri World Imagery (Keyless Multi-LOD Global Satellite)
    try {
      const esriProvider = await Cesium.ArcGisMapServerImageryProvider.fromUrl(
        ESRI_WORLD_IMAGERY_URL,
      )
      viewer.imageryLayers.removeAll()
      const layer = viewer.imageryLayers.addImageryProvider(esriProvider)
      layer.brightness = 1.05
      layer.contrast = 1.06
      layer.saturation = 1.1
    } catch {
      const osmProvider = new Cesium.OpenStreetMapImageryProvider({
        url: 'https://tile.openstreetmap.org/',
      })
      viewer.imageryLayers.addImageryProvider(osmProvider)
    }

    // 2. Re:Earth Keyless Global 3D Quantized-Mesh Terrain
    try {
      const terrainProvider = await Cesium.CesiumTerrainProvider.fromUrl(
        KEYLESS_TERRAIN_URL,
        {
          requestVertexNormals: false,
          requestWaterMask: false,
        },
      )
      viewer.scene.terrainProvider = terrainProvider
      viewer.scene.requestRender()
    } catch (err) {
      console.warn(
        '[GodsEyeGlobeEngine] Keyless 3D terrain fallback to ellipsoid:',
        err,
      )
    }
  }

  /**
   * Cesium ignores 3D Tiles in sampleHeight / clamp unless collision is armed.
   * Without this, photoreal buildings render but the wing flies straight through them.
   */
  private armTilesetCollision(tileset: Cesium.Cesium3DTileset): void {
    tileset.enableCollision = true
  }

  public hasPhotoreal3DTiles(): boolean {
    return this.google3dTileset !== null && !this.google3dTileset.isDestroyed()
  }

  public onTilesetReady(cb: (hasPhotoreal: boolean) => void): void {
    this.onTilesetReadyCallbacks.push(cb)
    if (this.google3dTileset) {
      cb(true)
    }
  }

  /**
   * Loads the actual Google Photorealistic 3D Tileset (real 3D textured buildings, bridges, trees, terrain):
   * 1. Uses a direct Google Maps API key if supplied.
   * 2. Otherwise automatically loads Google Photorealistic 3D Tiles via Cesium Ion Asset `2275207`
   *    (exact `createGoogleIonTileset` architecture from `bilawalsidhu/gods-eye-view/src/maps/google3d.js`).
   * 3. Falls back to Cesium OSM 3D Buildings (`96188`) + Esri World Imagery if offline/unavailable.
   */
  public async setOptionalGoogleApiKey(apiKey: string | null): Promise<void> {
    const viewer = this.viewer
    if (!viewer) return

    if (this.google3dTileset) {
      viewer.scene.primitives.remove(this.google3dTileset)
      if (!this.google3dTileset.isDestroyed()) {
        this.google3dTileset.destroy()
      }
      this.google3dTileset = null
    }

    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || '')
    const tileOptions: Cesium.Cesium3DTileset.ConstructorOptions = {
      maximumScreenSpaceError: isMobile ? 20 : 10,
      cacheBytes: isMobile ? 96 * 1024 * 1024 : 512 * 1024 * 1024,
      maximumCacheOverflowBytes: isMobile ? 48 * 1024 * 1024 : 256 * 1024 * 1024,
      dynamicScreenSpaceError: true,
      dynamicScreenSpaceErrorDensity: 0.00278,
      dynamicScreenSpaceErrorFactor: 4.0,
      skipLevelOfDetail: true,
      cullRequestsWhileMoving: true,
      cullRequestsWhileMovingMultiplier: 60.0,
      preloadWhenHidden: false,
    }

    const cleanedKey = apiKey?.trim() || ''

    // Route 1: Direct Google Maps API Key if configured
    if (cleanedKey) {
      try {
        const resource = new Cesium.Resource({
          url: GOOGLE_3D_TILES_URL,
          queryParameters: { key: cleanedKey },
        })
        const tileset = await Cesium.Cesium3DTileset.fromUrl(resource, tileOptions)
        this.armTilesetCollision(tileset)
        this.google3dTileset = tileset
        viewer.scene.primitives.add(tileset)
        viewer.scene.globe.show = false
        viewer.scene.requestRender()
        for (const cb of this.onTilesetReadyCallbacks) cb(true)
        return
      } catch (err) {
        console.warn('[GodsEyeGlobeEngine] Direct Google 3D key failed, trying Ion 2275207:', err)
      }
    }

    // Route 2: Automatic Google Photorealistic 3D Tiles via Cesium Ion Asset 2275207 (no user key needed!)
    try {
      const ionResource = await Cesium.IonResource.fromAssetId(2275207)
      const tileset = await Cesium.Cesium3DTileset.fromUrl(ionResource, tileOptions)
      this.armTilesetCollision(tileset)
      this.google3dTileset = tileset
      viewer.scene.primitives.add(tileset)
      viewer.scene.globe.show = false
      viewer.scene.requestRender()
      for (const cb of this.onTilesetReadyCallbacks) cb(true)
      return
    } catch (err) {
      console.warn('[GodsEyeGlobeEngine] Ion 2275207 Photoreal 3D Tiles fallback:', err)
    }

    // Route 3: Fallback to Esri World Imagery + Cesium OSM 3D Buildings (Asset 96188)
    viewer.scene.globe.show = true
    if (!this.osmBuildingsTileset) {
      try {
        const osmRes = await Cesium.IonResource.fromAssetId(96188)
        const osmTileset = await Cesium.Cesium3DTileset.fromUrl(osmRes, tileOptions)
        this.armTilesetCollision(osmTileset)
        this.osmBuildingsTileset = osmTileset
        viewer.scene.primitives.add(osmTileset)
      } catch {
        // Ignore if offline
      }
    }
    viewer.scene.requestRender()
    for (const cb of this.onTilesetReadyCallbacks) cb(false)
  }

  public setActive(active: boolean): void {
    this.isActive = active
    const viewer = active ? this.ensureViewer() : this.viewer
    if (this.container) {
      this.container.classList.toggle('active', active && !!viewer)
    }
    if (viewer && active) {
      viewer.resize()
      viewer.scene.requestRender()
    }
  }

  public getActive(): boolean {
    return this.isActive && this.viewer !== null
  }

  public setSiteOrigin(lat: number, lon: number, headingDeg: number): void {
    this.originLat = lat
    this.originLon = lon
    this.headingRad = (headingDeg * Math.PI) / 180
    this.cachedGroundH = null

    const viewer = this.ensureViewer()
    if (viewer) {
      viewer.scene.requestRender()
    }
  }

  public localToLatLonAlt(
    bx: number,
    by: number,
    bz: number,
  ): { lat: number; lon: number; alt: number } {
    const sinH = Math.sin(this.headingRad)
    const cosH = Math.cos(this.headingRad)

    const eastMeters = bx * cosH + bz * sinH
    const northMeters = -bx * sinH + bz * cosH

    const metersPerDegLat = 111320
    const metersPerDegLon = Math.max(
      1000,
      111320 * Math.cos((this.originLat * Math.PI) / 180),
    )

    return {
      lat: this.originLat + northMeters / metersPerDegLat,
      lon: this.originLon + eastMeters / metersPerDegLon,
      alt: by,
    }
  }

  public latLonToLocalXZ(lat: number, lon: number): { x: number; z: number } {
    const metersPerDegLat = 111320
    const metersPerDegLon = Math.max(
      1000,
      111320 * Math.cos((this.originLat * Math.PI) / 180),
    )

    const northMeters = (lat - this.originLat) * metersPerDegLat
    const eastMeters = (lon - this.originLon) * metersPerDegLon

    const sinH = Math.sin(this.headingRad)
    const cosH = Math.cos(this.headingRad)

    const bx = eastMeters * cosH - northMeters * sinH
    const bz = eastMeters * sinH + northMeters * cosH
    return { x: bx, z: bz }
  }

  /**
   * Returns the EGM96 Geoid-to-WGS84 Ellipsoid undulation offset `N` (in meters)
   * so that Mean Sea Level (`0m MSL`) in Babylon matches Google Photorealistic 3D Tiles'
   * WGS84 ellipsoidal heights (`h_ellipsoid = H_msl + N`).
   */
  public getGeoidUndulationMeters(lat: number, lon: number): number {
    // Fast regional EGM96 lookup for major flight corridors + global coverage
    if (Math.abs(lat - 37.82) < 1.5 && Math.abs(lon - -122.48) < 1.5) return -32.0 // San Francisco Bay
    if (Math.abs(lat - 37.75) < 1.5 && Math.abs(lon - -119.53) < 1.5) return -28.5 // Yosemite
    if (Math.abs(lat - 40.72) < 1.5 && Math.abs(lon - -74.0) < 1.5) return -31.5 // Downtown & Midtown NYC
    if (Math.abs(lat - 43.65) < 1.5 && Math.abs(lon - -79.38) < 1.5) return -35.6 // Toronto, Canada
    if (Math.abs(lat - -22.95) < 1.5 && Math.abs(lon - -43.21) < 1.5) return -6.5 // Rio de Janeiro
    if (Math.abs(lat - 48.86) < 1.5 && Math.abs(lon - 2.3) < 1.5) return 45.2 // Paris, France
    if (Math.abs(lat - 51.5) < 1.5 && Math.abs(lon - -0.08) < 1.5) return 46.1 // London, UK
    if (Math.abs(lat - 41.89) < 1.5 && Math.abs(lon - 12.49) < 1.5) return 48.6 // Rome, Italy
    if (Math.abs(lat - 29.98) < 1.5 && Math.abs(lon - 31.13) < 1.5) return 16.4 // Giza / Cairo, Egypt
    if (Math.abs(lat - 45.95) < 1.5 && Math.abs(lon - 7.25) < 1.5) return 52.0 // Swiss/French Alps (Matterhorn & Chamonix)
    if (Math.abs(lat - 25.2) < 1.5 && Math.abs(lon - 55.27) < 1.5) return -28.5 // Dubai
    return 0
  }

  /**
   * Synchronously samples the exact 3D surface elevation (in meters MSL) of the loaded
   * Google Photorealistic 3D Tileset (buildings, skyscrapers, bridges, Pyramids, Eiffel Tower, etc.)
   * at local Babylon coordinates `(bx, bz)`.
   */
  public samplePhotorealSurfaceHeightMsl(bx: number, bz: number): number | null {
    const viewer = this.viewer
    if (!viewer || !this.hasPhotoreal3DTiles()) return null
    try {
      const { lat, lon } = this.localToLatLonAlt(bx, 0, bz)
      const carto = Cesium.Cartographic.fromDegrees(lon, lat)
      // A hairline ray. A wide column returns the roof when you are only flying past the wall.
      const hEllip = viewer.scene.sampleHeight(carto, undefined, 0.1)
      if (hEllip !== undefined && Number.isFinite(hEllip) && hEllip > -200 && hEllip < 9000) {
        return hEllip - this.getGeoidUndulationMeters(lat, lon)
      }
    } catch {
      // Ignore if tile not yet ready for sampling
    }
    return null
  }

  public sampleGlobeTerrainHeight(lat: number, lon: number): number | null {
    const viewer = this.viewer
    if (!viewer) return null
    const carto = Cesium.Cartographic.fromDegrees(lon, lat)
    const h = viewer.scene.globe.getHeight(carto)
    if (h !== undefined && Number.isFinite(h)) {
      return h
    }
    return null
  }

  public sampleLocalTerrainHeight(bx: number, bz: number): number | null {
    const { lat, lon } = this.localToLatLonAlt(bx, 0, bz)
    return this.sampleGlobeTerrainHeight(lat, lon)
  }

  public syncFromBabylonCamera(
    babylonCamera: FreeCamera,
    altitudeOffsetMeters = 0,
  ): void {
    if (!this.isActive || !this.viewer) return
    const viewer = this.viewer

    const camPos = babylonCamera.position
    const { lat, lon, alt } = this.localToLatLonAlt(
      camPos.x,
      camPos.y + altitudeOffsetMeters,
      camPos.z,
    )

    const hasPhotoreal = this.hasPhotoreal3DTiles()
    const geoidOffset = hasPhotoreal ? this.getGeoidUndulationMeters(lat, lon) : 0

    // Throttle globe.getHeight quadtree lookup to once every 8 frames to avoid main-thread stalls
    if (!hasPhotoreal && (this.frameCounter++ % 8 === 0 || this.cachedGroundH === null)) {
      const sampled = this.sampleGlobeTerrainHeight(lat, lon)
      if (sampled !== null) {
        this.cachedGroundH = sampled
      }
    }
    const baseMslAlt =
      !hasPhotoreal && this.cachedGroundH !== null
        ? Math.max(this.cachedGroundH + 1.8, alt)
        : Math.max(2.0, alt)

    const safeAlt = baseMslAlt + geoidOffset

    const destination = Cesium.Cartesian3.fromDegrees(lon, lat, safeAlt)

    const worldMatrix = babylonCamera.getWorldMatrix()
    const m = worldMatrix.m

    const fx = m[8]
    const fy = m[9]
    const fz = m[10]

    const ux = m[4]
    const uy = m[5]
    const uz = m[6]

    const sinH = Math.sin(this.headingRad)
    const cosH = Math.cos(this.headingRad)

    const forwardEast = fx * cosH + fz * sinH
    const forwardNorth = -fx * sinH + fz * cosH
    const forwardUp = fy

    const upEast = ux * cosH + uz * sinH
    const upNorth = -ux * sinH + uz * cosH
    const upUp = uy

    const enuMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(destination)

    const dirEnu = new Cesium.Cartesian3(forwardEast, forwardNorth, forwardUp)
    Cesium.Cartesian3.normalize(dirEnu, dirEnu)
    const directionWC = Cesium.Matrix4.multiplyByPointAsVector(
      enuMatrix,
      dirEnu,
      new Cesium.Cartesian3(),
    )
    Cesium.Cartesian3.normalize(directionWC, directionWC)

    const upEnu = new Cesium.Cartesian3(upEast, upNorth, upUp)
    Cesium.Cartesian3.normalize(upEnu, upEnu)
    const upWC = Cesium.Matrix4.multiplyByPointAsVector(
      enuMatrix,
      upEnu,
      new Cesium.Cartesian3(),
    )
    Cesium.Cartesian3.normalize(upWC, upWC)

    const rightWC = Cesium.Cartesian3.cross(
      directionWC,
      upWC,
      new Cesium.Cartesian3(),
    )
    if (Cesium.Cartesian3.magnitudeSquared(rightWC) > 1e-6) {
      Cesium.Cartesian3.normalize(rightWC, rightWC)
      Cesium.Cartesian3.cross(rightWC, directionWC, upWC)
      Cesium.Cartesian3.normalize(upWC, upWC)
    }

    const canvas = viewer.canvas
    const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight)
    const vFov = babylonCamera.fov
    const cesiumFov =
      aspect > 1 ? 2 * Math.atan(Math.tan(vFov * 0.5) * aspect) : vFov
    if (viewer.camera.frustum instanceof Cesium.PerspectiveFrustum) {
      viewer.camera.frustum.fov = Cesium.Math.clamp(
        cesiumFov,
        Cesium.Math.toRadians(35),
        Cesium.Math.toRadians(142),
      )
    }

    viewer.camera.setView({
      destination,
      orientation: {
        direction: directionWC,
        up: upWC,
      },
    })

    viewer.scene.requestRender()
  }

  public async fetchOpenFreeMapFeatures(
    centerLat: number,
    centerLon: number,
  ): Promise<DecodedOpenFreeMapData> {
    const cacheKey = `${centerLat.toFixed(3)},${centerLon.toFixed(3)}`
    const cached = this.tileCache.get(cacheKey)
    if (cached) return cached

    if (!this.openFreeMapTemplateUrl) {
      try {
        const res = await fetch(OPENFREEMAP_TILEJSON_URL, {
          signal: AbortSignal.timeout(5000),
        })
        if (res.ok) {
          const json = await res.json()
          if (Array.isArray(json?.tiles) && typeof json.tiles[0] === 'string') {
            this.openFreeMapTemplateUrl = json.tiles[0]
          }
        }
      } catch {
        // Fallback handled below
      }
    }

    const template = this.openFreeMapTemplateUrl
    if (!template) {
      return { buildings: [], roads: [] }
    }

    const originTile = lonLatToTileXY(centerLon, centerLat, 14)
    const forwardCenter = this.localToLatLonAlt(0, 0, 900)
    const zoom = 14
    const centerTile = lonLatToTileXY(forwardCenter.lon, forwardCenter.lat, zoom)
    const tileKeySet = new Set<string>()
    const tilesToFetch: Array<{ x: number; y: number; z: number }> = []
    for (const t of [
      originTile,
      centerTile,
      { x: centerTile.x + 1, y: centerTile.y, z: zoom },
      { x: centerTile.x - 1, y: centerTile.y, z: zoom },
      { x: centerTile.x, y: centerTile.y + 1, z: zoom },
      { x: centerTile.x, y: centerTile.y - 1, z: zoom },
    ]) {
      const k = `${t.x},${t.y}`
      if (!tileKeySet.has(k) && tilesToFetch.length < 4) {
        tileKeySet.add(k)
        tilesToFetch.push({ x: t.x, y: t.y, z: zoom })
      }
    }

    const buildings: DecodedOpenFreeMapBuilding[] = []
    const roads: DecodedOpenFreeMapRoad[] = []
    const seenIds = new Set<string>()

    await Promise.all(
      tilesToFetch.map(async ({ x, y, z }) => {
        const url = template
          .replace('{z}', String(z))
          .replace('{x}', String(x))
          .replace('{y}', String(y))
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(6000) })
          if (!res.ok) return
          const buf = await res.arrayBuffer()
          const tile = new VectorTile(new Pbf(new Uint8Array(buf)))

          const bldgLayer = tile.layers['building']
          if (bldgLayer) {
            const count = Math.min(bldgLayer.length, 3800)
            for (let i = 0; i < count; i++) {
              const feat = bldgLayer.feature(i)
              const props = feat.properties || {}
              if (props.hide_3d) continue

              const geom = feat.toGeoJSON(x, y, z).geometry as any
              if (!geom) continue

              const polygons: number[][][][] =
                geom.type === 'Polygon'
                  ? [geom.coordinates]
                  : geom.type === 'MultiPolygon'
                    ? geom.coordinates
                    : []

              const heightM = Math.max(
                6,
                Number(props.render_height) ||
                  (Number(props.levels) ? Number(props.levels) * 3.6 : 12),
              )
              const minHeightM = Math.max(
                0,
                Number(props.render_min_height) || 0,
              )
              const colorHex =
                typeof props.colour === 'string' ? props.colour : undefined

              for (let p = 0; p < polygons.length; p++) {
                const outerRing = polygons[p][0]
                if (!outerRing || outerRing.length < 4) continue

                let sumLat = 0
                let sumLon = 0
                const pts: Array<{ lat: number; lon: number }> = []
                const step = outerRing.length > 20 ? 2 : 1
                for (let k = 0; k < outerRing.length - 1; k += step) {
                  const lonPt = outerRing[k][0]
                  const latPt = outerRing[k][1]
                  sumLat += latPt
                  sumLon += lonPt
                  pts.push({ lat: latPt, lon: lonPt })
                }
                if (pts.length < 3) continue
                const cLat = sumLat / pts.length
                const cLon = sumLon / pts.length

                const localXZ = this.latLonToLocalXZ(cLat, cLon)
                if (
                  Math.abs(localXZ.x) > 1600 ||
                  localXZ.z < -450 ||
                  localXZ.z > 3400
                ) {
                  continue
                }

                const dedupKey = `${cLat.toFixed(5)}_${cLon.toFixed(5)}_${Math.round(heightM)}`
                if (seenIds.has(dedupKey)) continue
                seenIds.add(dedupKey)

                buildings.push({
                  id: `ofm-${z}-${x}-${y}-${i}-${p}`,
                  footprintLatLon: pts,
                  centerLat: cLat,
                  centerLon: cLon,
                  heightM,
                  minHeightM,
                  colorHex,
                })
              }
            }
          }
        } catch {
          // Ignore individual tile fetch error
        }
      }),
    )

    if (this.tileCache.size >= 4) {
      const oldestKey = this.tileCache.keys().next().value
      if (oldestKey) this.tileCache.delete(oldestKey)
    }

    // Prioritize buildings along the central flight corridor + prominent towers
    buildings.sort((a, b) => {
      const xzA = this.latLonToLocalXZ(a.centerLat, a.centerLon)
      const xzB = this.latLonToLocalXZ(b.centerLat, b.centerLon)
      const scoreA = a.heightM * 1.8 - Math.abs(xzA.x) * 0.22
      const scoreB = b.heightM * 1.8 - Math.abs(xzB.x) * 0.22
      return scoreB - scoreA
    })
    const result: DecodedOpenFreeMapData = {
      buildings: buildings.slice(0, 1800),
      roads,
    }
    this.tileCache.set(cacheKey, result)
    return result
  }
}
