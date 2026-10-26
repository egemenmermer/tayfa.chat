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
    return getComputedStyle(probe).color || fallback;
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

/** `color` with alpha, for canvas fills from a resolved CSS colour string. */
export function withAlpha(color: string, alpha: number): string {
  return `color-mix(in srgb, ${color} ${Math.round(alpha * 100)}%, transparent)`;
}
