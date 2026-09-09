import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const materials = new Map();
export function mat(color, options = {}) {
  const key = JSON.stringify([color, options]);
  if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial({ color, roughness: .88, ...options }));
  return materials.get(key);
}
const cube = new THREE.BoxGeometry(1, 1, 1);
export function box(parent, w, h, d, color, x = 0, y = 0, z = 0, options = {}) {
  const mesh = new THREE.Mesh(cube, mat(color, options));
  mesh.scale.set(w, h, d); mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
}
export function label(text, color = '#dbe8d9', bg = '#26393a', w = 512, h = 128) {
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = color; ctx.font = `bold ${h * .52}px Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, w / 2, h / 2);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshBasicMaterial({ map: texture });
}
function planeSign(parent, text, w, h, x, y, z, rotation = 0, color, bg) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), label(text, color, bg)); mesh.position.set(x, y, z); mesh.rotation.y = rotation; parent.add(mesh); return mesh;
}
function mergeBoxes(group) {
  const batches = new Map();
  for (const mesh of [...group.children]) {
    if (mesh.geometry !== cube) continue;
    mesh.updateMatrix(); const geometry = cube.clone().applyMatrix4(mesh.matrix);
    if (!batches.has(mesh.material)) batches.set(mesh.material, []);
    batches.get(mesh.material).push(geometry); group.remove(mesh);
  }
  for (const [material, geometries] of batches) {
    const mesh = new THREE.Mesh(mergeGeometries(geometries), material); mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh);
    geometries.forEach(geometry => geometry.dispose());
  }
}
export function createWorld(scene) {
  const world = new THREE.Group(); scene.add(world); const obstacles = [];
  scene.background = new THREE.Color('#839898'); scene.fog = new THREE.FogExp2('#839898', .0125);
  scene.add(new THREE.HemisphereLight('#cfdfdb', '#40493c', 2.2));
  const sun = new THREE.DirectionalLight('#ffe7bb', 3.1); sun.position.set(-28, 48, -37); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -55, right: 55, top: 55, bottom: -55, near: 1, far: 150 }); sun.shadow.bias = -.0005; sun.shadow.normalBias = .04; scene.add(sun);
  box(world, 240, .25, 240, '#353d3c', 0, -.17, 0);
  // Street surface, sidewalks, lane paint and pedestrian crossings.
  for (const x of [-26, 0, 26]) box(world, 10, .04, 93, '#303a3b', x, .01, 0);
  for (const z of [-27, 0, 27]) box(world, 93, .035, 10, '#303a3b', 0, .014, z);
  for (const x of [-26, 0, 26]) for (let z = -44; z < 45; z += 5) if (Math.abs(z) > 6 && Math.abs(Math.abs(z) - 27) > 6) {
    box(world, .1, .02, 2.1, '#acac86', x - .16, .05, z); box(world, .1, .02, 2.1, '#acac86', x + .16, .05, z);
  }
  for (const z of [-27, 0, 27]) for (let x = -44; x < 45; x += 5) if (Math.abs(x) > 6 && Math.abs(Math.abs(x) - 26) > 6) box(world, 2, .025, .14, '#a3a58b', x, .051, z);
  for (const z of [-7, 7, 20, 34, -20, -34]) for (let x = -3.7; x < 4; x += 1.15) box(world, .65, .025, 2.4, '#a7b0a4', x, .06, z);
  const palette = ['#65706c', '#6e7770', '#7c7970', '#5a696b', '#7b8076', '#687b79'];
  const building = (x, z, w, d, h, index, decorative = false) => {
    const group = new THREE.Group(); group.position.set(x, 0, z); world.add(group);
    const color = palette[index % palette.length];
    box(group, w + 1.2, .22, d + 1.2, '#69716a', 0, .09, 0);
    box(group, w, h, d, color, 0, h / 2, 0);
    box(group, w + .3, .25, d + .3, '#414e4d', 0, h + .05, 0);
    box(group, w + .15, .22, d + .15, '#a1a69a', 0, 3.2, 0);
    for (let y = 4.5; y < h - .7; y += 2.5) {
      for (let wx = -w / 2 + 1.2; wx < w / 2 - .7; wx += 2) for (const sign of [-1, 1]) {
        box(group, .9, 1.35, .07, (Math.round(wx + y) + index) % 5 === 0 ? '#9eae8f' : '#293b3c', wx, y, sign * (d / 2 + .045));
        box(group, 1.04, .09, .15, '#929d92', wx, y - .73, sign * (d / 2 + .05));
      }
      for (let wz = -d / 2 + 1.2; wz < d / 2 - .7; wz += 2) for (const sign of [-1, 1]) box(group, .07, 1.35, .9, '#2b3f40', sign * (w / 2 + .04), y, wz);
    }
    for (let wx = -w / 2 + 1.2; wx < w / 2 - .5; wx += 2.3) { box(group, 1.55, 2.2, .08, '#223535', wx, 1.2, d / 2 + .07); box(group, 1.6, .09, .11, '#748880', wx, .3, d / 2 + .09); }
    box(group, 1.8, 1, 2, '#52615e', w / 4, h + .55, 0);
    box(group, .1, 3.4, .1, '#364a49', -w / 4, h + 1.7, -d / 4);
    if (!decorative) {
      const names = ['PHARMACY +', 'HOTEL', 'MARKET 24', 'NO ENTRY', 'COFFEE', 'DISTRICT 07', 'AUTO PARTS', 'METRO'];
      planeSign(group, names[index % names.length], Math.min(w - .8, 6.4), .95, 0, 2.65, d / 2 + .13, 0, index % 3 === 0 ? '#d9ecb0' : '#c9d3c9', index % 3 === 0 ? '#495e43' : '#263d3e');
      obstacles.push({ type: 'building', group, minX: x - w / 2 - .15, maxX: x + w / 2 + .15, minZ: z - d / 2 - .15, maxZ: z + d / 2 + .15, height: h, hp: 155, maxHp: 155, color, destroyed: false });
    }
    mergeBoxes(group); return group;
  };
  let index = 0;
  for (const x of [-38, -13, 13, 38]) for (const z of [-38, -14, 14, 39]) building(x, z, x === 38 || x === -38 ? 10 : 12, z === 39 || z === -38 ? 9 : 13, 9 + ((index * 7) % 14), index++);
  for (let i = 0; i < 18; i++) { const a = i / 18 * Math.PI * 2; building(Math.cos(a) * 82, Math.sin(a) * 82, 12 + i % 5, 13, 20 + i * 7 % 29, i, true); }
  const car = (x, z, color, turn = false) => {
    const group = new THREE.Group(); group.position.set(x, 0, z); if (turn) group.rotation.y = Math.PI / 2; world.add(group);
    box(group, 2.15, .72, 4.6, color, 0, .8, 0); box(group, 1.87, .7, 2.2, color, 0, 1.5, -.15);
    box(group, 1.7, .52, .05, '#233e42', 0, 1.53, .98); box(group, 1.7, .5, .05, '#233e42', 0, 1.53, -1.28);
    for (const s of [-1, 1]) { box(group, .06, .5, 1.92, '#28494a', s * .95, 1.53, -.15); box(group, .12, .55, .12, color, s * .99, 1.53, -.13); }
    box(group, 2.25, .16, .12, '#9ca699', 0, .62, 2.35); box(group, 2.25, .16, .12, '#9ca699', 0, .62, -2.35);
    for (const s of [-1, 1]) { box(group, .48, .22, .07, '#e9dfb6', s * .72, .97, 2.33, { emissive: '#a9a079', emissiveIntensity: .25 }); box(group, .48, .2, .06, '#903f31', s * .72, .98, -2.33); }
    for (const wx of [-1.06, 1.06]) for (const wz of [-1.42, 1.42]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(.45, .45, .25, 10), mat('#172122')); wheel.rotation.z = Math.PI / 2; wheel.position.set(wx, .45, wz); wheel.castShadow = true; group.add(wheel);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(.23, .23, .27, 8), mat('#7c8780')); hub.rotation.z = Math.PI / 2; hub.position.copy(wheel.position); group.add(hub);
    }
    const hw = turn ? 2.45 : 1.15, hd = turn ? 1.15 : 2.45;
    obstacles.push({ type: 'car', group, minX: x - hw, maxX: x + hw, minZ: z - hd, maxZ: z + hd, height: 1.95, hp: 65, maxHp: 65, color, destroyed: false });
  };
  car(-3.5, 10, '#798e88'); car(3.2, -10, '#ac9a72'); car(-23, 15, '#9b6151'); car(12, 3, '#7c8f8c', true); car(-12, -3, '#657581', true); car(29, -18, '#a6a496'); car(-29, -32, '#859678'); car(36, 26, '#9d7559', true); car(-4, -37, '#667878');
  // Perimeter warns the player and keeps all combat in the playable district.
  for (const axis of ['x', 'z']) for (const side of [-1, 1]) for (let p = -44; p <= 44; p += 4) {
    const x = axis === 'x' ? side * 47 : p, z = axis === 'z' ? side * 47 : p;
    const m = box(world, axis === 'x' ? .6 : 3.6, .75, axis === 'z' ? .6 : 3.6, '#69746a', x, .4, z);
    box(world, axis === 'x' ? .66 : 3.4, .16, axis === 'z' ? .66 : 3.4, '#c4b676', x, .62, z); m.castShadow = false;
  }
  for (const x of [-5.5, 5.5, -31.5, 31.5]) for (const z of [-23, 4, 31]) {
    box(world, .13, 5.7, .13, '#394c4a', x, 2.85, z); box(world, 1.7, .12, .14, '#394c4a', x - Math.sign(x) * .7, 5.7, z);
    box(world, .75, .09, .28, '#dce5c0', x - Math.sign(x) * 1.25, 5.6, z, { emissive: '#e4e8b4', emissiveIntensity: 1.2 });
  }
  planeSign(world, 'QUARANTINE  /  SECTOR 07', 9, 1.2, 0, 5.2, -45.5, 0, '#d9e7b2', '#324b45');
  for (const x of [-4.7, 4.7]) box(world, .15, 5.8, .15, '#55685c', x, 2.9, -45.5);
  // Deterministic litter breaks up the road without adding invisible colliders.
  for (let i = 0; i < 85; i++) { const x = Math.sin(i * 87.34) * 43, z = Math.cos(i * 23.86) * 43; const litter = box(world, .12 + i % 3 * .12, .04, .22, i % 3 ? '#778078' : '#b1b19b', x, .06, z); litter.rotation.y = i; litter.castShadow = false; }
  return { world, obstacles, sun };
}
export function createPerson(zombie = false, variant = 0) {
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const skin = zombie ? '#819675' : '#b4a187', clothes = zombie ? ['#697363', '#725c51', '#667b79'][variant % 3] : '#3b514c';
  box(body, .65, .7, .37, clothes, 0, 1.18, 0); box(body, .53, .25, .33, zombie ? '#485c4e' : '#293d39', 0, .75, 0);
  box(body, .41, .45, .38, skin, 0, 1.83, 0);
  if (!zombie) { box(body, .49, .23, .47, '#344943', 0, 2.02, -.02); box(body, .44, .17, .04, '#182e2d', 0, 1.87, -.21); box(body, .51, .49, .19, '#566356', 0, 1.23, .28); box(body, .55, .51, .1, '#2c3d37', 0, 1.23, -.23); }
  else { for (const x of [-.11, .11]) box(body, .07, .055, .025, '#e6c879', x, 1.88, -.203, { emissive: '#e3b14f', emissiveIntensity: 1.3 }); box(body, .19, .08, .02, '#383c2f', 0, 1.69, -.21); }
  const legs = [];
  for (const x of [-.18, .18]) { const leg = new THREE.Group(); leg.position.set(x, .7, 0); box(leg, .23, .58, .26, zombie ? '#394a40' : '#324740', 0, -.24, 0); box(leg, .25, .17, .38, '#23302c', 0, -.58, -.045); body.add(leg); legs.push(leg); }
  const arms = [];
  for (const x of [-.43, .43]) { const arm = new THREE.Group(); arm.position.set(x, 1.5, 0); box(arm, .2, .46, .22, clothes, 0, -.16, 0); box(arm, .17, .31, .17, skin, 0, -.48, 0); arm.rotation.x = zombie ? 1.2 : 1; body.add(arm); arms.push(arm); }
  const rifle = new THREE.Group(); rifle.position.set(.4, 1.28, -.5); box(rifle, .15, .17, .72, '#243331', 0, 0, 0); box(rifle, .07, .07, .5, '#172b2a', 0, .015, -.6); box(rifle, .11, .25, .15, '#1c2a27', 0, -.15, -.08); box(rifle, .065, .065, .2, '#182723', 0, .12, -.07); body.add(rifle);
  const launcher = new THREE.Group(); launcher.position.set(.42, 1.5, -.38); const tube = new THREE.Mesh(new THREE.CylinderGeometry(.17, .2, 1.35, 10), mat('#68724b')); tube.rotation.x = Math.PI / 2; launcher.add(tube); box(launcher, .1, .25, .14, '#26322a', 0, -.2, -.14); const rim = new THREE.Mesh(new THREE.TorusGeometry(.18, .045, 5, 10), mat('#283b32')); rim.position.z = -.68; launcher.add(rim); body.add(launcher); launcher.visible = false;
  if (zombie) rifle.visible = false;
  return { root, body, legs, arms, rifle, launcher };
}
