/**
 * Stage 3 — Bitmap layering
 * Split quantized image into one binary bitmap per palette color.
 */

/**
 * @param {{ palette, indices, width, height }} quantized
 * @returns {Array<{ colorIndex: number, color: object, bitmap: Uint8Array, width: number, height: number }>}
 */
export function buildLayers(quantized) {
  const { palette, indices, width, height } = quantized;
  const n = width * height;
  const layers = [];

  for (let c = 0; c < palette.length; c++) {
    const bitmap = new Uint8Array(n);
    let on = 0;
    for (let i = 0; i < n; i++) {
      if (indices[i] === c) {
        bitmap[i] = 1;
        on++;
      }
    }
    if (on === 0) continue;
    layers.push({
      colorIndex: c,
      color: palette[c],
      bitmap,
      width,
      height,
      pixelCount: on,
    });
  }

  // Light under, dark on top (SVG paints later elements last).
  layers.sort((a, b) => {
    const la = 0.2126 * a.color.r + 0.7152 * a.color.g + 0.0722 * a.color.b;
    const lb = 0.2126 * b.color.r + 0.7152 * b.color.g + 0.0722 * b.color.b;
    return lb - la;
  });

  return layers;
}

/**
 * Morphological dilate (8-connected), `radius` iterations.
 * Slightly grows each color layer so neighboring fills overlap and hide hairline gaps.
 */
export function dilateBitmap(bitmap, width, height, radius = 1) {
  const r = Math.max(0, Math.min(4, radius | 0));
  if (r === 0) return bitmap;

  let src = bitmap;
  for (let pass = 0; pass < r; pass++) {
    const out = src.slice();
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (src[i]) continue;
        let on = false;
        for (let dy = -1; dy <= 1 && !on; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
            if (src[yy * width + xx]) {
              on = true;
              break;
            }
          }
        }
        if (on) out[i] = 1;
      }
    }
    src = out;
  }
  return src;
}

/**
 * Speckle suppression: remove connected components smaller than minArea (pixels).
 * 4-connected flood fill.
 */
export function suppressSpeckles(bitmap, width, height, minArea) {
  if (minArea <= 1) return bitmap;
  const out = bitmap.slice();
  const n = width * height;
  const seen = new Uint8Array(n);

  for (let i = 0; i < n; i++) {
    if (!out[i] || seen[i]) continue;

    const stack = [i];
    const component = [];
    seen[i] = 1;

    while (stack.length) {
      const p = stack.pop();
      component.push(p);
      const x = p % width;
      const y = (p / width) | 0;
      const neighbors = [];
      if (x > 0) neighbors.push(p - 1);
      if (x < width - 1) neighbors.push(p + 1);
      if (y > 0) neighbors.push(p - width);
      if (y < height - 1) neighbors.push(p + width);
      for (const q of neighbors) {
        if (out[q] && !seen[q]) {
          seen[q] = 1;
          stack.push(q);
        }
      }
    }

    if (component.length < minArea) {
      for (const p of component) out[p] = 0;
    }
  }

  return out;
}
