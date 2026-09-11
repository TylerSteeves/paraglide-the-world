import {
  deepFreeze,
  fingerprintSnapshot,
  latestLocationCacheKey,
  queryCacheKey,
} from "./canonical.js";
import type { SnapshotCache } from "./cache.js";
import { MemorySnapshotCache } from "./cache.js";
import {
  WORLD_DATA_SCHEMA_VERSION,
  WORLD_DATA_UNITS,
  type DataNature,
  type DeliveryMode,
  type DomainSnapshot,
  type Freshness,
  type ProviderResult,
  type QualityFlag,
  type SnapshotQuality,
  type SourceProvenance,
  type WorldDataDomain,
  type WorldDataDomains,
  type WorldDataQuery,
  type WorldDataSnapshot,
} from "./contracts.js";
import type { WorldDataProvider } from "./provider.js";
import { assertWorldDataQuery } from "./validation.js";

export interface WorldDataEngineOptions {
  readonly providers: readonly WorldDataProvider[];
  readonly cache?: SnapshotCache;
  readonly clock?: () => Date;
}

export interface GetSnapshotOptions {
  readonly allowStale?: boolean;
  readonly forceRefresh?: boolean;
  readonly preferCache?: boolean;
  readonly signal?: AbortSignal;
  readonly capture?: { record(query: WorldDataQuery, snapshot: WorldDataSnapshot): void };
}

