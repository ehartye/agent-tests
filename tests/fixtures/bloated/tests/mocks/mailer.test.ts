import { describe, expect, it, vi } from 'vitest';
import { send } from '../../src/util/mailer.ts';

describe('mailer', () => {
  it('calls the transport once', () => {
    const transport = vi.fn();
    send(transport, 'hi');
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledWith('hi');
  });
});
