// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  cleanSoundEmoji,
  joinSoundName,
  parseSoundboardReaction,
  soundboardClipSchema,
  soundboardReactionPayload,
  splitSoundName,
} from '../packages/shared-contracts/src/soundboard';
import { useCommunity } from '../apps/desktop/src/community';

const realtime = vi.hoisted(() => ({
  listeners: new Set<(payload: string, sender: string) => void>(),
  play: vi.fn(async () => {}),
  publish: vi.fn(),
}));
vi.mock('../apps/desktop/src/realtime', () => ({
  useRealtime: () => ({ channelId: 'voice', status: 'connected', muted: false, deafened: false }),
  playSoundboard: realtime.play,
  stopSoundboard: vi.fn(),
  publishReaction: realtime.publish,
  onReaction: (listener: (payload: string, sender: string) => void) => {
    realtime.listeners.add(listener);
    return () => realtime.listeners.delete(listener);
  },
}));
vi.mock('../apps/desktop/src/soundboard-audio', () => ({
  encodeSoundboard: () => 'encoded',
  soundboardBytes: () => new ArrayBuffer(8),
}));
import { SoundboardButton } from '../apps/desktop/src/Soundboard';
import { floatEmoji, useFloatingEmoji } from '../apps/desktop/src/SoundboardFloaters';

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const clip = (n: number, name: string, ownerId = 'alice') => ({
  id: id(n),
  name,
  durationSec: 1.5,
  ownerId,
});
let clips = [clip(1, '🎉 Air horn'), clip(2, 'Plain sound')];
const bridge = {
  list: vi.fn(async () => ({ communityId: 'c', clips, canUpload: true, canManage: false })),
  upload: vi.fn(async (_c: string, input: { name: string }) => clip(3, input.name)),
  read: vi.fn(async () => 'AAAA'),
  remove: vi.fn(async () => {}),
  rename: vi.fn(async (_c: string, clipId: string, name: string) => ({
    ...clips.find((c) => c.id === clipId)!,
    name,
  })),
};
beforeEach(() => {
  clips = [clip(1, '🎉 Air horn'), clip(2, 'Plain sound')];
  useCommunity.setState({
    user: { id: 'alice', username: 'alice', displayName: 'Alice', avatar: null },
    serverUrl: 'https://example.test',
  } as never);
  (window as unknown as { rooms: unknown }).rooms = { soundboard: bridge };
  vi.stubGlobal(
    'AudioContext',
    class {
      decodeAudioData = async () => ({
        duration: 1,
        length: 48000,
        sampleRate: 48000,
        numberOfChannels: 1,
        getChannelData: () => new Float32Array(48000),
      });
      close = async () => {};
    },
  );
  useFloatingEmoji.setState({ items: [] });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  realtime.listeners.clear();
  document.documentElement.removeAttribute('data-motion');
  delete (window as unknown as { rooms?: unknown }).rooms;
});
const open = async () => {
  render(<SoundboardButton showTrigger={false} />);
  act(() => void window.dispatchEvent(new Event('rooms:open-soundboard')));
  await screen.findByRole('button', { name: '🎉 Air horn' });
};

it('keeps old sounds working: the emoji is the first word of the name and old names have none', () => {
  expect(splitSoundName('Plain sound')).toEqual({ emoji: '', label: 'Plain sound' });
  expect(splitSoundName('🎉 Air horn')).toEqual({ emoji: '🎉', label: 'Air horn' });
  expect(splitSoundName('🇹🇷 Marş')).toEqual({ emoji: '🇹🇷', label: 'Marş' });
  expect(splitSoundName('👨‍👩‍👧 Aile')).toEqual({ emoji: '👨‍👩‍👧', label: 'Aile' });
  expect(splitSoundName('1️⃣ bir')).toEqual({ emoji: '1️⃣', label: 'bir' });
  expect(splitSoundName('1 bir')).toEqual({ emoji: '', label: '1 bir' });
  expect(splitSoundName('🎉🎉 two')).toEqual({ emoji: '', label: '🎉🎉 two' });
  expect(splitSoundName('🔥')).toEqual({ emoji: '🔥', label: '' });
  // The stored name still satisfies the unchanged strict clip schema that rc.34 uses.
  const stored = joinSoundName('🎉', 'Air horn');
  expect(stored).toBe('🎉 Air horn');
  expect(
    soundboardClipSchema.safeParse({ id: id(1), name: stored, durationSec: 1, ownerId: 'a' })
      .success,
  ).toBe(true);
  expect(joinSoundName('', ' Plain ')).toBe('Plain');
  expect(joinSoundName('not emoji', 'x')).toBe('x');
  expect(joinSoundName('👨‍👩‍👧', 'x'.repeat(60))).toHaveLength(40);
  expect(cleanSoundEmoji('<script>')).toBe('');
  expect(cleanSoundEmoji('😀😀')).toBe('');
});

