import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Color4 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { LinesMesh } from '@babylonjs/core/Meshes/linesMesh'
import type { Scene } from '@babylonjs/core/scene'
import type { ParagliderSimulation } from '../physics/pendulum'

export type XCTurnpoint = {
  id: string
  name: string
  center: Vector3
  radius: number
  minAltitude: number
  description: string
  tacticsTip: string
}

export type XCTaskStatus = {
  missionTitle: string
  currentWaypointIndex: number
  totalWaypoints: number
  activeWaypoint: XCTurnpoint
  distanceToActiveKm: number
  bearingToActiveDeg: number
  requiredGlideRatio: number
  canReachOnGlide: boolean
  taskProgressPercent: number
  isTaskComplete: boolean
  completedWaypoints: string[]
  totalDistanceFlownKm: number
}

/**
 * 65km Cross-Country Mountain Mission Engine
 * Recreates the real Andes mountain flight from Roldanillo to Lago Calima / Darién.
 * Features 3D holographic GPS flight track ribbon, turnpoint cylinders, and real-time MacCready glide computer.
 */
export class XCMissionSystem {
  public readonly missionTitle = 'Cordillera Occidental Classic: Roldanillo -> Lago Calima (65km)'
  public readonly waypoints: XCTurnpoint[] = [
    {
      id: 'wp0',
      name: 'Los Tanques Launch',
      center: new Vector3(70, 2395, 10),
      radius: 200,
      minAltitude: 2350,
      description: 'Western Andes escarpment launch overlooking Cauca Valley.',
      tacticsTip: 'Launch cleanly and pick up ridge lift heading south along the escarpment.',
    },
    {
      id: 'wp1',
      name: 'La Tulia Ridge Spur',
      center: new Vector3(-350, 1920, -1800),
      radius: 350,
      minAltitude: 1850,
      description: 'Dynamic orographic ridge-soaring corridor.',
      tacticsTip: 'Pegarse a los relieves! Hug the mountain face to surf dynamic slope lift at high forward speed.',
    },
    {
      id: 'wp2',
      name: 'Cañón de Bolívar Thermal',
      center: new Vector3(250, 1780, -4500),
      radius: 400,
      minAltitude: 1700,
      description: 'Deep canyon thermal engine over sun-baked rocky gorge.',
      tacticsTip: 'Climb high here in the thermal core (+5.0 m/s) to ensure clearance over the high southern pass.',
    },
    {
      id: 'wp3',
      name: 'Riofrío Mountain Crest',
      center: new Vector3(-650, 2350, -8200),
      radius: 450,
      minAltitude: 2200,
      description: 'High Andean mountain pass crossing at 2,350m.',
      tacticsTip: 'Cross above the rocky pass and hook into convergence lift on the lee side.',
    },
    {
      id: 'wp4',
      name: 'Yotoco Cloud Street',
      center: new Vector3(380, 2420, -12000),
      radius: 500,
      minAltitude: 2250,
      description: 'Cumulus cloud street corridor leading toward Calima Basin.',
      tacticsTip: 'Step on the speedbar! Cruise forward at 55+ km/h under the cloud street with minimal height loss.',
    },
    {
      id: 'wp5_goal',
      name: 'Goal: Darién & Lago Calima',
      center: new Vector3(-180, 1485, -16200),
      radius: 550,
      minAltitude: 1450,
      description: 'Lakeside goal landing field on the shores of sparkling Lago Calima!',
      tacticsTip: 'Final glide over the blue waters of Lago Calima. Prepare for landing flare at the lakeside field.',
    },
  ]

  public currentWaypointIndex = 1 // Start targeting WP1
  public completedWaypoints: string[] = ['wp0']
  public isTaskComplete = false
  public totalDistanceFlownKm = 0

  private scene: Scene
  private routeLineMesh: LinesMesh | null = null
  private turnpointMeshes: Mesh[] = []
  private activeCylinderMesh: Mesh | null = null
  private activePinMesh: Mesh | null = null
  private cylinderMat: StandardMaterial | null = null
  private pulsePhase = 0
  private lastPilotPos: Vector3 | null = null

  // Callback when waypoint reached
  public onWaypointCompleted?: (wp: XCTurnpoint, nextWp: XCTurnpoint | null) => void
  public onMissionFinished?: () => void

  constructor(scene: Scene) {
    this.scene = scene
    this.build3DRouteRibbon()
    this.buildTurnpointMarkers()
  }

  /**
   * Builds the 3D Holographic Route Line connecting all waypoints across the Andes
   */
  private build3DRouteRibbon() {
    const routePoints: Vector3[] = this.waypoints.map((wp) => wp.center.clone())
    const routeColors: Color4[] = this.waypoints.map((_, idx) => {
      if (idx === this.waypoints.length - 1) {
        return new Color4(1.0, 0.85, 0.1, 0.85) // Gold for goal
      }
      return new Color4(0.0, 0.90, 1.0, 0.75) // Cyan neon for flight path
    })

    this.routeLineMesh = MeshBuilder.CreateLines(
      'xc-route-ribbon',
      {
        points: routePoints,
        colors: routeColors,
        updatable: false,
      },
      this.scene,
    )
    this.routeLineMesh.isPickable = false
  }

