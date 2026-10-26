import { useCallback, useEffect, useState } from 'react';
import { Focusable } from 'react-aria-components';
import {
  RiAddLine,
  RiAlertLine,
  RiDeleteBinLine,
  RiEditLine,
  RiFolderMusicLine,
  RiMore2Fill,
  RiRefreshLine,
} from '@remixicon/react';
import { MAX_PROJECTS_PER_ROOM, type StudioTemplateId } from '@rooms/studio';
import { Button } from '@boardui/base/button';
import { Dropdown, DropdownItem, DropdownPopover, DropdownTrigger } from '@boardui/base/dropdown';
import { Input } from '@boardui/base/input';
import { SegmentedControl, SegmentedControlItem } from '@boardui/base/segmented-control';
import { Tooltip, TooltipTrigger } from '@boardui/base/tooltip';
import type {
  StudioProjectList,
  StudioProjectSummary,
} from '../../../../../packages/shared-contracts/src/studio';
import { t } from '../../i18n';
import { relativeTime } from './music';
import type { StudioNameOf, StudioProjectsApi } from './model';

type Load =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; list: StudioProjectList };

const errorText = (error: unknown) =>
  error instanceof Error && error.message ? error.message : t('Bir şeyler ters gitti.');

export interface ProjectListProps {
  roomId: string;
  roomName: string;
  api: StudioProjectsApi;
  selfId: string | null;
  nameOf: StudioNameOf;
  /** `rename` opens the project with its name field in edit mode. */
  onOpen(projectId: string, options?: { rename?: boolean }): void;
  now?: () => number;
}

