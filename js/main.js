import * as THREE from 'three';
import { createHelicopter, spinPropellers } from './helicopter.js';
import { createExplosion, updateExplosion, createStars } from './effects.js';
import { playBgm, playLoseSound, playKillSound } from './audio.js';

// ========== 基本常量 ==========
const WORLD_SIZE = 26;           // 世界尺度：横屏定高、竖屏定宽，保证两端物体一样大
const PLAYER_SPEED = 22;
const BULLET_SPEED = 55;
const ENEMY_BULLET_SPEED = 30;
const PLAYER_FIRE_INTERVAL = 0.18;
const ENEMY_HP = 2;

// ========== Three.js 场景 ==========
const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a1628);

let camera, viewH, viewW;
function setupCamera() {
  const aspect = window.innerWidth / window.innerHeight;
  if (aspect >= 1) {
    viewH = WORLD_SIZE;              // 横屏（电脑）：高度固定，宽度随屏幕
    viewW = WORLD_SIZE * aspect;
  } else {
    viewW = WORLD_SIZE;              // 竖屏（手机）：宽度固定，高度随屏幕
    viewH = WORLD_SIZE / aspect;
  }
  camera = new THREE.OrthographicCamera(-viewW / 2, viewW / 2, viewH / 2, -viewH / 2, 0.1, 100);
  camera.position.set(0, 0, 50);
  camera.lookAt(0, 0, 0);
}

function onResize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  setupCamera();
}
window.addEventListener('resize', onResize);
onResize();

scene.add(new THREE.AmbientLight(0xffffff, 1.0));
scene.add(createStars(viewW, viewH));

// ========== 静态资源加载（进度条） ==========
// 只有真正加载成功才计入进度；任何资源失败则提示重试，不会"假 100%"
const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');
const progressWrap = document.getElementById('progress-wrap');
const ASSET_TOTAL = 4; // 2 张扇叶贴图 + 2 个音频
let assetLoaded = 0;
let assetFailed = false;

function onAssetLoaded() {
  if (assetFailed) return;
  assetLoaded++;
  const pct = Math.round((assetLoaded / ASSET_TOTAL) * 100);
  progressBar.style.width = pct + '%';
  progressText.textContent = '资源加载中... ' + pct + '%（' + assetLoaded + '/' + ASSET_TOTAL + '）';
  if (assetLoaded >= ASSET_TOTAL) {
    progressWrap.classList.add('hidden');
    progressText.classList.add('hidden');
    startBtn.disabled = false;
    startBtn.textContent = '开始游戏';
  }
}

function onAssetError(name, err) {
  if (assetFailed) return;
  assetFailed = true;
  console.error('资源加载失败:', name, err);
  progressText.textContent = '「' + name + '」加载失败，点我重试';
  progressText.style.color = '#ff6666';
  progressText.style.cursor = 'pointer';
  progressText.style.pointerEvents = 'auto';
  progressText.addEventListener('click', () => location.reload());
}

// 预加载音频：fetch 完整下载并校验 HTTP 状态（404 会抛错，不会误判成功）
function loadAudio(url, name) {
  return fetch(url)
    .then(r => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.blob();
    })
    .then(onAssetLoaded)
    .catch(err => onAssetError(name, err));
}

// ========== 纹理加载 ==========
const texLoader = new THREE.TextureLoader();
const lanlaoTex = texLoader.load('static/lanlao.png', onAssetLoaded, undefined, e => onAssetError('lanlao.png', e)); // 我方螺旋桨
const laodaTex = texLoader.load('static/laoda.png', onAssetLoaded, undefined, e => onAssetError('laoda.png', e));   // 敌方螺旋桨
lanlaoTex.colorSpace = THREE.SRGBColorSpace;
laodaTex.colorSpace = THREE.SRGBColorSpace;

// 音频预加载（fetch 拉取进缓存，Audio 播放时即取即走）
loadAudio('static/' + encodeURIComponent('中国人能飞.mp3'), '中国人能飞.mp3');
loadAudio('static/man.mp3', 'man.mp3');

