# Flight dynamics: targets, sources and limitations

The flight model is checked against published certification and test data
rather than against itself. This document lists what it is held to, where those
numbers come from, and what it does not reproduce.

Run the suite with no build step and no dependencies:

```bash
cd apps/web && node src/physics/validate-flight-model.ts
```

It exits non-zero on any failure, so it works as a CI gate. It flies the real
simulation — the same code the game runs — through each manoeuvre and reads the
result.

## How the model is put together

`src/physics/flight-dynamics.ts` integrates two rigid bodies, a canopy and a
pilot, joined by risers. `src/physics/aerodynamics.ts` evaluates the canopy as
eight spanwise panels, each with its own angle of attack, so roll, pitch and yaw
damping fall out of the geometry instead of being added as coefficients.

Nothing looks up an airspeed, a sink rate, a bank angle or a turn rate from a
control position. The polar, the turn performance, the stall and the energy
exchange are all consequences of the forces.

Three couplings stand in for the line set:

- **Two riser groups**, modelled as stiff elastic ties of about 20 kN/m, which
  is what a 7 m Dyneema line set works out to. They pull and never push, so the
  lines genuinely go slack at low G.
- **A pitch truss**, standing in for the A, C and D line rows holding the canopy
  at a fixed incidence to the risers. Speed bar shortens the A rows and rotates
  the wing nose-down; rear riser input does the reverse.
- **A torsional spring** about the riser axis, which is what resists riser
  twist.

## What is calibrated, and what is left free

Exactly one number per wing is fitted: the **rigging incidence**, solved so the
model settles at the wing's published trim speed. On a real wing that angle is
set by the relative lengths of the line rows, and trim speed follows from it.

Everything else is left free and then checked: sink rate, glide ratio, the whole
shape of the polar, the response to bar and brake, turn performance, load
factors, stall behaviour, descent techniques. Those are predictions, not
settings.

Projected area and span are also derived rather than declared — they come out of
the canopy's arc — and the suite checks them against the real wing's spec sheet.

## Performance targets

### EN-B cross-country wing, 24 m² flat, 100 kg all-up

