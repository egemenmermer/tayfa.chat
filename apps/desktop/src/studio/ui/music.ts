import {
  MAX_BEATS_PER_BAR,
  MAX_TEMPO,
  MIN_BEATS_PER_BAR,
  MIN_TEMPO,
  TRACK_COLOR_COUNT,
  type StudioTimeSignature,
  type StudioTrack,
} from '@rooms/studio';
import { chartToken } from '../editors/colors';
import { barBeats } from '../engine/schedule';
import { t } from '../../i18n';

// Pure helpers of the Studio frame: time readouts, value clamps, colours and labels. No React, so tests
// and the fixtures share them.

/** `bar:beat`, both 1-based; the beat counts time-signature units (6/8 has six), matching the metronome. */
export function formatPosition(beat: number, signature: StudioTimeSignature): string {
  const safe = Number.isFinite(beat) && beat > 0 ? beat : 0;
  const perBar = barBeats(signature);
  // A hair of tolerance so 3.9999999 (float drift from the engine clock) does not read as the previous unit.
  const position = safe + 1e-6;
  const bar = Math.floor(position / perBar) + 1;
  const unit = Math.floor(((position % perBar) * signature.unit) / 4) + 1;
  return `${bar}:${Math.min(unit, signature.beats)}`;
}

/** Whole bars that hold `lengthBeats`, at least one. */
export function projectBars(lengthBeats: number, signature: StudioTimeSignature): number {
  return Math.max(1, Math.ceil(lengthBeats / barBeats(signature) - 1e-9));
}

/** A tempo from free text, or null when it is not a number; clamped to the contract range. */
export function parseTempo(text: string): number | null {
  const value = Number(text.replace(',', '.').trim());
  if (!text.trim() || !Number.isFinite(value)) return null;
  return Math.min(MAX_TEMPO, Math.max(MIN_TEMPO, Math.round(value)));
}

/** Time signatures offered in the picker; the project's own one is added when it is not listed. */
export const COMMON_SIGNATURES: StudioTimeSignature[] = [
  { beats: 2, unit: 4 },
  { beats: 3, unit: 4 },
  { beats: 4, unit: 4 },
  { beats: 5, unit: 4 },
  { beats: 6, unit: 8 },
  { beats: 7, unit: 8 },
  { beats: 9, unit: 8 },
  { beats: 12, unit: 8 },
];

export const signatureKey = (signature: StudioTimeSignature) =>
  `${signature.beats}/${signature.unit}`;

export function parseSignature(key: string): StudioTimeSignature | null {
  const match = /^(\d+)\/(4|8)$/.exec(key);
  if (!match) return null;
  const beats = Number(match[1]);
  if (beats < MIN_BEATS_PER_BAR || beats > MAX_BEATS_PER_BAR) return null;
  return { beats, unit: Number(match[2]) as 4 | 8 };
}

export function signatureChoices(current: StudioTimeSignature): StudioTimeSignature[] {
  return COMMON_SIGNATURES.some((choice) => signatureKey(choice) === signatureKey(current))
    ? COMMON_SIGNATURES
    : [...COMMON_SIGNATURES, current];
}

/**
 * CSS colour of track colour `index` (0–11). Track and presence colours use BoardUI's categorical chart ramp
 * (chart-1…9, then the -active shades), the same mapping as the editors' canvas palette.
 */
export function trackColor(index: number): string {
  return `var(${chartToken(index)})`;
}

export function trackColorName(index: number): string {
  const names = [
    t('Lavanta'),
    t('Adaçayı'),
    t('Kehribar'),
    t('Gök mavisi'),
    t('Pembe'),
    t('Yeşil'),
    t('Kırmızı'),
    t('Turkuaz'),
    t('Çivit'),
    t('Açık lavanta'),
    t('Açık adaçayı'),
    t('Açık kehribar'),
  ];
  return names[((index % names.length) + names.length) % names.length]!;
}

/** A stable colour per member, so one person keeps one colour in every view of the project. */
export function presenceColorIndex(userId: string): number {
  let hash = 0;
  for (const char of userId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % TRACK_COLOR_COUNT;
}

/** The name shown for a track; tracks start with an empty name and get a label from their kind. */
export function trackDisplayName(track: Pick<StudioTrack, 'name' | 'kind'>, position: number) {
  if (track.name.trim()) return track.name;
  if (track.kind === 'drums') return t('Davul {n}', { n: position });
  if (track.kind === 'audio') return t('Kayıt {n}', { n: position });
  return t('Parça {n}', { n: position });
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0]![0]! + parts[1]![0]! : (parts[0] ?? '?').slice(0, 2);
  return letters.toLocaleUpperCase();
}

/** "3 dk önce"-style relative time for the project list. */
export function relativeTime(at: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return t('az önce');
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t('{count} dk önce', { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t('{count} sa önce', { count: hours });
  const days = Math.round(hours / 24);
  return t('{count} gün önce', { count: days });
}

/** Linear track volume (0–1.5) as a percent label. */
export const volumePercent = (volume: number) => `${Math.round(volume * 100)}%`;