// 扇叶贴图信息：孔心归一化坐标（左上角原点）+ 图高/图宽
const lanlaoProp = { tex: lanlaoTex, holeX: 0.800, holeY: 0.057, aspect: 1402 / 1122 };
const laodaProp = { tex: laodaTex, holeX: 0.781, holeY: 0.051, aspect: 1254 / 1254 };

// ========== 游戏状态 ==========
let state = 'menu'; // menu | playing | over
let score = 0;
let lives = 3;
let player = null;
let bullets = [];        // 我方子弹
let enemyBullets = [];   // 敌方子弹
let enemies = [];
let crashing = [];     // 坠毁中的敌机残骸
let explosions = [];
let fireCooldown = 0;
let spawnTimer = 0;
let heavyTimer = 0;
let invincibleTimer = 0;
let elapsed = 0;

const scoreEl = document.getElementById('score');
const livesEl = document.getElementById('lives');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const startBtn = document.getElementById('start-btn');

// ========== 输入 ==========
// 电脑：方向键/WASD 移动；手机/鼠标：按住拖动，直升机跟随指针（自动开火，无需按键）
const keys = {};
let dragTarget = null; // 拖动目标点（世界坐标），null 表示未拖动
window.addEventListener('keydown', e => { keys[e.code] = true; });
window.addEventListener('keyup', e => { keys[e.code] = false; });

function pointerToWorld(e) {
  return {
    x: (e.clientX / window.innerWidth - 0.5) * viewW,
    y: (0.5 - e.clientY / window.innerHeight) * viewH + 4, // 偏移一点，手指不挡住直升机
  };
}
canvas.addEventListener('pointerdown', e => {
  dragTarget = pointerToWorld(e);
  canvas.setPointerCapture(e.pointerId);
  e.preventDefault();
});
canvas.addEventListener('pointermove', e => {
  if (dragTarget) dragTarget = pointerToWorld(e);
});
canvas.addEventListener('pointerup', () => { dragTarget = null; });
canvas.addEventListener('pointercancel', () => { dragTarget = null; });

// ========== 对象创建 ==========
const PLAYER_SCALE = 1.4;  // 我方战机放大
const HEAVY_SCALE = 2;     // 重型敌机两倍大小
const HEAVY_HP = 3;        // 重型敌机抗三发
const HEAVY_INTERVAL = 10; // 重型敌机刷新间隔（秒）

function spawnPlayer() {
  player = createHelicopter(0x2e86ff, lanlaoProp, false);
  player.scale.setScalar(PLAYER_SCALE);
  player.userData.radius *= PLAYER_SCALE;
  player.position.set(0, -viewH / 2 + 6, 0);
  scene.add(player);
}

function spawnEnemy(heavy = false) {
  const e = createHelicopter(0xcc3333, laodaProp, true);
  if (heavy) {
    e.scale.setScalar(HEAVY_SCALE);
    e.userData.radius *= HEAVY_SCALE;
    e.userData.hp = HEAVY_HP;
  } else {
    e.userData.hp = ENEMY_HP;
  }
  e.position.set((Math.random() - 0.5) * (viewW - 6), viewH / 2 + 4, 0);
  e.userData.speed = (heavy ? 0.6 : 1) * (5 + Math.random() * 4 + Math.min(elapsed * 0.05, 6)); // 随时间加速
  e.userData.drift = (Math.random() - 0.5) * 4;
  e.userData.fireTimer = 1 + Math.random() * 2;
  scene.add(e);
  enemies.push(e);
}

const bulletGeo = new THREE.CylinderGeometry(0.15, 0.15, 1.2, 6);
const playerBulletMat = new THREE.MeshBasicMaterial({ color: 0xffee55 });
const enemyBulletMat = new THREE.MeshBasicMaterial({ color: 0xff5544 });

function firePlayerBullet() {
  const b = new THREE.Mesh(bulletGeo, playerBulletMat);
  b.position.set(player.position.x, player.position.y + 2.2, 0);
  scene.add(b);
  bullets.push(b);
}

function fireEnemyBullet(e) {
  const b = new THREE.Mesh(bulletGeo, enemyBulletMat);
  b.position.set(e.position.x, e.position.y - 2.2, 0);
  scene.add(b);
  enemyBullets.push(b);
}

