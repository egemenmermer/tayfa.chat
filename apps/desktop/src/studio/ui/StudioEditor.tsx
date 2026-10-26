import { useEffect, useState, type ReactNode } from 'react';
import { Focusable } from 'react-aria-components';
import { RiAlertLine, RiArrowLeftLine, RiEyeLine, RiRefreshLine } from '@remixicon/react';
import { MAX_PROJECT_NAME, type StudioProject } from '@rooms/studio';
import { Badge } from '@boardui/base/badge';
import { Button } from '@boardui/base/button';
import { Input } from '@boardui/base/input';
import { Tooltip, TooltipTrigger } from '@boardui/base/tooltip';
import type { StudioPresence } from '../../../../../packages/shared-contracts/src/studio';
import { t } from '../../i18n';
import { initials, presenceColorIndex, trackColor } from './music';
import type { StudioEditorModel } from './model';
import { STUDIO_TRACK_ROW_HEIGHT, TrackHeaders } from './TrackHeaders';
import { loopRegion, TransportBar, type LoopSetting } from './TransportBar';
import type { StudioTransport } from './transport';

/** What the arrangement/editor slot receives; ST-ui-b's editors render there. */
export interface StudioArrangementSlotProps {
  doc: StudioProject;
  readOnly: boolean;
  /** Track ids top to bottom, aligned with the header rows. */
  trackOrder: string[];
  rowHeight: number;
  /** Height of the header strip above the first row (the arrangement ruler goes there). */
  headerHeight: number;
}

export interface StudioEditorProps {
  model: StudioEditorModel;
  transport: StudioTransport;
  onBack(): void;
  /** Opens with the project name in edit mode (the list's "Yeniden adlandır"). */
  startRenaming?: boolean;
  /** The arrangement + editors region (ST-ui-b); a neutral placeholder until it is wired. */
  arrangement?: (slot: StudioArrangementSlotProps) => ReactNode;
  /** ST-ui-c's export control for the transport bar. */
  exportSlot?: ReactNode;
}

const typingTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

export function StudioEditor({
  model,
  transport,
  onBack,
  startRenaming,
  arrangement,
  exportSlot,
}: StudioEditorProps) {
  const doc = model.doc;
  const [loop, setLoop] = useState<LoopSetting>({ on: false, startBar: 1, endBar: 5 });
  const [metronome, setMetronome] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (doc) transport.setLoop(loopRegion(loop, doc));
  }, [transport, loop, doc?.timeSignature, doc]);
  useEffect(() => transport.setMetronome(metronome), [transport, metronome]);
  useEffect(() => () => transport.stop(), [transport]);

  const { undo, redo, readOnly } = model;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (readOnly || event.key.toLowerCase() !== 'z' || !(event.metaKey || event.ctrlKey)) return;
      if (event.altKey || typingTarget(event.target)) return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, readOnly]);

  if (!doc)
    return (
      <section className="flex min-h-0 flex-1 flex-col">
        <EditorHeader onBack={onBack} title={t('Proje')} />
        {model.status === 'error' ? (
          <div role="alert" className="m-6 flex flex-col items-start gap-3 rounded-xl border border-border-button-default bg-background-secondary-default p-5">
            <span className="flex items-center gap-2 text-headline-medium text-text-primary">
              <RiAlertLine className="size-5 text-foreground-icon-error" aria-hidden />
              {t('Proje açılamadı')}
            </span>
            <p className="text-body-regular text-text-secondary">
              {model.error ?? t('Bir şeyler ters gitti.')}
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" leadingIcon={RiRefreshLine} onClick={model.retry}>
                {t('Yeniden dene')}
              </Button>
              <Button variant="ghost" onClick={onBack}>
                {t('Projelere dön')}
              </Button>
            </div>
          </div>
        ) : (
          <div role="status" aria-label={t('Proje yükleniyor.')} className="flex flex-col gap-2 p-6">
            <div className="h-10 animate-pulse rounded-lg bg-background-secondary-default" />
            {[0, 1, 2, 3].map((row) => (
              <div key={row} className="h-[72px] animate-pulse rounded-lg bg-background-secondary-default" />
            ))}
          </div>
        )}
      </section>
    );

  const order = doc.trackOrder.filter((id) => doc.tracks[id]);
  const banner = readOnly
    ? t('Bu projeyi düzenleme iznin yok. Dinleyebilir ve izleyebilirsin.')
    : null;
  const failure = model.error ?? notice;

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label={doc.name}>
      <EditorHeader
        onBack={onBack}
        title={doc.name}
        rename={
          readOnly
            ? undefined
            : (name) => model.dispatch([{ op: 'project.set', field: 'name', value: name }])
        }
        startRenaming={startRenaming && !readOnly}
        status={<SyncBadge model={model} />}
      />
      <TransportBar
        doc={doc}
        readOnly={readOnly}
        transport={transport}
        dispatch={model.dispatch}
        canUndo={model.canUndo}
        canRedo={model.canRedo}
        undo={model.undo}
        redo={model.redo}
        loop={loop}
        onLoopChange={setLoop}
        metronome={metronome}
        onMetronomeChange={setMetronome}
        onError={setNotice}
        exportSlot={exportSlot}
        presence={<PresenceChips presence={model.presence} />}
      />
      {banner && (
        <p role="status" className="flex items-center gap-2 border-b border-separator-border bg-background-inner-default px-4 py-2 text-body-medium text-text-secondary">
          <RiEyeLine className="size-4 shrink-0 text-foreground-icon-secondary" aria-hidden />
          {banner}
        </p>
      )}
      {failure && (
        <p role="alert" className="flex items-center gap-2 border-b border-separator-border bg-background-tertiary-error px-4 py-2 text-body-medium text-text-error-primary">
          <RiAlertLine className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">{failure}</span>
          <Button
            size="xs"
            variant="secondary"
            onClick={() => {
              setNotice(null);
              model.clearError();
            }}
          >
            {t('Kapat')}
          </Button>
        </p>
      )}
      <div className="flex min-h-0 flex-1 overflow-auto">
        <div className="sticky start-0 z-10 w-[clamp(260px,32vw,320px)] shrink-0 self-start border-e border-separator-border bg-background-secondary-default">
          <TrackHeaders doc={doc} readOnly={readOnly} dispatch={model.dispatch} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col" data-studio-slot="arrangement">
          {arrangement ? (
            arrangement({
              doc,
              readOnly,
              trackOrder: order,
              rowHeight: STUDIO_TRACK_ROW_HEIGHT,
              headerHeight: 40,
            })
          ) : (
            <ArrangementPlaceholder rows={order.length} />
          )}
        </div>
      </div>
    </section>
  );
}

