type Rgb = [number, number, number];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseHue(value: string): number {
  const raw = Number.parseFloat(value);
  if (!Number.isFinite(raw)) return Number.NaN;
  return ((raw % 360) + 360) % 360;
}

function parsePercent(value: string): number {
  const raw = Number.parseFloat(value);
  if (!Number.isFinite(raw)) return Number.NaN;
  return clamp(raw / 100, 0, 1);
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;

  let r = 0;
  let g = 0;
  let b = 0;

  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }

  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

function parseColor(value: string): Rgb | null {
  const color = value.trim().toLowerCase();

  const hex = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const raw =
      hex[1].length === 3
        ? hex[1]
            .split("")
            .map((char) => char + char)
            .join("")
        : hex[1];
    return [
      Number.parseInt(raw.slice(0, 2), 16),
      Number.parseInt(raw.slice(2, 4), 16),
      Number.parseInt(raw.slice(4, 6), 16),
    ];
  }

  const rgb = color.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/);
  if (rgb) {
    return [
      clamp(Math.round(Number.parseFloat(rgb[1])), 0, 255),
      clamp(Math.round(Number.parseFloat(rgb[2])), 0, 255),
      clamp(Math.round(Number.parseFloat(rgb[3])), 0, 255),
    ];
  }

  const hsl = color.match(
    /^hsla?\(\s*([-\d.]+)(?:deg)?\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%/
  );
  if (hsl) {
    const h = parseHue(hsl[1]);
    const s = parsePercent(hsl[2]);
    const l = parsePercent(hsl[3]);
    if (Number.isFinite(h) && Number.isFinite(s) && Number.isFinite(l)) {
      return hslToRgb(h, s, l);
    }
  }

  return null;
}

export function rgbDistance(a: string, b: string): number {
  const first = parseColor(a);
  const second = parseColor(b);
  if (!first || !second) return Number.POSITIVE_INFINITY;

  return Math.hypot(
    first[0] - second[0],
    first[1] - second[1],
    first[2] - second[2]
  );
}

function isDistinctFromAll(
  candidate: string,
  existing: string[],
  minDistance: number
): boolean {
  return existing.every(
    (color) => rgbDistance(candidate, color) >= minDistance
  );
}

export function ensureReadableSeriesColors(
  colors: string[],
  fallbackPalette: string[],
  minDistance = 120
): string[] {
  const resolved: string[] = [];

  colors.forEach((color, index) => {
    if (isDistinctFromAll(color, resolved, minDistance)) {
      resolved.push(color);
      return;
    }

    const paletteCandidates = [
      fallbackPalette[index],
      ...fallbackPalette,
    ].filter((candidate): candidate is string => Boolean(candidate));
    const fallback = paletteCandidates.find((candidate) =>
      isDistinctFromAll(candidate, resolved, minDistance)
    );

    resolved.push(fallback ?? color);
  });

  return resolved;
}
