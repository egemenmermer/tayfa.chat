import { z } from 'zod';
export const soundboardClipSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1).max(40),
    durationSec: z.number().positive().max(8),
    ownerId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  })
  .strict();
export const soundboardCatalogSchema = z
  .object({
    communityId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    clips: z.array(soundboardClipSchema).max(32),
    canUpload: z.boolean(),
    canManage: z.boolean(),
  })
  .strict();
export type SoundboardClip = z.infer<typeof soundboardClipSchema>;
export type SoundboardCatalog = z.infer<typeof soundboardCatalogSchema>;
export interface SoundboardBridge {
  list(channelId: string): Promise<SoundboardCatalog>;
  upload(channelId: string, input: { name: string; audio: string }): Promise<SoundboardClip>;
  read(channelId: string, clipId: string): Promise<string>;
  remove(channelId: string, clipId: string): Promise<void>;
  /** Changes a community sound's name (its emoji lives in it); needs a server that supports PATCH. */
  rename(channelId: string, clipId: string, name: string): Promise<SoundboardClip>;
}
/**
 * A sound's emoji is stored as the first word of its name ("🎉 Air horn"), which keeps the server
 * catalog schema untouched: rc.34 clients and the iPhone app simply show the emoji as part of the name.
 */
export const SOUNDBOARD_NAME_MAX = 40;
/** Longest emoji (UTF-16 units) a sound may carry: a family ZWJ sequence is 11. */
export const SOUNDBOARD_EMOJI_MAX_UNITS = 14;
const emojiPattern =
  /^(?:\p{Regional_Indicator}{2}|[0-9#*]️?⃣|\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})?(?:‍\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})?)*)$/u;
/** The emoji when `value` is exactly one emoji, otherwise an empty string. */
export function cleanSoundEmoji(value: unknown) {
  if (typeof value !== 'string') return '';
  const emoji = value.trim();
  return emoji && emoji.length <= SOUNDBOARD_EMOJI_MAX_UNITS && emojiPattern.test(emoji)
    ? emoji
    : '';
}
/** Splits a stored name into its optional leading emoji and the visible label. */
export function splitSoundName(name: string) {
  const space = name.indexOf(' ');
  const head = space < 0 ? name : name.slice(0, space);
  const emoji = cleanSoundEmoji(head);
  if (!emoji) return { emoji: '', label: name };
  return { emoji, label: space < 0 ? '' : name.slice(space + 1).trim() };
}
/** Joins an emoji and a label into a stored name of at most 40 characters. */
export function joinSoundName(emoji: string, label: string) {
  const clean = cleanSoundEmoji(emoji),
    text = label.trim();
  if (!clean) return text.slice(0, SOUNDBOARD_NAME_MAX);
  return `${clean} ${text}`.trim().slice(0, SOUNDBOARD_NAME_MAX).trim();
}

/** What is broadcast to the voice room when a sound plays; everything beyond `e` is ignored. */
export const SOUNDBOARD_REACTION_TOPIC = 'rooms-reaction-v1';
export function soundboardReactionPayload(emoji: string) {
  const clean = cleanSoundEmoji(emoji);
  return clean ? JSON.stringify({ v: 1, k: 'sound', e: clean }) : '';
}
/** The emoji of a received reaction packet, or '' for anything unknown or malformed. */
export function parseSoundboardReaction(payload: string) {
  try {
    const value = JSON.parse(payload) as { k?: unknown; e?: unknown } | null;
    return value && typeof value === 'object' && value.k === 'sound'
      ? cleanSoundEmoji(value.e)
      : '';
  } catch {
    return '';
  }
}
