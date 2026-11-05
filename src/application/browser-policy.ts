import { UserError } from '../domain/conversation.js'
export function browserCall(
  policy: { origins: string[]; tools: string[] },
  name: string,
  args: string
): void {
  if (!policy.tools.includes(name) || args.length > 12000)
    throw new UserError('Browser tool is outside the reviewed recipe.')
  let value: unknown
  try {
    value = JSON.parse(args)
  } catch {
    throw new UserError('Browser action arguments must be reviewable JSON.')
  }
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !('origin' in value) ||
    typeof value.origin !== 'string' ||
    !policy.origins.includes(value.origin)
  )
    throw new UserError(
      'Browser operations require an exact permitted origin in their arguments.'
    )
  const inspect = (item: unknown, depth: number): void => {
    if (depth > 10)
      throw new UserError('Browser arguments exceed the nesting limit.')
    if (Array.isArray(item)) {
      for (const child of item) inspect(child, depth + 1)
    } else if (item && typeof item === 'object')
      for (const [key, child] of Object.entries(item)) {
        if (['url', 'href', 'origin'].includes(key)) {
          if (typeof child !== 'string')
            throw new UserError(
              'Browser URL arguments must be explicit HTTPS addresses.'
            )
          let url: URL
          try {
            url = new URL(child)
          } catch {
            throw new UserError('Browser action URL is invalid.')
          }
          if (
            !policy.origins.includes(url.origin) ||
            url.username ||
            url.password
          )
            throw new UserError(
              'Browser action URL leaves the permitted origins.'
            )
        }
        inspect(child, depth + 1)
      }
  }
  inspect(value, 0)
}
