import { ParagliderSimulation } from '../apps/web/src/physics/pendulum'

const sim = new ParagliderSimulation()
sim.reset(2000, 0, { x: 0, y: 2000, z: 0 })

const sampleTerrain = (_x: number, _z: number) => 500

console.log('--- Step 1: Dive to build speed on speedbar ---')
sim.controls.speedBar = 1.0
sim.controls.leftBrake = 0
sim.controls.rightBrake = 0

for (let t = 0; t < 3.5; t += 0.02) {
  sim.step(0.02, sampleTerrain)
}
console.log(`Speed after dive: ${sim.telemetry.airspeedKmh.toFixed(1)} km/h, pitch: ${sim.telemetry.pitchDeg.toFixed(1)}°`)

console.log('--- Step 2: Dynamic pitch-up climb (pull dual brakes) ---')
sim.controls.speedBar = 0
sim.controls.leftBrake = 0.90
sim.controls.rightBrake = 0.90

let maxClimbPitch = -999
for (let t = 0; t < 1.2; t += 0.02) {
  sim.step(0.02, sampleTerrain)
  if (sim.pilot.pendulumPitchDeg > maxClimbPitch) maxClimbPitch = sim.pilot.pendulumPitchDeg
}
console.log(`Max climb pitch: ${maxClimbPitch.toFixed(1)}°, speed: ${sim.telemetry.airspeedKmh.toFixed(1)} km/h`)

console.log('--- Step 3: Release brakes for surge dive ---')
sim.controls.leftBrake = 0
sim.controls.rightBrake = 0
let minSurgePitch = 999
for (let t = 0; t < 0.8; t += 0.02) {
  sim.step(0.02, sampleTerrain)
  if (sim.pilot.pendulumPitchDeg < minSurgePitch) minSurgePitch = sim.pilot.pendulumPitchDeg
}
console.log(`Min surge pitch: ${minSurgePitch.toFixed(1)}°, speed: ${sim.telemetry.airspeedKmh.toFixed(1)} km/h`)

console.log('--- Step 4: Full brake yank to sling loop over the top ---')
sim.controls.leftBrake = 1.0
sim.controls.rightBrake = 1.0
let peakLoopCumulativePitch = 0
for (let t = 0; t < 2.5; t += 0.02) {
  sim.step(0.02, sampleTerrain)
  if (Math.abs(sim.cumulativePitchDeg) > peakLoopCumulativePitch) {
    peakLoopCumulativePitch = Math.abs(sim.cumulativePitchDeg)
  }
}
console.log(`Cumulative pitch reached: ${peakLoopCumulativePitch.toFixed(1)}°, tumbleStreak: ${sim.tumbleStreak}`)
