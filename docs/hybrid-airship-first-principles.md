# Hybrid Airship First-Principles Reference

This is the first coherent geometry for the albatross-inspired hybrid hydrogen vehicle discussed in this workspace. It is not a final aircraft design. It is a disciplined starting point that keeps the buoyancy, wing loading, and stability assumptions internally consistent.

## Why This Is A Hybrid

The cleanest answer from first principles is not "make the aircraft exactly weightless."

Exact `100%` neutral buoyancy is a bad operating point because it leaves no control margin for:

- gas temperature change
- pressure change with altitude
- leakage
- payload variation
- rain, icing, or dirt accumulation
- loading and unloading on the ground

The better target is a `near-neutral hybrid`:

- hydrogen hull carries `70-85%` of gross weight in cruise
- wing carries `15-30%` of gross weight in cruise
- the aircraft remains slightly heavy so the wing still matters

That gives controllable trim authority instead of a drifting balloon with wings.

## Recommended Reference Geometry

### Buoyant Body

Use a near-axisymmetric `prolate body` rather than a torus or a true lifting-body.

Recommended target:

- volume: `45,000 m^3`
- fineness ratio `L/D`: `4.7`
- length: `123.8 m`
- max diameter: `26.35 m`
- max radius: `13.17 m`
- approximate envelope area: `~8,000 m^2`

Why this shape:

- low nose-on drag for a flexible envelope
- smooth membrane tension paths
- simple load path into a keel or wing carry-through structure
- less wake penalty than ring or blunt-body concepts

### Wing

The wing is modeled after the engineering logic of an albatross rather than the literal bird shape, but it is now treated as a `membrane gas-cell wing` instead of a thin rigid airfoil.

Recommended target:

- aspect ratio: `15`
- span: `72.5 m`
- planform area: `350 m^2`
- taper ratio: `0.32`
- root chord: `7.3 m`
- tip chord: `2.34 m`
- quarter-chord sweep: `12 deg`
- dihedral: `3.5 deg`
- washout at tip: `-2.6 deg`

Gas-cell membrane section targets:

- root thickness ratio: `40%`
- mid thickness ratio: `30%`
- tip thickness ratio: `22%`
- root camber ratio: `8%`
- mid camber ratio: `6%`
- tip camber ratio: `4%`

This makes the wing visibly thicker and more organic than a conventional sailplane wing. That extra volume is useful, but the numbers matter:

- estimated hydrogen volume in the wing: `~455 m^3`
- net static lift from wing gas at sea level: `~517 kg`
- hydrogen mass stored in wing cells: `~40.9 kg`
- chemical energy in that hydrogen: `~1.36 MWh` lower heating value

So the gas-filled wing is worth doing, but for the right reason:

- it can make the wing closer to self-buoyant
- it can help pay for the heavier membrane and internal structure
- it can carry a meaningful hydrogen reserve

It does `not` replace the main hull as the primary buoyant volume.

## Core Equations

### Hydrogen Lift

At sea level:

`rho_air - rho_H2 ~= 1.135 kg/m^3`

So buoyant support is:

`lift_kg ~= 1.135 * volume_m3`

For `45,000 m^3`:

`lift ~= 51,100 kg`

### Wing Lift

`L = 0.5 * rho * V^2 * S * CL`

For this vehicle class, the wing should not carry the full aircraft like a conventional airplane. It should carry the residual weight after buoyancy, plus provide trim and maneuver margin.

### Wing Gas Buoyancy

For the gas-cell wing:

`wing_gas_lift_kg ~= (rho_air - rho_H2) * wing_gas_volume_m3`

The important consequence is that using the wing hydrogen as fuel changes the buoyancy state. Burning all of the wing-cell hydrogen would remove on the order of `600+ kg` of static lift. That makes wing gas useful as reserve fuel or trim-sensitive fuel, but not something to treat casually as a free tank.

### Wing Geometry

`AR = b^2 / S`

`S = b * (c_root + c_tip) / 2`

`lambda = c_tip / c_root`

These give the chosen reference planform.

## Stability Implications

Bird-style stability maps to `decoupling`, not to making the whole hull rigid.

The useful architecture is:

- outer hull allowed to weathercock and absorb gusts
- low-slung keel for passive pendulum stability
- isolated cargo or passenger pod under the hull
- distributed thrust for active damping
- active mooring as a primary system

What a gyro can do:

- resist rapid attitude changes
- damp transients

What a gyro cannot do:

- cancel steady wind loads
- hold the whole ship still indefinitely

## Shape Decision

If the hydrogen-filled structure must remain flexible, then the aerodynamic shape should stay close to a smooth convex body.

That rules out:

- torus bodies
- sharp-edged lifting bodies
- highly cambered membrane hulls that require rigid shape control

The best practical answer is:

- a near-prolate hydrogen envelope for buoyancy
- a long-span thick membrane wing for efficient residual lift plus modest self-buoyancy
- a separate keel and pod for controllability and passenger or cargo comfort

## Model Artifact

The reference mesh generator lives at:

- [tools/hybrid_airship_model.py](/Users/tylersteeves/Documents/Coding/App%20Development%20and%20Coding/Paraglide%20the%20World/tools/hybrid_airship_model.py)

Run it with:

```bash
python3 tools/hybrid_airship_model.py
```

By default it writes:

- [generated/hybrid_airship_reference.obj](/Users/tylersteeves/Documents/Coding/App%20Development%20and%20Coding/Paraglide%20the%20World/generated/hybrid_airship_reference.obj)
