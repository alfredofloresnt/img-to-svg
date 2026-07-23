/**
 * Synthetic ImageData-like fixtures for pipeline tests.
 */

export function createImageData(width, height, fill = [255, 255, 255, 255]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = fill[0];
    data[i * 4 + 1] = fill[1];
    data[i * 4 + 2] = fill[2];
    data[i * 4 + 3] = fill[3];
  }
  return { data, width, height };
}

export function setPixel(img, x, y, rgba) {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const i = (y * img.width + x) * 4;
  img.data[i] = rgba[0];
  img.data[i + 1] = rgba[1];
  img.data[i + 2] = rgba[2];
  img.data[i + 3] = rgba[3];
}

/** Solid black square on white — classic logo-like image. */
export function solidSquare(size = 64, inset = 12) {
  const img = createImageData(size, size, [255, 255, 255, 255]);
  for (let y = inset; y < size - inset; y++) {
    for (let x = inset; x < size - inset; x++) {
      setPixel(img, x, y, [0, 0, 0, 255]);
    }
  }
  return img;
}

/** Filled circle (disk) on white. */
export function solidCircle(size = 64, radius = 20) {
  const img = createImageData(size, size, [255, 255, 255, 255]);
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= radius * radius) {
        setPixel(img, x, y, [20, 20, 20, 255]);
      }
    }
  }
  return img;
}

/** Two-color geometric mark: orange triangle + dark bar. */
export function twoColorMark(size = 80) {
  const img = createImageData(size, size, [245, 245, 245, 255]);
  // Dark horizontal bar
  for (let y = 55; y < 68; y++) {
    for (let x = 10; x < 70; x++) setPixel(img, x, y, [15, 15, 18, 255]);
  }
  // Orange triangle
  for (let y = 12; y < 50; y++) {
    const t = (y - 12) / 38;
    const half = Math.floor(t * 22);
    const cx = 40;
    for (let x = cx - half; x <= cx + half; x++) {
      setPixel(img, x, y, [232, 93, 4, 255]);
    }
  }
  return img;
}

/** Noisy speckles around a clean square (for speckle filter). */
export function speckledSquare(size = 64) {
  const img = solidSquare(size, 16);
  const noise = [
    [2, 2], [3, 2], [60, 3], [4, 60], [58, 58], [59, 58], [58, 59],
  ];
  for (const [x, y] of noise) setPixel(img, x, y, [0, 0, 0, 255]);
  return img;
}

/** Letter-like ring / “D” counter: black frame with white hole. */
export function ringWithHole(size = 64, outer = 8, hole = 20) {
  const img = createImageData(size, size, [255, 255, 255, 255]);
  for (let y = outer; y < size - outer; y++) {
    for (let x = outer; x < size - outer; x++) {
      setPixel(img, x, y, [0, 0, 0, 255]);
    }
  }
  for (let y = hole; y < size - hole; y++) {
    for (let x = hole; x < size - hole; x++) {
      setPixel(img, x, y, [255, 255, 255, 255]);
    }
  }
  return img;
}
