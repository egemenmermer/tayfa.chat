// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { useCommunity } from '../apps/desktop/src/community';
const f = vi.hoisted(() => ({
  status: 'not-configured',
  muted: true,
  deafened: false,
  deafen: vi.fn(),
  grant: vi.fn(),
  leave: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  noise: vi.fn(),
  devices: vi.fn(),
  mute: vi.fn(),
  prepare: vi.fn(),
}));
vi.mock('../apps/desktop/src/runtime-sources', () => ({
  mediaBridge: () => ({ grant: f.grant, leave: f.leave }),
  mediaProvider: () => ({
    snapshot: () => ({ status: f.status, muted: f.muted, deafened: f.deafened }),
    deafen: f.deafen,
    subscribeState: () => () => {},
    connectRoom: f.connect,
    disconnect: f.disconnect,
    setNoiseSuppression: f.noise,
    deviceSelection: f.devices,
    mute: f.mute,
    prepareConnection: f.prepare,
  }),
}));
import {
  joinVoice,
  leaveVoice,
  prewarmVoice,
  toggleMic,
  useVoiceContext,
} from '../apps/desktop/src/realtime';
const grantFor = (channelId: string) => ({
  roomName: `room-${channelId}`,
  token: 'local-test-token',
  serverUrl: 'wss://media.test',
});
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, fail) => ((resolve = ok), (reject = fail)));
  return { promise, resolve, reject };
}
/** Joins `one` with the microphone open, as a person in a room before switching. */
async function inRoomOne() {
  await joinVoice('one', 'One');
  f.muted = false;
  vi.clearAllMocks();
}
beforeEach(async () => {
  window.rooms = {} as any;
  await leaveVoice();
  vi.clearAllMocks();
  f.status = 'not-configured';
  f.muted = true;
  f.deafened = false;
  f.deafen.mockImplementation(async (value: boolean) => {
    f.deafened = value;
  });
  f.grant.mockImplementation(async (id: string) => grantFor(id));
  f.leave.mockResolvedValue(undefined);
  f.disconnect.mockImplementation(async () => {
    f.status = 'not-configured';
    f.muted = true;
    f.deafened = false;
  });
  f.connect.mockImplementation(async () => {
    f.status = 'connected';
  });
  f.mute.mockImplementation(async (value: boolean) => {
    f.muted = value;
  });
  useCommunity.setState({
    serverUrl: 'https://test',
    user: { id: 'owner', username: 'Owner', displayName: 'Owner', avatar: null },
  });
});

it('asks for the new grant while the old room is still being torn down', async () => {
  await inRoomOne();
  const teardown = deferred<void>();
  f.disconnect.mockImplementationOnce(async () => {
    f.status = 'not-configured';
    await teardown.promise;
  });
  const leaveOne = deferred<void>();
  f.leave.mockReturnValueOnce(leaveOne.promise);
  const next = joinVoice('two', 'Two');
  // Before: grant only after both the media teardown and the server-side leave had finished.
  await vi.waitFor(() => expect(f.grant).toHaveBeenCalledWith('two'));
  expect(f.connect).not.toHaveBeenCalled();
  teardown.resolve();
  // The server-side leave of the other room never holds the connect back.
  await vi.waitFor(() =>
    expect(f.connect).toHaveBeenCalledWith('room-two', expect.any(String), 'wss://media.test'),
  );
  leaveOne.resolve();
  await next;
  expect(useVoiceContext.getState()).toMatchObject({ channelId: 'two', busy: false });
});

it('carries an open microphone into the next room and opens it there', async () => {
  await inRoomOne();
  await joinVoice('two', 'Two');
  expect(f.disconnect).toHaveBeenCalledWith({ keepMicrophone: true });
  expect(f.mute).toHaveBeenCalledWith(false);
  expect(f.mute).not.toHaveBeenCalledWith(true);
  // Settings and devices are applied before the carried microphone is published.
  expect(f.devices.mock.invocationCallOrder[0]).toBeLessThan(f.mute.mock.invocationCallOrder[0]);
});

it('never carries a muted or deafened microphone', async () => {
  await joinVoice('one', 'One');
  f.muted = true;
  vi.clearAllMocks();
  await joinVoice('two', 'Two');
  expect(f.disconnect).toHaveBeenCalledTimes(1);
  expect(f.disconnect).toHaveBeenCalledWith();
  f.muted = false;
  await f.deafen(true);
  vi.clearAllMocks();
  await joinVoice('three', 'Three');
  expect(f.disconnect).toHaveBeenCalledWith();
});

it('closes the carried microphone when the person mutes during the switch', async () => {
  await inRoomOne();
  const grant = deferred<ReturnType<typeof grantFor>>();
  f.grant.mockReturnValueOnce(grant.promise);
  const next = joinVoice('two', 'Two');
  // Mic button while connecting: the snapshot reads unmuted, so this mutes.
  f.muted = false;
  await toggleMic().catch(() => {});
  grant.resolve(grantFor('two'));
  await next;
  expect(f.mute).not.toHaveBeenCalledWith(false);
  expect(f.mute).toHaveBeenLastCalledWith(true);
});

