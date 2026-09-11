import type { AuthoredWorldRecord } from '@wilder-future/world-data-engine'
import type { FlightSite } from '../sim/site-data'

const SITE_TERRAIN_CONTEXT: Record<
  string,
  { slopeDeg: number; aspectDeg: number; landCover: string; thermalPotential01: number }
> = {
  lauterbrunnen: {
    slopeDeg: 34,
    aspectDeg: 238,
    landCover: 'alpine-grass-and-rock',
    thermalPotential01: 0.72,
  },
  rome: {
    slopeDeg: 8,
    aspectDeg: 218,
    landCover: 'dense-urban-and-parkland',
    thermalPotential01: 0.58,
  },
  istanbul: {
    slopeDeg: 13,
    aspectDeg: 248,
    landCover: 'urban-coastal-hills',
    thermalPotential01: 0.5,
  },
}

export function createAuthoredWorldRecord(site: FlightSite): AuthoredWorldRecord {
  const context = SITE_TERRAIN_CONTEXT[site.id] ?? {
    slopeDeg: 0,
    aspectDeg: 0,
    landCover: 'unknown',
    thermalPotential01: 0.5,
  }

  return {
    id: `ptw-site-${site.id}-v1`,
    location: {
      latitudeDeg: site.latitude,
      longitudeDeg: site.longitude,
    },
    radiusM: 5_000,
    dataset: 'Paraglide the World authored prototype flight sites',
    attribution: 'Paraglide the World prototype data',
    confidence01: 0.55,
    terrain: {
      elevationMslM: site.launchAltitudeMeters,
      ...context,
    },
    atmosphere: {
      windSpeedMps: site.windSpeedKmh / 3.6,
      windDirectionFromDeg: (site.prevailingWindHeadingDeg + 180) % 360,
      windGustMps: null,
      turbulence01: 0.16,
      temperatureK: null,
      pressurePa: null,
      relativeHumidity01: null,
      precipitationRateMmPerHour: null,
      cloudCover01: null,
    },
  }
}

