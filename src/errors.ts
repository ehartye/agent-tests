/** Error with a stable machine-readable code; the CLI prints it as one-line JSON on stderr. */
export class CliError extends Error {
  code: string;
  hint?: string;

  constructor(code: string, message: string, hint?: string) {
    super(message);
    this.name = 'CliError';
    this.code = code;
    if (hint) this.hint = hint;
  }
}
