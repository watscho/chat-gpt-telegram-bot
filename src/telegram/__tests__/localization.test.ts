import { test } from 'node:test'
import assert from 'node:assert/strict'
import messages from '../locales/messages.json' with { type: 'json' }
import { translate, translateKeyboard } from '../localization.js'
void test('UI catalogs interpolate controls without rewriting unknown content or callback payloads', () => {
  assert.equal(translate('Working…', 'en'), 'Working…')
  for (const language of ['ru', 'es'] as const) {
    assert.equal(
      translate('Working…', language),
      messages[language]['Working…']
    )
    assert.equal(
      translate('Unknown source excerpt\nUntranslated content', language),
      'Unknown source excerpt\nUntranslated content'
    )
    assert.equal(
      translate('Requests: 3/10', language),
      messages[language]['Requests: {value}'].replace('{value}', '3/10')
    )
    assert.equal(
      translateKeyboard(
        {
          inline_keyboard: [
            [
              { text: 'Done', callback_data: 'task:done:123' },
              { text: 'Custom title', url: 'https://example.com' }
            ]
          ]
        },
        language
      ).inline_keyboard[0]![0]!.text,
      messages[language].Done
    )
  }
  assert.deepEqual(
    Object.keys(messages.ru).sort(),
    Object.keys(messages.es).sort()
  )
  for (const language of ['ru', 'es'] as const)
    for (const [source, target] of Object.entries(messages[language]))
      assert.deepEqual(
        [...source.matchAll(/\{([a-z]+)\}/g)].map(match => match[1]).sort(),
        [...target.matchAll(/\{([a-z]+)\}/g)].map(match => match[1]).sort()
      )
})
