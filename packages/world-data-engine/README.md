# Wilder Future World Data Engine

`@wilder-future/world-data-engine` resolves real-world data into immutable,
serializable snapshots that simulation code can safely consume. It is shared by
Paraglide the World and the Twin Screw Handling Simulator.

The package normalizes terrain, atmosphere, and marine fields to SI units and
keeps source URL, attribution, licence, warnings, requested/issued/valid/expiry
times, data nature, confidence, completeness, and freshness attached. A
snapshot is data, not an ongoing network connection.

## The simulation boundary

Resolve a snapshot when a site/scenario loads, map it into the simulator's
environment state, and keep that state fixed for the run. Never call a provider
from a physics step, render frame, or deterministic replay loop.

```ts
import {
  CaptureRecorder,
  OpenMeteoProvider,
  WebStorageSnapshotCache,
  createWorldDataEngine,
} from "@wilder-future/world-data-engine";

const engine = createWorldDataEngine({
  providers: [new OpenMeteoProvider()],
  cache: new WebStorageSnapshotCache({ storage: localStorage }),
});
const capture = new CaptureRecorder();

const snapshot = await engine.getSnapshot(
  {
    location: { latitudeDeg: 43.65, longitudeDeg: -79.38 },
    at: new Date().toISOString(),
    domains: ["atmosphere", "marine"],
  },
  { allowStale: true, capture },
);

// Copy once into the app's fixed scenario state.
const windSpeedMps = snapshot.domains.atmosphere?.data.windSpeedMps;
```

Provider order is priority order. A later provider can fill null fields or a
missing domain without replacing values supplied by an earlier provider. The
domain's `sourceIds` and `time.contributingNatures` retain that mixed origin.

## Cache and offline behaviour

- Exact live queries share a documented 15-minute time bucket.
- Successful near-now queries also update a latest-by-location/domain alias.
- That alias supplies last-known-good data across bucket boundaries and browser
  reloads when `WebStorageSnapshotCache` is used.
- Latest aliases are disabled for replay engines and queries more than one hour
  away from the engine clock, so historical requests cannot masquerade as an
  exact match.
- Delivery is labelled `fresh-cache`, `stale-cache`,
  `live-with-stale-fallback`, or an explicit cache-with-authored-fallback mode;
  stale data carries the `stale-data` flag.
- Authored-only results never overwrite the last-known-live alias. If a live
  provider fails, cached live fields remain primary and authored data only fills
  gaps.

Use `MemorySnapshotCache` in tests or environments without Web Storage.

## Deterministic capture and replay

```ts
const json = capture.serialize();
const replayEngine = createWorldDataEngine({
  providers: [new ReplayProvider(parseCaptureLog(json))],
});
const replayed = await replayEngine.getSnapshot(theOriginalQuery);
```

Capture JSON is canonicalized. Snapshot IDs are deterministic content
fingerprints; replay validates each fingerprint before use. The fingerprint is
an integrity/determinism aid, not a cryptographic signature.

## Open-Meteo safety and attribution

The MVP provider is keyless and calls the official Open-Meteo weather,
marine, and elevation APIs directly. Its `current` weather and marine values are
model-derived forecast fields, not station observations. Marine currents and
tides may be absent even when wave data is present; absence remains `null` and
is never converted to zero.

Open-Meteo warns that coastal tide/current accuracy is limited and the data is
not suitable for navigation. The Copernicus GLO-90 elevation is an approximately
90-metre reference grid—not a launch-height, terrain-clearance, obstacle, or
navigation authority. Products must display the attribution and preserve the
warnings included in each snapshot's `sources`.

- [Open-Meteo weather API](https://open-meteo.com/en/docs)
- [Open-Meteo marine API](https://open-meteo.com/en/docs/marine-weather-api)
- [Open-Meteo elevation API](https://open-meteo.com/en/docs/elevation-api)

## Packaging and portability

The source currently lives at `packages/world-data-engine` in the Paraglide
workspace. Paraglide consumes it as `workspace:*`. Twin Screw's `file:`
dependency is a local-development link only; app source still imports the
package name and contains no absolute paths. The portability milestone is a
versioned npm or Git release of `@wilder-future/world-data-engine`, after which
both builds pin the same published version.

Build and test with Node 24:

```sh
pnpm --filter @wilder-future/world-data-engine test
pnpm --filter @wilder-future/world-data-engine build
```
