import type { ParsedFile } from '../parse.ts';
import type { Finding } from '../schema.ts';

const TITLE_MARKER =
  /\b(?:legacy|back(?:wards?)?[- ]?compat(?:ibility|ible)?|compat(?:ibility)?|deprecated|fall-?back|polyfill|shim|migrat(?:e|es|ion|ing) from|old[- ]format)\b/i;
const PATH_MARKER = /(?:^|[/._-])(?:legacy|compat|deprecated|shims?|polyfills?)(?:[/._-]|$)/i;

/** Tests that protect legacy, compatibility or fallback paths. Whether anyone still needs them is the consumers list's call. */
export function detectShims(file: string, parsed: ParsedFile): Finding[] {
  const findings: Finding[] = [];
  for (const title of parsed.titles) {
    if (TITLE_MARKER.test(title.text)) {
      findings.push({
        category: 'shim',
        rule: 'shim.title-marker',
        file,
        line: title.line,
        message: 'Test title names a legacy, compatibility or fallback path. Check that a consumer still needs it.',
        evidence: title.text,
      });
    }
  }
  if (PATH_MARKER.test(file)) {
    findings.push({
      category: 'shim',
      rule: 'shim.path-marker',
      file,
      message: 'Test file path names a legacy, compatibility or fallback area.',
      evidence: file,
    });
  }
  for (const spec of parsed.imports) {
    if (spec.startsWith('.') && PATH_MARKER.test(spec)) {
      findings.push({
        category: 'shim',
        rule: 'shim.legacy-import',
        file,
        message: 'Test imports a legacy, compat or shim module.',
        evidence: spec,
      });
    }
  }
  return findings;
}
