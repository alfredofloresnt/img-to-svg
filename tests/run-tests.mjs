/**
 * Node test runner — compares synthetic raster inputs to vector outputs.
 * Usage: node tests/run-tests.mjs
 */

import { convert } from '../js/pipeline.js';
import { rdp } from '../js/simplify.js';
import {
  quantize,
  coalesceByDistance,
  selectByFrequencyAndDistance,
} from '../js/quantize.js';
import { createImageData, setPixel } from './fixtures.js';
import { suppressSpeckles, dilateBitmap } from '../js/layers.js';
import { traceContours } from '../js/trace.js';
import { minifySvg } from '../js/minify.js';
import {
  solidSquare,
  solidCircle,
  twoColorMark,
  speckledSquare,
  ringWithHole,
} from './fixtures.js';
import { coverageScore, assertValidSvg } from './compare.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
  }
}

function approx(a, b, tol) {
  if (Math.abs(a - b) > tol) {
    throw new Error(`Expected ${a} ≈ ${b} (tol ${tol})`);
  }
}

function gt(a, b, label = 'value') {
  if (!(a > b)) throw new Error(`${label}: expected ${a} > ${b}`);
}

console.log('\nIMG to SVG pipeline tests\n');

console.log('Unit — simplify / quantize / speckles / minify');
test('RDP reduces colinear polyline', () => {
  const pts = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 2, y: 0 },
    { x: 3, y: 0 },
    { x: 3, y: 0 },
  ];
  const out = rdp(pts, 0.1);
  if (out.length > 3) throw new Error(`Expected ≤3 points, got ${out.length}`);
});

test('BW quantize finds ink pixels on square', () => {
  const img = solidSquare(48, 10);
  const q = quantize(img, 'bw');
  let ink = 0;
  for (let i = 0; i < q.indices.length; i++) if (q.indices[i] === 0) ink++;
  gt(ink, 100, 'ink count');
});

test('Palette picks most frequent distinct colors by distance', () => {
  // Many near-black + many orange + rare blue noise
  const entries = [
    { r: 10, g: 10, b: 12, count: 500 },
    { r: 14, g: 12, b: 10, count: 80 }, // near black — should coalesce/skip
    { r: 232, g: 93, b: 4, count: 300 },
    { r: 228, g: 100, b: 10, count: 40 }, // near orange
    { r: 40, g: 80, b: 200, count: 15 }, // rare but distant
  ];
  const coalesced = coalesceByDistance(entries, 18);
  const palette = selectByFrequencyAndDistance(coalesced, 3);
  if (palette.length < 2) throw new Error(`expected ≥2 colors, got ${palette.length}`);
  // First should be darkest/black-ish (most frequent cluster)
  const firstL = 0.2126 * palette[0].r + 0.7152 * palette[0].g + 0.0722 * palette[0].b;
  if (firstL > 80) throw new Error(`expected most-frequent dark first, L=${firstL}`);
  // Orange should appear in top slots
  const hasOrange = palette.some((p) => p.r > 180 && p.g < 140 && p.b < 80);
  if (!hasOrange) throw new Error('missing orange in palette');
});

test('Color mode palette ordered by frequency on two-ink mark', () => {
  const img = createImageData(40, 40, [255, 255, 255, 255]);
  for (let y = 0; y < 40; y++) {
    for (let x = 0; x < 40; x++) {
      if (x < 28) setPixel(img, x, y, [0, 0, 0, 255]);
      else setPixel(img, x, y, [232, 93, 4, 255]);
    }
  }
  const q = quantize(img, 'color', 4);
  // Most pixels are black → palette[0] should be near black
  const p0 = q.palette[0];
  const L = 0.2126 * p0.r + 0.7152 * p0.g + 0.0722 * p0.b;
  if (L > 60) throw new Error(`expected black-first palette, got ${JSON.stringify(p0)}`);
  if (q.palette.length < 2) throw new Error('expected ≥2 palette colors');
});

