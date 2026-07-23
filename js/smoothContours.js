/**
 * Contour anti-staircase pass
 * Pixel-boundary traces are stair-stepped; Chaikin + light Laplacian
 * (corner-preserving) turn them into smooth arcs before RDP / curve fit.
 */

function turnDeviation(a, b, c) {
  const v1x = a.x - b.x, v1y = a.y - b.y;
  const v2x = c.x - b.x, v2y = c.y - b.y;
  const n1 = Math.hypot(v1x, v1y) || 1;
  const n2 = Math.hypot(v2x, v2y) || 1;
  let cos = (v1x * v2x + v1y * v2y) / (n1 * n2);
  cos = Math.max(-1, Math.min(1, cos));
  return 180 - (Math.acos(cos) * 180) / Math.PI;
}

function openRing(points) {
  if (
    points.length > 1 &&
    points[0].x === points[points.length - 1].x &&
    points[0].y === points[points.length - 1].y
  ) {
    return points.slice(0, -1);
  }
  return points.slice();
}

function closeRing(pts) {
  if (!pts.length) return pts;
  return [...pts, { x: pts[0].x, y: pts[0].y }];
}

function cornerMask(pts, cornerThreshold) {
  const n = pts.length;
  const hard = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n];
    const b = pts[i];
    const c = pts[(i + 1) % n];
    if (turnDeviation(a, b, c) >= cornerThreshold) hard[i] = 1;
  }
  return hard;
}

/**
 * One Chaikin subdivision pass, freezing hard-corner vertices.
 */
function chaikinPass(pts, hard) {
  const n = pts.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const p = pts[i];
    const q = pts[j];
    if (hard[i]) {
      out.push({ x: p.x, y: p.y });
    }
    // Q = 3/4 p + 1/4 q, R = 1/4 p + 3/4 q
    out.push({
      x: 0.75 * p.x + 0.25 * q.x,
      y: 0.75 * p.y + 0.25 * q.y,
    });
    out.push({
      x: 0.25 * p.x + 0.75 * q.x,
      y: 0.25 * p.y + 0.75 * q.y,
    });
  }
  return out;
}

/**
 * Light Laplacian relaxation — pulls mid-edge jaggies in without melting corners.
 */
function laplacianPass(pts, hard, amount) {
  const n = pts.length;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    if (hard[i]) {
      out[i] = { x: pts[i].x, y: pts[i].y };
      continue;
    }
    const prev = pts[(i - 1 + n) % n];
    const next = pts[(i + 1) % n];
    const mx = (prev.x + next.x) * 0.5;
    const my = (prev.y + next.y) * 0.5;
    out[i] = {
      x: pts[i].x + (mx - pts[i].x) * amount,
      y: pts[i].y + (my - pts[i].y) * amount,
    };
  }
  return out;
}

/**
 * Map smoothing 0–100 → Chaikin iterations + Laplacian strength.
 * Even modest smoothing removes 1px staircases on logo curves.
 */
export function smoothStrength(smoothing) {
  const s = Math.max(0, Math.min(100, smoothing)) / 100;
  // Always apply at least a mild denoise so curves aren't pixel-stairsteps
  const chaikinIters = Math.max(1, Math.round(1 + s * 3)); // 1–4
  const lapIters = Math.max(1, Math.round(1 + s * 2)); // 1–3
  const lapAmount = 0.35 + s * 0.35; // 0.35–0.70
  return { chaikinIters, lapIters, lapAmount };
}

export function smoothContour(points, smoothing, cornerThreshold) {
  let pts = openRing(points);
  if (pts.length < 4) return closeRing(pts);

  const { chaikinIters, lapIters, lapAmount } = smoothStrength(smoothing);
  let hard = cornerMask(pts, cornerThreshold);

  for (let k = 0; k < chaikinIters; k++) {
    pts = chaikinPass(pts, hard);
    // After subdivision, recompute corners on denser ring
    hard = cornerMask(pts, cornerThreshold);
  }

  for (let k = 0; k < lapIters; k++) {
    pts = laplacianPass(pts, hard, lapAmount);
  }

  return closeRing(pts);
}

export function smoothContours(contours, smoothing, cornerThreshold) {
  return contours.map((c) => ({
    closed: true,
    points: smoothContour(c.points, smoothing, cornerThreshold),
  }));
}
