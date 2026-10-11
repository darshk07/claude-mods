import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Trim } from '../types'

const PANE = 'diet'
const trims = atom({ plugin: 'diet', key: 'trims' } as const, [])
const isOn = atom({ plugin: 'diet', key: 'isOn' } as const, true)
const limit = atom({ plugin: 'diet', key: 'limit' } as const, 20_000)
const savedChars = atom({ plugin: 'diet', key: 'savedChars' } as const, 0)

const ACCENT = '#34d399'
const MIN_LIMIT = 4_000
const KEEP_LIST = 40
// Output of these tools is trimmed; file reads and edits are never touched, since
// the model needs their text exactly.
const TRIMMABLE = new Set(['Bash', 'Grep', 'WebFetch', 'WebSearch'])

const tokens = (chars: number) => Math.round(chars / 4)
const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : `${n}`)

/** The text of a tool_result's content, or null when it holds anything but text. */
function textOf(content: unknown): string | null {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return null
  let out = ''
  for (const part of content) {
    if (typeof part !== 'object' || part === null) return null
    const p = part as { type?: unknown; text?: unknown }
    if (p.type !== 'text' || typeof p.text !== 'string') return null
    out += (out ? '\n' : '') + p.text
  }
  return out
}

/** Cut at line boundaries where there is one close by, so the stubs read cleanly. */
function headOf(text: string, n: number) {
  const cut = text.slice(0, n)
  const nl = cut.lastIndexOf('\n')
  return nl > n * 0.6 ? cut.slice(0, nl) : cut
}
function tailOf(text: string, n: number) {
  const cut = text.slice(-n)
  const nl = cut.indexOf('\n')
  return nl >= 0 && nl < n * 0.4 ? cut.slice(nl + 1) : cut
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'diet',
      description: 'Context Diet: /diet (panel), /diet on|off, /diet limit <chars>',
      argumentHint: 'on | off | limit <chars>',
    })
    const savedOn = await $.store.get('isOn')
    if (typeof savedOn === 'boolean') await update($, isOn, () => savedOn)
    const savedLimit = await $.store.get('limit')
    if (typeof savedLimit === 'number') await update($, limit, () => savedLimit)
    return next(e)
  })

  on('command.run', { command: 'diet' }, async ($, e) => {
    const [word = '', value = ''] = e.args.trim().toLowerCase().split(/\s+/)
    if (word === 'on' || word === 'off') {
      await update($, isOn, () => word === 'on')
      await $.store.set('isOn', word === 'on')
      return { text: `Context Diet is ${word}.` }
    }
    if (word === 'limit') {
      const n = Number(value)
      if (!Number.isFinite(n) || n < MIN_LIMIT) {
        return { text: `Usage: /diet limit <chars>, at least ${MIN_LIMIT}. Now ${await read($, limit)}.` }
      }
      await update($, limit, () => Math.round(n))
      await $.store.set('limit', Math.round(n))
      return { text: `Outputs over ${Math.round(n)} characters are trimmed.` }
    }
    await $.ui.open({ id: PANE, title: 'Context Diet' })
    return { text: 'Context Diet panel opened.' }
  })

  on('session.append', { door: 'tool-result' }, async ($, e, next) => {
    if (!(await read($, isOn))) return next(e)
    const tool = e.origin.kind === 'tool' ? e.origin.tool : ''
    if (!TRIMMABLE.has(tool) && !tool.startsWith('mcp__')) return next(e)

    const max = await read($, limit)
    const headChars = Math.round(max * 0.3)
    const tailChars = Math.round(max * 0.2)
    const done: Trim[] = []
    const content = []

    for (const block of e.message.content) {
      const text = block.type === 'tool_result' ? textOf(block.content) : null
      if (text === null || text.length <= max) {
        content.push(block)
        continue
      }
      const id = `${e.uuid}-${done.length}`
      const tmp = (await $.env.get('TEMP')) ?? (await $.env.get('TMPDIR')) ?? '/tmp'
      const path = `${tmp.replace(/\\/g, '/')}/claude-diet/${id}.txt`
      let saved: string | null = path
      try {
        await $.fs.write(path, text)
      } catch {
        saved = null
      }
      const omitted = text.length - headChars - tailChars
      const note =
        `\n\n[… ${omitted} of ${text.length} characters (~${fmt(tokens(omitted))} tokens) trimmed by Context Diet` +
        (saved ? `; the full output is saved at ${saved} — grep or read it if you need the middle` : '') +
        ` …]\n\n`
      const trimmed = headOf(text, headChars) + note + tailOf(text, tailChars)
      content.push({ ...block, content: trimmed })
      done.push({ id, tool, before: text.length, after: trimmed.length, path: saved, at: await $.clock.now() })
    }

    if (done.length === 0) return next(e)

    await update($, trims, list => [...done.reverse(), ...list].slice(0, KEEP_LIST))
    const gained = done.reduce((a, t) => a + (t.before - t.after), 0)
    await update($, savedChars, n => n + gained)
    if (tokens(gained) >= 3000) {
      $.ui.toast(`Diet: trimmed ${tool} output, saved ~${fmt(tokens(gained))} tokens`)
    }
    return next({ ...e, message: { ...e.message, content } })
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, trims)
    const active = await read($, isOn)
    const max = await read($, limit)
    const total = await read($, savedChars)
    const room = Math.max(1, (e.viewport?.rows ?? 24) - 7)
    const folder = list.find(t => t.path)?.path?.replace(/\/[^/]*$/, '') ?? null

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" alignItems="center" gap={2}>
          {active ? (
            <Text>
              <Text bold color={ACCENT}>
                ~{fmt(tokens(total))}
              </Text>
              <Text dimColor>{` tokens saved · ${list.length} ${list.length === 1 ? 'output' : 'outputs'} trimmed`}</Text>
            </Text>
          ) : (
            <Text dimColor>Paused — outputs reach the context in full</Text>
          )}
          <Box flexGrow={1} />
          <Button
            key="toggle"
            plain
            label={active ? 'Pause' : 'Resume'}
            onPress={async () => {
              await update($, isOn, v => !v)
              await $.store.set('isOn', !active)
            }}
          />
          {list.length > 0 && <Button key="clear" plain label="Clear" onPress={() => update($, trims, () => [])} />}
        </Box>

        {list.length === 0 ? (
          <Text dimColor>Nothing trimmed yet.</Text>
        ) : (
          <Box flexDirection="column">
            {list.slice(0, room).map(t => (
              <Box key={t.id} flexDirection="row" gap={2}>
                <Text bold>{t.tool.startsWith('mcp__') ? t.tool.split('__')[1] ?? t.tool : t.tool}</Text>
                <Text dimColor>{`${fmt(t.before)} → ${fmt(t.after)} chars`}</Text>
                <Box flexGrow={1} />
                <Text color={ACCENT}>{`−${fmt(tokens(t.before - t.after))}`}</Text>
              </Box>
            ))}
          </Box>
        )}

        <Text dimColor>
          {`Bash, Grep, web and MCP outputs over ${fmt(max)} characters keep their start and end.`}
          {folder ? ` Full text: ${folder}` : ''}
        </Text>
      </Box>
    )
  })
}
