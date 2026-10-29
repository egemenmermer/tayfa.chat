import './reference-community-settings.css';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Modal } from '@rooms/design';
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Check,
  Copy,
  Hash,
  Home,
  Link,
  Lock,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  TriangleAlert,
  Users,
  Volume2,
  Bot,
  Film,
} from 'lucide-react';
import type {
  SocialChannel,
  SocialInvite,
  SocialMember,
  SocialSpace,
  SocialUser,
} from '@rooms/social';
import { VoiceAvatar } from './VoiceAvatar';
import { InviteLinkCard, inviteLinkFor } from './InviteLinkCard';
import { useCommunity } from './community';
import { locale, t, uiError } from './i18n';

/** These components receive authorized projections and operations from the native adapter owner. */
export interface CommunityOperationBoundary {
  fixture?: boolean;
}
const fixtureActive = (boundary: CommunityOperationBoundary) =>
  !!boundary.fixture ||
  (import.meta.env.DEV && new URLSearchParams(location.search).has('fixture'));
const fixtureReason = t('Yerel görsel örnekte gerçek hesap işlemi kapalı.');
function useOperation(scope: string, boundary: CommunityOperationBoundary) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const generation = useRef(0),
    mounted = useRef(true),
    pending = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, []);
  useEffect(() => {
    generation.current++;
    pending.current = false;
    setBusy(false);
    setError('');
  }, [scope]);
  async function run<T>(operation: () => Promise<T>, done: (value: T) => void) {
    if (pending.current || busy || fixtureActive(boundary)) return;
    pending.current = true;
    const epoch = generation.current;
    setBusy(true);
    setError('');
    try {
      const value = await operation();
      if (mounted.current && generation.current === epoch) done(value);
    } catch (failure) {
      if (mounted.current && generation.current === epoch) setError(uiError(failure));
    } finally {
      if (mounted.current && generation.current === epoch) {
        pending.current = false;
        setBusy(false);
      }
    }
  }
  return { busy, error, run, clear: () => setError(''), blocked: fixtureActive(boundary) };
}
function Notice({
  children,
  kind = 'info',
}: {
  children: ReactNode;
  kind?: 'info' | 'error' | 'success';
}) {
  return (
    <div className={`rcs-notice ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}
function ErrorNotice({ error }: { error: string }) {
  return error ? <Notice kind="error">{error}</Notice> : null;
}
const validName = (name: string, max = 32) =>
  !!name.trim() && name.trim().length <= max && !/[\x00-\x1f\x7f]/.test(name);

export interface CommunityEditorProps extends CommunityOperationBoundary {
  mode: 'create' | 'edit';
  space?: SocialSpace;
  description?: string;
  inviteOnly?: boolean;
  referenceDraftName?: string;
  /** Explicit local reference projection; ignored outside DEV or without fixture=true. */
  referenceCreated?: { name: string };
  canEdit?: boolean;
  onSave?(name: string): Promise<SocialSpace>;
  onClose(): void;
  onSaved?(space: SocialSpace): void;
}
export function CommunityEditor(props: CommunityEditorProps) {
  const { mode, description, inviteOnly, onSave, onClose, onSaved } = props;
  // Creating never edits the open community. Ignoring it also keeps the finished state when the
  // app opens the new community, so the form cannot come back and create a second one.
  const space = mode === 'edit' ? props.space : undefined;
  const referenceDraftName =
    import.meta.env.DEV && props.fixture === true && mode === 'create'
      ? props.referenceDraftName
      : undefined;
  const [name, setName] = useState(space?.name ?? referenceDraftName ?? ''),
    [created, setCreated] = useState<SocialSpace | null>(null);
  const referenceCreated =
    import.meta.env.DEV && props.fixture === true && mode === 'create'
      ? props.referenceCreated
      : undefined;
  const op = useOperation(`${mode}:${space?.id ?? 'new'}`, props);
  useEffect(() => {
    setName(space?.name ?? referenceDraftName ?? '');
    setCreated(null);
  }, [mode, space?.id, referenceDraftName]);
  const reason = op.blocked
    ? fixtureReason
    : !onSave
      ? t('Topluluk oluşturmak ve düzenlemek için önce sunucuna bağlan.')
      : mode === 'edit' && !props.canEdit
        ? t('Topluluk düzenleme yetkisi gerekli.')
        : '';
  const submit = () => {
    if (!reason && validName(name, 32) && onSave)
      void op.run(
        () => onSave(name.trim()),
        (result) => {
          onSaved?.(result);
          if (mode === 'create') setCreated(result);
          else onClose();
        },
      );
  };
  return (
    <Modal
      title={
        referenceCreated || created
          ? t('Topluluğun hazır')
          : mode === 'edit'
            ? space?.name
              ? t('{name}’yı düzenle', { name: space.name })
              : t('Topluluğu düzenle')
            : t('Topluluk oluştur')
      }
      className={`rcs-modal rcs-community-editor ${referenceCreated ? 'rcs-local-reference' : ''}`}
      onClose={() => {
        if (!op.busy) onClose();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="rcs-modal-body">
          {referenceCreated && (
            <Notice kind="success">
              <Check size={18} />
              <span>
                {t('{name} · Yerel oluşturuldu görünümü. Gerçek topluluk oluşturulmadı.', {
                  name: referenceCreated.name,
                })}
              </span>
            </Notice>
          )}
          {created && (
            <Notice kind="success">
              <Check size={18} />
              {t('{name} oluşturuldu.', { name: created.name })}
            </Notice>
          )}
          <p className="rcs-description">{t('Arkadaşlarınla buluşacağın özel topluluğun.')}</p>
          <label className="rcs-field">
            {t('Topluluk adı')}
            <input
              autoFocus
              required
              maxLength={32}
              value={referenceCreated?.name ?? created?.name ?? name}
              disabled={op.busy || !!created || !!referenceCreated}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          {/* The connection reports neither a description nor a visibility policy yet; each block
              shows only when its value is known, never as a disabled placeholder. */}
          {description && (
            <div className="rcs-field">
              {t('Kısa açıklama')}
              <p className="rcs-readonly">{description}</p>
            </div>
          )}
          {(inviteOnly !== undefined || referenceCreated) && (
            <div
              className={`rcs-option ${inviteOnly === true || referenceCreated ? 'selected' : ''}`}
            >
              <Lock size={23} />
              <div>
                <strong>
                  {inviteOnly === true || referenceCreated
                    ? t('Yalnızca davetle')
                    : t('Topluluk görünürlüğü')}
                </strong>
                <small>
                  {referenceCreated
                    ? t('Yerel referans politikası; sunucu ayarı uygulanmadı.')
                    : inviteOnly === true
                      ? t('Davet gerekliliği bağlantıdan alındı.')
                      : t('Davet dışı erişim açık.')}
                </small>
              </div>
              {(inviteOnly === true || referenceCreated) && <Check size={20} />}
            </div>
          )}
          {created && <CreatedCommunityInvite space={created} />}
          {reason && !created && !referenceCreated && <p className="rcs-hint">{reason}</p>}
          <ErrorNotice error={op.error} />
        </div>
        <footer className="rcs-modal-footer">
          <button type="button" className="button secondary" disabled={op.busy} onClick={onClose}>
            {created ? t('Bitti') : t('Vazgeç')}
          </button>
          {!created && (
            <button
              className="button primary"
              disabled={op.busy || !!reason || !validName(name, 32)}
              title={reason}
            >
              {op.busy
                ? t('Kaydediliyor…')
                : mode === 'edit'
                  ? t('Değişiklikleri kaydet')
                  : t('Topluluğu oluştur')}
            </button>
          )}
        </footer>
      </form>
    </Modal>
  );
}

/**
 * Right after creating a community: its first invitation, so friends can join at once. The
 * button shows only once a text channel of this very community has loaded, so the link can
 * never point at the community that was open before.
 */
function CreatedCommunityInvite({ space }: { space: SocialSpace }) {
  const serverUrl = useCommunity((s) => s.serverUrl),
    createInvite = useCommunity((s) => s.createInvite),
    channelId = useCommunity(
      (s) => s.channels.find((ch) => ch.spaceId === space.id && ch.type === 0)?.id,
    );
  const [invite, setInvite] = useState<SocialInvite | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  if (invite) return <InviteLinkCard serverUrl={serverUrl} invite={invite} autoFocus />;
  if (!channelId) return null;
  return (
    <>
      <button
        type="button"
        className="button primary full"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError('');
          void createInvite(channelId)
            .then(setInvite)
            .catch((failure) => setError(uiError(failure)))
            .finally(() => setBusy(false));
        }}
      >
        <Link size={16} />
        {busy ? t('Davet oluşturuluyor…') : t('Davet oluştur')}
      </button>
      <ErrorNotice error={error} />
    </>
  );
}

export interface ChannelPrivateReference {
  name: string;
  description: string;
  category: string;
  choices: { id: string; name: string; kind: 'member' | 'role' }[];
  selectedIds: string[];
}
export interface ChannelEditorProps extends CommunityOperationBoundary {
  /** Local UI selection only; ignored outside DEV or without fixture=true. */
  referencePrivate?: ChannelPrivateReference;
  referenceDraftName?: string;
  referenceDraftDescription?: string;
  referenceDraftCategory?: string;
  mode: 'create' | 'rename' | 'delete';
  space: SocialSpace;
  channel?: SocialChannel;
  initialType?: 'text' | 'voice';
  canManage: boolean;
  onCreate?(spaceId: string, name: string, type: 'text' | 'voice'): Promise<SocialChannel>;
  onRename?(channelId: string, name: string): Promise<SocialChannel>;
  onDelete?(channelId: string): Promise<void>;
  onClose(): void;
  onSaved?(channel: SocialChannel | null): void;
}
export function ChannelEditor(props: ChannelEditorProps) {
  const { mode, space, channel, onClose } = props;
  const referencePrivate =
    import.meta.env.DEV && props.fixture === true && mode === 'create'
      ? props.referencePrivate
      : undefined;
  const referenceDraft =
    import.meta.env.DEV && props.fixture === true && mode === 'create'
      ? {
          name: props.referenceDraftName ?? '',
          description: props.referenceDraftDescription ?? '',
          category: props.referenceDraftCategory ?? t('Sohbet'),
        }
      : undefined;
  const [referencePrivateEnabled, setReferencePrivateEnabled] = useState(true),
    [referencePickerOpen, setReferencePickerOpen] = useState(false),
    [referenceSelectedIds, setReferenceSelectedIds] = useState<string[]>(
      referencePrivate?.selectedIds ?? [],
    );
  useEffect(() => {
    setReferencePrivateEnabled(true);
    setReferencePickerOpen(false);
    setReferenceSelectedIds(referencePrivate?.selectedIds ?? []);
  }, [space.id, channel?.id, mode, referencePrivate]);
  const [name, setName] = useState(
      referencePrivate?.name ?? channel?.name ?? referenceDraft?.name ?? '',
    ),
    [type, setType] = useState<'text' | 'voice'>(
      props.initialType ?? (channel?.type === 2 ? 'voice' : 'text'),
    );
  const op = useOperation(`${space.id}:${channel?.id ?? 'new'}:${mode}`, props);
  useEffect(() => {
    setName(referencePrivate?.name ?? channel?.name ?? referenceDraft?.name ?? '');
    setType(props.initialType ?? (channel?.type === 2 ? 'voice' : 'text'));
  }, [
    space.id,
    channel?.id,
    mode,
    props.initialType,
    referencePrivate?.name,
    referenceDraft?.name,
  ]);
  const hasOperation =
    mode === 'create'
      ? !!props.onCreate
      : mode === 'rename'
        ? !!props.onRename && !!channel
        : !!props.onDelete && !!channel;
  const reason = op.blocked
    ? fixtureReason
    : !props.canManage
      ? t('Kanal yönetimi için yetkili olman gerekiyor.')
      : !hasOperation
        ? t('Kanal işlemi bağlantısı hazır değil.')
        : '';
  const submit = () => {
    if (reason || op.busy || (mode !== 'delete' && !validName(name))) return;
    void op.run(
      async () =>
        mode === 'create'
          ? props.onCreate!(space.id, name.trim(), type)
          : mode === 'rename'
            ? props.onRename!(channel!.id, name.trim())
            : (await props.onDelete!(channel!.id), null),
      (result) => {
        props.onSaved?.(result);
        onClose();
      },
    );
  };
  return (
    <Modal
      title={
        mode === 'delete'
          ? t('Kanalı sil?')
          : mode === 'rename'
            ? t('Kanalı düzenle')
            : t('Kanal oluştur')
      }
      className={`rcs-modal rcs-channel-editor ${mode === 'delete' ? 'rcs-delete' : ''} ${referencePrivate ? 'rcs-local-reference' : ''}`}
      onClose={() => {
        if (!op.busy) onClose();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="rcs-modal-body">
          {mode === 'delete' ? (
            <>
              <Notice kind="error">
                <TriangleAlert size={18} />
                {t('{name} ve mesajları silinecek.', {
                  name: `${channel?.type === 2 ? '' : '#'}${channel?.name ?? ''}`,
                })}
              </Notice>
              <p className="rcs-description">
                {t(
                  'Bu işlem geri alınamaz. Bu kanalın ses bağlantısı varsa kapanır; diğer kanalların bağlantıları bağımsızdır.',
                )}
              </p>
            </>
          ) : (
            <>
              <div className="rcs-type-options">
                {(['text', 'voice'] as const).map((value) => (
                  <button
                    type="button"
                    key={value}
                    className={`rcs-option ${type === value ? 'selected' : ''}`}
                    aria-pressed={type === value}
                    disabled={op.busy || mode === 'rename'}
                    onClick={() => setType(value)}
                  >
                    {value === 'text' ? <Hash size={25} /> : <Volume2 size={25} />}
                    <div>
                      <strong>{value === 'text' ? t('Metin kanalı') : t('Ses odası')}</strong>
                      <small>
                        {value === 'text'
                          ? t('Yazışmak ve paylaşmak')
                          : t('Konuşmak ve birlikte yapmak')}
                      </small>
                    </div>
                  </button>
                ))}
              </div>
              <label className="rcs-field">
                {t('Ad')}
                <input
                  autoFocus={!props.fixture}
                  required
                  maxLength={32}
                  value={name}
                  disabled={op.busy}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              {fixtureActive(props) && (
                <>
                  <label className="rcs-field">
                    {t('Açıklama')}
                    <input
                      disabled
                      value={
                        referencePrivate?.description ??
                        channel?.topic ??
                        referenceDraft?.description ??
                        ''
                      }
                      placeholder={t('Kanal açıklaması düzenleme henüz uygulanmadı')}
                      title={t('Açıklama kaydı henüz uygulanmadı.')}
                    />
                  </label>
                  <label className="rcs-field">
                    {t('Kategori')}
                    <select disabled value="unknown" title={t('Kategori kaydı henüz uygulanmadı.')}>
                      <option value="unknown">
                        {referencePrivate?.category ??
                          referenceDraft?.category ??
                          t('Kategori verisi alınmıyor')}
                      </option>
                    </select>
                  </label>
                  <div className="rcs-setting">
                    <div>
                      <strong>{t('Özel kanal')}</strong>
                      <small>
                        {referencePrivate
                          ? t('Yalnızca seçtiğin üyeler ve roller · Yerel referans')
                          : t('Özel kanal politikası ve erişim düzenleme henüz uygulanmadı.')}
                      </small>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-label={t('Özel kanal')}
                      aria-checked={referencePrivate ? referencePrivateEnabled : 'mixed'}
                      className={`rcs-switch ${referencePrivate ? (referencePrivateEnabled ? 'on' : '') : 'unknown'}`}
                      disabled={!referencePrivate}
                      title={
                        referencePrivate
                          ? t('Yalnızca yerel görünümü değiştirir; erişim kaydedilmez.')
                          : t('Özel kanal durumu bu bağlantıda alınmıyor')
                      }
                      onClick={() => {
                        setReferencePrivateEnabled((value) => !value);
                        setReferencePickerOpen(false);
                      }}
                    />
                  </div>
                </>
              )}
              {referencePrivate && referencePrivateEnabled && (
                <div className="rcs-reference-choices">
                  {referencePrivate.choices
                    .filter((choice) => referenceSelectedIds.includes(choice.id))
                    .map((choice) => (
                      <span className="rcs-badge" key={choice.id}>
                        {choice.name}
                      </span>
                    ))}
                  <button
                    type="button"
                    className="rcs-text-button"
                    aria-expanded={referencePickerOpen}
                    onClick={() => setReferencePickerOpen((value) => !value)}
                  >
                    <Plus size={17} />
                    {t('Üye veya rol seç')}
                  </button>
                  {referencePickerOpen && (
                    <fieldset>
                      <legend>{t('Yerel referans seçimi · Kaydedilmez')}</legend>
                      {referencePrivate.choices.map((choice) => (
                        <label key={choice.id}>
                          <input
                            type="checkbox"
                            checked={referenceSelectedIds.includes(choice.id)}
                            onChange={(event) =>
                              setReferenceSelectedIds((ids) =>
                                event.target.checked
                                  ? [...ids, choice.id]
                                  : ids.filter((id) => id !== choice.id),
                              )
                            }
                          />
                          {choice.name}
                          <small>{choice.kind === 'role' ? t('Rol') : t('Üye')}</small>
                        </label>
                      ))}
                    </fieldset>
                  )}
                </div>
              )}
            </>
          )}
          {reason && (
            <p className="rcs-hint">
              {referencePrivate
                ? t(
                    'Yerel referans · Özel kanal ve üye/rol erişimi kaydı henüz uygulanmadı. Gerçek hesap işlemi kapalı.',
                  )
                : reason}
            </p>
          )}
          <ErrorNotice error={op.error} />
        </div>
        <footer className="rcs-modal-footer">
          <button type="button" className="button secondary" disabled={op.busy} onClick={onClose}>
            {t('Vazgeç')}
          </button>
          <button
            className={`button ${mode === 'delete' ? 'danger' : 'primary'}`}
            disabled={op.busy || !!reason || (mode !== 'delete' && !validName(name))}
            title={reason}
          >
            {op.busy
              ? t('Kaydediliyor…')
              : mode === 'delete'
                ? t('Kanalı sil')
                : mode === 'rename'
                  ? t('Kaydet')
                  : t('Oluştur')}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

export interface CommunityRole {
  id: string;
  name: string;
  description?: string;
}
export interface ManagedInvite extends SocialInvite {
  creatorName?: string;
  uses?: number;
  maxUses?: number;
  revoked?: boolean;
}
export interface CommunityManagementProps extends CommunityOperationBoundary {
  space: SocialSpace | null;
  selfId?: string;
  access: 'allowed' | 'denied' | 'unknown';
  members: SocialMember[];
  roles?: CommunityRole[];
  invites?: ManagedInvite[];
  loading?: boolean;
  error?: string;
  initialTab?: 'members' | 'invites';
  serverUrl?: string;
  inviteChannelId?: string;
  onRefresh?(): Promise<void>;
  onCreateInvite?(channelId: string): Promise<ManagedInvite>;
  onRevokeInvite?(code: string): Promise<void>;
  onSetRoles?(userId: string, roleIds: string[]): Promise<void>;
  onRemoveMember?(userId: string): Promise<void>;
  onOpenPermissions?(): void;
  onReturn(): void;
}
export function CommunityManagement(props: CommunityManagementProps) {
  const { space, members, roles = [], invites, selfId } = props;
  const [tab, setTab] = useState(props.initialTab ?? 'members'),
    [query, setQuery] = useState(''),
    [inviteOpen, setInviteOpen] = useState(false),
    [createdInvite, setCreatedInvite] = useState<ManagedInvite | null>(null),
    [memberTarget, setMemberTarget] = useState<SocialMember | null>(null),
    [remove, setRemove] = useState(false),
    [roleIds, setRoleIds] = useState<string[]>([]),
    [revoke, setRevoke] = useState<ManagedInvite | null>(null),
    [copied, setCopied] = useState(false),
    [copyError, setCopyError] = useState(''),
    [dialogSpace, setDialogSpace] = useState(space?.id);
  const op = useOperation(space?.id ?? 'none', props);
  useEffect(() => {
    setTab(props.initialTab ?? 'members');
    setInviteOpen(false);
    setCreatedInvite(null);
    setMemberTarget(null);
    setRevoke(null);
    setQuery('');
  }, [space?.id, props.initialTab, props.access]);
  const unavailable = op.blocked
    ? fixtureReason
    : props.access !== 'allowed'
      ? t('Yönetim yetkisi henüz doğrulanmadı.')
      : '';
  const memberName = (member: SocialMember) => member.user.displayName || member.user.username;
  const visible = members.filter((member) =>
    memberName(member).toLocaleLowerCase(locale).includes(query.toLocaleLowerCase(locale)),
  );
  const roleName = (id: string) =>
    roles.find((role) => role.id === id)?.name ?? t('Rol adı alınmadı');
  const refreshAfter = async () => {
    if (props.onRefresh) await props.onRefresh();
  };
  const inviteLink =
    createdInvite && props.serverUrl
      ? inviteLinkFor(props.serverUrl, createdInvite.code)
      : (createdInvite?.code ?? '');
  if (props.access === 'denied')
    return <ChannelAccessState kind="community-denied" onReturn={props.onReturn} />;
  if (!space || props.access === 'unknown')
    return (
      <div className="rcs-page">
        <Notice>
          {props.loading
            ? t('Yönetim bilgisi yükleniyor…')
            : t('Topluluk yönetim yetkisi bu bağlantıda henüz alınamıyor.')}
        </Notice>
        <button className="button secondary" onClick={props.onReturn}>
          {t('Sohbete dön')}
        </button>
      </div>
    );
  return (
    <div className="rcs-page">
      <header className="rcs-heading">
        <div>
          <span>{t('TOPLULUK YÖNETİMİ')}</span>
          <h1>{space.name}</h1>
          <p>{t('Üyeleri, rolleri ve davetleri tek yerden yönet.')}</p>
        </div>
        <button
          className="button primary"
          onClick={() => {
            op.clear();
            setDialogSpace(space.id);
            setInviteOpen(true);
            setCreatedInvite(null);
            setCopied(false);
            setCopyError('');
          }}
        >
          <Plus size={17} />
          {t('Davet oluştur')}
        </button>
      </header>
      <div className="rcs-tabs">
        <button
          aria-pressed={tab === 'members'}
          className={tab === 'members' ? 'selected' : ''}
          onClick={() => setTab('members')}
        >
          {t('Üyeler · {count}', { count: members.length })}
        </button>
        <button
          aria-pressed={tab === 'invites'}
          className={tab === 'invites' ? 'selected' : ''}
          onClick={() => setTab('invites')}
        >
          {t('Davetler')}
        </button>
      </div>
      {props.loading && <p role="status">{t('Yükleniyor…')}</p>}
      <ErrorNotice error={props.error ?? ''} />
      <ErrorNotice error={op.error} />
      {tab === 'members' ? (
        <>
          <div className="rcs-members-toolbar">
            <label>
              <Search size={17} />
              <input
                aria-label={t('Üye ara')}
                value={query}
                placeholder={t('Üye ara')}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <span>
              {t('{members} üye · {online} çevrimiçi', {
                members: members.length,
                online: members.filter((member) =>
                  ['online', 'idle', 'dnd'].includes(member.status),
                ).length,
              })}
            </span>
          </div>
          <div className="rcs-table-scroll">
            <table className="rcs-members-table">
              <thead>
                <tr>
                  <th>{t('ÜYE')}</th>
                  <th>{t('ROL')}</th>
                  <th>{t('DURUM')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((member) => (
                  <tr key={member.user.id}>
                    <td>
                      <div className="rcs-member">
                        <VoiceAvatar id={member.user.id} name={memberName(member)} />
                        <div>
                          <strong>{memberName(member)}</strong>
                          {member.user.id === selfId && <small>{t('sen')}</small>}
                        </div>
                      </div>
                    </td>
                    <td>
                      {member.user.id === space.ownerId ? (
                        <span className="rcs-badge purple">{t('Topluluk sahibi')}</span>
                      ) : member.roles.length ? (
                        member.roles.map((id) => (
                          <span className="rcs-badge" key={id}>
                            {roleName(id)}
                          </span>
                        ))
                      ) : (
                        <span className="rcs-muted">{t('Rol atanmamış')}</span>
                      )}
                    </td>
                    <td>
                      {member.statusText ||
                        {
                          online: t('Çevrimiçi'),
                          idle: t('Uzakta'),
                          dnd: t('Rahatsız etmeyin'),
                          invisible: t('Çevrimdışı'),
                          unknown: t('Durum bilinmiyor'),
                        }[member.status]}
                    </td>
                    <td>
                      {member.user.id === space.ownerId ? (
                        <small>{t('Sahip')}</small>
                      ) : (
                        <button
                          className="rcs-text-button"
                          onClick={() => {
                            op.clear();
                            setDialogSpace(space.id);
                            setRemove(false);
                            setMemberTarget(member);
                            setRoleIds(member.roles);
                          }}
                        >
                          <MoreHorizontal size={17} />
                          {t('Yönet')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!props.loading && !visible.length && (
            <p className="rcs-muted">{query ? t('Eşleşen üye yok.') : t('Üye listesi boş.')}</p>
          )}
          <section className="rcs-role-summary">
            <div>
              <h2>{t('Rol özeti')}</h2>
              <button
                className="rcs-text-button"
                disabled={!props.onOpenPermissions}
                title={
                  !props.onOpenPermissions
                    ? t('Kanal izinleri görünümü henüz bağlanmadı.')
                    : undefined
                }
                onClick={props.onOpenPermissions}
              >
                <ArrowRight size={17} />
                {t('Kanal izinlerini aç')}
              </button>
            </div>
            {roles.length ? (
              <div>
                {roles.map((role) => (
                  <article key={role.id}>
                    <strong>{role.name}</strong>
                    <p>{role.description ?? t('Rolün yetki ayrıntısı bu bağlantıda alınmıyor.')}</p>
                  </article>
                ))}
              </div>
            ) : (
              <p className="rcs-muted">
                {t('Rol tanımları ve yetki ayrıntıları henüz alınamıyor.')}
              </p>
            )}
          </section>
        </>
      ) : (
        <>
          <div className="rcs-section-title">
            <h2>{t('Aktif davetler')}</h2>
            {invites && <small>{t('{count} bağlantı', { count: invites.length })}</small>}
          </div>
          {invites === undefined ? (
            <Notice>{t('Davet listesi için yerel yönetim arayüzü henüz uygulanmadı.')}</Notice>
          ) : invites.length ? (
            invites.map((invite) => (
              <div className="rcs-invite-row" key={invite.code}>
                <span>
                  <Link size={20} />
                </span>
                <div>
                  <strong>{invite.code}</strong>
                  <small>
                    {(() => {
                      const expiry = invite.expiresAt
                        ? t('{date} sona erme', {
                            date: new Date(invite.expiresAt).toLocaleString(locale),
                          })
                        : t('Sona erme bilgisi alınmadı');
                      return invite.creatorName
                        ? t('{creatorName} oluşturdu · {expiry}', {
                            creatorName: invite.creatorName,
                            expiry,
                          })
                        : expiry;
                    })()}
                  </small>
                </div>
                {invite.uses !== undefined && (
                  <span className="rcs-badge">
                    {t('{uses} / {max} kullanım', {
                      uses: invite.uses,
                      max: invite.maxUses ?? '—',
                    })}
                  </span>
                )}
                <button
                  className="rcs-text-button"
                  disabled={invite.revoked}
                  onClick={() => {
                    op.clear();
                    setDialogSpace(space.id);
                    setRevoke(invite);
                  }}
                >
                  <Trash2 size={15} />
                  {invite.revoked ? t('İptal edildi') : t('İptal et')}
                </button>
              </div>
            ))
          ) : (
            <p className="rcs-muted">{t('Davet yok.')}</p>
          )}
        </>
      )}
      {inviteOpen && dialogSpace === space.id && (
        <Modal
          title={
            createdInvite
              ? t('Davet bağlantısı hazır')
              : t('{name} topluluğuna davet oluştur', { name: space.name })
          }
          className="rcs-modal rcs-invite-modal"
          onClose={() => {
            if (!op.busy) setInviteOpen(false);
          }}
        >
          <div className="rcs-modal-body">
            {createdInvite ? (
              <>
                <div className="rcs-member">
                  <Users size={27} />
                  <strong>{space.name}</strong>
                </div>
                <div className="rcs-invite-code">
                  <input aria-label={t('Davet bağlantısı')} readOnly value={inviteLink} />
                  <button
                    className="rcs-text-button"
                    onClick={() => {
                      setCopyError('');
                      void navigator.clipboard
                        .writeText(inviteLink)
                        .then(() => setCopied(true))
                        .catch(() => {
                          setCopied(false);
                          setCopyError(t('Panoya erişilemiyor. Bağlantıyı seçip kopyala.'));
                        });
                    }}
                  >
                    <Copy size={16} />
                    {copied ? t('Kopyalandı') : t('Kopyala')}
                  </button>
                </div>
                <div className="rcs-two-columns">
                  <div>
                    <small>{t('Sona erme')}</small>
                    <strong>
                      {createdInvite.expiresAt
                        ? new Date(createdInvite.expiresAt).toLocaleString(locale)
                        : t('Sunucu yanıtında bulunmuyor')}
                    </strong>
                  </div>
                  <div>
                    <small>{t('Kullanım')}</small>
                    <strong>
                      {createdInvite.uses !== undefined
                        ? `${createdInvite.uses} / ${createdInvite.maxUses ?? '—'}`
                        : t('Sunucu yanıtında bulunmuyor')}
                    </strong>
                  </div>
                </div>
                <p className="rcs-hint">
                  {t('Davet bağlantısını yalnızca katılmasını istediğin kişilerle paylaş.')}
                </p>
              </>
            ) : (
              <>
                <p className="rcs-description">
                  {t('Davet bu topluluğun seçili kanalı için oluşturulur.')}
                </p>
                <div className="rcs-two-columns">
                  <label className="rcs-field">
                    {t('Geçerlilik süresi')}
                    <select disabled>
                      <option>{t('Sunucu tarafından belirlenir')}</option>
                    </select>
                  </label>
                  <label className="rcs-field">
                    {t('Kullanım sınırı')}
                    <select disabled>
                      <option>{t('Sunucu tarafından belirlenir')}</option>
                    </select>
                  </label>
                </div>
                <div className="rcs-setting">
                  <div>
                    <strong>{t('Katılınca verilecek rol')}</strong>
                    <small>{t('Rol atama ve davet seçenekleri bu bağlantıda alınmıyor.')}</small>
                  </div>
                </div>
                {(!props.onCreateInvite || !props.inviteChannelId || unavailable) && (
                  <p className="rcs-hint">
                    {unavailable ||
                      (!props.inviteChannelId
                        ? t('Davet için bir kanal seç.')
                        : t('Davet oluşturma bağlantısı hazır değil.'))}
                  </p>
                )}
              </>
            )}
            <ErrorNotice error={op.error} />
            <ErrorNotice error={copyError} />
          </div>
          <footer className="rcs-modal-footer">
            <button
              className="button secondary"
              disabled={op.busy}
              onClick={() => {
                setInviteOpen(false);
                if (createdInvite) setTab('invites');
              }}
            >
              {createdInvite ? t('Davetleri yönet') : t('Vazgeç')}
            </button>
            {createdInvite ? (
              <button className="button primary" onClick={() => setInviteOpen(false)}>
                {t('Bitti')}
              </button>
            ) : (
              <button
                className="button primary"
                disabled={
                  op.busy || !!unavailable || !props.onCreateInvite || !props.inviteChannelId
                }
                title={unavailable}
                onClick={() =>
                  void op.run(() => props.onCreateInvite!(props.inviteChannelId!), setCreatedInvite)
                }
              >
                {op.busy ? t('Oluşturuluyor…') : t('Davet oluştur')}
              </button>
            )}
          </footer>
        </Modal>
      )}
      {memberTarget && dialogSpace === space.id && (
        <Modal
          title={
            remove
              ? t('{name} adlı üyeyi çıkar?', { name: memberName(memberTarget) })
              : t('{name} kişisinin rolünü değiştir', { name: memberName(memberTarget) })
          }
          className="rcs-modal rcs-member-modal"
          onClose={() => {
            if (!op.busy) setMemberTarget(null);
          }}
        >
          <div className="rcs-modal-body">
            <div className="rcs-member">
              <VoiceAvatar id={memberTarget.user.id} name={memberName(memberTarget)} />
              <strong>{memberName(memberTarget)}</strong>
            </div>
            {remove ? (
              <p className="rcs-description">
                {t('Bu üyenin topluluktaki kanal ve odalara erişimi kaldırılacak.')}
              </p>
            ) : (
              <>
                <label className="rcs-field">
                  {t('Yeni roller')}
                  <select
                    multiple
                    value={roleIds}
                    disabled={op.busy || !props.onSetRoles || op.blocked}
                    onChange={(event) =>
                      setRoleIds([...event.target.selectedOptions].map((option) => option.value))
                    }
                  >
                    {roles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.name}
                      </option>
                    ))}
                  </select>
                </label>
                <Notice>
                  {t(
                    'Rol değişikliğinin erişim etkisi sunucu tarafından belirlenir. Etkin izin önizlemesi bu bağlantıda henüz alınmıyor.',
                  )}
                </Notice>
                <button
                  className="rcs-text-button destructive"
                  onClick={() => {
                    op.clear();
                    setRemove(true);
                  }}
                >
                  <Trash2 size={16} />
                  {t('Topluluktan çıkar')}
                </button>
              </>
            )}
            {(unavailable || !(remove ? props.onRemoveMember : props.onSetRoles)) && (
              <p className="rcs-hint">
                {unavailable ||
                  (remove
                    ? t('Üye çıkarma için yerel yönetim arayüzü henüz uygulanmadı.')
                    : t('Rol atama için yerel yönetim arayüzü henüz uygulanmadı.'))}
              </p>
            )}
            <ErrorNotice error={op.error} />
          </div>
          <footer className="rcs-modal-footer">
            <button
              className="button secondary"
              disabled={op.busy}
              onClick={() => setMemberTarget(null)}
            >
              {t('Vazgeç')}
            </button>
            <button
              className={`button ${remove ? 'danger' : 'primary'}`}
              disabled={
                op.busy ||
                !!unavailable ||
                !(remove ? props.onRemoveMember : props.onSetRoles) ||
                (!remove && !roles.length)
              }
              onClick={() =>
                void op.run(
                  async () => {
                    if (remove) await props.onRemoveMember!(memberTarget.user.id);
                    else await props.onSetRoles!(memberTarget.user.id, roleIds);
                    await refreshAfter();
                  },
                  () => setMemberTarget(null),
                )
              }
            >
              {op.busy ? t('Kaydediliyor…') : remove ? t('Topluluktan çıkar') : t('Rolü değiştir')}
            </button>
          </footer>
        </Modal>
      )}
      {revoke && dialogSpace === space.id && (
        <Modal
          title={t('Daveti iptal et?')}
          className="rcs-modal rcs-delete"
          onClose={() => {
            if (!op.busy) setRevoke(null);
          }}
        >
          <div className="rcs-modal-body">
            <p>{t('{code} bağlantısıyla artık yeni biri katılamayacak.', { code: revoke.code })}</p>
            {revoke.uses !== undefined && (
              <div className="rcs-setting">
                <span>{t('Şu ana kadar kullanım')}</span>
                <strong>
                  {revoke.uses} / {revoke.maxUses ?? '—'}
                </strong>
              </div>
            )}
            <p className="rcs-hint">{t('Daha önce katılan üyeler toplulukta kalır.')}</p>
            {(!props.onRevokeInvite || unavailable) && (
              <p className="rcs-hint">
                {unavailable || t('Davet iptali için yerel yönetim arayüzü henüz uygulanmadı.')}
              </p>
            )}
            <ErrorNotice error={op.error} />
          </div>
          <footer className="rcs-modal-footer">
            <button className="button secondary" disabled={op.busy} onClick={() => setRevoke(null)}>
              {t('Vazgeç')}
            </button>
            <button
              className="button danger"
              disabled={op.busy || !!unavailable || !props.onRevokeInvite}
              onClick={() =>
                void op.run(
                  async () => {
                    await props.onRevokeInvite!(revoke.code);
                    await refreshAfter();
                  },
                  () => setRevoke(null),
                )
              }
            >
              {t('Daveti iptal et')}
            </button>
          </footer>
        </Modal>
      )}
    </div>
  );
}

export type ChannelPermissionValue = 'deny' | 'inherit' | 'allow';
export type ChannelPermissionKey = 'view' | 'send' | 'files' | 'manageMessages' | 'manageChannel';
export interface ChannelPermissionSubject {
  id: string;
  kind: 'default' | 'role' | 'member';
  editable?: boolean;
  name: string;
  user?: SocialUser;
  values: Partial<Record<ChannelPermissionKey, ChannelPermissionValue>>;
}
export interface ChannelPermissionSnapshot {
  channelId: string;
  private?: boolean;
  subjects: ChannelPermissionSubject[];
}
export interface ChannelPermissionsProps extends CommunityOperationBoundary {
  spaceName?: string;
  channel?: SocialChannel;
  access: 'allowed' | 'denied' | 'removed' | 'unknown';
  snapshot?: ChannelPermissionSnapshot;
  canEdit?: boolean;
  initialSubjectId?: string;
  onSave?(draft: ChannelPermissionSnapshot): Promise<ChannelPermissionSnapshot>;
  onEditChannel?(): void;
  onAddMember?(): void;
  onReturn(): void;
  onCommunityInfo?(): void;
  voiceConnected?: boolean;
  voiceRoomName?: string;
}
const permissionNames: Record<ChannelPermissionKey, string> = {
  view: t('Kanalı gör'),
  send: t('Mesaj gönder'),
  files: t('Dosya paylaş'),
  manageMessages: t('Mesajları yönet'),
  manageChannel: t('Kanalı düzenle'),
};
export function ChannelPermissions(props: ChannelPermissionsProps) {
  const [draft, setDraft] = useState(props.snapshot),
    [selected, setSelected] = useState(
      props.initialSubjectId ?? props.snapshot?.subjects[0]?.id ?? '',
    ),
    [saved, setSaved] = useState(false);
  const op = useOperation(props.channel?.id ?? 'unknown', props);
  // Reset on what the permissions are, not on object identity: the surface re-renders on
  // every message, typing and voice event. The snapshot that comes back after our own save
  // keeps the selection and the "saved" notice.
  const snapshotKey = `${props.channel?.id ?? ''}\n${JSON.stringify(props.snapshot ?? null)}`;
  const savedKey = useRef<string | null>(null);
  useEffect(() => {
    if (savedKey.current === snapshotKey) return;
    savedKey.current = null;
    setDraft(props.snapshot);
    setSelected(props.initialSubjectId ?? props.snapshot?.subjects[0]?.id ?? '');
    setSaved(false);
    // props.snapshot is read through snapshotKey.
  }, [snapshotKey, props.initialSubjectId, props.access]);
  if (props.access === 'denied' || props.access === 'removed')
    return (
      <ChannelAccessState
        kind={props.access}
        onReturn={props.onReturn}
        onCommunityInfo={props.onCommunityInfo}
        voiceConnected={props.voiceConnected}
        voiceRoomName={props.voiceRoomName}
      />
    );
  if (props.access !== 'allowed' || !props.channel)
    return (
      <div className="rcs-page">
        <Notice>
          {t('Kanal yönetimi erişimi henüz doğrulanmadı. Özel kanal bilgileri gösterilmez.')}
        </Notice>
        <button className="button secondary" onClick={props.onReturn}>
          {t('Genel kanala dön')}
        </button>
      </div>
    );
  if (draft && draft.channelId !== props.channel.id)
    return (
      <div className="rcs-page">
        <Notice>{t('Kanal izinleri yükleniyor…')}</Notice>
      </div>
    );
  const unavailable = op.blocked
    ? fixtureReason
    : draft?.subjects.find((subject) => subject.id === selected)?.editable === false
      ? t('Bu rolün izinlerini düzenleme yetkisi yok.')
      : !draft || draft.channelId !== props.channel.id
        ? t('Kanal izinleri için yerel okuma arayüzü henüz uygulanmadı.')
        : !props.canEdit
          ? t('Kanal izinlerini düzenleme yetkisi gerekli.')
          : !props.onSave
            ? t('Kanal izinleri için yerel kayıt arayüzü henüz uygulanmadı.')
            : '';
  const subject = draft?.subjects.find((item) => item.id === selected);
  const dirty = !saved && JSON.stringify(draft) !== JSON.stringify(props.snapshot);
  const change = (key: ChannelPermissionKey, value: ChannelPermissionValue) => {
    if (unavailable || op.busy) return;
    setSaved(false);
    setDraft(
      (current) =>
        current && {
          ...current,
          subjects: current.subjects.map((item) =>
            item.id === selected ? { ...item, values: { ...item.values, [key]: value } } : item,
          ),
        },
    );
  };
  return (
    <div className="rcs-page">
      <header className="rcs-heading">
        <div>
          <span>{props.spaceName ?? t('TOPLULUK')}</span>
          <h1>{t('Kanal izinleri')}</h1>
          <p>{t('Görünürlüğü ve bu kanalda yapılabilecek işlemleri belirle.')}</p>
        </div>
        <button
          className="button primary"
          disabled={op.busy || !!unavailable || !dirty}
          title={unavailable}
          onClick={() => {
            if (draft && !unavailable)
              void op.run(
                () => props.onSave!(draft),
                (result) => {
                  if (result.channelId !== props.channel!.id) return;
                  savedKey.current = `${result.channelId}\n${JSON.stringify(result)}`;
                  setDraft(result);
                  setSaved(true);
                },
              );
          }}
        >
          {op.busy ? t('Kaydediliyor…') : t('Değişiklikleri kaydet')}
        </button>
      </header>
      {saved && (
        <Notice kind="success">
          <Check size={18} />
          {t('İzinler sunucu tarafından kaydedildi.')}
        </Notice>
      )}
      <div className="rcs-channel-strip">
        {draft?.private ? (
          <Lock size={20} />
        ) : props.channel.type === 2 ? (
          <Volume2 size={20} />
        ) : (
          <Hash size={20} />
        )}
        <strong>{props.channel.name}</strong>
        {draft?.private !== undefined && (
          <span className="rcs-badge purple">
            {draft.private ? t('Özel kanal') : t('Açık kanal')}
          </span>
        )}
        <button
          className="rcs-text-button"
          disabled={!props.onEditChannel}
          title={!props.onEditChannel ? t('Kanal düzenleme görünümü henüz bağlanmadı.') : undefined}
          onClick={props.onEditChannel}
        >
          <Pencil size={16} />
          {t('Kanalı düzenle')}
        </button>
      </div>
      <div className="rcs-setting">
        <div>
          <strong>{t('Özel kanal')}</strong>
          <small>
            {draft?.private === undefined
              ? t('Özel kanal durumu henüz alınmıyor.')
              : t('Kanal kapsamındaki erişim ayarı.')}
          </small>
        </div>
        <button
          role="switch"
          aria-label={t('Özel kanal')}
          aria-checked={draft?.private ?? 'mixed'}
          className={`rcs-switch ${draft?.private ? 'on' : ''} ${draft?.private === undefined ? 'unknown' : ''}`}
          disabled={!!unavailable || op.busy || draft?.private === undefined}
          title={unavailable}
          onClick={() => {
            setSaved(false);
            setDraft((current) => current && { ...current, private: !current.private });
          }}
        />
      </div>
      {unavailable && <p className="rcs-hint">{unavailable}</p>}
      <ErrorNotice error={op.error} />
      <div className="rcs-permission-grid">
        <aside>
          <h6>{t('ROLLER')}</h6>
          {draft?.subjects
            .filter((item) => item.kind === 'role' || item.kind === 'default')
            .map((item) => (
              <button
                key={item.id}
                className={selected === item.id ? 'selected' : ''}
                onClick={() => setSelected(item.id)}
              >
                <Users size={17} />
                {item.name}
              </button>
            ))}
          {!draft?.subjects.some((item) => item.kind === 'role' || item.kind === 'default') && (
            <p>{t('Rol izinleri alınmadı.')}</p>
          )}
          <h6>{t('KİŞİLER')}</h6>
          {draft?.subjects
            .filter((item) => item.kind === 'member')
            .map((item) => (
              <button
                key={item.id}
                className={selected === item.id ? 'selected' : ''}
                onClick={() => setSelected(item.id)}
              >
                {item.user && <VoiceAvatar id={item.user.id} name={item.name} />} {item.name}
              </button>
            ))}
          <button
            disabled={!props.onAddMember || !!unavailable}
            title={
              unavailable ||
              (!props.onAddMember ? t('Kişiye özel izin ekleme henüz uygulanmadı.') : undefined)
            }
            onClick={props.onAddMember}
          >
            <Plus size={16} />
            {t('Kişi ekle')}
          </button>
        </aside>
        <section>
          <div className="rcs-section-title">
            <h2>{subject?.name ?? t('İzinler')}</h2>
            {subject && (
              <span className="rcs-badge">
                {subject.kind === 'member' ? t('Kişiye özel') : t('Rol izinleri')}
              </span>
            )}
          </div>
          {(Object.keys(permissionNames) as ChannelPermissionKey[]).map((key) => (
            <div className="rcs-permission-row" key={key}>
              <span>{permissionNames[key]}</span>
              <div role="group" aria-label={permissionNames[key]}>
                {(['deny', 'inherit', 'allow'] as const).map((value) => (
                  <button
                    key={value}
                    aria-pressed={subject?.values[key] === value}
                    className={subject?.values[key] === value ? value : ''}
                    disabled={
                      !!unavailable || op.busy || !subject || subject.values[key] === undefined
                    }
                    title={
                      unavailable ||
                      (subject?.values[key] === undefined
                        ? t('Bu izin değeri henüz alınmadı.')
                        : undefined)
                    }
                    onClick={() => change(key, value)}
                  >
                    {{ deny: t('Ret'), inherit: t('Miras'), allow: t('İzin') }[value]}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </section>
      </div>
      <p className="rcs-hint">
        {t('Etki: yalnızca bu kanalın erişimi ve işlemleri. Etkin izin hesabını sunucu belirler.')}
      </p>
    </div>
  );
}
export function ChannelAccessState({
  kind,
  onReturn,
  onCommunityInfo,
  voiceConnected,
  voiceRoomName,
}: {
  kind: 'denied' | 'removed' | 'community-denied';
  onReturn(): void;
  onCommunityInfo?(): void;
  voiceConnected?: boolean;
  voiceRoomName?: string;
}) {
  return (
    <div className="rcs-access-state">
      <div className="rcs-access-icon">
        <Home size={81} />
        <span>
          <Lock size={20} />
        </span>
      </div>
      <h1>
        {kind === 'community-denied'
          ? t('Yönetim yetkin yok')
          : kind === 'removed'
            ? t('Bu kanala erişimin kaldırıldı')
            : t('Bu alanı yönetemiyorsun')}
      </h1>
      <p>
        {kind === 'community-denied'
          ? t('Bu alanı açmak için topluluk yönetim yetkisi gerekiyor.')
          : kind === 'removed'
            ? t('Kanal içeriği artık gösterilmiyor. Erişim için topluluk sahibine başvur.')
            : t(
                'Kanal izinlerini düzenlemek için yetkili olman gerekiyor. Özel içerikler gösterilmez.',
              )}
      </p>
      <div>
        <button className="button primary" onClick={onReturn}>
          <ArrowLeft size={17} />
          {kind === 'community-denied' ? t('Sohbete dön') : t('Genel kanala dön')}
        </button>
        {onCommunityInfo && (
          <button className="button secondary" onClick={onCommunityInfo}>
            {t('Topluluk bilgisi')}
          </button>
        )}
      </div>
      {voiceConnected && (
        <Notice>
          <Volume2 size={17} />
          {voiceRoomName
            ? t('{voiceRoomName} odasındaki ses bağlantın sürüyor.', { voiceRoomName })
            : t('Mevcut ses bağlantın sürüyor.')}
        </Notice>
      )}
    </div>
  );
}

export interface CommunityNotification {
  id: string;
  kind: 'mention' | 'invite' | 'activity' | 'agent' | 'friend';
  title: string;
  detail?: string;
  timestamp?: string;
  timestampLabel?: string;
  unread: boolean;
  author?: SocialUser;
  actionLabel?: string;
  onOpen?(): void;
}
export interface NotificationSurfaceProps extends CommunityOperationBoundary {
  items: CommunityNotification[];
  loading?: boolean;
  unavailableReason?: string;
  onMarkAllRead?(ids: string[]): Promise<void>;
  onOpenSettings?(): void;
}
export function NotificationSurface(props: NotificationSurfaceProps) {
  const [tab, setTab] = useState<'all' | 'mention' | 'invite'>('all'),
    [read, setRead] = useState<Set<string>>(new Set());
  const op = useOperation('notifications', props);
  const items = props.items.filter((item) => tab === 'all' || item.kind === tab),
    unread = props.items.filter((item) => item.unread && !read.has(item.id));
  const reason = op.blocked
    ? fixtureReason
    : !props.onMarkAllRead
      ? t('Toplu bildirim okuma işlemi bu bağlantıda henüz uygulanmadı.')
      : (props.unavailableReason ?? '');
  return (
    <div className="rcs-notifications">
      <header className="rcs-heading">
        <div>
          <h1>{t('Bildirimler')}</h1>
        </div>
        <button
          className="rcs-text-button"
          disabled={props.fixture ? !unread.length : op.busy || !!reason || !unread.length}
          title={props.fixture ? t('Yalnızca bu yerel görünümde güncellenir.') : reason}
          onClick={() => {
            if (props.fixture) {
              setRead((current) => new Set([...current, ...unread.map((item) => item.id)]));
              return;
            }
            void op.run(
              () => props.onMarkAllRead!(unread.map((item) => item.id)),
              () => setRead((current) => new Set([...current, ...unread.map((item) => item.id)])),
            );
          }}
        >
          <Check size={17} />
          {t('Tümünü okundu yap')}
        </button>
      </header>
      <div className="rcs-notification-tabs">
        {(['all', 'mention', 'invite'] as const).map((value) => (
          <button
            key={value}
            aria-pressed={tab === value}
            className={tab === value ? 'selected' : ''}
            onClick={() => setTab(value)}
          >
            {value === 'all'
              ? t('Tümü · {length}', { length: unread.length })
              : value === 'mention'
                ? t('Etiketlemeler')
                : t('Davetler')}
          </button>
        ))}
      </div>
      {props.loading && <p role="status">{t('Bildirimler yükleniyor…')}</p>}
      {props.unavailableReason && <Notice>{props.unavailableReason}</Notice>}
      <ErrorNotice error={op.error} />
      {!props.loading && !items.length && (
        <div className="rcs-notification-empty">
          <span>
            <Bell size={39} />
          </span>
          <h2>
            {props.unavailableReason ? t('Bildirim akışı kullanılamıyor') : t('Bildirim yok')}
          </h2>
        </div>
      )}
      {items.map((item) => (
        <article className="rcs-notification-row" key={item.id}>
          {item.author ? (
            <VoiceAvatar
              id={item.author.id}
              name={item.author.displayName || item.author.username}
            />
          ) : (
            <span className={`rcs-notification-icon ${item.kind}`}>
              {item.kind === 'activity' ? (
                <Film size={20} />
              ) : item.kind === 'agent' ? (
                <img src="./reference-brand/brand/logo-symbol-lilac.svg" alt="" />
              ) : (
                <Bell size={20} />
              )}
            </span>
          )}
          <div>
            <p>{item.title}</p>
            {(item.detail || item.timestamp || item.timestampLabel) && (
              <small>
                {item.detail}
                {item.detail && (item.timestamp || item.timestampLabel) ? ' · ' : ''}
                {item.timestampLabel ??
                  (item.timestamp ? new Date(item.timestamp).toLocaleString(locale) : '')}
              </small>
            )}
            <button
              className={`button ${props.fixture && item.kind === 'activity' ? 'primary' : 'secondary'}`}
              disabled={!item.onOpen}
              title={!item.onOpen ? t('Bildirim hedefi bu bağlantıda henüz açılmıyor.') : undefined}
              onClick={item.onOpen}
            >
              {item.actionLabel ?? t('Aç')}
            </button>
          </div>
          {item.unread && !read.has(item.id) && <i aria-label={t('Okunmadı')} />}
        </article>
      ))}
    </div>
  );
}
