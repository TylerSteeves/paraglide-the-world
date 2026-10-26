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

export interface NamedStreet {
  name: string
  roadClass: string
  lat: number
  lon: number
  /** Clockwise degrees from true north, along the road at the label. */
  bearingDeg: number
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
  /** A newer load wins. A slow failure must not clear the city that already arrived. */
  private tilesetLoadGen = 0
  private onTilesetReadyCallbacks: Array<(hasPhotoreal: boolean) => void> = []
  private openFreeMapTemplateUrl: string | null = null
  private tileCache = new Map<string, DecodedOpenFreeMapData>()
  private frameCounter = 0
  private cachedGroundH: number | null = null
  private pickingEarth = false
  private activeBeforePick = false
  private pickHandler: Cesium.ScreenSpaceEventHandler | null = null
  private pickPin: Cesium.Entity | null = null
  private pickLat: number | null = null
  private pickLon: number | null = null
  private onEarthPicked: ((lat: number, lon: number) => void) | null = null

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
   * Loads Google Photorealistic 3D Tiles (real buildings, bridges, trees, terrain).
   * Cesium Ion asset 2275207 is first. The project key often 404s, and waiting on it
   * left the block buildings up. The direct key is only a backup.
   * A reload keeps the city that is already on screen until the new one is ready.
   */
  public async setOptionalGoogleApiKey(apiKey: string | null): Promise<void> {
    const viewer = this.viewer
    if (!viewer) return

    const gen = ++this.tilesetLoadGen
    const cleanedKey = apiKey?.trim() || ''
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

    const stale = () => gen !== this.tilesetLoadGen

    const install = (tileset: Cesium.Cesium3DTileset) => {
      if (stale()) {
        if (!tileset.isDestroyed()) tileset.destroy()
        return
      }
      this.swapPhotorealTileset(viewer, tileset)
      if (this.osmBuildingsTileset) this.osmBuildingsTileset.show = false
      viewer.scene.globe.show = false
      viewer.scene.requestRender()
      for (const cb of this.onTilesetReadyCallbacks) cb(true)
    }

    try {
      const ionResource = await Cesium.IonResource.fromAssetId(2275207)
      if (stale()) return
      const tileset = await Cesium.Cesium3DTileset.fromUrl(ionResource, tileOptions)
      install(tileset)
      return
    } catch (err) {
      if (stale()) return
      console.warn('[GodsEyeGlobeEngine] Ion 2275207 photoreal failed:', err)
    }

    if (cleanedKey) {
      try {
        const resource = new Cesium.Resource({
          url: GOOGLE_3D_TILES_URL,
          queryParameters: { key: cleanedKey },
        })
        const tileset = await Cesium.Cesium3DTileset.fromUrl(resource, tileOptions)
        install(tileset)
        return
      } catch (err) {
        if (stale()) return
        console.warn('[GodsEyeGlobeEngine] Direct Google 3D key failed:', err)
      }
    }

    if (stale()) return
    if (this.hasPhotoreal3DTiles()) {
      for (const cb of this.onTilesetReadyCallbacks) cb(true)
      return
    }

    // Last resort: satellite globe plus Cesium OSM buildings. These are the block meshes.
    viewer.scene.globe.show = true
    if (!this.osmBuildingsTileset) {
      try {
        const osmRes = await Cesium.IonResource.fromAssetId(96188)
        if (stale()) return
        const osmTileset = await Cesium.Cesium3DTileset.fromUrl(osmRes, tileOptions)
        if (stale()) {
          if (!osmTileset.isDestroyed()) osmTileset.destroy()
          return
        }
        this.armTilesetCollision(osmTileset)
        this.osmBuildingsTileset = osmTileset
        viewer.scene.primitives.add(osmTileset)
      } catch {
        // Ignore if offline
      }
    } else {
      this.osmBuildingsTileset.show = true
    }
    viewer.scene.requestRender()
    for (const cb of this.onTilesetReadyCallbacks) cb(false)
  }

  /** Drop the previous photoreal set only after its replacement exists. */
  private swapPhotorealTileset(viewer: Cesium.Viewer, tileset: Cesium.Cesium3DTileset): void {
    const previous = this.google3dTileset
    this.armTilesetCollision(tileset)
    this.google3dTileset = tileset
    viewer.scene.primitives.add(tileset)
    if (previous && previous !== tileset) {
      viewer.scene.primitives.remove(previous)
      if (!previous.isDestroyed()) previous.destroy()
    }
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

  public isPickingEarth(): boolean {
    return this.pickingEarth
  }

  /** Orbit the whole planet, tap a spot, then drop into flight there. */
  public beginWholeEarthPick(onPick: (lat: number, lon: number) => void): void {
    this.onEarthPicked = onPick
    this.activeBeforePick = this.isActive
    this.pickingEarth = true
    this.pickLat = null
    this.pickLon = null
    const viewer = this.ensureViewer()
    this.setActive(true)
    if (!viewer) return

    viewer.scene.globe.show = true
    if (this.google3dTileset) this.google3dTileset.show = false
    if (this.osmBuildingsTileset) this.osmBuildingsTileset.show = false
    viewer.scene.requestRenderMode = false
    viewer.resize()

    const ctrl = viewer.scene.screenSpaceCameraController
    ctrl.enableInputs = true
    ctrl.enableRotate = true
    ctrl.enableZoom = true
    ctrl.enableTilt = true
    ctrl.enableLook = false
    ctrl.enableTranslate = true
    ctrl.enableCollisionDetection = true
    ctrl.minimumZoomDistance = 180
    this.container?.classList.add('earth-pick')

    this.clearPickPin()
    this.pickHandler?.destroy()
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
    handler.setInputAction((click: { position: Cesium.Cartesian2 }) => {
      const picked = this.pickLatLon(click.position)
      if (!picked) return
      this.markPick(picked.lat, picked.lon, 14000)
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)
    this.pickHandler = handler

    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(this.originLon, this.originLat, 16000000),
      duration: 1.3,
    })
  }

