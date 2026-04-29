import {
  DepthFormat,
  DepthTexture,
  FloatType,
  HalfFloatType,
  LinearFilter,
  Matrix4,
  Mesh,
  NoBlending,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { Pass } from 'postprocessing';
import type { VelocityPass } from './VelocityPass';

const G = 1.324717957244746;
const A1 = 1.0 / G;
const A2 = 1.0 / (G * G);
const BASE = 1.1127756842787055;

const R2 = Array.from({ length: 256 }, (_, n) => [
  (BASE + A1 * n) % 1 - 0.5,
  (BASE + A2 * n) % 1 - 0.5,
]);

export class TemporalReprojectPass extends Pass {
  private readonly sceneRef: Scene;
  private readonly cameraRef: PerspectiveCamera;
  private readonly velocityPass: VelocityPass;

  taaEnabled = true;
  blendFactor = 0.05;
  clipGamma = 1.0;
  jitterScale = 1.0;
  showVelocity = false;
  showDiff = false;

  frame = 0;
  private width = 0;
  private height = 0;
  private readonly currViewProj = new Matrix4();
  private readonly invViewProj = new Matrix4();

  private sceneTarget: WebGLRenderTarget | null = null;
  private histA: WebGLRenderTarget | null = null;
  private histB: WebGLRenderTarget | null = null;
  private resolveTarget: WebGLRenderTarget | null = null;

  private readonly resolveMat = createResolveMaterial();
  private readonly copyMat = createCopyMaterial();

  private readonly quad = new Mesh(new PlaneGeometry(2, 2), this.copyMat);
  private readonly fsScene = new Scene();
  private readonly fsCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

  constructor(scene: Scene, camera: PerspectiveCamera, velocityPass: VelocityPass) {
    super('TemporalReprojectPass');

    this.sceneRef = scene;
    this.cameraRef = camera;
    this.velocityPass = velocityPass;

    this.needsSwap = false;
    this.fsScene.add(this.quad);
  }

  get texture(): Texture | null {
    return this.resolveTarget?.texture ?? null;
  }

  setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;

    this.sceneTarget?.dispose();
    this.histA?.dispose();
    this.histB?.dispose();
    this.resolveTarget?.dispose();

    const depthTex = new DepthTexture(width, height);
    depthTex.format = DepthFormat;
    depthTex.type = FloatType;

    this.sceneTarget = new WebGLRenderTarget(width, height, {
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      type: HalfFloatType,
      depthTexture: depthTex,
    });

    const historyOptions = {
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      type: HalfFloatType,
    };

    this.histA = new WebGLRenderTarget(width, height, historyOptions);
    this.histB = new WebGLRenderTarget(width, height, historyOptions);

    this.resolveTarget = new WebGLRenderTarget(width, height, {
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      type: HalfFloatType,
    });

    this.velocityPass.setSize(width, height);
    this.frame = 0;
  }

  reset(): void {
    this.frame = 0;
    this.velocityPass.reset();
  }

  render(
    renderer: WebGLRenderer,
    _inputBuffer: WebGLRenderTarget | null = null,
    _outputBuffer: WebGLRenderTarget | null = null,
    _deltaTime?: number,
    _stencilTest?: boolean,
  ): void {
    if (!this.sceneTarget || !this.histA || !this.histB || !this.resolveTarget) {
      return;
    }

    const isFirstFrame = this.frame === 0;
    this.cameraRef.updateMatrixWorld();

    if (!this.taaEnabled) {
      clearJitter(this.cameraRef);
      renderer.setRenderTarget(this.sceneTarget);
      renderer.clear(true, true, true);
      renderer.render(this.sceneRef, this.cameraRef);

      this.copyMat.uniforms.tDiffuse.value = this.sceneTarget.texture;
      this.blit(renderer, this.copyMat, this.resolveTarget);

      this.frame += 1;
      return;
    }

    this.currViewProj.multiplyMatrices(this.cameraRef.projectionMatrix, this.cameraRef.matrixWorldInverse);
    this.invViewProj.copy(this.currViewProj).invert();

    this.applyJitter();

    renderer.setRenderTarget(this.sceneTarget);
    renderer.clear(true, true, true);
    renderer.render(this.sceneRef, this.cameraRef);

    clearJitter(this.cameraRef);

    const depthTexture = this.sceneTarget.depthTexture;
    if (!depthTexture) {
      renderer.setRenderTarget(null);
      return;
    }

    this.velocityPass.setFrameData(depthTexture, this.invViewProj, this.currViewProj);
    this.velocityPass.render(renderer, null, null);

    const uniforms = this.resolveMat.uniforms;
    uniforms.tColor.value = this.sceneTarget.texture;
    uniforms.tVelocity.value = this.velocityPass.texture;
    uniforms.tDepth.value = depthTexture;
    (uniforms.uInvTexSize.value as Vector2).set(1 / this.width, 1 / this.height);
    uniforms.uBlendFactor.value = this.blendFactor;
    uniforms.uClipGamma.value = this.clipGamma;
    uniforms.uFirstFrame.value = isFirstFrame ? 1.0 : 0.0;
    uniforms.uShowVelocity.value = this.showVelocity ? 1.0 : 0.0;
    uniforms.uShowDiff.value = this.showDiff ? 1.0 : 0.0;
    uniforms.tHistory.value = this.histA.texture;

    this.blit(renderer, this.resolveMat, this.resolveTarget);

    this.copyMat.uniforms.tDiffuse.value = this.resolveTarget.texture;
    this.blit(renderer, this.copyMat, this.histB);

    [this.histA, this.histB] = [this.histB, this.histA];
    this.frame += 1;
  }

  dispose(): void {
    super.dispose();
    this.sceneTarget?.dispose();
    this.histA?.dispose();
    this.histB?.dispose();
    this.resolveTarget?.dispose();
    this.resolveMat.dispose();
    this.copyMat.dispose();
  }

  private applyJitter(): void {
    const [x, y] = R2[this.frame % R2.length];
    this.cameraRef.setViewOffset(
      this.width,
      this.height,
      x * this.jitterScale,
      y * this.jitterScale,
      this.width,
      this.height,
    );
  }

  private blit(renderer: WebGLRenderer, material: ShaderMaterial, target: WebGLRenderTarget | null): void {
    this.quad.material = material;
    renderer.setRenderTarget(target);
    renderer.render(this.fsScene, this.fsCam);
  }
}