function addExplosion(x, y, color) {
  const ex = createExplosion(x, y, color);
  scene.add(ex);
  explosions.push(ex);
}

function removeObj(arr, i) {
  scene.remove(arr[i]);
  arr.splice(i, 1);
}

// 敌机死亡：转为坠毁残骸 —— 起火、加速下坠、失控翻滚、螺旋桨逐渐停转
function startCrash(e) {
  e.userData.crashVy = 2;
  e.userData.crashDrift = e.userData.drift * 0.5;
  e.userData.tumble = (Math.random() < 0.5 ? -1 : 1) * (3 + Math.random() * 3);
  e.userData.rotorSpin = 3.2;
  crashing.push(e);
}

// ========== 游戏流程 ==========
function startGame() {
  // 清理旧对象
  [bullets, enemyBullets, enemies, crashing, explosions].forEach(arr => {
    arr.forEach(o => scene.remove(o));
    arr.length = 0;
  });
  if (player) scene.remove(player);

  score = 0; lives = 3; elapsed = 0;
  fireCooldown = 0; spawnTimer = 0.5; invincibleTimer = 0; heavyTimer = 6;
  scoreEl.textContent = score;
  livesEl.textContent = lives;

  spawnPlayer();
  state = 'playing';
  overlay.classList.add('hidden');

  playBgm(); // 游戏开始后循环播放背景音乐
}

function gameOver() {
  state = 'over';
  addExplosion(player.position.x, player.position.y, 0xffaa33);
  scene.remove(player);
  player = null;
  playLoseSound(); // 失败后播放 man.mp3
  overlayTitle.textContent = '游戏结束 — 得分: ' + score;
  startBtn.textContent = '重新开始';
  overlay.classList.remove('hidden');
}

function hitPlayer() {
  if (invincibleTimer > 0) return;
  lives--;
  livesEl.textContent = lives;
  addExplosion(player.position.x, player.position.y, 0xffaa33);
  if (lives <= 0) {
    gameOver();
  } else {
    invincibleTimer = 2; // 短暂无敌
  }
}

startBtn.addEventListener('click', startGame);

// ========== 碰撞检测（圆形） ==========
function collide(a, b, ra, rb) {
  const dx = a.position.x - b.position.x;
  const dy = a.position.y - b.position.y;
  const r = ra + rb;
  return dx * dx + dy * dy < r * r;
}

// ========== 主循环 ==========
const clock = new THREE.Clock();

