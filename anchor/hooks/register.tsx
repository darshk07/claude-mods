import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Pin } from '../types'

const PANE = 'anchor'
const pins = atom({ plugin: 'anchor', key: 'pins' } as const, [])
// Bumped on every pin; the input's key carries it, so the field remounts empty.
const epoch = atom({ plugin: 'anchor', key: 'epoch' } as const, 0)
// Off keeps the pins but stops sending them.
const isOn = atom({ plugin: 'anchor', key: 'isOn' } as const, true)

const ACCENT = '#a78bfa'
const MAX_PINS = 30
const MAX_LEN = 400
const tokens = (list: Pin[]) => Math.round(list.reduce((n, p) => n + p.text.length + 3, 90) / 4)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'anchor',
      description: 'Pin a fact or rule that is re-sent every turn: /anchor <text>, /anchor rm <n>, /anchor clear, /anchor on|off, /anchor (panel)',
      argumentHint: '<text> | rm <n> | clear | on | off',
    })
    const cwd = await $.session.cwd()
    const saved = await $.store.get(`pins:${cwd}`)
    if (Array.isArray(saved)) await update($, pins, () => saved as Pin[])
    const savedOn = await $.store.get('isOn')
    if (typeof savedOn === 'boolean') await update($, isOn, () => savedOn)
    return next(e)
  })

  on('command.run', { command: 'anchor' }, async ($, e) => {
    const arg = e.args.trim()
    const cwd = await $.session.cwd()

    if (arg === '') {
      await $.ui.open({ id: PANE, title: 'Anchor' })
      return { text: 'Anchor panel opened.' }
    }
    if (arg === 'on' || arg === 'off') {
      await update($, isOn, () => arg === 'on')
      await $.store.set('isOn', arg === 'on')
      $.ui.invalidate('prompt.section')
      return { text: arg === 'on' ? 'Anchor is on: pins are sent again.' : 'Anchor is off: pins are kept but not sent.' }
    }
    if (arg === 'clear') {
      await update($, pins, () => [])
      await $.store.set(`pins:${cwd}`, [])
      $.ui.invalidate('prompt.section')
      return { text: 'All pins removed.' }
    }
    const rm = /^rm\s+(\d+)$/.exec(arg)
    if (rm) {
      const list = await read($, pins)
      const index = Number(rm[1]) - 1
      if (index < 0 || index >= list.length) return { text: `No pin ${rm[1]}.` }
      const next = list.filter((_, i) => i !== index)
      await update($, pins, () => next)
      await $.store.set(`pins:${cwd}`, next)
      $.ui.invalidate('prompt.section')
      return { text: `Unpinned: ${list[index]!.text}` }
    }

    const list = await read($, pins)
    if (list.length >= MAX_PINS) return { text: `At most ${MAX_PINS} pins. Remove one with /anchor rm <n>.` }
    const pin: Pin = { id: `${await $.clock.now()}`, text: arg.slice(0, MAX_LEN), at: await $.clock.now() }
    const next = [...list, pin]
    await update($, pins, () => next)
    await $.store.set(`pins:${cwd}`, next)
    $.ui.invalidate('prompt.section')
    return { text: `Pinned (${next.length}): ${pin.text}` }
  })

  // The pins ride the system prompt, so a compaction, which rewrites only the
  // conversation, can never drop them.
  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)
    const list = await read($, pins)
    if (list.length === 0 || !(await read($, isOn))) return result
    const text =
      'Pinned by the user. These hold for the whole session, whatever the conversation says or has forgotten:\n' +
      list.map(p => `- ${p.text}`).join('\n')
    return { sections: [...result.sections, { id: 'anchor:pins', text, scope: 'session' as const }] }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Text, Button } = table
    const Input = 'Input' in table ? table.Input : null
    const list = await read($, pins)
    const round = await read($, epoch)
    const active = await read($, isOn)

    // Always applied to the pins as they are now, not as they were when this was drawn.
    const change = async (fn: (current: Pin[]) => Pin[]) => {
      const cwd = await $.session.cwd()
      const next = fn(await read($, pins))
      await update($, pins, () => next)
      await $.store.set(`pins:${cwd}`, next)
      $.ui.invalidate('prompt.section')
    }

    const add = async (value: string) => {
      const text = value.trim().slice(0, MAX_LEN)
      if (!text) return
      const at = await $.clock.now()
      await change(current => (current.length >= MAX_PINS ? current : [...current, { id: `${at}`, text, at }]))
      await update($, epoch, n => n + 1)
    }

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" alignItems="center" gap={2}>
          {active ? (
            <Text>
              <Text bold color={ACCENT}>
                {list.length === 0 ? 'No pins' : `${list.length} ${list.length === 1 ? 'pin' : 'pins'}`}
              </Text>
              <Text dimColor>{` · re-sent every turn, kept through /compact${list.length ? ` · ~${tokens(list)} tokens` : ''}`}</Text>
            </Text>
          ) : (
            <Text dimColor>Paused — pins are kept but not sent</Text>
          )}
          <Box flexGrow={1} />
          <Button
            key="toggle"
            plain
            label={active ? 'Pause' : 'Resume'}
            onPress={async () => {
              await update($, isOn, v => !v)
              await $.store.set('isOn', !active)
              $.ui.invalidate('prompt.section')
            }}
          />
        </Box>

        {list.length > 0 && (
          <Box flexDirection="column">
            {list.map((p, i) => (
              <Box key={`pin-${p.id}`} flexDirection="row" gap={2} alignItems="center">
                <Text dimColor>{`${i + 1}`}</Text>
                <Text>{p.text}</Text>
                <Box flexGrow={1} />
                <Button
                  key={`rm-${p.id}`}
                  plain
                  label="✕"
                  onPress={() => change(current => current.filter(x => x.id !== p.id))}
                />
              </Box>
            ))}
          </Box>
        )}

        {Input && list.length < MAX_PINS && (
          <Input
            key={`new-${round}`}
            placeholder={list.length === 0 ? 'e.g. we use pnpm, never npm' : 'Add a fact, decision or rule'}
            submitLabel="Pin"
            onSubmit={value => add(value)}
          />
        )}
      </Box>
    )
  })
}
