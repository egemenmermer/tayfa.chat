/** Stoat refuses message content longer than this (its MessageContent validation). */
export const MESSAGE_MAX = 2000;
/** The composer shows a counter from here on. */
export const MESSAGE_COUNTER_FROM = MESSAGE_MAX - 200;

/** What the composer says about a draft of this length: nothing, a counter, or over the limit. */
export function messageLength(length: number) {
  return {
    show: length >= MESSAGE_COUNTER_FROM,
    over: length > MESSAGE_MAX,
    left: MESSAGE_MAX - length,
  };
}
