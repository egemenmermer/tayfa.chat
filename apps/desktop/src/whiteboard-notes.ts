/**
 * Sticky notes on the shared whiteboard. Pure helpers with no dependencies, shared by the board
 * view and the PNG export so both draw a note identically.
 *
 * A note is a `BoardElement` of kind `note`: `points[0]` is its top-left corner on the 1000x620
 * board, `text` its body, `color` its paper. Its size is fixed so every client agrees on it.
 */
export const BOARD_WIDTH = 1000;
export const BOARD_HEIGHT = 620;
export const NOTE_WIDTH = 200;
export const NOTE_HEIGHT = 160;
export const NOTE_PADDING = 12;
export const NOTE_FONT = 15;
export const NOTE_LINE = 19;
export const NOTE_MAX_CHARS = 140;
/** Notes snap to a board edge when dropped this close to it (board units). */
export const NOTE_EDGE_SNAP = 10;
/** Paper colours; the text on them is always {@link NOTE_INK}. */
export const NOTE_COLORS = ['#F7D774', '#F2A0B5', '#A8DDA0', '#9CC9F2', '#F5B77A'] as const;
export const NOTE_INK = '#1B1D24';

const CHARS_PER_LINE = 20;
const MAX_LINES = Math.floor((NOTE_HEIGHT - NOTE_PADDING * 2) / NOTE_LINE);

/** Keeps a note fully on the board and flush against an edge when it is dropped near one. */
export function placeNote(x: number, y: number, snap = true): [number, number] {
  const fit = (value: number, max: number) => {
    const clamped = Math.max(0, Math.min(max, Number.isFinite(value) ? value : 0));
    if (!snap) return Math.round(clamped * 10) / 10;
    if (clamped <= NOTE_EDGE_SNAP) return 0;
    if (max - clamped <= NOTE_EDGE_SNAP) return max;
    return Math.round(clamped * 10) / 10;
  };
  return [fit(x, BOARD_WIDTH - NOTE_WIDTH), fit(y, BOARD_HEIGHT - NOTE_HEIGHT)];
}

/** Word-wraps a note body into at most {@link MAX_LINES} lines, ending in an ellipsis when cut. */
export function wrapNoteText(text: string): string[] {
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r/g, '').split('\n')) {
    let line = '';
    for (const rawWord of paragraph.split(/\s+/).filter(Boolean)) {
      let word = rawWord;
      while (word.length > CHARS_PER_LINE) {
        if (line) {
          lines.push(line);
          line = '';
        }
        lines.push(word.slice(0, CHARS_PER_LINE));
        word = word.slice(CHARS_PER_LINE);
      }
      if (!line) line = word;
      else if (line.length + 1 + word.length <= CHARS_PER_LINE) line += ` ${word}`;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  while (lines.length > 1 && lines.at(-1) === '') lines.pop();
  if (lines.length <= MAX_LINES) return lines;
  const kept = lines.slice(0, MAX_LINES);
  const last = kept[MAX_LINES - 1]!;
  kept[MAX_LINES - 1] = `${last.slice(0, CHARS_PER_LINE - 1)}…`;
  return kept;
}
