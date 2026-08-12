import * as THREE from 'three';

// 素材是单片扇叶，孔在图片右上角；两片扇叶绕孔互成 180° 拼成一副旋翼
// propInfo: { tex, holeX, holeY, aspect }  holeX/holeY 为孔心归一化坐标（左上角原点），aspect = 图高/图宽
// size: 扇叶贴图的高度（世界单位）
function createRotor(propInfo, size) {
  const { tex, holeX, holeY, aspect } = propInfo;
  const rotor = new THREE.Group();
  const planeH = size;
  const planeW = size / aspect;
  const geo = new THREE.PlaneGeometry(planeW, planeH);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });

  for (let i = 0; i < 2; i++) {
    // pivot 位于旋翼轴心；扇叶网格偏移，使孔心正好落在 pivot 原点
    const pivot = new THREE.Group();
    const blade = new THREE.Mesh(geo, mat);
    blade.position.set(-(holeX - 0.5) * planeW, -(0.5 - holeY) * planeH, 0);
    pivot.add(blade);
    pivot.rotation.z = i * Math.PI; // 第二片扇叶旋转 180°
    rotor.add(pivot);
  }
  return rotor;
}

// 构建一架直升机：机身 + 驾驶舱 + 尾梁 + 旋转螺旋桨贴图
// bodyColor: 机身颜色; propInfo: 螺旋桨贴图信息; facingDown: 敌机朝下
export function createHelicopter(bodyColor, propInfo, facingDown) {
  const group = new THREE.Group();

  // 机身
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 2.6, 0.6),
    new THREE.MeshBasicMaterial({ color: bodyColor })
  );
  group.add(body);

  // 机头（驾驶舱）
  const nose = new THREE.Mesh(
    new THREE.SphereGeometry(0.7, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0x99ccff })
  );
  nose.position.y = facingDown ? -1.3 : 1.3;
  nose.scale.z = 0.5;
  group.add(nose);

  // 尾梁
  const tail = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 2.0, 0.4),
    new THREE.MeshBasicMaterial({ color: bodyColor })
  );
  tail.position.y = facingDown ? 2.0 : -2.0;
  group.add(tail);

  // 尾翼
  const fin = new THREE.Mesh(
    new THREE.BoxGeometry(0.15, 0.9, 0.8),
    new THREE.MeshBasicMaterial({ color: bodyColor })
  );
  fin.position.y = facingDown ? 2.9 : -2.9;
  group.add(fin);

  // 主旋翼（两片扇叶，绕孔持续旋转）
  const prop = createRotor(propInfo, 3.4);
  prop.position.z = 0.8;
  group.add(prop);

  // 尾桨（两片小扇叶）
  const tailProp = createRotor(propInfo, 0.85);
  tailProp.position.set(0, facingDown ? 2.9 : -2.9, 0.8);
  group.add(tailProp);

  group.userData.prop = prop;
  group.userData.tailProp = tailProp;
  group.userData.radius = 1.6; // 碰撞半径
  return group;
}

// 更新直升机螺旋桨旋转动画
export function spinPropellers(heli, dt) {
  heli.userData.prop.rotation.z += dt * 3.2;
  heli.userData.tailProp.rotation.z -= dt * 4;
}

// ========== 坠毁残骸灰度化 ==========
const grayTexCache = new Map();

// 把贴图去色成灰度版本（canvas 逐像素处理，带缓存）
function grayscaleOf(tex) {
  if (grayTexCache.has(tex)) return grayTexCache.get(tex);
  const img = tex.image;
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height);
  const px = d.data;
  for (let i = 0; i < px.length; i += 4) {
    const l = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    px[i] = px[i + 1] = px[i + 2] = l;
  }
  ctx.putImageData(d, 0, 0);
  const gt = new THREE.CanvasTexture(c);
  gt.colorSpace = THREE.SRGBColorSpace;
  grayTexCache.set(tex, gt);
  return gt;
}

// 把整架直升机换成灰度材质（坠毁时用）：纯色部件变灰，贴图部件换灰度纹理
export function applyGrayscale(group) {
  group.traverse(obj => {
    if (!obj.isMesh) return;
    const m = obj.material;
    obj.material = m.map
      ? new THREE.MeshBasicMaterial({ map: grayscaleOf(m.map), transparent: true, depthWrite: false })
      : new THREE.MeshBasicMaterial({ color: 0x666666 });
  });
}
