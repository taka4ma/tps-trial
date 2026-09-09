import test from 'node:test';
import assert from 'node:assert/strict';
import { circleBlocked, moveWithCollision, rayBox, boxDistance, blastDamage, Navigation } from '../src/simulation.js';

const wall = () => ({ minX: 2, maxX: 8, minZ: -5, maxZ: 5, height: 10, destroyed: false });
test('movement cannot tunnel through a building even with a long frame', () => {
  const p = { x: 0, z: 0 }; moveWithCollision(p, 20, 0, .4, [wall()]); assert.ok(p.x <= 1.6 + 1e-9);
});
test('destroyed obstacles no longer block the player or zombies', () => {
  const o = wall(); assert.equal(circleBlocked(4, 0, .4, [o]), true); o.destroyed = true;
  const p = { x: 0, z: 0 }; moveWithCollision(p, 6, 0, .4, [o]); assert.ok(Math.abs(p.x - 6) < .001);
});
test('movement slides along cover and respects the arena boundary', () => {
  const p = { x: 1.5, z: 0 }; moveWithCollision(p, 4, 4, .4, [wall()]); assert.ok(p.x < 1.61); assert.ok(p.z > 3.9);
  moveWithCollision(p, -200, 0, .4, []); assert.ok(p.x >= -45.6);
});
test('swept rocket ray detects a wall crossed between frames', () => {
  assert.equal(rayBox({ x: 0, y: 1.4, z: 0 }, { x: 1, y: 0, z: 0 }, wall(), 36), 2);
  assert.equal(rayBox({ x: 0, y: 11, z: 0 }, { x: 1, y: 0, z: 0 }, wall(), 36), null);
  assert.equal(rayBox({ x: 4, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, wall(), 36), 0);
  assert.equal(rayBox({ x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, wall(), 1), null);
});
test('blast damage uses nearest building surface, rather than its center', () => {
  const distance = boxDistance({ x: 2, y: 1, z: 0 }, wall()); assert.equal(distance, 0); assert.equal(blastDamage(distance, 8, 190), 190);
  assert.ok(blastDamage(distance, 8, 190) >= 155); assert.equal(blastDamage(8, 8, 190), 0); assert.equal(blastDamage(9, 8, 190), 0);
});
test('navigation goes around buildings and opens a direct route after destruction', () => {
  const o = wall(), nav = new Navigation([o]), target = { x: 12, z: 0 }, p = { x: 0, z: 0 }; nav.update(target);
  let maxZ = 0;
  for (let i = 0; i < 1400 && Math.hypot(p.x - target.x, p.z) > 1; i++) {
    const d = nav.direction(p, target); moveWithCollision(p, d.x * .05, d.z * .05, .45, [o]); maxZ = Math.max(maxZ, Math.abs(p.z));
  }
  assert.ok(maxZ > 5, 'route should go around the wall'); assert.ok(Math.hypot(p.x - target.x, p.z) < 1.1, 'zombie must reach its target');
  o.destroyed = true; nav.rebuild(); nav.update(target); const d = nav.direction({ x: 0, z: 0 }, target); assert.ok(d.x > .9); assert.ok(Math.abs(d.z) < .1);
});
