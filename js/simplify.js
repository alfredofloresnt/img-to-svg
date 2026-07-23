/**
 * Stage 5 — Path simplification (Ramer–Douglas–Peucker)
 * detailLevel: higher = more fidelity (lower epsilon); lower = fewer nodes.
 */

function distPointToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) {
    const ex = p.x - a.x;
    const ey = p.y - a.y;
    return Math.hypot(ex, ey);
  }
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Classic RDP. epsilon in pixel units.
 */
export function rdp(points, epsilon) {
  if (points.length < 3) return points.slice();

  // Drop duplicate closing point for processing
  let pts = points;
  const closed =
    pts.length > 1 &&
    pts[0].x === pts[pts.length - 1].x &&
    pts[0].y === pts[pts.length - 1].y;
  if (closed) pts = pts.slice(0, -1);
  if (pts.length < 3) return closed ? [...pts, { ...pts[0] }] : pts.slice();

  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;

  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop();
    let maxD = 0;
    let maxI = -1;
    const a = pts[start];
    const b = pts[end];
    for (let i = start + 1; i < end; i++) {
      const d = distPointToSegment(pts[i], a, b);
      if (d > maxD) {
        maxD = d;
        maxI = i;
      }
    }
    if (maxD > epsilon && maxI >= 0) {
      keep[maxI] = 1;
      stack.push([start, maxI], [maxI, end]);
    }
  }

  const out = [];
  for (let i = 0; i < pts.length; i++) {
    if (keep[i]) out.push({ x: pts[i].x, y: pts[i].y });
  }
  if (closed && out.length) out.push({ x: out[0].x, y: out[0].y });
  return out;
}

/**
 * Map UI detail level (1–100) → RDP epsilon in pixels.
 * Keep a modest floor so post-Chaikin curves aren't over-sampled into stairs.
 */
export function detailToEpsilon(detailLevel, imageDiagonal) {
  const d = Math.max(1, Math.min(100, detailLevel));
  const t = 1 - (d - 1) / 99;
  // detail 100 → 0.35px; detail 1 → ~2% diagonal
  const minE = 0.35;
  const maxE = Math.max(1.2, imageDiagonal * 0.02);
  return minE + t * t * (maxE - minE);
}

/**
 * Simplify all contours; drop rings that collapse below 3 unique vertices.
 */
export function simplifyContours(contours, detailLevel, width, height) {
  const diag = Math.hypot(width, height);
  const epsilon = detailToEpsilon(detailLevel, diag);

  const out = [];
  for (const c of contours) {
    const simplified = rdp(c.points, epsilon);
    const unique = simplified.length > 1 &&
      simplified[0].x === simplified[simplified.length - 1].x &&
      simplified[0].y === simplified[simplified.length - 1].y
      ? simplified.length - 1
      : simplified.length;
    if (unique >= 3) {
      out.push({ closed: true, points: simplified });
    }
  }
  return out;
}
