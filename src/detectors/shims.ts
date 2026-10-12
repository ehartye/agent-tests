import type { ParsedFile } from '../parse.ts';
import type { Finding } from '../schema.ts';

const TITLE_MARKER =
  /\b(?:legacy|back(?:wards?)?[- ]?compat(?:ibility|ible)?|compat(?:ibility)?|deprecat(?:ed|es|e|ion)|fall-?backs?|polyfills?|shims?|migrat(?:e|es|ed|ing|ion) from|old[- ]format)\b/i;
const PATH_MARKER = /(?:^|[/._-])(?:legacy|compat|deprecated|shims?|polyfills?|fallbacks?)(?:[/._-]|$)/i;
/** A specifier is project code, not a package, when it is relative or starts with a common alias. */
const PROJECT_SPECIFIER = /^(?:\.|@\/|~\/|#|src\/)/;
const EVIDENCE_WIDTH = 160;

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
        evidence: title.text.slice(0, EVIDENCE_WIDTH),
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
  for (const spec of new Set(parsed.imports)) {
    if (PROJECT_SPECIFIER.test(spec) && PATH_MARKER.test(spec.replace(/^(?:@\/|~\/|#)/, ''))) {
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
