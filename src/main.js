import * as THREE from 'three';
import './style.css';
import { createWorld, createPerson, box, mat } from './world.js';
import { ARENA, clamp, moveWithCollision, circleBlocked, rayBox, boxDistance, blastDamage, Navigation } from './simulation.js';

const $ = id => document.getElementById(id);
const canvas = $('game');
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); }
catch { $('fatal').hidden = false; $('fatal').textContent = '3D描画を開始できませんでした。WebGL対応のPCブラウザで、ハードウェアアクセラレーションを有効にして再読み込みしてください。'; throw new Error('WebGL unavailable'); }
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.65));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, .1, 210);
const { obstacles } = createWorld(scene), nav = new Navigation(obstacles);
const player = createPerson(); scene.add(player.root); player.root.position.set(0, 0, 19);
const zombies = [], rockets = [], effects = [], rubble = [];
const sphereGeometry = new THREE.IcosahedronGeometry(1, 1), particleGeometry = new THREE.BoxGeometry(1, 1, 1);
const state = { mode: 'menu', hp: 100, weapon: 'rifle', wave: 0, kills: 0, destroyed: 0, timer: 0, intermission: 0, spawnLeft: 0, spawnTimer: 0, cooldown: 0, reload: 0, reloadWeapon: null, navTimer: 0, flash: 0, hit: 0, toast: 0, recoil: 0, yaw: 0, pitch: -.08, firing: false, aiming: false, rifle: 30, rocket: 1, reserve: 6 };
const keys = new Set();
let muted = false, audioCtx, last = performance.now(), hudTick = 0;
function sound(kind) {
  if (muted) return;
  try {
    audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') void audioCtx.resume();
    const t = audioCtx.currentTime, duration = kind === 'blast' ? .75 : kind === 'rifle' ? .12 : .2;
    const gain = audioCtx.createGain(); gain.connect(audioCtx.destination);
    gain.gain.setValueAtTime(kind === 'blast' ? .22 : .075, t); gain.gain.exponentialRampToValueAtTime(.001, t + duration);
    const buffer = audioCtx.createBuffer(1, Math.floor(audioCtx.sampleRate * duration), audioCtx.sampleRate), data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const source = audioCtx.createBufferSource(); source.buffer = buffer;
    const filter = audioCtx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = kind === 'blast' ? 350 : kind === 'rifle' ? 2200 : 700;
    source.connect(filter); filter.connect(gain); source.start(t); source.stop(t + duration);
    if (kind === 'reload' || kind === 'wave') {
      const osc = audioCtx.createOscillator(); osc.frequency.setValueAtTime(kind === 'wave' ? 440 : 760, t); osc.frequency.exponentialRampToValueAtTime(180, t + .2); osc.connect(gain); osc.start(t); osc.stop(t + .2);
    }
  } catch { /* Audio is optional; gameplay remains available. */ }
}
function toast(message, duration = 2.5) { $('toast').textContent = message; state.toast = duration; }
function clearInput() { keys.clear(); state.firing = false; state.aiming = false; }
function showOverlay(phase) {
  state.mode = phase; clearInput(); $('overlay').hidden = false; $('resume').hidden = phase !== 'paused';
  $('overlay-kicker').textContent = phase === 'won' ? 'DISTRICT SECURED' : phase === 'dead' ? 'SIGNAL LOST' : 'OPERATION PAUSED';
  $('overlay-title').textContent = phase === 'won' ? '作戦完了' : phase === 'dead' ? '任務失敗' : '一時停止';
  $('overlay-description').textContent = phase === 'paused' ? '準備ができたら、市街地へ戻ろう。' : `${state.wave} ウェーブ / ${state.kills} 体撃破 / 障害物 ${state.destroyed} 件破壊`;
  $('restart').textContent = phase === 'paused' ? '最初からやり直す' : 'もう一度挑戦する';
  if (document.pointerLockElement) document.exitPointerLock();
}
async function captureMouse() {
  try {
    if (!canvas.requestPointerLock) throw new Error('unsupported');
    await canvas.requestPointerLock();
  } catch { toast('マウス固定不可：右ドラッグで視点操作', 5); }
}
function start() {
  reset(); state.mode = 'playing'; $('menu').hidden = true; $('overlay').hidden = true; $('hud').hidden = false; document.body.classList.add('playing');
  sound('wave'); void captureMouse(); nextWave(); updateCamera(1); updateHUD();
}
function reset() {
  for (const z of zombies) scene.remove(z.person.root); zombies.length = 0;
  for (const r of rockets) { scene.remove(r.mesh); r.mesh.geometry.dispose(); } rockets.length = 0;
  for (const e of effects) { scene.remove(e.mesh); e.mesh.material.dispose(); if (e.ownGeometry) e.mesh.geometry.dispose(); } effects.length = 0;
  for (const m of rubble) scene.remove(m); rubble.length = 0;
  for (const o of obstacles) { o.destroyed = false; o.hp = o.maxHp; o.group.visible = true; o.group.rotation.x = 0; o.group.rotation.z = 0; }
  Object.assign(state, { hp: 100, weapon: 'rifle', wave: 0, kills: 0, destroyed: 0, timer: 0, intermission: 0, spawnLeft: 0, cooldown: 0, reload: 0, reloadWeapon: null, navTimer: 0, flash: 0, hit: 0, toast: 0, recoil: 0, yaw: 0, pitch: -.08, rifle: 30, rocket: 1, reserve: 6 });
  clearInput(); player.root.position.set(0, 0, 19); player.root.rotation.y = 0; player.rifle.visible = true; player.launcher.visible = false; nav.rebuild(); nav.update(player.root.position);
}
function nextWave() { state.wave++; state.spawnLeft = 4 + state.wave * 4; state.spawnTimer = 0; toast(`WAVE ${String(state.wave).padStart(2, '0')}  /  感染者接近`, 3); sound('wave'); }
function spawnZombie(at) {
  let p = at;
  if (!p) {
    for (let tries = 0; tries < 60; tries++) {
      const side = Math.floor(Math.random() * 4), v = Math.random() * 80 - 40;
      const candidate = { x: side === 0 ? -43 : side === 1 ? 43 : v, z: side === 2 ? -43 : side === 3 ? 43 : v };
      if (!circleBlocked(candidate.x, candidate.z, .6, obstacles) && Math.hypot(candidate.x - player.root.position.x, candidate.z - player.root.position.z) > 16) { p = candidate; break; }
    }
    p ??= { x: 0, z: -43 };
  }
  const person = createPerson(true, Math.floor(Math.random() * 3)); person.root.position.set(p.x, 0, p.z); scene.add(person.root);
  const zombie = { person, hp: 90, speed: 1.6 + state.wave * .2 + Math.random() * .35, attack: 0, phase: Math.random() * 6.28 };
  zombies.push(zombie); return zombie;
}
function switchWeapon(weapon) { if (state.weapon === weapon || state.mode !== 'playing') return; state.weapon = weapon; state.reload = 0; state.reloadWeapon = null; state.cooldown = Math.max(state.cooldown, .2); player.rifle.visible = weapon === 'rifle'; player.launcher.visible = weapon === 'rocket'; sound('reload'); }
function reload() {
  if (state.reload || state.mode !== 'playing' || (state.weapon === 'rifle' ? state.rifle === 30 : state.rocket === 1 || state.reserve === 0)) return;
  state.reload = state.weapon === 'rifle' ? 1.7 : 2.2; state.reloadWeapon = state.weapon; sound('reload');
}
function damagePlayer(amount) { if (state.mode !== 'playing') return; state.hp = Math.max(0, state.hp - amount); state.flash = .6; sound('hurt'); if (state.hp <= 0) showOverlay('dead'); }
function particle(position, color, size, velocity, life, sphere = false) {
  if (effects.length > 260) return;
  const material = new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false });
  const mesh = new THREE.Mesh(sphere ? sphereGeometry : particleGeometry, material); mesh.position.copy(position); mesh.scale.setScalar(size); scene.add(mesh);
  effects.push({ mesh, velocity, life, maxLife: life, gravity: !sphere, grow: sphere ? size * 2.3 : 0, size });
}
function tracer(from, to, color) {
  const geometry = new THREE.BufferGeometry().setFromPoints([from, to]); const material = new THREE.LineBasicMaterial({ color, transparent: true });
  const mesh = new THREE.Line(geometry, material); scene.add(mesh); effects.push({ mesh, life: .065, maxLife: .065, ownGeometry: true });
}
function hitZombie(zombie, damage, head = false) {
  zombie.hp -= damage; state.hit = .16;
  for (let i = 0; i < 5; i++) particle(zombie.person.root.position.clone().add(new THREE.Vector3(0, head ? 1.85 : 1.25, 0)), '#a2b67e', .065, new THREE.Vector3((Math.random() - .5) * 4, Math.random() * 3, (Math.random() - .5) * 4), .3);
  if (zombie.hp <= 0) { scene.remove(zombie.person.root); zombies.splice(zombies.indexOf(zombie), 1); state.kills++; }
}
function destroy(o) {
  if (o.destroyed) return; o.destroyed = true; o.group.visible = false; state.destroyed++;
  const cx = (o.minX + o.maxX) / 2, cz = (o.minZ + o.maxZ) / 2, w = o.maxX - o.minX, d = o.maxZ - o.minZ;
  for (let i = 0; i < (o.type === 'car' ? 12 : 24); i++) {
    const pos = new THREE.Vector3(cx + (Math.random() - .5) * w, Math.random() * Math.min(o.height, 5) + .3, cz + (Math.random() - .5) * d);
    particle(pos, i % 3 ? o.color : '#374a46', .15 + Math.random() * .55, new THREE.Vector3((Math.random() - .5) * 9, Math.random() * 9, (Math.random() - .5) * 9), 1.1 + Math.random());
    const m = new THREE.Mesh(particleGeometry, mat(i % 2 ? '#535f55' : o.color)); m.scale.set(.35 + Math.random() * 1.1, .08 + Math.random() * .17, .35 + Math.random() * 1.1); m.position.set(pos.x, .1, pos.z); m.rotation.y = Math.random() * Math.PI; m.receiveShadow = true; scene.add(m); rubble.push(m);
  }
  if (o.type === 'building') for (let i = 0; i < 6; i++) particle(new THREE.Vector3(cx + (Math.random() - .5) * w, 2 + i, cz + (Math.random() - .5) * d), '#929889', 1.5, new THREE.Vector3(0, 1.4, 0), 1.8, true);
}
function explode(point) {
  sound('blast'); state.recoil = .4;
  particle(point, '#ffe4a0', 1.1, new THREE.Vector3(0, .8, 0), .4, true);
  for (let i = 0; i < 30; i++) {
    const velocity = new THREE.Vector3(Math.random() - .5, Math.random() * .75, Math.random() - .5).normalize().multiplyScalar(3 + Math.random() * 12);
    particle(point, ['#f5b35f', '#ed8245', '#d2c590', '#748077'][i % 4], .12 + Math.random() * .3, velocity, .6 + Math.random() * .7);
  }
  for (let i = 0; i < 5; i++) particle(point.clone().add(new THREE.Vector3((Math.random() - .5) * 2, i * .35, (Math.random() - .5) * 2)), '#667570', .8 + i * .2, new THREE.Vector3(0, 1.7, 0), 1.4, true);
  for (const z of [...zombies]) { const distance = z.person.root.position.clone().add(new THREE.Vector3(0, 1, 0)).distanceTo(point); const damage = blastDamage(distance, 8, 220); if (damage > 0) hitZombie(z, damage); }
  let changed = false;
  for (const o of obstacles) {
    if (o.destroyed) continue; const damage = blastDamage(boxDistance(point, o), 8, 190); if (!damage) continue;
    o.hp -= damage; if (o.hp <= 0) { destroy(o); changed = true; }
  }
  if (changed) { nav.rebuild(); nav.update(player.root.position); toast('障害物を破壊 — ルート開放', 1.6); }
  const pd = player.root.position.clone().add(new THREE.Vector3(0, 1, 0)).distanceTo(point);
  if (pd < 5) damagePlayer(blastDamage(pd, 5, 55));
}
function raycast(origin, direction, limit = 150, enemies = true) {
  let distance = limit, object = null, head = false;
  if (direction.y < 0) { const ground = -origin.y / direction.y; if (ground >= 0 && ground < distance) distance = ground; }
  for (const o of obstacles) { if (o.destroyed) continue; const hit = rayBox(origin, direction, o, distance); if (hit !== null && hit < distance) { distance = hit; object = o; } }
  if (enemies) {
    const ray = new THREE.Ray(origin, direction);
    for (const z of zombies) for (const [height, radius, isHead] of [[1.15, .49, false], [1.84, .3, true]]) {
      const sphere = new THREE.Sphere(z.person.root.position.clone().add(new THREE.Vector3(0, height, 0)), radius);
      const hit = ray.intersectSphere(sphere, new THREE.Vector3());
      if (hit) { const d = hit.distanceTo(origin); if (d < distance) { distance = d; object = z; head = isHead; } }
    }
  }
  return { distance, point: origin.clone().addScaledVector(direction, distance), object, head };
}
function fire() {
  if (state.mode !== 'playing' || state.cooldown > 0 || state.reload > 0) return;
  const weapon = state.weapon;
  if (state[weapon] <= 0) { reload(); return; }
  state[weapon]--; state.cooldown = weapon === 'rifle' ? .105 : .75; state.recoil = weapon === 'rifle' ? .09 : .23;
  const aimDirection = camera.getWorldDirection(new THREE.Vector3());
  const aimed = raycast(camera.position, aimDirection);
  player.root.updateMatrixWorld(true);
  const muzzle = player.root.localToWorld(new THREE.Vector3(.42, weapon === 'rifle' ? 1.3 : 1.5, -1.35));
  // Check between the body and muzzle too: a barrel cannot shoot through nearby cover.
  const shoulder = player.root.position.clone().add(new THREE.Vector3(0, 1.45, 0)), toMuzzle = muzzle.clone().sub(shoulder), muzzleLength = toMuzzle.length();
  const obstruction = raycast(shoulder, toMuzzle.normalize(), muzzleLength, false);
  if (obstruction.distance < muzzleLength - .01) muzzle.copy(obstruction.point.clone().addScaledVector(toMuzzle, -.02));
  const direction = aimed.point.clone().sub(muzzle).normalize();
  if (weapon === 'rifle') {
    sound('rifle'); const hit = raycast(muzzle, direction); tracer(muzzle, hit.point, '#fff0b4');
    particle(muzzle, '#ffe0a1', .11, new THREE.Vector3(), .055, true);
    if (hit.object?.person) hitZombie(hit.object, hit.head ? 95 : 34, hit.head);
    else if (hit.distance < 145) for (let i = 0; i < 3; i++) particle(hit.point, '#d3d1a5', .05, new THREE.Vector3(Math.random() - .5, 1.5, Math.random() - .5), .22);
  } else {
    sound('launch'); const mesh = new THREE.Mesh(new THREE.ConeGeometry(.12, .55, 8), mat('#d7d894', { emissive: '#b89347', emissiveIntensity: .6 }));
    mesh.position.copy(muzzle); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction); scene.add(mesh); rockets.push({ mesh, direction, life: 4, trail: 0 });
  }
}
function updateCamera(dt, menu = false) {
  if (menu) {
    camera.fov = 58; camera.position.set(6.8, 4.8, 27); camera.lookAt(-5, 3.4, -5); camera.updateProjectionMatrix(); return;
  }
  const flat = new THREE.Vector3(Math.sin(state.yaw), 0, -Math.cos(state.yaw)), right = new THREE.Vector3(Math.cos(state.yaw), 0, Math.sin(state.yaw));
  const forward = new THREE.Vector3(flat.x * Math.cos(state.pitch), Math.sin(state.pitch), flat.z * Math.cos(state.pitch));
  const shoulder = player.root.position.clone().add(new THREE.Vector3(0, 1.65, 0));
  const desired = shoulder.clone().addScaledVector(forward, state.aiming ? -2.65 : -5).addScaledVector(right, .85).add(new THREE.Vector3(0, .75, 0));
  const offset = desired.clone().sub(shoulder), length = offset.length(); offset.normalize(); let distance = length;
  for (const o of obstacles) { if (o.destroyed) continue; const hit = rayBox(shoulder, offset, { ...o, minX: o.minX - .2, maxX: o.maxX + .2, minZ: o.minZ - .2, maxZ: o.maxZ + .2, height: o.height + .2 }, distance); if (hit !== null) distance = Math.max(.35, hit - .1); }
  camera.position.copy(shoulder).addScaledVector(offset, distance);
  const target = shoulder.clone().addScaledVector(right, .85).addScaledVector(forward, 40);
  if (state.recoil > 0) target.y += Math.sin(state.timer * 95) * state.recoil * 1.8;
  camera.lookAt(target); camera.fov = THREE.MathUtils.lerp(camera.fov, state.aiming ? 48 : 65, Math.min(1, dt * 12)); camera.updateProjectionMatrix();
  // Fade the avatar when the camera is forced extremely close to cover.
  player.root.visible = distance > 1;
}
function animatePerson(person, moving, time, zombie = false) { person.legs.forEach((leg, i) => { leg.rotation.x = moving ? Math.sin(time * (zombie ? 7 : 11) + i * Math.PI) * .55 : 0; }); person.body.position.y = moving ? Math.abs(Math.sin(time * 9)) * .035 : 0; if (zombie) person.arms.forEach((arm, i) => { arm.rotation.x = 1.15 + Math.sin(time * 3 + i) * .13; }); }
function update(dt) {
  state.timer += dt; state.cooldown = Math.max(0, state.cooldown - dt); state.recoil = Math.max(0, state.recoil - dt); state.flash = Math.max(0, state.flash - dt); state.hit = Math.max(0, state.hit - dt); state.toast = Math.max(0, state.toast - dt);
  if (state.reload > 0) {
    state.reload -= dt;
    if (state.reload <= 0) { if (state.reloadWeapon === 'rifle') state.rifle = 30; else if (state.reserve > 0) { state.rocket = 1; state.reserve--; } state.reload = 0; state.reloadWeapon = null; sound('reload'); }
  }
  const forward = new THREE.Vector3(Math.sin(state.yaw), 0, -Math.cos(state.yaw)), right = new THREE.Vector3(Math.cos(state.yaw), 0, Math.sin(state.yaw));
  const movement = forward.multiplyScalar((keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0)).addScaledVector(right, (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0));
  const moving = movement.lengthSq() > 0; movement.normalize().multiplyScalar((state.aiming ? 3.2 : keys.has('ShiftLeft') || keys.has('ShiftRight') ? 8.2 : 5.2) * dt);
  moveWithCollision(player.root.position, movement.x, movement.z, .4, obstacles); player.root.rotation.y = -state.yaw; animatePerson(player, moving, state.timer);
  state.navTimer -= dt; if (state.navTimer <= 0) { nav.update(player.root.position); state.navTimer = .45; }
  updateCamera(dt); if (state.firing) fire();
  if (state.spawnLeft > 0) { state.spawnTimer -= dt; if (state.spawnTimer <= 0) { spawnZombie(); state.spawnLeft--; state.spawnTimer = state.wave === 1 ? .65 : .38; } }
  for (const z of zombies) {
    const p = z.person.root.position, distance = p.distanceTo(player.root.position); z.attack -= dt;
    if (distance > 1.35) {
      const dir = nav.direction(p, player.root.position);
      // Local separation prevents the horde from collapsing into one silhouette.
      let sx = 0, sz = 0;
      for (const other of zombies) { if (other === z) continue; const dx = p.x - other.person.root.position.x, dz = p.z - other.person.root.position.z, d2 = dx * dx + dz * dz; if (d2 > .0001 && d2 < 1.2) { sx += dx / d2 * .45; sz += dz / d2 * .45; } }
      moveWithCollision(p, (dir.x * z.speed + sx) * dt, (dir.z * z.speed + sz) * dt, .45, obstacles);
      z.person.root.rotation.y = Math.atan2(-dir.x, -dir.z);
    } else if (z.attack <= 0 && state.mode === 'playing') {
      const delta = player.root.position.clone().add(new THREE.Vector3(0, 1, 0)).sub(p.clone().add(new THREE.Vector3(0, 1, 0)));
      const length = delta.length(); const hit = raycast(p.clone().add(new THREE.Vector3(0, 1, 0)), delta.normalize(), length, false);
      if (hit.distance >= length - .01) { damagePlayer(11); z.attack = .95; }
    }
    animatePerson(z.person, distance > 1.35, state.timer + z.phase, true);
  }
  for (let i = rockets.length - 1; i >= 0; i--) {
    const rocket = rockets[i], length = 36 * dt, hit = raycast(rocket.mesh.position, rocket.direction, length); rocket.life -= dt;
    if (hit.distance < length || rocket.life <= 0) { explode(hit.point); scene.remove(rocket.mesh); rocket.mesh.geometry.dispose(); rockets.splice(i, 1); }
    else { rocket.mesh.position.addScaledVector(rocket.direction, length); rocket.trail -= dt; if (rocket.trail <= 0) { particle(rocket.mesh.position, '#dfb46c', .15, new THREE.Vector3(0, .2, 0), .32, true); rocket.trail = .03; } }
  }
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i]; e.life -= dt;
    if (e.life <= 0) { scene.remove(e.mesh); e.mesh.material.dispose(); if (e.ownGeometry) e.mesh.geometry.dispose(); effects.splice(i, 1); continue; }
    e.mesh.material.opacity = Math.min(1, e.life / e.maxLife * 1.4);
    if (e.velocity) { if (e.gravity) e.velocity.y -= 15 * dt; e.mesh.position.addScaledVector(e.velocity, dt); if (e.mesh.position.y < .1) { e.mesh.position.y = .1; e.velocity.y *= -.2; e.velocity.x *= .8; e.velocity.z *= .8; } if (e.grow) e.mesh.scale.setScalar(e.size + (e.maxLife - e.life) * e.grow); else e.mesh.rotation.x += dt * 3; }
  }
  if (state.mode !== 'playing') return;
  if (state.spawnLeft === 0 && zombies.length === 0 && state.intermission === 0) {
    if (state.wave >= 5) showOverlay('won');
    else { state.intermission = 6; state.hp = Math.min(100, state.hp + 25); state.reserve = Math.min(12, state.reserve + 5); state.rifle = 30; toast('ウェーブクリア — 体力 +25 / ロケット +5', 3); sound('wave'); }
  }
  if (state.intermission > 0) { state.intermission -= dt; if (state.intermission < 3) toast(`次のウェーブまで ${Math.ceil(state.intermission)} 秒`, .2); if (state.intermission <= 0) { state.intermission = 0; nextWave(); } }
}
const mapCtx = $('radar').getContext('2d');
function updateHUD() {
  $('wave').textContent = String(state.wave).padStart(2, '0'); $('remaining').textContent = zombies.length + state.spawnLeft;
  $('hp-number').textContent = Math.ceil(state.hp); $('hp-fill').style.width = `${state.hp}%`; $('hp-fill').style.background = state.hp < 30 ? '#ef886c' : '#d8ee8d';
  $('kills').innerHTML = `${state.kills} KILLS <span> / </span> ${state.destroyed} DESTROYED`;
  $('ammo').textContent = String(state[state.weapon]).padStart(2, '0'); $('ammo-reserve').textContent = state.weapon === 'rifle' ? ' / ∞' : ` / ${state.reserve}`;
  $('weapon-name').textContent = state.weapon === 'rifle' ? 'AR-30 ASSAULT RIFLE' : 'RL-08 ROCKET LAUNCHER';
  $('slot-rifle').classList.toggle('selected', state.weapon === 'rifle'); $('slot-rocket').classList.toggle('selected', state.weapon === 'rocket');
  $('rifle-icon').innerHTML = state.weapon === 'rifle' ? '<path d="M10 20h34l12-7h50v5h51v5h18v6h-58l-7 7H87l5 12H78l-9-16H44L17 43H9zM82 6h27v5H82z"/>' : '<path d="M12 12h128l23-6v31l-23-6H80l-8 16H59l4-16H12zM8 9h9v25H8zM94 5h18v6H94z"/>';
  $('reload-status').textContent = state.reload > 0 ? `RELOADING … ${state.reload.toFixed(1)} s` : state.weapon === 'rifle' ? 'フルオート · R でリロード' : state.rocket + state.reserve === 0 ? '弾薬なし · 次のウェーブで補給' : '爆風半径 8m · 自爆に注意';
  $('crosshair').classList.toggle('aiming', state.aiming); $('crosshair').classList.toggle('rocket', state.weapon === 'rocket');
  $('damage-flash').style.opacity = state.flash * .9; $('hitmarker').style.opacity = state.hit > 0 ? 1 : 0; $('toast').style.opacity = state.toast > 0 ? 1 : 0;
  mapCtx.clearRect(0, 0, 180, 180); mapCtx.fillStyle = '#152326'; mapCtx.fillRect(0, 0, 180, 180); const scale = 180 / 100;
  mapCtx.strokeStyle = '#829b8820'; mapCtx.lineWidth = 1; for (let i = 0; i <= 180; i += 30) { mapCtx.beginPath(); mapCtx.moveTo(i, 0); mapCtx.lineTo(i, 180); mapCtx.moveTo(0, i); mapCtx.lineTo(180, i); mapCtx.stroke(); }
  for (const o of obstacles) { mapCtx.fillStyle = o.destroyed ? '#344a3e' : '#60756d'; mapCtx.fillRect(90 + o.minX * scale, 90 + o.minZ * scale, (o.maxX - o.minX) * scale, (o.maxZ - o.minZ) * scale); }
  for (const z of zombies) { mapCtx.fillStyle = '#fa9670'; mapCtx.beginPath(); mapCtx.arc(90 + z.person.root.position.x * scale, 90 + z.person.root.position.z * scale, 2.3, 0, 6.283); mapCtx.fill(); }
  mapCtx.save(); mapCtx.translate(90 + player.root.position.x * scale, 90 + player.root.position.z * scale); mapCtx.rotate(state.yaw); mapCtx.fillStyle = '#e0f39b'; mapCtx.beginPath(); mapCtx.moveTo(0, -5); mapCtx.lineTo(3.5, 4); mapCtx.lineTo(0, 2); mapCtx.lineTo(-3.5, 4); mapCtx.closePath(); mapCtx.fill(); mapCtx.restore();
}
$('start').addEventListener('click', start);
$('resume').addEventListener('click', () => { state.mode = 'playing'; $('overlay').hidden = true; void captureMouse(); });
$('restart').addEventListener('click', start);
$('sound').addEventListener('click', () => { muted = !muted; $('sound').innerHTML = `SOUND <b>${muted ? 'OFF' : 'ON'}</b>`; if (!muted) sound('reload'); });
document.addEventListener('keydown', e => {
  if (['Space', 'Tab', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code) && state.mode === 'playing') e.preventDefault();
  if (e.code === 'Escape' && state.mode === 'playing') { showOverlay('paused'); return; }
  if (state.mode !== 'playing') return; keys.add(e.code);
  if (e.code === 'Digit1') switchWeapon('rifle'); if (e.code === 'Digit2') switchWeapon('rocket'); if (e.code === 'KeyR') reload();
});
document.addEventListener('keyup', e => keys.delete(e.code));
canvas.addEventListener('mousedown', e => { if (state.mode !== 'playing') return; if (e.button === 0) { state.firing = true; fire(); } if (e.button === 2) state.aiming = true; });
document.addEventListener('mouseup', e => { if (e.button === 0) state.firing = false; if (e.button === 2) state.aiming = false; });
document.addEventListener('mousemove', e => { if (state.mode !== 'playing' || (document.pointerLockElement !== canvas && !e.buttons)) return; const sensitivity = state.aiming ? .00125 : .0021; state.yaw += e.movementX * sensitivity; state.pitch = clamp(state.pitch - e.movementY * sensitivity, -.85, .65); });
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('wheel', e => { e.preventDefault(); switchWeapon(state.weapon === 'rifle' ? 'rocket' : 'rifle'); }, { passive: false });
document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement && state.mode === 'playing') showOverlay('paused'); });
document.addEventListener('visibilitychange', () => { if (document.hidden && state.mode === 'playing') showOverlay('paused'); });
window.addEventListener('blur', () => { if (state.mode === 'playing') showOverlay('paused'); });
window.addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
function frame(now) {
  requestAnimationFrame(frame); const dt = Math.min((now - last) / 1000, .04); last = now;
  if (state.mode === 'playing') update(dt); else if (state.mode === 'menu') { player.root.visible = true; updateCamera(dt, true); }
  hudTick += dt; if (hudTick > .05) { if (state.mode !== 'menu') updateHUD(); hudTick = 0; }
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);
// Explicitly opt-in development harness. Never included in a production build.
if (import.meta.env.DEV && new URLSearchParams(location.search).has('test')) {
  window.__game = { state, player, obstacles, zombies, rockets, nav, camera, start, reset, nextWave, spawnZombie, fire, explode, switchWeapon, reload, update, updateCamera, damagePlayer, raycast, renderer, scene };
  if (new URLSearchParams(location.search).has('selftest')) {
    muted = true;
    import('../tests/browser-checks.js').then(({ runBrowserChecks }) => runBrowserChecks(window.__game));
  }
}
