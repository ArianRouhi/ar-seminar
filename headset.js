// AR روی هدست واقعی - نمونه اولیه
// تارگت‌ها: سه زاویه از هدست (جلو، بغل با پیچ، بغل با لوگو) در headset.mind
import * as THREE from 'three';
import { MindARThree } from 'https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image-three.prod.js';

const TARGET_COUNT = 3;
const TARGET_NAMES = ['جلوی هدست', 'بغل هدست (پیچ صدا)', 'بغل هدست (لوگو)'];
const NEON = 0x44d62c;

let started = false;
let visibleCount = 0;

function setStatus(text) {
  document.getElementById('status').textContent = text;
}

// افکت: حلقه‌های موج صدا + نت‌های شناور + هاله سبز
function buildEffect() {
  const group = new THREE.Group();
  const rings = [];
  for (let i = 0; i < 3; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: NEON, transparent: true, opacity: 0.8, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.45, 64), mat);
    ring.userData.offset = i / 3;
    group.add(ring);
    rings.push(ring);
  }

  const notes = [];
  const noteMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (let i = 0; i < 6; i++) {
    const note = new THREE.Group();
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 16), noteMat);
    head.scale.set(1.3, 1, 1);
    const stem = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.11, 0.008), noteMat);
    stem.position.set(0.04, 0.055, 0);
    note.add(head, stem);
    note.userData = { angle: (i / 6) * Math.PI * 2, speed: 0.3 + Math.random() * 0.3, phase: Math.random() };
    group.add(note);
    notes.push(note);
  }

  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(0.4, 48),
    new THREE.MeshBasicMaterial({ color: NEON, transparent: true, opacity: 0.12 })
  );
  glow.position.z = -0.01;
  group.add(glow);

  group.userData.update = (t) => {
    rings.forEach((r) => {
      const p = (t * 0.5 + r.userData.offset) % 1;
      r.scale.setScalar(0.6 + p * 1.2);
      r.material.opacity = 0.8 * (1 - p);
    });
    notes.forEach((n) => {
      const d = n.userData;
      const p = (t * d.speed + d.phase) % 1;
      const rad = 0.5 + p * 0.25;
      n.position.set(Math.cos(d.angle + t * 0.4) * rad, Math.sin(d.angle + t * 0.4) * rad, 0.05 + p * 0.3);
      n.rotation.z = Math.sin(t * 2 + d.angle) * 0.3;
      n.scale.setScalar(1 - p * 0.5);
    });
    glow.material.opacity = 0.1 + Math.sin(t * 3) * 0.05;
  };
  return group;
}

async function startAR() {
  if (started) return;
  started = true;
  document.getElementById('startScreen').style.display = 'none';
  setStatus('در حال آماده‌سازی دوربین...');

  const mindarThree = new MindARThree({
    container: document.getElementById('container'),
    imageTargetSrc: './headset.mind',
    maxTrack: 1,
    filterMinCF: 0.0005,
    filterBeta: 0.01
  });
  const { renderer, scene, camera } = mindarThree;

  const effects = [];
  for (let i = 0; i < TARGET_COUNT; i++) {
    const anchor = mindarThree.addAnchor(i);
    const fx = buildEffect();
    anchor.group.add(fx);
    effects.push(fx);
    anchor.onTargetFound = () => { visibleCount++; setStatus('پیدا شد: ' + TARGET_NAMES[i]); };
    anchor.onTargetLost = () => { visibleCount = Math.max(0, visibleCount - 1); if (!visibleCount) setStatus('دوربین را روی هدست بگیرید'); };
  }

  await mindarThree.start();
  setStatus('دوربین را روی هدست بگیرید');

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const t = clock.getElapsedTime();
    effects.forEach((fx) => fx.userData.update(t));
    renderer.render(scene, camera);
  });
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