/** The room's Studio projects: create from a template, open, rename (in the editor) and delete. */
export function ProjectList({
  roomId,
  roomName,
  api,
  selfId,
  nameOf,
  onOpen,
  now = Date.now,
}: ProjectListProps) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const refresh = useCallback(() => {
    let current = true;
    setLoad({ state: 'loading' });
    api.list(roomId).then(
      (list) => current && setLoad({ state: 'ready', list }),
      (error) => current && setLoad({ state: 'error', message: errorText(error) }),
    );
    return () => {
      current = false;
    };
  }, [api, roomId]);
  useEffect(() => refresh(), [refresh]);

  const list = load.state === 'ready' ? load.list : null;
  const projects = list
    ? [...list.projects].sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name))
    : [];
  const canCreate = !!list?.access.canCreate;
  const full = projects.length >= MAX_PROJECTS_PER_ROOM;
  const createBlocked = !list
    ? t('Projeler yükleniyor.')
    : !canCreate
      ? t('Bu odada Stüdyo projesi oluşturma iznin yok.')
      : full
        ? t('Bu odadaki proje sınırına ulaşıldı. Kullanılmayan bir projeyi silip yeniden dene.')
        : null;

  return (
    <section
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-6"
      aria-labelledby="studio-list-title"
    >
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h1 id="studio-list-title" className="text-title-3-semibold text-text-primary">
            {t('Stüdyo')}
          </h1>
          <p className="truncate text-body-regular text-text-secondary" title={roomName}>
            {t('{room} odasının müzik projeleri. Herkes aynı projede birlikte çalışır.', {
              room: roomName,
            })}
          </p>
        </div>
        {createBlocked ? (
          <TooltipTrigger>
            <Focusable>
              <Button aria-disabled leadingIcon={RiAddLine}>
                {t('Yeni proje')}
              </Button>
            </Focusable>
            <Tooltip placement="bottom">{createBlocked}</Tooltip>
          </TooltipTrigger>
        ) : (
          <Button leadingIcon={RiAddLine} onClick={() => setCreating(true)} disabled={creating}>
            {t('Yeni proje')}
          </Button>
        )}
      </header>

      {notice && (
        <p
          role="alert"
          className="flex items-center gap-2 rounded-lg bg-background-tertiary-error px-3 py-2 text-body-medium text-text-error-primary"
        >
          <RiAlertLine className="size-4 shrink-0" aria-hidden />
          <span className="flex-1">{notice}</span>
          <Button size="xs" variant="secondary" onClick={() => setNotice(null)}>
            {t('Kapat')}
          </Button>
        </p>
      )}

      {creating && list && (
        <CreateProject
          onCancel={() => setCreating(false)}
          onCreate={async (input) => {
            const { project } = await api.create(roomId, input);
            setCreating(false);
            onOpen(project.id);
          }}
        />
      )}

      {load.state === 'loading' && (
        <div role="status" className="flex flex-col gap-2" aria-label={t('Projeler yükleniyor.')}>
          {[0, 1, 2].map((row) => (
            <div
              key={row}
              className="h-16 animate-pulse rounded-xl bg-background-secondary-default"
            />
          ))}
        </div>
      )}

      {load.state === 'error' && (
        <div
          role="alert"
          className="flex flex-col items-start gap-3 rounded-xl border border-border-button-default bg-background-secondary-default p-5"
        >
          <span className="flex items-center gap-2 text-headline-medium text-text-primary">
            <RiAlertLine className="size-5 text-foreground-icon-error" aria-hidden />
            {t('Projeler yüklenemedi')}
          </span>
          <p className="text-body-regular text-text-secondary">{load.message}</p>
          <Button variant="secondary" leadingIcon={RiRefreshLine} onClick={refresh}>
            {t('Yeniden dene')}
          </Button>
        </div>
      )}

      {list && !projects.length && !creating && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border-button-default px-6 py-10 text-center">
          <RiFolderMusicLine className="size-8 text-foreground-icon-tertiary" aria-hidden />
          <h2 className="text-headline-semibold text-text-primary">{t('Henüz proje yok')}</h2>
          <p className="max-w-[420px] text-body-regular text-text-secondary">
            {canCreate
              ? t(
                  'Boş bir projeyle ya da hazır davul ve bas kalıbıyla başla. Odadaki herkes katılıp parça ekleyebilir.',
                )
              : t(
                  'Bu odada henüz proje yok. Proje oluşturma izni olan biri başlattığında burada görünür.',
                )}
          </p>
          {canCreate && (
            <Button leadingIcon={RiAddLine} onClick={() => setCreating(true)}>
              {t('İlk projeyi oluştur')}
            </Button>
          )}
        </div>
      )}

      {list && projects.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label={t('Projeler')}>
          {projects.map((project) => (
            <ProjectRow
              key={project.id}
              project={project}
              canDelete={canCreate || project.createdBy === selfId}
              creator={
                project.createdBy === selfId
                  ? t('Sen')
                  : (nameOf(project.createdBy) ?? t('Bir üye'))
              }
              updated={relativeTime(project.updatedAt, now())}
              onOpen={(rename) => onOpen(project.id, { rename })}
              onDelete={async () => {
                try {
                  await api.remove(roomId, project.id);
                  setNotice(null);
                  refresh();
                } catch (error) {
                  setNotice(errorText(error));
                }
              }}
            />
          ))}
        </ul>
      )}
      {list && !canCreate && projects.length > 0 && (
        <p className="text-caption-1-regular text-text-tertiary">
          {t('Bu odada proje oluşturma iznin yok; mevcut projeleri açıp dinleyebilirsin.')}
        </p>
      )}
    </section>
  );
}