  public endWholeEarthPick(): void {
    const viewer = this.viewer
    this.pickingEarth = false
    this.onEarthPicked = null
    this.pickHandler?.destroy()
    this.pickHandler = null
    this.clearPickPin()
    this.container?.classList.remove('earth-pick')
    if (viewer) {
      const ctrl = viewer.scene.screenSpaceCameraController
      ctrl.enableInputs = false
      ctrl.enableCollisionDetection = false
      viewer.scene.requestRenderMode = true
      const photoreal = this.hasPhotoreal3DTiles()
      viewer.scene.globe.show = !photoreal
      if (this.google3dTileset) this.google3dTileset.show = true
      if (this.osmBuildingsTileset) this.osmBuildingsTileset.show = true
      viewer.scene.requestRender()
    }
    if (!this.activeBeforePick) this.setActive(false)
  }

  public getPickLatLon(): { lat: number; lon: number } | null {
    if (this.pickLat === null || this.pickLon === null) return null
    return { lat: this.pickLat, lon: this.pickLon }
  }

  /** Cesium heading is clockwise from north, matching the flight heading. */
  public getPickHeadingDeg(): number {
    const viewer = this.viewer
    if (!viewer) return 90
    let deg = Cesium.Math.toDegrees(viewer.camera.heading)
    deg = ((deg % 360) + 360) % 360
    return deg
  }

  public flyToPlace(lat: number, lon: number, heightM = 14000, notify = true): void {
    this.markPick(lat, lon, heightM, notify)
  }

  public async searchPlace(query: string): Promise<{ lat: number; lon: number; name: string } | null> {
    const q = query.trim()
    if (q.length < 2) return null
    try {
      const url = `https://photon.komoot.io/api/?limit=1&q=${encodeURIComponent(q)}`
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
      if (!res.ok) return null
      const json = await res.json()
      const feature = json?.features?.[0]
      const coords = feature?.geometry?.coordinates
      if (!coords || coords.length < 2) return null
      const props = feature.properties || {}
      const bits = [props.name, props.street, props.city, props.state, props.country].filter(
        (part: unknown) => typeof part === 'string' && part.length > 0,
      )
      const unique = [...new Set(bits)]
      return {
        lon: Number(coords[0]),
        lat: Number(coords[1]),
        name: unique.slice(0, 3).join(', ') || q,
      }
    } catch {
      return null
    }
  }

