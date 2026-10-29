// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import Whiteboard from '../apps/desktop/src/Whiteboard';

const media = vi.hoisted(() => ({
  listener: null as null | ((payload: string, sender: string) => void),
  publish: vi.fn(),
  state: {
    status: 'connected',
    channelId: 'room',
    participants: [
      { id: 'me', name: 'Ben' },
      { id: 'ece', name: 'Ece' },
    ],
  },
}));
vi.mock('../apps/desktop/src/realtime', () => ({
  useRealtime: () => media.state,
  publishCursor: media.publish,
  onCursor: (listener: (payload: string, sender: string) => void) => {
    media.listener = listener;
    return () => (media.listener = null);
  },
}));
afterEach(() => {
  cleanup();
  media.publish.mockClear();
  vi.unstubAllGlobals();
});
type Room = { whiteboard?: unknown[]; participants?: unknown[] };
function activity(send: (command: unknown) => Promise<void> = async () => {}, room: Room = {}) {
  return {
    status: 'connected',
    busy: false,
    error: null,
    serverOffsetMs: 0,
    room: { roomId: 'room', whiteboard: [], participants: [], ...room },
    send,
    refresh: vi.fn(),
    clearError: vi.fn(),
  } as never;
}
const mount = (send?: (command: unknown) => Promise<void>, room?: Room) =>
  render(<Whiteboard roomId="room" userId="me" roomName="Salon" activity={activity(send, room)} />);
const cursor = (sender: string, value: unknown) =>
  act(() => media.listener?.(JSON.stringify(value), sender));

it('shows where other people point on this board, by name, and forgets them when they leave', () => {
  mount();
  cursor('ece', { b: 'room', x: 120, y: 80 });
  const label = screen.getByText('Ece');
  expect(label.closest('g')?.getAttribute('transform')).toBe('translate(120 80)');
  cursor('ece', { b: 'other-room', x: 5, y: 5 });
  cursor('me', { b: 'room', x: 1, y: 1 });
  expect(screen.queryByText('Ben')).toBeNull();
  expect(screen.getByText('Ece').closest('g')?.getAttribute('transform')).toBe('translate(120 80)');
  cursor('ece', { b: 'room' });
  expect(screen.queryByText('Ece')).toBeNull();
});

it('writes a note exactly where the board was clicked', async () => {
  const send = vi.fn(async () => {});
  mount(send);
  const svg = screen.getByRole('img', { name: 'Ortak çizim tahtası' }) as unknown as SVGSVGElement;
  // jsdom has neither layout nor geometry types: an identity screen transform stands in.
  class Point {
    constructor(
      public x = 0,
      public y = 0,
    ) {}
    matrixTransform() {
      return this;
    }
  }
  vi.stubGlobal('DOMPoint', Point);
  vi.stubGlobal('PointerEvent', class extends MouseEvent {});
  svg.getScreenCTM = () => ({ inverse: () => ({}) }) as never;
  fireEvent.click(screen.getByRole('button', { name: /Metin/ }));
  fireEvent.pointerDown(svg, { button: 0, clientX: 412, clientY: 233 });
  const input = screen.getByRole('textbox', { name: 'Beyaz tahta notu' });
  expect(document.activeElement).toBe(input);
  fireEvent.change(input, { target: { value: 'Pazar planı' } });
  await act(async () => fireEvent.keyDown(input, { key: 'Enter' }));
  expect(send).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'whiteboard.put',
      element: expect.objectContaining({ kind: 'text', points: [[412, 233]], text: 'Pazar planı' }),
    }),
  );
});

const sticky = (authorId = 'me') => ({
  id: 'n1',
  kind: 'note',
  points: [[40, 50]],
  text: 'Süt al',
  color: '#F7D774',
  width: 1,
  authorId,
});
const member = (canControl: boolean) => [{ userId: 'me', canControl, canCreate: true }];

