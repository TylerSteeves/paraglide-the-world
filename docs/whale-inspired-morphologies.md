# Whale-Inspired Morphologies

This is a morphology study for increasing `wing-contained lift gas` without destroying the wing.

One correction is important at the outset:

- `surface area` does not create buoyancy
- `gas volume` creates buoyancy
- extra surface mostly adds drag, membrane mass, and structural complexity

So the real goal is:

- maximize `gas volume in the lifting surfaces`
- while keeping a useful `aspect ratio`, controllable trim behavior, and reasonable drag

## Whale Lessons Worth Keeping

Whales are not literal templates for aircraft wings, but they do offer useful morphological ideas:

- `deep torso`: high central volume without a sharp step change
- `shoulders`: strong root blending from body into fin
- `tapered peduncle`: clean narrowing aft to reduce bad interference
- `humpback flipper tubercles`: potentially useful for inner-wing high-lift behavior, but not the whole wing

The useful translation is:

- copy the `body-to-wing blending`
- do not copy the exact `short, low-aspect-ratio flipper`

## Candidate Morphologies

Using the current `72.5 m` span envelope width as a common basis, the candidate wing morphologies come out roughly like this:

| Morphology | Wing Area | Aspect Ratio | Wing Gas Volume | Extra Static Lift |
| --- | ---: | ---: | ---: | ---: |
| Baseline gas wing | `350 m^2` | `15.02` | `455 m^3` | `517 kg` |
| Humpback shoulder blend | `497 m^2` | `10.57` | `1,329 m^3` | `1,509 kg` |
| Bowhead blended centerbody | `655 m^2` | `8.03` | `2,903 m^3` | `3,295 kg` |
| Manta-whale blended body | `809 m^2` | `6.50` | `5,012 m^3` | `5,690 kg` |

These are first-order geometry comparisons, not final CFD results.

## Interpretation

### 1. Baseline Gas Wing

Best for:

- cruise efficiency
- high aspect ratio
- simplest aero model

Weakness:

- only modest wing-contained buoyancy

This is still the cleanest aircraft wing, but it does not move the buoyancy needle much.

### 2. Humpback Shoulder Blend

Best for:

- strong increase in wing gas volume
- still respectable aspect ratio
- whale-like body-to-wing blending

Weakness:

- more wetted area
- more interference complexity at the root
- more structural volume to stabilize

This is the best compromise if the goal is:

- clearly whale-inspired morphology
- substantially more gas in the lifting surfaces
- without collapsing the aircraft into a low-AR lifting body

### 3. Bowhead Blended Centerbody

Best for:

- much more gas volume
- large buoyant center section

Weakness:

- aspect ratio drops sharply
- more drag and crosswind sensitivity
- more likely to behave like a buoyant lifting body than a clean winged aircraft

This starts to become a different class of vehicle.

### 4. Manta-Whale Blended Body

Best for:

- maximum wing-body gas volume
- strongest visual biomimicry

Weakness:

- aspect ratio degrades too far for the current mission
- strong control and interference penalties
- likely worse gust and mooring behavior

This is attractive if the goal is “living aircraft sculpture.” It is not the best compromise for cargo and controlled flight.

## Recommendation

The best next morphology is the `humpback shoulder blend`.

Why:

- around `3x` the gas volume of the current gas-cell wing
- still around `AR 10.6`, which is far more believable than the broader blended-body options
- aligns with the whale idea in the right place: `deep shoulders and blended roots`

So the design direction should be:

- keep the main prolate hull
- broaden and deepen the inner wing root like a humpback shoulder
- keep the outer wing tapered and cleaner, more bird-like
- optionally experiment with small inner-wing tubercles later for low-speed handling

That gives a real hybrid morphology:

- `whale torso`
- `humpback shoulder roots`
- `albatross outer wing`

## Artifacts

The comparison script is here:

- [tools/hybrid_airship_morphology_compare.py](/Users/tylersteeves/Documents/Coding/App%20Development%20and%20Coding/Paraglide%20the%20World/tools/hybrid_airship_morphology_compare.py)

It writes:

- [generated/hybrid_airship_morphologies.csv](/Users/tylersteeves/Documents/Coding/App%20Development%20and%20Coding/Paraglide%20the%20World/generated/hybrid_airship_morphologies.csv)

The geometry generator now supports:

- `baseline`
- `humpback`
- `bowhead`
- `manta`

Example:

```bash
python3 tools/hybrid_airship_model.py --variant humpback --out generated/hybrid_airship_humpback.obj
```