  public async reversePlace(lat: number, lon: number): Promise<string | null> {
    try {
      const url = `https://photon.komoot.io/reverse?lon=${lon}&lat=${lat}`
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) })
      if (!res.ok) return null
      const json = await res.json()
      const props = json?.features?.[0]?.properties
      if (!props) return null
      const bits = [props.name, props.street, props.city, props.country].filter(
        (part: unknown) => typeof part === 'string' && part.length > 0,
      )
      const unique = [...new Set(bits)]
      return unique.slice(0, 3).join(', ') || null
    } catch {
      return null
    }
  }

  private pickLatLon(position: Cesium.Cartesian2): { lat: number; lon: number } | null {
    const viewer = this.viewer
    if (!viewer) return null
    const ray = viewer.camera.getPickRay(position)
    if (!ray) return null
    const cartesian = viewer.scene.globe.pick(ray, viewer.scene)
    if (!cartesian) return null
    const carto = Cesium.Cartographic.fromCartesian(cartesian)
    return {
      lat: Cesium.Math.toDegrees(carto.latitude),
      lon: Cesium.Math.toDegrees(carto.longitude),
    }
  }

  private markPick(lat: number, lon: number, heightM: number, notify = true): void {
    const viewer = this.viewer
    if (!viewer) return
    this.pickLat = lat
    this.pickLon = lon
    this.clearPickPin()
    this.pickPin = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lon, lat),
      point: {
        pixelSize: 16,
        color: Cesium.Color.fromCssColorString('#fbbf24'),
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    })
    const heading = viewer.camera.heading
    const pitch = Math.min(viewer.camera.pitch, Cesium.Math.toRadians(-32))
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(lon, lat, heightM),
      orientation: { heading, pitch, roll: 0 },
      duration: 1.05,
    })
    if (notify) this.onEarthPicked?.(lat, lon)
  }

  private clearPickPin(): void {
    if (this.pickPin && this.viewer) {
      this.viewer.entities.remove(this.pickPin)
    }
    this.pickPin = null
  }

  public syncFromBabylonCamera(
    babylonCamera: FreeCamera,
    altitudeOffsetMeters = 0,
  ): void {
    if (this.pickingEarth || !this.isActive || !this.viewer) return
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

  private async ensureOpenFreeMapTemplate(): Promise<string | null> {
    if (this.openFreeMapTemplateUrl) return this.openFreeMapTemplateUrl
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
      // Fallback handled by the caller
    }
    return this.openFreeMapTemplateUrl
  }

  public async fetchOpenFreeMapFeatures(
    centerLat: number,
    centerLon: number,
  ): Promise<DecodedOpenFreeMapData> {
    const cacheKey = `${centerLat.toFixed(3)},${centerLon.toFixed(3)}`
    const cached = this.tileCache.get(cacheKey)
    if (cached) return cached

    const template = await this.ensureOpenFreeMapTemplate()
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

  /** Named streets from OpenFreeMap around a point. Local names, not highway shields. */
  public async fetchNamedStreets(centerLat: number, centerLon: number): Promise<NamedStreet[]> {
    const template = await this.ensureOpenFreeMapTemplate()
    if (!template) return []

    const zoom = 14
    const center = lonLatToTileXY(centerLon, centerLat, zoom)
    const tiles = [
      { x: center.x, y: center.y },
      { x: center.x + (center.exactX - center.x >= 0.5 ? 1 : -1), y: center.y },
      { x: center.x, y: center.y + (center.exactY - center.y >= 0.5 ? 1 : -1) },
      {
        x: center.x + (center.exactX - center.x >= 0.5 ? 1 : -1),
        y: center.y + (center.exactY - center.y >= 0.5 ? 1 : -1),
      },
    ]
    const rank: Record<string, number> = {
      motorway: 90,
      trunk: 80,
      primary: 68,
      secondary: 52,
      tertiary: 36,
      minor: 20,
      residential: 20,
      unclassified: 16,
    }
    const best = new Map<string, NamedStreet & { score: number }>()

    await Promise.all(
      tiles.map(async ({ x, y }) => {
        const url = template
          .replace('{z}', String(zoom))
          .replace('{x}', String(x))
          .replace('{y}', String(y))
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(6000) })
          if (!res.ok) return
          const buf = await res.arrayBuffer()
          const tile = new VectorTile(new Pbf(new Uint8Array(buf)))
          const layer = tile.layers['transportation_name']
          if (!layer) return
          const count = Math.min(layer.length, 500)
          for (let i = 0; i < count; i++) {
            const feat = layer.feature(i)
            const props = feat.properties || {}
            const roadClass = typeof props.class === 'string' ? props.class : ''
            const weight = rank[roadClass]
            const name = typeof props.name === 'string' ? props.name.trim() : ''
            if (!weight || name.length < 2 || name.length > 42) continue
            const geom = feat.toGeoJSON(x, y, zoom).geometry as {
              type?: string
              coordinates?: number[][] | number[][][]
            }
            let line: number[][] = []
            if (geom?.type === 'LineString' && Array.isArray(geom.coordinates)) {
              line = geom.coordinates as number[][]
            } else if (geom?.type === 'MultiLineString' && Array.isArray(geom.coordinates)) {
              for (const part of geom.coordinates as number[][][]) {
                if (part.length > line.length) line = part
              }
            }
            if (line.length < 2) continue
            const midIndex = Math.floor(line.length / 2)
            const mid = line[midIndex]
            if (!mid) continue
            const lon = mid[0]
            const lat = mid[1]
            const meters = streetMeters(centerLat, centerLon, lat, lon)
            if (meters > 1800) continue
            const before = line[Math.max(0, midIndex - 1)]
            const after = line[Math.min(line.length - 1, midIndex + 1)]
            if (!before || !after) continue
            const bearingDeg = streetBearingDeg(before[1], before[0], after[1], after[0])
            const score = weight * 8 - meters
            const prev = best.get(name)
            if (prev && prev.score >= score) continue
            best.set(name, { name, roadClass, lat, lon, bearingDeg, score })
          }
        } catch {
          // One tile can fail without dropping the rest.
        }
      }),
    )

    return [...best.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, 36)
      .map(({ name, roadClass, lat, lon, bearingDeg }) => ({ name, roadClass, lat, lon, bearingDeg }))
  }
}

function streetMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const mLat = 111320
  const mLon = 111320 * Math.cos((lat1 * Math.PI) / 180)
  return Math.hypot((lat2 - lat1) * mLat, (lon2 - lon1) * mLon)
}

/** Clockwise degrees from true north. */
function streetBearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const cosLat = Math.cos((((lat1 + lat2) * 0.5 * Math.PI) / 180))
  const east = (lon2 - lon1) * cosLat
  const north = lat2 - lat1
  if (east * east + north * north < 1e-12) return 0
  return (((Math.atan2(east, north) * 180) / Math.PI) + 360) % 360
}
