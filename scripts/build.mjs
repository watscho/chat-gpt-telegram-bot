import { build } from 'esbuild'
import { rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
rmSync(new URL('../dist/', import.meta.url), { recursive: true, force: true })
const result = spawnSync(
  process.execPath,
  ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json'],
  { stdio: 'inherit' }
)
if (result.status !== 0) process.exit(result.status ?? 1)
await build({
  entryPoints: ['src/web/voice-client.ts', 'src/web/workspace-client.ts'],
  outdir: 'dist/web',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2023',
  sourcemap: true
})