  /**
   * Builds visual turnpoint cylinders & beacons
   */
  private buildTurnpointMarkers() {
    this.cylinderMat = new StandardMaterial('tp-cylinder-mat', this.scene)
    this.cylinderMat.diffuseColor = new Color3(0.0, 0.85, 1.0)
    this.cylinderMat.emissiveColor = new Color3(0.0, 0.45, 0.85)
    this.cylinderMat.alpha = 0.22
    this.cylinderMat.backFaceCulling = false

    // Active Cylinder (re-positioned to current target)
    this.activeCylinderMesh = MeshBuilder.CreateCylinder(
      'active-tp-cylinder',
      {
        height: 600,
        diameter: this.waypoints[1].radius * 2,
        tessellation: 36,
      },
      this.scene,
    )
    this.activeCylinderMesh.material = this.cylinderMat
    this.activeCylinderMesh.isPickable = false

    // Active Beacon Pin
    this.activePinMesh = MeshBuilder.CreateCylinder(
      'active-tp-pin',
      {
        height: 1200,
        diameterTop: 6,
        diameterBottom: 16,
        tessellation: 12,
      },
      this.scene,
    )
    const pinMat = new StandardMaterial('pin-mat', this.scene)
    pinMat.emissiveColor = new Color3(1.0, 0.92, 0.2)
    this.activePinMesh.material = pinMat
    this.activePinMesh.isPickable = false

    this.updateMarkerPositions()
  }

  private updateMarkerPositions() {
    const curWp = this.waypoints[this.currentWaypointIndex]
    if (!curWp || !this.activeCylinderMesh || !this.activePinMesh) return

    this.activeCylinderMesh.position.set(curWp.center.x, curWp.center.y, curWp.center.z)
    this.activeCylinderMesh.scaling.set(
      curWp.radius / 350,
      1.0,
      curWp.radius / 350,
    )

    this.activePinMesh.position.set(curWp.center.x, curWp.center.y + 300, curWp.center.z)
  }

  public update(sim: ParagliderSimulation, dt: number): XCTaskStatus {
    const pilotPos = new Vector3(sim.pilot.position.x, sim.pilot.position.y, sim.pilot.position.z)

    // Track total distance flown
    if (this.lastPilotPos) {
      const d = Vector3.Distance(pilotPos, this.lastPilotPos)
      this.totalDistanceFlownKm += d / 1000.0
    }
    this.lastPilotPos = pilotPos.clone()

    // Pulse animation on active turnpoint cylinder
    this.pulsePhase += dt * 2.5
    if (this.activeCylinderMesh && this.cylinderMat) {
      const pulse = 0.18 + Math.sin(this.pulsePhase) * 0.08
      this.cylinderMat.alpha = pulse
      this.activeCylinderMesh.rotation.y += dt * 0.35
    }

    const activeWp = this.waypoints[this.currentWaypointIndex] || this.waypoints[this.waypoints.length - 1]

    // Calculate distance and bearing to active waypoint
    const dx = activeWp.center.x - pilotPos.x
    const dz = activeWp.center.z - pilotPos.z
    const horizDistMeters = Math.hypot(dx, dz)
    const distanceToActiveKm = horizDistMeters / 1000.0

    // Bearing in degrees (0 = North, 90 = East, 180 = South, 270 = West)
    let bearingRad = Math.atan2(dx, dz)
    let bearingDeg = (bearingRad * 180) / Math.PI
    if (bearingDeg < 0) bearingDeg += 360

    // Altitude difference
    const altDiff = pilotPos.y - activeWp.minAltitude
    let requiredGlideRatio = 99.9
    let canReachOnGlide = false

    if (altDiff > 5) {
      requiredGlideRatio = horizDistMeters / altDiff
      // If current wing glide ratio exceeds required L/D, you can make it on a straight glide!
      const wingLd = sim.wing.glideRatio || 10.2
      canReachOnGlide = requiredGlideRatio <= wingLd
    }

    // Check Turnpoint Arrival
    if (!this.isTaskComplete && horizDistMeters < activeWp.radius && pilotPos.y >= activeWp.minAltitude - 120) {
      // Completed turnpoint!
      this.completedWaypoints.push(activeWp.id)

      if (this.currentWaypointIndex >= this.waypoints.length - 1) {
        // Goal reached!
        this.isTaskComplete = true
        if (this.onMissionFinished) this.onMissionFinished()
      } else {
        this.currentWaypointIndex++
        const nextWp = this.waypoints[this.currentWaypointIndex]
        this.updateMarkerPositions()
        if (this.onWaypointCompleted) this.onWaypointCompleted(activeWp, nextWp)
      }
    }

    const taskProgressPercent = Math.round(
      ((this.currentWaypointIndex - 1) / (this.waypoints.length - 1)) * 100,
    )

    return {
      missionTitle: this.missionTitle,
      currentWaypointIndex: this.currentWaypointIndex,
      totalWaypoints: this.waypoints.length - 1,
      activeWaypoint: activeWp,
      distanceToActiveKm: Number(distanceToActiveKm.toFixed(1)),
      bearingToActiveDeg: Math.round(bearingDeg),
      requiredGlideRatio: Number(requiredGlideRatio.toFixed(1)),
      canReachOnGlide,
      taskProgressPercent,
      isTaskComplete: this.isTaskComplete,
      completedWaypoints: this.completedWaypoints,
      totalDistanceFlownKm: Number(this.totalDistanceFlownKm.toFixed(1)),
    }
  }

  public resetTask() {
    this.currentWaypointIndex = 1
    this.completedWaypoints = ['wp0']
    this.isTaskComplete = false
    this.totalDistanceFlownKm = 0
    this.updateMarkerPositions()
  }

  public dispose() {
    if (this.routeLineMesh) this.routeLineMesh.dispose()
    if (this.activeCylinderMesh) this.activeCylinderMesh.dispose()
    if (this.activePinMesh) this.activePinMesh.dispose()
    for (const m of this.turnpointMeshes) m.dispose()
  }
}
