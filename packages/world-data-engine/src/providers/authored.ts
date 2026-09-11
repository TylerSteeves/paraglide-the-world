import { deterministicFingerprint } from "../canonical.js";
import type {
  AtmosphereData,
  DomainSnapshot,
  MarineData,
  ProviderResult,
  QualityFlag,
  SourceProvenance,
  TerrainData,
  WorldDataDomain,
  WorldDataQuery,
} from "../contracts.js";
import type { ProviderContext, WorldDataProvider } from "../provider.js";

export interface AuthoredWorldRecord {
  readonly id: string;
  readonly location: { readonly latitudeDeg: number; readonly longitudeDeg: number };
  readonly radiusM?: number;
  readonly dataset?: string;
  readonly attribution: string;
  readonly sourceUrl?: string;
  readonly confidence01?: number;
  readonly terrain?: TerrainData;
  readonly atmosphere?: AtmosphereData;
  readonly marine?: MarineData;
}

export interface AuthoredProviderOptions {
  readonly records: readonly AuthoredWorldRecord[];
}

function distanceM(a: AuthoredWorldRecord["location"], b: WorldDataQuery["location"]): number {
  const toRad = Math.PI / 180;
  const lat1 = a.latitudeDeg * toRad;
  const lat2 = b.latitudeDeg * toRad;
  const dLat = (b.latitudeDeg - a.latitudeDeg) * toRad;
  const dLon = (b.longitudeDeg - a.longitudeDeg) * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function completeness(data: object): number {
  const values = Object.values(data);
  return values.filter((value) => value !== null && value !== undefined).length / Math.max(1, values.length);
}

function authoredDomain<T extends object>(
  data: T,
  sourceId: string,
  requestedAt: string,
  confidence01: number,
): DomainSnapshot<T> {
  const completeness01 = completeness(data);
  const flags: QualityFlag[] = completeness01 < 1 ? ["missing-field"] : [];
  return {
    data,
    time: {
      requestedAt,
      issuedAt: null,
      observedAt: null,
      validFrom: "1970-01-01T00:00:00.000Z",
      validUntil: "9999-12-31T23:59:59.999Z",
      expiresAt: "9999-12-31T23:59:59.999Z",
      nature: "authored",
      contributingNatures: ["authored"],
    },
    sourceIds: [sourceId],
    quality: {
      confidence01,
      completeness01,
      freshness: "authored",
      flags,
      spatialResolutionM: null,
      temporalResolutionSeconds: null,
    },
  };
}

export class AuthoredProvider implements WorldDataProvider {
  readonly id = "authored";
  readonly domains = ["terrain", "atmosphere", "marine"] as const;

  constructor(private readonly options: AuthoredProviderOptions) {}

  async fetch(query: WorldDataQuery, context: ProviderContext): Promise<ProviderResult | null> {
    const match = this.options.records
      .map((record) => ({ record, distance: distanceM(record.location, query.location) }))
      .filter(({ record, distance }) => distance <= (record.radiusM ?? 1_000))
      .sort((a, b) => a.distance - b.distance)[0]?.record;
    if (!match) return null;

    const sourceId = `authored:${match.id}:${deterministicFingerprint(match)}`;
    const source: SourceProvenance = {
      id: sourceId,
      provider: "Authored world data",
      dataset: match.dataset ?? match.id,
      sourceUrl: match.sourceUrl ?? "about:blank",
      attribution: match.attribution,
      license: {
        name: "Project-authored",
        url: match.sourceUrl ?? "about:blank",
        requiresAttribution: true,
      },
      retrievedAt: context.requestedAt,
      modelRunOrVersion: null,
      warnings: ["Authored scenario data is an estimate and must not be used for real-world navigation."],
    };
    const confidence = Math.max(0, Math.min(1, match.confidence01 ?? 0.7));
    const requested = new Set<WorldDataDomain>(query.domains);
    return {
      domains: {
        ...(requested.has("terrain") && match.terrain
          ? { terrain: authoredDomain(match.terrain, sourceId, query.at, confidence) }
          : {}),
        ...(requested.has("atmosphere") && match.atmosphere
          ? { atmosphere: authoredDomain(match.atmosphere, sourceId, query.at, confidence) }
          : {}),
        ...(requested.has("marine") && match.marine
          ? { marine: authoredDomain(match.marine, sourceId, query.at, confidence) }
          : {}),
      },
      sources: [source],
      authoredFallback: true,
    };
  }
}
