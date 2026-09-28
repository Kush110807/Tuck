import type { AppBootState, BootGateProps, ItemRepository } from '../contracts';
import { ObservableController } from './observable';
import { unexpectedRepositoryError } from './helpers';

export interface BootControllerOutput {
  readonly props: BootGateProps;
  start(): Promise<void>;
  subscribe(listener: () => void): () => void;
}

export class BootController extends ObservableController implements BootControllerOutput {
  private state: AppBootState = { kind: 'initializing' };
  private pending = false;
  private generation = 0;

  constructor(private readonly repository: ItemRepository) {
    super();
  }

  get props(): BootGateProps {
    return {
      state: this.state,
      onRetry: () => { void this.start(); },
    };
  }

  async start(): Promise<void> {
    if (this.pending) return;
    this.pending = true;
    const generation = ++this.generation;
    this.state = { kind: 'initializing' };
    this.emitChange();
    try {
      const result = await this.repository.initialize();
      if (generation !== this.generation) return;
      this.state = result.ok ? { kind: 'ready' } : { kind: 'failed', error: result.error };
    } catch {
      if (generation !== this.generation) return;
      this.state = { kind: 'failed', error: unexpectedRepositoryError('Tuck could not initialize its local storage.') };
    } finally {
      if (generation === this.generation) {
        this.pending = false;
        this.emitChange();
      }
    }
  }
}

export function createBootController(repository: ItemRepository): BootController {
  return new BootController(repository);
}
