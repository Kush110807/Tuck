import { describe, expect, it } from 'vitest';
import { createMutationMailbox } from '../../src/navigation/MutationMailbox';

describe('one-shot post-mutation handoff', () => {
  it('delivers only to the intended destination and detail item', () => {
    const mailbox = createMutationMailbox();
    mailbox.publish({ destination: 'Inbox', operation: 'archive', feedback: { kind: 'success', message: 'Archived' } });
    mailbox.publish({ destination: 'Detail', itemId: 'item-a', operation: 'edit', feedback: { kind: 'success', message: 'Updated' } });
    expect(mailbox.consume('Archive')).toEqual([]);
    expect(mailbox.consume('Detail', 'item-b')).toEqual([]);
    expect(mailbox.consume('Inbox')).toMatchObject([{ sequence: 1, operation: 'archive' }]);
    expect(mailbox.consume('Inbox')).toEqual([]);
    expect(mailbox.consume('Detail', 'item-a')).toMatchObject([{ sequence: 2, operation: 'edit' }]);
    expect(mailbox.consume('Detail', 'item-a')).toEqual([]);
  });
});
