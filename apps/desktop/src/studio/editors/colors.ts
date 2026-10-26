// Canvas colours. The editors draw on canvas, which cannot read `var(--token)`, so tokens are
// resolved once through a probe element inside the BoardUI region and cached per element theme.
// Track colours (0–11) and presence colours share BoardUI's categorical chart ramp (chart-1…9, then
// the -active variants), which starts with Tayfa's accents.

export function chartToken(index: number): string {
  const i = ((Math.trunc(index) % 12) + 12) % 12;
  return i < 9 ? `--color-chart-${i + 1}` : `--color-chart-${i - 8}-active`;
}

export interface EditorPalette {
  background: string;
  lane: string;
  laneAlt: string;
  gridBar: string;
  gridBeat: string;
  gridFine: string;
  ruler: string;
  rulerText: string;
  text: string;
  textMuted: string;
  accent: string;
  selection: string;
  playhead: string;
  blackKey: string;
  whiteKey: string;
  loop: string;
  chart: string[];
}

const TOKENS: Record<Exclude<keyof EditorPalette, 'chart'>, string> = {
  background: '--color-background-canvas',
  lane: '--color-background-secondary-default',
  laneAlt: '--color-background-tertiary-default',
  gridBar: '--color-separator-border-strong',
  gridBeat: '--color-separator-border',
  gridFine: '--color-border-subtle',
  ruler: '--color-background-raised',
  rulerText: '--color-text-secondary',
  text: '--color-text-primary',
  textMuted: '--color-text-tertiary',
  accent: '--color-accent-500',
  selection: '--color-text-white',
  playhead: '--color-text-primary',
  blackKey: '--color-background-main',
  whiteKey: '--color-background-hover',
  loop: '--color-accent-500',
};

const cache = new WeakMap<Element, EditorPalette>();

export function resolvePalette(host: Element): EditorPalette {
  const cached = cache.get(host);
  if (cached) return cached;
  const probe = document.createElement('span');
  probe.style.display = 'none';
  host.append(probe);
  const read = (token: string, fallback: string) => {
    probe.style.color = '';
    probe.style.color = `var(${token}, ${fallback})`;
    return toRgb(getComputedStyle(probe).color || fallback);
  };
  const palette = Object.fromEntries(
    Object.entries(TOKENS).map(([key, token]) => [key, read(token, '#888')]),
  ) as Omit<EditorPalette, 'chart'>;
  const chart = Array.from({ length: 12 }, (_, i) => read(chartToken(i), '#a78bfa'));
  probe.remove();
  const result = { ...palette, chart };
  cache.set(host, result);
  return result;
}

let pixel: CanvasRenderingContext2D | null | undefined;

/**
 * Normalises any computed CSS colour (oklab(), color(srgb …), color-mix results) to `r,g,b` by
 * painting one pixel, so every canvas fill below is plain rgb()/rgba() the 2D context always parses.
 */
function toRgb(color: string): string {
  if (/^rgba?\(/.test(color)) return color;
  if (pixel === undefined) {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      pixel = canvas.getContext('2d', { willReadFrequently: true });
    } catch {
      pixel = null;
    }
  }
  if (!pixel) return 'rgb(136, 136, 136)';
  pixel.clearRect(0, 0, 1, 1);
  pixel.fillStyle = '#888';
  pixel.fillStyle = color;
  pixel.fillRect(0, 0, 1, 1);
  const data = pixel.getImageData(0, 0, 1, 1)?.data;
  if (!data) return color;
  const [r, g, b, a] = data;
  return a === 255 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
}

/** A palette colour (always rgb()/rgba()) with its alpha multiplied, for canvas fills. */
export function withAlpha(color: string, alpha: number): string {
  const match = /^rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/.exec(color);
  if (!match) return color;
  const base = match[4] === undefined ? 1 : Number(match[4]);
  return `rgba(${match[1]}, ${match[2]}, ${match[3]}, ${(base * alpha).toFixed(3)})`;
}
