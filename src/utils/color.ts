interface RGB {
  r: number;
  g: number;
  b: number;
}

function parseHex(hex: string): RGB {
  const clean = hex.replace('#', '').trim();
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean.padEnd(6, '0').slice(0, 6);

  const num = Number.parseInt(full, 16);
  if (Number.isNaN(num)) {
    return { r: 37, g: 99, b: 235 };
  }
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

function mixChannel(a: number, b: number, weight: number): number {
  return Math.round(a * (1 - weight) + b * weight);
}

function mixRgb(base: RGB, target: RGB, weight: number): string {
  const r = mixChannel(base.r, target.r, weight);
  const g = mixChannel(base.g, target.g, weight);
  const b = mixChannel(base.b, target.b, weight);
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Generates a rich, cinema-grade directional gradient from a single hex color
 * for cards that do not provide an icon image.
 */
export function buildCardGradient(hex: string): string {
  const base = parseHex(hex);
  const lightLift = mixRgb(base, { r: 255, g: 255, b: 255 }, 0.14);
  const midTone = mixRgb(base, { r: 10, g: 13, b: 20 }, 0.24);
  const deepShadow = mixRgb(base, { r: 8, g: 10, b: 16 }, 0.68);
  return `linear-gradient(135deg, ${lightLift} 0%, ${midTone} 52%, ${deepShadow} 100%)`;
}

/**
 * Generates a subtle dark surface tint derived from the app's brand color
 * for cards that display an icon image.
 */
export function buildIconTileSurface(hex: string): string {
  const base = parseHex(hex);
  const topTint = mixRgb(base, { r: 16, g: 20, b: 28 }, 0.66);
  const bottomTint = mixRgb(base, { r: 11, g: 14, b: 20 }, 0.88);
  return `linear-gradient(145deg, ${topTint} 0%, ${bottomTint} 100%)`;
}
