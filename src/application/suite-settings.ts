import type { SuiteConfig } from '../domain/suite.js'
export function suiteSettings(
  env: NodeJS.ProcessEnv,
  integer: (key: string, fallback: number, max: number) => number
): SuiteConfig {
  const reviewModels = [
    ...new Set(
      (env.OPENAI_REVIEW_MODELS ?? 'gpt-6.1-sol,gpt-6-astra')
        .split(',')
        .map(value => value.trim())
    )
  ]
  const ffprobePath = env.FFPROBE_PATH?.trim() || 'ffprobe'
  if (
    !reviewModels.length ||
    reviewModels.length > 10 ||
    reviewModels.some(
      model => !model || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,99}$/.test(model)
    ) ||
    ffprobePath.length > 512 ||
    /[\r\n\0]/.test(ffprobePath)
  )
    throw new Error('Invalid Pro Suite configuration.')
  return {
    reviewModels,
    reviewExtra: integer('ESTIMATE_REVIEW_EXTRA_MICRO_USD', 100000, 100000000),
    videoBytes: integer('MAX_VIDEO_BYTES', 20000000, 20000000),
    videoSeconds: integer('MAX_VIDEO_CLIP_SECONDS', 120, 300),
    videoFrames: integer('MAX_VIDEO_FRAMES', 8, 10),
    ffprobePath
  }
}
