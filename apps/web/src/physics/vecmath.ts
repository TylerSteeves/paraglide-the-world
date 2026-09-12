/**
 * Minimal, allocation-light vector / quaternion math for the flight model.
 *
 * Conventions (match Babylon.js):
 *   World: +X right (east), +Y up, +Z forward (north). Left-handed.
 *   Body:  +X right wing, +Y up along the lines toward the canopy, +Z forward (nose).
 *   Quaternions rotate body -> world:  v_world = q * v_body * q^-1
 *   A rotation about +X by a positive angle tips the nose DOWN.
 *   A rotation about +Y by a positive angle turns the nose RIGHT.
 *   A rotation about +Z by a positive angle banks LEFT (right wing rises).
 */

export type V3 = { x: number; y: number; z: number }
export type Quat = { x: number; y: number; z: number; w: number }

export const DEG = Math.PI / 180
export const RAD = 180 / Math.PI

export const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z })
export const vCopy = (a: V3): V3 => ({ x: a.x, y: a.y, z: a.z })
export const vAdd = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
export const vSub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
export const vScale = (a: V3, s: number): V3 => ({ x: a.x * s, y: a.y * s, z: a.z * s })
export const vAddScaled = (a: V3, b: V3, s: number): V3 => ({
  x: a.x + b.x * s,
  y: a.y + b.y * s,
  z: a.z + b.z * s,
})
export const vDot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z
export const vCross = (a: V3, b: V3): V3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
})
export const vLen = (a: V3): number => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z)
export const vLenSq = (a: V3): number => a.x * a.x + a.y * a.y + a.z * a.z
export function vNorm(a: V3): V3 {
  const l = vLen(a)
  if (l < 1e-9) return { x: 0, y: 0, z: 0 }
  return { x: a.x / l, y: a.y / l, z: a.z / l }
}
export const vLerp = (a: V3, b: V3, t: number): V3 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
})
export const vZero = (): V3 => ({ x: 0, y: 0, z: 0 })

export const qIdentity = (): Quat => ({ x: 0, y: 0, z: 0, w: 1 })
export const qCopy = (q: Quat): Quat => ({ x: q.x, y: q.y, z: q.z, w: q.w })

/** Hamilton product a ⊗ b (apply b first, then a, when both are body->world). */
export function qMul(a: Quat, b: Quat): Quat {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  }
}

export const qConj = (q: Quat): Quat => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w })

export function qNormalize(q: Quat): Quat {
  const l = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w)
  if (l < 1e-12) return qIdentity()
  return { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l }
}

/** Rotate vector v by quaternion q (body -> world). */
export function qRotate(q: Quat, v: V3): V3 {
  const tx = 2 * (q.y * v.z - q.z * v.y)
  const ty = 2 * (q.z * v.x - q.x * v.z)
  const tz = 2 * (q.x * v.y - q.y * v.x)
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  }
}

/** Rotate vector v by the inverse of q (world -> body). */
export function qRotateInv(q: Quat, v: V3): V3 {
  return qRotate(qConj(q), v)
}

export function qFromAxisAngle(axis: V3, angleRad: number): Quat {
  const h = angleRad * 0.5
  const s = Math.sin(h)
  return qNormalize({ x: axis.x * s, y: axis.y * s, z: axis.z * s, w: Math.cos(h) })
}

/** Integrate a body-frame angular velocity (rad/s) over dt. */
export function qIntegrateBody(q: Quat, omegaBody: V3, dt: number): Quat {
  const wLen = vLen(omegaBody)
  if (wLen < 1e-9) return q
  const angle = wLen * dt
  const axis = vScale(omegaBody, 1 / wLen)
  return qNormalize(qMul(q, qFromAxisAngle(axis, angle)))
}

/**
 * Minimal world-frame rotation applied to q so that q * bodyAxis points along worldTarget.
 * Preserves the rotation about that axis as much as possible.
 */
export function qAlignAxis(q: Quat, bodyAxis: V3, worldTarget: V3): Quat {
  const cur = qRotate(q, bodyAxis)
  const target = vNorm(worldTarget)
  const axis = vCross(cur, target)
  const s = vLen(axis)
  const c = vDot(cur, target)
  if (s < 1e-6) {
    if (c > 0) return q
    const perp = Math.abs(cur.x) < 0.9 ? vNorm(vCross(cur, v3(1, 0, 0))) : vNorm(vCross(cur, v3(0, 0, 1)))
    return qNormalize(qMul(qFromAxisAngle(perp, Math.PI), q))
  }
  const angle = Math.atan2(s, c)
  return qNormalize(qMul(qFromAxisAngle(vScale(axis, 1 / s), angle), q))
}

/** Normalized linear interpolation between two quaternions. */
export function qNlerp(a: Quat, b: Quat, t: number): Quat {
  let dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w
  const sign = dot < 0 ? -1 : 1
  return qNormalize({
    x: a.x + (b.x * sign - a.x) * t,
    y: a.y + (b.y * sign - a.y) * t,
    z: a.z + (b.z * sign - a.z) * t,
    w: a.w + (b.w * sign - a.w) * t,
  })
}

/** Yaw/pitch/roll extraction in the game's conventions (all in degrees). */
export function qToAttitude(q: Quat): { yawDeg: number; pitchDeg: number; bankDeg: number } {
  const fwd = qRotate(q, v3(0, 0, 1))
  const right = qRotate(q, v3(1, 0, 0))
  const up = qRotate(q, v3(0, 1, 0))
  const yawDeg = (Math.atan2(fwd.x, fwd.z) * RAD + 360) % 360
  const pitchDeg = -Math.asin(Math.max(-1, Math.min(1, fwd.y))) * RAD // + = nose down
  const bankDeg = Math.atan2(-right.y, up.y) * RAD // + = banked right, ±180 = inverted
  return { yawDeg, pitchDeg, bankDeg }
}

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

export function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function wrapDeg180(a: number): number {
  let r = ((a + 180) % 360 + 360) % 360 - 180
  if (r === -180) r = 180
  return r
}

export type Rng = () => number

/** Mulberry32 seeded RNG. */
export function createRng(seed: number): Rng {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Box-Muller normal distribution sample. */
export function gaussian(rng: Rng = Math.random): number {
  let u = 0
  let v = 0
  while (u === 0) u = rng()
  while (v === 0) v = rng()
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v)
}
