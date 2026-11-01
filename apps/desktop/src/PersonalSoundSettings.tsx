import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { IconButton, Modal } from '@rooms/design';
import { Check, Play, Plus, Square, Trash2 } from 'lucide-react';
import {
  PERSONAL_SOUND_LIMITS,
  PERSONAL_SOUND_POLICY,
  personalSoundPresetName,
  type PersonalSound,
  type PersonalSoundAssign,
  type PersonalSoundEvent,
  type PersonalSoundProfile,
} from '../../../packages/shared-contracts/src/personal-sounds';
import {
  PersonalSoundAudioError,
  encodePersonalSoundWav,
  fromBase64,
  personalSoundWindow,
  processPersonalSound,
  toBase64,
} from '../../../packages/shared-contracts/src/personal-sound-audio';
import { useCommunity } from './community';
import { roomCueSource } from './room-event-sounds';
import { locale, localeLanguage, t, uiError } from './i18n';
import './personal-sounds.css';

type Slot = PersonalSoundEvent;
type Bridge = NonNullable<NonNullable<Window['rooms']>['personalSounds']>;
type Playing = { key: string; ms: number; token: number; started: boolean };
type Preview = ReturnType<typeof usePreview>;
type Draft = {
  mono: Float32Array;
  rate: number;
  duration: number;
  peaks: Float32Array;
  start: number;
  name: string;
  rights: boolean;
};
const MAX_SEC = PERSONAL_SOUND_LIMITS.maxDurationSec,
  MAX_SOURCE_SEC = PERSONAL_SOUND_LIMITS.maxSourceDurationSec,
  CLASSIC_SEC = 0.24,
  BARS = 120;
const copy = {
  enter: {
    title: t('Odaya girince'),
    description: t('Sen ve içerideki herkes duyar.'),
    picker: t('Giriş sesi seç'),
    change: t('Giriş sesini değiştir'),
    saved: t('Giriş sesin kaydedildi'),
  },
  leave: {
    title: t('Odadan çıkınca'),
    description: t('Sen ve kalanlar duyar.'),
    picker: t('Çıkış sesi seç'),
    change: t('Çıkış sesini değiştir'),
    saved: t('Çıkış sesin kaydedildi'),
  },
} as const;
const unreadable = t('Bu dosya okunamadı. MP3, WAV, M4A, OGG veya FLAC dene.'),
  tooLong = t('Bu dosya {minutes} dakikadan uzun. Kısa bir bölümünü kaydedip yeniden dene.', {
    minutes: MAX_SOURCE_SEC / 60,
  }),
  silent = t('Seçtiğin kesit neredeyse sessiz. Başka bir bölüm seç.');
const seconds = (value: number) =>
  t('{value} sn', {
    value: localeLanguage === 'tr' ? value.toFixed(1).replace('.', ',') : value.toFixed(1),
  });
const same = (a: PersonalSoundAssign, b: PersonalSoundAssign) =>
  a.enter === b.enter && a.leave === b.leave;
/** Focuses the first match once React has rendered the change. */
const focusSoon = (...selectors: string[]) =>
  requestAnimationFrame(() =>
    selectors
      .map((selector) => document.querySelector<HTMLElement>(selector))
      .find(Boolean)
      ?.focus(),
  );

