# TAA 实现流程对比（最开始实现 vs 当前 Effect 架构）

## 1. 对比目标

本文对比两版实现：

- **最开始实现**：`TAAPass extends Pass`，在一个 Pass 内完成场景渲染、TAA resolve、history 拷贝、最终上屏。
- **当前实现**：`TAAEffect + TemporalReprojectPass`，将“时域累积核心”与“Effect 合成层”解耦，按 `postprocessing Effect` 架构组织。

---

## 2. 最开始实现（单 TAAPass）完整流程

### 2.1 入口接线

```ts
import { EffectComposer } from 'postprocessing';
import { TAAPass } from './taa-pipeline';

const velocityPass = new VelocityPass();
const taaPass = new TAAPass(scene, camera, velocityPass);

const composer = new EffectComposer(renderer);
composer.addPass(taaPass);
```

特点：`TAAPass` 自己就是 composer 的一个完整渲染节点。

### 2.2 每帧执行顺序

`TAAPass.render()` 内部按以下顺序执行：

1. 更新 camera world matrix。
2. 若 `taaEnabled=false`：
   - 直接渲染场景到 `sceneTarget`；
   - `outputMat` 做 gamma 后直接 blit 到屏幕；
   - 返回。
3. 若 `taaEnabled=true`：
   - 计算 `currViewProj/invViewProj`；
   - 应用 jitter（`setViewOffset`）；
   - 渲染场景到 `sceneTarget`（含 depth）；
   - 清除 jitter；
   - 用 `VelocityPass` 输出 motion vectors；
   - `resolveMat` 读取 `tColor+tVelocity+tHistory` 做时域重投影融合，输出 `resolveTarget`；
   - `resolveTarget -> histB`（不做 gamma）写入历史；
   - swap `histA/histB`；
   - `resolveTarget -> screen`（做 gamma）上屏。

### 2.3 关键代码片段（旧版）

```ts
this.blit(renderer, this.resolveMat, this.resolveTarget);

this.outputMat.uniforms.tDiffuse.value = this.resolveTarget.texture;
this.outputMat.uniforms.uApplyGamma.value = 0.0;
this.blit(renderer, this.outputMat, this.histB);

[this.histA, this.histB] = [this.histB, this.histA];

this.outputMat.uniforms.tDiffuse.value = this.resolveTarget.texture;
this.outputMat.uniforms.uApplyGamma.value = 1.0;
this.blit(renderer, this.outputMat, null);
```

说明：同一个 `outputMat` 同时承担“history copy（线性）”和“最终上屏（gamma）”。

---

## 3. 当前实现（TAAEffect + TemporalReprojectPass）完整流程

### 3.1 入口接线

```ts
import { EffectComposer, EffectPass } from 'postprocessing';
import { TAAEffect } from './taa-effect';

const velocityPass = new VelocityPass();
const taaEffect = new TAAEffect(scene, camera, velocityPass);

const composer = new EffectComposer(renderer);
composer.addPass(new EffectPass(camera, taaEffect));
```

特点：`TAAEffect` 只负责 Effect 层接入；时域核心逻辑下沉到 `TemporalReprojectPass`。

### 3.2 组件职责拆分

- **TemporalReprojectPass（src/taa-pipeline.ts）**
  - 负责 jitter、scene/depth 渲染、velocity 计算、history 融合、history 回写。
  - 产出 `resolveTarget.texture` 作为“累积结果纹理”。

- **TAAEffect（src/taa-effect.ts）**
  - 在 `update(renderer, inputBuffer)` 中驱动 `TemporalReprojectPass.render(renderer)`；
  - 将 `accumulatedTexture` uniform 指向累积结果；
  - 在 `mainImage` 中输出最终颜色。

### 3.3 每帧执行顺序

1. `EffectPass` 调用 `TAAEffect.update()`。
2. `TAAEffect` 同步参数（`blendFactor/clipGamma/jitterScale/...`）到 `TemporalReprojectPass`。
3. `TemporalReprojectPass.render()` 完成与旧版一致的核心时域流程：
   - jitter -> scene/depth -> velocity -> resolve -> history copy/swap。
4. `TAAEffect` 将 `accumulatedTexture` 输出给 Effect shader。
5. Effect shader 负责最终显示变换（当前是 gamma + 输出）。

### 3.4 关键代码片段（新版）

```ts
update(renderer: WebGLRenderer, inputBuffer?: WebGLRenderTarget): void {
  this.ensureTemporalPass(inputBuffer);
  if (!this.temporalReprojectPass) return;

  this.temporalReprojectPass.taaEnabled = this.taaEnabled;
  this.temporalReprojectPass.blendFactor = this.blendFactor;
  this.temporalReprojectPass.clipGamma = this.clipGamma;
  this.temporalReprojectPass.jitterScale = this.jitterScale;
  this.temporalReprojectPass.showVelocity = this.showVelocity;
  this.temporalReprojectPass.showDiff = this.showDiff;

  this.temporalReprojectPass.render(renderer);
  this.uniforms.get('accumulatedTexture')!.value = this.temporalReprojectPass.texture;
}
```

```glsl
uniform sampler2D accumulatedTexture;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 color = texture2D(accumulatedTexture, uv).rgb;
  color = pow(max(color, vec3(0.0)), vec3(1.0 / 2.2));
  outputColor = vec4(color, 1.0);
}
```

---

## 4. 两版差异总结

## 4.1 架构层面

- 旧版：单类大一统（`TAAPass`）。
- 新版：Effect 壳层 + Temporal 核心分层，更接近 `postprocessing` 生态风格。

## 4.2 上屏路径

- 旧版：`TAAPass` 内部直接 blit 到 `null`（屏幕）。
- 新版：由 `EffectPass` 管线统一调度，`TAAEffect` 作为 Effect 节点输出。

## 4.3 可扩展性

- 旧版：后续叠加其他 Effect 时耦合更重。
- 新版：与其他 Effect 组合更自然（同属 EffectPass 体系）。

---

## 5. 本次“抖动变明显”问题的直接原因

迁移初版里，`TAAEffect` 输出用的是：

```glsl
outputColor = vec4(color, inputColor.a);
```

在 `EffectPass` 合成链中，这会把输出权重绑定到 `inputColor.a`，导致 TAA 结果并非稳定全量覆盖，视觉上会放大抖动感。

修复为：

```glsl
outputColor = vec4(color, 1.0);
```

即固定 alpha 为 1，确保输出覆盖稳定，抖动感明显下降。

---

## 6. 两版流程图（简化）

### 旧版

```text
Scene -> TAAPass
         ├─ jitter + render scene/depth
         ├─ velocity
         ├─ resolve(current + history)
         ├─ copy resolve -> history
         └─ gamma + blit -> screen
```

### 新版

```text
Scene -> TemporalReprojectPass (inside TAAEffect.update)
         ├─ jitter + render scene/depth
         ├─ velocity
         ├─ resolve(current + history)
         └─ copy resolve -> history

TAAEffect.mainImage(accumulatedTexture) -> EffectPass -> screen
```

---

## 7. 当前结论

- 核心 TAA 算法（resolve/history/velocity）没有被推翻，主要变化是**渲染职责分层**。
- 新架构更贴近 `realism-effects` 的组织方式，后续可继续增加 TRAA 相关参数（如 confidence/neighborhood clamp）而不必重构主链路。
