import { useMentionInput } from './MentionInput';
import { ChatAttachment } from './ChatAttachment';
import { ScreenShareGallery } from './ScreenShareGallery';
import { VoiceRoomViewActions } from './VoiceRoomViewActions';
import { openActivity, retiredActivity } from './activity-route';
import { FriendRequestButton } from './FriendRequestButton';
import { MediaStage } from './MediaStage';
import { watchScreen, setScreenVolume, setScreenQuality } from './realtime';
export { MediaStage } from './MediaStage';
import './reference-chat.css';
import './reference-voice.css';
import './discord-room.css';
import { ReferenceIcon } from './ReferenceIcon';
import { mediaBridge } from './runtime-sources';
import { SoundboardButton } from './Soundboard';
import { locale, t, tr, uiError } from './i18n';
import { places } from './dev/sample';
import { directMessageFailed } from './FriendRequiredDialog';
import { VoiceAvatar } from './VoiceAvatar';
import { ScreenHandoffControls, cancelScreenHandoff, decideScreenHandoff } from './screen-handoff';
import { MessageReminder } from './Reminder';
import { ChatAgentRequest } from './ChatAgent';
import { EmojiPicker, GifPicker, isGifMessage } from './ComposerPickers';
import { AppDirectory } from './AppDirectory';
import { InviteLinkCard } from './InviteLinkCard';
import { ChatPollCard, ChatPollComposer } from './ChatPoll';
import { chatPollId } from './chat-poll';
import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
} from 'react';
import { useRooms } from './store';
import { PushToTalkNotice } from './PushToTalk';
import { reactionCodepoints, reactionEmoji } from './reactions';
import { useActivityRoom } from './activity';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowDown,
  ArrowRight,
  AlertCircle,
  BarChart3,
  Bell,
  Download,
  Film,
  Gamepad2,
  Heart,
  MoreHorizontal,
  Smile,
  Star,
  AudioLines,
  BookmarkPlus,
  Bot,
  Clock3,
  Paperclip,
  ThumbsUp,
  FileText,
  Check,
  CornerUpLeft,
  Edit3,
  Hash,
  Headphones,
  Link,
  MessageCircle,
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  Plus,
  RefreshCw,
  Send,
  Settings,
  ShieldCheck,
  Square,
  Trash2,
  Users,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
  X,
  Trophy,
  Gem,
  Dice5,
  LayoutGrid,
} from 'lucide-react';
import { Avatar, EmptyState, IconButton, Modal, Notice } from '@rooms/design';
import {
  parseInviteLink,
  type SocialInvite,
  type SocialUser,
  type SocialAttachment,
} from '@rooms/social';
import { sameInviteServer } from './ConnectionPane';
import { MESSAGE_WINDOW, useCommunity, type CommunityMessage } from './community';
import { useModerationRights } from './VoiceModeration';
import {
  useRealtime,
  joinVoice,
  leaveVoice,
  toggleMic,
  toggleDeafen,
  toggleCamera,
  startScreen,
  stopScreen,
  setParticipantVolume,
  startRoomAudio,
} from './realtime';
import { silencedHere } from './participant-audio';
import { VoiceRejoinNotice } from './VoiceRejoinNotice';
/** Who watches a screen share, from each viewer's own announcement. */
export function viewerSummary(
  people: { id: string; name: string; local: boolean; watching?: string | null }[],
  broadcaster: string | null | undefined,
  named = false,
) {
  const viewers = broadcaster ? people.filter((p) => p.watching === broadcaster) : [];
  if (!viewers.length) return t('Henüz izleyen yok');
  if (!named) return t('{count} kişi izliyor', { count: viewers.length });
  return t('İzleyenler: {names}', {
    names: viewers.map((p) => (p.local ? t('Sen') : p.name)).join(', '),
  });
}
/** Turkish writes the clock as 20.45; other languages keep their own separator. */
const clockText = (timestamp: string) => {
  const time = new Date(timestamp).toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
  });
  return locale === 'tr-TR' ? time.replace(':', '.') : time;
};
/**
 * Replies travel as a quote until native replies land: the first lines quote the original
 * (`> name: text`, at most 400 characters), then a blank line and the reply itself.
 */
