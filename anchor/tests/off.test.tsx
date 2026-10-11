import { describe, expect, mock, test } from 'claude-code/testing'

const COMPOSE = { model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] } as never

describe('anchor off switch', () => {
  test('/anchor off stops sending pins without deleting them; /anchor on brings them back', async ($, on) => {
    mock.store(on)
    mock.clock(on, { now: 1000 })
    on('session.cwd', () => ({ value: '/proj' }) as never)
    on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'hi', scope: 'shared' }] }))
    const run = (args: string) => $.command.run({ command: 'anchor', args } as never)

    await run('we use pnpm')
    await run('off')
    expect((await $.prompt.compose(COMPOSE)).sections.map(s => s.id)).not.toContain('anchor:pins')
    await run('on')
    expect((await $.prompt.compose(COMPOSE)).sections.map(s => s.id)).toContain('anchor:pins')
  })
})
