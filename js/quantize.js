/**
 * Stage 2 — Color quantization
 * B&W / grayscale via luminance; full color via frequency + color-distance selection.
 */

export function luminance(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function rgbKey(r, g, b) {
  return ((r & 255) << 16) | ((g & 255) << 8) | (b & 255);
}

function fromKey(k) {
  return { r: (k >> 16) & 255, g: (k >> 8) & 255, b: k & 255 };
}

function distSq(a, b) {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return dr * dr + dg * dg + db * db;
}

/**
 * Black & white: single ink color on transparent (or white) ground.
 */
function quantizeBW(imageData, threshold = 128) {
  const { data, width, height } = imageData;
  const n = width * height;
  const indices = new Int16Array(n);
  let inkR = 0, inkG = 0, inkB = 0, inkN = 0;

  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (data[o + 3] < 16) {
      indices[i] = -1;
      continue;
    }
    const L = luminance(data[o], data[o + 1], data[o + 2]);
    if (L < threshold) {
      indices[i] = 0;
      inkR += data[o]; inkG += data[o + 1]; inkB += data[o + 2];
      inkN++;
    } else {
      indices[i] = -1;
    }
  }

  const palette = inkN
    ? [{ r: Math.round(inkR / inkN), g: Math.round(inkG / inkN), b: Math.round(inkB / inkN), a: 255 }]
    : [{ r: 0, g: 0, b: 0, a: 255 }];

  return { palette, indices, width, height };
}

/**
 * Grayscale: quantize luminance into `colorCount` levels.
 */
function quantizeGrayscale(imageData, colorCount) {
  const levels = Math.max(2, Math.min(64, colorCount | 0));
  const { data, width, height } = imageData;
  const n = width * height;
  const indices = new Int16Array(n);
  const sums = Array.from({ length: levels }, () => ({ r: 0, g: 0, b: 0, c: 0 }));

  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (data[o + 3] < 16) {
      indices[i] = -1;
      continue;
    }
    const L = luminance(data[o], data[o + 1], data[o + 2]);
    const idx = Math.min(levels - 1, Math.floor((L / 256) * levels));
    indices[i] = idx;
    sums[idx].r += data[o];
    sums[idx].g += data[o + 1];
    sums[idx].b += data[o + 2];
    sums[idx].c++;
  }

  const palette = sums.map((s, i) => {
    if (!s.c) {
      const v = Math.round(((i + 0.5) / levels) * 255);
      return { r: v, g: v, b: v, a: 255 };
    }
    return {
      r: Math.round(s.r / s.c),
      g: Math.round(s.g / s.c),
      b: Math.round(s.b / s.c),
      a: 255,
    };
  });

  return { palette, indices, width, height };
}

/**
 * Build full (or stepped) opaque-color histogram: [{ r,g,b,count }].
 */
function buildHistogram(imageData) {
  const { data, width, height } = imageData;
  const n = width * height;
  // Full scan — logos are small; large images still fine as a Map
  const seen = new Map();
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (data[o + 3] < 16) continue;
    const k = rgbKey(data[o], data[o + 1], data[o + 2]);
    seen.set(k, (seen.get(k) || 0) + 1);
  }
  const entries = [];
  for (const [k, count] of seen) {
    const c = fromKey(k);
    entries.push({ r: c.r, g: c.g, b: c.b, count });
  }
  return entries;
}

/**
 * Merge near-identical shades (anti-alias fringes) into frequency-weighted centroids.
 * Processes most-frequent first so dominant ink absorbs rare neighbors.
 */
