/**
 * Stage 6 — Curve fitting
 * Recursive cubic Bézier fit (Schneider-style) on pre-smoothed contours.
 * Error floor absorbs residual pixel noise so arcs stay smooth.
 */

function turnAngleDeg(a, b, c) {
  const v1x = a.x - b.x, v1y = a.y - b.y;
  const v2x = c.x - b.x, v2y = c.y - b.y;
  const n1 = Math.hypot(v1x, v1y) || 1;
  const n2 = Math.hypot(v2x, v2y) || 1;
  let cos = (v1x * v2x + v1y * v2y) / (n1 * n2);
  cos = Math.max(-1, Math.min(1, cos));
  return (Math.acos(cos) * 180) / Math.PI;
}

function normalize(x, y) {
  const n = Math.hypot(x, y) || 1;
  return { x: x / n, y: y / n };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}

function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}

function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y };
}

function scale(a, s) {
  return { x: a.x * s, y: a.y * s };
}

/**
 * Max distance from polyline → cubic. Floor keeps fit from hugging stair-steps.
 * Higher smoothing → slightly looser (rounder) curves.
 */
export function fitErrorTolerance(detailLevel, smoothing) {
  const d = Math.max(1, Math.min(100, detailLevel));
  const s = Math.max(0, Math.min(100, smoothing)) / 100;
  const t = 1 - (d - 1) / 99;
  // Floor ~0.65px so 1px raster jaggies collapse into smooth cubics
  const raw = 0.45 + t * 0.7 + s * 0.55;
  return Math.max(0.65, raw);
}

export function findCorners(points, cornerThresholdDeg) {
  let pts = points;
  const closed =
    pts.length > 1 &&
    pts[0].x === pts[pts.length - 1].x &&
    pts[0].y === pts[pts.length - 1].y;
  if (closed) pts = pts.slice(0, -1);
  const n = pts.length;
  if (n < 3) return { pts, corners: [0], closed };

  const corners = [];
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n];
    const b = pts[i];
    const c = pts[(i + 1) % n];
    const deviation = 180 - turnAngleDeg(a, b, c);
    if (deviation >= cornerThresholdDeg) corners.push(i);
  }
  if (!corners.length) corners.push(0);
  return { pts, corners, closed: true };
}

