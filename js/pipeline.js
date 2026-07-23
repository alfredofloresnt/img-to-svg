/**
 * Vectorization pipeline orchestrator.
 * Full vectorize on setting changes (UI debounces); stroke/fill/scale/minify re-serialize only.
 */

import { preprocess } from './preprocess.js';
import { quantize } from './quantize.js';
import { buildLayers, suppressSpeckles, dilateBitmap } from './layers.js';
import { traceContours, contoursToGeometry } from './trace.js';
import { smoothContours } from './smoothContours.js';
import { simplifyContours } from './simplify.js';
import { fitLayerContours } from './fitCurves.js';
import { buildSvg } from './svg.js';
import { minifySvg } from './minify.js';

/**
 * Default tunable settings — each maps to a pipeline stage parameter.
 */
export const DEFAULT_SETTINGS = {
  colorMode: 'color', // 'bw' | 'grayscale' | 'color'
  colorCount: 8,
  smoothing: 62, // 0–100 → Chaikin anti-staircase + curve looseness
  cornerThreshold: 32, // degrees of deviation from straight that preserve a corner
  detailLevel: 78, // 1–100 → RDP + curve-fit error (avoid hugging pixel stairs)
  speckleSize: 6, // min component area in pixels
  pathOverlap: 1, // dilate each color layer (px) to close gaps between fills
  seamStroke: 0.65, // matching hairline stroke on fills (source px)
  removeBackground: true,
  backgroundThreshold: 36,
  strokeMode: false,
  strokeWidth: 1.25,
  outWidth: 0, // 0 = use source width
  outHeight: 0,
  minify: false,
  blurRadius: 0,
};

/**
 * Run full vectorization (stages 1–6). Returns fitted geometry for cheap re-export.
 */
export function vectorize(imageData, settings = {}) {
  const s = { ...DEFAULT_SETTINGS, ...settings };

  // 1. Preprocess
  const prepared = preprocess(imageData, {
    removeBackground: s.removeBackground,
    backgroundThreshold: s.backgroundThreshold,
    blurRadius: s.blurRadius,
  });

  // 2. Quantize
  const quantized = quantize(prepared, s.colorMode, s.colorCount);

  // 3. Layers → speckles → dilate (overlap neighbors so fills don't show gaps)
  const rawLayers = buildLayers(quantized);
  const layers = rawLayers.map((layer) => {
    const cleaned = suppressSpeckles(
      layer.bitmap,
      layer.width,
      layer.height,
      s.speckleSize
    );
    const grown = dilateBitmap(
      cleaned,
      layer.width,
      layer.height,
      s.pathOverlap
    );
    return { ...layer, bitmap: grown };
  });

  // 4–7. Trace → anti-staircase smooth → simplify → fit curves
  const fitted = [];
  for (const layer of layers) {
    const raw = contoursToGeometry(
      traceContours(layer.bitmap, layer.width, layer.height)
    );
    const smoothed = smoothContours(raw, s.smoothing, s.cornerThreshold);
    const simplified = simplifyContours(
      smoothed,
      s.detailLevel,
      layer.width,
      layer.height
    );
    // Drop tiny rings by bounding area after simplify
    const filtered = simplified.filter((c) => {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of c.points) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      return (maxX - minX) * (maxY - minY) >= Math.max(1, s.speckleSize * 0.25);
    });

    const rings = fitLayerContours(
      filtered,
      s.cornerThreshold,
      s.smoothing,
      s.detailLevel
    );
    if (rings.length) {
      // One compound path per color layer so holes share evenodd fill with outers
      const compound = rings.flat();
      fitted.push({ color: layer.color, paths: [compound] });
    }
  }

  return {
    layers: fitted,
    srcWidth: imageData.width,
    srcHeight: imageData.height,
    settings: { ...s },
  };
}

/**
 * Cheap stage: serialize cached geometry with stroke/fill/scale/minify.
 */
export function exportSvg(model, settingsOverride = {}) {
  if (!model) return null;
  const s = { ...DEFAULT_SETTINGS, ...model.settings, ...settingsOverride };
  const outWidth = s.outWidth > 0 ? s.outWidth : model.srcWidth;
  const outHeight = s.outHeight > 0 ? s.outHeight : model.srcHeight;

  const { svg, stats } = buildSvg(model.layers, {
    srcWidth: model.srcWidth,
    srcHeight: model.srcHeight,
    outWidth,
    outHeight,
    strokeMode: s.strokeMode,
    strokeWidth: s.strokeWidth,
    seamStroke: s.strokeMode ? 0 : s.seamStroke,
    precision: s.minify ? 1 : 2,
    pretty: !s.minify,
  });

  const finalSvg = s.minify ? minifySvg(svg, 1) : svg;
  return {
    svg: finalSvg,
    stats: {
      ...stats,
      bytes: new TextEncoder().encode(finalSvg).length,
    },
  };
}

/** Full convert + export in one call. */
export function convert(imageData, settings = {}) {
  const model = vectorize(imageData, settings);
  const exported = exportSvg(model, settings);
  return { model, ...exported };
}
