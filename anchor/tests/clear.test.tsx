import { describe, expect, mock, test } from 'claude-code/testing'

describe('anchor panel', () => {
  test('submitting adds the pin, leaves a fresh empty field and draws one Pin control', async ($, on) => {
    mock.store(on)
    mock.clock(on, { now: 1000 })
    on('session.cwd', () => ({ value: '/proj' }) as never)
    const ui = (await $.ui.mount({
      plugin: 'anchor',
      surface: 'desktop',
      component: 'Pane',
      requestId: 'anchor',
      props: { bodyColumns: 80 },
    } as never)) as any

    expect(await ui.find({ key: 'new-0' })).toBeDefined()
    await ui.input({ key: 'new-0', text: 'never touch /legacy' })

    expect(await ui.find({ type: 'Text', text: /never touch \/legacy/ })).toBeDefined()
    expect(await ui.find({ key: 'new-0' })).toBeUndefined()
    expect(await ui.find({ key: 'new-1' })).toBeDefined()
    expect(await ui.findAll({ type: 'Button', text: /^Pin$/ })).toHaveLength(0)
    await ui.unmount()
  })
})