function clipOf(profile: PersonalSoundProfile, id: string | null) {
  if (id === null)
    return { name: t('Varsayılan'), seconds: CLASSIC_SEC, gain: PERSONAL_SOUND_POLICY.classicGain };
  const preset = profile.presets.find((item) => item.id === id);
  const found = preset ?? profile.sounds.find((sound) => sound.id === id);
  return {
    name: preset
      ? personalSoundPresetName(preset.id, preset.name)
      : (found?.name ?? t('Bilinmeyen ses')),
    seconds: found?.durationSec ?? MAX_SEC,
    gain: PERSONAL_SOUND_POLICY.personalGain,
  };
}
/** The one copy kept while a window is chosen; averaged exactly as `personalSoundWindow` does. */
export function monoOf(channels: Float32Array[]) {
  const mono = new Float32Array(channels[0].length);
  for (const channel of channels)
    for (let i = 0; i < mono.length; i++) mono[i] += channel[i] / channels.length;
  return mono;
}
/** Length from the file's metadata, without decoding; `NaN` when the browser cannot tell. */
function sourceSeconds(file: File) {
  const url = URL.createObjectURL(file),
    probe = new Audio();
  let timer: ReturnType<typeof setTimeout> | undefined;
  return new Promise<number>((resolve) => {
    timer = setTimeout(() => resolve(NaN), 2000);
    probe.onloadedmetadata = () => resolve(Number.isFinite(probe.duration) ? probe.duration : NaN);
    probe.onerror = () => resolve(NaN);
    probe.preload = 'metadata';
    probe.src = url;
  }).finally(() => {
    clearTimeout(timer);
    probe.onloadedmetadata = probe.onerror = null;
    probe.removeAttribute('src');
    probe.load();
    URL.revokeObjectURL(url);
  });
}
function peaksOf(samples: Float32Array) {
  const peaks = new Float32Array(BARS);
  let top = 0;
  for (let bar = 0; bar < BARS; bar++) {
    const from = Math.floor((bar * samples.length) / BARS),
      to = Math.floor(((bar + 1) * samples.length) / BARS),
      step = Math.max(1, Math.floor((to - from) / 4000));
    let peak = 0;
    for (let i = from; i < to; i += step) {
      const value = Math.abs(samples[i]);
      if (value > peak) peak = value;
    }
    peaks[bar] = peak;
    if (peak > top) top = peak;
  }
  if (top > 0) for (let bar = 0; bar < BARS; bar++) peaks[bar] /= top;
  return peaks;
}
function draftClip(mono: Float32Array, rate: number, start: number) {
  try {
    return processPersonalSound(personalSoundWindow([mono], rate, start));
  } catch (e) {
    return e instanceof PersonalSoundAudioError && e.code === 'PERSONAL_SOUND_SILENT'
      ? silent
      : unreadable;
  }
}

/** One preview at a time, routed and leveled the way this device plays room sounds. */
function usePreview(outputId: string, level: number, fail: (message: string) => void) {
  const [playing, setPlaying] = useState<Playing | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null),
    token = useRef(0),
    gain = useRef(1),
    owned = useRef('');
  const stop = useCallback(() => {
    token.current++;
    audio.current?.pause();
    audio.current = null;
    if (owned.current) URL.revokeObjectURL(owned.current);
    owned.current = '';
    setPlaying(null);
  }, []);
  useEffect(() => stop, [stop]);
  useEffect(() => {
    if (audio.current) audio.current.volume = Math.min(1, gain.current * level);
  }, [level]);
  const toggle = async (
    key: string,
    source: () => string | Promise<string>,
    clipGain: number,
    duration: number,
    revoke = false,
  ) => {
    if (playing?.key === key) return stop();
    stop();
    const mine = token.current,
      ms = Math.round(duration * 1000);
    setPlaying({ key, ms, token: mine, started: false });
    try {
      const url = await source();
      if (revoke && mine === token.current) owned.current = url;
      else if (revoke) URL.revokeObjectURL(url);
      if (mine !== token.current) return;
      const player = new Audio(url) as HTMLAudioElement & { setSinkId?(id: string): Promise<void> };
      gain.current = clipGain;
      player.volume = Math.min(1, clipGain * level);
      if (outputId && player.setSinkId)
        await player.setSinkId(outputId).catch(() => {
          throw Error(t('Seçili hoparlör kullanılamadı. Sistem varsayılanını seçip yeniden dene.'));
        });
      if (mine !== token.current) return;
      audio.current = player;
      player.onended = () => {
        if (mine === token.current) stop();
      };
      await player.play();
      if (mine === token.current) setPlaying({ key, ms, token: mine, started: true });
    } catch (e) {
      if (mine !== token.current) return;
      stop();
      fail(e instanceof DOMException ? t('Ses çalınamadı. Yeniden dene.') : uiError(e));
    }
  };
  return { playing, stop, toggle };
}

