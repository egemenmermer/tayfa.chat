import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createCaptureChannel } from '../apps/desktop/electron/capture-channel';

// A quick room switch (A -> B) leaves a server-side leave of A on its way. It can arrive after the
// user already started sharing in B, and must not end that share's capture or remote control.
describe('capture channel guard', () => {
  it('a late leave of the previous room never clears a share started in the new room', () => {
    const capture = createCaptureChannel();
    capture.acquire('room-a');
    expect(capture.leave('room-a')).toBe(true); // switching away ends A's own capture
    capture.acquire('room-b'); // the user shares in B
    expect(capture.leave('room-a')).toBe(false); // A's leave arrives late
    expect(capture.current()).toBe('room-b');
    expect(capture.leave('room-b')).toBe(true); // leaving B itself still ends it
    expect(capture.current()).toBeNull();
  });
  it('a late leave of A is ignored even when A was never explicitly released', () => {
    const capture = createCaptureChannel();
    capture.acquire('room-a');
    capture.acquire('room-b');
    expect(capture.leave('room-a')).toBe(false);
    expect(capture.current()).toBe('room-b');
  });
  it('with no share recorded, any leave may clear a stray capture', () => {
    const capture = createCaptureChannel();
    expect(capture.leave('room-a')).toBe(true);
    capture.acquire('room-b');
    capture.release('room-a'); // releasing another room's lease changes nothing
    expect(capture.current()).toBe('room-b');
    capture.release('room-b');
    expect(capture.current()).toBeNull();
    expect(capture.leave('room-b')).toBe(true);
  });
  it('community.ts routes leave and presenter calls through the guard', () => {
    const source = readFileSync('apps/desktop/electron/community.ts', 'utf8');
    const leave = source.slice(source.indexOf("handle('rooms:media-leave'"));
    expect(leave.slice(0, leave.indexOf("handle('rooms:capture-status'"))).toMatch(
      /if \(captureChannel\.leave\(.*\)\) \{\s*activeCapture = null;\s*remote\.stop\(\);/,
    );
    expect(source).toMatch(/captureChannel\.acquire\(/);
    expect(source).toMatch(/captureChannel\.release\(/);
  });
});
