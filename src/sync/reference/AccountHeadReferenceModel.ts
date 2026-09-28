/**
 * Executable model of the per-account transactional sync-head invariant.
 * A transaction may know its reserved next sequence while holding the account
 * row lock, but other transactions/clients continue to see the committed head.
 */
export class AccountHeadReferenceModel {
  private committedHead: number;
  private lockOwner: string | null = null;
  private reservedSequence: number | null = null;

  constructor(initialHead = 0) {
    if (!Number.isSafeInteger(initialHead) || initialHead < 0) throw new Error('initialHead must be >= 0');
    this.committedHead = initialHead;
  }

  getCommittedHead(): number {
    return this.committedHead;
  }

  tryBegin(owner: string): Readonly<{ kind: 'acquired'; reservedSequence: number }> | Readonly<{ kind: 'blocked' }> {
    if (this.lockOwner !== null) return { kind: 'blocked' };
    this.lockOwner = owner;
    this.reservedSequence = this.committedHead + 1;
    return { kind: 'acquired', reservedSequence: this.reservedSequence };
  }

  commit(owner: string): number {
    if (this.lockOwner !== owner || this.reservedSequence === null) throw new Error('owner does not hold account head lock');
    this.committedHead = this.reservedSequence;
    this.lockOwner = null;
    this.reservedSequence = null;
    return this.committedHead;
  }

  rollback(owner: string): void {
    if (this.lockOwner !== owner) throw new Error('owner does not hold account head lock');
    this.lockOwner = null;
    this.reservedSequence = null;
  }

  commitImmediate(owner: string): number {
    const begun = this.tryBegin(owner);
    if (begun.kind === 'blocked') throw new Error('account head is locked by another transaction');
    return this.commit(owner);
  }
}
