import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Allocate an owned fixture using physical spellings, including Windows short-path expansion. */
export function physicalTemp(prefix: string, parent = tmpdir()): string {
  return realpathSync.native(mkdtempSync(join(realpathSync.native(parent), prefix)));
}