/** Runs once, linearly, for the clip's length; reduced motion leaves a static line. */
function Progress({ ms }: { ms: number }) {
  const line = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const element = line.current;
    if (!element) return;
    element.style.transitionDuration = `${ms}ms`;
    void element.offsetWidth;
    element.style.transform = 'scaleX(1)';
  }, [ms]);
  return <i ref={line} className="personal-sound-progress" aria-hidden="true" />;
}
function PreviewParts({
  playKey,
  name,
  preview,
  onPlay,
}: {
  playKey: string;
  name: string;
  preview: Preview;
  onPlay(): void;
}) {
  const current = preview.playing?.key === playKey ? preview.playing : null;
  return (
    <>
      <IconButton
        label={current ? t('{name} sesini durdur', { name }) : t('{name} sesini dinle', { name })}
        onClick={onPlay}
      >
        {current ? <Square size={14} /> : <Play size={15} />}
      </IconButton>
      {current?.started && <Progress key={current.token} ms={current.ms} />}
    </>
  );
}

function Waveform({
  peaks,
  start,
  duration,
}: {
  peaks: Float32Array;
  start: number;
  duration: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current,
      context = element?.getContext('2d');
    if (!element || !context) return;
    const ratio = window.devicePixelRatio || 1,
      width = element.clientWidth || 420,
      height = element.clientHeight || 44;
    element.width = Math.round(width * ratio);
    element.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    const slot = width / peaks.length,
      from = start / duration,
      to = (start + MAX_SEC) / duration;
    peaks.forEach((peak, i) => {
      const position = (i + 0.5) / peaks.length,
        bar = Math.max(2, peak * (height - 8));
      context.fillStyle = position >= from && position <= to ? '#c5c0ff' : '#4d5564';
      context.fillRect(i * slot + slot * 0.2, (height - bar) / 2, Math.max(1, slot * 0.6), bar);
    });
  }, [peaks, start, duration]);
  return (
    <div className="personal-sound-wave">
      <canvas ref={canvas} aria-hidden="true" />
      <i
        style={{ left: `${(start / duration) * 100}%`, width: `${(MAX_SEC / duration) * 100}%` }}
      />
    </div>
  );
}