test('Speckle suppression removes tiny blobs', () => {
  const w = 20, h = 20;
  const bitmap = new Uint8Array(w * h);
  // big block
  for (let y = 5; y < 15; y++) for (let x = 5; x < 15; x++) bitmap[y * w + x] = 1;
  // speckles
  bitmap[1] = 1;
  bitmap[2] = 1;
  const cleaned = suppressSpeckles(bitmap, w, h, 5);
  if (cleaned[1] || cleaned[2]) throw new Error('speckles remained');
  if (!cleaned[5 * w + 5]) throw new Error('main shape removed');
});

test('Dilate grows a shape by one pixel', () => {
  const w = 8, h = 8;
  const bitmap = new Uint8Array(w * h);
  bitmap[3 * w + 3] = 1;
  const grown = dilateBitmap(bitmap, w, h, 1);
  if (!grown[3 * w + 4] || !grown[2 * w + 3]) throw new Error('dilation did not expand');
});

test('Filled export includes seam stroke by default', () => {
  const img = solidSquare(40, 8);
  const { svg } = convert(img, {
    colorMode: 'bw',
    removeBackground: true,
    strokeMode: false,
    pathOverlap: 1,
  });
  if (!/stroke="#[0-9a-fA-F]{6}"/.test(svg)) {
    throw new Error('expected matching seam stroke on fills');
  }
});