it('places a sticky note where the board was clicked, with the chosen colour', async () => {
  const send = vi.fn(async () => {});
  mount(send, { participants: member(false) });
  const svg = screen.getByRole('img', { name: 'Ortak çizim tahtası' }) as unknown as SVGSVGElement;
  class Point {
    constructor(
      public x = 0,
      public y = 0,
    ) {}
    matrixTransform() {
      return this;
    }
  }
  vi.stubGlobal('DOMPoint', Point);
  vi.stubGlobal('PointerEvent', class extends MouseEvent {});
  svg.getScreenCTM = () => ({ inverse: () => ({}) }) as never;
  fireEvent.click(screen.getByRole('button', { name: /Yapışkan not: tahtaya/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Not rengi #F2A0B5' }));
  fireEvent.pointerDown(svg, { button: 0, clientX: 500, clientY: 300 });
  const input = screen.getByRole('textbox', { name: 'Yapışkan not metni' });
  expect(document.activeElement).toBe(input);
  fireEvent.change(input, { target: { value: 'Süt al' } });
  await act(async () => fireEvent.keyDown(input, { key: 'Enter' }));
  expect(send).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'whiteboard.put',
      element: expect.objectContaining({
        kind: 'note',
        // Centred on the click: (500 - 100, 300 - 80).
        points: [[400, 220]],
        text: 'Süt al',
        color: '#F2A0B5',
      }),
    }),
  );
});

it('moves a focused note with the arrow keys and edits it with Enter', async () => {
  const send = vi.fn(async () => {});
  mount(send, { whiteboard: [sticky()], participants: member(false) });
  const note = screen.getByRole('button', { name: 'Yapışkan not: Süt al' });
  await act(async () => fireEvent.keyDown(note, { key: 'ArrowRight' }));
  expect(send).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'whiteboard.put',
      element: expect.objectContaining({ id: 'n1', points: [[50, 50]] }),
    }),
  );
  fireEvent.keyDown(note, { key: 'Enter' });
  expect(screen.getByRole('textbox', { name: 'Yapışkan not metni' })).toHaveProperty(
    'value',
    'Süt al',
  );
});

it("tells a member they cannot change someone else's note, but lets an admin", async () => {
  const send = vi.fn(async () => {});
  const view = mount(send, { whiteboard: [sticky('ece')], participants: member(false) });
  fireEvent.keyDown(screen.getByRole('button', { name: 'Yapışkan not: Süt al' }), {
    key: 'ArrowDown',
  });
  expect(screen.getByRole('status').textContent).toMatch(/yalnızca yazarı/);
  expect(send).not.toHaveBeenCalled();
  view.unmount();
  mount(send, { whiteboard: [sticky('ece')], participants: member(true) });
  await act(async () =>
    fireEvent.keyDown(screen.getByRole('button', { name: 'Yapışkan not: Süt al' }), {
      key: 'ArrowDown',
    }),
  );
  expect(send).toHaveBeenCalledWith(
    expect.objectContaining({ element: expect.objectContaining({ points: [[40, 60]] }) }),
  );
});

it('explains why "Tahtayı temizle" is unavailable and confirms before clearing', async () => {
  const send = vi.fn(async () => {});
  const view = mount(send, { whiteboard: [sticky()], participants: member(false) });
  const clear = () => screen.getByRole('button', { name: /Tahtayı temizle/ });
  expect(clear().getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(clear());
  expect(screen.getByRole('status').textContent).toMatch(/yalnızca topluluk yöneticileri/);
  expect(screen.queryByText('Tahta temizlensin mi?')).toBeNull();
  view.unmount();

  mount(send, { whiteboard: [sticky()], participants: member(true) });
  fireEvent.click(clear());
  expect(screen.getByText('Tahta temizlensin mi?')).toBeTruthy();
  expect(send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Vazgeç' }));
  expect(send).not.toHaveBeenCalled();
  fireEvent.click(clear());
  const confirm = screen.getAllByRole('button', { name: /Tahtayı temizle/ }).at(-1)!;
  await act(async () => fireEvent.click(confirm));
  expect(send).toHaveBeenCalledWith({ type: 'whiteboard.clear' });
});
