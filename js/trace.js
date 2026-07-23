/**
 * Stage 4 — Edge / contour tracing
 * Moore-neighborhood boundary following on binary bitmaps → closed polygons.
 */

function at(bitmap, width, height, x, y) {
  if (x < 0 || y < 0 || x >= width || y >= height) return 0;
  return bitmap[y * width + x];
}

// 8-connected directions clockwise from E
const DX = [1, 1, 0, -1, -1, -1, 0, 1];
const DY = [0, 1, 1, 1, 0, -1, -1, -1];

/**
 * Trace outer and hole contours. Returns list of point rings in pixel space
 * (vertex coordinates on the pixel grid corners, +0.5 center offset applied later).
 */
export function traceContours(bitmap, width, height) {
  // Pad with off border so outer edges are always closed cleanly
  const pw = width + 2;
  const ph = height + 2;
  const padded = new Uint8Array(pw * ph);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      padded[(y + 1) * pw + (x + 1)] = bitmap[y * width + x];
    }
  }

  const visited = new Uint8Array(pw * ph); // visited as contour start edge cells
  const contours = [];

  for (let y = 1; y < ph - 1; y++) {
    for (let x = 1; x < pw - 1; x++) {
      const i = y * pw + x;
      if (!padded[i]) continue;

      // Start when left neighbor is off (entering a boundary from the left)
      if (padded[i - 1]) continue;
      if (visited[i]) continue;

      const ring = followBoundary(padded, pw, ph, x, y, visited);
      if (ring && ring.length >= 3) {
        // Un-pad coordinates
        const points = ring.map((p) => ({ x: p.x - 1, y: p.y - 1 }));
        contours.push({ points, closed: true });
      }
    }
  }

  return contours;
}

/**
 * Moore neighborhood contour follower.
 * Walks the boundary, marking start cells so each component is traced once.
 */
function followBoundary(bitmap, width, height, startX, startY, visited) {
  const points = [];
  let x = startX;
  let y = startY;
  // Entered from the left; first backtrack direction is West (4)
  let dir = 4;

  const startKey = y * width + x;
  let guard = width * height * 8;

  do {
    points.push({ x, y });
    visited[y * width + x] = 1;

    // Search from dir+1 (left-ish relative to travel) clockwise for next on-pixel
    let found = false;
    const startSearch = (dir + 1) % 8;
    for (let k = 0; k < 8; k++) {
      const nd = (startSearch + k) % 8;
      const nx = x + DX[nd];
      const ny = y + DY[nd];
      if (at(bitmap, width, height, nx, ny)) {
        // New backtrack is opposite of arrival
        dir = (nd + 4) % 8;
        x = nx;
        y = ny;
        found = true;
        break;
      }
    }
    if (!found) break;
    guard--;
  } while ((x !== startX || y !== startY) && guard > 0);

  if (points.length < 3) return null;

  // Mark interior edge starts along scan to reduce duplicate outer traces
  // (already marked path cells via visited)

  // Close ring if needed
  const first = points[0];
  const last = points[points.length - 1];
  if (first.x !== last.x || first.y !== last.y) {
    points.push({ x: first.x, y: first.y });
  }

  // Suppress re-starts on this component's left-boundary cells
  void startKey;

  return points;
}

/**
 * Convert pixel-center contour points to continuous coordinates (optional inset).
 */
export function contoursToGeometry(contours) {
  return contours.map((c) => ({
    closed: c.closed,
    points: c.points.map((p) => ({ x: p.x + 0.5, y: p.y + 0.5 })),
  }));
}
