// Geometry and navigation are shared by the live game and the regression tests.
export const ARENA = 46;
export const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
export function circleBlocked(x, z, radius, obstacles) {
  return Math.abs(x) > ARENA - radius || Math.abs(z) > ARENA - radius || obstacles.some(o => {
    if (o.destroyed) return false;
    const dx = x - clamp(x, o.minX, o.maxX), dz = z - clamp(z, o.minZ, o.maxZ);
    return dx * dx + dz * dz < radius * radius;
  });
}
export function moveWithCollision(position, dx, dz, radius, obstacles) {
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / (radius * .5)));
  for (let i = 0; i < steps; i++) {
    if (!circleBlocked(position.x + dx / steps, position.z, radius, obstacles)) position.x += dx / steps;
    if (!circleBlocked(position.x, position.z + dz / steps, radius, obstacles)) position.z += dz / steps;
  }
}
export function boxDistance(point, o) {
  return Math.hypot(point.x - clamp(point.x, o.minX, o.maxX), point.y - clamp(point.y, 0, o.height), point.z - clamp(point.z, o.minZ, o.maxZ));
}
export function blastDamage(distance, radius, damage) {
  return distance >= radius ? 0 : Math.max(0, damage * (1 - distance / radius));
}
// Return distance along a normalized ray; slab intersection also handles rays inside a box.
export function rayBox(origin, direction, o, limit = Infinity) {
  let near = 0, far = limit;
  for (const [axis, low, high] of [['x', o.minX, o.maxX], ['y', 0, o.height], ['z', o.minZ, o.maxZ]]) {
    if (Math.abs(direction[axis]) < 1e-8) {
      if (origin[axis] < low || origin[axis] > high) return null;
    } else {
      let a = (low - origin[axis]) / direction[axis], b = (high - origin[axis]) / direction[axis];
      if (a > b) [a, b] = [b, a];
      near = Math.max(near, a); far = Math.min(far, b);
      if (near > far) return null;
    }
  }
  return near <= limit ? near : null;
}
export class Navigation {
  constructor(obstacles) { this.obstacles = obstacles; this.size = 61; this.cell = 1.5; this.dist = new Int32Array(this.size ** 2); this.blocked = new Uint8Array(this.size ** 2); this.rebuild(); }
  coords(x, z) { return [clamp(Math.round((x + 45) / this.cell), 0, this.size - 1), clamp(Math.round((z + 45) / this.cell), 0, this.size - 1)]; }
  rebuild() { for (let z = 0; z < this.size; z++) for (let x = 0; x < this.size; x++) this.blocked[z * this.size + x] = circleBlocked(x * this.cell - 45, z * this.cell - 45, .65, this.obstacles); }
  update(target) {
    this.dist.fill(-1); const [tx, tz] = this.coords(target.x, target.z), start = tz * this.size + tx;
    const queue = new Int32Array(this.size ** 2); let read = 0, write = 1; queue[0] = start; this.dist[start] = 0;
    while (read < write) {
      const index = queue[read++], x = index % this.size, z = Math.floor(index / this.size);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz, ni = nz * this.size + nx;
        if (nx < 0 || nz < 0 || nx >= this.size || nz >= this.size || this.blocked[ni] || this.dist[ni] !== -1) continue;
        this.dist[ni] = this.dist[index] + 1; queue[write++] = ni;
      }
    }
  }
  direction(position, target) {
    const [x, z] = this.coords(position.x, position.z);
    let best = this.dist[z * this.size + x], goal = target;
    if (best > 1 || best < 0) {
      if (best < 0) best = Infinity;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= this.size || nz >= this.size) continue;
        const value = this.dist[nz * this.size + nx];
        if (value >= 0 && value < best) { best = value; goal = { x: nx * this.cell - 45, z: nz * this.cell - 45 }; }
      }
    }
    const dx = goal.x - position.x, dz = goal.z - position.z, length = Math.hypot(dx, dz) || 1;
    return { x: dx / length, z: dz / length };
  }
}
