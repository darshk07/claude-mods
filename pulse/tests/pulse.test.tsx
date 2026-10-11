import { describe, expect, mock, test } from 'claude-code/testing'
import type { SessionMeasureInput } from 'claude-code'

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 140, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

const at = (tokens: number): SessionMeasureInput => ({
  context: { tokens, window: 200_000, percent: Math.round((tokens / 200_000) * 100) },
  rateLimits: [{ kind: 'five_hour', percentUsed: 23.5 }],
  changed: ['context', 'rateLimits'],
})

describe('pulse banner', () => {
  test('shows context and each usage limit, and a compact button past 75%', async ($, on) => {
    on('session.measure', ($, e) => ({ changed: e.changed }))
    on('ui.toast', () => ({ value: undefined }))
    mock.store(on)
    await $.session.measure(at(160_000))
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'pulse', surface, ...BAND })
      expect(await ui.find({ type: 'Text', text: /Context/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /160k of 200k/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /5-hour/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /\$/ })).toBeUndefined()
      expect(await ui.find({ key: 'compact' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('the mode button switches to mini (no detail lines) and back', async ($, on) => {
    on('session.measure', ($, e) => ({ changed: e.changed }))
    on('ui.toast', () => ({ value: undefined }))
    mock.store(on)
    await $.session.measure(at(30_000))
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'pulse', surface, ...BAND })
      expect(await ui.find({ type: 'Text', text: /30\.0k of 200k/ })).toBeDefined()
      expect(await ui.find({ key: 'compact' })).toBeUndefined()
      await ui.press({ key: 'mode' })
      expect(await ui.find({ type: 'Text', text: /30\.0k of 200k/ })).toBeUndefined()
      await ui.press({ key: 'mode' })
      expect(await ui.find({ type: 'Text', text: /30\.0k of 200k/ })).toBeDefined()
      await ui.unmount()
    }
  })
})
