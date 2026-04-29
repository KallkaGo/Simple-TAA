import './style.css';
import { LinearSRGBColorSpace, PerspectiveCamera, WebGLRenderer } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer, EffectPass } from 'postprocessing';
import { TAAEffect } from './TAAEffect';
import { VelocityPass } from './VelocityPass';
import { buildTestScene } from './SceneBuilder';
import { mountTaaUi } from './TaaUi';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('Missing #app root element.');
}

const overlay = document.createElement('div');
overlay.id = 'overlay';
document.body.appendChild(overlay);

const ui = mountTaaUi(overlay);

const renderer = new WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(1);
renderer.outputColorSpace = LinearSRGBColorSpace;
app.appendChild(renderer.domElement);

const camera = new PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(5, 3, 5);
camera.lookAt(0, 0, 0);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.target.set(0, 0, 0);

const { scene, group, cube1, cube2, sphere, torus, wireSphere } = buildTestScene();

const velocityPass = new VelocityPass();
const taaEffect = new TAAEffect(scene, camera, velocityPass);

const composer = new EffectComposer(renderer);
composer.addPass(new EffectPass(camera, taaEffect));

let autoRotate = true;
let lastTime = performance.now();
let frameCount = 0;

ui.enableTAA.addEventListener('change', () => {
  taaEffect.taaEnabled = ui.enableTAA.checked;
  taaEffect.resetHistory();
});

ui.blendFactor.addEventListener('input', () => {
  taaEffect.blendFactor = Number.parseFloat(ui.blendFactor.value);
  ui.blendVal.textContent = taaEffect.blendFactor.toFixed(2);
});

ui.clipGamma.addEventListener('input', () => {
  taaEffect.clipGamma = Number.parseFloat(ui.clipGamma.value);
  ui.clipVal.textContent = taaEffect.clipGamma.toFixed(1);
});

ui.jitterScale.addEventListener('input', () => {
  taaEffect.jitterScale = Number.parseFloat(ui.jitterScale.value);
  ui.jitterVal.textContent = taaEffect.jitterScale.toFixed(1);
});

ui.showVelocity.addEventListener('change', () => {
  taaEffect.showVelocity = ui.showVelocity.checked;
});

ui.showDiff.addEventListener('change', () => {
  taaEffect.showDiff = ui.showDiff.checked;
});

ui.resetHistory.addEventListener('click', () => {
  taaEffect.resetHistory();
});

ui.toggleRotate.addEventListener('click', () => {
  autoRotate = !autoRotate;
  ui.toggleRotate.textContent = autoRotate ? 'Stop Auto-Rotate' : 'Start Auto-Rotate';
});

window.addEventListener('resize', () => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  composer.setSize(width, height);
});

const animate = (): void => {
  requestAnimationFrame(animate);

  frameCount += 1;
  const now = performance.now();

  if (now - lastTime >= 1000) {
    const fps = Math.round((frameCount * 1000) / (now - lastTime));
    frameCount = 0;
    lastTime = now;
    ui.fpsEl.textContent = String(fps);
  }

  if (autoRotate) {
    const t = now * 0.001;
    group.rotation.y += 0.005;
    cube1.rotation.x = t * 0.7;
    cube1.rotation.z = t * 0.5;
    cube2.rotation.y = t * 0.9;
    torus.rotation.x = t * 1.2;
    wireSphere.rotation.y = t * 0.8;
    sphere.position.y = 0.5 + Math.sin(t) * 0.3;
  }

  controls.update();
  camera.updateProjectionMatrix();
  composer.render();
};

animate();
