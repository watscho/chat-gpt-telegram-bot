import { rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
rmSync(new URL('../dist/', import.meta.url), { recursive: true, force: true })
const result = spawnSync(
  process.execPath,
  ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json'],
  { stdio: 'inherit' }
)
process.exit(result.status ?? 1)
