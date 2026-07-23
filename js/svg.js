/**
 * Stage 7 — SVG generation
 * Assemble path commands into a valid SVG string (no external libs).
 */

import { paletteToHex } from './quantize.js';

function fmt(n, precision) {
  const p = 10 ** precision;
  const v = Math.round(n * p) / p;
  return Object.is(v, -0) ? '0' : String(v);
}

/**
 * Serialize path command list to `d` attribute.
 */
export function commandsToD(commands, precision = 2) {
  const parts = [];
  for (const c of commands) {
    if (c.type === 'M') parts.push(`M${fmt(c.x, precision)} ${fmt(c.y, precision)}`);
    else if (c.type === 'L') parts.push(`L${fmt(c.x, precision)} ${fmt(c.y, precision)}`);
    else if (c.type === 'C') {
      parts.push(
        `C${fmt(c.c1x, precision)} ${fmt(c.c1y, precision)} ${fmt(c.c2x, precision)} ${fmt(c.c2y, precision)} ${fmt(c.x, precision)} ${fmt(c.y, precision)}`
      );
    } else if (c.type === 'Z') parts.push('Z');
  }
  return parts.join('');
}

function countNodes(commands) {
  let n = 0;
  for (const c of commands) {
    if (c.type === 'M' || c.type === 'L') n += 1;
    else if (c.type === 'C') n += 3;
  }
  return n;
}

/**
 * Scale path commands from source pixel space into target viewBox size.
 */
export function scaleCommands(commands, srcW, srcH, outW, outH) {
  const sx = outW / srcW;
  const sy = outH / srcH;
  return commands.map((c) => {
    if (c.type === 'M' || c.type === 'L') {
      return { ...c, x: c.x * sx, y: c.y * sy };
    }
    if (c.type === 'C') {
      return {
        ...c,
        c1x: c.c1x * sx,
        c1y: c.c1y * sy,
        c2x: c.c2x * sx,
        c2y: c.c2y * sy,
        x: c.x * sx,
        y: c.y * sy,
      };
    }
    return c;
  });
}

/**
 * Build SVG from fitted layer paths.
 * @param {Array<{ color, paths: command[][] }>} layers
 * @param {object} options
 */
export function buildSvg(layers, options = {}) {
  const {
    srcWidth,
    srcHeight,
    outWidth = srcWidth,
    outHeight = srcHeight,
    strokeMode = false,
    strokeWidth = 1,
    /** Hairline same-color stroke to close sub-pixel seams between fills */
    seamStroke = 0.6,
    precision = 2,
    pretty = true,
  } = options;

  const vw = outWidth;
  const vh = outHeight;
  // Scale seam stroke with output size so it stays ~constant in source pixels
  const seam =
    seamStroke > 0
      ? Math.max(0.15, (seamStroke * Math.min(vw / srcWidth, vh / srcHeight)))
      : 0;
  const pathEls = [];
  let pathCount = 0;
  let nodeCount = 0;

  for (const layer of layers) {
    const hex = paletteToHex(layer.color);
    for (const cmds of layer.paths) {
      const scaled = scaleCommands(cmds, srcWidth, srcHeight, vw, vh);
      const d = commandsToD(scaled, precision);
      if (!d) continue;
      pathCount++;
      nodeCount += countNodes(cmds);
      if (strokeMode) {
        pathEls.push(
          `<path d="${d}" fill="none" stroke="${hex}" stroke-width="${fmt(strokeWidth, 2)}" stroke-linejoin="round" stroke-linecap="round"/>`
        );
      } else if (seam > 0) {
        // evenodd holes + matching stroke closes gaps between adjacent color layers
        pathEls.push(
          `<path d="${d}" fill="${hex}" fill-rule="evenodd" stroke="${hex}" stroke-width="${fmt(seam, 2)}" stroke-linejoin="round"/>`
        );
      } else {
        pathEls.push(`<path d="${d}" fill="${hex}" fill-rule="evenodd"/>`);
      }
    }
  }

  const body = pretty ? pathEls.map((p) => `  ${p}`).join('\n') : pathEls.join('');
  const svg = pretty
    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(vw, 2)} ${fmt(vh, 2)}" width="${fmt(vw, 2)}" height="${fmt(vh, 2)}">\n${body}\n</svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(vw, 2)} ${fmt(vh, 2)}">${body}</svg>`;

  return {
    svg,
    stats: {
      pathCount,
      nodeCount,
      bytes: new TextEncoder().encode(svg).length,
      width: vw,
      height: vh,
    },
  };
}