| Quantity | Target | Source |
| --- | --- | --- |
| Trim airspeed | 36–42 km/h | mainstream EN-B spec sheets |
| Trim sink | 0.95–1.35 m/s | as above |
| Glide ratio at trim | 8.3–10.2 : 1 | as above |
| Minimum sink | 0.85–1.25 m/s at 28–36 km/h | as above |
| Best glide at trim, brakes off | — | [DHV MAESTRO 2 test manual](https://service.dhv.de/dbfiles/managed/pruefung/2022/09/maestro_2_manual_eng.pdf) |
| Full speed bar | 48–58 km/h at 2.1–3.6 m/s | mainstream EN-B spec sheets |
| Slowest controllable flight | 22–33 km/h | as above |
| Full-stall descent | 5–14 m/s | [El Speedo manual](https://elspeedo.cz/en/?p=46563) gives 8–10 m/s |
| B-line stall descent | 5–11 m/s | [DHV safety-class reports](https://service.dhv.de/db3/muster/safetyclass/id/-2798?lang=en): 8–10 m/s (AIRDESIGN Rise II M), 6–8 m/s (OZONE BuzzZ5, PHI Tenor) |
| Big ears, unaccelerated | 2.0–4.6 m/s | DHV reports: 2.5–3 m/s typical, 3.5–4 m/s on some wings |
| Big ears, accelerated | faster than unaccelerated | DHV reports: 3–4.5 m/s |
| Spiral load factor | 2.0–5.5 g | [Dutch KNVvL study](https://xcmag.com/news/investigation-into-g-forces-during-paraglider-spirals/): 3.2 g measured; DHV bands 3.5–4.5 g, extreme >5 g |
| Spiral descent | 7–24 m/s | same sources: 12 m/s measured, DHV bands <18, <22, >25 m/s |

A note on a polar worth comparing against: Ulf Arndt's
[Best Glide](https://t3d2.sourceforge.net/Applets/BestGlide/BestGlide.html)
worked example uses minimum speed 22 km/h at 1.7 m/s, minimum sink 1.15 m/s at
30 km/h, best glide 1.29 m/s at 35 km/h and a top speed of 50 km/h at 2.9 m/s.
That is a lower-performance wing than the one modelled here (about 7.5 : 1), but
the shape of the curve is the same.

### Miniwing, 14 m² flat

Speeds follow the published
[SuSi 2](https://www.southernskies.net/info/more-information/140-susi-2)
figures: size 14 at 105 kg take-off weight trims at 51 km/h with a 66 km/h top
speed. Steeper dives exceed that, because they trade height for speed rather
than reading off a scripted maximum.

### Reflex paramotor wing, 18 m² flat

Trim near 50 km/h, glide around 7 : 1, 1.5–7 m/s climb at full power with the
trimmers out, and level flight available at part throttle.

## Relationships the model is held to

These are checked as relationships rather than as single numbers, which is a
stronger test of the physics:

- **Wing loading.** Speeds scale with the square root of all-up weight, and
  glide ratio barely changes. A heavier pilot on the same wing flies faster,
  because the rigging is a property of the wing and is not re-trimmed per pilot.
- **Turns.** Load factor follows 1/cos(bank); sink grows as cos(bank)^-1.5; turn
  rate matches g·tan(bank)/V. All three within tolerance across a range of bank
  angles.
- **Energy.** Diving converts height into speed, pulling up converts it back,
  and total energy never increases in still air.
- **Pitch.** Braking pitches the canopy back behind the pilot; releasing makes
  it surge forward and overshoot trim speed; the oscillation damps out.
- **Frame rate.** Results are independent of frame rate from 30 to 144 fps, and
  identical inputs give bit-identical results.
- **Robustness.** Violent and contradictory inputs in rough air never produce a
  non-finite number, and the pilot never leaves the lines.

Measurements of the polar are taken as **equivalent airspeed**, corrected to
sea-level density, because that is how a polar is quoted and what an airspeed
indicator reads. The model reproduces the altitude effect: the same wing trims
faster in thinner air.

## Known limitations

These are places the model knowingly departs from reality.

- **No true spin.** Deep brake on one side rolls and yaws the wing hard toward
  that side and winds into a steep, high-sink turn, which is what a real wing
  does from trim. A negative spin — one wing stalled while the other flies,
  rotating about the pilot — is not reproduced. It would need the canopy's
  spanwise shape to deform, which a rigid-body canopy cannot do.

- **Stall recovery is assisted.** A full stall descends at the right rate and
  needs a positive action to leave, which is correct. But the model settles into
  a parachutal descent that is a genuine equilibrium of its own equations:
  reattaching the flow needs forward speed, and gaining forward speed needs the
  flow attached. A real canopy escapes by refilling its cells and regaining its
  shape, which a rigid canopy with a panel polar cannot represent. So brakes
  released plus about a second and a half of airflow re-establishes attached
  flow explicitly, and the wing comes out with the surge its stored energy
  deserves. See `updatePressureRecovery`.

- **The pendulum mode is slow.** The canopy's fore-and-aft swing against the
  pilot comes out slower than the three to four seconds pilots report. The
  period is bounded in the suite but at a wider range than the real figure.

- **No canopy deformation.** The canopy is a rigid body. Collapses are modelled
  as per-panel loss of lift and gain of drag, which captures the flight
  consequences — the wing turns and dives toward the collapsed side, and an
  active pilot can catch it — but not cravats, line-overs or the shape changes
  behind them.

- **Apparent mass is approximated.** Added mass is applied as a direction-
  dependent diagonal in body axes rather than as a full tensor, and the terms
  from the frame rotating are left out.

- **Riser twist is simplified.** Twist is a single torsional degree of freedom
  with a stiffening spring. It reports an angle and resists winding up, but the
  brake lines do not actually lose their travel when twisted.

## Things that turned out to matter more than expected

Recorded because they were not obvious and each one cost real time to find.

1. **Where the pilot hangs along the chord sets trim angle of attack.** The
   resultant aerodynamic force acts about seven metres above the centre of mass,
   so the moment it makes is very sensitive to that station. Hang the pilot a
   few centimetres too far forward and the wing carries a permanent nose-down
   moment and simply dives away.

2. **The hang station is a geometric constant, not a function of angle of
   attack.** Hold it fixed and the pitch moment rises with angle of attack,
   which is the restoring behaviour a real wing has. Let it drift with angle of
   attack and the sign flips, giving a wing that diverges into either a stall or
   a dive.

3. **Control-line hinge moments are carried by the control lines.** Pulling a
   brake creates a hinge moment that goes up the brake line to the pilot's hand
   — which is why the brakes go heavy — and the bar's load is held by the
   pilot's legs through the pulleys. Feed the full two-dimensional flap moment
   into the canopy instead and the truss has to carry it as a differential
   between the line rows; because both rows run to the same carabiner, that
   differential drags the risers several degrees off vertical and cancels the
   control input almost exactly. Pulling brake then dives the wing instead of
   slowing it, and the speed bar does nothing at all.

4. **The riser attachment belongs at the centre of pressure.** Same mechanism as
   above: anywhere else and the leftover pitching moment tilts the risers.

5. **Brake camber gain has to be set against the zero-lift shift.** Too little
   and the stall angle collapses faster than the wing slows, so the wing lets go
   at half brake travel. Too much and the stall angle stops falling at all, and
   deep brake on one side can no longer stall that side.

6. **Separated drag depends on where the trailing edge is.** With the brakes
   buried a stalled canopy is close to a flat plate; with the brakes up it is far
   cleaner. Hold the separated drag constant and releasing the brakes changes
   nothing, so a stalled wing stays a parachute all the way to the ground.

7. **Compliant risers beat a rigid constraint.** Solved as a rigid distance, the
   lines sit exactly at rest length in trim and flicker on and off at the
   activation threshold. Modelling their real 20 kN/m stretch leaves them
   slightly loaded in normal flight, hands the tension straight to the
   instruments, and removes the energy a positional bias was feeding into the
   pitch and roll modes.

8. **Pitch damping has to be added explicitly.** Roll and yaw damping fall out of
   the panel layout, because those rates change the local flow at stations
   spread along the span. Pitch does not: every panel sits at the same chordwise
   station. Without the rotary derivative the wing wallows through enormous slow
   oscillations.
