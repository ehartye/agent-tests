/** Error with a stable machine-readable code; the CLI prints it as one-line JSON on stderr. */
export class CliError extends Error {
  readonly code: string;
  readonly hint?: string;

  constructor(code: string, message: string, hint?: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CliError';
    this.code = code;
    if (hint) this.hint = hint;
  }
}
