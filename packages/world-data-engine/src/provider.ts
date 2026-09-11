import type {
  ProviderResult,
  WorldDataDomain,
  WorldDataQuery,
} from "./contracts.js";

export interface ProviderContext {
  readonly requestedAt: string;
  readonly signal?: AbortSignal;
}

export interface WorldDataProvider {
  readonly id: string;
  readonly domains: readonly WorldDataDomain[];
  fetch(query: WorldDataQuery, context: ProviderContext): Promise<ProviderResult | null>;
}

export interface FetchResponseLike {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

export type FetchLike = (
  input: string,
  init?: { readonly signal?: AbortSignal },
) => Promise<FetchResponseLike>;

export class ProviderError extends Error {
  constructor(
    readonly providerId: string,
    message: string,
    readonly cause?: unknown,
  ) {
    super(`${providerId}: ${message}`);
    this.name = "ProviderError";
  }
}
