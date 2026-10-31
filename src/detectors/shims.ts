import type { ParsedFile } from '../parse.ts';
import type { Finding } from '../schema.ts';

/** Old data, formats or interfaces that a title can call legacy; "legacy" next to anything else usually describes current behaviour. */
const OLD_LAYER_NOUN =
  String.raw`(?:formats?|files?|configs?|configurations?|json|schemas?|loaders?|readers?|parsers?|payloads?|apis?|v\d+|projects?|data|inputs?|outputs?|sockets?|saves?|documents?|provenance|ownership|alias(?:es)?|adapters?|importers?|imports?|modes?|wrappers?|options?|flags?|settings?|paths?)`;
/**
 * Title-only markers of a compatibility layer. Bare "fallback" and "compat" are left out: titles use them for current
 * behaviour (a fallback glyph, a compat shorthand option). Each alternative must name the old thing being kept.
 */
const TITLE_MARKER = new RegExp(
  [
    String.raw`\blegacy(?:\s+[\w-]+){0,2}\s+${OLD_LAYER_NOUN}\b`,
    String.raw`\b(?:accepts?|loads?|reads?|imports?|parses?|supports?|upgrades?|migrates?)\s+(?:\w+\s+)?legacy\b`,
    String.raw`\blegacy\b[^,;]*\b(?:migrat(?:e|es|ed|ing|ion)|upgrad(?:e|es|ed|ing))\b`,
    String.raw`\bback(?:wards?)?[- ]?compat(?:ibility|ible)?\b`,
    String.raw`\bcompat(?:ibility)?\s+(?:layers?|shims?|modes?|paths?|wrappers?|adapters?|aliases|with\s+(?:old|older|legacy|previous|prior))\b`,
    String.raw`\bdeprecat(?:ed|es|e|ion)\b`,
    String.raw`\bfall(?:s|ing)?[- ]?backs?\s+(?:to\s+)?(?:the\s+|an?\s+)?(?:old|older|legacy|previous|prior|v\d+)\b`,
    String.raw`\bfall-?back\s+(?:shims?|layers?|adapters?)\b`,
    String.raw`\bpolyfills?\b`,
    String.raw`\bshims?\b`,
    String.raw`\bmigrat(?:e|es|ed|ing|ion) from\b`,
    String.raw`\bold[- ]format\b`,
  ].join('|'),
  'i',
);
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
