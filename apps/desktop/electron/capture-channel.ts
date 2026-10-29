/**
 * Which voice room the current screen capture belongs to. A leave of another room (the previous
 * one after a quick switch) arrives late and must not clear the capture of the share that was
 * started in the new room, nor end a remote-control session running over it.
 */
export function createCaptureChannel() {
  let channel: string | null = null;
  return {
    /** The presenter lease of `channelId` was acquired: captures from now on belong to it. */
    acquire(channelId: string) {
      channel = channelId;
    },
    /** The lease was released; a later leave of any room has nothing to protect. */
    release(channelId: string) {
      if (channel === channelId) channel = null;
    },
    /**
     * A leave of `channelId` ends the capture only when it is the room the capture belongs to (or
     * no room is recorded). Returns whether the caller should clear the capture.
     */
    leave(channelId: string) {
      if (channel !== null && channel !== channelId) return false;
      channel = null;
      return true;
    },
    current: () => channel,
  };
}