function EditorHeader({
  onBack,
  title,
  rename,
  startRenaming,
  status,
}: {
  onBack(): void;
  title: string;
  rename?: (name: string) => void;
  startRenaming?: boolean;
  status?: ReactNode;
}) {
  const [editing, setEditing] = useState(!!startRenaming);
  const [text, setText] = useState(title);
  const finish = (save: boolean) => {
    setEditing(false);
    const next = text.trim().slice(0, MAX_PROJECT_NAME);
    if (save && next && next !== title) rename?.(next);
  };
  return (
    <header className="flex min-h-12 items-center gap-2 border-b border-separator-border px-3 py-1.5">
      <Button size="small" variant="secondary" leadingIcon={RiArrowLeftLine} onClick={onBack}>
        {t('Projeler')}
      </Button>
      {editing && rename ? (
        <Input
          size="small"
          autoFocus
          aria-label={t('Proje adı')}
          className="min-w-0 max-w-[360px] flex-1"
          value={text}
          maxLength={MAX_PROJECT_NAME}
          onChange={setText}
          onBlur={() => finish(true)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') finish(true);
            if (event.key === 'Escape') finish(false);
          }}
        />
      ) : rename ? (
        <button
          type="button"
          className="min-w-0 truncate rounded-md px-1.5 py-0.5 text-start text-headline-semibold text-text-primary hover:bg-background-primary-hover"
          title={t('{name} · yeniden adlandırmak için tıkla', { name: title })}
          aria-label={t('{name} adını değiştir', { name: title })}
          onClick={() => {
            setText(title);
            setEditing(true);
          }}
        >
          {title}
        </button>
      ) : (
        <h1 className="min-w-0 truncate px-1.5 text-headline-semibold text-text-primary">{title}</h1>
      )}
      <span className="flex-1" />
      {status}
    </header>
  );
}

function SyncBadge({ model }: { model: StudioEditorModel }) {
  const [label, color] =
    model.status === 'offline'
      ? [t('Çevrimdışı · yeniden bağlanıyor'), 'neutral' as const]
      : model.status === 'connecting'
        ? [t('Bağlanıyor…'), 'neutral' as const]
        : model.pending > 0
          ? [t('Kaydediliyor…'), 'neutral' as const]
          : model.status === 'live'
            ? [t('Kaydedildi'), 'primary' as const]
            : [null, 'neutral' as const];
  if (!label) return null;
  return (
    <Badge color={color} role="status" className="px-1.5 py-0.5">
      {label}
    </Badge>
  );
}

/** Avatars of the other members in the project, ringed in their colour. */
export function PresenceChips({ presence }: { presence: StudioPresence[] }) {
  if (!presence.length) return null;
  const shown = presence.slice(0, 4);
  return (
    <ul
      className="flex items-center -space-x-1.5"
      aria-label={t('Projede {count} kişi daha var', { count: presence.length })}
    >
      {shown.map((member) => (
        <li key={member.userId}>
          <TooltipTrigger>
            <Focusable>
              <span
                tabIndex={0}
                role="img"
                aria-label={member.displayName}
                className="flex size-7 items-center justify-center rounded-full border-2 bg-background-primary-default text-caption-2-semibold text-text-primary"
                style={{ borderColor: trackColor(presenceColorIndex(member.userId)) }}
              >
                {initials(member.displayName)}
              </span>
            </Focusable>
            <Tooltip placement="bottom">{member.displayName}</Tooltip>
          </TooltipTrigger>
        </li>
      ))}
      {presence.length > shown.length && (
        <li className="flex size-7 items-center justify-center rounded-full border-2 border-border-button-default bg-background-tertiary-default text-caption-2-semibold text-text-secondary">
          +{presence.length - shown.length}
        </li>
      )}
    </ul>
  );
}

function ArrangementPlaceholder({ rows }: { rows: number }) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center border-b border-separator-border px-3 text-caption-1-medium text-text-tertiary">
        {t('Düzenleme alanı')}
      </div>
      <div
        className="flex flex-1 items-center justify-center p-6 text-center text-body-regular text-text-tertiary"
        style={{ minHeight: Math.max(1, rows) * STUDIO_TRACK_ROW_HEIGHT }}
      >
        {t('Zaman çizelgesi, piyano rulosu ve davul ızgarası burada açılacak.')}
      </div>
    </div>
  );
}