it('a failed connect after the hand-off releases the microphone and leaves the new room', async () => {
  await inRoomOne();
  f.connect.mockRejectedValueOnce(new Error('offline'));
  await expect(joinVoice('two', 'Two')).rejects.toThrow();
  expect(f.disconnect).toHaveBeenNthCalledWith(1, { keepMicrophone: true });
  // The plain disconnect is what stops a carried microphone in the provider.
  expect(f.disconnect).toHaveBeenLastCalledWith();
  expect(f.leave).toHaveBeenCalledWith('two');
  expect(f.mute).not.toHaveBeenCalled();
  expect(useVoiceContext.getState()).toMatchObject({ channelId: 'two', busy: false });
  expect(useVoiceContext.getState().error).toBeTruthy();
});

it('rapid A→B→C connects only C, gives B its grant back and keeps no carried microphone', async () => {
  await inRoomOne();
  const grantTwo = deferred<ReturnType<typeof grantFor>>();
  f.grant.mockImplementation(async (id: string) =>
    id === 'two' ? grantTwo.promise : grantFor(id),
  );
  const two = joinVoice('two', 'Two');
  const three = joinVoice('three', 'Three');
  // The second switch starts from a room that is not connected: a plain disconnect.
  expect(f.disconnect).toHaveBeenNthCalledWith(1, { keepMicrophone: true });
  expect(f.disconnect).toHaveBeenNthCalledWith(2);
  grantTwo.resolve(grantFor('two'));
  await Promise.all([two, three]);
  expect(f.connect).toHaveBeenCalledTimes(1);
  expect(f.connect).toHaveBeenCalledWith('room-three', expect.any(String), 'wss://media.test');
  expect(f.leave).toHaveBeenCalledWith('two');
  expect(f.leave).not.toHaveBeenCalledWith('three');
  expect(useVoiceContext.getState()).toMatchObject({ channelId: 'three', busy: false });
});

it('A→B→A waits for the leave of A before asking for A again', async () => {
  await inRoomOne();
  const leaveOne = deferred<void>();
  f.leave.mockImplementation((id: string) => (id === 'one' ? leaveOne.promise : Promise.resolve()));
  const two = joinVoice('two', 'Two');
  await vi.waitFor(() => expect(f.grant).toHaveBeenCalledWith('two'));
  const back = joinVoice('one', 'One');
  await new Promise((resolve) => setTimeout(resolve, 10));
  // A grant for A now would be revoked by the late leave of A.
  expect(f.grant).not.toHaveBeenCalledWith('one');
  leaveOne.resolve();
  await Promise.all([two, back]);
  expect(f.grant).toHaveBeenLastCalledWith('one');
  expect(f.connect).toHaveBeenLastCalledWith('room-one', expect.any(String), 'wss://media.test');
  expect(useVoiceContext.getState()).toMatchObject({ channelId: 'one', busy: false });
});

it('B→C→B: a superseded B never leaves the room the newest join wants', async () => {
  await joinVoice('one', 'One');
  vi.clearAllMocks();
  const grantTwo = deferred<ReturnType<typeof grantFor>>();
  f.grant.mockReturnValueOnce(grantTwo.promise);
  // B→C→B: the stale B join leaves B after the newest B grant was already asked.
  const two = joinVoice('two', 'Two');
  const three = joinVoice('three', 'Three');
  const twoAgain = joinVoice('two', 'Two');
  grantTwo.resolve(grantFor('two'));
  await Promise.all([two, three, twoAgain]);
  expect(useVoiceContext.getState()).toMatchObject({ channelId: 'two', busy: false });
  expect(f.connect).toHaveBeenLastCalledWith('room-two', expect.any(String), 'wss://media.test');
  // Never a leave of B after the connect that is now in use.
  const lastConnect = f.connect.mock.invocationCallOrder.at(-1)!;
  const leavesOfTwo = f.leave.mock.calls
    .map((call, index) => [call[0], f.leave.mock.invocationCallOrder[index]] as const)
    .filter(([id]) => id === 'two');
  expect(leavesOfTwo.every(([, order]) => order < lastConnect)).toBe(true);
});

it('prewarms the media server of the last grant on hover and never asks for a grant', async () => {
  await joinVoice('one', 'One');
  vi.clearAllMocks();
  prewarmVoice('one');
  expect(f.prepare).not.toHaveBeenCalled();
  prewarmVoice('two');
  expect(f.prepare).toHaveBeenCalledWith('wss://media.test');
  expect(f.grant).not.toHaveBeenCalled();
  useCommunity.setState({
    user: { id: 'someone-else', username: 'S', displayName: 'S', avatar: null },
  });
  f.prepare.mockClear();
  prewarmVoice('two');
  expect(f.prepare).not.toHaveBeenCalled();
});
