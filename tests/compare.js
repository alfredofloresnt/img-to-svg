/**
 * Compare raster source vs vector output via path sampling.
 */

/** Parse M/L/C/Z commands roughly and sample polyline approximations. */
export function sampleSvgPaths(svg, samplesPerCurve = 8) {
  const paths = [];
  const re = /d="([^"]+)"/g;
  let m;
  while ((m = re.exec(svg))) {
    paths.push(parsePathD(m[1], samplesPerCurve));
  }
  return paths;
}

function parsePathD(d, samplesPerCurve) {
  const tokens = d.match(/[MLCZmlcz]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) || [];
  const pts = [];
  let i = 0;
  let cx = 0, cy = 0;
  let startX = 0, startY = 0;

  while (i < tokens.length) {
    const cmd = tokens[i++];
    if (cmd === 'M' || cmd === 'm') {
      const x = Number(tokens[i++]);
      const y = Number(tokens[i++]);
      cx = cmd === 'm' ? cx + x : x;
      cy = cmd === 'm' ? cy + y : y;
      startX = cx; startY = cy;
      pts.push({ x: cx, y: cy });
    } else if (cmd === 'L' || cmd === 'l') {
      const x = Number(tokens[i++]);
      const y = Number(tokens[i++]);
      cx = cmd === 'l' ? cx + x : x;
      cy = cmd === 'l' ? cy + y : y;
      pts.push({ x: cx, y: cy });
    } else if (cmd === 'C' || cmd === 'c') {
      let x1 = Number(tokens[i++]);
      let y1 = Number(tokens[i++]);
      let x2 = Number(tokens[i++]);
      let y2 = Number(tokens[i++]);
      let x = Number(tokens[i++]);
      let y = Number(tokens[i++]);
      if (cmd === 'c') {
        x1 += cx; y1 += cy; x2 += cx; y2 += cy; x += cx; y += cy;
      }
      for (let t = 1; t <= samplesPerCurve; t++) {
        const u = t / samplesPerCurve;
        pts.push(cubicPoint(cx, cy, x1, y1, x2, y2, x, y, u));
      }
      cx = x; cy = y;
    } else if (cmd === 'Z' || cmd === 'z') {
      pts.push({ x: startX, y: startY });
      cx = startX; cy = startY;
    } else {
      // Numeric without command — skip safely
      i--;
      break;
    }
  }
  return pts;
}

function cubicPoint(x0, y0, x1, y1, x2, y2, x3, y3, t) {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return {
    x: a * x0 + b * x1 + c * x2 + d * x3,
    y: a * y0 + b * y1 + c * y2 + d * y3,
  };
}

function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Score how well vector coverage matches dark (ink) pixels in the source.
 * Returns { precision, recall, f1, inkPixels, hitInk, falseInk }.
 */
export function coverageScore(imageData, svg, inkLumaMax = 140) {
  const paths = sampleSvgPaths(svg);
  if (!paths.length) {
    return { precision: 0, recall: 0, f1: 0, inkPixels: 0, hitInk: 0, falseInk: 0 };
  }

  const { data, width, height } = imageData;
  let inkPixels = 0;
  let hitInk = 0;
  let falseInk = 0;
  let predInk = 0;

  // Sample on a grid for speed
  const step = Math.max(1, Math.floor(Math.min(width, height) / 48));

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const o = (y * width + x) * 4;
      const a = data[o + 3];
      const L = 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2];
      const isInk = a > 16 && L <= inkLumaMax;

      // evenodd across all subpaths (outer + holes)
      let winding = 0;
      for (const poly of paths) {
        if (poly.length >= 3 && pointInPoly(x + 0.5, y + 0.5, poly)) winding++;
      }
      const inVec = winding % 2 === 1;

      if (isInk) inkPixels++;
      if (inVec) predInk++;
      if (isInk && inVec) hitInk++;
      if (!isInk && inVec) falseInk++;
    }
  }

  const precision = predInk ? hitInk / predInk : 0;
  const recall = inkPixels ? hitInk / inkPixels : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { precision, recall, f1, inkPixels, hitInk, falseInk };
}

export function assertValidSvg(svg) {
  if (typeof svg !== 'string' || !svg.includes('<svg')) {
    throw new Error('Missing <svg>');
  }
  if (!svg.includes('</svg>') && !svg.includes('/>')) {
    // self-closing unlikely; require close tag for our builder
    if (!/<svg[\s\S]*<\/svg>/.test(svg)) throw new Error('Invalid SVG structure');
  }
  if (!svg.includes('viewBox=')) throw new Error('Missing viewBox');
  if (!/d="[^"]+"/.test(svg)) throw new Error('No path data');
}
