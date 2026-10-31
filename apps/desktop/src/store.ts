import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_PUSH_TO_TALK_KEY, parsePushToTalkKey } from './push-to-talk-key';
import { normalizeGlobalShortcut } from './global-shortcut';
import {
  MIC_GATE_DEFAULT_DB,
  clampMicGateThreshold,
} from '../../../packages/media-providers/src/mic-gate';

export interface Preferences {
  roomEventSounds: boolean;
  /** Short cues for this listener's microphone and deafen toggles and for streams in their room. */
  voiceCues: boolean;
  /** This viewer's screen share quality: 'auto' (the top layer the network carries) or a line cap. */
  screenQuality: 'auto' | number;
  /** Other people's chosen entrance and leave sounds; off plays the classic cue for everyone. */
  personalSounds: boolean;
  /** Listener-side level for room cues and personal sounds, 0–1. */
  soundEffectsLevel: number;
  followSystemAccessibility: boolean;
  noiseSuppression: boolean;
  noiseSuppressionMode: 'standard' | 'strong';
  pushToTalk: boolean;
  pushToTalkKey: string;
  /** System-wide mute toggle in push-to-talk key format; empty is no shortcut. */
  muteKey: string;
  /** System-wide deafen toggle; empty is no shortcut. */
  deafenKey: string;
  reduceMotion: boolean;
  reduceTransparency: boolean;
  compact: boolean;
  /** Members docked beside channels on wide windows, open until closed (rc.36; replaces showFriends). */
  memberPanel: boolean;
  serverUrl: string;
  inputId: string;
  outputId: string;
  /** Camera for rooms and calls; empty is the system default. */
  cameraId: string;
  notifications: boolean;
  chatFontSize: number;
  accent: 'pearl' | 'sage';
  /** The microphone as the person last left it; a first join starts muted. */
  microphoneOn: boolean;
  /** Microphone level per device name, 0–200 % (100 sends it as captured). */
  inputLevels: Record<string, number>;
  /** Input sensitivity follows the noise floor; off uses `inputSensitivity`. */
  inputSensitivityAuto: boolean;
  /** Manual input sensitivity in dBFS: quieter sound is not sent. */
  inputSensitivity: number;
  /** "Ses seviyesini dengele": the leveler after the noise filter. */
  micLeveler: boolean;
}
const defaults: Preferences = {
  roomEventSounds: true,
  voiceCues: true,
  screenQuality: 'auto',
  personalSounds: true,
  soundEffectsLevel: 1,
  followSystemAccessibility: true,
  noiseSuppression: true,
  noiseSuppressionMode: 'strong',
  pushToTalk: false,
  pushToTalkKey: DEFAULT_PUSH_TO_TALK_KEY,
  muteKey: '',
  deafenKey: '',
  reduceMotion: false,
  reduceTransparency: false,
  compact: false,
  memberPanel: true,
  serverUrl: '',
  inputId: '',
  outputId: '',
  cameraId: '',
  notifications: false,
  chatFontSize: 15,
  accent: 'pearl',
  microphoneOn: false,
  inputLevels: {},
  inputSensitivityAuto: true,
  inputSensitivity: MIC_GATE_DEFAULT_DB,
  micLeveler: true,
};
interface RoomsState {
  preferences: Preferences;
  setPreferences(value: Preferences): void;
  setPreference<K extends keyof Preferences>(key: K, value: Preferences[K]): void;
}
/** 'auto' or a whole line count up to 8K; anything else falls back to 'auto'. */
export function normalizeScreenQuality(value: unknown): 'auto' | number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 4320
    ? value
    : 'auto';
}
export function normalizeSoundEffectsLevel(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
}
export const INPUT_LEVEL_DEVICES = 32;
export function normalizeInputLevel(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(200, Math.round(value)))
    : 100;
}
/** Keeps the newest named devices; an unknown or malformed entry is dropped, never guessed. */
export function normalizeInputLevels(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const entries = Object.entries(value as Record<string, unknown>).filter(
    ([name, level]) =>
      name.length > 0 && name.length <= 200 && typeof level === 'number' && Number.isFinite(level),
  );
  return Object.fromEntries(
    entries.slice(-INPUT_LEVEL_DEVICES).map(([name, level]) => [name, normalizeInputLevel(level)]),
  );
}
/** The levels with one device's level set; it moves to the newest end of the list. */
export function withInputLevel(levels: Record<string, number>, device: string, percent: number) {
  const next = { ...levels };
  delete next[device];
  next[device] = normalizeInputLevel(percent);
  return normalizeInputLevels(next);
}
export function normalizeChatFontSize(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(14, Math.min(18, Math.round(value)))
    : 15;
}
/** Preserve genuine device preferences, discard legacy local social fixtures. */
function preferencesFrom(value: unknown): Preferences {
  const result = { ...defaults };
  if (!value || typeof value !== 'object') return result;
  const previous = (value as { preferences?: Record<string, unknown> }).preferences;
  if (!previous) return result;
  for (const key of Object.keys(defaults) as (keyof Preferences)[]) {
    if (key === 'noiseSuppressionMode') {
      result.noiseSuppressionMode = previous[key] === 'standard' ? 'standard' : 'strong';
      continue;
    }
    if (key === 'pushToTalkKey') {
      if (parsePushToTalkKey(previous[key])) result.pushToTalkKey = previous[key] as string;
      continue;
    }
    if (key === 'muteKey' || key === 'deafenKey') {
      result[key] = normalizeGlobalShortcut(previous[key]);
      continue;
    }
    if (key === 'chatFontSize') {
      result.chatFontSize = normalizeChatFontSize(previous[key]);
      continue;
    }
    if (key === 'screenQuality') {
      result.screenQuality = normalizeScreenQuality(previous[key]);
      continue;
    }
    if (key === 'soundEffectsLevel') {
      result.soundEffectsLevel = normalizeSoundEffectsLevel(previous[key]);
      continue;
    }
    if (key === 'inputLevels') {
      result.inputLevels = normalizeInputLevels(previous[key]);
      continue;
    }
    if (key === 'inputSensitivity') {
      result.inputSensitivity = clampMicGateThreshold(previous[key]);
      continue;
    }
    if (
      typeof previous[key] === typeof defaults[key] &&
      (key !== 'accent' || previous[key] === 'pearl' || previous[key] === 'sage')
    )
      Object.assign(result, { [key]: previous[key] });
  }
  return result;
}
export const useRooms = create<RoomsState>()(
  persist(
    (set) => ({
      preferences: { ...defaults },
      setPreferences: (value) => set({ preferences: preferencesFrom({ preferences: value }) }),
      setPreference: (key, value) =>
        set((state) => ({
          preferences: {
            ...state.preferences,
            [key]:
              key === 'chatFontSize'
                ? normalizeChatFontSize(value)
                : key === 'screenQuality'
                  ? normalizeScreenQuality(value)
                  : key === 'soundEffectsLevel'
                    ? normalizeSoundEffectsLevel(value)
                    : key === 'inputLevels'
                      ? normalizeInputLevels(value)
                      : key === 'inputSensitivity'
                        ? clampMicGateThreshold(value)
                        : value,
          },
        })),
    }),
    {
      name: 'rooms-local-v1',
      version: 1,
      migrate: (previous) => ({ preferences: preferencesFrom(previous) }),
      merge: (previous, current) => ({ ...current, preferences: preferencesFrom(previous) }),
      partialize: (state) => ({ preferences: state.preferences }),
    },
  ),
);
