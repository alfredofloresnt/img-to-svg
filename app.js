/**
 * IMG to SVG UI — single-image, debounced live re-trace + inline expand.
 */

import { DEFAULT_SETTINGS, vectorize, exportSvg } from './js/pipeline.js';

const $ = (id) => document.getElementById(id);
const HEAVY_DEBOUNCE_MS = 250;

const els = {
  dropzone: $('dropzone'),
  fileInput: $('fileInput'),
  statusChip: $('statusChip'),
  fileMeta: $('fileMeta'),
  srcCanvas: $('srcCanvas'),
  srcEmpty: $('srcEmpty'),
  svgPreview: $('svgPreview'),
  outEmpty: $('outEmpty'),
  svgCode: $('svgCode'),
  previewStage: $('previewStage'),
  btnDownload: $('btnDownload'),
  btnCopy: $('btnCopy'),
  btnExpandSrc: $('btnExpandSrc'),
  btnExpandOut: $('btnExpandOut'),
  statBytes: $('statBytes'),
  statPaths: $('statPaths'),
  statNodes: $('statNodes'),
  statView: $('statView'),
  colorMode: $('colorMode'),
  colorCount: $('colorCount'),
  colorCountVal: $('colorCountVal'),
  smoothing: $('smoothing'),
  smoothingVal: $('smoothingVal'),
  cornerThreshold: $('cornerThreshold'),
  cornerVal: $('cornerVal'),
  detailLevel: $('detailLevel'),
  detailVal: $('detailVal'),
  speckleSize: $('speckleSize'),
  speckleVal: $('speckleVal'),
  pathOverlap: $('pathOverlap'),
  pathOverlapVal: $('pathOverlapVal'),
  removeBackground: $('removeBackground'),
  backgroundThreshold: $('backgroundThreshold'),
  bgThreshVal: $('bgThreshVal'),
  strokeMode: $('strokeMode'),
  strokeWidth: $('strokeWidth'),
  strokeWidthVal: $('strokeWidthVal'),
  outWidth: $('outWidth'),
  outHeight: $('outHeight'),
  minify: $('minify'),
};

/** @type {{ name: string, imageData: ImageData, model: object|null, svg: string|null, stats: object|null } | null} */
let current = null;
let currentSvg = '';
/** @type {null | 'src' | 'out'} */
let expandMode = null;
let heavyTimer = null;
let convertGen = 0;

function readSettings() {
  return {
    ...DEFAULT_SETTINGS,
    colorMode: els.colorMode.value,
    colorCount: Number(els.colorCount.value),
    smoothing: Number(els.smoothing.value),
    cornerThreshold: Number(els.cornerThreshold.value),
    detailLevel: Number(els.detailLevel.value),
    speckleSize: Number(els.speckleSize.value),
    pathOverlap: Number(els.pathOverlap.value),
    removeBackground: els.removeBackground.checked,
    backgroundThreshold: Number(els.backgroundThreshold.value),
    strokeMode: els.strokeMode.checked,
    strokeWidth: Number(els.strokeWidth.value),
    outWidth: Number(els.outWidth.value) || 0,
    outHeight: Number(els.outHeight.value) || 0,
    minify: els.minify.checked,
  };
}

function updateLabels() {
  els.colorCountVal.textContent = els.colorCount.value;
  els.smoothingVal.textContent = els.smoothing.value;
  els.cornerVal.textContent = `${els.cornerThreshold.value}°`;
  els.detailVal.textContent = els.detailLevel.value;
  els.speckleVal.textContent = `${els.speckleSize.value} px`;
  els.pathOverlapVal.textContent = `${els.pathOverlap.value} px`;
  els.bgThreshVal.textContent = els.backgroundThreshold.value;
  els.strokeWidthVal.textContent = els.strokeWidth.value;
  els.colorCount.disabled = els.colorMode.value === 'bw';
}

