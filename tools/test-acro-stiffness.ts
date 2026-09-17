// Test how kTrussPitch affects surge and looping
import { ParagliderSimulation } from '../apps/web/src/physics/pendulum'

// Let's modify kTrussPitch dynamically in a test subclass or inspect
class AcroSim extends ParagliderSimulation {
  // Let's test pitch stiffness
}

const sim = new ParagliderSimulation()
sim.reset(2000, 0, { x: 0, y: 2000, z: 0 })

console.log('Testing with default stiffness (3400):')
for (let i = 0; i < 100; i++) sim.step(0.02, () => 500)
console.log('Trim speed:', sim.telemetry.airspeedKmh.toFixed(1), 'km/h, pitch:', sim.telemetry.pitchDeg.toFixed(1))
