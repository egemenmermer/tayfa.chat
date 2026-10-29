// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within, act } from '@testing-library/react';
import { soundDuration } from '../apps/services/access/soundboard';
import { encodeSoundboard } from '../apps/desktop/src/soundboard-audio';
import {
  clampSelection,
  initialSelection,
  isTrimmed,
  nudgeSelection,
  sampleToSeconds,
  secondsToSample,
  selectionSamples,
  trimIssue,
  waveformPeaks,
} from '../apps/desktop/src/soundboard-trim';
import { keyboardStep, SoundboardTrimmer } from '../apps/desktop/src/SoundboardTrimmer';
import { useCommunity } from '../apps/desktop/src/community';

const realtime = vi.hoisted(() => ({ play: vi.fn(async () => {}) }));
vi.mock('../apps/desktop/src/realtime', () => ({
  useRealtime: () => ({ channelId: 'voice', status: 'connected', muted: false, deafened: false }),
  playSoundboard: realtime.play,
  stopSoundboard: vi.fn(),
  publishReaction: vi.fn(),
  onReaction: () => () => {},
}));
import { SoundboardButton } from '../apps/desktop/src/Soundboard';

/** A mono/stereo AudioBuffer stand-in: a ramp so every sample is distinguishable. */
function fakeBuffer(seconds: number, channels = 1, rate = 48000) {
  const length = Math.round(seconds * rate),
    data = Array.from({ length: channels }, () => {
      const values = new Float32Array(length);
      for (let i = 0; i < length; i++) values[i] = 0.5 * Math.sin(i / 50);
      return values;
    });
  return {
    sampleRate: rate,
    length,
    duration: length / rate,
    numberOfChannels: channels,
    getChannelData: (i: number) => data[i],
  } as unknown as AudioBuffer;
}

it('converts between samples and seconds', () => {
  expect(secondsToSample(1.5, 48000)).toBe(72000);
  expect(sampleToSeconds(72000, 48000)).toBe(1.5);
  expect(secondsToSample(sampleToSeconds(12345, 48000), 48000)).toBe(12345);
  expect(selectionSamples({ start: 1, end: 3.5 }, 48000, 480000)).toEqual({
    from: 48000,
    to: 168000,
  });
  // Never past the end of the buffer, never longer than 8 s, never empty.
  expect(selectionSamples({ start: 9.9, end: 10.5 }, 48000, 480000).to).toBe(480000);
  const long = selectionSamples({ start: 0, end: 30 }, 48000, 48000 * 30);
  expect(long.to - long.from).toBe(8 * 48000);
  expect(selectionSamples({ start: 2, end: 2 }, 48000, 480000).to).toBeGreaterThan(96000);
});

it('keeps the selection inside the file and between 0.05 s and 8 s', () => {
  expect(initialSelection(3)).toEqual({ start: 0, end: 3 });
  expect(initialSelection(40)).toEqual({ start: 0, end: 8 });
  // Start handle dragged past the end handle stops 0.05 s before it.
  expect(clampSelection({ start: 9, end: 5 }, 20, 'start')).toEqual({ start: 9, end: 9.05 });
  expect(clampSelection({ start: 5, end: 1 }, 20, 'end').start).toBeCloseTo(0.95);
  expect(clampSelection({ start: -3, end: 4 }, 20, 'start').start).toBe(0);
  expect(clampSelection({ start: 0, end: 99 }, 20, 'end').end).toBe(20);
  // Longer than 8 s: the other handle slides along.
  expect(clampSelection({ start: 0, end: 15 }, 20, 'end')).toEqual({ start: 7, end: 15 });
  expect(clampSelection({ start: 2, end: 15 }, 20, 'start')).toEqual({ start: 2, end: 10 });
  // A clip shorter than the minimum can still be selected whole.
  expect(clampSelection({ start: 0, end: 0.02 }, 0.02, 'end')).toEqual({ start: 0, end: 0.02 });
  expect(nudgeSelection({ start: 1, end: 4 }, 10, 'start', 0.01).start).toBeCloseTo(1.01);
  expect(nudgeSelection({ start: 0, end: 4 }, 10, 'start', -1).start).toBe(0);
  expect(trimIssue({ start: 0, end: 8 }, 20)).toBeNull();
  expect(trimIssue({ start: 0, end: 8.2 }, 20)).toBe('too-long');
  expect(trimIssue({ start: 1, end: 1.01 }, 20)).toBe('too-short');
  expect(trimIssue({ start: 5, end: 5 }, 20)).toBe('empty');
  expect(isTrimmed({ start: 0, end: 5 }, 5)).toBe(false);
  expect(isTrimmed({ start: 0.5, end: 5 }, 5)).toBe(true);
  expect(isTrimmed({ start: 0, end: 4 }, 5)).toBe(true);
});

