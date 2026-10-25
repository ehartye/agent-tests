import fs from 'node:fs'

export const packError = (error) => ({ name: String(error?.name ?? 'Error'), message: String(error?.message ?? error?.value ?? error ?? '') })

/** Inspect the actual error identity/first diagnostic, never a reporter's source snippet or captured console text. */
export function isInfrastructureError(error) {
  if (error?.name === 'AssertionError') return false
  if (error?.name === 'SyntaxError' || error?.code === 'ERR_MODULE_NOT_FOUND') return true
  const first = String(error?.message ?? '').replace(/\u001b\[[0-9;]*m/g, '').split('\n')[0]
  if (/^(?:Error:\s*)?expect\(/.test(first)) return false
  return /^(?:(?:Error:\s*)?(?:page\.evaluate:\s*)?)(?:SyntaxError:|Transform failed|Cannot find module|Cannot find package|No tests? found|No test files found|error TS\d+)/i.test(first)
}

export function writeReport(runner, passed, failed, runtimeErrors) {
  const target = process.env.RATTLETIN_MUTATION_REPORT
  if (!target) throw new Error('RATTLETIN_MUTATION_REPORT is required by the mutation reporter')
  fs.writeFileSync(target, JSON.stringify({ schema: 'rattletin/test-run@1', runner, passed, failed, runtimeErrors: runtimeErrors.map(packError) }))
}
