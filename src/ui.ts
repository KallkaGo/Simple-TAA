import { html, render } from 'lit';

export interface TaaUiElements {
  enableTAA: HTMLInputElement;
  blendFactor: HTMLInputElement;
  blendVal: HTMLSpanElement;
  clipGamma: HTMLInputElement;
  clipVal: HTMLSpanElement;
  jitterScale: HTMLInputElement;
  jitterVal: HTMLSpanElement;
  showVelocity: HTMLInputElement;
  showDiff: HTMLInputElement;
  resetHistory: HTMLButtonElement;
  toggleRotate: HTMLButtonElement;
  fpsEl: HTMLSpanElement;
  frameCountEl: HTMLSpanElement;
}

function getElement<T extends HTMLElement>(root: ParentNode, id: string): T {
  const element = root.querySelector<T>(`#${id}`);
  if (!element) {
    throw new Error(`Missing #${id} element.`);
  }
  return element;
}

export function mountTaaUi(root: HTMLElement): TaaUiElements {
  render(
    html`
      <div id="controls">
        <h3>TAA Controls</h3>
        <label>
          <input type="checkbox" id="enableTAA" checked /> Enable TAA
        </label>
        <label>
          Blend Factor: <span class="val" id="blendVal">0.05</span>
          <input type="range" id="blendFactor" min="0.01" max="0.2" step="0.01" value="0.05" />
        </label>
        <label>
          Variance Clip Gamma: <span class="val" id="clipVal">1.0</span>
          <input type="range" id="clipGamma" min="0.5" max="3.0" step="0.1" value="1.0" />
        </label>
        <label>
          Jitter Scale: <span class="val" id="jitterVal">1.0</span>
          <input type="range" id="jitterScale" min="0.0" max="2.0" step="0.1" value="1.0" />
        </label>
        <label>
          <input type="checkbox" id="showVelocity" /> Show Motion Vectors
        </label>
        <label>
          <input type="checkbox" id="showDiff" /> Show History Diff
        </label>
        <hr class="panel-divider" />
        <button id="resetHistory">Reset History</button>
        <button id="toggleRotate">Toggle Auto-Rotate</button>
      </div>

      <div id="info">
        <div>FPS: <span id="fps">0</span></div>
        <div>Frame: <span id="frameCount">0</span></div>
      </div>
    `,
    root,
  );

  return {
    enableTAA: getElement<HTMLInputElement>(root, 'enableTAA'),
    blendFactor: getElement<HTMLInputElement>(root, 'blendFactor'),
    blendVal: getElement<HTMLSpanElement>(root, 'blendVal'),
    clipGamma: getElement<HTMLInputElement>(root, 'clipGamma'),
    clipVal: getElement<HTMLSpanElement>(root, 'clipVal'),
    jitterScale: getElement<HTMLInputElement>(root, 'jitterScale'),
    jitterVal: getElement<HTMLSpanElement>(root, 'jitterVal'),
    showVelocity: getElement<HTMLInputElement>(root, 'showVelocity'),
    showDiff: getElement<HTMLInputElement>(root, 'showDiff'),
    resetHistory: getElement<HTMLButtonElement>(root, 'resetHistory'),
    toggleRotate: getElement<HTMLButtonElement>(root, 'toggleRotate'),
    fpsEl: getElement<HTMLSpanElement>(root, 'fps'),
    frameCountEl: getElement<HTMLSpanElement>(root, 'frameCount'),
  };
}