function setStatus(text, mode = '') {
  els.statusChip.textContent = text;
  els.statusChip.className = 'meta-chip' + (mode ? ` ${mode}` : '');
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function fileToImageData(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const maxDim = 1200;
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      const scale = Math.min(1, maxDim / Math.max(w, h));
      w = Math.max(1, Math.round(w * scale));
      h = Math.max(1, Math.round(h * scale));

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(ctx.getImageData(0, 0, w, h));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Failed to load ${file.name}`));
    };
    img.src = url;
  });
}

function showSource(imageData) {
  const c = els.srcCanvas;
  c.width = imageData.width;
  c.height = imageData.height;
  c.getContext('2d').putImageData(imageData, 0, 0);
  els.srcEmpty.hidden = true;
  els.btnExpandSrc.disabled = false;
}

function showSvg(svg, stats) {
  currentSvg = svg || '';
  els.svgCode.textContent = currentSvg;

  const body = els.svgPreview;
  [...body.querySelectorAll('svg')].forEach((n) => n.remove());

  if (!svg) {
    els.outEmpty.hidden = false;
    els.btnDownload.disabled = true;
    els.btnCopy.disabled = true;
    els.btnExpandOut.disabled = true;
    els.statBytes.textContent = '—';
    els.statPaths.textContent = '—';
    els.statNodes.textContent = '—';
    els.statView.textContent = '—';
    if (expandMode === 'out') setExpandMode(null);
    return;
  }

  els.outEmpty.hidden = true;
  const wrap = document.createElement('div');
  wrap.innerHTML = svg.trim();
  const svgEl = wrap.querySelector('svg');
  if (svgEl) {
    svgEl.removeAttribute('width');
    svgEl.removeAttribute('height');
    body.appendChild(svgEl);
  }

  els.btnDownload.disabled = false;
  els.btnCopy.disabled = false;
  els.btnExpandOut.disabled = false;

  if (stats) {
    els.statBytes.textContent = formatBytes(stats.bytes);
    els.statPaths.textContent = String(stats.pathCount);
    els.statNodes.textContent = String(stats.nodeCount);
    els.statView.textContent = `${Math.round(stats.width)}×${Math.round(stats.height)}`;
  }
}

async function loadFile(file) {
  if (!file) return;
  const ok =
    /^image\/(png|jpeg|webp|bmp)$/i.test(file.type) ||
    /\.(png|jpe?g|webp|bmp)$/i.test(file.name);
  if (!ok) return;

  setStatus('LOADING', 'busy');
  try {
    const imageData = await fileToImageData(file);
    current = { name: file.name, imageData, model: null, svg: null, stats: null };
    showSource(imageData);
    els.fileMeta.textContent = `${file.name} · ${imageData.width}×${imageData.height}`;
    showSvg(null);
    setStatus('READY');
    await convertActive();
  } catch (err) {
    console.error(err);
    setStatus('ERROR');
    alert(`Failed to load image: ${err.message}`);
  }
}

async function convertActive() {
  if (!current) return;
  const item = current;
  const settings = readSettings();
  const gen = ++convertGen;

  setStatus('TRACING', 'busy');
  await new Promise((r) => setTimeout(r, 16));
  if (gen !== convertGen) return;

  try {
    const t0 = performance.now();
    const model = vectorize(item.imageData, settings);
    if (gen !== convertGen || current !== item) return;

    const exported = exportSvg(model, settings);
    item.model = model;
    item.svg = exported.svg;
    item.stats = exported.stats;
    item.model.settings = { ...settings };

    showSvg(item.svg, item.stats);
    setStatus('TRACED', 'ok');
    els.fileMeta.textContent = `${item.name} · ${Math.round(performance.now() - t0)} ms`;
  } catch (err) {
    if (gen !== convertGen) return;
    console.error(err);
    setStatus('ERROR');
    alert(`Conversion failed: ${err.message}`);
  }
}

function scheduleHeavyConvert() {
  clearTimeout(heavyTimer);
  if (!current) return;
  convertGen++;
  setStatus('PENDING', 'busy');
  heavyTimer = setTimeout(() => {
    convertActive();
  }, HEAVY_DEBOUNCE_MS);
}

function liveExport() {
  if (!current?.model) return;
  const settings = readSettings();
  const exported = exportSvg(current.model, settings);
  current.svg = exported.svg;
  current.stats = exported.stats;
  current.model.settings = { ...current.model.settings, ...settings };
  showSvg(current.svg, current.stats);
}

function onHeavyChange() {
  updateLabels();
  scheduleHeavyConvert();
}

function onLiveChange() {
  updateLabels();
  liveExport();
}

function setExpandMode(mode) {
  const stage = els.previewStage;
  stage.classList.remove('expand-src', 'expand-out');

  if (mode === 'src' && current) {
    expandMode = 'src';
    stage.classList.add('expand-src');
  } else if (mode === 'out' && currentSvg) {
    expandMode = 'out';
    stage.classList.add('expand-out');
  } else {
    expandMode = null;
  }

  els.btnExpandSrc.textContent = expandMode === 'src' ? 'Collapse' : 'Expand';
  els.btnExpandOut.textContent = expandMode === 'out' ? 'Collapse' : 'Expand';
  els.btnExpandSrc.setAttribute('aria-pressed', expandMode === 'src' ? 'true' : 'false');
  els.btnExpandOut.setAttribute('aria-pressed', expandMode === 'out' ? 'true' : 'false');
}

function toggleExpand(which) {
  if (expandMode === which) setExpandMode(null);
  else setExpandMode(which);
}

els.dropzone.addEventListener('click', () => els.fileInput.click());
els.dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    els.fileInput.click();
  }
});
els.fileInput.addEventListener('change', () => {
  const file = els.fileInput.files?.[0];
  if (file) loadFile(file);
  els.fileInput.value = '';
});

['dragenter', 'dragover'].forEach((ev) => {
  els.dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    els.dropzone.classList.add('dragover');
  });
});
['dragleave', 'drop'].forEach((ev) => {
  els.dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    els.dropzone.classList.remove('dragover');
  });
});
els.dropzone.addEventListener('drop', (e) => {
  const file = e.dataTransfer?.files?.[0];
  if (file) loadFile(file);
});

document.querySelectorAll('[data-heavy]').forEach((el) => {
  el.addEventListener('input', onHeavyChange);
  el.addEventListener('change', onHeavyChange);
});

document.querySelectorAll('[data-live]').forEach((el) => {
  el.addEventListener('input', onLiveChange);
  el.addEventListener('change', onLiveChange);
});

els.btnDownload.addEventListener('click', () => {
  if (!currentSvg) return;
  const name = (current?.name || 'trace').replace(/\.[^.]+$/, '') + '.svg';
  const blob = new Blob([currentSvg], { type: 'image/svg+xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
});

els.btnCopy.addEventListener('click', async () => {
  if (!currentSvg) return;
  try {
    await navigator.clipboard.writeText(currentSvg);
    setStatus('COPIED', 'ok');
    setTimeout(() => setStatus('TRACED', 'ok'), 900);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = currentSvg;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    setStatus('COPIED', 'ok');
  }
});

els.btnExpandSrc.addEventListener('click', () => toggleExpand('src'));
els.btnExpandOut.addEventListener('click', () => toggleExpand('out'));

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && expandMode) {
    e.preventDefault();
    setExpandMode(null);
  }
});

updateLabels();