function chordParams(points) {
  const u = new Float64Array(points.length);
  u[0] = 0;
  for (let i = 1; i < points.length; i++) {
    u[i] = u[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  const total = u[u.length - 1] || 1;
  for (let i = 0; i < u.length; i++) u[i] /= total;
  return u;
}

function bezierPoint(p0, p1, p2, p3, t) {
  const mt = 1 - t;
  return {
    x: mt * mt * mt * p0.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t * t * t * p3.x,
    y: mt * mt * mt * p0.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t * t * t * p3.y,
  };
}

function b1(t) {
  const mt = 1 - t;
  return 3 * mt * mt * t;
}
function b2(t) {
  const mt = 1 - t;
  return 3 * mt * t * t;
}

function generateBezier(points, leftTan, rightTan) {
  const p0 = points[0];
  const p3 = points[points.length - 1];
  const u = chordParams(points);
  let c00 = 0, c01 = 0, c11 = 0;
  let x0 = 0, x1 = 0;

  for (let i = 0; i < points.length; i++) {
    const t = u[i];
    const A0 = scale(leftTan, b1(t));
    const A1 = scale(rightTan, b2(t));
    c00 += dot(A0, A0);
    c01 += dot(A0, A1);
    c11 += dot(A1, A1);
    const tmp = sub(points[i], bezierPoint(p0, p0, p3, p3, t));
    x0 += dot(A0, tmp);
    x1 += dot(A1, tmp);
  }

  const det = c00 * c11 - c01 * c01;
  let alpha1, alpha2;
  const dist = Math.hypot(p3.x - p0.x, p3.y - p0.y);
  if (Math.abs(det) < 1e-8) {
    alpha1 = dist / 3;
    alpha2 = dist / 3;
  } else {
    alpha1 = (c11 * x0 - c01 * x1) / det;
    alpha2 = (c00 * x1 - c01 * x0) / det;
  }

  const maxAlpha = Math.max(dist, 1) * 1.25;
  if (!(alpha1 > 1e-6) || alpha1 > maxAlpha) alpha1 = dist / 3;
  if (!(alpha2 > 1e-6) || alpha2 > maxAlpha) alpha2 = dist / 3;

  return {
    p0,
    c1: add(p0, scale(leftTan, alpha1)),
    c2: add(p3, scale(rightTan, alpha2)),
    p3,
  };
}

function computeMaxError(points, curve) {
  let maxD = 0;
  let splitIndex = Math.floor(points.length / 2);
  const u = chordParams(points);
  for (let i = 1; i < points.length - 1; i++) {
    const bp = bezierPoint(curve.p0, curve.c1, curve.c2, curve.p3, u[i]);
    const d = Math.hypot(points[i].x - bp.x, points[i].y - bp.y);
    if (d > maxD) {
      maxD = d;
      splitIndex = i;
    }
  }
  return { maxD, splitIndex };
}

function tangentAt(points, index) {
  const n = points.length;
  const prev = points[Math.max(0, index - 1)];
  const next = points[Math.min(n - 1, index + 1)];
  return normalize(next.x - prev.x, next.y - prev.y);
}

function fitCubicRecursive(points, leftTan, rightTan, error, depth, out) {
  if (points.length < 2) return;

  if (points.length === 2 || depth > 10) {
    out.push({ type: 'L', x: points[points.length - 1].x, y: points[points.length - 1].y });
    return;
  }

  // Long gentle arcs: try fit; short nearly-straight: line
  const chord = Math.hypot(
    points[points.length - 1].x - points[0].x,
    points[points.length - 1].y - points[0].y
  );
  let pathLen = 0;
  for (let i = 1; i < points.length; i++) {
    pathLen += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  if (pathLen > 1e-6 && chord / pathLen > 0.995 && pathLen < error * 8) {
    out.push({ type: 'L', x: points[points.length - 1].x, y: points[points.length - 1].y });
    return;
  }

  const curve = generateBezier(points, leftTan, rightTan);
  const { maxD, splitIndex } = computeMaxError(points, curve);

  if (maxD <= error || points.length <= 5) {
    out.push({
      type: 'C',
      c1x: curve.c1.x,
      c1y: curve.c1.y,
      c2x: curve.c2.x,
      c2y: curve.c2.y,
      x: curve.p3.x,
      y: curve.p3.y,
    });
    return;
  }

  let mid = splitIndex;
  if (mid <= 0) mid = 1;
  if (mid >= points.length - 1) mid = points.length - 2;

  const centerTan = tangentAt(points, mid);
  fitCubicRecursive(points.slice(0, mid + 1), leftTan, centerTan, error, depth + 1, out);
  fitCubicRecursive(points.slice(mid), centerTan, rightTan, error, depth + 1, out);
}

/**
 * Seed splits on long arcs so a full circle isn't one cubic —
 * but keep spans long enough for smooth quarters (~25 verts after Chaikin).
 */
function ensureArcSplits(pts, corners, maxSpan) {
  const n = pts.length;
  const set = new Set(corners);
  const ordered = [...set].sort((a, b) => a - b);

  for (let ci = 0; ci < ordered.length; ci++) {
    const a = ordered[ci];
    const b = ordered[(ci + 1) % ordered.length];
    const len = b > a ? b - a : b + n - a;
    if (len <= maxSpan) continue;
    const steps = Math.ceil(len / maxSpan);
    for (let s = 1; s < steps; s++) {
      set.add((a + Math.round((len * s) / steps)) % n);
    }
  }
  return [...set].sort((a, b) => a - b);
}

export function fitContourToCurves(points, cornerThreshold, smoothing, detailLevel = 80) {
  const { pts, corners } = findCorners(points, cornerThreshold);
  const n = pts.length;
  if (n < 3) return null;

  const error = fitErrorTolerance(detailLevel, smoothing);
  const ordered = ensureArcSplits(pts, corners, 28);
  const commands = [];
  const start = ordered[0];
  commands.push({ type: 'M', x: pts[start].x, y: pts[start].y });

  const s = Math.max(0, Math.min(100, smoothing));

  for (let ci = 0; ci < ordered.length; ci++) {
    const a = ordered[ci];
    const b = ordered[(ci + 1) % ordered.length];
    const chain = [];
    let i = a;
    chain.push(pts[i]);
    do {
      i = (i + 1) % n;
      chain.push(pts[i]);
    } while (i !== b);

    if (chain.length === 2 || s < 3) {
      commands.push({ type: 'L', x: chain[chain.length - 1].x, y: chain[chain.length - 1].y });
      continue;
    }

    const leftTan = normalize(chain[1].x - chain[0].x, chain[1].y - chain[0].y);
    const last = chain.length - 1;
    const endTan = normalize(chain[last].x - chain[last - 1].x, chain[last].y - chain[last - 1].y);
    const rightTanIn = { x: -endTan.x, y: -endTan.y };

    fitCubicRecursive(chain, leftTan, rightTanIn, error, 0, commands);
  }

  commands.push({ type: 'Z' });
  return commands;
}

export function fitLayerContours(contours, cornerThreshold, smoothing, detailLevel = 80) {
  const paths = [];
  for (const c of contours) {
    const cmds = fitContourToCurves(c.points, cornerThreshold, smoothing, detailLevel);
    if (cmds) paths.push(cmds);
  }
  return paths;
}
