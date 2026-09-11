# Hybrid Aircraft Design Stack

This document turns the current concept work into a real engineering program.

The repo already has:

- a first-principles reference geometry in [docs/hybrid-airship-first-principles.md](/Users/tylersteeves/Documents/Coding/App%20Development%20and%20Coding/Paraglide%20the%20World/docs/hybrid-airship-first-principles.md)
- a coarse model generator in [tools/hybrid_airship_model.py](/Users/tylersteeves/Documents/Coding/App%20Development%20and%20Coding/Paraglide%20the%20World/tools/hybrid_airship_model.py)
- a deterministic gameplay flight loop in [apps/web/src/flight/physics.ts](/Users/tylersteeves/Documents/Coding/App%20Development%20and%20Coding/Paraglide%20the%20World/apps/web/src/flight/physics.ts)

What it does not yet have is a real aircraft-design workflow. That is what this stack defines.

## Program Goal

Design a `near-neutral hybrid hydrogen aircraft` with:

- a flexible hydrogen envelope carrying most static weight
- an albatross-style long-span wing carrying the residual cruise lift
- a low-slung keel or pod for stability, payload, and systems
- a deterministic simulation loop that can eventually consume real force and moment data

The design target is not a literally weightless aircraft. It is a controllable hybrid vehicle.

## Team

Split the work into five lanes with clean ownership:

### 1. Geometry And Mass

Owns:

- hull, wing, keel, tail, and control geometry
- reference dimensions and station tables
- mass budget
- CG, CB, and inertia estimates

Primary outputs:

- parameterized geometry
- mass properties by load case
- single source-of-truth vehicle data file

### 2. Atmosphere And Low-Order Aero

Owns:

- standard atmosphere
- wind, shear, and gust field models
- low-order component aero
- trim solutions
- stability derivatives

Primary outputs:

- atmosphere samples
- coefficient tables
- trim tables
- linearized derivative sets

### 3. Dynamics And Control

Owns:

- 6-DOF state and integrator
- force and moment accumulation
- control allocation
- station-keeping and mooring models
- testable deterministic sim interfaces

Primary outputs:

- rigid-body state model
- integrator
- trim solver
- gust and tether dynamics

### 4. Structures And Aeroelasticity

Owns:

- wing bending and torsion
- envelope compliance and pressure-stiffness effects
- keel and hardpoint load paths
- reduced-order flexible-mode models

Primary outputs:

- structural load cases
- reduced-order flexibility model
- deflection and mode-shape data

### 5. Validation And Prototype Instrumentation

Owns:

- staged verification plan
- CFD calibration cases
- scale-model and tether-test instrumentation
- correlation of test data back into the sim

Primary outputs:

- validation matrix
- measured coefficients and corrections
- test-correlated parameter updates

## Modeling Stack

The correct order is:

1. `Hand calculations`
2. `Parameterized geometry`
3. `Low-order aero and trim`
4. `6-DOF simulation`
5. `Selective CFD`
6. `Reduced-order structures and aeroelasticity`
7. `Prototype tests`
8. `Correlation back into the model`

Do not jump straight to CFD. Do not use Blender as the source of engineering truth. Do not extend the existing paraglider sink-rate model into something it is not.

## Minimum Physics We Need

### Atmosphere

At minimum:

- ISA troposphere
- density, pressure, temperature, speed of sound
- wind vector
- vertical shear
- turbulence intensity
- terrain interaction hooks

Reference equations:

- `T = T0 - L h`
- `p = p0 * (T / T0)^(g / (R * L))`
- `rho = p / (R * T)`
- `q = 0.5 * rho * V^2`

### Aerodynamics

Use a component build-up model for:

- wing
- hull
- tail and fins
- control surfaces
- propulsors

Minimum coefficient set:

- `CL0`, `CL_alpha`, `CD0`, `k`
- `Cm0`, `Cm_alpha`, `Cm_q`, `Cm_delta_e`
- `CY_beta`, `Cl_beta`, `Cn_beta`
- `Cl_p`, `Cn_r`
- `Cl_delta_a`, `Cn_delta_r`
- hull weathercock terms
- configuration-dependent control effectiveness

### Buoyancy

Compute separately from the aero coefficients:

- buoyant force from local air density
- gas state effects
- center-of-buoyancy location
- ballonet and ballast state

### Dynamics

The sim needs:

- Earth-fixed local tangent frame
- body frame
- relative-wind frame
- tether or mooring frame for ground operations

Minimum 6-DOF state:

- position
- velocity
- attitude quaternion
- body rates
- mass and inertia
- CG and CB
- propulsion state
- control deflections
- gas and ballonet state

### Structures

Minimum reduced-order flexibility model:

- wing bending
- wing torsion
- envelope breathing or flattening mode
- keel or hardpoint compliance

Do not assume the hydrogen hull is rigid.

## Toolchain

Recommended order on Mac:

### Hand Calcs And Sweeps

- `Python`
- `wolframscript`

Use these for sizing, sensitivities, mass budget, and quick reporting.

### Parametric Geometry

- `OpenVSP` as engineering geometry source
- `Blender` for visualization, inspection, and presentation only

### Low-Order Aero

- `XFOIL` for 2D sections
- `XFLR5` for wing and tail behavior
- `AVL` for trim and stability derivatives
- `VSPAERO` where it adds value

### CFD

- `SU2` first
- `OpenFOAM` later if needed for specific cases

Use CFD only to calibrate uncertainty cases:

- hull-wing interference
- crosswind loads
- control authority in disturbed flow

### Structures

- scripted reduced-order models in `Python`
- `wolframscript` for symbolic and parametric load work
- high-fidelity FEM later if justified

## Repo Architecture Direction

Keep the current deterministic TypeScript sim runtime. Replace the flight core beneath it.

The migration target is:

- `apps/web/src/aircraft/state.ts`
- `apps/web/src/aircraft/atmosphere.ts`
- `apps/web/src/aircraft/forces.ts`
- `apps/web/src/aircraft/buoyancy.ts`
- `apps/web/src/aircraft/integration.ts`
- `apps/web/src/aircraft/trim.ts`
- `apps/web/src/aircraft/gusts.ts`
- `apps/web/src/aircraft/mooring.ts`
- `apps/web/src/aircraft/types.ts`

The current files under `apps/web/src/flight` should remain compatible for the game loop while the real aircraft stack is built beside them.

## Immediate Build Order

This week:

1. Lock the reference vehicle data in a machine-readable file.
2. Add a reproducible sizing sweep script.
3. Add the validation matrix and load cases.

After that:

1. Add a new aircraft data model and atmosphere module.
2. Add a force or moment accumulator.
3. Add a rigid-body state and integrator.
4. Add trim solving and tests.
5. Add mooring and gust response.

## Non-Negotiables

- `Blender is not the authority for engineering coefficients.`
- `CFD is calibration, not the first tool.`
- `The hull is flexible enough that constant coefficients are a lie.`
- `The current paraglider model is a harness, not the final aircraft model.`
- `Mooring and station-keeping are primary design problems, not an afterthought.`