it('summarises a waveform as one peak per bucket', () => {
  const data = new Float32Array([0, 0.5, -0.8, 0.1, 0, 0, 0.2, -0.2]);
  const peaks = waveformPeaks([data], 4);
  [0.5, 0.8, 0, 0.2].forEach((value, i) => expect(peaks[i]).toBeCloseTo(value, 5));
  expect(waveformPeaks([data, new Float32Array(8).fill(0.9)], 2)).toEqual([
    expect.closeTo(0.9, 5),
    expect.closeTo(0.9, 5),
  ]);
  expect(waveformPeaks([], 10)).toEqual([]);
});

it('encodes only the selection, in the exact format the access service accepts', () => {
  const buffer = fakeBuffer(20, 2);
  const range = selectionSamples({ start: 2, end: 5.5 }, 48000, buffer.length);
  const bytes = Buffer.from(encodeSoundboard(buffer, range), 'base64');
  expect(soundDuration(bytes)).toBeCloseTo(3.5, 5);
  expect(bytes.readUInt16LE(22)).toBe(2);
  // The 8 s ceiling and the 2 MB file ceiling both hold for the longest selection.
  const longest = Buffer.from(
    encodeSoundboard(buffer, selectionSamples({ start: 0, end: 20 }, 48000, buffer.length)),
    'base64',
  );
  expect(soundDuration(longest)).toBe(8);
  expect(longest.length).toBeLessThanOrEqual(2_000_000);
  // Without a range a long file is still refused, as before.
  expect(() => encodeSoundboard(buffer)).toThrow();
  expect(() => encodeSoundboard(buffer, { from: 0, to: 8 * 48000 + 1 })).toThrow();
  expect(() => encodeSoundboard(buffer, { from: 10, to: 10 })).toThrow();
  expect(() => encodeSoundboard(buffer, { from: 0, to: buffer.length + 1 })).toThrow();
});

it('ramps the cut edges but leaves the file start and end untouched', () => {
  const buffer = fakeBuffer(2, 1);
  const read = (from: number, to: number) => {
    const bytes = Buffer.from(encodeSoundboard(buffer, { from, to }), 'base64');
    return (i: number) => bytes.readInt16LE(44 + i * 2);
  };
  const middle = read(4800, 48000);
  expect(middle(0)).toBe(0);
  expect(middle(48000 - 4800 - 1)).toBe(0);
  const whole = read(0, buffer.length);
  const source = buffer.getChannelData(0);
  expect(whole(100)).toBe(Math.round(source[100] * 32767));
  expect(middle(1000)).toBe(Math.round(source[4800 + 1000] * 32767));
});

it('steps handles with the keyboard', () => {
  expect(keyboardStep({ key: 'ArrowRight', shiftKey: false })).toBe(0.01);
  expect(keyboardStep({ key: 'ArrowLeft', shiftKey: true })).toBe(-0.1);
  expect(keyboardStep({ key: 'PageUp', shiftKey: false })).toBe(1);
  expect(keyboardStep({ key: 'PageDown', shiftKey: false })).toBe(-1);
  expect(keyboardStep({ key: 'a', shiftKey: false })).toBeNull();
});

