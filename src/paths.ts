import { relative, sep } from 'node:path';

/** Repo-relative paths are stored with forward slashes on every OS. */
export const toPosix = (path: string): string => path.split(sep).join('/');

export const relPosix = (root: string, absolute: string): string => toPosix(relative(root, absolute));

/** Minimal glob: `**` crosses directories, `*` and `?` stay inside one path segment. */
export function globToRegExp(glob: string): RegExp {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          out += '(?:.*/)?';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
      } else out += '[^/]*';
    } else if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}
