import { useEffect, useRef, useState, type Key } from 'react';
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import { RiChat3Line, RiDownloadLine, RiSaveLine } from '@remixicon/react';
import type { StudioProject } from '@rooms/studio';
import { Button } from '@boardui/base/button';
import { Input } from '@boardui/base/input';
import { SegmentedControl, SegmentedControlItem } from '@boardui/base/segmented-control';
import { t } from '../../i18n';
import type { LoopRegion } from '../engine/schedule';
import { studioErrorMessage } from '../errors';
import { Explained } from './Explained';
import type { StudioExporter } from './transport';

/** The chat attachment cap the composer and main enforce (the server may allow less; main then explains). */
export const STUDIO_SHARE_LIMIT_BYTES = 25 * 1024 * 1024;

/** Where an exported song can go. `share` is absent when this client cannot post to the room's chat. */
export interface StudioExportApi {
  /** Resolves false when the user cancels the save dialog. */
  save(fileName: string, wav: Uint8Array): Promise<boolean>;
  share?(roomId: string, fileName: string, wav: Uint8Array, message: string): Promise<void>;
}

type Range = 'song' | 'loop';
type Phase =
  | { kind: 'idle' }
  | { kind: 'rendering'; progress: number; then: 'save' | 'share' }
  | { kind: 'busy'; label: string }
  | { kind: 'done'; message: string }
  | { kind: 'error'; message: string };

const megabytes = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1);

/** `name` as a file name stem: no path or reserved characters, at most 80 characters. */
export function exportFileStem(name: string): string {
  const stem = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 80)
    .trim();
  return stem || 'tayfa-studio';
}

export interface StudioExportControlProps {
  doc: StudioProject;
  roomId: string;
  loop: LoopRegion | null;
  exporter?: StudioExporter;
  api: StudioExportApi;
}

