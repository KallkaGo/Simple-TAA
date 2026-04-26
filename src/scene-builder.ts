import {
  AmbientLight,
  BoxGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  NearestFilter,
  PlaneGeometry,
  PointLight,
  RepeatWrapping,
  Scene,
  SphereGeometry,
  TorusGeometry,
} from 'three';

interface TestSceneObjects {
  scene: Scene;
  group: Group;
  cube1: Mesh;
  cube2: Mesh;
  sphere: Mesh;
  torus: Mesh;
  wireSphere: Mesh;
}

export function buildTestScene(): TestSceneObjects {
  const scene = new Scene();
  scene.background = new Color(0x1a1a2e);

  const groundGeo = new PlaneGeometry(40, 40);
  const groundCanvas = createCheckerboardCanvas(512, 512, 16, 0xffffff, 0x222222);
  const groundTex = new CanvasTexture(groundCanvas);
  groundTex.wrapS = groundTex.wrapT = RepeatWrapping;
  groundTex.magFilter = NearestFilter;
  const groundMat = new MeshStandardMaterial({ map: groundTex, roughness: 0.8 });
  const ground = new Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1.5;
  scene.add(ground);

  const group = new Group();
  scene.add(group);

  const cube1Geo = new BoxGeometry(1.2, 1.2, 1.2);
  const cube1Mat = new MeshStandardMaterial({ color: 0xff2244, roughness: 0.3, metalness: 0.1 });
  const cube1 = new Mesh(cube1Geo, cube1Mat);
  cube1.position.set(0, 0, 0);
  group.add(cube1);

  const cube2Mat = new MeshStandardMaterial({ color: 0x2244ff, roughness: 0.3, metalness: 0.1 });
  const cube2 = new Mesh(cube1Geo, cube2Mat);
  cube2.position.set(2.5, 0, 0);
  cube2.scale.setScalar(0.8);
  group.add(cube2);

  const sphereGeo = new SphereGeometry(0.8, 32, 32);
  const sphereMat = new MeshStandardMaterial({ color: 0x22ff66, roughness: 0.2, metalness: 0.3 });
  const sphere = new Mesh(sphereGeo, sphereMat);
  sphere.position.set(-2.0, 0.5, 1.0);
  group.add(sphere);

  const torusGeo = new TorusGeometry(0.7, 0.25, 24, 48);
  const torusMat = new MeshStandardMaterial({ color: 0xffcc00, roughness: 0.3, metalness: 0.5 });
  const torus = new Mesh(torusGeo, torusMat);
  torus.position.set(0, 0, -2.0);
  group.add(torus);

  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2;
    const pillarGeo = new BoxGeometry(0.05, 3, 0.05);
    const pillarMat = new MeshStandardMaterial({
      color: new Color().setHSL(i / 8, 0.8, 0.5),
    });
    const pillar = new Mesh(pillarGeo, pillarMat);
    pillar.position.set(Math.cos(angle) * 5, 0, Math.sin(angle) * 5);
    scene.add(pillar);
  }

  const wireGeo = new IcosahedronGeometry(0.6, 2);
  const wireMat = new MeshStandardMaterial({
    color: 0xff8800,
    wireframe: true,
  });
  const wireSphere = new Mesh(wireGeo, wireMat);
  wireSphere.position.set(3.0, 1.0, -1.0);
  group.add(wireSphere);

  const ambientLight = new AmbientLight(0x404060, 0.5);
  scene.add(ambientLight);

  const dirLight = new DirectionalLight(0xffeedd, 1.5);
  dirLight.position.set(5, 8, 5);
  scene.add(dirLight);

  const pointLight1 = new PointLight(0xff4444, 15, 15);
  pointLight1.position.set(-3, 2, 3);
  scene.add(pointLight1);

  const pointLight2 = new PointLight(0x4444ff, 15, 15);
  pointLight2.position.set(3, 2, -3);
  scene.add(pointLight2);

  return { scene, group, cube1, cube2, sphere, torus, wireSphere };
}

function createCheckerboardCanvas(
  width: number,
  height: number,
  tileSize: number,
  color1: number,
  color2: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Unable to acquire 2D context for checkerboard texture.');
  }

  const c1 = `#${color1.toString(16).padStart(6, '0')}`;
  const c2 = `#${color2.toString(16).padStart(6, '0')}`;

  for (let y = 0; y < height; y += tileSize) {
    for (let x = 0; x < width; x += tileSize) {
      ctx.fillStyle = ((x / tileSize + y / tileSize) % 2 === 0) ? c1 : c2;
      ctx.fillRect(x, y, tileSize, tileSize);
    }
  }

  return canvas;
}
