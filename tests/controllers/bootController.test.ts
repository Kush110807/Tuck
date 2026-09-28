import { describe, expect, it } from 'vitest';
import { createBootController } from '../../src/controllers';
import { flushAsync, MockItemRepository } from '../mocks/controllerMocks';

describe('BootController', () => {
  it('blocks on initialization failure and retries to ready', async () => {
    const repository = new MockItemRepository();
    let attempt = 0;
    repository.initializeImpl = async () => ++attempt === 1
      ? { ok: false, error: { code: 'INIT_FAILED', message: 'Cannot open DB.' } }
      : { ok: true, value: undefined };
    const controller = createBootController(repository);

    await controller.start();
    expect(controller.props.state).toEqual({ kind: 'failed', error: { code: 'INIT_FAILED', message: 'Cannot open DB.' } });

    controller.props.onRetry();
    await flushAsync();
    expect(repository.initializeCalls).toBe(2);
    expect(controller.props.state.kind).toBe('ready');
  });
});
