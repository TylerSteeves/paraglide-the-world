import { ParagliderSimulation } from '../apps/web/src/physics/pendulum'

// Let's inspect what happens to deltaPitchRad during straight flight and during dive/surge
const sim = new ParagliderSimulation()
sim.reset(2000, 0, { x: 0, y: 2000, z: 0 })

const w = sim.wing
const targetPitchRad = w.riggingAngleDeg * (Math.PI / 180)
console.log('targetPitchRad:', targetPitchRad, `(${w.riggingAngleDeg} deg)`)

for (let i = 0; i < 50; i++) {
  sim.step(0.02, () => 500)
}

const lineToPilotWorld = {
  x: sim.pilot.position.x - sim.canopy.position.x,
  y: sim.pilot.position.y - sim.canopy.position.y,
  z: sim.pilot.position.z - sim.canopy.position.z,
}
console.log('Trim lineToPilotWorld:', lineToPilotWorld)
console.log('Trim pitchDeg:', sim.telemetry.pitchDeg)