export interface WorldDataEngine {
  getSnapshot(query: WorldDataQuery, options?: GetSnapshotOptions): Promise<WorldDataSnapshot>;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function domainCompleteness(domain: DomainSnapshot<unknown>): number {
  const data = domain.data as Record<string, unknown>;
  const values = Object.values(data);
  if (values.length === 0) return 0;
  return values.filter((value) => value !== null && value !== undefined).length / values.length;
}

function domainNeedsMore(domain: DomainSnapshot<unknown> | undefined): boolean {
  return domain === undefined || domainCompleteness(domain) < 1;
}

function mergeDomain<T>(
  primary: DomainSnapshot<T> | undefined,
  supplement: DomainSnapshot<T> | undefined,
): DomainSnapshot<T> | undefined {
  if (!primary) return supplement;
  if (!supplement) return primary;

  const primaryData = primary.data as Record<string, unknown>;
  const supplementData = supplement.data as Record<string, unknown>;
  let supplemented = false;
  const data: Record<string, unknown> = { ...primaryData };
  for (const [key, value] of Object.entries(supplementData)) {
    if ((data[key] === null || data[key] === undefined) && value !== null && value !== undefined) {
      data[key] = value;
      supplemented = true;
    }
  }
  if (!supplemented) return primary;

  const completeness01 = Object.values(data).filter((value) => value !== null && value !== undefined).length /
    Math.max(1, Object.keys(data).length);
  const flags = unique([...primary.quality.flags, ...supplement.quality.flags]).filter(
    (flag) => flag !== "missing-field" || completeness01 < 1,
  );
  const contributingNatures = unique<DataNature>([
    ...primary.time.contributingNatures,
    ...supplement.time.contributingNatures,
  ]);

  return {
    data: data as T,
    time: {
      ...primary.time,
      contributingNatures,
    },
    sourceIds: unique([...primary.sourceIds, ...supplement.sourceIds]),
    quality: {
      ...primary.quality,
      confidence01: Math.min(primary.quality.confidence01, supplement.quality.confidence01),
      completeness01,
      flags,
      spatialResolutionM:
        primary.quality.spatialResolutionM ?? supplement.quality.spatialResolutionM,
      temporalResolutionSeconds:
        primary.quality.temporalResolutionSeconds ?? supplement.quality.temporalResolutionSeconds,
    },
  };
}

function mergeDomains(primary: WorldDataDomains, supplement: WorldDataDomains): WorldDataDomains {
  return {
    ...(primary.terrain || supplement.terrain
      ? { terrain: mergeDomain(primary.terrain, supplement.terrain)! }
      : {}),
    ...(primary.atmosphere || supplement.atmosphere
      ? { atmosphere: mergeDomain(primary.atmosphere, supplement.atmosphere)! }
      : {}),
    ...(primary.marine || supplement.marine
      ? { marine: mergeDomain(primary.marine, supplement.marine)! }
      : {}),
  };
}

function markDomainsFromCache(domains: WorldDataDomains, freshness: Freshness): WorldDataDomains {
  const mark = <T>(domain: DomainSnapshot<T> | undefined): DomainSnapshot<T> | undefined => {
    if (!domain) return undefined;
    return {
      ...domain,
      quality: {
        ...domain.quality,
        freshness,
        flags: unique([
          ...domain.quality.flags,
          ...(freshness === "stale" || freshness === "expired"
            ? (["stale-data"] as const)
            : []),
        ]),
      },
    };
  };
  const terrain = mark(domains.terrain);
  const atmosphere = mark(domains.atmosphere);
  const marine = mark(domains.marine);
  return {
    ...(terrain ? { terrain } : {}),
    ...(atmosphere ? { atmosphere } : {}),
    ...(marine ? { marine } : {}),
  };
}

function getDomain(domains: WorldDataDomains, domain: WorldDataDomain): DomainSnapshot<unknown> | undefined {
  return domains[domain];
}

function resultHasNonAuthoredData(result: ProviderResult): boolean {
  return [result.domains.terrain, result.domains.atmosphere, result.domains.marine].some(
    (domain) => domain?.time.contributingNatures.some((nature) => nature !== "authored") === true,
  );
}

function snapshotExpiryMs(snapshot: WorldDataSnapshot): number {
  const expiries = snapshot.query.domains
    .map((domain) => getDomain(snapshot.domains, domain))
    .filter((domain): domain is DomainSnapshot<unknown> => domain !== undefined)
    .map((domain) => Date.parse(domain.time.expiresAt));
  return expiries.length > 0 ? Math.min(...expiries) : Date.parse(snapshot.capturedAt);
}

function referencedSources(domains: WorldDataDomains, sources: readonly SourceProvenance[]): SourceProvenance[] {
  const ids = new Set<string>();
  for (const domain of [domains.terrain, domains.atmosphere, domains.marine]) {
    domain?.sourceIds.forEach((id) => ids.add(id));
  }
  const byId = new Map(sources.map((source) => [source.id, source]));
  return [...ids].sort().flatMap((id) => {
    const source = byId.get(id);
    return source ? [source] : [];
  });
}

function buildQuality(
  query: WorldDataQuery,
  domains: WorldDataDomains,
  extraFlags: readonly QualityFlag[],
): SnapshotQuality {
  const missingDomains = query.domains.filter((domain) => !getDomain(domains, domain));
  const present = query.domains
    .map((domain) => getDomain(domains, domain))
    .filter((domain): domain is DomainSnapshot<unknown> => domain !== undefined);
  const confidence01 = present.length > 0
    ? present.reduce((total, domain) => total + domain.quality.confidence01, 0) / present.length
    : 0;
  const flags = unique([
    ...present.flatMap((domain) => domain.quality.flags),
    ...extraFlags,
    ...(missingDomains.length > 0 ? (["missing-domain"] as const) : []),
  ]);
  return { confidence01, missingDomains, flags };
}

function finalizeSnapshot(input: {
  readonly query: WorldDataQuery;
  readonly capturedAt: string;
  readonly domains: WorldDataDomains;
  readonly sources: readonly SourceProvenance[];
  readonly mode: DeliveryMode;
  readonly resolvedAt: string;
  readonly ageSeconds: number;
  readonly cacheKey: string;
  readonly extraFlags?: readonly QualityFlag[];
}): WorldDataSnapshot {
  const base: Omit<WorldDataSnapshot, "id" | "deterministicFingerprint"> = {
    schemaVersion: WORLD_DATA_SCHEMA_VERSION,
    query: input.query,
    capturedAt: input.capturedAt,
    domains: input.domains,
    sources: referencedSources(input.domains, input.sources),
    units: WORLD_DATA_UNITS,
    quality: buildQuality(input.query, input.domains, input.extraFlags ?? []),
    delivery: {
      mode: input.mode,
      resolvedAt: input.resolvedAt,
      ageSeconds: Math.max(0, input.ageSeconds),
      cacheKey: input.cacheKey,
    },
  };
  const fingerprint = fingerprintSnapshot(base);
  return deepFreeze({
    ...base,
    id: `wds_${fingerprint}`,
    deterministicFingerprint: fingerprint,
  });
}

function redispatchCached(
  snapshot: WorldDataSnapshot,
  query: WorldDataQuery,
  mode: "fresh-cache" | "stale-cache",
  now: Date,
  cacheKey: string,
): WorldDataSnapshot {
  return finalizeSnapshot({
    query,
    capturedAt: snapshot.capturedAt,
    domains: markDomainsFromCache(snapshot.domains, mode === "stale-cache" ? "stale" : "fresh"),
    sources: snapshot.sources,
    mode,
    resolvedAt: now.toISOString(),
    ageSeconds: (now.getTime() - Date.parse(snapshot.capturedAt)) / 1000,
    cacheKey,
    ...(mode === "stale-cache" ? { extraFlags: ["stale-data"] } : {}),
  });
}

export function createWorldDataEngine(options: WorldDataEngineOptions): WorldDataEngine {
  if (options.providers.length === 0) throw new RangeError("At least one provider is required");
  const cache = options.cache ?? new MemorySnapshotCache();
  const clock = options.clock ?? (() => new Date());

  return {
    async getSnapshot(query, requestOptions = {}) {
      assertWorldDataQuery(query);
      const cacheKey = queryCacheKey(query);
      const now = clock();
      const cached = await cache.get(cacheKey);
      const latestEligible =
        !options.providers.some((provider) => provider.id === "replay") &&
        Math.abs(Date.parse(query.at) - now.getTime()) <= 60 * 60 * 1_000;
      const latestCached = !cached && latestEligible
        ? await cache.get(latestLocationCacheKey(query))
        : null;
      const fallbackCached = cached ?? latestCached;
      const preferCache = requestOptions.preferCache ?? true;

      if (cached && preferCache && !requestOptions.forceRefresh && snapshotExpiryMs(cached) > now.getTime()) {
        const snapshot = redispatchCached(cached, query, "fresh-cache", now, cacheKey);
        requestOptions.capture?.record(query, snapshot);
        return snapshot;
      }

      let domains: WorldDataDomains = {};
      let sources: SourceProvenance[] = [];
      let providerFailed = false;
      let usedAuthoredFallback = false;
      let hasNonAuthoredContribution = false;

      for (const provider of options.providers) {
        const neededDomains = query.domains.filter(
          (domain) => provider.domains.includes(domain) && domainNeedsMore(getDomain(domains, domain)),
        );
        if (neededDomains.length === 0) continue;
        if (requestOptions.signal?.aborted) throw new DOMException("World data request aborted", "AbortError");
        const providerQuery: WorldDataQuery = { ...query, domains: neededDomains };
        try {
          const context = requestOptions.signal
            ? { requestedAt: now.toISOString(), signal: requestOptions.signal }
            : { requestedAt: now.toISOString() };
          const result: ProviderResult | null = await provider.fetch(providerQuery, context);
          if (!result) continue;
          if (result.replaySnapshot) {
            const replay = result.replaySnapshot;
            requestOptions.capture?.record(query, replay);
            return replay;
          }
          domains = mergeDomains(domains, result.domains);
          sources = [...sources, ...result.sources];
          usedAuthoredFallback ||= result.authoredFallback === true;
          hasNonAuthoredContribution ||= resultHasNonAuthoredData(result);
        } catch (error) {
          if (requestOptions.signal?.aborted) throw error;
          providerFailed = true;
        }
      }

      const hasProviderData = query.domains.some((domain) => getDomain(domains, domain));
      if (!hasProviderData && fallbackCached && (requestOptions.allowStale ?? true)) {
        const cacheMode = snapshotExpiryMs(fallbackCached) > now.getTime() ? "fresh-cache" : "stale-cache";
        const fallback = redispatchCached(fallbackCached, query, cacheMode, now, cacheKey);
        requestOptions.capture?.record(query, fallback);
        return fallback;
      }

      let usedCachedSupplement = false;
      let cachedSupplementIsStale = false;
      if (hasProviderData && fallbackCached && (requestOptions.allowStale ?? true)) {
        cachedSupplementIsStale = snapshotExpiryMs(fallbackCached) <= now.getTime();
        const before = JSON.stringify(domains);
        // If only authored providers survived, last-known-live data remains
        // authoritative and authored values fill only its gaps.
        const cachedDomains = markDomainsFromCache(
          fallbackCached.domains,
          cachedSupplementIsStale ? "stale" : "fresh",
        );
        domains = usedAuthoredFallback && !hasNonAuthoredContribution
          ? mergeDomains(cachedDomains, domains)
          : mergeDomains(domains, cachedDomains);
        sources = [...sources, ...fallbackCached.sources];
        usedCachedSupplement = JSON.stringify(domains) !== before;
      }
      const hasAnyDomain = query.domains.some((domain) => getDomain(domains, domain));
      if (!hasAnyDomain) {
        throw new Error(`No provider returned data for ${query.domains.join(", ")}`);
      }

      const mode: DeliveryMode = usedAuthoredFallback && usedCachedSupplement && !hasNonAuthoredContribution
        ? cachedSupplementIsStale
          ? "stale-cache-with-authored-fallback"
          : "fresh-cache-with-authored-fallback"
        : usedAuthoredFallback
          ? "authored-fallback"
        : usedCachedSupplement
          ? "live-with-stale-fallback"
          : "live";
      const snapshot = finalizeSnapshot({
        query,
        capturedAt: now.toISOString(),
        domains,
        sources,
        mode,
        resolvedAt: now.toISOString(),
        ageSeconds: 0,
        cacheKey,
        ...(providerFailed || usedCachedSupplement
          ? { extraFlags: unique<QualityFlag>([
              ...(providerFailed ? (["provider-error"] as const) : []),
              ...(usedCachedSupplement ? (["stale-data"] as const) : []),
            ]) }
          : {}),
      });
      await cache.set(cacheKey, snapshot);
      // Authored-only results must never displace the last known live/mixed alias.
      if (latestEligible && hasNonAuthoredContribution) {
        await cache.set(latestLocationCacheKey(query), snapshot);
      }
      requestOptions.capture?.record(query, snapshot);
      return snapshot;
    },
  };
}

export const __private__ = { domainCompleteness, mergeDomains };
