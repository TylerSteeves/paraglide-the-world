# Hybrid Airship Validation Matrix

This matrix defines what must be proven, in what order, and what artifacts each stage must produce.

## Stage 0: Reference Lock

Inputs:

- [docs/hybrid-airship-first-principles.md](/Users/tylersteeves/Documents/Coding/App%20Development%20and%20Coding/Paraglide%20the%20World/docs/hybrid-airship-first-principles.md)
- [data/hybrid_airship_reference.yaml](/Users/tylersteeves/Documents/Coding/App%20Development%20and%20Coding/Paraglide%20the%20World/data/hybrid_airship_reference.yaml)

Outputs:

- locked geometry dimensions
- locked wing reference dimensions
- locked target mass cases

Pass criteria:

- one agreed source of truth for reference geometry and atmosphere assumptions
- all downstream tools use the same vehicle data

## Stage 1: Hand Calculations

Questions:

- Is the buoyancy margin internally consistent?
- Does the wing carry a realistic residual lift fraction?
- Are Reynolds and Mach numbers in a sane regime?

Outputs:

- buoyancy table versus altitude
- dynamic pressure table versus speed
- wing loading table
- basic trim targets

Pass criteria:

- no contradictory assumptions in weight, volume, or cruise speed
- a single working design point exists

## Stage 2: Parametric Geometry

Questions:

- Is the geometry watertight and parameterized?
- Are reference area, span, mean chord, and station locations reproducible?

Outputs:

- editable geometry model
- station table
- exported surfaces for aero tools

Pass criteria:

- geometry is reproducible from parameters
- exported geometry preserves reference dimensions

## Stage 3: Low-Order Aero

Questions:

- Does the vehicle trim in cruise, climb, turn, and station-keeping conditions?
- Are the derivative signs physically reasonable?

Outputs:

- coefficient tables over `alpha`, `beta`, and control deflection
- trim solutions
- linearized derivative sets

Pass criteria:

- trim converges in target operating points
- derivative signs are physically consistent
- no obvious static-stability contradiction is present

## Stage 4: 6-DOF Simulation

Questions:

- Can the vehicle be simulated deterministically from forces and moments?
- Does the response stay numerically stable under nominal control inputs?

Outputs:

- rigid-body integrator
- force and moment accumulator
- deterministic regression tests

Pass criteria:

- identical inputs reproduce identical trajectories
- state integration remains stable across tested cases

## Stage 5: Wind And Ground Operations

Questions:

- Can the vehicle station-keep in wind?
- Do mooring loads and attitude responses remain inside design targets?

Outputs:

- gust model
- shear model
- mooring or tether model
- station-keeping trim cases

Pass criteria:

- wind loads are bounded and explainable
- control and mooring authority are sufficient for target scenarios

## Stage 6: Structures And Aeroelasticity

Questions:

- Does the long wing remain within acceptable deflection and twist?
- Does the flexible hull distort enough to invalidate low-order coefficients?

Outputs:

- reduced-order structural model
- deformation estimates
- mode-shape summary

Pass criteria:

- no unacceptable mode coupling in target envelope
- aero model is corrected where flexibility changes the coefficients materially

## Stage 7: Selective CFD

Questions:

- What uncertainty remains around hull-wing interference, crosswind loads, and control authority?

Outputs:

- corrected coefficient deltas
- pressure and load maps for calibration cases

Pass criteria:

- CFD reduces uncertainty on named cases
- CFD results are fed back into the low-order model

## Stage 8: Physical Tests

Questions:

- Does a subscale or tethered prototype follow the same trends as the simulation?

Outputs:

- logged flight or tether data
- correlated coefficients
- updated mass, drag, and control effectiveness estimates

Pass criteria:

- measured trends match model directionally
- discrepancies are traceable and corrected

## Core Load Cases

These cases must exist across the analysis stack:

- steady cruise
- climb
- descent
- coordinated turn
- crosswind station-keeping
- moored gust response
- loading or unloading with tether restraints
- asymmetric payload
- reduced envelope pressure

## Required Artifacts

Every stage should produce machine-consumable outputs where possible:

- reference data file
- coefficient tables
- trim tables
- test logs
- load-case definitions

Human-readable reports are useful, but they are not enough by themselves.
