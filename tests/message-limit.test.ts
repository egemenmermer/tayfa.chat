import { describe, expect, it } from 'vitest';
import { MESSAGE_MAX, messageLength } from '../apps/desktop/src/message-limit';

describe('message length in the composer', () => {
  it('matches Stoat’s limit and warns before it', () => {
    expect(MESSAGE_MAX).toBe(2000);
    expect(messageLength(120)).toEqual({ show: false, over: false, left: 1880 });
    expect(messageLength(1800)).toEqual({ show: true, over: false, left: 200 });
    expect(messageLength(2000)).toMatchObject({ show: true, over: false, left: 0 });
    expect(messageLength(2001)).toMatchObject({ over: true, left: -1 });
  });
});

describe('a message that failed to send', () => {
  it('can be discarded; delivered messages cannot', async () => {
    const { useCommunity } = await import('../apps/desktop/src/community');
    const author = { id: 'me', username: 'me', displayName: 'me', avatar: null };
    const base = {
      channelId: 'c1',
      author,
      timestamp: new Date().toISOString(),
      editedTimestamp: null,
    };
    useCommunity.setState({
      messages: [
        { ...base, id: 'sent-1', content: 'hi', delivery: 'sent' },
        { ...base, id: 'pending-x', content: 'x'.repeat(2500), delivery: 'failed' },
      ],
    });
    useCommunity.getState().discardMessage('sent-1');
    useCommunity.getState().discardMessage('pending-x');
    expect(useCommunity.getState().messages.map((m) => m.id)).toEqual(['sent-1']);
  });
});
