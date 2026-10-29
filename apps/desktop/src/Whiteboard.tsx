import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Check,
  Circle,
  Download,
  Eraser,
  Image,
  Maximize,
  Minimize,
  MousePointer2,
  Pencil,
  Square,
  StickyNote,
  Trash2,
  Type,
  Undo2,
  Vote,
} from 'lucide-react';
import { Modal } from '@rooms/design';
import type { ActivityCommand, BoardElement } from '@rooms/activity-protocol';
import type { useActivityRoom } from './activity';
import { t, uiError } from './i18n';
import { onCursor, publishCursor, useRealtime } from './realtime';
import {
  NOTE_COLORS,
  NOTE_FONT,
  NOTE_HEIGHT,
  NOTE_INK,
  NOTE_LINE,
  NOTE_MAX_CHARS,
  NOTE_PADDING,
  NOTE_WIDTH,
  placeNote,
  wrapNoteText,
} from './whiteboard-notes';

type Edit = { kind: 'add' | 'remove'; element: BoardElement };
type Tool = 'select' | 'pen' | 'text' | 'note' | 'erase' | 'rectangle' | 'ellipse';
type NoteDraft = { id: string | null; x: number; y: number; text: string; color: string };
type NoteDrag = {
  id: string;
  dx: number;
  dy: number;
  ox: number;
  oy: number;
  x: number;
  y: number;
  moved: boolean;
};
const colors = ['#B8CDFF', '#65BC94', '#E7B96F', '#E57B7B', '#F4F6F8'];
const cursorColors = ['#8B83FF', '#53C793', '#F2BB67', '#F17984', '#6CC4F0', '#D58CF0'];
// The shared drawing space; every viewer scales it to fit, so coordinates match everywhere.
const W = 1000,
  H = 620;