function update(dt) {
  elapsed += dt;

  // --- 玩家移动 ---
  if (dragTarget) {
    // 拖动模式：平滑跟随指针
    const k = 1 - Math.pow(0.001, dt); // 帧率无关的平滑系数
    player.position.x += (dragTarget.x - player.position.x) * k;
    player.position.y += (dragTarget.y - player.position.y) * k;
  }
  let mx = 0, my = 0;
  if (keys['ArrowLeft'] || keys['KeyA']) mx -= 1;
  if (keys['ArrowRight'] || keys['KeyD']) mx += 1;
  if (keys['ArrowUp'] || keys['KeyW']) my += 1;
  if (keys['ArrowDown'] || keys['KeyS']) my -= 1;
  if (mx && my) { mx *= 0.7071; my *= 0.7071; }
  player.position.x = THREE.MathUtils.clamp(player.position.x + mx * PLAYER_SPEED * dt, -viewW / 2 + 2, viewW / 2 - 2);
  player.position.y = THREE.MathUtils.clamp(player.position.y + my * PLAYER_SPEED * dt, -viewH / 2 + 3, viewH / 2 - 3);

  spinPropellers(player, dt);

  // 无敌闪烁
  if (invincibleTimer > 0) {
    invincibleTimer -= dt;
    player.visible = Math.floor(invincibleTimer * 10) % 2 === 0;
    if (invincibleTimer <= 0) player.visible = true;
  }

  // --- 玩家射击（全程自动开火） ---
  fireCooldown -= dt;
  if (fireCooldown <= 0) {
    firePlayerBullet();
    fireCooldown = PLAYER_FIRE_INTERVAL;
  }

  // --- 敌机生成 ---
  spawnTimer -= dt;
  if (spawnTimer <= 0) {
    spawnEnemy();
    spawnTimer = Math.max(0.5, 1.6 - elapsed * 0.01);
  }
  // 每隔一段时间刷一架两倍大、抗三发的重型敌机
  heavyTimer -= dt;
  if (heavyTimer <= 0) {
    spawnEnemy(true);
    heavyTimer = HEAVY_INTERVAL;
  }

  // --- 子弹移动 ---
  for (let i = bullets.length - 1; i >= 0; i--) {
    bullets[i].position.y += BULLET_SPEED * dt;
    if (bullets[i].position.y > viewH / 2 + 2) removeObj(bullets, i);
  }
  for (let i = enemyBullets.length - 1; i >= 0; i--) {
    enemyBullets[i].position.y -= ENEMY_BULLET_SPEED * dt;
    if (enemyBullets[i].position.y < -viewH / 2 - 2) removeObj(enemyBullets, i);
  }

  // --- 敌机移动与射击 ---
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    e.position.y -= e.userData.speed * dt;
    e.position.x += e.userData.drift * dt;
    if (e.position.x < -viewW / 2 + 2 || e.position.x > viewW / 2 - 2) e.userData.drift *= -1;
    spinPropellers(e, dt);

    e.userData.fireTimer -= dt;
    if (e.userData.fireTimer <= 0 && e.position.y < viewH / 2 - 2) {
      fireEnemyBullet(e);
      e.userData.fireTimer = 1.5 + Math.random() * 2;
    }

    if (e.position.y < -viewH / 2 - 5) {
      removeObj(enemies, i);
      continue;
    }

    // 敌机撞玩家
    if (collide(e, player, e.userData.radius, player.userData.radius)) {
      addExplosion(e.position.x, e.position.y, 0xff5533);
      enemies.splice(i, 1); // 不直接销毁，转为坠毁
      startCrash(e);
      hitPlayer();
      if (state !== 'playing') return;
    }
  }

  // --- 我方子弹命中敌机 ---
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    let hit = false;
    for (let j = enemies.length - 1; j >= 0; j--) {
      if (collide(b, enemies[j], 0.3, enemies[j].userData.radius)) {
        enemies[j].userData.hp--;
        if (enemies[j].userData.hp <= 0) {
          const e = enemies[j];
          addExplosion(e.position.x, e.position.y, 0xff5533); // 中弹起火
          enemies.splice(j, 1); // 不直接销毁，转为坠毁动画
          startCrash(e);
          playKillSound(); // 击落时小声播放 man.mp3
          score += 100;
          scoreEl.textContent = score;
        }
        hit = true;
        break;
      }
    }
    if (hit) removeObj(bullets, i);
  }

  // --- 敌方子弹命中玩家 ---
  for (let i = enemyBullets.length - 1; i >= 0; i--) {
    if (collide(enemyBullets[i], player, 0.3, player.userData.radius)) {
      removeObj(enemyBullets, i);
      hitPlayer();
      if (state !== 'playing') return;
    }
  }

  // --- 坠毁残骸动画 ---
  for (let i = crashing.length - 1; i >= 0; i--) {
    const c = crashing[i];
    c.userData.crashVy += 22 * dt;                       // 重力加速下坠
    c.position.y -= c.userData.crashVy * dt;
    c.position.x += c.userData.crashDrift * dt;
    c.rotation.z += c.userData.tumble * dt;              // 失控翻滚
    // 螺旋桨逐渐停转
    c.userData.rotorSpin = Math.max(0, c.userData.rotorSpin - 2.5 * dt);
    c.userData.prop.rotation.z += c.userData.rotorSpin * dt;
    c.userData.tailProp.rotation.z -= c.userData.rotorSpin * dt;
    if (c.position.y < -viewH / 2 - 8) removeObj(crashing, i);
  }

  // --- 爆炸动画 ---
  for (let i = explosions.length - 1; i >= 0; i--) {
    if (updateExplosion(explosions[i], dt)) removeObj(explosions, i);
  }
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (state === 'playing' && player) update(dt);
  renderer.render(scene, camera);
}
animate();
