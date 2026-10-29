import {
  joinSoundName,
  SOUNDBOARD_NAME_MAX,
  soundboardReactionPayload,
  splitSoundName,
  type SoundboardCatalog,
} from '../../../packages/shared-contracts/src/soundboard';
import { encodeSoundboard, soundboardBytes } from './soundboard-audio';
import { useCallback, useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { Modal } from '@rooms/design';
import { Pencil, PartyPopper, Plus, Play, Smile, Square, Trash2, Upload } from 'lucide-react';
import { useCommunity } from './community';
import { useRealtime, playSoundboard, publishReaction, stopSoundboard } from './realtime';
import { EmojiPicker } from './ComposerPickers';
import { floatEmoji, SoundboardFloaters } from './SoundboardFloaters';
import { t, uiError } from './i18n';

type Clip = { id: string; name: string; buffer: AudioBuffer };
/** What the add / edit form holds; the emoji and the label are joined into one stored name on save. */
type Draft =
  | { kind: 'new'; name: string; emoji: string; buffer: AudioBuffer }
  | { kind: 'edit'; id: string; name: string; emoji: string };
/** Everyone in the room sees the sound's emoji float up; clients without support ignore it. */
export function announceSound(name: string) {
  const { emoji } = splitSoundName(name);
  if (!emoji) return;
  floatEmoji(emoji);
  publishReaction(soundboardReactionPayload(emoji));
}
const useClips = create<{ owner: string; clips: Clip[]; volume: number }>(() => ({
  owner: '',
  clips: [],
  volume: 0.5,
}));
let sessionGeneration = 0;
const sessionKey = () => {
  const state = useCommunity.getState();
  return state.user ? `${state.serverUrl}:${state.user.id}` : '';
};
/** Observe authentication even while the call controls are unmounted. */
function syncSession() {
  const owner = sessionKey();
  if (useClips.getState().owner !== owner) {
    ++sessionGeneration;
    stopSoundboard();
    let volume = 0.5;
    try {
      const saved = Number(localStorage.getItem(`rooms-soundboard-level-v1:${owner}`));
      if (
        localStorage.getItem(`rooms-soundboard-level-v1:${owner}`) !== null &&
        Number.isFinite(saved) &&
        saved >= 0 &&
        saved <= 1
      )
        volume = saved;
    } catch {
      /* Keep playback available without storage. */
    }
    useClips.setState({ owner, clips: [], volume });
  }
}
syncSession();
useCommunity.subscribe(syncSession);

/** New uploads belong to the community; older local buffers require explicit publication. */
export function SoundboardButton({ showTrigger = true }: { showTrigger?: boolean }) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [draft, setDraft] = useState<Draft | null>(null),
    [picking, setPicking] = useState(false);
  const { clips, volume } = useClips(),
    r = useRealtime(),
    picker = useRef<HTMLInputElement>(null);
  const channelId = r.channelId,
    account = useCommunity((state) => JSON.stringify([state.serverUrl, state.user?.id ?? null])),
    scope = `${account}:${channelId}`,
    current = useRef(scope);
  current.current = scope;
  const [catalog, setCatalog] = useState<SoundboardCatalog | null>(null);
  const refresh = useCallback(async () => {
    if (!channelId || !window.rooms?.soundboard) return;
    const captured = scope;
    try {
      const value = await window.rooms.soundboard.list(channelId);
      if (current.current === captured) {
        setCatalog(value);
        setError('');
      }
    } catch (e) {
      if (current.current === captured) setError(uiError(e));
    }
  }, [channelId, scope]);
  useEffect(() => {
    setCatalog(null);
    setBusy(false);
    setError('');
    setDraft(null);
    setPicking(false);
    if (!open) return;
    let stopped = false,
      timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      await refresh();
      if (!stopped) timer = setTimeout(() => void poll(), 5000);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [open, refresh]);
  const close = useCallback(() => setOpen(false), []);
  const shared = window.rooms?.soundboard;
  const upload = async (name: string, buffer: AudioBuffer) => {
    if (!shared || !channelId) throw Error(t('Topluluk sesleri için sunucuyla bağlantı kur.'));
    await shared.upload(channelId, { name, audio: encodeSoundboard(buffer) });
    await refresh();
  };
  const playShared = async (id: string, name: string) => {
    if (!shared || !channelId) return;
    const captured = scope;
    setBusy(true);
    setError('');
    let context: AudioContext | null = null;
    try {
      const audio = await shared.read(channelId, id);
      context = new AudioContext({ sampleRate: 48000 });
      const buffer = await context.decodeAudioData(soundboardBytes(audio));
      if (current.current === captured) {
        await playSoundboard(buffer, volume);
        announceSound(name);
      }
    } catch (e) {
      if (current.current === captured) setError(uiError(e));
    } finally {
      await context?.close();
      if (current.current === captured) setBusy(false);
    }
  };
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener('rooms:open-soundboard', show);
    return () => window.removeEventListener('rooms:open-soundboard', show);
  }, []);
  async function add(file: File) {
    const generation = sessionGeneration,
      captured = scope;
    setBusy(true);
    setError('');
    let context: AudioContext | null = null;
    try {
      if (file.size > 2_000_000 || !file.size)
        throw new Error(t('En fazla 2 MB bir ses dosyası seç.'));
      context = new AudioContext({ sampleRate: 48000 });
      const buffer = await context.decodeAudioData(await file.arrayBuffer());
      if (buffer.duration > 8 || buffer.duration <= 0 || buffer.numberOfChannels > 2)
        throw new Error(t('En fazla 8 saniyelik mono veya stereo bir ses seç.'));
      if (generation !== sessionGeneration || !sessionKey() || current.current !== captured) return;
      // The form asks for the emoji (and a name) before anything is uploaded.
      setDraft({
        kind: 'new',
        name: file.name.replace(/\.[^.]+$/, '').slice(0, SOUNDBOARD_NAME_MAX - 3),
        emoji: '',
        buffer,
      });
    } catch (e) {
      if (current.current === captured)
        setError(e instanceof Error ? e.message : t('Ses dosyası okunamadı.'));
    } finally {
      await context?.close();
      if (current.current === captured) setBusy(false);
    }
  }
  const reason =
    r.status !== 'connected'
      ? t('Ses odasına katıl.')
      : r.deafened
        ? t('Sağırlaştırmayı kapat.')
        : r.muted
          ? t('Mikrofonu aç.')
          : '';
  const manage = (ownerId: string) =>
    !!catalog && (catalog.canManage || ownerId === useCommunity.getState().user?.id);
  /** Saves the form: a new sound is uploaded with its emoji, an edited one is renamed. */
  const saveDraft = () => {
    if (!draft || !channelId) return;
    const captured = scope,
      name = joinSoundName(draft.emoji, draft.name);
    if (!draft.name.trim() || !name) return;
    setBusy(true);
    setError('');
    const work =
      draft.kind === 'new'
        ? upload(name, draft.buffer)
        : shared!.rename(channelId, draft.id, name).then(() => refresh());
    void work
      .then(() => {
        if (current.current === captured) setDraft(null);
      })
      .catch((e) => {
        if (current.current === captured) setError(uiError(e));
      })
      .finally(() => {
        if (current.current === captured) setBusy(false);
      });
  };
  const labelMax = draft
    ? SOUNDBOARD_NAME_MAX - (draft.emoji ? draft.emoji.length + 1 : 0)
    : SOUNDBOARD_NAME_MAX;
  return (
    <>
      <SoundboardFloaters />
      {showTrigger && (
        <button
          className="icon-button"
          aria-label="Soundboard"
          title="Soundboard"
          onClick={() => setOpen(true)}
        >
          <PartyPopper size={18} />
        </button>
      )}
      {open && (
        <Modal title="Soundboard" onClose={close}>
          <div data-soundboard>
            <input
              ref={picker}
              type="file"
              accept="audio/*"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void add(file);
              }}
            />
            <div className="button-row">
              <button
                className="button secondary"
                disabled={
                  busy || !channelId || !shared || !catalog?.canUpload || catalog.clips.length >= 32
                }
                onClick={() => picker.current?.click()}
              >
                <Plus size={16} />
                {busy && !draft ? t('Ekleniyor…') : t('Ses ekle')}
              </button>
              <button className="button secondary" onClick={stopSoundboard}>
                <Square size={14} />
                {t('Durdur')}
              </button>
            </div>
            {draft && (
              // Not a <form>: the emoji picker's buttons would submit it.
              <div
                className="sb-form"
                role="group"
                aria-label={draft.kind === 'new' ? t('Yeni ses') : t('Sesi düzenle')}
              >
                <div className="sb-form-row">
                  <button
                    type="button"
                    className="sb-emoji-pick"
                    aria-label={t('Emoji seç')}
                    aria-expanded={picking}
                    title={t('Ses çalınca odadakilere bu emoji süzülür.')}
                    onClick={() => setPicking((value) => !value)}
                  >
                    {draft.emoji || <Smile size={18} />}
                  </button>
                  <input
                    className="sb-name"
                    aria-label={t('Ses adı')}
                    placeholder={t('Ses adı')}
                    maxLength={labelMax}
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        saveDraft();
                      }
                    }}
                  />
                </div>
                {picking && (
                  <div className="sb-emoji-pop">
                    <EmojiPicker
                      onPick={(emoji) => {
                        setDraft({
                          ...draft,
                          emoji,
                          name: draft.name.slice(0, SOUNDBOARD_NAME_MAX - emoji.length - 1),
                        });
                        setPicking(false);
                      }}
                      onClose={() => setPicking(false)}
                    />
                  </div>
                )}
                <div className="sb-form-row">
                  {draft.emoji && (
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => setDraft({ ...draft, emoji: '' })}
                    >
                      {t('Emojiyi kaldır')}
                    </button>
                  )}
                  <span className="sb-form-gap" />
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy}
                    onClick={() => {
                      setDraft(null);
                      setPicking(false);
                    }}
                  >
                    {t('Vazgeç')}
                  </button>
                  <button
                    type="button"
                    className="button"
                    disabled={busy || !draft.name.trim()}
                    onClick={saveDraft}
                  >
                    {busy ? t('Kaydediliyor…') : t('Kaydet')}
                  </button>
                </div>
              </div>
            )}
            <p className="muted">{reason || t('Ses açık mikrofonundan odaya gönderilir.')}</p>
            <div className="soundboard-grid">
              {catalog?.clips.map((clip) => {
                const { emoji, label } = splitSoundName(clip.name);
                return (
                  <div key={clip.id} className="sb-tile">
                    <button
                      className="soundboard-play"
                      disabled={!!reason || busy}
                      title={reason || clip.name}
                      aria-label={clip.name}
                      onClick={() => void playShared(clip.id, clip.name)}
                    >
                      <span className="sb-emoji" aria-hidden="true">
                        {emoji || <Play size={18} />}
                      </span>
                      <strong>{label || clip.name}</strong>
                      <small>{t('{seconds} sn', { seconds: clip.durationSec.toFixed(1) })}</small>
                    </button>
                    {manage(clip.ownerId) && (
                      <span className="sb-actions">
                        <button
                          aria-label={t('{name} sesini düzenle', { name: clip.name })}
                          title={t('Düzenle')}
                          disabled={busy}
                          onClick={() => {
                            setPicking(false);
                            setDraft({ kind: 'edit', id: clip.id, name: label, emoji });
                          }}
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          aria-label={t('{name} topluluk sesini kaldır', { name: clip.name })}
                          title={t('Kaldır')}
                          disabled={busy}
                          onClick={() => {
                            const captured = scope;
                            setBusy(true);
                            void shared!
                              .remove(channelId!, clip.id)
                              .then(() => (current.current === captured ? refresh() : undefined))
                              .catch((e) => {
                                if (current.current === captured) setError(uiError(e));
                              })
                              .finally(() => {
                                if (current.current === captured) setBusy(false);
                              });
                          }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            {clips.length > 0 && <p className="muted">{t('Bu cihazdaki eski sesler')}</p>}
            <div className="soundboard-grid">
              {clips.map((clip) => {
                const { emoji, label } = splitSoundName(clip.name);
                return (
                  <div key={clip.id} className="sb-tile">
                    <button
                      className="soundboard-play"
                      disabled={!!reason || busy}
                      title={reason || clip.name}
                      aria-label={clip.name}
                      onClick={() => {
                        void playSoundboard(clip.buffer, volume)
                          .then(() => announceSound(clip.name))
                          .catch((e) => setError(uiError(e)));
                      }}
                    >
                      <span className="sb-emoji" aria-hidden="true">
                        {emoji || <Play size={18} />}
                      </span>
                      <strong>{label || clip.name}</strong>
                      <small>{t('{seconds} sn', { seconds: clip.buffer.duration.toFixed(1) })}</small>
                    </button>
                    <span className="sb-actions">
                      <button
                        aria-label={t('{name} sesini topluluğa ekle', { name: clip.name })}
                        title={t('Topluluğa ekle')}
                        disabled={busy || !catalog?.canUpload}
                        onClick={() => {
                          setPicking(false);
                          setDraft({ kind: 'new', name: label, emoji, buffer: clip.buffer });
                        }}
                      >
                        <Upload size={13} />
                      </button>
                      <button
                        aria-label={t('{name} sesini kaldır', { name: clip.name })}
                        title={t('Kaldır')}
                        onClick={() => {
                          stopSoundboard();
                          useClips.setState((state) => ({
                            clips: state.clips.filter((item) => item.id !== clip.id),
                          }));
                        }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
            {!catalog?.clips.length && !clips.length && (
              <p className="muted">{t('Topluluk sesi yok. En fazla 8 sn · 2 MB')}</p>
            )}
            <label className="field-label">
              {t('SES')} · {Math.round(volume * 100)}%
              <input
                type="range"
                aria-label={t('Soundboard sesi')}
                min={0}
                max={1}
                step={0.05}
                value={volume}
                onChange={(e) => {
                  stopSoundboard();
                  const level = Number(e.target.value);
                  useClips.setState({ volume: level });
                  try {
                    localStorage.setItem(
                      `rooms-soundboard-level-v1:${sessionKey()}`,
                      String(level),
                    );
                  } catch {
                    /* Playback setting still applies for this session. */
                  }
                }}
              />
            </label>
            <p className="muted">{t('Yüklenen sesler toplulukta saklanır.')}</p>
            {error && (
              <div className="error-pane" role="alert">
                {error}
              </div>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
