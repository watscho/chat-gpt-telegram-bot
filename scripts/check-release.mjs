import { checkRelease } from '../src/tooling/release-checks.ts'
try {
  checkRelease()
} catch (error) {
  console.error(
    error instanceof Error ? error.message : 'Release checks failed.'
  )
  process.exitCode = 1
}
