// Built-in Studio instruments, keyed by the contract's `instrumentId@version`. Pure: no Tone import, so the
// registry, labels and drum map run under vitest. engine.ts builds the Tone voice for each `voice`.
import { t } from '../../i18n';

/** The Tone voice recipe engine.ts builds for an instrument. */
export type InstrumentVoice = 'piano' | 'drum-kit' | 'bass' | 'synth-lead' | 'synth-pad';

export interface InstrumentDefinition {
  /** `instrumentId@version`, as stored on a track. */
  ref: string;
  voice: InstrumentVoice;
  /** Drum kits read pitches through the GM drum map; melodic instruments play pitches as notes. */
  drums: boolean;
  /** Longest release of the voice in seconds; the export tail covers it. */
  releaseSeconds: number;
}

const DEFINITIONS: readonly InstrumentDefinition[] = [
  { ref: 'piano@1', voice: 'piano', drums: false, releaseSeconds: 1.2 },
  { ref: 'drum-kit@1', voice: 'drum-kit', drums: true, releaseSeconds: 0.8 },
  { ref: 'bass@1', voice: 'bass', drums: false, releaseSeconds: 0.3 },
  { ref: 'synth-lead@1', voice: 'synth-lead', drums: false, releaseSeconds: 0.4 },
  { ref: 'synth-pad@1', voice: 'synth-pad', drums: false, releaseSeconds: 2 },
];
const BY_REF = new Map(DEFINITIONS.map((definition) => [definition.ref, definition]));

/** Audio tracks carry this ref (packages/studio DEFAULT_INSTRUMENTS). Recorded clips play from P2 on. */
export const AUDIO_INSTRUMENT = 'audio@1';

export type InstrumentResolution =
  | { status: 'ok'; instrument: InstrumentDefinition }
  /** Made by a newer Tayfa: the track keeps its notes and is shown with a labelled placeholder. */
  | { status: 'unknown'; id: string }
  /** Known, but this build cannot play it yet (recorded audio). */
  | { status: 'unsupported'; id: string };

export function resolveInstrument(ref: string): InstrumentResolution {
  const instrument = BY_REF.get(ref);
  if (instrument) return { status: 'ok', instrument };
  if (ref === AUDIO_INSTRUMENT) return { status: 'unsupported', id: ref };
  return { status: 'unknown', id: ref };
}

/** Built-in instruments for the instrument picker, in display order. */
export function instrumentChoices(): { ref: string; label: string; drums: boolean }[] {
  return DEFINITIONS.map((definition) => ({
    ref: definition.ref,
    label: instrumentLabel(definition.ref),
    drums: definition.drums,
  }));
}

/** Display name for any instrument ref, including placeholders for refs this build cannot play. */
export function instrumentLabel(ref: string): string {
  switch (ref) {
    case 'piano@1':
      return t('Piyano');
    case 'drum-kit@1':
      return t('Davul seti');
    case 'bass@1':
      return t('Bas');
    case 'synth-lead@1':
      return t('Lead synth');
    case 'synth-pad@1':
      return t('Pad synth');
    case AUDIO_INSTRUMENT:
      return t('Ses kaydı');
    default:
      return t('Bilinmeyen enstrüman');
  }
}

/** Why a track is silent, for the track header; null when the instrument plays. */
export function instrumentProblem(resolution: InstrumentResolution): string | null {
  if (resolution.status === 'unknown') return t('Bu enstrüman için Tayfa’yı güncelle');
  if (resolution.status === 'unsupported') return t('Ses kayıtları bu sürümde henüz çalınmıyor');
  return null;
}

export type DrumVoice = 'kick' | 'snare' | 'clap' | 'closed-hat' | 'open-hat' | 'tom' | 'rim';

export interface DrumHit {
  voice: DrumVoice;
  /** Toms are tuned per GM pitch; other voices ignore it. */
  frequency: number;
}

// General MIDI percussion 35–51 onto the synthesized kit. Cymbals (crash 49, ride 51) use the open hat.
const TOM_FREQUENCIES: Record<number, number> = {
  41: 82,
  43: 98,
  45: 110,
  47: 131,
  48: 147,
  50: 175,
};
const DRUM_MAP: Record<number, DrumVoice> = {
  35: 'kick',
  36: 'kick',
  37: 'rim',
  38: 'snare',
  39: 'clap',
  40: 'snare',
  41: 'tom',
  42: 'closed-hat',
  43: 'tom',
  44: 'closed-hat',
  45: 'tom',
  46: 'open-hat',
  47: 'tom',
  48: 'tom',
  49: 'open-hat',
  50: 'tom',
  51: 'open-hat',
};

/** The kit voice for a GM drum pitch, or null when the kit has none (reported, never dropped silently). */
export function drumHit(pitch: number): DrumHit | null {
  const voice = DRUM_MAP[pitch];
  if (!voice) return null;
  return { voice, frequency: TOM_FREQUENCIES[pitch] ?? 0 };
}

/** Step-sequencer rows of the built-in kit: one GM pitch per voice. */
export function drumRows(): { pitch: number; label: string }[] {
  return [
    { pitch: 36, label: t('Kick') },
    { pitch: 38, label: t('Trampet') },
    { pitch: 39, label: t('El çırpma') },
    { pitch: 37, label: t('Rim') },
    { pitch: 42, label: t('Kapalı hi-hat') },
    { pitch: 46, label: t('Açık hi-hat') },
    { pitch: 45, label: t('Alçak tom') },
    { pitch: 48, label: t('Yüksek tom') },
  ];
}

export function midiToFrequency(pitch: number): number {
  return 440 * 2 ** ((pitch - 69) / 12);
}