const put = ({ authorId: _author, ...element }: BoardElement): ActivityCommand => ({
  type: 'whiteboard.put',
  element,
});
const clamp = (value: number, max: number) => Math.max(0, Math.min(max, value));
const hue = (id: string) =>
  cursorColors[[...id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % cursorColors.length];

/** Local undo history is bounded and keyed by the parent to room and identity. */
export default function Whiteboard({
  roomId,
  userId,
  roomName,
  activity,
  onPolls,
}: {
  roomId: string;
  userId: string;
  roomName?: string;
  activity: ReturnType<typeof useActivityRoom>;
  onPolls?(): void;
}) {
  const realtime = useRealtime();
  const [tool, setTool] = useState<Tool>('pen');
  const [exportOpen, setExportOpen] = useState(false),
    [selected, setSelected] = useState<string | null>(null);
  const [color, setColor] = useState(colors[0]!);
  const [draft, setDraft] = useState<{ x: number; y: number; text: string } | null>(null);
  const [noteColor, setNoteColor] = useState<string>(NOTE_COLORS[0]);
  const [noteDraft, setNoteDraftState] = useState<NoteDraft | null>(null);
  const [drag, setDrag] = useState<NoteDrag | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [points, setPoints] = useState<[number, number][]>([]);
  const [history, setHistory] = useState<Edit[]>([]),
    [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');
  const [fullscreen, setFullscreen] = useState(false);
  const [cursors, setCursors] = useState<Record<string, { x: number; y: number; at: number }>>({});
  const path = useRef<[number, number][]>([]),
    noteRef = useRef<NoteDraft | null>(null),
    dragRef = useRef<NoteDrag | null>(null),
    drawing = useRef(false),
    locked = useRef(false),
    alive = useRef(true),
    frame = useRef<HTMLDivElement>(null),
    lastCursor = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const fixture = import.meta.env.DEV && new URLSearchParams(location.search).has('fixture');
  const readOnly = fixture || !userId || activity.status !== 'connected';
  const busy = activity.busy || working || readOnly;
  const board = activity.room?.whiteboard ?? [];
  const self = activity.room?.participants.find((person) => person.userId === userId);
  // Community admins use the same `canControl` rule as closing someone else's poll.
  const canClear = self?.canControl === true;
  /** Authors change their own items; admins may also move, edit and delete sticky notes. */
  const canEdit = (item: BoardElement) =>
    item.authorId === userId || (item.kind === 'note' && canClear);
  const setNoteDraft = (value: NoteDraft | null) => {
    noteRef.current = value;
    setNoteDraftState(value);
  };
  const live = realtime.status === 'connected' && realtime.channelId === roomId;
  useEffect(() => {
    let active = true;
    if (import.meta.env.DEV) {
      const query = new URLSearchParams(location.search);
      if (query.get('fixture') === 'S54')
        void import('./dev/games-fixture').then((f) => {
          if (!active) return;
          const meta = f.getGamesFixtureMetadata('S54', query.get('variant') || 'default');
          setExportOpen(meta.ui.modal === 'board-export');
          setTool(meta.ui.boardTool);
          if (meta.ui.undoElementId) {
            const element = board.find(
              (item) => item.id === meta.ui.undoElementId && item.authorId === userId,
            );
            if (element) {
              setSelected(element.id);
              setHistory([{ kind: 'add', element }]);
            }
          }
        });
    }
    return () => {
      active = false;
    };
  }, [roomId, userId, activity.room?.roomId]);

  /** Screen → board coordinates through the SVG's own transform (letterboxing included). */
  const point = (e: React.PointerEvent<SVGElement>): [number, number] => {
    const svg = e.currentTarget.ownerSVGElement ?? e.currentTarget;
    const matrix = svg.getScreenCTM();
    if (!matrix) return [0, 0];
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse());
    return [clamp(Math.round(p.x * 10) / 10, W), clamp(Math.round(p.y * 10) / 10, H)];
  };

  // Everyone in the voice room sees where the others point on this board.
  useEffect(() => {
    if (!live) return;
    const stop = onCursor((payload, senderId) => {
      try {
        const value = JSON.parse(payload) as { b?: unknown; x?: unknown; y?: unknown };
        if (value.b !== roomId || senderId === userId) return;
        setCursors((current) => {
          const next = { ...current };
          if (typeof value.x === 'number' && typeof value.y === 'number')
            next[senderId] = { x: clamp(value.x, W), y: clamp(value.y, H), at: Date.now() };
          else delete next[senderId];
          return next;
        });
      } catch {
        /* Not a cursor update. */
      }
    });
    const sweep = setInterval(
      () =>
        setCursors((current) => {
          const fresh = Object.entries(current).filter(([, c]) => Date.now() - c.at < 5000);
          return fresh.length === Object.keys(current).length ? current : Object.fromEntries(fresh);
        }),
      1000,
    );
    return () => {
      stop();
      clearInterval(sweep);
      setCursors({});
    };
  }, [live, roomId, userId]);
  const shareCursor = useCallback(
    (at: [number, number] | null) => {
      if (!live) return;
      const now = Date.now();
      if (at && now - lastCursor.current < 50) return;
      lastCursor.current = now;
      publishCursor(
        JSON.stringify(
          at ? { b: roomId, x: Math.round(at[0]), y: Math.round(at[1]) } : { b: roomId },
        ),
      );
    },
    [live, roomId],
  );

  async function run(work: () => Promise<void>) {
    if (fixture || !userId || locked.current || activity.busy || activity.status !== 'connected')
      return;
    locked.current = true;
    setWorking(true);
    setMessage('');
    try {
      await work();
    } catch (error) {
      if (alive.current) setMessage(uiError(error));
    } finally {
      locked.current = false;
      if (alive.current) setWorking(false);
    }
  }
  async function add(element: BoardElement) {
    await activity.send(put(element));
    if (!alive.current) return;
    setHistory((h) => [...h.slice(-49), { kind: 'add', element }]);
  }
  const remove = (element: BoardElement) => {
    if (!canEdit(element)) {
      setMessage(t('Yalnızca kendi çizimini veya notunu silebilirsin.'));
      return;
    }
    void run(async () => {
      await activity.send({ type: 'whiteboard.remove', elementId: element.id });
      if (alive.current) setHistory((h) => [...h.slice(-49), { kind: 'remove', element }]);
    });
  };
  const undo = () =>
    void run(async () => {
      const edit = history.at(-1);
      if (!edit) return;
      let restored: BoardElement | undefined;
      if (edit.kind === 'add') {
        const current = board.find((item) => item.id === edit.element.id);
        if (
          current &&
          (current.authorId !== edit.element.authorId ||
            current.kind !== edit.element.kind ||
            current.color !== edit.element.color ||
            current.width !== edit.element.width ||
            current.text !== edit.element.text ||
            JSON.stringify(current.points) !== JSON.stringify(edit.element.points))
        ) {
          throw new Error(
            t(
              'Bu öğe başka bir oturumda değiştirildi. Güncel öğeyi silmek için silgi aracını kullan.',
            ),
          );
        }
        if (current) await activity.send({ type: 'whiteboard.remove', elementId: current.id });
      } else {
        // A fresh ID never overwrites a concurrent restoration from another device.
        restored = { ...edit.element, id: crypto.randomUUID() };
        await activity.send(put(restored));
      }
      if (alive.current)
        setHistory((h) =>
          h
            .slice(0, -1)
            .map((entry) =>
              restored && entry.element.id === edit.element.id
                ? { ...entry, element: restored }
                : entry,
            ),
        );
    });
  const commitDraft = () => {
    const value = draft?.text.trim();
    const at = draft;
    setDraft(null);
    if (!value || !at) return;
    void run(() =>
      add({
        id: crypto.randomUUID(),
        kind: 'text',
        points: [[at.x, at.y]],
        text: value.slice(0, 2000),
        color,
        width: 2,
        authorId: userId,
      }),
    );
  };
  /** Saves the note being typed: a new note at its spot, or new text for an existing one. */
  const commitNote = () => {
    const current = noteRef.current;
    setNoteDraft(null);
    const value = current?.text.trim();
    if (!current || !value) return;
    const existing = current.id ? board.find((item) => item.id === current.id) : undefined;
    if (current.id && (!existing || !canEdit(existing))) return;
    const element: BoardElement = {
      id: existing?.id ?? crypto.randomUUID(),
      kind: 'note',
      points: existing ? existing.points : [placeNote(current.x, current.y)],
      text: value.slice(0, NOTE_MAX_CHARS),
      color: current.color,
      width: 1,
      authorId: existing?.authorId ?? userId,
    };
    void run(() => (existing ? activity.send(put(element)) : add(element)));
  };
  const editNote = (item: BoardElement) => {
    if (!canEdit(item)) {
      setMessage(t('Notu yalnızca yazarı veya bir topluluk yöneticisi değiştirebilir.'));
      return;
    }
    setSelected(item.id);
    setNoteDraft({
      id: item.id,
      x: item.points[0]![0],
      y: item.points[0]![1],
      text: item.text ?? '',
      color: item.color,
    });
  };
  const moveNote = (item: BoardElement, x: number, y: number) => {
    const [nx, ny] = placeNote(x, y);
    if (nx === item.points[0]![0] && ny === item.points[0]![1]) return;
    void run(() => activity.send(put({ ...item, points: [[nx, ny]] })));
  };
  const recolorNote = (item: BoardElement, value: string) => {
    if (item.color === value || !canEdit(item)) return;
    void run(() => activity.send(put({ ...item, color: value })));
  };
  const clearBoard = () =>
    void run(async () => {
      await activity.send({ type: 'whiteboard.clear' });
      if (alive.current) {
        setHistory([]);
        setSelected(null);
        setClearOpen(false);
        setMessage(t('Tahta temizlendi.'));
      }
    });
  const askClear = () => {
    if (busy) return;
    if (!canClear) {
      setMessage(t('Tahtayı yalnızca topluluk yöneticileri temizleyebilir.'));
      return;
    }
    if (!board.length) {
      setMessage(t('Tahta zaten boş.'));
      return;
    }
    setClearOpen(true);
  };
  const exportBoard = () =>
    void run(async () => {
      if (!window.rooms?.activity?.exportBoard)
        throw new Error('A native desktop application is required.');
      const saved = await window.rooms.activity.exportBoard(roomId, 'png');
      if (alive.current) {
        setMessage(saved ? t('Tahta PNG olarak kaydedildi.') : t('Kaydetme iptal edildi.'));
        if (saved) setExportOpen(false);
      }
    });

  // Fullscreen covers the whole display; the app's drag regions are hidden meanwhile.
  useEffect(() => {
    const update = () => setFullscreen(document.fullscreenElement === frame.current);
    document.addEventListener('fullscreenchange', update);
    return () => {
      document.removeEventListener('fullscreenchange', update);
      if (document.fullscreenElement === frame.current)
        void document.exitFullscreen().catch(() => {});
    };
  }, []);
  useEffect(() => {
    if (fullscreen) document.documentElement.dataset.roomPlayerFullscreen = 'true';
    else delete document.documentElement.dataset.roomPlayerFullscreen;
    return () => {
      delete document.documentElement.dataset.roomPlayerFullscreen;
    };
  }, [fullscreen]);
  const toggleFullscreen = () =>
    void (
      document.fullscreenElement
        ? document.exitFullscreen()
        : frame.current!.requestFullscreen({ navigationUI: 'hide' })
    ).catch(() => setMessage(t('Tam ekran açılamadı.')));

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        event.repeat ||
        event.altKey ||
        event.defaultPrevented ||
        (target instanceof HTMLElement &&
          (target.isContentEditable ||
            target.closest('input,textarea,select,button,[role=dialog]'))) ||
        exportOpen ||
        clearOpen
      )
        return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        if (busy) return;
        event.preventDefault();
        undo();
        return;
      }
      if (event.metaKey || event.ctrlKey) return;
      if (event.key.toLowerCase() === 'f') {
        event.preventDefault();
        toggleFullscreen();
        return;
      }
      const keys: Record<string, Tool> = {
        v: 'select',
        p: 'pen',
        r: 'rectangle',
        o: 'ellipse',
        t: 'text',
        n: 'note',
        e: 'erase',
      };
      if (!busy && keys[event.key.toLowerCase()]) {
        event.preventDefault();
        setTool(keys[event.key.toLowerCase()]!);
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [busy, exportOpen, clearOpen, history, board]);
  useEffect(() => {
    if (busy) {
      dragRef.current = null;
      setDrag(null);
      drawing.current = false;
      path.current = [];
      setPoints([]);
    }
  }, [busy]);
  useEffect(() => {
    if (tool !== 'text') setDraft(null);
    if (tool !== 'select' && tool !== 'note') setSelected(null);
    if (tool !== 'note' && tool !== 'select') commitNote();
  }, [tool]);

  const nameOf = (id: string) =>
    realtime.participants.find((person) => person.id === id)?.name ?? t('Katılımcı');
  const others = Object.entries(cursors);
  const selectedItem = selected ? board.find((item) => item.id === selected) : undefined;
  const noteTarget = selectedItem?.kind === 'note' && canEdit(selectedItem) ? selectedItem : null;
  const noteProps = (item: BoardElement) => ({
    tabIndex: 0,
    role: 'button',
    'aria-label': t('Yapışkan not: {text}', { text: item.text ?? '' }),
    onPointerDown: (e: React.PointerEvent<SVGGElement>) => {
      // Drawing tools keep drawing over notes; only select and note tools grab them.
      if (e.button !== 0 || (tool !== 'select' && tool !== 'note')) return;
      e.stopPropagation();
      setSelected(item.id);
      if (busy || !canEdit(item)) return;
      const [px, py] = point(e);
      const [x, y] = item.points[0]!;
      const next = { id: item.id, dx: px - x, dy: py - y, ox: x, oy: y, x, y, moved: false };
      dragRef.current = next;
      setDrag(next);
      (e.currentTarget.ownerSVGElement ?? e.currentTarget).setPointerCapture(e.pointerId);
    },
    onDoubleClick: () => {
      if (!busy && (tool === 'select' || tool === 'note')) editNote(item);
    },
    onKeyDown: (e: React.KeyboardEvent<SVGGElement>) => {
      if (e.target !== e.currentTarget || e.altKey || e.metaKey || e.ctrlKey) return;
      const step = e.shiftKey ? 40 : 10;
      const [x, y] = item.points[0]!;
      const arrows: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      if (arrows[e.key]) {
        e.preventDefault();
        setSelected(item.id);
        if (busy) return;
        if (!canEdit(item)) {
          setMessage(t('Notu yalnızca yazarı veya bir topluluk yöneticisi değiştirebilir.'));
          return;
        }
        moveNote(item, x + arrows[e.key]![0], y + arrows[e.key]![1]);
      } else if (e.key === 'Enter' || e.key === 'F2') {
        e.preventDefault();
        if (!busy) editNote(item);
      } else if (e.key === ' ') {
        e.preventDefault();
        setSelected(item.id);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && !busy) {
        e.preventDefault();
        remove(item);
      }
    },
  });
  const tools = [
    ['pen', t('Kalem (P)'), Pencil],
    ['rectangle', t('Dikdörtgen (R)'), Square],
    ['ellipse', t('Daire (O)'), Circle],
    ['text', t('Metin: tahtaya tıkla ve yaz (T)'), Type],
    ['note', t('Yapışkan not: tahtaya tıkla ve yaz, sürükleyerek taşı (N)'), StickyNote],
    ['erase', t('Silgi: kendi öğene tıkla (E)'), Eraser],
    ['select', t('Seç (V)'), MousePointer2],
  ] as const;
  return (
    <div ref={frame} className={`wb ${fullscreen ? 'is-fullscreen' : ''}`}>
      <div className="wb-top">
        <div className="wb-title">
          <strong>{t('Beyaz tahta')}</strong>
          <span>
            {roomName ?? t('Oda')}
            {others.length ? ` · ${t('{count} kişi burada', { count: others.length + 1 })}` : ''}
          </span>
        </div>
        <div className="wb-toolbar" role="toolbar" aria-label={t('Çizim araçları')}>
          {tools.map(([value, label, Icon]) => (
            <button
              disabled={busy}
              key={value}
              aria-label={label}
              title={label}
              aria-pressed={tool === value}
              onClick={() => setTool(value)}
            >
              <Icon size={17} />
            </button>
          ))}
          <span className="wb-divider" />
          {colors.map((c) => (
            <button
              className="wb-color"
              disabled={busy}
              key={c}
              aria-label={t('Çizim rengi {color}', { color: c })}
              aria-pressed={color === c}
              style={{ ['--swatch' as string]: c }}
              onClick={() => setColor(c)}
            >
              {color === c && <Check size={11} />}
            </button>
          ))}
          {(tool === 'note' || noteTarget || noteDraft) && (
            <>
              <span className="wb-divider" />
              {NOTE_COLORS.map((c) => {
                const active = noteDraft
                  ? noteDraft.color === c
                  : noteTarget
                    ? noteTarget.color === c
                    : noteColor === c;
                return (
                  <button
                    className="wb-color wb-note-color"
                    disabled={busy}
                    key={c}
                    aria-label={t('Not rengi {color}', { color: c })}
                    aria-pressed={active}
                    style={{ ['--swatch' as string]: c }}
                    // Keep the note's text field focused so picking a colour does not save it early.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setNoteColor(c);
                      if (noteDraft) setNoteDraft({ ...noteDraft, color: c });
                      else if (noteTarget) recolorNote(noteTarget, c);
                    }}
                  >
                    {active && <Check size={11} />}
                  </button>
                );
              })}
            </>
          )}
          <span className="wb-divider" />
          <button
            disabled={busy || !history.length}
            aria-label={t('Geri al (⌘Z)')}
            title={
              history.length
                ? t('Bu oturumdaki son kendi işlemini geri al (⌘Z)')
                : t('Bu oturumda geri alınacak kendi işlemin yok')
            }
            onClick={undo}
          >
            <Undo2 size={17} />
          </button>
          <button
            disabled={busy || !board.length || !window.rooms?.activity?.exportBoard}
            aria-label={t('PNG olarak dışa aktar')}
            title={
              !board.length
                ? t('Önce tahtaya bir çizim veya not ekle')
                : t('Tahtanın güncel görüntüsünü PNG olarak kaydet')
            }
            onClick={() => setExportOpen(true)}
          >
            <Download size={17} />
          </button>
          <button
            aria-label={fullscreen ? t('Tam ekrandan çık (F)') : t('Tam ekran (F)')}
            title={fullscreen ? t('Tam ekrandan çık (F)') : t('Tam ekran (F)')}
            onClick={toggleFullscreen}
          >
            {fullscreen ? <Minimize size={17} /> : <Maximize size={17} />}
          </button>
        </div>
        <div className="wb-side">
          <button
            className="button ghost small wb-clear"
            aria-disabled={busy || !canClear || !board.length}
            title={
              !canClear
                ? t('Tahtayı yalnızca topluluk yöneticileri temizleyebilir.')
                : !board.length
                  ? t('Tahta zaten boş.')
                  : t('Tahtadaki tüm çizimleri ve notları herkes için sil')
            }
            onClick={askClear}
          >
            <Trash2 size={15} />
            {t('Tahtayı temizle')}
          </button>
          {onPolls && (
            <button className="button ghost small" onClick={onPolls}>
              <Vote size={15} />
              {t('Anketler')}
            </button>
          )}
        </div>
      </div>
      <div className="wb-stage">
        <div className="wb-canvas-box">
          <svg
            className={`board-canvas wb-board tool-${tool} ${readOnly ? 'readonly' : ''}`}
            tabIndex={0}
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label={t('Ortak çizim tahtası')}
            onPointerDown={(e) => {
              if (busy || e.button !== 0) return;
              if (tool === 'note') {
                // Keep focus off the SVG so the new note's text field receives the typing.
                e.preventDefault();
                commitNote();
                const [x, y] = point(e);
                setNoteDraft({
                  id: null,
                  x: placeNote(x - NOTE_WIDTH / 2, y - NOTE_HEIGHT / 2, false)[0],
                  y: placeNote(x - NOTE_WIDTH / 2, y - NOTE_HEIGHT / 2, false)[1],
                  text: '',
                  color: noteColor,
                });
                setSelected(null);
                return;
              }
              if (tool === 'text') {
                // Keep focus off the SVG so the new text field receives the typing.
                e.preventDefault();
                if (draft?.text.trim()) commitDraft();
                const [x, y] = point(e);
                setDraft({ x, y: Math.max(22, y), text: '' });
                return;
              }
              if (!['pen', 'rectangle', 'ellipse'].includes(tool)) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              drawing.current = true;
              path.current = [point(e)];
              setPoints([...path.current]);
            }}
            onPointerMove={(e) => {
              const at = point(e);
              shareCursor(at);
              const dragging = dragRef.current;
              if (dragging) {
                const [x, y] = placeNote(at[0] - dragging.dx, at[1] - dragging.dy, false);
                const next = {
                  ...dragging,
                  x,
                  y,
                  moved: dragging.moved || Math.hypot(x - dragging.ox, y - dragging.oy) > 3,
                };
                dragRef.current = next;
                setDrag(next);
                return;
              }
              if (!drawing.current || path.current.length >= 499) return;
              if (tool === 'pen') path.current.push(at);
              else path.current = [path.current[0]!, at];
              setPoints([...path.current]);
            }}
            onPointerLeave={() => shareCursor(null)}
            onPointerUp={(e) => {
              const dragged = dragRef.current;
              if (dragged) {
                dragRef.current = null;
                setDrag(null);
                const item = board.find((entry) => entry.id === dragged.id);
                if (item && dragged.moved) moveNote(item, dragged.x, dragged.y);
                return;
              }
              if (!drawing.current) return;
              drawing.current = false;
              const stroke =
                tool === 'pen'
                  ? [...path.current, point(e)].slice(0, 500)
                  : [path.current[0]!, point(e)];
              setPoints([]);
              path.current = [];
              void run(() =>
                add({
                  id: crypto.randomUUID(),
                  kind:
                    tool === 'rectangle' ? 'rectangle' : tool === 'ellipse' ? 'ellipse' : 'stroke',
                  points: stroke,
                  color,
                  width: 3,
                  authorId: userId,
                }),
              );
            }}
            onPointerCancel={() => {
              dragRef.current = null;
              setDrag(null);
              drawing.current = false;
              path.current = [];
              setPoints([]);
            }}
          >
            <defs>
              <pattern id="board-dots" width="24" height="24" patternUnits="userSpaceOnUse">
                <circle cx="1" cy="1" r="1" fill="#ffffff14" />
              </pattern>
            </defs>
            <rect className="wb-paper" width={W} height={H} rx="10" fill="url(#board-dots)" />
            {board.map((item) => (
              <g
                key={item.id}
                className={`${tool === 'erase' ? (canEdit(item) ? 'erasable' : 'locked') : ''} ${selected === item.id ? 'selected' : ''} ${item.kind === 'note' ? 'wb-note' : ''}`}
                onClick={() => {
                  if (tool === 'select') setSelected(item.id);
                  if (tool === 'erase' && !busy) remove(item);
                }}
                {...(item.kind === 'note' ? noteProps(item) : {})}
              >
                {item.kind === 'note' ? (
                  <StickyNoteShape
                    item={item}
                    at={drag?.id === item.id ? [drag.x, drag.y] : item.points[0]!}
                    dragging={drag?.id === item.id}
                  />
                ) : item.kind === 'text' ? (
                  <text
                    x={item.points[0]![0]}
                    y={item.points[0]![1]}
                    fill={item.color}
                    fontSize="20"
                  >
                    {item.text}
                  </text>
                ) : item.kind === 'rectangle' || item.kind === 'ellipse' ? (
                  <BoardShape
                    kind={item.kind}
                    points={item.points}
                    color={item.color}
                    width={item.width}
                  />
                ) : (
                  <polyline
                    points={item.points.map((p) => p.join(',')).join(' ')}
                    stroke={item.color}
                    strokeWidth={item.width}
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}
              </g>
            ))}
            {points.length > 0 &&
              (tool === 'rectangle' || tool === 'ellipse' ? (
                <BoardShape kind={tool} points={points} color={color} width={3} />
              ) : (
                <polyline
                  points={points.map((p) => p.join(',')).join(' ')}
                  stroke={color}
                  strokeWidth="3"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
            {others.map(([id, cursor]) => (
              <g
                key={id}
                className="wb-cursor"
                transform={`translate(${cursor.x} ${cursor.y})`}
                style={{ ['--cursor' as string]: hue(id) }}
              >
                <path d="M0 0 L0 17 L4.6 12.6 L8 20 L11 18.6 L7.7 11.4 L13.5 11.4 Z" />
                <text x="15" y="26">
                  {nameOf(id)}
                </text>
              </g>
            ))}
          </svg>
          {draft && (
            <input
              className="wb-text-input"
              ref={(input) => {
                if (input && document.activeElement !== input) input.focus({ preventScroll: true });
              }}
              value={draft.text}
              maxLength={2000}
              aria-label={t('Beyaz tahta notu')}
              placeholder={t('Yaz, Enter’a bas')}
              style={{
                color,
                left: `${(draft.x / W) * 100}%`,
                top: `${((draft.y - 22) / H) * 100}%`,
              }}
              onChange={(event) => setDraft({ ...draft, text: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitDraft();
                if (event.key === 'Escape') setDraft(null);
              }}
              onBlur={commitDraft}
            />
          )}
          {noteDraft && (
            <textarea
              className="wb-note-input"
              ref={(input) => {
                if (input && document.activeElement !== input) input.focus({ preventScroll: true });
              }}
              value={noteDraft.text}
              maxLength={NOTE_MAX_CHARS}
              aria-label={t('Yapışkan not metni')}
              placeholder={t('Notunu yaz, Enter’a bas')}
              style={{
                background: noteDraft.color,
                left: `${(noteDraft.x / W) * 100}%`,
                top: `${(noteDraft.y / H) * 100}%`,
                width: `${(NOTE_WIDTH / W) * 100}%`,
                height: `${(NOTE_HEIGHT / H) * 100}%`,
              }}
              onChange={(event) => setNoteDraft({ ...noteDraft, text: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  commitNote();
                }
                if (event.key === 'Escape') setNoteDraft(null);
              }}
              onBlur={commitNote}
            />
          )}
        </div>
        {!board.length && !draft && !noteDraft && (
          <div className="board-empty">
            <Pencil size={26} />
            <span>{t('İlk çizgi senden.')}</span>
            <small>{t('Kalemle çiz, şekil ekle ya da metin aracıyla tahtaya tıklayıp yaz.')}</small>
          </div>
        )}
      </div>
      <div className="wb-foot">
        <span>
          {working || activity.busy
            ? t('Gönderiliyor…')
            : readOnly
              ? fixture
                ? t('Yerel örnek · Düzenleme kapalı')
                : t('Bağlantı bekleniyor; düzenleme kapalı')
              : live
                ? t('{count} öğe · imleçler canlı', { count: board.length })
                : t('{count} öğe · imleçler sesli odadayken görünür', { count: board.length })}
        </span>
        {selectedItem && (
          <span className="wb-selection">
            {selectedItem.kind === 'note' && (
              <button
                className="button secondary small"
                disabled={busy || !canEdit(selectedItem)}
                title={
                  canEdit(selectedItem)
                    ? t('Not metnini düzenle (Enter)')
                    : t('Notu yalnızca yazarı veya bir topluluk yöneticisi değiştirebilir.')
                }
                onClick={() => editNote(selectedItem)}
              >
                <Pencil size={14} />
                {t('Notu düzenle')}
              </button>
            )}
            <button
              className="button secondary small"
              disabled={busy || !canEdit(selectedItem)}
              title={
                !canEdit(selectedItem)
                  ? t('Yalnızca kendi öğeni silebilirsin')
                  : t('Seçili öğeyi sil')
              }
              onClick={() => remove(selectedItem)}
            >
              <Trash2 size={14} />
              {t('Seçili öğeyi sil')}
            </button>
            <button className="text-button" onClick={() => setSelected(null)}>
              {t('Seçimi kaldır')}
            </button>
          </span>
        )}
        {message && (
          <span className="wb-message" role="status">
            {message}
          </span>
        )}
      </div>
      <div className="wb-sr">
        {board.map((item, i) => (
          <button key={item.id} disabled={busy || !canEdit(item)} onClick={() => remove(item)}>
            {t('{name} öğesini sil', {
              name:
                item.kind === 'text' || item.kind === 'note'
                  ? (item.text ?? '')
                  : t('Çizim {number}', { number: i + 1 }),
            })}
          </button>
        ))}
      </div>
      {clearOpen && (
        <Modal
          title={t('Tahta temizlensin mi?')}
          className="rt-modal rt-board-clear"
          onClose={() => setClearOpen(false)}
        >
          <div className="rt-modal-body">
            <p>
              {t(
                'Odadaki herkesin çizimleri ve notları ({count} öğe) silinir. Bu işlem geri alınamaz.',
                { count: board.length },
              )}
            </p>
            {message && <p role="status">{message}</p>}
          </div>
          <footer>
            <button className="button secondary" onClick={() => setClearOpen(false)}>
              {t('Vazgeç')}
            </button>
            <button className="button danger" disabled={busy} onClick={clearBoard}>
              <Trash2 size={15} />
              {t('Tahtayı temizle')}
            </button>
          </footer>
        </Modal>
      )}
      {exportOpen && (
        <Modal
          title={t('Tahtayı PNG olarak indir')}
          className="rt-modal rt-board-export"
          onClose={() => setExportOpen(false)}
        >
          <div className="rt-modal-body">
            <div className="rt-export-preview">
              <Image size={30} />
              <h3>rooms-whiteboard.png</h3>
              <p>{t('2000 × 1240 px · Tahta içeriği')}</p>
            </div>
            <p>
              {t(
                'Araç çubuğu ve imleçler dışa aktarılmaz; çizimler ve notlar tek görselde saklanır.',
              )}
            </p>
            {message && <p role="status">{message}</p>}
          </div>
          <footer>
            <button className="button secondary" onClick={() => setExportOpen(false)}>
              {t('Vazgeç')}
            </button>
            <button
              className="button primary"
              disabled={busy || !board.length || !window.rooms?.activity?.exportBoard}
              onClick={exportBoard}
            >
              <Download size={15} />
              {t('PNG indir')}
            </button>
          </footer>
        </Modal>
      )}
    </div>
  );
}

function BoardShape({
  kind,
  points,
  color,
  width,
}: {
  kind: 'rectangle' | 'ellipse';
  points: [number, number][];
  color: string;
  width: number;
}) {
  if (points.length < 2) return null;
  const [first, last] = [points[0]!, points[points.length - 1]!],
    x = Math.min(first[0], last[0]),
    y = Math.min(first[1], last[1]),
    w = Math.abs(first[0] - last[0]),
    h = Math.abs(first[1] - last[1]);
  return kind === 'rectangle' ? (
    <rect x={x} y={y} width={w} height={h} rx={8} fill="none" stroke={color} strokeWidth={width} />
  ) : (
    <ellipse
      cx={x + w / 2}
      cy={y + h / 2}
      rx={w / 2}
      ry={h / 2}
      fill="none"
      stroke={color}
      strokeWidth={width}
    />
  );
}

function StickyNoteShape({
  item,
  at,
  dragging,
}: {
  item: BoardElement;
  at: [number, number];
  dragging: boolean;
}) {
  const lines = wrapNoteText(item.text ?? '');
  return (
    <g transform={`translate(${at[0]} ${at[1]})`} className={dragging ? 'is-dragging' : undefined}>
      <rect
        className="wb-note-paper"
        width={NOTE_WIDTH}
        height={NOTE_HEIGHT}
        rx="4"
        fill={item.color}
      />
      <text fill={NOTE_INK} fontSize={NOTE_FONT} xmlSpace="preserve">
        {lines.map((line, index) => (
          <tspan key={index} x={NOTE_PADDING} y={NOTE_PADDING + NOTE_FONT + index * NOTE_LINE}>
            {line}
          </tspan>
        ))}
      </text>
    </g>
  );
}
