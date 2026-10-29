import './chat-poll.css';
import { useState } from 'react';
import { BarChart3, Check, LockKeyhole, Plus, RefreshCw, X } from 'lucide-react';
import { Modal } from '@rooms/design';
import { useActivityRoom } from './activity';
import { useCommunity } from './community';
import { chatPollFallback, chatPollId, chatPollMessage, newChatPollId } from './chat-poll';
import { t, uiError } from './i18n';
import type { ActivityCommand, Poll } from '../../../packages/activity-protocol/src';

/** The activity service keeps at most this many polls per room (POLL_LIMIT in engine.ts). */
const POLL_LIMIT = 50;

const counted = (poll: Poll) =>
  poll.options.map((option) => ({
    ...option,
    count: Object.values(poll.votes).filter((value) => value === option.id).length,
  }));

function result(poll: Poll) {
  const options = counted(poll),
    max = Math.max(0, ...options.map((option) => option.count));
  return max
    ? options
        .filter((option) => option.count === max)
        .map((option) => t('{label} · {count} oy', { label: option.label, count: option.count }))
        .join(' / ')
    : t('Henüz oy yok');
}

/**
 * A poll message in the message list. The room is always the channel the message was posted in,
 * so the service's channel check decides who can load and vote; the message text is only shown
 * while the poll itself is unavailable.
 */
export function ChatPollCard({
  channelId,
  pollId,
  content,
}: {
  channelId: string;
  pollId: string;
  content: string;
}) {
  const activity = useActivityRoom(channelId),
    userId = useCommunity((state) => state.user?.id ?? '');
  const [pending, setPending] = useState(false),
    [error, setError] = useState(''),
    [confirming, setConfirming] = useState(false);
  const room = activity.room?.roomId === channelId ? activity.room : null,
    poll = room?.polls.find((item) => item.id === pollId) ?? null;
  if (!poll) {
    const state = room ? 'missing' : activity.status === 'error' ? 'error' : 'loading';
    return (
      <section className={`chat-poll is-${state}`} aria-busy={state === 'loading'}>
        <header>
          <span>
            <BarChart3 size={14} aria-hidden="true" />
            {t('ANKET')}
          </span>
        </header>
        <p className="chat-poll-fallback">{chatPollFallback(content)}</p>
        <p className="chat-poll-state" role="status">
          {state === 'loading'
            ? t('Anket yükleniyor…')
            : state === 'error'
              ? activity.error || t('Anket şu an açılamıyor.')
              : t('Bu anket bulunamadı. Silinmiş ya da başka bir kanala ait olabilir.')}
        </p>
        {state === 'error' && (
          <button type="button" className="text-button" onClick={() => void activity.refresh()}>
            <RefreshCw size={13} aria-hidden="true" />
            {t('Yeniden dene')}
          </button>
        )}
      </section>
    );
  }
  const votes = Object.values(poll.votes).length,
    mine = poll.votes[userId],
    busy = activity.busy || pending,
    reason = activity.status === 'connected' ? '' : t('Anket bağlantısı bekleniyor.'),
    participant = room?.participants.find((person) => person.userId === userId),
    closable = !poll.closed && (poll.createdBy === userId || participant?.canControl === true);
  const run = async (command: ActivityCommand) => {
    if (busy || reason) return false;
    setPending(true);
    setError('');
    try {
      await activity.send(command);
      return true;
    } catch (failure) {
      setError(uiError(failure));
      return false;
    } finally {
      setPending(false);
    }
  };
  return (
    <section className={`chat-poll ${poll.closed ? 'closed' : ''}`} aria-label={poll.question}>
      <header>
        <span>
          <BarChart3 size={14} aria-hidden="true" />
          {t('ANKET')}
        </span>
        <small>{poll.closed ? t('Oylama kapalı') : t('Oylama açık')}</small>
      </header>
      <h3>{poll.question}</h3>
      <div className="chat-poll-options">
        {counted(poll).map((option) => {
          const share = votes ? Math.round((option.count / votes) * 100) : 0;
          return (
            <button
              type="button"
              key={option.id}
              className={mine === option.id ? 'voted' : ''}
              aria-pressed={mine === option.id}
              disabled={poll.closed || busy || !!reason}
              title={poll.closed ? t('Oylama kapalı') : reason || undefined}
              onClick={() => void run({ type: 'poll.vote', pollId: poll.id, optionId: option.id })}
            >
              <i style={{ width: `${share}%` }} aria-hidden="true" />
              <span>
                {mine === option.id && <Check size={14} aria-hidden="true" />}
                {option.label}
              </span>
              <small>
                {t('{count} oy', { count: option.count })}
                {votes ? ` · ${share}%` : ''}
              </small>
            </button>
          );
        })}
      </div>
      {error && (
        <p className="chat-poll-error" role="alert">
          {error}
        </p>
      )}
      <footer>
        <span>
          {poll.closed
            ? t('Sonuç: {result}', { result: result(poll) })
            : votes
              ? t('{count} kişi oy verdi', { count: votes })
              : t('Henüz oy yok')}
        </span>
        {closable &&
          (confirming ? (
            <span className="chat-poll-confirm">
              <span>{t('Oylamayı kapat?')}</span>
              <button type="button" className="text-button" onClick={() => setConfirming(false)}>
                {t('Oylama sürsün')}
              </button>
              <button
                type="button"
                className="text-button danger"
                disabled={busy || !!reason}
                onClick={() =>
                  void run({ type: 'poll.close', pollId: poll.id }).then(() => setConfirming(false))
                }
              >
                {t('Anketi kapat')}
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="text-button"
              disabled={busy || !!reason}
              title={reason || undefined}
              onClick={() => setConfirming(true)}
            >
              <LockKeyhole size={13} aria-hidden="true" />
              {t('Anketi kapat')}
            </button>
          ))}
      </footer>
    </section>
  );
}