function CreateProject({
  onCancel,
  onCreate,
}: {
  onCancel(): void;
  onCreate(input: { name: string; template: StudioTemplateId }): Promise<void>;
}) {
  const [name, setName] = useState(() => t('Yeni proje'));
  const [template, setTemplate] = useState<StudioTemplateId>('drums-bass');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = name.trim();
  const submit = async () => {
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate({ name: trimmed, template });
    } catch (failure) {
      setError(errorText(failure));
      setBusy(false);
    }
  };
  return (
    <form
      className="flex flex-col gap-4 rounded-xl border border-border-button-default bg-background-secondary-default p-4"
      aria-label={t('Yeni proje')}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="flex flex-wrap items-end gap-4">
        <Input
          className="min-w-[220px] flex-1"
          label={t('Proje adı')}
          value={name}
          onChange={setName}
          maxLength={80}
          autoFocus
          isInvalid={!trimmed}
          hint={!trimmed ? t('Projeye bir ad ver.') : undefined}
        />
        <div className="flex flex-col gap-1.5">
          <span id="studio-template-label" className="text-caption-1-medium text-text-secondary">
            {t('Başlangıç şablonu')}
          </span>
          <SegmentedControl
            aria-labelledby="studio-template-label"
            selectedKeys={[template]}
            onSelectionChange={(keys) => {
              const next = [...keys][0];
              if (next === 'empty' || next === 'drums-bass') setTemplate(next);
            }}
          >
            <SegmentedControlItem id="empty">{t('Boş proje')}</SegmentedControlItem>
            <SegmentedControlItem id="drums-bass">{t('Davul + bas')}</SegmentedControlItem>
          </SegmentedControl>
        </div>
      </div>
      <p className="text-caption-1-regular text-text-tertiary">
        {template === 'empty'
          ? t('Boş bir proje: 120 BPM, 4/4. Parçaları sen eklersin.')
          : t('Dört ölçülük bir davul ritmi ve bas hattıyla başlar.')}
      </p>
      {error && (
        <p role="alert" className="text-body-medium text-text-error-primary">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
          {t('Vazgeç')}
        </Button>
        <Button type="submit" disabled={!trimmed || busy}>
          {busy ? t('Oluşturuluyor…') : t('Oluştur')}
        </Button>
      </div>
    </form>
  );
}

function ProjectRow({
  project,
  canDelete,
  creator,
  updated,
  onOpen,
  onDelete,
}: {
  project: StudioProjectSummary;
  canDelete: boolean;
  creator: string;
  updated: string;
  onOpen(rename?: boolean): void;
  onDelete(): Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-xl border border-border-button-default bg-background-secondary-default px-4 py-3">
      <button
        type="button"
        className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-start"
        onClick={() => onOpen()}
      >
        <span
          className="w-full truncate text-headline-semibold text-text-primary"
          title={project.name}
        >
          {project.name}
        </span>
        <span className="text-caption-1-regular text-text-secondary">
          {t('{tempo} BPM · {tracks} parça · {updated} değişti · Oluşturan: {creator}', {
            tempo: project.tempo,
            tracks: project.tracks,
            updated,
            creator,
          })}
        </span>
      </button>
      {confirming ? (
        <div className="flex items-center gap-2" role="group" aria-label={t('Silmeyi onayla')}>
          <span className="text-body-medium text-text-secondary">
            {t('Proje herkes için silinsin mi?')}
          </span>
          <Button
            size="small"
            variant="secondary"
            onClick={() => setConfirming(false)}
            disabled={deleting}
          >
            {t('Vazgeç')}
          </Button>
          <Button
            size="small"
            variant="danger"
            disabled={deleting}
            onClick={() => {
              setDeleting(true);
              void onDelete().finally(() => {
                setDeleting(false);
                setConfirming(false);
              });
            }}
          >
            {t('Sil')}
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Button size="small" variant="secondary" onClick={() => onOpen()}>
            {t('Aç')}
          </Button>
          <Dropdown isOpen={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownTrigger
              aria-label={t('{name} için diğer işlemler', { name: project.name })}
              className="flex size-8 items-center justify-center rounded-lg border border-border-button-default bg-background-primary-default hover:bg-background-primary-hover"
            >
              <RiMore2Fill className="size-4 text-foreground-icon-secondary" aria-hidden />
            </DropdownTrigger>
            <DropdownPopover aria-label={project.name} placement="bottom end">
              <DropdownItem
                onSelect={() => {
                  setMenuOpen(false);
                  onOpen(true);
                }}
              >
                <RiEditLine className="size-4 text-foreground-icon-secondary" aria-hidden />
                <span className="text-body-medium">{t('Yeniden adlandır')}</span>
              </DropdownItem>
              {canDelete ? (
                <DropdownItem
                  onSelect={() => {
                    setMenuOpen(false);
                    setConfirming(true);
                  }}
                >
                  <RiDeleteBinLine className="size-4 text-foreground-icon-error" aria-hidden />
                  <span className="text-body-medium text-text-destructive">{t('Sil')}</span>
                </DropdownItem>
              ) : (
                <p className="max-w-[240px] px-2 py-1.5 text-caption-1-regular text-text-tertiary">
                  {t('Bu projeyi yalnızca oluşturan kişi ya da oda yöneticisi silebilir.')}
                </p>
              )}
            </DropdownPopover>
          </Dropdown>
        </div>
      )}
    </li>
  );
}
