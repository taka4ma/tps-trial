import * as THREE from 'three';
import { circleBlocked } from '../src/simulation.js';

// Opt-in browser integration tests use the real Three.js scene and combat code.
export function runBrowserChecks(g) {
  const results = [];
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const fresh = () => { g.reset(); g.state.mode = 'playing'; g.state.wave = 1; g.state.spawnLeft = 999; g.state.spawnTimer = Infinity; };
  const check = (name, fn) => { try { fresh(); fn(); results.push(`PASS ${name}`); } catch (error) { results.push(`FAIL ${name}: ${error.message}`); } };
  check('ライフル3発でゾンビ撃破・弾数消費', () => {
    const z = g.spawnZombie({ x: .42, z: 10 });
    g.camera.position.set(.42, 1.3, 18); g.camera.lookAt(.42, 1.3, 10); g.camera.updateMatrixWorld();
    for (let i = 0; i < 3; i++) { g.state.cooldown = 0; g.fire(); }
    assert(z.hp <= 0 && g.state.kills === 1 && g.state.rifle === 27, `HP=${z.hp}, kills=${g.state.kills}, ammo=${g.state.rifle}`);
  });
  check('建物が射線を遮る', () => {
    g.spawnZombie({ x: 13, z: 5 });
    const hit = g.raycast(new THREE.Vector3(13, 1.3, 24), new THREE.Vector3(0, 0, -1));
    assert(hit.object?.type === 'building', '建物より後方の敵に命中してはいけない');
  });
  check('爆風で建物・近くの敵を破壊し通行可能になる', () => {
    const building = g.obstacles.find(o => o.type === 'building' && o.minX > 0 && o.minX < 10 && o.minZ > 0 && o.minZ < 10);
    g.spawnZombie({ x: building.minX - .5, z: 14 });
    g.explode(new THREE.Vector3(building.minX - .01, 1, 14));
    assert(building.destroyed && !building.group.visible, '建物が残っている'); assert(g.state.kills === 1, '爆風で敵を倒せない');
    assert(!circleBlocked(13, 14, .4, g.obstacles), '破壊後も当たり判定が残る');
  });
  check('実際のロケットが飛翔して車両を破壊', () => {
    g.switchWeapon('rocket'); g.state.cooldown = 0;
    const car = g.obstacles.find(o => o.type === 'car');
    g.camera.position.set(.42, 1.3, 18); g.camera.lookAt(-3.5, 1.1, 10); g.camera.updateMatrixWorld(); g.fire();
    assert(g.rockets.length === 1 && g.state.rocket === 0, '発射できない');
    for (let i = 0; i < 30; i++) g.update(.04);
    assert(car.destroyed && g.rockets.length === 0, '車両に着弾していない');
  });
  check('ロケットのリロードは予備弾を1発だけ消費', () => {
    g.switchWeapon('rocket'); g.state.rocket = 0; g.reload();
    for (let i = 0; i < 60; i++) g.update(.04);
    assert(g.state.rocket === 1 && g.state.reserve === 5 && g.state.reload === 0, '弾数が不正');
  });
  check('リロード中の切り替えで別武器へ誤装填しない', () => {
    g.state.rifle = 3; g.reload(); g.switchWeapon('rocket');
    for (let i = 0; i < 50; i++) g.update(.04);
    assert(g.state.rifle === 3 && g.state.rocket === 1 && g.state.reserve === 6, 'キャンセルした装填が適用されている');
  });
  check('爆風の自傷ダメージ', () => { g.explode(g.player.root.position.clone().add(new THREE.Vector3(0, 1, 0))); assert(g.state.hp === 45, `HP=${g.state.hp}`); });
  check('ウェーブ間の回復・補給と次ウェーブ開始', () => {
    g.state.hp = 40; g.state.reserve = 0; g.state.spawnLeft = 0; g.update(.04);
    assert(g.state.hp === 65 && g.state.reserve === 5 && g.state.intermission > 0, '補給が適用されない');
    for (let i = 0; i < 155; i++) g.update(.04);
    assert(g.state.wave === 2 && g.state.spawnLeft + g.zombies.length === 12, '次ウェーブの敵数が不正');
  });
  check('第5ウェーブを全滅させると勝利', () => { g.state.wave = 5; g.state.spawnLeft = 0; g.update(.04); assert(g.state.mode === 'won', '勝利状態にならない'); });
  check('死亡とリセットで建物・体力・弾薬が復元', () => {
    g.explode(new THREE.Vector3(-3.5, 1, 10)); g.damagePlayer(100); assert(g.state.mode === 'dead', '敗北状態にならない');
    g.reset(); assert(g.state.hp === 100 && g.state.kills === 0 && g.state.destroyed === 0 && g.state.rifle === 30 && g.state.reserve === 6 && g.obstacles.every(o => !o.destroyed && o.group.visible), 'リセットが不完全');
  });
  g.state.mode = 'paused';
  const report = document.createElement('pre'); report.id = 'test-results'; report.style.cssText = 'position:fixed;inset:20px;z-index:100;background:#12221e;color:#ddedbc;padding:24px;overflow:auto;font:14px/2 monospace;white-space:pre-wrap';
  report.textContent = `${results.filter(r => r.startsWith('PASS')).length}/${results.length} browser integration checks passed\n\n${results.join('\n')}`;
  document.body.append(report);
}
