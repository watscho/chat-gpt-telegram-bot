import { installHooks } from '../src/tooling/git-hooks.ts'
try {
  installHooks()
} catch (error) {
  console.error(
    error instanceof Error ? error.message : 'Git hook installation failed.'
  )
  process.exitCode = 1
}
