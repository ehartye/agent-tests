import { describe, it } from 'vitest';
import { createInvoice } from '../../src/billing/invoice.ts';

describe('invoice', () => {
  it('creates an invoice without throwing', () => {
    createInvoice(5);
  });
});