function clearJitter(camera: PerspectiveCamera): void {
  camera.clearViewOffset();
}

function createResolveMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    blending: NoBlending,
    depthWrite: false,
    depthTest: false,
    uniforms: {
      tColor: { value: null },
      tVelocity: { value: null },
      tHistory: { value: null },
      tDepth: { value: null },
      uInvTexSize: { value: new Vector2() },
      uBlendFactor: { value: 0.05 },
      uClipGamma: { value: 1.0 },
      uFirstFrame: { value: 1.0 },
      uShowVelocity: { value: 0.0 },
      uShowDiff: { value: 0.0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 1.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tColor;
      uniform sampler2D tVelocity;
      uniform sampler2D tHistory;
      uniform sampler2D tDepth;
      uniform vec2 uInvTexSize;
      uniform float uBlendFactor;
      uniform float uClipGamma;
      uniform float uFirstFrame;
      uniform float uShowVelocity;
      uniform float uShowDiff;

      varying vec2 vUv;

      vec3 RGBtoYCoCg(vec3 c) {
        return vec3(
          c.x * 0.25 + c.y * 0.5 + c.z * 0.25,
          c.x * 0.5  - c.z * 0.5,
         -c.x * 0.25 + c.y * 0.5 - c.z * 0.25
        );
      }

      vec3 YCoCgtoRGB(vec3 c) {
        return vec3(
          c.x + c.y - c.z,
          c.x + c.z,
          c.x - c.y - c.z
        );
      }

      float Luminance(vec3 color) {
        return dot(color, vec3(0.25, 0.5, 0.25));
      }

      vec3 ToneMapSimple(vec3 color) {
        vec3 safeColor = max(color, vec3(0.0));
        return safeColor / (1.0 + Luminance(safeColor));
      }

      vec3 UnToneMapSimple(vec3 color) {
        float denom = max(1.0 - Luminance(color), 1e-4);
        return max(color, vec3(0.0)) / denom;
      }

      vec3 ClipAABBToCenter(vec3 historyColor, vec3 cMin, vec3 cMax) {
        vec3 pClip = 0.5 * (cMax + cMin);
        vec3 eClip = max(0.5 * (cMax - cMin), vec3(1e-4));
        vec3 vClip = historyColor - pClip;
        vec3 vUnit = vClip / eClip;
        vec3 aUnit = abs(vUnit);
        float maUnit = max(aUnit.x, max(aUnit.y, aUnit.z));

        if (maUnit > 1.0) {
          return pClip + vClip / maUnit;
        }

        return historyColor;
      }

      vec4 BiCubicCatmullRom5Tap(sampler2D tex, vec2 P, vec2 invTexSize) {
        vec2 Weight[3];
        vec2 Sample[3];

        vec2 UV = P / invTexSize;
        vec2 tc = floor(UV - 0.5) + 0.5;
        vec2 f = UV - tc;
        vec2 f2 = f * f;
        vec2 f3 = f2 * f;

        vec2 w0 = f2 - 0.5 * (f3 + f);
        vec2 w1 = 1.5 * f3 - 2.5 * f2 + vec2(1.0);
        vec2 w3 = 0.5 * (f3 - f2);
        vec2 w2 = vec2(1.0) - w0 - w1 - w3;

        Weight[0] = w0;
        Weight[1] = w1 + w2;
        Weight[2] = w3;

        Sample[0] = tc - vec2(1.0);
        Sample[1] = tc + w2 / max(Weight[1], vec2(1e-6));
        Sample[2] = tc + vec2(2.0);

        Sample[0] *= invTexSize;
        Sample[1] *= invTexSize;
        Sample[2] *= invTexSize;

        float sampleWeight[5];
        sampleWeight[0] = Weight[1].x * Weight[0].y;
        sampleWeight[1] = Weight[0].x * Weight[1].y;
        sampleWeight[2] = Weight[1].x * Weight[1].y;
        sampleWeight[3] = Weight[2].x * Weight[1].y;
        sampleWeight[4] = Weight[1].x * Weight[2].y;

        vec4 Ct = texture2D(tex, vec2(Sample[1].x, Sample[0].y)) * sampleWeight[0];
        vec4 Cl = texture2D(tex, vec2(Sample[0].x, Sample[1].y)) * sampleWeight[1];
        vec4 Cc = texture2D(tex, vec2(Sample[1].x, Sample[1].y)) * sampleWeight[2];
        vec4 Cr = texture2D(tex, vec2(Sample[2].x, Sample[1].y)) * sampleWeight[3];
        vec4 Cb = texture2D(tex, vec2(Sample[1].x, Sample[2].y)) * sampleWeight[4];

        float weightSum = sampleWeight[0] + sampleWeight[1] + sampleWeight[2] + sampleWeight[3] + sampleWeight[4];
        float weightMultiplier = 1.0 / max(weightSum, 1e-6);

        return max((Ct + Cl + Cc + Cr + Cb) * weightMultiplier, vec4(0.0));
      }

      void main() {
        vec3 currentColor = texture2D(tColor, vUv).rgb;

        if (uFirstFrame > 0.5) {
          gl_FragColor = vec4(currentColor, 1.0);
          return;
        }

        vec2 velocity = texture2D(tVelocity, vUv).rg;

        if (uShowVelocity > 0.5) {
          gl_FragColor = vec4(abs(velocity) * 50.0, 0.0, 1.0);
          return;
        }

        vec2 historyUV = vUv - velocity;
        if (historyUV.x < 0.0 || historyUV.x > 1.0 || historyUV.y < 0.0 || historyUV.y > 1.0) {
          gl_FragColor = vec4(currentColor, 1.0);
          return;
        }

        vec3 historyColor = BiCubicCatmullRom5Tap(tHistory, historyUV, uInvTexSize).rgb;
        vec3 currentTonemappedYCoCg = RGBtoYCoCg(ToneMapSimple(currentColor));
        vec3 historyTonemappedYCoCg = RGBtoYCoCg(ToneMapSimple(historyColor));

        vec3 m1 = vec3(0.0);
        vec3 m2 = vec3(0.0);

        for (int x = -1; x <= 1; x++) {
          for (int y = -1; y <= 1; y++) {
            vec2 sUV = vUv + vec2(float(x), float(y)) * uInvTexSize;
            vec3 c = RGBtoYCoCg(ToneMapSimple(texture2D(tColor, sUV).rgb));
            m1 += c;
            m2 += c * c;
          }
        }

        float n = 9.0;
        vec3 mu = m1 / n;
        vec3 sigma = sqrt(abs(m2 / n - mu * mu));

        vec3 cMin = mu - uClipGamma * sigma;
        vec3 cMax = mu + uClipGamma * sigma;

        vec3 center = currentTonemappedYCoCg;
        float chromaExtent = 0.125 * (cMax.x - cMin.x);
        cMin.yz = center.yz - chromaExtent;
        cMax.yz = center.yz + chromaExtent;

        vec3 clippedHistoryTonemappedYCoCg = ClipAABBToCenter(historyTonemappedYCoCg, cMin, cMax);
        historyColor = UnToneMapSimple(YCoCgtoRGB(clippedHistoryTonemappedYCoCg));
        currentColor = UnToneMapSimple(YCoCgtoRGB(currentTonemappedYCoCg));

        float lum0 = Luminance(currentColor);
        float lum1 = Luminance(historyColor);
        float diff = abs(lum0 - lum1) / max(lum0, max(lum1, 0.2));
        float w = 1.0 - diff;
        float kFeedback = mix(1.0 - uBlendFactor * 2.0, 1.0 - uBlendFactor * 0.5, w * w);

        vec3 result = mix(currentColor, historyColor, kFeedback);

        if (uShowDiff > 0.5) {
          float d = length(currentColor - historyColor);
          result = vec3(d * 10.0);
        }

        gl_FragColor = vec4(result, 1.0);
      }
    `,
  });
}

function createCopyMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    blending: NoBlending,
    depthWrite: false,
    depthTest: false,
    uniforms: {
      tDiffuse: { value: null as Texture | null },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 1.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      varying vec2 vUv;

      void main() {
        gl_FragColor = texture2D(tDiffuse, vUv);
      }
    `,
  });
}
