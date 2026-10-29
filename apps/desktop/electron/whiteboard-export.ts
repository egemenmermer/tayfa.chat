import { z } from 'zod';
import {
  NOTE_FONT,
  NOTE_HEIGHT,
  NOTE_INK,
  NOTE_LINE,
  NOTE_PADDING,
  NOTE_WIDTH,
  wrapNoteText,
} from '../src/whiteboard-notes';

const element = z.object({
  kind: z.enum(['stroke', 'text', 'rectangle', 'ellipse', 'note']),
  points: z
    .array(z.tuple([z.number().finite().min(0).max(4096), z.number().finite().min(0).max(4096)]))
    .min(1)
    .max(500),
  text: z.string().max(2000).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  width: z.number().finite().min(1).max(24),
});
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!,
  );

/** Serialize only bounded artwork. No IDs, participants, room metadata or credentials. */
export function whiteboardSvg(input: unknown): string {
  const board = z.array(element).max(1000).parse(input);
  const shapes = board
    .map((item) => {
      if (item.kind === 'rectangle' || item.kind === 'ellipse') {
        if (item.points.length < 2) throw new Error('Shape requires two bounded points');
        const [start, end] = [item.points[0], item.points[item.points.length - 1]];
        const x = Math.min(start[0], end[0]),
          y = Math.min(start[1], end[1]);
        const width = Math.abs(end[0] - start[0]),
          height = Math.abs(end[1] - start[1]);
        const stroke = `stroke="${item.color}" stroke-width="${item.width}" fill="none"`;
        return item.kind === 'rectangle'
          ? `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="8" ${stroke}/>`
          : `<ellipse cx="${x + width / 2}" cy="${y + height / 2}" rx="${width / 2}" ry="${height / 2}" ${stroke}/>`;
      }
      if (item.kind === 'note') {
        const [x, y] = item.points[0];
        const lines = wrapNoteText(item.text ?? '')
          .map(
            (line, index) =>
              `<text x="${x + NOTE_PADDING}" y="${y + NOTE_PADDING + NOTE_FONT + index * NOTE_LINE}" fill="${NOTE_INK}" font-size="${NOTE_FONT}" font-family="system-ui,sans-serif" xml:space="preserve">${escape(line)}</text>`,
          )
          .join('');
        return `<g><rect x="${x}" y="${y}" width="${NOTE_WIDTH}" height="${NOTE_HEIGHT}" rx="4" fill="${item.color}"/>${lines}</g>`;
      }
      return item.kind === 'text'
        ? `<text x="${item.points[0][0]}" y="${item.points[0][1]}" fill="${item.color}" font-size="20" font-family="system-ui,sans-serif" xml:space="preserve">${escape(item.text ?? '')}</text>`
        : `<polyline points="${item.points.map((p) => p.join(',')).join(' ')}" stroke="${item.color}" stroke-width="${item.width}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
    })
    .join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="620" viewBox="0 0 1000 620"><rect width="1000" height="620" fill="#11151e"/><defs><pattern id="board-dots" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#ffffff" fill-opacity="0.07"/></pattern></defs><rect width="1000" height="620" fill="url(#board-dots)"/>\n${shapes}\n</svg>\n`;
}