/**
 * Creates a poll in a text channel's activity room and then posts the poll message in that same
 * channel. The poll is created once: a failed post is retried with the same id.
 */
export function ChatPollComposer({
  channelId,
  channelName,
  onClose,
  notify,
}: {
  channelId: string;
  channelName: string;
  onClose(): void;
  notify(message: string): void;
}) {
  const activity = useActivityRoom(channelId),
    userId = useCommunity((state) => state.user?.id ?? '');
  const [question, setQuestion] = useState(''),
    [options, setOptions] = useState(['', '']),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [created, setCreated] = useState<{ id: string; question: string } | null>(null);
  const participant = activity.room?.participants.find((person) => person.userId === userId);
  const reason = created
    ? ''
    : participant?.canCreate === false
      ? t('Bu kanalda anket açma iznin yok.')
      : (activity.room?.polls.length ?? 0) >= POLL_LIMIT
        ? t('Bu kanal anket sınırına ulaştı ({count}).', { count: POLL_LIMIT })
        : '';
  const ready = !!question.trim() && options.every((value) => !!value.trim());
  const moved = () => useCommunity.getState().activeChannelId !== channelId;
  const submit = async () => {
    if (busy || reason || !ready) return;
    if (moved()) {
      setError(t('Kanal değişti. Anketi açtığın kanala dönüp yeniden dene.'));
      return;
    }
    setBusy(true);
    setError('');
    let poll = created;
    try {
      if (!poll) {
        const id = newChatPollId(),
          text = question.trim();
        await activity.send({
          type: 'poll.create',
          pollId: id,
          question: text,
          options: options.map((label) => ({ id: newChatPollId(), label: label.trim() })),
        });
        poll = { id, question: text };
        setCreated(poll);
      }
      if (moved()) throw new Error(t('Kanal değişti. Anketi açtığın kanala dönüp yeniden dene.'));
      await useCommunity.getState().send(chatPollMessage(poll.question, poll.id));
      onClose();
    } catch (failure) {
      const code = String((failure as Error)?.message ?? failure),
        message = code.includes('ACTIVITY_CREATE_DENIED')
          ? t('Bu kanalda anket açma iznin yok.')
          : code.includes('POLL_LIMIT')
            ? t('Bu kanal anket sınırına ulaştı ({count}).', { count: POLL_LIMIT })
            : uiError(failure);
      // A post that reached the list as "failed" has its own retry there with the same poll id.
      const sentId = poll?.id,
        listed =
          !!sentId &&
          useCommunity
            .getState()
            .messages.some((m) => m.delivery === 'failed' && chatPollId(m.content) === sentId);
      if (listed) {
        notify(message);
        onClose();
      } else setError(message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={t('Kanala anket gönder')}
      className="chat-poll-modal"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button secondary" onClick={onClose}>
            {t('Vazgeç')}
          </button>
          <button
            type="submit"
            form="chat-poll-form"
            className="button primary"
            disabled={busy || !!reason || !ready}
            title={reason || undefined}
          >
            {created ? t('Mesajı yeniden gönder') : t('Anketi gönder')}
          </button>
        </>
      }
    >
      <form
        id="chat-poll-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <p className="inline-help">
          {t('#{channel} kanalını görebilen herkes oy verebilir.', { channel: channelName })}
        </p>
        <label className="field-label">
          {t('Soru')}
          <input
            autoFocus
            required
            maxLength={240}
            disabled={!!created}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
          />
        </label>
        {options.map((value, index) => (
          <label className="field-label" key={index}>
            {t('Seçenek {number}', { number: index + 1 })}
            <span className="chat-poll-option-input">
              <input
                required
                maxLength={240}
                disabled={!!created}
                value={value}
                onChange={(event) =>
                  setOptions((values) =>
                    values.map((item, i) => (i === index ? event.target.value : item)),
                  )
                }
              />
              {options.length > 2 && !created && (
                <button
                  type="button"
                  aria-label={t('Seçenek {number} kaldır', { number: index + 1 })}
                  onClick={() => setOptions((values) => values.filter((_, i) => i !== index))}
                >
                  <X size={14} />
                </button>
              )}
            </span>
          </label>
        ))}
        {options.length < 12 && !created && (
          <button
            type="button"
            className="text-button"
            onClick={() => setOptions((values) => [...values, ''])}
          >
            <Plus size={15} />
            {t('Seçenek ekle')}
          </button>
        )}
        <p className="inline-help">
          {t('Kişi başına tek seçim. Oyunu kapanana kadar değiştirebilirsin.')}
        </p>
        {(reason || error) && (
          <p className="field-error" role="alert">
            {reason || error}
          </p>
        )}
      </form>
    </Modal>
  );
}