test('Minify shrinks pretty SVG', () => {
  const pretty = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
  <path d="M0 0 L10 0 L10 10 Z" fill="#000"/>
</svg>`;
  const mini = minifySvg(pretty, 1);
  if (mini.length >= pretty.length) throw new Error('minify did not shrink');
  if (mini.includes('\n  ')) throw new Error('still indented');
});

console.log('\nIntegration — raster vs vector coverage');

test('Solid square (BW) produces valid SVG with high coverage', () => {
  const img = solidSquare(64, 12);
  const { svg, stats } = convert(img, {
    colorMode: 'bw',
    detailLevel: 85,
    smoothing: 20,
    cornerThreshold: 35,
    speckleSize: 4,
    removeBackground: true,
    backgroundThreshold: 40,
    minify: false,
  });
  assertValidSvg(svg);
  gt(stats.pathCount, 0, 'paths');
  gt(stats.nodeCount, 3, 'nodes');
  // Geometric logos should stay relatively sparse
  if (stats.nodeCount > 200) throw new Error(`Too many nodes: ${stats.nodeCount}`);

  const score = coverageScore(img, svg, 160);
  gt(score.f1, 0.75, `F1 (${score.f1.toFixed(3)})`);
  gt(score.recall, 0.7, `recall (${score.recall.toFixed(3)})`);
});

test('Solid circle keeps reasonable fidelity without exploding nodes', () => {
  const img = solidCircle(72, 22);
  const { svg, stats } = convert(img, {
    colorMode: 'bw',
    detailLevel: 75,
    smoothing: 62,
    cornerThreshold: 50,
    speckleSize: 6,
    removeBackground: true,
  });
  assertValidSvg(svg);
  if (stats.nodeCount > 400) throw new Error(`Too many nodes: ${stats.nodeCount}`);
  const score = coverageScore(img, svg, 160);
  gt(score.f1, 0.65, `F1 (${score.f1.toFixed(3)})`);
});

test('Circle arcs prefer cubics over stair-step polylines', () => {
  const img = solidCircle(80, 26);
  const { svg } = convert(img, {
    colorMode: 'bw',
    detailLevel: 78,
    smoothing: 62,
    cornerThreshold: 40,
    removeBackground: true,
  });
  const d = svg.match(/d="([^"]+)"/)?.[1] || '';
  const curves = (d.match(/C/g) || []).length;
  const lines = (d.match(/L/g) || []).length;
  gt(curves, 2, 'cubic count');
  // Smooth circle should still use a meaningful share of cubics
  if (curves < 3 || lines > curves * 4) {
    throw new Error(`Too polygonal: L=${lines} C=${curves}`);
  }
});

test('Two-color mark traces multiple color layers', () => {
  const img = twoColorMark(80);
  const { svg, stats } = convert(img, {
    colorMode: 'color',
    colorCount: 4,
    detailLevel: 70,
    smoothing: 35,
    cornerThreshold: 40,
    speckleSize: 5,
    removeBackground: true,
    backgroundThreshold: 48,
  });
  assertValidSvg(svg);
  gt(stats.pathCount, 1, 'paths');
  // Expect more than one fill color in output
  const fills = [...svg.matchAll(/fill="(#[0-9a-fA-F]{6})"/g)].map((m) => m[1].toLowerCase());
  const unique = new Set(fills);
  gt(unique.size, 1, 'unique fill colors');

  const score = coverageScore(img, svg, 200);
  gt(score.f1, 0.55, `F1 (${score.f1.toFixed(3)})`);
});

test('Speckle setting reduces path noise vs unfiltered', () => {
  const img = speckledSquare(64);
  const noisy = convert(img, {
    colorMode: 'bw',
    detailLevel: 80,
    smoothing: 15,
    cornerThreshold: 30,
    speckleSize: 1,
    removeBackground: true,
  });
  const clean = convert(img, {
    colorMode: 'bw',
    detailLevel: 80,
    smoothing: 15,
    cornerThreshold: 30,
    speckleSize: 12,
    removeBackground: true,
  });
  if (clean.stats.pathCount > noisy.stats.pathCount) {
    throw new Error(
      `Expected fewer/equal paths with speckles off: clean=${clean.stats.pathCount} noisy=${noisy.stats.pathCount}`
    );
  }
});

test('Contour tracer finds a ring for a filled square bitmap', () => {
  const w = 20, h = 20;
  const bitmap = new Uint8Array(w * h);
  for (let y = 4; y < 16; y++) for (let x = 4; x < 16; x++) bitmap[y * w + x] = 1;
  const contours = traceContours(bitmap, w, h);
  gt(contours.length, 0, 'contour count');
  gt(contours[0].points.length, 4, 'points');
});

test('Output scale changes viewBox dimensions', () => {
  const img = solidSquare(40, 8);
  const { svg } = convert(img, {
    colorMode: 'bw',
    outWidth: 200,
    outHeight: 200,
    removeBackground: true,
  });
  if (!svg.includes('viewBox="0 0 200 200"')) {
    throw new Error(`Unexpected viewBox in: ${svg.slice(0, 120)}`);
  }
});

test('Stroke mode emits stroke attributes', () => {
  const img = solidSquare(40, 8);
  const { svg } = convert(img, {
    colorMode: 'bw',
    strokeMode: true,
    strokeWidth: 2,
    removeBackground: true,
  });
  if (!svg.includes('stroke=')) throw new Error('Missing stroke');
  if (!svg.includes('fill="none"')) throw new Error('Expected fill none');
});

test('Ring / letter counter keeps a hole (evenodd)', () => {
  const img = ringWithHole(64, 8, 22);
  const { svg } = convert(img, {
    colorMode: 'bw',
    detailLevel: 85,
    smoothing: 15,
    cornerThreshold: 30,
    speckleSize: 4,
    removeBackground: true,
    backgroundThreshold: 40,
  });
  assertValidSvg(svg);
  if (!svg.includes('fill-rule="evenodd"')) {
    throw new Error('Expected fill-rule=evenodd for hole cutting');
  }
  const d = svg.match(/d="([^"]+)"/)?.[1] || '';
  const moves = (d.match(/M/g) || []).length;
  gt(moves, 1, 'subpath count (outer+hole)');

  const score = coverageScore(img, svg, 160);
  gt(score.f1, 0.7, `F1 (${score.f1.toFixed(3)})`);
  // If the hole were filled solid, precision collapses (false ink in the counter)
  gt(score.precision, 0.7, `precision (${score.precision.toFixed(3)})`);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