/** "Dışa aktar" in the transport bar and its dialog: range, file name, render with progress, save or share. */
export function StudioExportControl({ doc, roomId, loop, exporter, api }: StudioExportControlProps) {
  const [open, setOpen] = useState(false);
  const notes = Object.keys(doc.notes).length;
  const reason = !exporter
    ? t('Dışa aktarma bu görünümde kullanılamıyor.')
    : !notes
      ? t('Dışa aktarılacak nota yok. Önce bir klibe nota ekle.')
      : null;
  return (
    <>
      <Explained reason={reason}>
        <Button
          size="small"
          variant="secondary"
          leadingIcon={RiDownloadLine}
          onClick={() => setOpen(true)}
        >
          {t('Dışa aktar')}
        </Button>
      </Explained>
      {open && exporter ? (
        <ExportDialog
          doc={doc}
          roomId={roomId}
          loop={loop}
          exporter={exporter}
          api={api}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function ExportDialog({
  doc,
  roomId,
  loop,
  exporter,
  api,
  onClose,
}: Required<Omit<StudioExportControlProps, 'exporter'>> & {
  exporter: StudioExporter;
  loop: LoopRegion | null;
  onClose(): void;
}) {
  const [range, setRange] = useState<Range>(loop ? 'loop' : 'song');
  const [stem, setStem] = useState(() => exportFileStem(doc.name));
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const abort = useRef<AbortController | null>(null);
  // The last render, reused while the document and range stay the same (save, then share).
  const cache = useRef<{ key: string; doc: StudioProject; wav: Uint8Array } | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const working = phase.kind === 'rendering' || phase.kind === 'busy';
  const region = range === 'loop' && loop ? loop : null;
  const fileName = `${exportFileStem(stem)}.wav`;

  const render = async (then: 'save' | 'share'): Promise<Uint8Array | null> => {
    const key = region ? `${region.startBeat}-${region.endBeat}` : 'song';
    if (cache.current && cache.current.key === key && cache.current.doc === doc)
      return cache.current.wav;
    const controller = new AbortController();
    abort.current = controller;
    setPhase({ kind: 'rendering', progress: 0, then });
    try {
      const { wav } = await exporter(doc, {
        ...(region ? { fromBeat: region.startBeat, toBeat: region.endBeat } : {}),
        signal: controller.signal,
        onProgress: (progress) => {
          if (!controller.signal.aborted) setPhase({ kind: 'rendering', progress, then });
        },
      });
      cache.current = { key, doc, wav };
      return wav;
    } catch (error) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError'))
        setPhase({ kind: 'idle' });
      else setPhase({ kind: 'error', message: studioErrorMessage(error) });
      return null;
    } finally {
      if (abort.current === controller) abort.current = null;
    }
  };

  const save = async () => {
    const wav = await render('save');
    if (!wav) return;
    setPhase({ kind: 'busy', label: t('Kaydediliyor…') });
    try {
      const saved = await api.save(fileName, wav);
      setPhase(
        saved
          ? { kind: 'done', message: t('{file} kaydedildi.', { file: fileName }) }
          : { kind: 'idle' },
      );
    } catch (error) {
      setPhase({ kind: 'error', message: studioErrorMessage(error) });
    }
  };

  const share = async () => {
    if (!api.share) return;
    const wav = await render('share');
    if (!wav) return;
    if (wav.byteLength > STUDIO_SHARE_LIMIT_BYTES) {
      setPhase({
        kind: 'error',
        message: t(
          'Şarkı {size} MB; sohbete en fazla 25 MB eklenebilir. Daha kısa bir aralık seç ya da dosyayı kaydet.',
          { size: megabytes(wav.byteLength) },
        ),
      });
      return;
    }
    setPhase({ kind: 'busy', label: t('Sohbete gönderiliyor…') });
    try {
      await api.share(
        roomId,
        fileName,
        wav,
        t('Stüdyo’dan yeni bir parça: {name}', { name: doc.name }),
      );
      setPhase({ kind: 'done', message: t('Şarkı odanın sohbetine gönderildi.') });
    } catch (error) {
      setPhase({ kind: 'error', message: studioErrorMessage(error) });
    }
  };

  const shareReason = !api.share
    ? t('Bu odanın sohbetine dosya gönderemiyorsun.')
    : working
      ? t('Önce bu işlem bitsin.')
      : null;

  return (
    <ModalOverlay
      isOpen
      isDismissable={!working}
      onOpenChange={(next) => {
        if (!next && !working) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-background-full/80 p-4"
    >
      <Modal className="w-full max-w-[440px] rounded-2xl border border-border-button-default bg-background-primary-default shadow-lg outline-none">
        <Dialog className="flex flex-col gap-4 p-5 outline-none" aria-label={t('Şarkıyı dışa aktar')}>
          <Heading slot="title" className="text-headline-semibold text-text-primary">
            {t('Şarkıyı dışa aktar')}
          </Heading>
          <div className="flex flex-col gap-1.5">
            <span className="text-caption-1-semibold text-text-secondary">{t('Aralık')}</span>
            <SegmentedControl
              aria-label={t('Aralık')}
              selectedKeys={[range]}
              disabledKeys={loop && !working ? [] : working ? ['song', 'loop'] : ['loop']}
              onSelectionChange={(keys: Set<Key>) => {
                const next = [...keys][0];
                if (next === 'song' || next === 'loop') setRange(next);
              }}
            >
              <SegmentedControlItem id="song">{t('Tüm şarkı')}</SegmentedControlItem>
              <SegmentedControlItem id="loop">{t('Döngü aralığı')}</SegmentedControlItem>
            </SegmentedControl>
            {!loop ? (
              <span className="text-caption-1-regular text-text-tertiary">
                {t('Döngü aralığını dışa aktarmak için çalma çubuğunda döngüyü aç.')}
              </span>
            ) : null}
          </div>
          <Input
            size="small"
            label={t('Dosya adı')}
            hint={t('.wav olarak kaydedilir (16 bit, 44,1 kHz).')}
            value={stem}
            maxLength={80}
            isDisabled={working}
            onChange={setStem}
          />
          {phase.kind === 'rendering' ? (
            <div className="flex flex-col gap-1.5" role="status">
              <div className="flex items-center justify-between text-caption-1-medium text-text-secondary">
                <span>{t('Şarkı hazırlanıyor…')}</span>
                <span className="tabular-nums">{Math.round(phase.progress * 100)}%</span>
              </div>
              <div
                role="progressbar"
                aria-label={t('Dışa aktarma ilerlemesi')}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(phase.progress * 100)}
                className="h-1.5 overflow-hidden rounded-full bg-background-tertiary-default"
              >
                <div
                  className="h-full rounded-full bg-accent-500 transition-[width]"
                  style={{ width: `${Math.round(phase.progress * 100)}%` }}
                />
              </div>
            </div>
          ) : phase.kind === 'busy' ? (
            <p role="status" className="text-body-regular text-text-secondary">
              {phase.label}
            </p>
          ) : phase.kind === 'done' ? (
            <p role="status" className="text-body-regular text-text-accent">
              {phase.message}
            </p>
          ) : phase.kind === 'error' ? (
            <p role="alert" className="text-body-regular text-text-error-primary">
              {phase.message}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {phase.kind === 'rendering' ? (
              <Button size="small" variant="ghost" onClick={() => abort.current?.abort()}>
                {t('İptal')}
              </Button>
            ) : (
              <Button size="small" variant="ghost" disabled={working} onClick={onClose}>
                {t('Kapat')}
              </Button>
            )}
            <Explained reason={shareReason} placement="top">
              <Button
                size="small"
                variant="secondary"
                leadingIcon={RiChat3Line}
                onClick={() => void share()}
              >
                {t('Sohbete paylaş')}
              </Button>
            </Explained>
            <Button
              size="small"
              variant="primary"
              leadingIcon={RiSaveLine}
              disabled={working}
              onClick={() => void save()}
            >
              {t('Kaydet')}
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
