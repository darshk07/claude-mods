import { describe, expect, mock, test } from 'claude-code/testing'

describe('diet', () => {
  test('the panel opens and reports nothing trimmed yet', async ($, on) => {
    mock.store(on)
    on('ui.open', () => ({ value: { isPlaced: true } }) as never)
    const ui = await $.ui.mount({
      plugin: 'diet',
      surface: 'desktop',
      component: 'Pane',
      requestId: 'diet',
      props: { bodyColumns: 80 },
    } as never)
    expect(await (ui as any).find({ type: 'Text', text: /Nothing trimmed yet/ })).toBeDefined()
    await (ui as any).unmount()
  })
})
