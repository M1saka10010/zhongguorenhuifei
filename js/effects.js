import * as THREE from 'three';

const EXPLOSION_LIFE = 0.6;

// 生成爆炸粒子组，返回带 life/parts 的 Group，由调用方加入场景与数组
export function createExplosion(x, y, color) {
  const group = new THREE.Group();
  const parts = [];
  for (let i = 0; i < 14; i++) {
    const p = new THREE.Mesh(
      new THREE.SphereGeometry(0.25 + Math.random() * 0.25, 6, 6),
      new THREE.MeshBasicMaterial({ color, transparent: true })
    );
    const angle = Math.random() * Math.PI * 2;
    const speed = 6 + Math.random() * 10;
    p.userData.vx = Math.cos(angle) * speed;
    p.userData.vy = Math.sin(angle) * speed;
    group.add(p);
    parts.push(p);
  }
  group.position.set(x, y, 1);
  group.userData.life = EXPLOSION_LIFE;
  group.userData.parts = parts;
  return group;
}

// 推进单个爆炸动画，返回是否已结束
export function updateExplosion(ex, dt) {
  ex.userData.life -= dt;
  const t = Math.max(ex.userData.life / EXPLOSION_LIFE, 0);
  ex.userData.parts.forEach(p => {
    p.position.x += p.userData.vx * dt;
    p.position.y += p.userData.vy * dt;
    p.material.opacity = t;
  });
  return ex.userData.life <= 0;
}

// 星空背景
export function createStars(viewW, viewH) {
  const starGeo = new THREE.BufferGeometry();
  const positions = [];
  for (let i = 0; i < 300; i++) {
    positions.push((Math.random() - 0.5) * viewW, (Math.random() - 0.5) * viewH, -5);
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0x8899bb, size: 0.15 }));
}
