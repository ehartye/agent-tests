import { symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { candidateDirs, draftRiskMap } from '../src/riskdraft.ts';
import { loadRiskMap, serializeRiskMap, tierFor } from '../src/riskmap.ts';
import { RiskMap } from '../src/schema.ts';
import { makeTree } from './helpers/tree.ts';

describe('candidateDirs', () => {
  it('lists the children of src, skipping tests, docs and dot directories', () => {
    const root = makeTree({ 'src/auth/a.ts': '', 'src/ui/b.ts': '', 'src/tests/c.ts': '', 'src/.cache/d.ts': '', 'src/loose.ts': '' });
    expect(candidateDirs(root)).toEqual(['src/auth', 'src/ui']);
  });

  it('uses the root when there is no conventional source directory', () => {
    const root = makeTree({ 'core/a.ts': '', 'docs/readme.md': '', 'node_modules/x/y.js': '' });
    expect(candidateDirs(root)).toEqual(['core']);
  });

  it('includes packages and apps children', () => {
    const root = makeTree({ 'packages/api/a.ts': '', 'apps/web/b.ts': '' });
    expect(candidateDirs(root)).toEqual(['apps/web', 'packages/api']);
  });
});

describe('draftRiskMap', () => {
  const root = makeTree({ 'src/persistence/a.ts': '', 'src/ui/b.ts': '', 'src/parser/c.ts': '', 'src/billing/d.ts': '' });
  const map = draftRiskMap(root);

  it('produces a valid dev-phase map with no consumers', () => {
    expect(RiskMap.safeParse(map).success).toBe(true);
    expect(map.phase).toBe('dev');
    expect(map.consumers).toEqual([]);
  });

  it('adds a catch-all last when code sits directly in the source directory', () => {
    const flat = draftRiskMap(makeTree({ 'src/auth/a.ts': '', 'src/scan.ts': '' }));
    expect(flat.areas.map(area => `${area.path}:${area.tier}`)).toEqual(['src/auth/**:critical', 'src/**:standard']);
    expect(draftRiskMap(makeTree({ 'src/auth/a.ts': '' })).areas.map(area => area.path)).toEqual(['src/auth/**']);
  });

  it('classifies directories by name and says why', () => {
    const byPath = Object.fromEntries(map.areas.map(area => [area.path, area.tier]));
    expect(byPath).toEqual({
      'src/billing/**': 'critical',
      'src/parser/**': 'standard',
      'src/persistence/**': 'critical',
      'src/ui/**': 'low',
    });
    expect(map.areas.every(area => area.why && area.why.length > 0)).toBe(true);
  });
});

/** Draft a map from `src/<name>/a.ts` for every name and return the tier by directory name. */
function tiersByName(names: string[]): Record<string, string> {
  const files = Object.fromEntries(names.map(name => [`src/${name}/a.ts`, '']));
  const map = draftRiskMap(makeTree(files));
  return Object.fromEntries(map.areas.map(area => [area.path.replace(/^src\//, '').replace(/\/\*\*$/, ''), area.tier]));
}

const expectAll = (names: string[], tier: string): void => {
  const tiers = tiersByName(names);
  expect(Object.fromEntries(names.map(name => [name, tiers[name]]))).toEqual(Object.fromEntries(names.map(name => [name, tier])));
};

describe('candidateDirs on unreadable roots', () => {
  it('returns nothing for a missing root', () => {
    expect(candidateDirs(join(tmpdir(), 'agent-tests-no-such-directory-xyz'))).toEqual([]);
  });

  it('returns nothing when the root is a file', () => {
    const root = makeTree({ 'a.txt': 'x' });
    expect(candidateDirs(join(root, 'a.txt'))).toEqual([]);
    expect(draftRiskMap(join(root, 'a.txt')).areas).toEqual([]);
  });
});

describe('name-token classification', () => {
  it('marks every security or money keyword critical', () => {
    expectAll(
      [
        'auth', 'authn', 'authz', 'oauth', 'oauth2', 'authentication', 'authorization', 'login', 'logout', 'session', 'sessions', 'user-session',
        'token', 'tokens', 'credentials', 'password', 'secret', 'secrets', 'security', 'crypto', 'encryption', 'jwt', 'rbac', 'acl', 'permissions',
        'payments', 'billing', 'invoice', 'checkout', 'wallet', 'ledger', 'money', 'transactions', 'account', 'accountSettings', 'DBUtils', 'db', 'database',
        'datastore', 'persistence', 'storage', 'migrations', 'schema',
      ],
      'critical',
    );
  });

  it('does not match keywords inside other words', () => {
    expectAll(
      ['author', 'authors', 'restore', 'stored', 'storefront', 'bookstore', 'dbus', 'mydb', 'subsession', 'accounting', 'guide', 'store', 'data_store', 'parser', 'orders', 'ui-kit', 'design'],
      'standard',
    );
  });

  it('marks presentation names low only when every token is presentation', () => {
    expectAll(['ui', 'views', 'components', 'styles', 'theme', 'examples', 'demo', 'playground', 'storybook', 'stories', 'assets', 'icons', 'images', 'fonts', 'public', 'static'], 'low');
  });

  it('writes a plain-language reason', () => {
    const map = draftRiskMap(makeTree({ 'src/auth/a.ts': '', 'src/db/a.ts': '', 'src/ui/a.ts': '', 'src/parser/a.ts': '' }));
    expect(Object.fromEntries(map.areas.map(area => [area.path, area.why]))).toEqual({
      'src/auth/**': 'name suggests authentication; confirm',
      'src/db/**': 'name suggests data persistence; confirm',
      'src/parser/**': 'no risk keyword in the name; confirm',
      'src/ui/**': 'presentation or example code; confirm',
    });
  });

  it('lets a critical token win over a presentation token', () => {
    expectAll(['ui-auth'], 'critical');
  });
});

describe('loose files directly under the source directory', () => {
  it('emits a critical area per risky file before the catch-all', () => {
    const map = draftRiskMap(makeTree({ 'src/core/a.ts': '', 'src/auth.ts': '', 'src/db.ts': '', 'src/util.ts': '' }));
    expect(map.areas.map(area => `${area.path}:${area.tier}`)).toEqual(['src/core/**:standard', 'src/auth.ts:critical', 'src/db.ts:critical', 'src/**:standard']);
    expect(map.areas.find(area => area.path === 'src/auth.ts')?.why).toBe('file name suggests authentication; confirm');
  });

  it('classifies a file by its stem and skips test files', () => {
    const map = draftRiskMap(makeTree({ 'src/auth.service.ts': '', 'src/auth.test.ts': '', 'src/author.ts': '' }));
    expect(map.areas.map(area => area.path)).toEqual(['src/auth.service.ts', 'src/**']);
  });

  it('resolves a risky file to its own area and other files to the catch-all after a round trip', () => {
    const map = draftRiskMap(makeTree({ 'src/core/a.ts': '', 'src/auth.ts': '', 'src/other.ts': '' }));
    const loaded = loadRiskMap(makeTree({ '.testing/risk.yml': serializeRiskMap(map) }));
    expect(loaded).toEqual(map);
    expect(tierFor(map, 'src/auth.ts')).toEqual({ tier: 'critical', area: 'src/auth.ts' });
    expect(tierFor(map, 'src/other.ts')).toEqual({ tier: 'standard', area: 'src/**' });
    expect(tierFor(map, 'src/core/a.ts')).toEqual({ tier: 'standard', area: 'src/core/**' });
  });
});

describe('container directories', () => {
  it('descends through generic containers up to three levels', () => {
    const map = draftRiskMap(makeTree({ 'src/app/features/auth/a.ts': '', 'src/app/features/billing/b.ts': '', 'src/core/c.ts': '' }));
    expect(map.areas.map(area => `${area.path}:${area.tier}`)).toEqual(['src/app/features/auth/**:critical', 'src/app/features/billing/**:critical', 'src/core/**:standard']);
  });

  it('lists a container that has no subdirectories, and stops descending at the third level', () => {
    expect(candidateDirs(makeTree({ 'src/modules/x.ts': '' }))).toEqual(['src/modules']);
    expect(candidateDirs(makeTree({ 'src/modules/modules/modules/modules/a.ts': '' }))).toEqual(['src/modules/modules/modules']);
  });

  it('covers loose code inside a container with the catch-all', () => {
    const map = draftRiskMap(makeTree({ 'src/app/page.ts': '', 'src/app/features/auth/a.ts': '' }));
    expect(map.areas.map(area => area.path)).toEqual(['src/app/features/auth/**', 'src/**']);
  });

  it('stays at the package level under packages', () => {
    expect(candidateDirs(makeTree({ 'packages/core/src/auth/a.ts': '', 'packages/web/src/b.ts': '' }))).toEqual(['packages/core', 'packages/web']);
  });
});

describe('skipped names', () => {
  it('skips test support, mocks and tool directories under src', () => {
    const root = makeTree({
      'src/__mocks__/a.ts': '', 'src/mocks/a.ts': '', 'src/testing/a.ts': '', 'src/test-utils/a.ts': '', 'src/e2e/a.ts': '', 'src/spec/a.ts': '', 'src/specs/a.ts': '',
      'src/bench/a.ts': '', 'src/benchmarks/a.ts': '', 'src/helpers/a.ts': '', 'src/fixtures/a.ts': '', 'src/docs/a.ts': '', 'src/doc/a.ts': '', 'src/scripts/a.ts': '',
      'src/build/a.ts': '', 'src/real/a.ts': '',
    });
    expect(candidateDirs(root)).toEqual(['src/real']);
  });

  it('skips language tool directories at the root only when there is no source directory', () => {
    expect(candidateDirs(makeTree({ 'venv/x.py': '', 'env/x.py': '', 'target/x': '', '__pycache__/x': '', 'core/a.ts': '' }))).toEqual(['core']);
    expect(candidateDirs(makeTree({ 'src/target/a.ts': '' }))).toEqual(['src/target']);
  });
});

describe('real directory names', () => {
  it('keeps the casing of the source directory', () => {
    const root = makeTree({ 'Src/auth/a.ts': '', 'Src/loose.ts': '' });
    expect(candidateDirs(root)).toEqual(['Src/auth']);
    expect(draftRiskMap(root).areas.map(area => area.path)).toEqual(['Src/auth/**', 'Src/**']);
  });

  it('does not follow a symlinked source directory', () => {
    const root = makeTree({ 'real/auth/a.ts': '' });
    symlinkSync(join(root, 'real'), join(root, 'src'), 'junction');
    expect(candidateDirs(root)).toEqual(['real']);
  });
});

describe('route groups and decorated names', () => {
  it('classifies framework route groups by the word inside the brackets', () => {
    const map = draftRiskMap(makeTree({ 'app/(auth)/login/page.tsx': '', 'app/(marketing)/home/page.tsx': '', 'app/[slug]/page.tsx': '' }));
    expect(map.areas.map(area => `${area.path}:${area.tier}`)).toEqual(['app/(auth)/**:critical', 'app/(marketing)/**:standard', 'app/[slug]/**:standard']);
  });

  it('ignores brackets and other punctuation around a keyword', () => {
    expectAll(['[auth]', '@auth', '_auth', '(billing)', '$session'], 'critical');
  });
});

describe('critical files inside a descended container', () => {
  it('gives a risky file in a container its own area before the catch-all', () => {
    const map = draftRiskMap(makeTree({ 'src/app/auth.service.ts': '', 'src/app/user.service.ts': '', 'src/app/features/billing/a.ts': '' }));
    expect(map.areas.map(area => `${area.path}:${area.tier}`)).toEqual(['src/app/features/billing/**:critical', 'src/app/auth.service.ts:critical', 'src/**:standard']);
    expect(map.areas.find(area => area.path === 'src/app/auth.service.ts')?.why).toBe('file name suggests authentication; confirm');
  });

  it('only adds to the catch-all for a file that is not risky or is a test', () => {
    const map = draftRiskMap(makeTree({ 'src/app/user.service.ts': '', 'src/app/auth.test.ts': '', 'src/app/features/ok/a.ts': '' }));
    expect(map.areas.map(area => area.path)).toEqual(['src/app/features/ok/**', 'src/**']);
  });

  it('keeps risky container files in a tier order that resolves them first', () => {
    const map = draftRiskMap(makeTree({ 'src/app/auth.service.ts': '', 'src/app/features/ok/a.ts': '' }));
    expect(tierFor(map, 'src/app/auth.service.ts')).toEqual({ tier: 'critical', area: 'src/app/auth.service.ts' });
    expect(tierFor(map, 'src/app/other.ts')).toEqual({ tier: 'standard', area: 'src/**' });
  });
});

describe('grouping directories that hide critical children', () => {
  it('descends through api, routes, services, controllers and server directories', () => {
    const map = draftRiskMap(
      makeTree({ 'src/api/auth/a.ts': '', 'src/routes/auth/a.ts': '', 'src/services/payments/a.ts': '', 'src/server/auth/a.ts': '', 'src/controllers/billing/a.ts': '', 'src/handlers/misc/a.ts': '' }),
    );
    expect(map.areas.map(area => `${area.path}:${area.tier}`)).toEqual([
      'src/api/auth/**:critical',
      'src/controllers/billing/**:critical',
      'src/handlers/misc/**:standard',
      'src/routes/auth/**:critical',
      'src/server/auth/**:critical',
      'src/services/payments/**:critical',
    ]);
    expect(candidateDirs(makeTree({ 'app/api/auth/a.ts': '' }))).toEqual(['app/api/auth']);
    expect(candidateDirs(makeTree({ 'src/backend/db/a.ts': '', 'src/domain/ledger/a.ts': '' }))).toEqual(['src/backend/db', 'src/domain/ledger']);
  });

  it('lists a grouping directory as itself when it has no usable subdirectory', () => {
    expect(candidateDirs(makeTree({ 'src/api/x.ts': '' }))).toEqual(['src/api']);
    expect(candidateDirs(makeTree({ 'src/api/tests/a.ts': '', 'src/core/b.ts': '' }))).toEqual(['src/api', 'src/core']);
  });

  it('classifies the children of core and covers its loose files with the catch-all', () => {
    const map = draftRiskMap(makeTree({ 'src/core/auth/a.ts': '', 'src/core/util.ts': '' }));
    expect(map.areas.map(area => `${area.path}:${area.tier}`)).toEqual(['src/core/auth/**:critical', 'src/**:standard']);
  });
});

describe('more security vocabulary', () => {
  it('marks identity, web security, secrets and payment provider names critical', () => {
    expectAll(['iam', 'identity', 'identities', 'sso', 'mfa', 'otp', 'vault', 'csrf', 'cookie', 'cookies', 'stripe', 'webhook', 'webhooks', 'authorisation'], 'critical');
  });

  it('leaves order names standard and says tokens may be design tokens', () => {
    expectAll(['order', 'orders'], 'standard');
    const map = draftRiskMap(makeTree({ 'src/tokens/a.ts': '' }));
    expect(map.areas[0]?.why).toBe('name suggests tokens (auth or design); confirm');
  });
});
