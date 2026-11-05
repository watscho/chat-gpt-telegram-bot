import { prePush } from '../src/tooling/git-hooks.ts'
try {
  prePush()
} catch (error) {
  console.error(
    error instanceof Error ? error.message : 'Pre-push checks failed.'
  )
  process.exitCode = 1
}
