import {
  HalfFloatType,
  Matrix4,
  Mesh,
  NearestFilter,
  NoBlending,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
  type DepthTexture,
  type Texture,
  type WebGLRenderer,
} from 'three';

class VelocityMaterial extends ShaderMaterial {
  constructor() {
    super({
      blending: NoBlending,
      depthWrite: false,
      depthTest: false,
      uniforms: {
        tDepth: { value: null },
        uInvTexSize: { value: new Vector2() },
        uInvViewProj: { value: new Matrix4() },
        uPrevViewProj: { value: new Matrix4() },
        uFirstFrame: { value: 1.0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 1.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDepth;
        uniform vec2 uInvTexSize;
        uniform mat4 uInvViewProj;
        uniform mat4 uPrevViewProj;
        uniform float uFirstFrame;

        varying vec2 vUv;

        vec3 reconstructWorldPos(vec2 uv, float depth) {
          float z = depth * 2.0 - 1.0;
          vec4 clip = vec4(uv * 2.0 - 1.0, z, 1.0);
          vec4 wp = uInvViewProj * clip;
          return wp.xyz / wp.w;
        }

        void main() {
          if (uFirstFrame > 0.5) {
            gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
            return;
          }

          float closestDepth = 1.0;
          vec2 closestUV = vUv;

          for (int x = -1; x <= 1; x++) {
            for (int y = -1; y <= 1; y++) {
              vec2 sUV = vUv + vec2(float(x), float(y)) * uInvTexSize;
              float d = texture2D(tDepth, sUV).r;
              if (d < closestDepth) {
                closestDepth = d;
                closestUV = sUV;
              }
            }
          }

          if (closestDepth >= 1.0) {
            gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
            return;
          }

          vec3 wp = reconstructWorldPos(closestUV, closestDepth);
          vec4 prevClip = uPrevViewProj * vec4(wp, 1.0);

          if (abs(prevClip.w) < 1e-6) {
            gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
            return;
          }

          vec2 prevUV = prevClip.xy / prevClip.w * 0.5 + 0.5;
          vec2 velocity = closestUV - prevUV;
          gl_FragColor = vec4(velocity, 0.0, 1.0);
        }
      `,
    });
  }
}

export class VelocityPass {
  private readonly prevViewProj = new Matrix4();
  private hasHistory = false;
  private readonly velocityMat = new VelocityMaterial();
  private rt: WebGLRenderTarget | null = null;

  private readonly quad = new Mesh(new PlaneGeometry(2, 2), this.velocityMat);
  private readonly fsScene = new Scene();
  private readonly fsCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

  constructor() {
    this.fsScene.add(this.quad);
  }

  setSize(width: number, height: number): void {
    this.rt?.dispose();
    this.rt = new WebGLRenderTarget(width, height, {
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      type: HalfFloatType,
      depthBuffer: false,
    });
    (this.velocityMat.uniforms.uInvTexSize.value as Vector2).set(1 / width, 1 / height);
  }

  get texture(): Texture | null {
    return this.rt ? this.rt.texture : null;
  }

  reset(): void {
    this.hasHistory = false;
    this.prevViewProj.identity();
  }

  render(renderer: WebGLRenderer, depthTexture: DepthTexture, invViewProj: Matrix4, currViewProj: Matrix4): void {
    if (!this.rt) {
      return;
    }

    this.velocityMat.uniforms.tDepth.value = depthTexture;
    (this.velocityMat.uniforms.uInvViewProj.value as Matrix4).copy(invViewProj);
    (this.velocityMat.uniforms.uPrevViewProj.value as Matrix4).copy(this.prevViewProj);
    this.velocityMat.uniforms.uFirstFrame.value = this.hasHistory ? 0.0 : 1.0;

    renderer.setRenderTarget(this.rt);
    renderer.clear(true, false, false);
    renderer.render(this.fsScene, this.fsCam);

    this.prevViewProj.copy(currViewProj);
    this.hasHistory = true;
  }
}
