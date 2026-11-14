// ماشین AR - نمونه اولیه
// نشانگر: فایل targets.mind (ساخته‌شده از تصویر QR یا پوستر)

const PAINT_COLORS = [0xd32f2f, 0x1565c0, 0x2e7d32, 0xf9a825, 0xeeeeee, 0x212121];
const EXPLODE_DISTANCE = 1.2;
const EXPLODE_SPEED = 2.5; // هرچه بیشتر، انیمیشن سریع‌تر

// متن جزئیات - هرکدام را می‌توانید ویرایش کنید
const PART_DETAILS = {
  body: 'بدنه: قاب اصلی خودرو و رنگ اصلی',
  cabin: 'کابین: محل نشستن سرنشین‌ها و شیشه‌ها',
  hood: 'کاپوت: پوشش قسمت موتور',
  trunk: 'صندوق عقب: درب پشتی',
  door: 'درب‌ها: ورودی سرنشین‌ها',
  wheel: 'چرخ‌ها: تماس خودرو با زمین'
};

let colorIndex = 0;
let exploded = false;
let explodeT = 0;
let spinning = true;
let detailsVisible = false;
let started = false;

const paintMat = new THREE.MeshStandardMaterial({ color: PAINT_COLORS[0], metalness: 0.6, roughness: 0.35 });
const glassMat = new THREE.MeshStandardMaterial({ color: 0x223344, metalness: 0.9, roughness: 0.05, transparent: true, opacity: 0.85 });
const rubberMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });

const carGroup = new THREE.Group();
const parts = [];

function addPart(mesh, type, dir) {
  mesh.castShadow = false;
  carGroup.add(mesh);
  parts.push({
    mesh,
    type,
    home: mesh.position.clone(),
    target: new THREE.Vector3(),
    dir: dir.clone().normalize()
  });
}

function makePart(geometry, material, x, y, z) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  return mesh;
}

function buildCar() {
  // بدنه اصلی
  addPart(makePart(new THREE.BoxGeometry(1.6, 0.35, 3.4), paintMat, 0, 0.38, 0),
    'body', new THREE.Vector3(0, 0.3, 0));

  // کابین
  addPart(makePart(new THREE.BoxGeometry(1.3, 0.35, 1.6), glassMat, 0, 0.72, -0.2),
    'cabin', new THREE.Vector3(0, 1, 0));

  // کاپوت
  addPart(makePart(new THREE.BoxGeometry(1.5, 0.06, 0.95), paintMat, 0, 0.6, 1.2),
    'hood', new THREE.Vector3(0, 1, 1));

  // صندوق عقب
  addPart(makePart(new THREE.BoxGeometry(1.5, 0.06, 0.8), paintMat, 0, 0.6, -1.2),
    'trunk', new THREE.Vector3(0, 1, -1));

  // درب‌ها
  [-1, 1].forEach((side) => {
    addPart(makePart(new THREE.BoxGeometry(0.06, 0.3, 1.3), paintMat, side * 0.83, 0.38, -0.1),
      'door', new THREE.Vector3(side, 0, 0));
  });

  // چرخ‌ها
  [-1, 1].forEach((sx) => {
    [-1, 1].forEach((sz) => {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.18, 24), rubberMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(sx * 0.8, 0.2, sz * 1.1);
      addPart(wheel, 'wheel', new THREE.Vector3(sx, -0.3, sz * 0.5));
    });
  });

  carGroup.scale.setScalar(0.2);
  carGroup.position.y = -0.45;
}

function applyPaint() {
  paintMat.color.setHex(PAINT_COLORS[colorIndex]);
}

function setStatus(text) {
  document.getElementById('status').textContent = text;
}

function toggleExplode(btn) {
  exploded = !exploded;
  btn.textContent = exploded ? 'کنار هم قرار دادن' : 'جدا کردن قطعات';
}

function toggleDetails(btn) {
  detailsVisible = !detailsVisible;
  const box = document.getElementById('details');
  if (detailsVisible) {
    box.innerHTML = parts
      .map((p) => PART_DETAILS[p.type])
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .join('<br>');
  }
  box.style.display = detailsVisible ? 'block' : 'none';
  btn.textContent = detailsVisible ? 'بستن جزئیات' : 'جزئیات';
}

function toggleSpin(btn) {
  spinning = !spinning;
  btn.textContent = spinning ? 'توقف چرخش' : 'چرخش';
}

function update(dt) {
  if (spinning) carGroup.rotation.y += 0.01;

  const goal = exploded ? 1 : 0;
  explodeT += (goal - explodeT) * Math.min(1, EXPLODE_SPEED * dt);

  parts.forEach((p) => {
    p.target.copy(p.home).addScaledVector(p.dir, EXPLODE_DISTANCE * explodeT);
    p.mesh.position.copy(p.target);
  });
}

async function startAR() {
  if (started) return;
  started = true;
  document.getElementById('startScreen').style.display = 'none';
  document.getElementById('controls').style.display = 'flex';
  setStatus('در حال آماده‌سازی دوربین...');

  const mindarThree = new window.MINDAR.IMAGE.MindARThree({
    container: document.getElementById('container'),
    imageTargetSrc: './targets.mind'
  });
  const { renderer, scene, camera } = mindarThree;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.5));
  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.position.set(1, 2, 1);
  scene.add(sun);

  const anchor = mindarThree.addAnchor(0);
  anchor.group.add(carGroup);

  anchor.onTargetFound = () => setStatus('نشانگر پیدا شد');
  anchor.onTargetLost = () => setStatus('دوربین را روی نشانگر نگه دارید');

  await mindarThree.start();
  setStatus('دوربین را روی نشانگر نگه دارید');

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    update(clock.getDelta());
    renderer.render(scene, camera);
  });
}

buildCar();
applyPaint();

// برخی مرورگرهای داخلی اپ‌ها (مثل اینستاگرام یا تلگرام) دسترسی به دوربین ندارند
if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
  document.getElementById('browserWarning').style.display = 'block';
}

document.getElementById('startBtn').addEventListener('click', () => {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    document.getElementById('browserWarning').style.display = 'block';
    return;
  }
  startAR().catch((err) => {
    started = false;
    setStatus('خطا: ' + err.message);
  });
});

document.getElementById('colorBtn').addEventListener('click', () => {
  colorIndex = (colorIndex + 1) % PAINT_COLORS.length;
  applyPaint();
});

document.getElementById('explodeBtn').addEventListener('click', (e) => toggleExplode(e.currentTarget));
document.getElementById('detailsBtn').addEventListener('click', (e) => toggleDetails(e.currentTarget));
document.getElementById('spinBtn').addEventListener('click', (e) => toggleSpin(e.currentTarget));