/** Decodes and trims on this device; only the processed canonical clip is uploaded. */
function UploadArea({
  profile,
  bridge,
  preview,
  epoch,
  onUploaded,
  onFailed,
}: {
  profile: PersonalSoundProfile;
  bridge: Bridge;
  preview: Preview;
  epoch: { current: number };
  onUploaded(sound: PersonalSound): Promise<void>;
  onFailed(): void;
}) {
  const picker = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<Draft | null>(null),
    [reading, setReading] = useState(false),
    [saving, setSaving] = useState(false),
    [problem, setProblem] = useState('');
  const mono = draft?.mono,
    rate = draft?.rate,
    start = draft?.start;
  const clip = useMemo(
    () => (mono && rate !== undefined && start !== undefined ? draftClip(mono, rate, start) : null),
    [mono, rate, start],
  );
  const full = profile.sounds.length >= PERSONAL_SOUND_LIMITS.maxSounds,
    playingDraft = preview.playing?.key === 'draft' ? preview.playing : null;
  if (!profile.uploads)
    return (
      <p className="ref-settings-note personal-sound-upload">
        {t('Sunucu yöneticisi ses yüklemeyi kapattı. Tayfa seslerinden birini seçebilirsin.')}
      </p>
    );
  const read = async (file: File) => {
    preview.stop();
    setProblem('');
    setDraft(null);
    if (file.size > PERSONAL_SOUND_LIMITS.maxSourceBytes) {
      setProblem(t('Bu dosya 20 MB’tan büyük. Daha küçük bir ses dosyası seç.'));
      return;
    }
    const captured = epoch.current;
    setReading(true);
    let context: AudioContext | null = null;
    try {
      // A decoded source costs 48 kHz float per channel, so long files stop before decoding.
      if ((await sourceSeconds(file)) > MAX_SOURCE_SEC) throw Error(tooLong);
      context = new AudioContext({ sampleRate: PERSONAL_SOUND_LIMITS.sampleRate });
      const buffer = await context.decodeAudioData(await file.arrayBuffer());
      if (!buffer.length || !buffer.numberOfChannels) throw Error(unreadable);
      if (buffer.duration > MAX_SOURCE_SEC) throw Error(tooLong);
      const decoded = monoOf(
        Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i)),
      );
      if (captured !== epoch.current) return;
      setDraft({
        mono: decoded,
        rate: buffer.sampleRate,
        duration: buffer.duration,
        peaks: peaksOf(decoded),
        start: 0,
        name:
          file.name
            .replace(/\.[^.]+$/, '')
            .trim()
            .slice(0, PERSONAL_SOUND_LIMITS.maxNameLength) || t('Sesim'),
        rights: false,
      });
    } catch (e) {
      if (captured === epoch.current)
        setProblem(e instanceof Error && e.message === tooLong ? tooLong : unreadable);
    } finally {
      await context?.close().catch(() => {});
      if (captured === epoch.current) setReading(false);
    }
  };
  const save = async () => {
    if (!draft || !clip || typeof clip === 'string') return;
    const captured = epoch.current;
    preview.stop();
    setSaving(true);
    setProblem('');
    try {
      const sound = await bridge.upload({
        name: draft.name.trim(),
        audio: toBase64(encodePersonalSoundWav(clip.samples)),
        rightsAccepted: true,
      });
      if (captured !== epoch.current) return;
      setDraft(null);
      await onUploaded(sound);
    } catch (e) {
      if (captured !== epoch.current) return;
      setProblem(uiError(e));
      onFailed();
    } finally {
      if (captured === epoch.current) setSaving(false);
    }
  };
  const ready = !!draft && typeof clip === 'object' && !!draft.name.trim() && draft.rights;
  return (
    <div className="personal-sound-upload">
      <input
        ref={picker}
        type="file"
        accept="audio/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void read(file);
        }}
      />
      <button
        className="button secondary"
        disabled={full || reading || saving}
        onClick={() => picker.current?.click()}
      >
        <Plus size={16} />
        {reading ? t('Ses okunuyor…') : t('Bilgisayardan ses seç')}
      </button>
      {full && (
        <p className="ref-settings-note">
          {t('En fazla {count} ses saklayabilirsin. Yeni ses için önce birini sil.', {
            count: PERSONAL_SOUND_LIMITS.maxSounds,
          })}
        </p>
      )}
      {draft && (
        <div className="personal-sound-draft">
          {draft.duration > MAX_SEC && (
            <>
              <Waveform peaks={draft.peaks} start={draft.start} duration={draft.duration} />
              <label className="field-label">
                {t('Başlangıç · {time}', { time: seconds(draft.start) })}
                <input
                  type="range"
                  aria-label={t('Başlangıç')}
                  aria-valuetext={seconds(draft.start)}
                  min={0}
                  max={Math.max(0, draft.duration - MAX_SEC)}
                  step={0.05}
                  value={draft.start}
                  disabled={saving}
                  onChange={(e) => {
                    preview.stop();
                    setDraft({ ...draft, start: Number(e.target.value) });
                  }}
                />
              </label>
            </>
          )}
          <div className="personal-sound-trial">
            <button
              className="button secondary"
              disabled={!clip || typeof clip === 'string' || saving}
              onClick={() => {
                if (!clip || typeof clip === 'string') return;
                void preview.toggle(
                  'draft',
                  () =>
                    URL.createObjectURL(
                      new Blob([encodePersonalSoundWav(clip.samples) as Uint8Array<ArrayBuffer>], {
                        type: 'audio/wav',
                      }),
                    ),
                  PERSONAL_SOUND_POLICY.personalGain,
                  clip.durationSec,
                  true,
                );
              }}
            >
              {playingDraft ? <Square size={14} /> : <Play size={15} />}
              {playingDraft ? t('Durdur') : t('Kesiti dinle')}
            </button>
            {clip && typeof clip === 'object' && (
              <span className="ref-settings-note">{seconds(clip.durationSec)}</span>
            )}
            {playingDraft?.started && <Progress key={playingDraft.token} ms={playingDraft.ms} />}
          </div>
          {/* Stays mounted: it changes while the start is dragged, so it must not interrupt. */}
          <p className="personal-sound-problem" aria-live="polite">
            {typeof clip === 'string' && clip}
          </p>
          <label className="field-label">
            {t('Ad')}
            <input
              value={draft.name}
              maxLength={PERSONAL_SOUND_LIMITS.maxNameLength}
              disabled={saving}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <label className="personal-sound-rights">
            <input
              type="checkbox"
              checked={draft.rights}
              disabled={saving}
              onChange={(e) => setDraft({ ...draft, rights: e.target.checked })}
            />
            {t(
              'Bu sesi kullanma hakkım var. Telifli müzik, başkasının sesi veya rahatsız edici içerik yüklemeyeceğim.',
            )}
          </label>
          <div className="button-row">
            <button
              className="text-button"
              disabled={saving}
              onClick={() => {
                preview.stop();
                setDraft(null);
                setProblem('');
              }}
            >
              {t('Vazgeç')}
            </button>
            <button
              className="button primary"
              disabled={!ready || saving || full}
              onClick={() => void save()}
            >
              {saving ? t('Kaydediliyor…') : t('Kaydet ve seç')}
            </button>
          </div>
        </div>
      )}
      {problem && (
        <p className="personal-sound-problem" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}

/** "Giriş sesi": the account's entrance and leave sound, stored by the access service. */
export function PersonalSoundSettings({ outputId, level }: { outputId: string; level: number }) {
  const bridge = window.rooms?.personalSounds;
  const signedIn = useCommunity((state) => !!state.user),
    account = useCommunity((state) => JSON.stringify([state.serverUrl, state.user?.id ?? null]));
  // Responses that started under another account (or an earlier session of it) are dropped.
  const epoch = useRef(0),
    seen = useRef(account);
  if (seen.current !== account) {
    seen.current = account;
    epoch.current++;
  }
  const [profile, setProfile] = useState<PersonalSoundProfile | null>(null),
    [loadError, setLoadError] = useState(''),
    [attempt, setAttempt] = useState(0),
    [slot, setSlot] = useState<Slot | null>(null),
    [error, setError] = useState(''),
    [status, setStatus] = useState(''),
    [confirming, setConfirming] = useState<string | null>(null),
    [removing, setRemoving] = useState(false);
  const confirmed = useRef<PersonalSoundAssign>({ enter: null, leave: null }),
    latest = useRef<PersonalSoundAssign>({ enter: null, leave: null }),
    picked = useRef<Slot>('enter'),
    refusals = useRef(0),
    queue = useRef<Promise<unknown>>(Promise.resolve()),
    cache = useRef(new Map<string, string>()),
    statusTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const preview = usePreview(outputId, level, setError),
    { stop } = preview;
  /** Takes the server's profile; picks that differ from `base` were not sent yet and stay. */
  const accept = (value: PersonalSoundProfile, base = confirmed.current) => {
    const keep = (event: Slot) =>
      latest.current[event] === base[event] ? value.assign[event] : latest.current[event];
    confirmed.current = value.assign;
    latest.current = { enter: keep('enter'), leave: keep('leave') };
    setProfile({ ...value, assign: latest.current });
  };
  useEffect(() => {
    const captured = epoch.current;
    queue.current = Promise.resolve();
    setProfile(null);
    setLoadError('');
    setError('');
    setStatus('');
    setSlot(null);
    setConfirming(null);
    setRemoving(false);
    if (!bridge || !signedIn) return;
    bridge.profile().then(
      (value) => {
        if (captured !== epoch.current) return;
        confirmed.current = latest.current = value.assign;
        setProfile(value);
      },
      (e) => {
        if (captured === epoch.current) setLoadError(uiError(e));
      },
    );
  }, [account, attempt, bridge, signedIn]);
  useEffect(() => {
    const urls = cache.current;
    return () => {
      stop();
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, [account, stop]);
  useEffect(() => () => clearTimeout(statusTimer.current), []);
  const cancelDelete = (id: string) => {
    setConfirming(null);
    focusSoon(`[data-delete-sound="${id}"]`);
  };
  useEffect(() => {
    if (!confirming) return;
    // The modal closes on Escape from a document capture listener; window capture runs first.
    const key = (event: KeyboardEvent) => {
      if (
        event.key !== 'Escape' ||
        !(event.target instanceof Element) ||
        !event.target.closest('.personal-sound-confirm')
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      cancelDelete(confirming);
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [confirming]);
  const fetchPreview = async (id: string) => {
    const cached = cache.current.get(id);
    if (cached) return cached;
    if (!bridge) throw Error(t('Giriş sesleri bu ortamda kullanılamıyor.'));
    const captured = epoch.current,
      audio = await bridge.preview(id);
    const url = URL.createObjectURL(
      new Blob([fromBase64(audio) as Uint8Array<ArrayBuffer>], { type: 'audio/wav' }),
    );
    const existing = cache.current.get(id);
    if (captured !== epoch.current || existing) {
      URL.revokeObjectURL(url);
      if (existing) return existing;
      throw Error(t('Oturum değişti.'));
    }
    cache.current.set(id, url);
    return url;
  };
  const listen = (key: string, event: Slot, id: string | null) => {
    if (!profile) return;
    const clip = clipOf(profile, id);
    setError('');
    void preview.toggle(
      key,
      id === null ? () => roomCueSource(event) : () => fetchPreview(id),
      clip.gain,
      clip.seconds,
    );
  };
  const flash = (message: string) => {
    clearTimeout(statusTimer.current);
    setStatus(message);
    statusTimer.current = setTimeout(() => setStatus(''), 4000);
  };
  /** Server changes run one at a time and in order, so a late response never undoes a newer one. */
  const serial = <T,>(task: () => Promise<T>) => {
    const run = queue.current.then(task);
    queue.current = run.catch(() => {});
    return run;
  };
  /** After a failed change this copy may be stale, e.g. a sound deleted on another device. */
  const refresh = async (captured: number) => {
    const value = await bridge?.profile().catch(() => null);
    if (value && captured === epoch.current) accept(value);
  };
  const resync = () => {
    const captured = epoch.current;
    void serial(() => refresh(captured));
  };
  /** Optimistic and saved at once; resolves false when the server refused it. */
  const choose = (event: Slot, id: string | null): Promise<boolean> => {
    if (!bridge) return Promise.resolve(false);
    if (latest.current[event] === id) return Promise.resolve(true);
    const captured = epoch.current,
      refused = refusals.current,
      next = { ...latest.current, [event]: id };
    latest.current = next;
    picked.current = event;
    setProfile((value) => value && { ...value, assign: next });
    setError('');
    setStatus('');
    return serial(async () => {
      // Picks made while an earlier request ran go out together; only the newest is sent.
      // A refusal in between rolled this pick back as well.
      const sending = latest.current;
      if (captured !== epoch.current || refused !== refusals.current) return false;
      if (same(sending, confirmed.current)) return true;
      try {
        const value = await bridge.assign(sending);
        if (captured !== epoch.current) return false;
        accept(value, sending);
        if (same(latest.current, value.assign)) flash(copy[picked.current].saved);
        return true;
      } catch (e) {
        if (captured !== epoch.current) return false;
        refusals.current++;
        const restored = (latest.current = confirmed.current);
        setProfile((value) => value && { ...value, assign: restored });
        setError(uiError(e));
        await refresh(captured);
        return false;
      }
    });
  };
  const uploaded = async (sound: PersonalSound) => {
    if (!slot) return;
    const event = slot,
      captured = epoch.current;
    setProfile(
      (value) =>
        value && {
          ...value,
          sounds: [...value.sounds.filter((item) => item.id !== sound.id), sound],
        },
    );
    const saved = choose(event, sound.id);
    focusSoon(`.personal-sound-pick[data-sound="${sound.id}"]`);
    if (!(await saved) && captured === epoch.current)
      setError(t('Ses kaydedildi ama seçilemedi. Listeden seçebilirsin.'));
  };
  const remove = (id: string) => {
    if (!bridge) return;
    const captured = epoch.current;
    setRemoving(true);
    setError('');
    void serial(async () => {
      if (captured !== epoch.current) return;
      try {
        const value = await bridge.remove(id);
        if (captured !== epoch.current) return;
        stop();
        const url = cache.current.get(id);
        if (url) URL.revokeObjectURL(url);
        cache.current.delete(id);
        accept(value);
        setConfirming(null);
        focusSoon(
          '.personal-sound-modal .personal-sound-pick[aria-pressed="true"]',
          '.personal-sound-modal .personal-sound-pick',
        );
      } catch (e) {
        if (captured !== epoch.current) return;
        setError(uiError(e));
        await refresh(captured);
      } finally {
        if (captured === epoch.current) setRemoving(false);
      }
    });
  };
  const close = useCallback(() => {
    stop();
    setSlot(null);
    setConfirming(null);
    setError('');
  }, [stop]);
  const quiet = level === 0 && (
    <p className="ref-settings-note">{t('Efekt ses düzeyi sıfırda; önizlemeleri duymazsın.')}</p>
  );
  const option = (event: Slot, id: string | null, name: string, duration: number, own = false) => {
    const selected = profile?.assign[event] === id,
      key = `option:${event}:${id ?? 'classic'}`;
    return (
      <li key={key} className={`personal-sound-option${selected ? ' selected' : ''}`}>
        {own && id && confirming === id ? (
          <div
            className="personal-sound-confirm"
            role="group"
            aria-label={t('{name} silinsin mi?', { name })}
          >
            <span>{t('{name} silinsin mi?', { name })}</span>
            <button className="button danger" disabled={removing} onClick={() => remove(id)}>
              {removing ? t('Siliniyor…') : t('Sil')}
            </button>
            <button
              className="button secondary"
              autoFocus
              disabled={removing}
              onClick={() => cancelDelete(id)}
            >
              {t('Vazgeç')}
            </button>
          </div>
        ) : (
          <>
            <button
              type="button"
              className="personal-sound-pick"
              aria-pressed={selected}
              data-sound={id ?? 'classic'}
              onClick={() => void choose(event, id)}
            >
              <span>{name}</span>
              <small>{id === null ? t('Klasik Tayfa sesi') : seconds(duration)}</small>
              {selected && <Check size={15} aria-hidden="true" />}
            </button>
            <PreviewParts
              playKey={key}
              name={name}
              preview={preview}
              onPlay={() => listen(key, event, id)}
            />
            {own && id && (
              <IconButton
                label={t('{name} sesini sil', { name })}
                data-delete-sound={id}
                onClick={() => setConfirming(id)}
              >
                <Trash2 size={15} />
              </IconButton>
            )}
          </>
        )}
      </li>
    );
  };
  return (
    <section className="personal-sounds">
      <h2>{t('Giriş ve çıkış sesin')}</h2>
      {!bridge ? (
        <p className="ref-settings-note">
          {t('Giriş sesleri masaüstü uygulamasında ve bir sunucuya bağlıyken kullanılabilir.')}
        </p>
      ) : !signedIn ? (
        <p className="ref-settings-note">
          {t('Giriş sesini seçmek için önce bir sunucuya giriş yap.')}
        </p>
      ) : loadError ? (
        <div className="ref-settings-callout warning personal-sound-retry" role="alert">
          <span>{loadError}</span>
          <button className="button secondary" onClick={() => setAttempt((value) => value + 1)}>
            {t('Yeniden dene')}
          </button>
        </div>
      ) : !profile ? (
        <p className="ref-settings-note" role="status">
          {t('Giriş seslerin yükleniyor…')}
        </p>
      ) : (
        <>
          <div className="ref-settings-grid personal-sound-rows">
            {(['enter', 'leave'] as const).map((event) => {
              const clip = clipOf(profile, profile.assign[event]);
              return (
                <div className="settings-row personal-sound-row" key={event}>
                  <div>
                    <h4>{copy[event].title}</h4>
                    <p>{copy[event].description}</p>
                  </div>
                  <div className="personal-sound-actions">
                    <span className="personal-sound-name" title={clip.name}>
                      {clip.name}
                    </span>
                    <PreviewParts
                      playKey={`row:${event}`}
                      name={clip.name}
                      preview={preview}
                      onPlay={() => listen(`row:${event}`, event, profile.assign[event])}
                    />
                    <button
                      className="button secondary"
                      aria-label={copy[event].change}
                      onClick={() => {
                        setError('');
                        setStatus('');
                        setSlot(event);
                      }}
                    >
                      {t('Değiştir')}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="ref-settings-note">
            {t('Seçimin hemen kaydedilir ve tüm cihazlarında geçerli olur.')}
          </p>
          <p className="ref-settings-note">
            {t(
              'Oda dolmasın diye başkalarının sesi kişi başına iki dakikada bir çalar. Hemen çıkıp girene ya da birkaç saniyede çıkana varsayılan ses çalar.',
            )}
          </p>
          <p className="ref-settings-note">
            {t(
              'En fazla 4 saniye. Herkesin sesi aynı seviyede duyulsun diye ses düzeyi otomatik ayarlanır.',
            )}
          </p>
          {quiet}
          {status && !slot && (
            <p className="personal-sound-status" role="status">
              {status}
            </p>
          )}
          {error && !slot && (
            <div className="ref-settings-callout error personal-sound-error" role="alert">
              {error}
            </div>
          )}
        </>
      )}
      {slot && profile && bridge && (
        <Modal title={copy[slot].picker} onClose={close} className="personal-sound-modal">
          <div className="personal-sound-group">
            <h3>{t('Varsayılan')}</h3>
            <ul className="personal-sound-options" aria-label={t('Varsayılan')}>
              {option(slot, null, t('Varsayılan'), CLASSIC_SEC)}
            </ul>
          </div>
          <div className="personal-sound-group">
            <h3>{t('Tayfa sesleri')}</h3>
            <ul className="personal-sound-options" aria-label={t('Tayfa sesleri')}>
              {profile.presets.map((preset) =>
                option(
                  slot,
                  preset.id,
                  personalSoundPresetName(preset.id, preset.name),
                  preset.durationSec,
                ),
              )}
            </ul>
          </div>
          <div className="personal-sound-group">
            <h3>{t('Senin seslerin')}</h3>
            {profile.sounds.length ? (
              <ul className="personal-sound-options" aria-label={t('Senin seslerin')}>
                {profile.sounds.map((sound) =>
                  option(slot, sound.id, sound.name, sound.durationSec, true),
                )}
              </ul>
            ) : (
              <p className="ref-settings-note">{t('Henüz ses yüklemedin.')}</p>
            )}
          </div>
          <UploadArea
            profile={profile}
            bridge={bridge}
            preview={preview}
            epoch={epoch}
            onUploaded={uploaded}
            onFailed={resync}
          />
          {quiet}
          {status && (
            <p className="personal-sound-status" role="status">
              {status}
            </p>
          )}
          {error && (
            <div className="ref-settings-callout error personal-sound-error" role="alert">
              {error}
            </div>
          )}
        </Modal>
      )}
    </section>
  );
}
