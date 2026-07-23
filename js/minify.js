/**
 * Lightweight SVGO-style cleanup (no external deps).
 * - Collapse whitespace
 * - Reduce numeric precision
 * - Strip pretty newlines / indentation
 */

function roundNumbersInPath(d, precision) {
  return d.replace(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi, (num) => {
    const n = Number(num);
    if (!Number.isFinite(n)) return num;
    const p = 10 ** precision;
    const v = Math.round(n * p) / p;
    return Object.is(v, -0) ? '0' : String(v);
  });
}

/**
 * Minify an SVG string produced by buildSvg / similar.
 */
export function minifySvg(svg, precision = 1) {
  let s = svg.trim();

  // Remove comments
  s = s.replace(/<!--[\s\S]*?-->/g, '');

  // Compact tags whitespace
  s = s.replace(/>\s+</g, '><');
  s = s.replace(/\s{2,}/g, ' ');
  s = s.replace(/\s+\/?>/g, '/>').replace(/\s+>/g, '>');

  // Tighten path data
  s = s.replace(/\sd="([^"]*)"/g, (_, d) => {
    let path = roundNumbersInPath(d, precision);
    path = path
      .replace(/,/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/\s*([MLHVCSQTAZmlhvcsqtaz])\s*/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
    return ` d="${path}"`;
  });

  // Drop redundant width/height if viewBox present (keep viewBox only for smaller file)
  // Keep width/height for usability — only strip spaces around attrs
  s = s.replace(/\s*=\s*/g, '=');

  return s;
}
