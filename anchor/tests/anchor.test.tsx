import { describe, expect, mock, test } from 'claude-code/testing'

const PANE = {
  component: 'Pane',
  requestId: 'anchor',
  props: { bodyColumns: 80 },
} as never

describe('anchor', () => {
  test('a pin joins the system prompt and shows in the panel', async ($, on) => {
    mock.store(on)
    mock.clock(on, { now: 1000 })
    on('session.cwd', () => ({ value: '/proj' }) as never)
    on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'hi', scope: 'shared' }] }))
    await $.command.run({ command: 'anchor', args: 'we use pnpm, never npm' } as never)
    const out = await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] } as never)
    const ids = out.sections.map(s => s.id)
    expect(ids).toContain('anchor:pins')
    expect(out.sections.find(s => s.id === 'anchor:pins')?.text).toContain('pnpm')
    const ui = await $.ui.mount({ plugin: 'anchor', surface: 'desktop', ...(PANE as object) } as never)
    expect(await (ui as any).find({ type: 'Text', text: /pnpm/ })).toBeDefined()
    await (ui as any).unmount()
  })
})
