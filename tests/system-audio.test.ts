import { describe, expect, it } from 'vitest';
import { displayMediaStreams, systemAudioSupport } from '../apps/desktop/electron/system-audio';

describe('system audio support', () => {
  it('captures on every Windows; only Windows 11 keeps Tayfa’s own playback out', () => {
    expect(systemAudioSupport('win32', '10.0.19045')).toEqual({
      supported: true,
      ownAudioExcluded: false,
    });
    expect(systemAudioSupport('win32', '10.0.22000')).toEqual({
      supported: true,
      ownAudioExcluded: true,
    });
    expect(systemAudioSupport('win32', '10.0.26100')).toMatchObject({ ownAudioExcluded: true });
  });
  it('captures on macOS 14.2+ (Darwin 23.2) with own playback excluded, and says why not before', () => {
    expect(systemAudioSupport('darwin', '23.2.0')).toEqual({
      supported: true,
      ownAudioExcluded: true,
    });
    expect(systemAudioSupport('darwin', '25.0.0')).toMatchObject({ supported: true });
    expect(systemAudioSupport('darwin', '23.1.0')).toEqual({
      supported: false,
      ownAudioExcluded: false,
      reason: 'macos-version',
    });
    expect(systemAudioSupport('darwin', '22.6.0')).toMatchObject({ reason: 'macos-version' });
  });
  it('reports other systems as unable to share sound', () => {
    expect(systemAudioSupport('linux', '6.8.0')).toEqual({
      supported: false,
      ownAudioExcluded: false,
      reason: 'os',
    });
  });
});

describe('display-media answer', () => {
  const source = { id: 'window:1:0' };
  it('adds the system loopback on Windows and a supported Mac when sound is wanted', () => {
    for (const [platform, release] of [
      ['win32', '10.0.19045'],
      ['darwin', '24.1.0'],
    ])
      expect(displayMediaStreams(source, true, systemAudioSupport(platform, release))).toEqual({
        video: source,
        audio: 'loopback',
      });
  });
  it('never asks for loopbackWithMute and shares picture only when sound is off or impossible', () => {
    expect(displayMediaStreams(source, false, systemAudioSupport('win32', '10.0.22631'))).toEqual({
      video: source,
    });
    expect(displayMediaStreams(source, true, systemAudioSupport('darwin', '23.1.0'))).toEqual({
      video: source,
    });
    expect(displayMediaStreams(source, true, systemAudioSupport('linux', '6.8.0'))).toEqual({
      video: source,
    });
  });
});
