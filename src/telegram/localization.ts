import messages from './locales/messages.json' with { type: 'json' }
import type { UiLanguage } from '../domain/experience.js'
import type { InlineKeyboardMarkup } from 'telegraf/types'

const dictionaries: Record<string, Record<string, string>> = messages
const compiled = Object.fromEntries(
  Object.entries(dictionaries).map(([language, entries]) => [
    language,
    Object.entries(entries).map(([source, target]) => {
      const names: string[] = []
      const pattern = source
        .split(/(\{[a-z]+\})/g)
        .map(part => {
          if (/^\{[a-z]+\}$/.test(part)) {
            names.push(part.slice(1, -1))
            return '([\\s\\S]*?)'
          }
          return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        })
        .join('')
      return { pattern: new RegExp(`^${pattern}$`), names, target }
    })
  ])
)
export function translate(text: string, language: UiLanguage): string {
  if (language === 'en') return text
  return text
    .split('\n')
    .map(line => {
      for (const entry of compiled[language]!) {
        const match = line.match(entry.pattern)
        if (match)
          return entry.target.replace(
            /\{([a-z]+)\}/g,
            (_key, name: string) => match[entry.names.indexOf(name) + 1]!
          )
      }
      return line
    })
    .join('\n')
}
export function translateKeyboard(
  markup: InlineKeyboardMarkup,
  language: UiLanguage
): InlineKeyboardMarkup {
  return {
    inline_keyboard: markup.inline_keyboard.map(row =>
      row.map(button => ({ ...button, text: translate(button.text, language) }))
    )
  }
}