export function coalesceByDistance(entries, mergeDist = 18) {
  if (!entries.length) return [];
  const mergeDistSq = mergeDist * mergeDist;
  const sorted = entries.slice().sort((a, b) => b.count - a.count);
  /** @type {{ r:number,g:number,b:number,count:number, wR:number,wG:number,wB:number }[]} */
  const clusters = [];

  for (const e of sorted) {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < clusters.length; i++) {
      const d = distSq(e, clusters[i]);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0 && bestD <= mergeDistSq) {
      const c = clusters[best];
      c.wR += e.r * e.count;
      c.wG += e.g * e.count;
      c.wB += e.b * e.count;
      c.count += e.count;
      c.r = Math.round(c.wR / c.count);
      c.g = Math.round(c.wG / c.count);
      c.b = Math.round(c.wB / c.count);
    } else {
      clusters.push({
        r: e.r,
        g: e.g,
        b: e.b,
        count: e.count,
        wR: e.r * e.count,
        wG: e.g * e.count,
        wB: e.b * e.count,
      });
    }
  }

  return clusters
    .map(({ r, g, b, count }) => ({ r, g, b, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Greedy palette: pick colors in frequency order, skipping ones too close
 * to an already chosen color. Lower the distance floor until the palette fills.
 *
 * Result order = selection order (most frequent distinct color first).
 */
export function selectByFrequencyAndDistance(candidates, maxColors) {
  if (!candidates.length) return [{ r: 0, g: 0, b: 0, a: 255 }];

  const sorted = candidates.slice().sort((a, b) => b.count - a.count);
  const target = Math.max(1, Math.min(64, maxColors | 0));

  // Start with a strong separation so orange ≠ near-black ≠ grey fringe
  let minDist = 56;
  /** @type {{ r:number,g:number,b:number,a:number,count:number }[]} */
  let selected = [];

  while (minDist >= 10 && selected.length < target) {
    selected = [];
    const minDistSq = minDist * minDist;
    for (const c of sorted) {
      if (selected.length >= target) break;
      let ok = true;
      for (const s of selected) {
        if (distSq(c, s) < minDistSq) {
          ok = false;
          break;
        }
      }
      if (ok) {
        selected.push({ r: c.r, g: c.g, b: c.b, a: 255, count: c.count });
      }
    }
    if (selected.length >= target || selected.length >= sorted.length) break;
    minDist -= 8;
  }

  // Fill remaining slots with next most frequent (even if closer)
  if (selected.length < target) {
    for (const c of sorted) {
      if (selected.length >= target) break;
      if (selected.some((s) => s.r === c.r && s.g === c.g && s.b === c.b)) continue;
      selected.push({ r: c.r, g: c.g, b: c.b, a: 255, count: c.count });
    }
  }

  if (!selected.length) {
    const c = sorted[0];
    return [{ r: c.r, g: c.g, b: c.b, a: 255 }];
  }

  return selected.map(({ r, g, b, a }) => ({ r, g, b, a }));
}

function nearestPaletteIndex(r, g, b, palette) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const p = palette[i];
    const d = (r - p.r) ** 2 + (g - p.g) ** 2 + (b - p.b) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * Full-color: histogram → coalesce near shades → pick by frequency + distance.
 * Palette slots are ordered most-frequent-distinct first.
 */
function quantizeColor(imageData, colorCount) {
  const maxColors = Math.max(2, Math.min(64, colorCount | 0));
  const { data, width, height } = imageData;
  const n = width * height;

  const histogram = buildHistogram(imageData);
  const coalesced = coalesceByDistance(histogram, 18);
  let palette = selectByFrequencyAndDistance(coalesced, maxColors);

  const indices = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (data[o + 3] < 16) {
      indices[i] = -1;
      continue;
    }
    indices[i] = nearestPaletteIndex(data[o], data[o + 1], data[o + 2], palette);
  }

  // Refine each slot to the mean of assigned pixels; drop empty slots
  const sums = palette.map(() => ({ r: 0, g: 0, b: 0, c: 0 }));
  for (let i = 0; i < n; i++) {
    const idx = indices[i];
    if (idx < 0) continue;
    const o = i * 4;
    sums[idx].r += data[o];
    sums[idx].g += data[o + 1];
    sums[idx].b += data[o + 2];
    sums[idx].c++;
  }

  // Keep order (frequency/distance selection order); only refine means
  const refined = [];
  const remap = new Int16Array(palette.length);
  for (let i = 0; i < palette.length; i++) {
    if (!sums[i].c) {
      remap[i] = -1;
      continue;
    }
    remap[i] = refined.length;
    refined.push({
      r: Math.round(sums[i].r / sums[i].c),
      g: Math.round(sums[i].g / sums[i].c),
      b: Math.round(sums[i].b / sums[i].c),
      a: 255,
    });
  }

  if (!refined.length) {
    refined.push({ r: 0, g: 0, b: 0, a: 255 });
  }

  if (refined.length !== palette.length) {
    for (let i = 0; i < n; i++) {
      const idx = indices[i];
      if (idx < 0) continue;
      indices[i] = remap[idx];
    }
  }

  // Re-sort palette by assigned pixel frequency (most used first), remap indices
  const freq = new Array(refined.length).fill(0);
  for (let i = 0; i < n; i++) {
    if (indices[i] >= 0) freq[indices[i]]++;
  }
  const order = freq
    .map((c, i) => ({ c, i }))
    .sort((a, b) => b.c - a.c)
    .map((x) => x.i);

  const ordered = order.map((i) => refined[i]);
  const inv = new Int16Array(refined.length);
  for (let newI = 0; newI < order.length; newI++) inv[order[newI]] = newI;
  for (let i = 0; i < n; i++) {
    if (indices[i] >= 0) indices[i] = inv[indices[i]];
  }

  return { palette: ordered, indices, width, height };
}

/**
 * @param {'bw'|'grayscale'|'color'} colorMode
 * @param {number} colorCount
 */
export function quantize(imageData, colorMode = 'color', colorCount = 8) {
  if (colorMode === 'bw') return quantizeBW(imageData);
  if (colorMode === 'grayscale') return quantizeGrayscale(imageData, colorCount);
  return quantizeColor(imageData, colorCount);
}

export function paletteToHex({ r, g, b }) {
  return (
    '#' +
    [r, g, b]
      .map((v) => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, '0'))
      .join('')
  );
}
