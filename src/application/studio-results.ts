import { UserError } from '../domain/conversation.js'
export function replacePassage(
  text: string,
  before: string,
  after: string
): string {
  if (
    !before ||
    text.indexOf(before) < 0 ||
    text.indexOf(before) !== text.lastIndexOf(before)
  )
    throw new UserError(
      'Choose one exact, uniquely occurring passage to replace.'
    )
  return text.replace(before, () => after)
}
export function compareResults(before: string, after: string): string {
  const a = before.split('\n'),
    b = after.split('\n')
  let start = 0,
    end = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - end - 1] === b[b.length - end - 1]
  )
    end++
  return start === a.length && start === b.length
    ? 'No text changes.'
    : `Changed block after line ${start}:\n${a
        .slice(start, a.length - end)
        .map(line => `- ${line}`)
        .join('\n')}\n${b
        .slice(start, b.length - end)
        .map(line => `+ ${line}`)
        .join('\n')}`
}