export function quoteReply(message: Pick<CommunityMessage, 'author' | 'content'>, text: string) {
  const name = message.author.displayName || message.author.username;
  return `> ${name}: ${message.content.slice(0, 400).replace(/\n/g, '\n> ')}\n\n${text}`;
}
const report = (operation: Promise<unknown>, notify: (message: string) => void) => {
  void operation.catch((e) => notify(uiError(e)));
};
export function CommunityChat({
  notify,
  composerPlaceholder,
}: {
  composerPlaceholder?: string;
  notify(message: string): void;
}) {
  const c = useCommunity();
  const communityAdmin =
    useModerationRights(c.activeSpaceId).communityAdmin ||
    c.spaces.find((s) => s.id === c.activeSpaceId)?.ownerId === c.user?.id;
  const [selectedAuthor, setSelectedAuthor] = useState<SocialUser | null>(null);
  const [confirmRemoval, setConfirmRemoval] = useState(false);
  const [memberBusy, setMemberBusy] = useState(false);
  const [memberError, setMemberError] = useState('');
  const closeAuthor = useCallback(() => {
    setSelectedAuthor(null);
    setConfirmRemoval(false);
    setMemberError('');
  }, []);
  useEffect(() => {
    const acknowledge = () => {
      const current = useCommunity.getState(),
        last = current.messages.at(-1);
      if (current.activeChannelId && last && !last.id.startsWith('pending-') && document.hasFocus())
        void current.markRead(current.activeChannelId, last.id);
    };
    acknowledge();
    window.addEventListener('focus', acknowledge);
    return () => window.removeEventListener('focus', acknowledge);
  }, [c.activeChannelId]);
  const [draft, setDraft] = useState('');
  const mentionInput = useMentionInput(draft, setDraft);
  const [attachments, setAttachments] = useState<SocialAttachment[]>([]),
    [uploading, setUploading] = useState(false);
  const attach = async () => {
    if (!c.activeChannelId || !window.rooms) return;
    const channelId = c.activeChannelId;
    setUploading(true);
    try {
      const item = await window.rooms.social.chooseAttachment(channelId);
      if (item && useCommunity.getState().activeChannelId === channelId)
        setAttachments((items) => [...items, item].slice(0, 5));
      else if (item) await window.rooms.social.discardAttachment(item.id);
    } catch (error) {
      notify(uiError(error));
    } finally {
      setUploading(false);
    }
  };
  const [dropping, setDropping] = useState(false);
  /** Uploads files dragged or pasted into the conversation through the same validated path. */
  const addFiles = async (files: File[]) => {
    if (!c.activeChannelId || !window.rooms || !files.length) return;
    const channelId = c.activeChannelId;
    const room = 5 - attachments.length;
    if (room <= 0) {
      notify(t('Bir mesaja en fazla 5 dosya ekleyebilirsin.'));
      return;
    }
    if (files.length > room)
      notify(
        t('Yalnızca ilk {count} dosya eklendi; bir mesajda en fazla 5 dosya olur.', {
          count: room,
        }),
      );
    setUploading(true);
    try {
      for (const file of files.slice(0, room)) {
        if (file.size > 25 * 1024 * 1024) {
          notify(t('{name} 25 MB sınırını aşıyor.', { name: file.name }));
          continue;
        }
        const item = await window.rooms.social.dropAttachment(
          channelId,
          file.name || 'yapistirilan-gorsel.png',
          new Uint8Array(await file.arrayBuffer()),
        );
        if (useCommunity.getState().activeChannelId === channelId)
          setAttachments((items) => [...items, item].slice(0, 5));
        else await window.rooms.social.discardAttachment(item.id);
      }
    } catch (error) {
      notify(uiError(error));
    } finally {
      setUploading(false);
    }
  };
  /** Screenshots and Finder copies are not exposed to the paste event; main reads the clipboard. */
  const pasteFromClipboard = async () => {
    if (!c.activeChannelId || !window.rooms || attachments.length >= 5) return;
    const channelId = c.activeChannelId;
    setUploading(true);
    try {
      const item = await window.rooms.social.pasteAttachment(channelId);
      if (!item) notify(t('Panoda eklenebilecek bir görsel veya dosya yok.'));
      else if (useCommunity.getState().activeChannelId === channelId)
        setAttachments((items) => [...items, item].slice(0, 5));
      else await window.rooms.social.discardAttachment(item.id);
    } catch (error) {
      notify(uiError(error));
    } finally {
      setUploading(false);
    }
  };
  const hasFiles = (event: ReactDragEvent) => event.dataTransfer.types.includes('Files');
  const react = async (message: CommunityMessage, key: string) => {
    if (!c.activeChannelId || !window.rooms) return;
    try {
      // Stoat only accepts the emoji itself, never a codepoint id such as `2764`.
      await c.reactMessage(message.id, reactionEmoji(key));
    } catch (error) {
      notify(uiError(error));
    }
  };
  const navigate = useNavigate();
  const chatLocation = useLocation();
  useEffect(() => {
    const messageId = new URLSearchParams(chatLocation.search).get('message');
    if (!messageId || c.loadingMessages) return;
    const target = document.getElementById(`message-${messageId}`);
    target?.scrollIntoView({ block: 'center', behavior: 'instant' });
    target?.focus({ preventScroll: true });
  }, [chatLocation.search, c.activeChannelId, c.loadingMessages, c.messages.length]);
  const voice = useRealtime();
  const activity = useActivityRoom(c.user ? (voice.channelId ?? c.activeChannelId) : null);
  // Inside the hall the screen is already on the page; no banner pointing back to it.
  // A leftover old-Cinema session is not an error to pin on every chat: its details live
  // in the activity launcher and the room list.
  const primary =
    activity.status === 'connected' &&
    activity.room?.primary?.activity !== 'hall' &&
    !(activity.room?.primary && retiredActivity(activity.room.primary.activity))
      ? activity.room?.primary
      : null;
  const [nameColors, setNameColors] = useState<Record<string, string>>({});
  useEffect(() => {
    let active = true;
    if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('fixture'))
      void import('./dev/reference-fixtures').then((f) => {
        if (active) setNameColors(f.getReferenceNameColors());
      });
    return () => {
      active = false;
    };
  }, []);
  const [options, setOptions] = useState<CommunityMessage | null>(null),
    [reactionTarget, setReactionTarget] = useState<CommunityMessage | null>(null);
  const [reply, setReply] = useState<CommunityMessage | null>(null);
  const [actionBusy, setActionBusy] = useState(false),
    [actionError, setActionError] = useState('');
  const unreadAnchor = useRef<string | null>(null);
  const previousChannel = useRef<string | null>(null);
  if (previousChannel.current !== c.activeChannelId) {
    previousChannel.current = c.activeChannelId;
    unreadAnchor.current =
      c.activeChannelId && c.unread[c.activeChannelId]
        ? (c.readStates[c.activeChannelId]?.lastReadMessageId ?? null)
        : null;
  }
  const closeOptions = useCallback(() => setOptions(null), []);
  // The reaction picker is a popover on its message: outside pointer or Escape closes it.
  const reactionPopover = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!reactionTarget) return;
    const popover = reactionPopover.current;
    popover?.scrollIntoView?.({ block: 'nearest' });
    popover?.querySelector('button')?.focus();
    const outside = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (popover?.contains(target) || target?.closest('[data-reaction-trigger]')) return;
      setReactionTarget(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setReactionTarget(null);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [reactionTarget]);
  const closeReply = useCallback(() => setReply(null), []);
  const saveEdit = async () => {
    const content = mentionInput.serialize().trim();
    if (!editing || !content || actionBusy) return;
    if (content.length > 4000) {
      notify(t('Mesaj çok uzun. Biraz kısaltıp yeniden dene.'));
      return;
    }
    setActionBusy(true);
    setActionError('');
    try {
      if (content !== editing.content) await c.editMessage(editing.id, content);
      closeEdit();
    } catch (error) {
      setActionError(uiError(error));
    } finally {
      setActionBusy(false);
    }
  };
  const [reminder, setReminder] = useState<CommunityMessage | null>(null);
  const closeReminder = useCallback(() => setReminder(null), []);
  const [agentPrompt, setAgentPrompt] = useState<string | null>(null);
  const [picker, setPicker] = useState<'gif' | 'emoji' | 'apps' | null>(null);
  const [pollComposer, setPollComposer] = useState(false);
  const closePollComposer = useCallback(() => setPollComposer(false), []);
  const pickerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!picker) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (pickerRef.current?.contains(target) || target?.closest('[data-composer-picker]')) return;
      setPicker(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPicker(null);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [picker]);
  useEffect(() => setPicker(null), [c.activeChannelId]);
  const insertEmoji = (emoji: string) => {
    const input = mentionInput.input.current,
      start = input?.selectionStart ?? draft.length,
      end = input?.selectionEnd ?? start;
    mentionInput.change(draft.slice(0, start) + emoji + draft.slice(end), start + emoji.length);
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  };
  const closeAgent = useCallback(() => setAgentPrompt(null), []);
  // Assistant controls appear only when this account reaches a connected assistant.
  const [assistant, setAssistant] = useState(false);
  useEffect(() => {
    let active = true;
    setAssistant(false);
    const agent = window.rooms?.agent;
    if (!c.user || typeof agent?.status !== 'function') return;
    void agent
      .status()
      .then((status) => {
        if (active) setAssistant(status.connected);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [c.user?.id, c.serverUrl]);
  const saveMemory = (message: CommunityMessage) => {
    if (!c.activeChannelId || !window.rooms?.agent) return;
    report(
      window.rooms.agent
        .saveMemory({
          roomId: c.activeChannelId,
          text: message.content,
          sourceMessageId: message.id,
        })
        .then(() => notify(t('Mesaj oda hafızasına kaydedildi.'))),
      notify,
    );
  };
  const [editing, setEditing] = useState<CommunityMessage | null>(null);
  // The unsent draft waits here while the composer edits an existing message.
  const draftBeforeEdit = useRef('');
  const [deleting, setDeleting] = useState<string | null>(null);
  // Moderators (manage messages in this channel) may delete other people's messages too.
  const [moderates, setModerates] = useState(false);
  useEffect(() => {
    let active = true;
    setModerates(false);
    const id = c.activeChannelId;
    if (!id || !window.rooms?.social?.channelPermissions || c.dms.some((dm) => dm.id === id))
      return;
    void window.rooms.social
      .channelPermissions(id)
      .then((value) => {
        if (active) setModerates(value.access === 'allowed' && value.effective.manageMessages);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [c.activeChannelId, c.user?.id]);
  const log = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const [unseen, setUnseen] = useState(false);
  const channel =
    c.channels.find((ch) => ch.id === c.activeChannelId) ??
    c.dms.find((ch) => ch.id === c.activeChannelId);
  const dmPeer = c.dms.some((dm) => dm.id === channel?.id)
    ? (channel?.recipients?.find((person) => person.id !== c.user?.id) ?? null)
    : null;
  const startEdit = (message: CommunityMessage) => {
    if (message.author.id !== c.user?.id) return;
    if (!editing) draftBeforeEdit.current = draft;
    setReply(null);
    setEditing(message);
    setActionError('');
    mentionInput.load(message.content);
  };
  const closeEdit = () => {
    setEditing(null);
    setActionError('');
    mentionInput.load(draftBeforeEdit.current);
    draftBeforeEdit.current = '';
  };
  /** Replies are written in the composer itself; the quote is added when the message is sent. */
  const startReply = (message: CommunityMessage) => {
    if (editing) closeEdit();
    setReply(message);
    requestAnimationFrame(() => mentionInput.input.current?.focus());
  };
  const closeDelete = useCallback(() => setDeleting(null), []);
  useEffect(() => {
    setOptions(null);
    setReactionTarget(null);
    setReply(null);
    setEditing((current) => {
      if (current) setDraft(draftBeforeEdit.current);
      draftBeforeEdit.current = '';
      return null;
    });
    setDeleting(null);
    setActionError('');
  }, [c.activeChannelId]);
  useEffect(() => {
    nearBottom.current = true;
    setUnseen(false);
    setAttachments([]);
  }, [c.activeChannelId]);
  useEffect(() => {
    if (nearBottom.current && log.current) log.current.scrollTop = log.current.scrollHeight;
    else setUnseen(true);
  }, [c.activeChannelId, c.messages.length, c.messages.at(-1)?.id]);
  const send = () => {
    if (editing) {
      void saveEdit();
      return;
    }
    if (!draft.trim() && !attachments.length) return;
    const text = mentionInput.serialize().trim();
    const content = reply ? quoteReply(reply, text) : text;
    if (content.length > 4000) {
      notify(t('Mesaj çok uzun. Biraz kısaltıp yeniden dene.'));
      return;
    }
    report(
      c.send(content, attachments).then(async () => {
        if (!/^@agent(?:\s|$)/i.test(text)) return;
        const capabilities =
          (await window.rooms?.agent.status().catch(() => null))?.capabilities ?? [];
        if (!capabilities.includes('stoat-mentions') && text.replace(/^@agent\s*/i, '').trim())
          setAgentPrompt(text.replace(/^@agent\s*/i, '').trim());
      }),
      notify,
    );
    setDraft('');
    setAttachments([]);
    setReply(null);
    nearBottom.current = true;
  };
  const typingSent = useRef<{ channel: string; time: number } | null>(null);
  const [typingClock, setTypingClock] = useState(Date.now());
  const [fixtureTyping, setFixtureTyping] = useState<SocialUser[]>([]);
  useEffect(() => {
    let active = true;
    setFixtureTyping([]);
    if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('fixture'))
      void import('./dev/reference-fixtures').then((f) => {
        if (active && c.activeChannelId)
          setFixtureTyping(f.getReferenceTypingUsers(c.activeChannelId));
      });
    return () => {
      active = false;
    };
  }, [c.activeChannelId]);
  const typingUsers = fixtureTyping.length
    ? fixtureTyping
    : Object.values(c.typing[c.activeChannelId ?? ''] ?? {})
        .filter((entry) => entry.expiresAt > typingClock)
        .map((entry) => entry.user);
  useEffect(() => {
    if (!typingUsers.length) return;
    const timer = setInterval(() => setTypingClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [typingUsers.length]);
  useEffect(() => {
    if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('fixture')) return;
    const channel = c.activeChannelId;
    if (!channel || !window.rooms || c.status !== 'connected') return;
    const stop = () => {
      if (typingSent.current?.channel === channel) {
        typingSent.current = null;
        void window.rooms?.social.typing(channel, false).catch(() => {});
      }
    };
    if (!draft.trim()) {
      stop();
      return;
    }
    if (typingSent.current?.channel !== channel || Date.now() - typingSent.current.time >= 4000) {
      typingSent.current = { channel, time: Date.now() };
      void window.rooms.social.typing(channel, true).catch(() => {});
    }
    const timer = setTimeout(stop, 3000);
    const blur = () => stop();
    window.addEventListener('blur', blur);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('blur', blur);
    };
  }, [draft, c.activeChannelId, c.status]);
  useEffect(
    () => () => {
      const current = typingSent.current;
      typingSent.current = null;
      if (current) void window.rooms?.social.typing(current.channel, false).catch(() => {});
    },
    [c.activeChannelId],
  );
  // `id` is the codepoint key used for display; `emoji` is what the picker sends upstream.
  const reactionOptions = [
    { id: '2764', emoji: '\u2764\ufe0f', label: t('Kalp'), icon: Heart },
    { id: '2714', emoji: '\u2714\ufe0f', label: t('Onay'), icon: Check },
    { id: '2b50', emoji: '\u2b50', label: t('Yıldız'), icon: Star },
    { id: '1f642', emoji: '\u{1f642}', label: t('Gülümseme'), icon: Smile },
    { id: '1f3ae', emoji: '\u{1f3ae}', label: t('Oyun'), icon: Gamepad2 },
    { id: '1f3ac', emoji: '\u{1f3ac}', label: t('Film'), icon: Film },
  ];
  // Named reactions that other clients or older keys may use but the picker does not offer.
  const otherReactions: Record<string, { label: string; icon: typeof Heart }> = {
    heart: { label: t('Kalp'), icon: Heart },
    check: { label: t('Onay'), icon: Check },
    '1f44d': { label: t('Beğeni'), icon: ThumbsUp },
  };
  const reactionOption = (key: string) => {
    const id = reactionCodepoints(key);
    return reactionOptions.find((item) => item.id === id) ?? otherReactions[id];
  };
  const reactionOrder = (key: string) => {
    const index = reactionOptions.findIndex((item) => item.id === reactionCodepoints(key));
    return index < 0 ? 99 : index;
  };
  const messageText = (value: string) =>
    value
      .split(/(https?:\/\/[^\s<>]+|<@[A-Za-z0-9_-]{1,128}>|@[\p{L}\p{N}_-]+)/u)
      .map((part, i) => {
        if (/^https?:\/\//i.test(part)) {
          // Trailing sentence punctuation is not part of the link.
          const link = part.replace(/[.,!?;:)\]}'"]+$/, '');
          return (
            <Fragment key={i}>
              <a href={link} target="_blank" rel="noreferrer noopener" className="message-link">
                {link}
              </a>
              {part.slice(link.length)}
            </Fragment>
          );
        }
        const id = part.match(/^<@([A-Za-z0-9_-]+)>$/)?.[1];
        const person = id
          ? [c.user, ...c.messages.map((m) => m.author), ...(channel?.recipients ?? [])].find(
              (p) => p?.id === id,
            )
          : null;
        return id ? (
          <mark key={i}>
            @{person?.displayName ?? mentionInput.name(id) ?? t('kişi-{id}', { id: id.slice(-6) })}
          </mark>
        ) : part.startsWith('@') ? (
          <mark key={i}>{part}</mark>
        ) : (
          part
        );
      });
  return (
    <div
      className={`chat-page reference-chat${dropping ? ' is-dropping' : ''}`}
      onDragOver={(e) => {
        if (!hasFiles(e) || !c.activeChannelId) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = editing ? 'none' : 'copy';
        if (!dropping) setDropping(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false);
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setDropping(false);
        if (editing) {
          notify(t('Düzenlemeyi bitirince dosya ekleyebilirsin.'));
          return;
        }
        void addFiles([...e.dataTransfer.files]);
      }}
    >
      {/* Members and search live in the app toolbar; the heading only names the conversation. */}
      <header className="chat-heading">
        {dmPeer ? (
          <VoiceAvatar id={dmPeer.id} name={dmPeer.displayName || dmPeer.username} />
        ) : channel?.type === 2 ? (
          <Volume2 size={24} aria-hidden="true" />
        ) : (
          <Hash size={24} aria-hidden="true" />
        )}
        <h2 title={channel?.name}>{channel?.name ?? t('Sohbet')}</h2>
        {channel?.topic && (
          <>
            <span className="chat-topic-divider" />
            <p title={channel.topic}>{channel.topic}</p>
          </>
        )}
        <div className="chat-header-tools">
          <IconButton
            label={t('Bildirim ayarları')}
            onClick={() => navigate('/settings?tab=desktop')}
          >
            <Bell size={19} />
          </IconButton>
        </div>
      </header>
      {primary && (
        <div className="chat-announcement">
          <Film size={20} />
          <div>
            <strong>{primary.title}</strong>
            <small>
              {activity.room?.participants
                .filter((p) => p.userId !== c.user?.id)
                .map((p) => p.displayName)
                .join(', ')}
            </small>
          </div>
          <button
            className="button secondary small"
            onClick={() => openActivity(primary.activity, navigate)}
          >
            <ArrowRight size={17} />
            {t('Etkinliğe dön')}
          </button>
        </div>
      )}
      <div
        ref={log}
        className="chat-transcript"
        role="log"
        aria-label={t('Kanal mesajları')}
        onLoadCapture={() => {
          if (nearBottom.current && log.current) log.current.scrollTop = log.current.scrollHeight;
        }}
        onScroll={() => {
          const el = log.current;
          if (el) {
            nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            if (nearBottom.current) setUnseen(false);
          }
        }}
      >
        {c.hasOlder && c.messages.length > 0 && (
          <button
            className="text-button load-older"
            disabled={c.loadingMessages}
            onClick={() => {
              const el = log.current;
              const previousHeight = el?.scrollHeight ?? 0;
              void c.loadOlder().then(() =>
                requestAnimationFrame(() => {
                  if (el) el.scrollTop = el.scrollHeight - previousHeight;
                }),
              );
            }}
          >
            <RefreshCw size={12} />
            {c.loadingMessages ? t('Yükleniyor…') : t('Önceki mesajlar')}
          </button>
        )}
        {!c.hasOlder && c.messages.length >= MESSAGE_WINDOW && (
          <p className="load-older-limit">
            {t('Bu görünümde en fazla {limit} mesaj tutulur; daha eskiler burada açılamıyor.', {
              limit: MESSAGE_WINDOW.toLocaleString(locale),
            })}
          </p>
        )}
        {!c.messages.length && !c.loadingMessages && (
          <EmptyState
            size="inline"
            className="chat-welcome"
            icon={<MessageCircle size={40} />}
            title={
              !channel
                ? t('Kanal seç')
                : dmPeer
                  ? t('{name} ile konuşman burada başlıyor.', {
                      name: dmPeer.displayName || dmPeer.username,
                    })
                  : channel.type === 2
                    ? t('{name} odasının sohbetine hoş geldin.', { name: channel.name })
                    : t('#{name} kanalına hoş geldin.', { name: channel.name })
            }
            action={
              channel && (
                <button
                  className="button primary"
                  onClick={() => {
                    report(c.send(t('Selam!')), notify);
                  }}
                >
                  {t('Selam gönder')}
                </button>
              )
            }
          >
            {channel && t('Henüz mesaj yok. İlk mesajı sen gönder.')}
          </EmptyState>
        )}
        {c.loadingMessages && c.messages.length === 0 && (
          <div className="chat-loading" role="status" aria-label={t('Mesajlar yükleniyor')}>
            {Array.from({ length: 5 }, (_, i) => (
              <div className="chat-skeleton-message" key={i}>
                <i />
                <div>
                  <span />
                  <b style={{ width: i % 2 ? '90%' : '72%' }} />
                </div>
              </div>
            ))}
          </div>
        )}
        {c.messages.map((m, index) => {
          const previous = c.messages[index - 1];
          const day = new Date(m.timestamp).toLocaleDateString(locale, {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          });
          const newDay =
            !previous ||
            new Date(previous.timestamp).toLocaleDateString(locale) !==
              new Date(m.timestamp).toLocaleDateString(locale);
          const unread = previous?.id === unreadAnchor.current;
          const own = m.author.id === c.user?.id;
          // Poll cards only exist in community channels; DMs have no activity room.
          const pollId = channel?.spaceId ? chatPollId(m.content) : null;
          return (
            <Fragment key={m.id}>
              {newDay && (
                <div className="chat-date-divider">
                  <span>{day}</span>
                </div>
              )}
              {unread && (
                <div className="chat-unread-divider">
                  <span>{t('Yeni mesajlar')}</span>
                </div>
              )}
              <article
                id={`message-${m.id}`}
                tabIndex={-1}
                // Name colours come from tokens in reference-chat.css; only dev fixtures override them.
                style={
                  nameColors[m.author.id]
                    ? ({ '--message-name-color': nameColors[m.author.id] } as React.CSSProperties)
                    : undefined
                }
                className={`message ${own ? 'own' : ''}`}
              >
                <VoiceAvatar id={m.author.id} name={m.author.displayName || m.author.username} />
                <div className="message-body">
                  <div className="message-byline">
                    <button
                      className="message-author"
                      title={own ? t('Sen') : t('Üye seçenekleri')}
                      disabled={own}
                      onClick={() => setSelectedAuthor(m.author)}
                    >
                      <strong>{m.author.displayName || m.author.username}</strong>
                    </button>
                    <time dateTime={m.timestamp}>{clockText(m.timestamp)}</time>
                    {m.editedTimestamp && <span>{t('düzenlendi')}</span>}
                  </div>
                  {pollId ? (
                    <ChatPollCard channelId={m.channelId} pollId={pollId} content={m.content} />
                  ) : isGifMessage(m.content) ? (
                    <img className="chat-gif" src={m.content.trim()} alt="GIF" loading="lazy" />
                  ) : (
                    <p>{messageText(m.content)}</p>
                  )}
                  {!!m.attachments?.length && (
                    <div className="message-attachments">
                      {m.attachments.map((file) => (
                        <ChatAttachment
                          key={`${c.serverUrl}:${c.user?.id}:${file.id}`}
                          file={file}
                          channelId={m.channelId}
                          messageId={m.id}
                        />
                      ))}
                    </div>
                  )}
                  <div className="message-reactions">
                    {Object.entries(m.reactions ?? {})
                      .filter(([, people]) => people.length)
                      .sort(([left], [right]) => reactionOrder(left) - reactionOrder(right))
                      .map(([emoji, people]) => {
                        const option = reactionOption(emoji),
                          Reaction = option?.icon;
                        return (
                          <button
                            key={emoji}
                            className={`message-reaction ${people.includes(c.user?.id ?? '') ? 'selected' : ''}`}
                            aria-label={t('{name} reaksiyonu · {count}', {
                              name: option?.label ?? reactionEmoji(emoji),
                              count: people.length,
                            })}
                            aria-pressed={people.includes(c.user?.id ?? '')}
                            onClick={() => void react(m, emoji)}
                          >
                            {Reaction ? (
                              <Reaction size={14} />
                            ) : (
                              <span>{reactionEmoji(emoji)}</span>
                            )}
                            {people.length}
                          </button>
                        );
                      })}
                  </div>
                  {m.delivery === 'pending' && (
                    <span className="message-state">{t('Gönderiliyor…')}</span>
                  )}
                  {m.delivery === 'failed' && (
                    <span className="message-state failed">
                      <AlertCircle size={13} />
                      {t('Mesaj gönderilemedi')}{' '}
                      <button onClick={() => report(c.retryMessage(m.id), notify)}>
                        {t('Yeniden dene')}
                      </button>
                    </span>
                  )}
                </div>
                {m.delivery !== 'pending' && m.delivery !== 'failed' && (
                  <div className="message-actions">
                    <IconButton
                      label={t('Reaksiyon ekle')}
                      data-reaction-trigger
                      aria-expanded={reactionTarget?.id === m.id}
                      onClick={() =>
                        setReactionTarget((current) => (current?.id === m.id ? null : m))
                      }
                    >
                      <Smile size={16} />
                    </IconButton>
                    <IconButton label={t('Yanıtla')} onClick={() => startReply(m)}>
                      <CornerUpLeft size={16} />
                    </IconButton>
                    <IconButton label={t('Mesaj seçenekleri')} onClick={() => setOptions(m)}>
                      <MoreHorizontal size={16} />
                    </IconButton>
                  </div>
                )}
                {reactionTarget?.id === m.id && (
                  <div
                    ref={reactionPopover}
                    className="chat-reaction-popover"
                    role="dialog"
                    aria-label={t('Bir reaksiyon bırak')}
                  >
                    {reactionOptions.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        title={option.label}
                        aria-label={t('{name} reaksiyonunu ekle', { name: option.label })}
                        onClick={() => {
                          void react(m, option.emoji);
                          setReactionTarget(null);
                        }}
                      >
                        <option.icon size={18} />
                      </button>
                    ))}
                  </div>
                )}
              </article>
            </Fragment>
          );
        })}
      </div>
      {unseen && (
        <button
          className="new-messages"
          onClick={() => {
            if (log.current) log.current.scrollTop = log.current.scrollHeight;
            nearBottom.current = true;
            setUnseen(false);
          }}
        >
          {t('Yeni mesajlar')}
          <ArrowDown size={14} aria-hidden="true" />
        </button>
      )}
      {c.activeChannelId && (
        <div className="composer-wrap">
          {reply && !editing && (
            <div className="composer-editing composer-replying" role="status">
              <CornerUpLeft size={14} aria-hidden="true" />
              <span>
                {t('Yanıtlanıyor: {name}', {
                  name: reply.author.displayName || reply.author.username,
                })}
              </span>
              <span className="composer-reply-snippet" title={reply.content}>
                {reply.content}
              </span>
              <IconButton label={t('Yanıtı iptal et')} onClick={closeReply}>
                <X size={14} />
              </IconButton>
            </div>
          )}
          {editing && (
            <div className="composer-editing" role="status">
              <Edit3 size={14} />
              <span>{t('Mesajı düzenliyorsun · Enter kaydeder · Esc vazgeçer')}</span>
              {actionError && <span className="composer-editing-error">{actionError}</span>}
              <button type="button" disabled={actionBusy} onClick={closeEdit}>
                {t('Vazgeç')}
              </button>
            </div>
          )}
          {attachments.length > 0 && (
            <div className="pending-attachments">
              {attachments.map((file) => (
                <span key={file.id}>
                  <Paperclip size={13} />
                  {file.name}
                  <IconButton
                    label={t('Eki kaldır')}
                    onClick={() =>
                      void window.rooms?.social
                        .discardAttachment(file.id)
                        .then(() =>
                          setAttachments((items) => items.filter((f) => f.id !== file.id)),
                        )
                        .catch((e) => notify(uiError(e)))
                    }
                  >
                    <X size={12} />
                  </IconButton>
                </span>
              ))}
            </div>
          )}
          <form
            className="chat-composer"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <IconButton
              label={
                editing
                  ? t('Düzenlerken dosya eklenemez')
                  : uploading
                    ? t('Dosya yükleniyor')
                    : t('Dosya ekle')
              }
              disabled={!c.activeChannelId || uploading || attachments.length >= 5 || !!editing}
              onClick={() => void attach()}
            >
              <Plus size={20} />
            </IconButton>
            {mentionInput.menu}
            <textarea
              ref={mentionInput.input}
              aria-controls={mentionInput.open ? mentionInput.menuId : undefined}
              aria-autocomplete="list"
              aria-activedescendant={mentionInput.activeOptionId}
              aria-expanded={mentionInput.open}
              onSelect={mentionInput.onSelect}
              aria-label={editing ? t('Mesajı düzenle') : t('Kanala mesaj yaz')}
              rows={1}
              value={draft}
              maxLength={4000}
              disabled={!c.activeChannelId}
              placeholder={
                composerPlaceholder ??
                (channel
                  ? t('{name} kanalına mesaj yaz', {
                      name: `${channel.type === 0 ? '#' : ''}${channel.name}`,
                    })
                  : t('Kanal seç'))
              }
              onChange={(e) => mentionInput.change(e.target.value, e.target.selectionStart)}
              onPaste={(e) => {
                if (editing) return;
                const data = e.clipboardData;
                const items = [...data.items]
                  .filter((item) => item.kind === 'file')
                  .map((item) => item.getAsFile())
                  .filter((file): file is File => !!file);
                const files = items.length ? items : [...data.files];
                if (files.length) {
                  e.preventDefault();
                  void addFiles(files);
                } else if (data.types.includes('Files') || !data.types.includes('text/plain')) {
                  e.preventDefault();
                  void pasteFromClipboard();
                }
              }}
              onKeyDown={(e) => {
                if (mentionInput.onKeyDown(e)) return;
                if (e.key === 'Escape' && editing) {
                  e.preventDefault();
                  e.stopPropagation();
                  closeEdit();
                  return;
                }
                if (e.key === 'Escape' && reply) {
                  e.preventDefault();
                  e.stopPropagation();
                  closeReply();
                  return;
                }
                if (e.key === 'ArrowUp' && !draft && !editing && !e.nativeEvent.isComposing) {
                  const own = [...c.messages]
                    .reverse()
                    .find((m) => m.author.id === c.user?.id && m.delivery !== 'failed');
                  if (own) {
                    e.preventDefault();
                    startEdit(own);
                  }
                  return;
                }
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            {picker && (
              <div className="composer-popover" ref={pickerRef}>
                {picker === 'gif' ? (
                  <GifPicker
                    onClose={() => setPicker(null)}
                    onPick={(gif) => {
                      setPicker(null);
                      nearBottom.current = true;
                      report(c.send(gif.gif.url, []), notify);
                    }}
                  />
                ) : picker === 'emoji' ? (
                  <EmojiPicker onClose={() => setPicker(null)} onPick={insertEmoji} />
                ) : (
                  <AppDirectory onClose={() => setPicker(null)} />
                )}
              </div>
            )}
            <IconButton
              label={t('GIF gönder')}
              data-composer-picker
              aria-expanded={picker === 'gif'}
              disabled={!c.activeChannelId || !!editing}
              onClick={() => setPicker((value) => (value === 'gif' ? null : 'gif'))}
            >
              <span className="composer-gif-label">GIF</span>
            </IconButton>
            <IconButton
              label={t('Emoji ekle')}
              data-composer-picker
              aria-expanded={picker === 'emoji'}
              disabled={!c.activeChannelId}
              onClick={() => setPicker((value) => (value === 'emoji' ? null : 'emoji'))}
            >
              <Smile size={20} />
            </IconButton>
            <IconButton
              label={t('Uygulamalar ve etkinlikler')}
              data-composer-picker
              aria-expanded={picker === 'apps'}
              onClick={() => setPicker((value) => (value === 'apps' ? null : 'apps'))}
            >
              <LayoutGrid size={20} />
            </IconButton>
            {channel?.spaceId && (
              <IconButton
                label={t('Anket')}
                disabled={!!editing}
                onClick={() => {
                  setPicker(null);
                  setPollComposer(true);
                }}
              >
                <BarChart3 size={20} />
              </IconButton>
            )}
            {assistant && (
              <IconButton
                label={t('Asistanı etiketle')}
                onClick={() => {
                  setDraft((value) => (value.startsWith('@agent') ? value : `@agent ${value}`));
                  mentionInput.input.current?.focus();
                }}
              >
                <Bot size={20} />
              </IconButton>
            )}
            <button
              type="submit"
              className="send-button"
              aria-label={editing ? t('Değişiklikleri kaydet') : t('Mesajı gönder')}
              disabled={
                editing
                  ? actionBusy || !draft.trim()
                  : (!draft.trim() && !attachments.length) || !c.activeChannelId || uploading
              }
            >
              <Send size={20} />
            </button>
          </form>
          <div className="composer-foot">
            {typingUsers.length > 0 && (
              <span className="chat-typing" role="status">
                <span aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                {t('{names} yazıyor…', {
                  names: typingUsers.map((u) => u.displayName || u.username).join(', '),
                  count: typingUsers.length,
                })}
              </span>
            )}
          </div>
        </div>
      )}
      {pollComposer && channel?.spaceId && (
        <ChatPollComposer
          key={channel.id}
          channelId={channel.id}
          channelName={channel.name}
          onClose={closePollComposer}
          notify={notify}
        />
      )}
      {reminder && c.activeChannelId && (
        <MessageReminder
          message={reminder}
          roomId={reminder.channelId}
          channelName={channel?.name ?? t('Sohbet')}
          onClose={closeReminder}
          notify={notify}
        />
      )}
      {agentPrompt && c.activeChannelId && (
        <ChatAgentRequest
          roomId={c.activeChannelId}
          prompt={agentPrompt}
          onClose={closeAgent}
          notify={notify}
        />
      )}
      {selectedAuthor && (
        <Modal
          title={
            confirmRemoval
              ? tr('Remove this member?')
              : selectedAuthor.displayName || selectedAuthor.username
          }
          onClose={closeAuthor}
        >
          <div className="profile-preview">
            <Avatar name={selectedAuthor.displayName || selectedAuthor.username} size="large" />
            <div>
              <h3>{selectedAuthor.displayName || selectedAuthor.username}</h3>
              <span className="small-tag">{tr('PRIVATE COMMUNITY MEMBER')}</span>
            </div>
          </div>
          {confirmRemoval ? (
            <>
              <p className="modal-description">
                {tr('Remove') + ' '}
                {selectedAuthor.displayName || selectedAuthor.username}
                {' ' + tr('from') + ' '}
                {c.spaces.find((s) => s.id === c.activeSpaceId)?.name}
                {tr(
                  '? They will need a new invitation to return. The server verifies your permission.',
                )}
              </p>
              <div className="button-row">
                <button
                  className="button secondary"
                  disabled={memberBusy}
                  onClick={() => setConfirmRemoval(false)}
                >
                  {tr('Keep member')}
                </button>
                <button
                  className="button danger"
                  disabled={memberBusy}
                  onClick={() => {
                    setMemberBusy(true);
                    void window
                      .rooms!.social.removeMember(c.activeSpaceId!, selectedAuthor.id)
                      .then(() => {
                        notify(tr('Member removed from this private space.'));
                        closeAuthor();
                      })
                      .catch((e) => setMemberError(uiError(e)))
                      .finally(() => setMemberBusy(false));
                  }}
                >
                  {memberBusy ? tr('Removing\u2026') : tr('Remove member')}
                </button>
              </div>
            </>
          ) : (
            <>
              <button
                className="button primary full"
                disabled={memberBusy}
                onClick={() => {
                  setMemberBusy(true);
                  void c
                    .createDM(selectedAuthor.id)
                    .then(closeAuthor)
                    .catch((e) => {
                      if (directMessageFailed(e, selectedAuthor, setMemberError)) closeAuthor();
                    })
                    .finally(() => setMemberBusy(false));
                }}
              >
                <MessageCircle size={16} />
                {tr('Open direct message')}
              </button>
              <FriendRequestButton key={selectedAuthor.id} user={selectedAuthor} />
              <div className="member-actions">
                <button
                  className="button secondary small"
                  disabled={memberBusy}
                  onClick={() => {
                    setMemberBusy(true);
                    void window
                      .rooms!.social.blockUser(selectedAuthor.id)
                      .then(() =>
                        notify(tr('Member blocked. Your server applies the relationship.')),
                      )
                      .catch((e) => setMemberError(uiError(e)))
                      .finally(() => setMemberBusy(false));
                  }}
                >
                  {tr('Block member')}
                </button>
                <button
                  className="button secondary small"
                  disabled={memberBusy}
                  onClick={() => {
                    setMemberBusy(true);
                    void window
                      .rooms!.social.unblockUser(selectedAuthor.id)
                      .then(() => notify(tr('Member unblocked.')))
                      .catch((e) => setMemberError(uiError(e)))
                      .finally(() => setMemberBusy(false));
                  }}
                >
                  {tr('Unblock member')}
                </button>
              </div>
              {communityAdmin && (
                <button
                  className="button secondary full destructive"
                  disabled={memberBusy}
                  onClick={() => setConfirmRemoval(true)}
                >
                  <Trash2 size={15} />
                  {tr('Remove from this space')}
                </button>
              )}
            </>
          )}
          {memberError && <Notice kind="error">{memberError}</Notice>}
        </Modal>
      )}
      {options && (
        <Modal
          title={t('Mesaj seçenekleri')}
          className="chat-message-modal chat-options-modal"
          onClose={closeOptions}
          footer={
            <button className="button subtle" onClick={closeOptions}>
              {t('Kapat')}
            </button>
          }
        >
          <div className="chat-modal-body chat-option-list">
            <button
              onClick={() => {
                startReply(options);
                closeOptions();
              }}
            >
              <CornerUpLeft size={20} />
              {t('Yanıtla')}
            </button>
            <button
              disabled={options.author.id !== c.user?.id}
              title={
                options.author.id !== c.user?.id
                  ? t('Yalnızca kendi mesajını düzenleyebilirsin')
                  : undefined
              }
              onClick={() => {
                startEdit(options);
                closeOptions();
              }}
            >
              <Edit3 size={20} />
              {t('Düzenle')}
            </button>
            <button
              onClick={() => {
                setReactionTarget(options);
                closeOptions();
              }}
            >
              <Smile size={20} />
              {t('Reaksiyon ekle')}
            </button>
            <button
              disabled={options.author.id !== c.user?.id && !moderates}
              title={
                options.author.id !== c.user?.id && !moderates
                  ? t('Başkasının mesajını silmek için bu kanalda mesajları yönetme iznin olmalı')
                  : undefined
              }
              onClick={() => {
                setDeleting(options.id);
                setActionError('');
                closeOptions();
              }}
            >
              <Trash2 size={20} />
              {t('Mesajı sil')}
            </button>
            <div className="chat-extra-actions">
              {assistant && (
                <button
                  onClick={() => {
                    setAgentPrompt(options.content);
                    closeOptions();
                  }}
                >
                  <Bot size={16} />
                  {t('Asistana gönder')}
                </button>
              )}
              <button
                onClick={() => {
                  setReminder(options);
                  closeOptions();
                }}
              >
                <Clock3 size={16} />
                {t('Hatırlat')}
              </button>
              {assistant && (
                <button
                  onClick={() => {
                    saveMemory(options);
                    closeOptions();
                  }}
                >
                  <BookmarkPlus size={16} />
                  {t('Oda hafızasına kaydet')}
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}
      {deleting && (
        <Modal
          title={t('Mesajı sil?')}
          className="chat-message-modal chat-delete-modal"
          onClose={closeDelete}
          footer={
            <>
              <button className="button secondary" disabled={actionBusy} onClick={closeDelete}>
                {t('Vazgeç')}
              </button>
              <button
                className="button danger"
                disabled={actionBusy}
                onClick={() => {
                  setActionBusy(true);
                  setActionError('');
                  void c
                    .deleteMessage(deleting)
                    .then(closeDelete)
                    .catch((error) => setActionError(uiError(error)))
                    .finally(() => setActionBusy(false));
                }}
              >
                {t('Mesajı sil')}
              </button>
            </>
          }
        >
          <div className="chat-modal-body">
            <p>{t('Bu mesaj kanaldaki herkes için silinecek. Bu işlem geri alınamaz.')}</p>
            {(() => {
              const target = c.messages.find((m) => m.id === deleting);
              if (!target) return null;
              const name = target.author.displayName || target.author.username;
              return (
                <div className="chat-delete-preview">
                  <VoiceAvatar id={target.author.id} name={name} />
                  <div>
                    <strong>{name}</strong>
                    <p>{target.content}</p>
                  </div>
                </div>
              );
            })()}
            {actionError && <Notice kind="error">{actionError}</Notice>}
          </div>
        </Modal>
      )}
    </div>
  );
}
export function CommunitySpaces({ notify }: { notify(message: string): void }) {
  const c = useCommunity();
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const close = useCallback(() => setShow(false), []);
  return (
    <div className="spaces-page page-enter">
      <div className="page-intro">
        <h2>{t('Topluluklar')}</h2>
        <button className="button secondary" onClick={() => setShow(true)}>
          <Link size={16} />
          {tr('Join with an invite')}
        </button>
      </div>
      {c.spaces.length ? (
        <div className="spaces-grid">
          {c.spaces.map((s) => (
            <button
              key={s.id}
              className="space-card real-space-card"
              onClick={() => {
                void c.openSpace(s.id);
                navigate('/chat');
              }}
            >
              <div className="space-card-art">
                <span className="space-monogram">
                  {s.name.slice(0, 1)}
                  <span>.</span>
                </span>
              </div>
              <div className="space-card-copy">
                <h3>
                  {s.name}
                  <ArrowRight size={17} />
                </h3>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <EmptyState icon={<Users size={32} />} title={t('Topluluk yok')}>
          {''}
        </EmptyState>
      )}
      {show && (
        <Modal title={t('Davetle katıl')} onClose={close}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const link = parseInviteLink(code, { fallbackServer: c.serverUrl });
              if (!link)
                return notify(
                  t(
                    'Bu bir Tayfa davet bağlantısı değil. Seni davet eden kişinin gönderdiği bağlantıyı yapıştır.',
                  ),
                );
              if (!sameInviteServer(link.serverUrl, c.serverUrl))
                return notify(
                  t(
                    'Bu davet başka bir sunucuda. Katılmak için çıkış yapıp bağlantıyı yeniden aç.',
                  ),
                );
              setBusy(true);
              void c
                .acceptInvite(link.code)
                .then(() => {
                  setCode('');
                  close();
                })
                .catch((e) => notify(uiError(e)))
                .finally(() => setBusy(false));
            }}
          >
            <label className="field-label">
              {t('Davet bağlantısı')}
              <input
                required
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="https://…/davet/…"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                maxLength={4096}
              />
            </label>
            <button type="submit" className="button primary full" disabled={!code.trim() || busy}>
              {busy ? tr('Joining\u2026') : tr('Join private space')}
              <ArrowRight size={16} />
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
export function CommunityVoice({
  openLauncher,
  notify,
}: {
  openLauncher(): void;
  notify(message: string): void;
}) {
  const c = useCommunity(),
    r = useRealtime(),
    navigate = useNavigate(),
    location = useLocation();
  const pushToTalk = useRooms((s) => s.preferences.pushToTalk);
  const fixtureParams = import.meta.env.DEV ? new URLSearchParams(window.location.search) : null;
  const familiarRoom = true;
  const emptyFixture =
    fixtureParams?.get('fixture')?.toUpperCase() === 'S19' &&
    fixtureParams.get('variant') === 'empty';
  const focusFixture =
    fixtureParams?.get('fixture')?.toUpperCase() === 'S20' &&
    fixtureParams.get('variant') === 'focus';
  const shareFixtureVariant =
    fixtureParams?.get('fixture')?.toUpperCase() === 'S22' ? fixtureParams.get('variant') : null;
  const fixtureRoom = emptyFixture
    ? c.channels.find((channel) => channel.type === 2 && channel.name === places.lounge)
    : undefined;
  const selectedRoom = c.channels.find((ch) => ch.id === c.activeChannelId && ch.type === 2);
  const stageRoom = emptyFixture ? fixtureRoom : selectedRoom;
  const roomName =
    r.roomName ??
    selectedRoom?.name ??
    (emptyFixture ? (fixtureRoom?.name ?? t('Ses odası')) : null);
  const [member, setMember] = useState<string | null>(null),
    [inviting, setInviting] = useState(false),
    [layout, setLayout] = useState<'gallery' | 'focus'>(() => (focusFixture ? 'focus' : 'gallery')),
    [focus, setFocus] = useState<string | null>(null);
  const close = useCallback(() => setMember(null), []),
    closeInvite = useCallback(() => setInviting(false), []);
  const person = r.participants.find((p) => p.id === member);
  const cameras = r.tracks.filter(
    (track) => track.source === 'camera' && track.kind === 'video' && !track.muted,
  );
  const screens = r.tracks.filter(
    (track) => track.source === 'screen_share' && track.kind === 'video' && !track.muted,
  );
  const hadScreen = useRef(shareFixtureVariant === 'source_closed');
  useEffect(() => {
    hadScreen.current = shareFixtureVariant === 'source_closed';
  }, [r.channelId, shareFixtureVariant]);
  useEffect(() => {
    if (screens.length) hadScreen.current = true;
  }, [screens.length]);
  const view = new URLSearchParams(location.search).get('view');
  const video = view === 'video' || (view !== 'share' && cameras.length > 0),
    share = view === 'share';
  const connected = r.status === 'connected';
  const focused =
    r.participants.find((p) => p.id === focus) ??
    r.participants.find((p) => p.speaking && !p.muted) ??
    r.participants[0];
  const channels = c.channels.filter((ch) => ch.type === 2);
  const shownParticipants = focusFixture
    ? r.participants.filter((p) => p.id !== 'demo-mert')
    : r.participants;
  const chooseSource = () => window.dispatchEvent(new Event('rooms:choose-capture'));
  const tile = (p: (typeof r.participants)[number]) => {
    const camera = cameras.find((track) => track.participantId === p.id),
      silenced = silencedHere(p),
      speaking = connected && p.speaking && !p.muted && !silenced;
    return (
      <button
        key={p.id}
        data-voice-participant-id={p.id}
        className={`reference-participant ${video ? 'video-tile' : ''} ${speaking ? 'speaking' : ''} ${camera ? 'with-camera' : ''} ${layout === 'focus' && focused?.id === p.id ? 'focused' : ''}`}
        onClick={() => (video && layout === 'focus' ? setFocus(p.id) : setMember(p.id))}
        aria-label={[
          p.name,
          speaking && t('konuşuyor'),
          p.muted && t('mikrofon kapalı'),
          p.deafened && t('sağırlaştırdı'),
          silenced && t('sesini kapattın'),
        ]
          .filter(Boolean)
          .join(', ')}
      >
        {camera ? (
          <MediaStage
            id={camera.id}
            label={t('{name} kamerası', { name: p.name })}
            className="voice-camera"
          />
        ) : (
          <span className="reference-participant-avatar">
            <VoiceAvatar id={p.id} name={p.name} large />
          </span>
        )}
        <span className="reference-participant-status">
          {p.screen && <MonitorUp size={15} aria-label={t('Ekran paylaşıyor')} />}
          {silenced && <VolumeX size={15} aria-label={t('Sesini kapattın, yalnızca sende')} />}
          {p.deafened && <ReferenceIcon name="headphones-off" size={15} />}
          {video ? (
            <ReferenceIcon name={camera ? 'video' : 'video-off'} size={15} />
          ) : speaking ? (
            <span className="reference-audio-bars">
              <i />
              <i />
              <i />
              <i />
            </span>
          ) : (
            <ReferenceIcon name={p.muted ? 'mic-off' : 'mic'} size={15} />
          )}
        </span>
        <span className="reference-participant-name">
          {video &&
            (speaking ? (
              <span className="reference-audio-bars">
                <i />
                <i />
                <i />
                <i />
              </span>
            ) : (
              <ReferenceIcon name={p.muted ? 'mic-off' : 'mic'} size={13} />
            ))}
          <span title={p.name}>
            {p.name}
            {p.local ? ` ${t('(sen)')}` : ''}
          </span>
          {video && !camera && <small>{t('kamera kapalı')}</small>}
        </span>
      </button>
    );
  };
  const shareTile = (track: (typeof screens)[number]) => {
    const presenter =
      r.participants.find((p) => p.id === track.participantId)?.name ?? t('Katılımcı');
    return (
      <button
        className="room-share-preview"
        key={track.id}
        aria-label={t('{name} ekranını izle', { name: presenter })}
        onClick={() => navigate(`/voice?view=share&screen=${encodeURIComponent(track.id)}`)}
      >
        {track.local ? (
          <MediaStage id={track.id} label={t('Ekran paylaşımı önizlemesi')} />
        ) : (
          // Remote streams are not downloaded until this listener chooses to watch.
          <span className="room-share-invite">
            <MonitorUp size={30} />
            <strong>{t('Yayını izle')}</strong>
          </span>
        )}
        <span>
          <MonitorUp size={14} />
          {presenter}
          {track.local ? ` ${t('(sen)')}` : ''}
          <small>{viewerSummary(r.participants, track.participantId)}</small>
        </span>
      </button>
    );
  };
  return (
    <div
      className={`discord-voice-page reference-voice-page page-enter ${familiarRoom ? 'familiar-room' : ''} ${video ? 'is-video' : ''} ${share ? 'is-screen' : ''}`}
    >
      <header className="reference-voice-heading">
        <div>
          <span className="reference-voice-eyebrow">
            {share ? t('Ekran paylaşımı') : video ? t('Görüntülü oda') : t('Ses odası')}
          </span>
          <h2 title={roomName ?? undefined}>{roomName ?? t('Ses odaları')}</h2>
          <p>
            {emptyFixture
              ? t('Şimdilik sessiz. İlk sen gel.')
              : r.busy
                ? t('Bağlanıyor…')
                : connected
                  ? video
                    ? t('{boxes} kamera kutusu · {count} kişi sesli sohbette', {
                        boxes: shownParticipants.length,
                        count: r.participants.length,
                      })
                    : t('{count} kişi odada', { count: r.participants.length })
                  : r.status === 'reconnecting'
                    ? t('Yeniden bağlanıyor…')
                    : r.channelId
                      ? t('Bağlantı kesildi')
                      : selectedRoom
                        ? t('Henüz bu odada değilsin.')
                        : t('Bir ses odası seç.')}
          </p>
        </div>
        <div className="reference-voice-header-actions">
          {video && (
            <div className="segmented" aria-label={t('Kamera düzeni')}>
              <button
                aria-pressed={layout === 'gallery'}
                className={layout === 'gallery' ? 'selected' : ''}
                onClick={() => setLayout('gallery')}
              >
                <ReferenceIcon name="grid" size={15} />
                {t('Galeri')}
              </button>
              <button
                aria-pressed={layout === 'focus'}
                className={layout === 'focus' ? 'selected' : ''}
                onClick={() => setLayout('focus')}
              >
                <ReferenceIcon name="maximize" size={15} />
                {t('Odak')}
              </button>
            </div>
          )}
          {share && r.sharing && (
            <button
              className="button secondary"
              disabled={!connected}
              onClick={() => report(stopScreen().then(chooseSource), notify)}
            >
              <ReferenceIcon name="monitor" size={16} />
              {t('Kaynağı değiştir')}
            </button>
          )}
          {!share && (
            <button
              className="button secondary"
              disabled={!stageRoom}
              title={stageRoom ? undefined : t('Stüdyoyu açmak için önce bir ses odası seç.')}
              onClick={() => stageRoom && navigate(`/studio/${stageRoom.id}`)}
            >
              <ReferenceIcon name="headphones" size={16} />
              {t('Stüdyo')}
            </button>
          )}
          {!share && !video && (
            <button className="button secondary" onClick={() => setInviting(true)}>
              <ReferenceIcon name="plus" size={16} />
              {t('Arkadaş davet et')}
            </button>
          )}
        </div>
      </header>
      <VoiceRejoinNotice />
      {r.channelId && !connected && (
        <div className="reference-media-notice" role="status">
          <ReferenceIcon name="alert-triangle" size={18} />
          <span>
            {r.busy
              ? t('Odaya bağlanılıyor.')
              : r.status === 'reconnecting'
                ? t('Ses bağlantısı yeniden kuruluyor.')
                : t('Ses bağlantısı kesildi.')}
          </span>
          <button
            className="button secondary small"
            disabled={r.busy}
            onClick={() => report(joinVoice(r.channelId!, r.roomName ?? t('Ses')), notify)}
          >
            {t('Yeniden bağlan')}
          </button>
        </div>
      )}
      {share && shareFixtureVariant === 'handover' && (
        <div className="reference-share-handover-banner" role="status">
          <ReferenceIcon name="alert-triangle" size={17} />
          <span>{t('Deniz’in paylaşımı durdu. Ece’nin seçimi bekleniyor.')}</span>
        </div>
      )}
      {share && shareFixtureVariant === 'source_closed' && (
        <div className="reference-media-notice" role="status">
          <ReferenceIcon name="alert-triangle" size={18} />
          <span>
            {t('Kaynak kapanması oturum devriyle çözülemez; yeni bir ekran kaynağı gerekiyor.')}
          </span>
        </div>
      )}
      {!r.channelId || emptyFixture ? (
        // One stage for every "not in a room yet" state: the selected room, a room list, or none.
        <div className="reference-voice-empty-stage">
          <div>
            <ReferenceIcon name="headphones" size={42} />
            {stageRoom ? (
              <>
                <h3>{t('Oda sana hazır')}</h3>
                <p>
                  {t(
                    'Katıldığında arkadaşların seni burada görebilir. Mikrofonunu açmak tamamen sana bağlı.',
                  )}
                </p>
                <button
                  className="button primary"
                  disabled={r.busy}
                  onClick={() => report(joinVoice(stageRoom.id, stageRoom.name), notify)}
                >
                  <ReferenceIcon name="headphones" size={17} />
                  {r.busy ? t('Bağlanıyor…') : t('Katıl')}
                </button>
              </>
            ) : channels.length ? (
              <>
                <h3>{t('Bir ses odası seç')}</h3>
                <p>{t('Katıldığında arkadaşların seni burada görebilir.')}</p>
                <div className="voice-join-list">
                  {channels.map((ch) => (
                    <button
                      className="button secondary"
                      disabled={r.busy}
                      key={ch.id}
                      title={ch.name}
                      onClick={() => report(joinVoice(ch.id, ch.name), notify)}
                    >
                      <ReferenceIcon name="volume" size={18} />
                      <span className="voice-join-name">{ch.name}</span>
                      <span>{t('Katıl')}</span>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <h3>{t('Henüz ses odası yok')}</h3>
                <p>{t('Topluluğa bir ses odası eklendiğinde burada görünür.')}</p>
              </>
            )}
          </div>
        </div>
      ) : share ? (
        <div className="reference-share-content">
          {screens.length > 0 ? (
            <>
              <div className="reference-share-banner">
                <ReferenceIcon name="monitor" size={17} />
                <span>
                  {r.sharing ? t('Ekran paylaşımın açık') : t('Ekran paylaşımını izliyorsun')}
                </span>
                {!r.sharing && <span className="reference-watching-pill">{t('İzliyorsun')}</span>}
                <small className="reference-share-viewers">
                  {viewerSummary(
                    r.participants,
                    r.sharing
                      ? r.participants.find((p) => p.local)?.id
                      : r.participants.find((p) => p.local)?.watching,
                    true,
                  )}
                </small>
                {!r.sharing && (
                  <button
                    className="button secondary small"
                    onClick={() => {
                      watchScreen(null);
                      navigate('/voice');
                    }}
                  >
                    {t('İzlemeyi bırak')}
                  </button>
                )}
                {r.sharing && <ShareAudioBadge on={!!r.sharingAudio} />}
                {r.sharing && (
                  <button
                    className="button danger small"
                    onClick={() => report(stopScreen(), notify)}
                  >
                    {t('Paylaşımı durdur')}
                  </button>
                )}
              </div>
              <ScreenShareGallery
                onWatch={watchScreen}
                onVolume={setScreenVolume}
                quality={r.screenQuality ?? 'auto'}
                onQuality={setScreenQuality}
                onClose={() => {
                  watchScreen(null);
                  navigate('/voice');
                }}
                initialTrackId={new URLSearchParams(location.search).get('screen') ?? undefined}
                tracks={screens}
                people={r.participants}
                renderTrack={(id, label) => <MediaStage key={id} id={id} label={label} />}
                notify={notify}
              />
            </>
          ) : (
            <div className="reference-voice-empty">
              <ReferenceIcon name="monitor" size={40} />
              {shareFixtureVariant === 'handover' ? (
                <>
                  <h3>{t('Yeni paylaşım bekleniyor')}</h3>
                  <p>
                    {t(
                      'Sunma hakkı Ece’ye geçti. Ece kendi cihazından bir kaynak seçip paylaşımı başlatmalı.',
                    )}
                  </p>
                  <button className="button primary" onClick={() => navigate('/voice')}>
                    <ReferenceIcon name="headphones" size={17} />
                    {t('Salona dön')}
                  </button>
                </>
              ) : (
                <>
                  <h3>
                    {hadScreen.current ? t('Paylaşılan pencere kapandı') : t('Ekran paylaşımı yok')}
                  </h3>
                  <p>
                    {shareFixtureVariant === 'source_closed'
                      ? t(
                          'Paylaşılan ekran artık kullanılamıyor. Oturumu Ece düzenliyor; oynatmak için yeni bir kaynak gerekiyor.',
                        )
                      : t('Yeni paylaşım için bu cihazdan bir kaynak seç.')}
                  </p>
                  <button className="button primary" disabled={!connected} onClick={chooseSource}>
                    <ReferenceIcon name="monitor" size={17} />
                    {shareFixtureVariant === 'source_closed'
                      ? t('Yeni kaynak paylaş')
                      : t('Kaynak seç')}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className={`reference-voice-grid-wrap ${video ? 'video' : ''}`}>
          <div
            className={`reference-participant-grid ${video ? 'video-grid' : ''} ${video && layout === 'focus' ? 'focus-grid' : ''} ${r.participants.length <= 2 ? 'small-room' : ''}`}
            style={
              familiarRoom
                ? ({
                    '--room-columns': shownParticipants.length <= 4 ? 2 : 3,
                    '--room-rows': Math.ceil(
                      (shownParticipants.length +
                        screens.length +
                        (shownParticipants.length === 1 ? 1 : 0)) /
                        (shownParticipants.length <= 4 ? 2 : 3),
                    ),
                  } as React.CSSProperties)
                : undefined
            }
          >
            {/* A shared screen sits right after its presenter, so it reads as theirs. */}
            {shownParticipants.flatMap((p) => [
              tile(p),
              ...screens.filter((track) => track.participantId === p.id).map(shareTile),
            ])}
            {screens
              .filter((track) => !shownParticipants.some((p) => p.id === track.participantId))
              .map(shareTile)}
            {familiarRoom && shownParticipants.length === 1 ? (
              <div className="room-activity-tile">
                <div className="room-activity-illustration" aria-hidden="true">
                  <Gem size={90} />
                  <Trophy size={110} />
                  <Dice5 size={70} />
                </div>
                <div>
                  <button className="button secondary" onClick={() => setInviting(true)}>
                    <ReferenceIcon name="user-plus" size={18} />
                    {t('Arkadaş davet et')}
                  </button>
                  <button className="button secondary" onClick={openLauncher}>
                    <ReferenceIcon name="grid" size={18} />
                    {t('Etkinlikler')}
                  </button>
                </div>
              </div>
            ) : (
              !video &&
              !familiarRoom && (
                <button
                  className="reference-participant invite-tile"
                  onClick={() => setInviting(true)}
                >
                  <span>
                    <ReferenceIcon name="plus" size={24} />
                  </span>
                  <strong>{t('Arkadaş davet et')}</strong>
                </button>
              )
            )}
            {!r.participants.length && (
              <p className="muted">{r.busy ? t('Bağlanıyor…') : t('Katılımcı yok.')}</p>
            )}
          </div>
        </div>
      )}
      {!share && screens.length > 0 && (
        <button className="room-watch-share" onClick={() => navigate('/voice?view=share')}>
          <MonitorUp size={16} />
          {t('Ekran paylaşımını izle')}
        </button>
      )}

      {pushToTalk && !video && !share && r.channelId && (
        <div className="reference-media-notice reference-ptt-notice">
          <ReferenceIcon name="mic" size={17} />
          <PushToTalkNotice />
        </div>
      )}
      {r.channelId && !video && !share && (
        <div className="reference-voice-meta">
          <span>
            <ReferenceIcon name="headphones" size={13} />
            {connected
              ? t('{name} odasına bağlısın', { name: r.roomName ?? '' })
              : t('Bağlantı bekleniyor')}
          </span>
          <button onClick={() => navigate('/settings?tab=audio')}>
            <ReferenceIcon name="settings" size={13} />
            {t('Ses ayarları')}
          </button>
          <button onClick={openLauncher}>
            <ReferenceIcon name="grid" size={13} />
            {t('Etkinlikler')}
          </button>
        </div>
      )}
      {r.error && (
        <div className="reference-media-notice" role="alert">
          <ReferenceIcon name="alert-triangle" size={18} />
          <span>{r.error}</span>
          <button
            className="button secondary small"
            onClick={() => navigate('/settings?tab=audio')}
          >
            {t('Cihaz ayarları')}
          </button>
        </div>
      )}
      <VoiceRoomViewActions notify={notify} />
      {person && (
        <Modal title={person.name} onClose={close}>
          <div className="voice-member-profile">
            <VoiceAvatar id={person.id} name={person.name} large />
            <span>
              {person.muted
                ? t('Mikrofon kapalı')
                : connected && person.speaking
                  ? t('Konuşuyor')
                  : t('Dinliyor')}
            </span>
          </div>
          {!person.local && (
            <>
              <label className="field-label">
                {t('Kişisel ses · {percent}%', { percent: Math.round(person.volume * 100) })}
                <input
                  type="range"
                  aria-label={t('Katılımcı sesi')}
                  min={0}
                  max={1}
                  step={0.01}
                  value={person.volume}
                  onChange={(e) => setParticipantVolume(person.id, Number(e.target.value))}
                />
              </label>
              {!person.id.startsWith('rooms-music-') && (
                <button
                  className="button secondary"
                  onClick={() =>
                    void c
                      .createDM(person.id)
                      .then(() => {
                        close();
                        navigate('/chat');
                      })
                      .catch((e) => {
                        const user = {
                          id: person.id,
                          username: person.name,
                          displayName: person.name,
                          avatar: null,
                        };
                        if (directMessageFailed(e, user, notify)) close();
                      })
                  }
                >
                  <MessageCircle size={16} />
                  {t('Mesaj gönder')}
                </button>
              )}
            </>
          )}
          {person.local && (
            <button
              className="button secondary"
              onClick={() => {
                close();
                navigate('/settings?tab=audio');
              }}
            >
              {t('Ses ayarları')}
            </button>
          )}
        </Modal>
      )}
      {inviting && <CommunityInvite onClose={closeInvite} notify={notify} />}
      {shareFixtureVariant === 'request' && (
        <Modal
          title={t('Ece ekranını paylaşmak istiyor')}
          onClose={() => navigate('/voice?view=share')}
          className="reference-share-intent-modal"
        >
          <div className="reference-share-intent-person">
            <VoiceAvatar id="demo-ece" name="Ece" large />
            <div>
              <strong>Ece</strong>
              <p>{t('“Şu pencereyi gösterebilir miyim?”')}</p>
            </div>
          </div>
          <div className="reference-share-intent-callout">
            <ReferenceIcon name="monitor" size={17} />
            <span>
              {t(
                'Kabul edersen mevcut paylaşımın durur. Ece kendi ekranını seçip başlatana kadar oda yeni kaynak bekler.',
              )}
            </span>
          </div>
          <p className="reference-share-intent-note">
            {t('Salon’daki sesli sohbet devam eder. Talebi reddetmek Ece’yi odadan çıkarmaz.')}
          </p>
          <div className="button-row">
            <button
              className="button secondary"
              onClick={() =>
                report(decideScreenHandoff('20000000-0000-4000-8000-000000000022', false), notify)
              }
            >
              {t('Şimdilik reddet')}
            </button>
            <button
              className="button primary"
              onClick={() =>
                report(decideScreenHandoff('20000000-0000-4000-8000-000000000022', true), notify)
              }
            >
              <ReferenceIcon name="arrow-right" size={16} />
              {t('Paylaşımı devret')}
            </button>
          </div>
        </Modal>
      )}
      {shareFixtureVariant === 'request_sent' && (
        <Modal
          title={t('Paylaşım talebin Ece’ye iletildi')}
          onClose={() => navigate('/voice?view=share')}
          className="reference-share-intent-modal"
        >
          <div className="reference-share-intent-person">
            <VoiceAvatar id="demo-ece" name="Ece" large />
            <div>
              <strong>{t('Ece ekranını paylaşıyor')}</strong>
              <p>{t('Onay verdiğinde kendi kaynağını seçebilirsin.')}</p>
            </div>
          </div>
          <div className="reference-share-intent-callout">
            <ReferenceIcon name="monitor" size={17} />
            <span>
              {t(
                'Ece’nin paylaşımı onay verilene kadar devam eder. Kaynak ve ekran kaydı otomatik olarak senin bilgisayarına taşınmaz.',
              )}
            </span>
          </div>
          <p className="reference-share-intent-note">
            {t('Bu sırada odadaki sesli sohbet devam eder.')}
          </p>
          <div className="button-row">
            <button
              className="button secondary"
              onClick={() => report(cancelScreenHandoff(), notify)}
            >
              {t('Talebi iptal et')}
            </button>
            <button className="button primary" onClick={() => navigate('/voice?view=share')}>
              {t('Paylaşımı izlemeye dön')}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
/** Tells the sharer whether their screen share is sending sound right now. */
function ShareAudioBadge({ on }: { on: boolean }) {
  const label = on ? t('Yayın sesi paylaşılıyor') : t('Yayında ses yok');
  return (
    <span
      className={`share-audio-state ${on ? 'on' : ''}`}
      role="status"
      aria-label={label}
      title={label}
    >
      <ReferenceIcon name={on ? 'volume' : 'volume-off'} size={15} />
      {on ? t('Sesli') : t('Sessiz')}
    </span>
  );
}
const SHARE_AUDIO_KEY = 'rooms-share-audio-v1';
/** The sharer's last "Sesi de paylaş" choice on this computer; null when never changed. */
function readShareAudioChoice(): boolean | null {
  try {
    const value = localStorage.getItem(SHARE_AUDIO_KEY);
    return value === '1' ? true : value === '0' ? false : null;
  } catch {
    return null;
  }
}
function rememberShareAudioChoice(value: boolean) {
  try {
    localStorage.setItem(SHARE_AUDIO_KEY, value ? '1' : '0');
  } catch {
    /* The choice still applies to this share. */
  }
}
/** Explains what "Sesi de paylaş" does here, or why this computer cannot do it. */
export function shareAudioNote(
  status: {
    systemAudio: boolean;
    systemAudioOwnExcluded?: boolean;
    systemAudioReason?: 'macos-version' | 'os';
  } | null,
  checking: boolean,
) {
  if (!status)
    return checking
      ? t('Ses paylaşımı denetleniyor…')
      : t('Ses paylaşımı denetlenemedi; görüntü sessiz paylaşılır.');
  if (!status.systemAudio)
    return status.systemAudioReason === 'macos-version'
      ? t('Bu Mac sesi paylaşamaz: macOS 14.2 veya üstü gerekir. Görüntü sessiz paylaşılır.')
      : t('Bu işletim sistemi sesi paylaşamaz. Görüntü sessiz paylaşılır.');
  return status.systemAudioOwnExcluded
    ? t('Oyun ya da video sesi izleyenlere gider. Tayfa’daki konuşmalar yayına karışmaz.')
    : t(
        'Oyun ya da video sesi izleyenlere gider. Windows 10’da Tayfa’daki konuşmalar da yayına karışır; izleyenler kendi seslerini yankı olarak duyabilir.',
      );
}

export function RealVoiceDock({
  openLauncher,
  notify,
  showControls = true,
}: {
  openLauncher(): void;
  notify(message: string): void;
  showControls?: boolean;
}) {
  const r = useRealtime(),
    location = useLocation(),
    navigate = useNavigate();
  const identity = useCommunity((state) => state.user?.id ?? null);
  const familiarRoom = true;
  const [shareQuality, setShareQuality] =
      useState<import('@rooms/media').ScreenShareQuality>('1080p60'),
    // null until the sharer flips the switch: sound is shared wherever the OS can capture it.
    [shareAudioChoice, setShareAudioChoice] = useState<boolean | null>(readShareAudioChoice);
  const [picker, setPicker] = useState(false),
    [sources, setSources] = useState<{ id: string; name: string; thumbnail: string }[]>([]),
    [selected, setSelected] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [sourceType, setSourceType] = useState<'window' | 'screen'>('window');
  const [captureStatus, setCaptureStatus] = useState<{
    screen: string;
    systemAudio: boolean;
    systemAudioOwnExcluded?: boolean;
    systemAudioReason?: 'macos-version' | 'os';
  } | null>(null);
  const shareAudio = !!captureStatus?.systemAudio && (shareAudioChoice ?? true);
  const generation = useRef(0);
  const close = useCallback(() => {
    generation.current++;
    setPicker(false);
    setSelected('');
    setError('');
    setBusy(false);
  }, []);
  const choose = useCallback(async () => {
    const epoch = ++generation.current;
    setPicker(true);
    setBusy(true);
    setError('');
    setSelected('');
    setSources([]);
    setCaptureStatus(null);
    try {
      const bridge = mediaBridge();
      const [items, status] = await Promise.allSettled([
        bridge.captureSources(),
        bridge.captureStatus(),
      ]);
      if (generation.current === epoch) {
        if (status.status === 'fulfilled') setCaptureStatus(status.value);
        if (items.status === 'rejected') throw items.reason;
        setSources(items.value);
        setSourceType(items.value.some((s) => s.id.startsWith('window:')) ? 'window' : 'screen');
      }
    } catch (e) {
      if (generation.current === epoch) setError(uiError(e));
    } finally {
      if (generation.current === epoch) setBusy(false);
    }
  }, []);
  useEffect(() => {
    const listener = () => {
      if (isConnected()) void choose();
    };
    window.addEventListener('rooms:choose-capture', listener);
    return () => window.removeEventListener('rooms:choose-capture', listener);
  }, [choose, r.status, r.channelId]);
  useEffect(() => {
    close();
  }, [r.channelId, identity, close]);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (
      location.pathname === '/voice' &&
      params.get('choose') === '1' &&
      r.status === 'connected'
    ) {
      void choose();
      params.delete('choose');
      navigate(`/voice?${params}`, { replace: true });
    }
  }, [location.pathname, location.search, r.status, choose, navigate]);
  function isConnected() {
    return r.status === 'connected' && Boolean(r.channelId);
  }
  if (!r.channelId) return null;
  const connected = r.status === 'connected',
    visibleSources = sources.filter((s) => s.id.startsWith(`${sourceType}:`));
  return (
    <>
      {showControls && (
        <div
          className={`voice-dock real-voice-dock reference-voice-dock glass ${r.sharing ? 'is-sharing' : ''} ${familiarRoom ? 'familiar-room-dock' : ''}`}
        >
          <button
            className="dock-context"
            title={r.roomName ?? undefined}
            onClick={() => navigate('/voice')}
          >
            <ReferenceIcon name="headphones" size={18} />
            <div>
              <strong>{r.roomName}</strong>
              <small>
                {r.busy
                  ? t('Bağlanıyor…')
                  : connected
                    ? t('{count} kişi odada', { count: r.participants.length })
                    : r.status === 'reconnecting'
                      ? t('Yeniden bağlanıyor…')
                      : t('Bağlantı kesildi')}
              </small>
            </div>
          </button>
          <div className="dock-divider" />
          <div className="room-dock-group room-device-controls">
            <IconButton
              // While reconnecting the microphone can still be muted (not unmuted).
              disabled={!connected && !(r.status === 'reconnecting' && !r.muted)}
              label={r.muted ? t('Mikrofonu aç') : t('Mikrofonu kapat')}
              className={r.muted ? 'muted-control' : ''}
              onClick={() => report(toggleMic(), notify)}
            >
              <ReferenceIcon name={r.muted ? 'mic-off' : 'mic'} size={19} />
            </IconButton>
            {/* Same terms as the sidebar voice panel: Sağırlaştır / Sesten ayrıl. */}
            <IconButton
              disabled={!connected}
              label={r.deafened ? t('Sağırlaştırmayı kapat') : t('Sağırlaştır')}
              className={r.deafened ? 'muted-control' : ''}
              onClick={() => report(toggleDeafen(), notify)}
            >
              <ReferenceIcon name={r.deafened ? 'headphones-off' : 'headphones'} size={19} />
            </IconButton>
            <IconButton
              disabled={!connected}
              label={r.camera ? t('Kamerayı kapat') : t('Kamerayı aç')}
              className={r.camera ? 'camera-on' : 'camera-off'}
              onClick={() =>
                report(
                  toggleCamera().then(() => {
                    if (!r.camera) navigate('/voice?view=video');
                  }),
                  notify,
                )
              }
            >
              <ReferenceIcon name={r.camera ? 'video' : 'video-off'} size={19} />
            </IconButton>
          </div>
          <div className="room-dock-group room-activity-controls">
            {r.sharing ? (
              <>
                <ShareAudioBadge on={!!r.sharingAudio} />
                <button className="stop-sharing" onClick={() => report(stopScreen(), notify)}>
                  <ReferenceIcon name="x" size={15} />
                  {t('Paylaşımı durdur')}
                </button>
              </>
            ) : (
              <IconButton
                label={t('Ekran paylaş')}
                disabled={!connected}
                onClick={() => void choose()}
              >
                <ReferenceIcon name="monitor" size={19} />
              </IconButton>
            )}
            <div className="dock-divider" />
            <button
              className="button primary reference-start-activity"
              title={t('Etkinlikler')}
              onClick={openLauncher}
            >
              <ReferenceIcon name="grid" size={18} />
              <span>{t('Etkinlikler')}</span>
            </button>
            <IconButton
              label="Soundboard"
              onClick={() => window.dispatchEvent(new Event('rooms:open-soundboard'))}
            >
              <AudioLines size={19} />
            </IconButton>
            {/* One entry for microphone, speaker and camera devices (Settings > Ses ve görüntü). */}
            <IconButton label={t('Cihaz ayarları')} onClick={() => navigate('/settings?tab=audio')}>
              <ReferenceIcon name="settings" size={18} />
            </IconButton>
          </div>
          <IconButton
            label={t('Sesten ayrıl')}
            className="leave-control"
            onClick={() => report(leaveVoice(), notify)}
          >
            <ReferenceIcon name="phone-off" size={19} />
          </IconButton>
          {r.audioBlocked && (
            <button
              className="button small secondary"
              onClick={() => report(startRoomAudio(), notify)}
            >
              {t('Sesi aç')}
            </button>
          )}
        </div>
      )}
      {r.error && (
        <div className="voice-error-notice" role="alert">
          <span>{r.error}</span>
          <button onClick={() => navigate('/voice')}>{t('Odayı aç')}</button>
        </div>
      )}
      {picker && (
        <Modal
          title={t('Ne paylaşmak istersin?')}
          onClose={close}
          className="capture-modal reference-capture-modal"
        >
          <p className="modal-description">{t('Paylaşacağın pencereyi veya ekranı seç.')}</p>
          <div className="segmented reference-source-tabs" aria-label={t('Kaynak türü')}>
            {(['window', 'screen'] as const).map((kind) => (
              <button
                key={kind}
                aria-pressed={sourceType === kind}
                className={sourceType === kind ? 'selected' : ''}
                onClick={() => {
                  setSourceType(kind);
                  setSelected('');
                }}
              >
                <ReferenceIcon name={kind === 'screen' ? 'monitor' : 'square'} size={16} />
                {kind === 'window' ? t('Pencere') : t('Tüm ekran')}
              </button>
            ))}
          </div>
          {busy ? (
            <div className="reference-capture-loading" role="status">
              {t('Ekranlar ve pencereler aranıyor…')}
            </div>
          ) : (
            <div className="capture-grid reference-capture-grid">
              {visibleSources.map((s) => (
                <button
                  key={s.id}
                  className={selected === s.id ? 'selected' : ''}
                  aria-pressed={selected === s.id}
                  onClick={() => setSelected(s.id)}
                >
                  {s.thumbnail ? (
                    <img src={s.thumbnail} alt={t('{name} önizlemesi', { name: s.name })} />
                  ) : (
                    <div className="reference-source-no-preview">
                      <ReferenceIcon name="monitor" size={30} />
                    </div>
                  )}
                  <span>
                    {s.name}
                    {selected === s.id && <ReferenceIcon name="check" size={15} />}
                  </span>
                  <small>
                    {sourceType === 'window'
                      ? t('Yalnızca bu pencere')
                      : t('Tüm ekran · bildirimler görünebilir')}
                  </small>
                </button>
              ))}
            </div>
          )}
          {!visibleSources.length && !busy && !error && (
            <p className="modal-description">
              {captureStatus?.screen === 'denied'
                ? t(
                    'macOS ekran kaydı izni kapalı. Sistem Ayarları → Gizlilik ve Güvenlik → Ekran ve Sistem Sesi Kaydı bölümünden Tayfa’ya izin ver.',
                  )
                : t('Bu türde paylaşılabilir kaynak bulunamadı.')}
            </p>
          )}
          {error && (
            <div className="reference-media-notice" role="alert">
              <ReferenceIcon name="alert-triangle" size={18} />
              <span>{error}</span>
              <button
                className="button secondary small"
                disabled={busy}
                onClick={() => void choose()}
              >
                {t('Yeniden dene')}
              </button>
            </div>
          )}
          <div className="reference-capture-privacy">
            <ReferenceIcon name="lock" size={17} />
            <span>
              {t('Yalnızca seçtiğin kaynak paylaşılır. Paylaşım, onay verdiğinde başlar.')}
            </span>
          </div>
          <label className="field-label">
            {t('Paylaşım kalitesi')}
            <select
              value={shareQuality}
              onChange={(e) =>
                setShareQuality(e.target.value as import('@rooms/media').ScreenShareQuality)
              }
            >
              {(['720p30', '1080p30', '1080p60', '1440p60', '4k30'] as const).map((quality) => (
                <option key={quality} value={quality}>
                  {quality}
                </option>
              ))}
            </select>
          </label>
          <div className="reference-capture-audio">
            <button
              className={`toggle ${shareAudio ? 'on' : ''}`}
              role="switch"
              aria-label={t('Sesi de paylaş')}
              aria-checked={shareAudio}
              aria-describedby="capture-audio-note"
              disabled={!captureStatus?.systemAudio}
              onClick={() => {
                setShareAudioChoice(!shareAudio);
                rememberShareAudioChoice(!shareAudio);
              }}
            >
              <span />
            </button>
            <div>
              <strong>{t('Sesi de paylaş')}</strong>
              <small id="capture-audio-note">
                {shareAudioNote(captureStatus, busy)}
              </small>
            </div>
          </div>
          <div className="button-row">
            <button className="button secondary" disabled={busy} onClick={close}>
              {t('Vazgeç')}
            </button>
            <button
              className="button primary"
              disabled={!selected || busy || !connected}
              onClick={() => {
                const epoch = generation.current;
                setBusy(true);
                void startScreen(selected, {
                  quality: shareQuality,
                  audio: shareAudio,
                  content: 'motion',
                })
                  .then((result) => {
                    if (shareAudio && !result.audio)
                      notify(
                        t(
                          'Ses paylaşılamadı, yalnızca görüntü gidiyor. Bilgisayarda bir hoparlör ya da kulaklık seçili olmalı.',
                        ),
                      );
                    // Keep the selected personal player visible while its window is shared.
                    if (generation.current !== epoch) return;
                    if (location.pathname !== '/media') navigate('/voice?view=share');
                    close();
                  })
                  .catch((e) => {
                    if (generation.current === epoch) setError(uiError(e));
                  })
                  .finally(() => {
                    if (generation.current === epoch) setBusy(false);
                  });
              }}
            >
              <ReferenceIcon name="monitor" size={16} />
              {busy ? t('Başlatılıyor…') : t('Seçili kaynağı paylaş')}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
export function CommunityInvite({
  onClose,
  notify,
}: {
  onClose(): void;
  notify(message: string): void;
}) {
  const c = useCommunity();
  const [created, setCreated] = useState<SocialInvite | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const channel =
    c.channels.find((ch) => ch.id === c.activeChannelId && ch.type === 0)?.id ??
    c.channels.find((ch) => ch.type === 0)?.id;
  return (
    <Modal title={t('Davet oluştur')} onClose={onClose}>
      <p className="modal-description">
        {t('Arkadaşların bu bağlantıyla kendi hesaplarını açıp topluluğa katılır.')}
      </p>
      {created ? (
        <InviteLinkCard serverUrl={c.serverUrl} invite={created} autoFocus />
      ) : (
        <button
          className="button primary full"
          disabled={!channel || busy}
          onClick={() => {
            setBusy(true);
            setError('');
            void c
              .createInvite(channel!)
              .then(setCreated)
              .catch((e) => setError(uiError(e)))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? tr('Creating\u2026') : tr('Create invitation')}
          <ArrowRight size={15} />
        </button>
      )}
      {!channel && (
        <p className="modal-description">{tr('Open a space with a text channel first.')}</p>
      )}
      {error && (
        <div className="error-pane" role="alert">
          <p>{error}</p>
        </div>
      )}
    </Modal>
  );
}
