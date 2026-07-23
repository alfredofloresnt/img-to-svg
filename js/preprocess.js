/**
 * Stage 1 — Preprocessing
 * Read pixel data, optional denoise blur, background removal by color threshold.
 */

/** Create a copy of ImageData-like { data, width, height }. */
export function cloneImageData(src) {
  return {
    data: new Uint8ClampedArray(src.data),
    width: src.width,
    height: src.height,
  };
}

/**
 * Box blur (separable) for light denoise. radius 0 = no-op.
 * Maps to an internal denoise amount; keeps edges usable for logos.
 */
export function boxBlur(imageData, radius = 0) {
  if (radius <= 0) return cloneImageData(imageData);
  const { width, height, data } = imageData;
  const tmp = new Uint8ClampedArray(data.length);
  const out = new Uint8ClampedArray(data.length);
  const r = Math.min(Math.floor(radius), 4);

  // Horizontal
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let rSum = 0, gSum = 0, bSum = 0, aSum = 0, n = 0;
      for (let k = -r; k <= r; k++) {
        const xx = Math.min(width - 1, Math.max(0, x + k));
        const i = (y * width + xx) * 4;
        rSum += data[i]; gSum += data[i + 1]; bSum += data[i + 2]; aSum += data[i + 3];
        n++;
      }
      const o = (y * width + x) * 4;
      tmp[o] = rSum / n; tmp[o + 1] = gSum / n; tmp[o + 2] = bSum / n; tmp[o + 3] = aSum / n;
    }
  }

  // Vertical
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let rSum = 0, gSum = 0, bSum = 0, aSum = 0, n = 0;
      for (let k = -r; k <= r; k++) {
        const yy = Math.min(height - 1, Math.max(0, y + k));
        const i = (yy * width + x) * 4;
        rSum += tmp[i]; gSum += tmp[i + 1]; bSum += tmp[i + 2]; aSum += tmp[i + 3];
        n++;
      }
      const o = (y * width + x) * 4;
      out[o] = rSum / n; out[o + 1] = gSum / n; out[o + 2] = bSum / n; out[o + 3] = aSum / n;
    }
  }

  return { data: out, width, height };
}

function colorDistSq(r1, g1, b1, r2, g2, b2) {
  const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return dr * dr + dg * dg + db * db;
}

/**
 * Sample likely background from image corners (average of 4 corner pixels).
 */
export function sampleCornerBackground(imageData) {
  const { data, width, height } = imageData;
  const pts = [
    0,
    (width - 1) * 4,
    ((height - 1) * width) * 4,
    ((height - 1) * width + (width - 1)) * 4,
  ];
  let r = 0, g = 0, b = 0;
  for (const i of pts) {
    r += data[i]; g += data[i + 1]; b += data[i + 2];
  }
  return { r: r / 4, g: g / 4, b: b / 4 };
}

/**
 * Make pixels near backgroundColor transparent.
 * threshold: 0–255 color distance in RGB space (euclidean).
 */
export function removeBackground(imageData, enabled, threshold = 32, backgroundColor = null) {
  const out = cloneImageData(imageData);
  if (!enabled) return out;

  const bg = backgroundColor || sampleCornerBackground(imageData);
  const thrSq = threshold * threshold;
  const { data, width, height } = out;

  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    if (data[o + 3] < 8) continue;
    if (colorDistSq(data[o], data[o + 1], data[o + 2], bg.r, bg.g, bg.b) <= thrSq) {
      data[o + 3] = 0;
    }
  }
  return out;
}

/**
 * Full preprocess stage.
 * @param {object} settings
 * @param {boolean} settings.removeBackground
 * @param {number} settings.backgroundThreshold
 * @param {number} [settings.blurRadius]
 */
export function preprocess(imageData, settings = {}) {
  const blurred = boxBlur(imageData, settings.blurRadius ?? 0);
  return removeBackground(
    blurred,
    !!settings.removeBackground,
    settings.backgroundThreshold ?? 32,
    settings.backgroundColor ?? null
  );
}
