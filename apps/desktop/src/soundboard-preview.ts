/** The soundboard level for new members; a level someone set is kept (rc.36, was 50%). */
export const SOUNDBOARD_DEFAULT_LEVEL = 0.2;

/** A saved soundboard level (0–1) from storage, or the default when none or invalid. */
export function soundboardLevel(saved: string | null) {
  if (saved === null) return SOUNDBOARD_DEFAULT_LEVEL;
  const level = Number(saved);
  return Number.isFinite(level) && level >= 0 && level <= 1 ? level : SOUNDBOARD_DEFAULT_LEVEL;
}

let active: { context: AudioContext; source: AudioBufferSourceNode } | null = null;

export function stopSoundPreview() {
  const current = active;
  active = null;
  if (!current) return;
  try {
    current.source.stop();
  } catch {
    /* Already ended. */
  }
  void current.context.close();
}

/**
 * Plays a sound for this computer only, never into the room: "Dene" lets a member hear it
 * before everyone does. One preview at a time, at the soundboard level, on the chosen output.
 */
export async function previewSound(buffer: AudioBuffer, volume: number, sinkId = '') {
  stopSoundPreview();
  const context = new AudioContext();
  const output = context as AudioContext & { setSinkId?(id: string): Promise<void> };
  if (sinkId && output.setSinkId) await output.setSinkId(sinkId).catch(() => {});
  const gain = context.createGain();
  gain.gain.value = volume;
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(gain).connect(context.destination);
  source.onended = () => {
    if (active?.source !== source) return;
    active = null;
    void context.close();
  };
  active = { context, source };
  source.start();
}
