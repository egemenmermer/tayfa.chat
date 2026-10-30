import { t } from './i18n';

/**
 * Polls posted into a text channel.
 *
 * The poll itself lives in the activity room of the channel the message was posted in (room id =
 * the message's channel id), so the activity service's VIEW_CHANNEL check on that channel decides
 * who sees and votes. The message only carries a readable sentence for clients without poll cards
 * and a short id token at the very end. Question, options and votes always come from the room
 * snapshot, never from the message text.
 *
 * Wire format (identical for every client, the sentence follows the sender's language):
 *   `📊 <sentence> #<12 letters or digits>`
 * The token avoids `_`, `@` and URLs so older desktops and iPhones show it as plain text.
 */
export const CHAT_POLL_ID_LENGTH = 12;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const MARK = '📊';
const POLL_MESSAGE = new RegExp(`^${MARK} [\\s\\S]+ #([A-Za-z0-9]{${CHAT_POLL_ID_LENGTH}})$`, 'u');

/** A fresh poll id that is valid both in the message token and as an activity `opaqueId`. */
export function newChatPollId(
  random: (bytes: Uint8Array) => Uint8Array = (bytes) => crypto.getRandomValues(bytes),
): string {
  let id = '';
  while (id.length < CHAT_POLL_ID_LENGTH)
    for (const byte of random(new Uint8Array(CHAT_POLL_ID_LENGTH)))
      // 248 = 4 × 62: dropping higher bytes keeps every letter equally likely.
      if (byte < 248 && id.length < CHAT_POLL_ID_LENGTH) id += ALPHABET[byte % 62];
  return id;
}

/** The message posted with a poll; older clients show it as an ordinary sentence. */
export function chatPollMessage(question: string, pollId: string): string {
  const sentence = t('Anket: {question} — Tayfa’nın yeni sürümünde oy ver.', {
    question: question.replace(/\s+/g, ' ').trim(),
  });
  return `${MARK} ${sentence} #${pollId}`;
}

/** The poll id a message refers to, or null for every other message (quotes and edits included). */
export function chatPollId(content: string): string | null {
  return content.trim().match(POLL_MESSAGE)?.[1] ?? null;
}

/** The readable part of a poll message, shown while the poll itself cannot be loaded. */
export function chatPollFallback(content: string): string {
  const trimmed = content.trim();
  return chatPollId(trimmed)
    ? trimmed.slice(MARK.length, -(CHAT_POLL_ID_LENGTH + 2)).trim()
    : trimmed;
}