function Harness({
  buffer,
  initial,
}: {
  buffer: AudioBuffer;
  initial: { start: number; end: number };
}) {
  const [selection, setSelection] = (require('react') as typeof import('react')).useState(initial);
  return (
    <SoundboardTrimmer buffer={buffer} selection={selection} onChange={setSelection} volume={0.5} />
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it('moves handles by keyboard and by dragging, and never beyond the limits', () => {
  render(<Harness buffer={fakeBuffer(20)} initial={{ start: 1, end: 5 }} />);
  const start = screen.getByRole('slider', { name: 'Kesme başlangıcı' });
  const end = screen.getByRole('slider', { name: 'Kesme bitişi' });
  expect(start.getAttribute('aria-valuenow')).toBe('1');
  fireEvent.keyDown(start, { key: 'ArrowRight' });
  expect(start.getAttribute('aria-valuenow')).toBe('1.01');
  fireEvent.keyDown(start, { key: 'PageUp' });
  expect(start.getAttribute('aria-valuenow')).toBe('2.01');
  // Moving the start handle past the end handle pushes the end handle, 0.05 s ahead.
  for (let i = 0; i < 4; i++) fireEvent.keyDown(start, { key: 'PageUp' });
  expect(start.getAttribute('aria-valuenow')).toBe('6.01');
  expect(end.getAttribute('aria-valuenow')).toBe('6.06');
  // Pushing the end handle beyond 8 s from the start makes the start handle follow.
  for (let i = 0; i < 10; i++) fireEvent.keyDown(end, { key: 'PageUp' });
  expect(end.getAttribute('aria-valuenow')).toBe('16.06');
  expect(start.getAttribute('aria-valuenow')).toBe('8.06');
  expect(screen.getByText(/Dosya 20\.0 sn/)).toBeTruthy();
  fireEvent.keyDown(end, { key: 'End' });
  expect(end.getAttribute('aria-valuenow')).toBe('20');
  expect(start.getAttribute('aria-valuenow')).toBe('12');
  // Dragging: the track is 200 px wide for 20 s, so 10 px per second.
  const track = document.querySelector('.sb-trim-track') as HTMLElement;
  track.getBoundingClientRect = () =>
    ({ left: 0, width: 200, right: 200, top: 0, bottom: 72, height: 72, x: 0, y: 0 }) as DOMRect;
  fireEvent.pointerDown(start, { clientX: 40, pointerId: 1 });
  expect(start.getAttribute('aria-valuenow')).toBe('4');
  expect(end.getAttribute('aria-valuenow')).toBe('12');
  fireEvent.pointerMove(track, { clientX: 200, pointerId: 1 });
  expect(start.getAttribute('aria-valuenow')).toBe('11.95');
  fireEvent.pointerUp(track, { pointerId: 1 });
  fireEvent.pointerMove(track, { clientX: 0, pointerId: 1 });
  expect(start.getAttribute('aria-valuenow')).toBe('11.95');
});

it('previews only the selected part', () => {
  const started: unknown[][] = [];
  vi.stubGlobal(
    'AudioContext',
    class {
      destination = {};
      createGain = () => ({ gain: { value: 1 }, connect: (n: unknown) => n });
      createBufferSource = () => ({
        buffer: null,
        connect(n: { connect: (x: unknown) => unknown }) {
          return n;
        },
        start: (...args: unknown[]) => started.push(args),
        stop() {},
      });
      close = async () => {};
    },
  );
  render(<Harness buffer={fakeBuffer(20)} initial={{ start: 2, end: 6.5 }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Seçimi dinle' }));
  expect(started).toEqual([[0, 2, 4.5]]);
  expect(screen.getByRole('button', { name: 'Durdur' })).toBeTruthy();
});

// ---- Soundboard add / edit flow ----
const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const bridge = {
  list: vi.fn(async () => ({
    communityId: 'c',
    clips: [{ id: id(1), name: 'Air horn', durationSec: 6, ownerId: 'alice' }],
    canUpload: true,
    canManage: false,
  })),
  upload: vi.fn(async (_c: string, input: { name: string }) => ({
    id: id(3),
    name: input.name,
    durationSec: 1,
    ownerId: 'alice',
  })),
  read: vi.fn(async () => 'AAAA'),
  remove: vi.fn(async () => {}),
  rename: vi.fn(async () => ({})),
};
let decoded = fakeBuffer(20);
beforeEach(() => {
  decoded = fakeBuffer(20, 2);
  useCommunity.setState({
    user: { id: 'alice', username: 'alice', displayName: 'Alice', avatar: null },
    serverUrl: 'https://example.test',
  } as never);
  (window as unknown as { rooms: unknown }).rooms = { soundboard: bridge };
  vi.stubGlobal(
    'AudioContext',
    class {
      decodeAudioData = async () => decoded;
      close = async () => {};
    },
  );
});
afterEach(() => {
  delete (window as unknown as { rooms?: unknown }).rooms;
});
const open = async () => {
  render(<SoundboardButton showTrigger={false} />);
  act(() => void window.dispatchEvent(new Event('rooms:open-soundboard')));
  await screen.findByRole('button', { name: 'Air horn' });
};
const pick = (name: string, size = 10) => {
  const file = new File([new Uint8Array(size)], name, { type: 'audio/mpeg' });
  (file as unknown as { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer = async () =>
    new ArrayBuffer(size);
  fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [file] },
  });
};
const uploaded = () => {
  const audio = (bridge.upload.mock.calls[0] as unknown as [string, { audio: string }])[1].audio;
  return soundDuration(Buffer.from(audio, 'base64'));
};

it('lets a long file be trimmed before it is uploaded', async () => {
  await open();
  pick('long.mp3');
  const form = await screen.findByRole('group', { name: 'Yeni ses' });
  const start = within(form).getByRole('slider', { name: 'Kesme başlangıcı' });
  expect(
    within(form).getByRole('slider', { name: 'Kesme bitişi' }).getAttribute('aria-valuenow'),
  ).toBe('8');
  for (let i = 0; i < 3; i++) fireEvent.keyDown(start, { key: 'PageUp' });
  fireEvent.click(within(form).getByRole('button', { name: 'Kaydet' }));
  await waitFor(() => expect(bridge.upload).toHaveBeenCalledTimes(1));
  // 3 s .. 8 s of the 20 s file went to the server as one valid 5 s WAV.
  expect(uploaded()).toBe(5);
  expect(bridge.remove).not.toHaveBeenCalled();
});

it('refuses files over the source limits with a message', async () => {
  await open();
  pick('huge.wav', 31_000_000);
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    'En fazla 30 MB bir ses dosyası seç.',
  );
  cleanup();
  decoded = fakeBuffer(200);
  await open();
  pick('endless.wav');
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    'En fazla 3 dakikalık mono veya stereo bir ses seç.',
  );
  expect(bridge.upload).not.toHaveBeenCalled();
});

it('re-trims a stored sound by uploading the cut and removing the old one', async () => {
  decoded = fakeBuffer(6, 1);
  await open();
  fireEvent.click(screen.getByRole('button', { name: 'Air horn sesini düzenle' }));
  const form = await screen.findByRole('group', { name: 'Sesi düzenle' });
  fireEvent.click(within(form).getByRole('button', { name: 'Sesi kırp' }));
  const end = await within(form).findByRole('slider', { name: 'Kesme bitişi' });
  expect(bridge.read).toHaveBeenCalledWith('voice', id(1));
  for (let i = 0; i < 2; i++) fireEvent.keyDown(end, { key: 'PageDown' });
  fireEvent.click(within(form).getByRole('button', { name: 'Kaydet' }));
  await waitFor(() => expect(bridge.remove).toHaveBeenCalledWith('voice', id(1)));
  expect(bridge.upload).toHaveBeenCalledTimes(1);
  expect(uploaded()).toBe(4);
  expect(bridge.rename).not.toHaveBeenCalled();
});

it('keeps the old sound when the replacement cannot be uploaded, and explains an unreadable stored file', async () => {
  decoded = fakeBuffer(6, 1);
  bridge.upload.mockRejectedValueOnce(new Error('full'));
  await open();
  fireEvent.click(screen.getByRole('button', { name: 'Air horn sesini düzenle' }));
  let form = await screen.findByRole('group', { name: 'Sesi düzenle' });
  fireEvent.click(within(form).getByRole('button', { name: 'Sesi kırp' }));
  const end = await within(form).findByRole('slider', { name: 'Kesme bitişi' });
  fireEvent.keyDown(end, { key: 'PageDown' });
  fireEvent.click(within(form).getByRole('button', { name: 'Kaydet' }));
  await screen.findByRole('alert');
  expect(bridge.remove).not.toHaveBeenCalled();
  cleanup();
  // The stored file can no longer be read: say so, the form stays usable for renaming.
  bridge.read.mockRejectedValueOnce(new Error('gone'));
  await open();
  fireEvent.click(screen.getByRole('button', { name: 'Air horn sesini düzenle' }));
  form = await screen.findByRole('group', { name: 'Sesi düzenle' });
  fireEvent.click(within(form).getByRole('button', { name: 'Sesi kırp' }));
  expect((await screen.findByRole('alert')).textContent).toMatch(/yeniden kırpılamıyor/);
  expect(within(form).queryByRole('slider')).toBeNull();
});

it('leaves an untouched edit as a plain rename', async () => {
  await open();
  fireEvent.click(screen.getByRole('button', { name: 'Air horn sesini düzenle' }));
  const form = await screen.findByRole('group', { name: 'Sesi düzenle' });
  fireEvent.click(within(form).getByRole('button', { name: 'Kaydet' }));
  await waitFor(() => expect(bridge.rename).toHaveBeenCalledTimes(1));
  expect(bridge.upload).not.toHaveBeenCalled();
});