it('reads only a single emoji out of a reaction packet and ignores everything else', () => {
  expect(parseSoundboardReaction(soundboardReactionPayload('🔥'))).toBe('🔥');
  expect(soundboardReactionPayload('hello')).toBe('');
  for (const bad of [
    '',
    'nope',
    '{"k":"other","e":"🔥"}',
    '{"k":"sound","e":"hi"}',
    'null',
    '{"k":"sound"}',
  ])
    expect(parseSoundboardReaction(bad)).toBe('');
  // Future fields on the packet are ignored by this client.
  expect(parseSoundboardReaction('{"v":2,"k":"sound","e":"🔥","name":"x","x":1}')).toBe('🔥');
});

it('plays a sound, broadcasts its emoji to the room and floats it locally; no emoji, no broadcast', async () => {
  await open();
  fireEvent.click(screen.getByRole('button', { name: '🎉 Air horn' }));
  await waitFor(() => expect(realtime.publish).toHaveBeenCalledTimes(1), { timeout: 5000 });
  expect(realtime.play).toHaveBeenCalledTimes(1);
  expect(parseSoundboardReaction(realtime.publish.mock.calls[0][0] as string)).toBe('🎉');
  expect(useFloatingEmoji.getState().items.map((item) => item.emoji)).toEqual(['🎉']);
  fireEvent.click(screen.getByRole('button', { name: 'Plain sound' }));
  await waitFor(() => expect(realtime.play).toHaveBeenCalledTimes(2), { timeout: 5000 });
  expect(realtime.publish).toHaveBeenCalledTimes(1);
});

it('floats an emoji received from the room, ignores junk and respects reduced motion', async () => {
  render(<SoundboardButton showTrigger={false} />);
  const [receive] = [...realtime.listeners];
  expect(receive).toBeTypeOf('function');
  act(() => receive(soundboardReactionPayload('🔥'), 'carol'));
  expect(useFloatingEmoji.getState().items.map((item) => item.emoji)).toEqual(['🔥']);
  expect(document.querySelectorAll('.sb-float')).toHaveLength(1);
  act(() => receive('garbage', 'carol'));
  act(() => receive('{"k":"sound","e":"<img>"}', 'carol'));
  expect(useFloatingEmoji.getState().items).toHaveLength(1);
  // A flood is capped.
  act(() => {
    for (let i = 0; i < 60; i++) floatEmoji('🎉');
  });
  expect(useFloatingEmoji.getState().items.length).toBeLessThanOrEqual(24);
  // Reduced motion: nothing is started.
  useFloatingEmoji.setState({ items: [] });
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  expect(floatEmoji('🔥')).toBe(false);
  expect(useFloatingEmoji.getState().items).toEqual([]);
  // Unless the user forced motion on inside Settings.
  document.documentElement.setAttribute('data-motion', 'full');
  expect(floatEmoji('🔥')).toBe(true);
});

it('asks for an emoji and a name before an upload and stores both in the name', async () => {
  await open();
  const file = new File([new Uint8Array(10)], 'beep.mp3', { type: 'audio/mpeg' });
  (file as unknown as { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer = async () =>
    new ArrayBuffer(10);
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
  const form = await screen.findByRole('group', { name: 'Yeni ses' });
  expect(bridge.upload).not.toHaveBeenCalled();
  expect(within(form).getByLabelText('Ses adı')).toHaveProperty('value', 'beep');
  fireEvent.click(within(form).getByRole('button', { name: 'Emoji seç' }));
  fireEvent.click(await screen.findByRole('button', { name: '🔥' }));
  expect(within(form).getByRole('button', { name: 'Emoji seç' }).textContent).toBe('🔥');
  // Picking an emoji only fills the form; nothing is uploaded until Kaydet.
  expect(bridge.upload).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(within(form).getByRole('button', { name: 'Kaydet' })).toHaveProperty('disabled', false),
  );
  fireEvent.click(within(form).getByRole('button', { name: 'Kaydet' }));
  await waitFor(() => expect(bridge.upload).toHaveBeenCalledTimes(1));
  expect(bridge.upload.mock.calls[0][1]).toEqual({ name: '🔥 beep', audio: 'encoded' });
  await waitFor(() => expect(screen.queryByRole('group', { name: 'Yeni ses' })).toBeNull());
});

it('edits the emoji of an existing sound and renames it on the server', async () => {
  await open();
  const edit = screen.getByRole('button', { name: '🎉 Air horn sesini düzenle' });
  fireEvent.click(edit);
  const form = await screen.findByRole('group', { name: 'Sesi düzenle' });
  expect(within(form).getByLabelText('Ses adı')).toHaveProperty('value', 'Air horn');
  expect(within(form).getByRole('button', { name: 'Emoji seç' }).textContent).toBe('🎉');
  fireEvent.click(within(form).getByRole('button', { name: 'Emojiyi kaldır' }));
  fireEvent.click(within(form).getByRole('button', { name: 'Kaydet' }));
  await waitFor(() => expect(bridge.rename).toHaveBeenCalledTimes(1));
  expect(bridge.rename).toHaveBeenCalledWith('voice', id(1), 'Air horn');
});
