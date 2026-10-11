import { atom, read, update } from 'claude-code'
import type { Register, SessionContextUsage, SessionRateLimit } from 'claude-code'

import type { PulseMode, PulseSnap } from '../types'

// ── state ────────────────────────────────────────────────────────────────
const snap = atom({ plugin: 'pulse', key: 'snap' } as const, null)
const history = atom({ plugin: 'pulse', key: 'history' } as const, [])
const mode = atom({ plugin: 'pulse', key: 'mode' } as const, 'full')
const alerted = atom({ plugin: 'pulse', key: 'alerted' } as const, 0)

const THRESHOLDS = [70, 85, 95]
const HISTORY_LEN = 32
const MODE_KEY = 'mode'

// ── palette ──────────────────────────────────────────────────────────────
const TRACK = 'rgba(148,163,184,0.25)'

// Continuous colour ramp: the hue slides green → lime → amber → orange → red with the fill.
const STOPS: [number, [number, number, number]][] = [
  [0, [52, 211, 153]],
  [45, [163, 230, 53]],
  [65, [251, 191, 36]],
  [85, [251, 146, 60]],
  [100, [244, 63, 94]],
]
const hex = (c: number[]) => `#${c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`
function colorAt(pct: number) {
  const p = Math.min(100, Math.max(0, pct))
  for (let i = 1; i < STOPS.length; i++) {
    const [p1, c1] = STOPS[i]!
    const [p0, c0] = STOPS[i - 1]!
    if (p <= p1) {
      const t = (p - p0) / (p1 - p0)
      return hex(c0.map((v, k) => v + (c1[k]! - v) * t))
    }
  }
  return hex(STOPS[STOPS.length - 1]![1])
}
const zone = (pct: number) => ({ from: colorAt(pct), to: colorAt(pct + 15) })

// ── formatting ───────────────────────────────────────────────────────────
const fmt = (n: number) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
    : n >= 1000
      ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k`
      : `${Math.round(n)}`

const limitName = (kind: string) =>
  kind === 'five_hour' ? '5-hour' : kind === 'seven_day' ? 'Weekly' : kind === 'spend_limit' ? 'Spend' : kind.replace(/_/g, ' ')

function resetsAt(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const h = d.getHours()
  return `${h % 12 === 0 ? 12 : h % 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

function resetsIn(iso: string | null, now: number) {
  if (!iso) return ''
  const ms = Date.parse(iso) - now
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const m = Math.round(ms / 60000)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return h < 48 ? `${h}h${m % 60 ? ` ${m % 60}m` : ''}` : `${Math.round(h / 24)}d`
}

function toSnap(context: SessionContextUsage, limits: SessionRateLimit[]): PulseSnap {
  return {
    tokens: context.tokens ?? null,
    window: context.window,
    percent: context.percent ?? null,
    limits: limits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt ?? null })),
  }
}

/** Average growth per turn over the recent rising stretch, and turns until full. */
function forecast(hist: number[], tokens: number | null, window: number) {
  if (tokens === null || hist.length < 2) return null
  const deltas: number[] = []
  for (let i = hist.length - 1; i > 0 && deltas.length < 6; i--) {
    const d = hist[i]! - hist[i - 1]!
    if (d < 0) break // a compaction: older history does not predict this window
    deltas.push(d)
  }
  if (deltas.length === 0) return null
  const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length
  if (avg <= 0) return null
  return { avg, left: Math.max(0, Math.floor((window - tokens) / avg)) }
}

// ── drawing ──────────────────────────────────────────────────────────────
/** A thin ring with the percentage in its middle; ripples while Claude works. */
function donutSvg(pct: number, size: number, isWorking: boolean, label: string) {
  const z = zone(pct)
  const stroke = size >= 30 ? 3.5 : 3
  const r = size / 2 - stroke / 2 - 1.5
  const c = 2 * Math.PI * r
  const dash = (Math.min(100, Math.max(0, pct)) / 100) * c
  const mid = size / 2
  const fontSize = size >= 30 ? Math.round(size * 0.3) : 0
  const ripple = isWorking
    ? `<circle cx="${mid}" cy="${mid}" r="${r}" fill="none" stroke="${z.from}" stroke-width="1.5">
         <animate attributeName="r" values="${r};${mid - 0.5};${r}" dur="1.8s" repeatCount="indefinite"/>
         <animate attributeName="opacity" values="0.6;0;0.6" dur="1.8s" repeatCount="indefinite"/>
       </circle>`
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <title>${label}</title>
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${z.from}"/><stop offset="1" stop-color="${z.to}"/>
  </linearGradient></defs>
  ${ripple}
  <circle cx="${mid}" cy="${mid}" r="${r}" fill="none" stroke="${TRACK}" stroke-width="${stroke}"/>
  <circle cx="${mid}" cy="${mid}" r="${r}" fill="none" stroke="url(#g)" stroke-width="${stroke}"
    stroke-linecap="round" stroke-dasharray="${dash.toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 ${mid} ${mid})">
    <animate attributeName="stroke-dasharray" from="0 ${c.toFixed(2)}" to="${dash.toFixed(2)} ${c.toFixed(2)}" dur="0.8s" fill="freeze" calcMode="spline" keySplines="0.2 0.8 0.2 1" keyTimes="0;1"/>
  </circle>
  ${fontSize ? `<text x="${mid}" y="${mid}" text-anchor="middle" dominant-baseline="central" font-family="ui-sans-serif,system-ui,Segoe UI,sans-serif" font-weight="600" font-size="${fontSize}" fill="${z.from}">${Math.round(pct)}</text>` : ''}
</svg>`
}

const PIE = ['○', '◔', '◑', '◕', '●']
const pieGlyph = (pct: number) => PIE[Math.min(4, Math.round((pct / 100) * 4))]!

/** One thing the banner measures: a name, a fill, and one quiet line of detail. */
type Metric = { key: string; name: string; short: string; pct: number; detail: string; tip: string; isLive: boolean }

// ── the mod ──────────────────────────────────────────────────────────────
export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'pulse',
      description: 'Pulse banner: /pulse (cycle full → mini → off), /pulse full|mini|off',
      argumentHint: 'full | mini | off',
    })
    const saved = await $.store.get(MODE_KEY)
    if (saved === 'full' || saved === 'mini' || saved === 'off') await update($, mode, () => saved as PulseMode)
    const u = await $.session.usage()
    await update($, snap, () => toSnap(u.context, u.rateLimits))
    return next(e)
  })

  on('command.run', { command: 'pulse' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const order: PulseMode[] = ['full', 'mini', 'off']
    const current = await read($, mode)
    const nextMode: PulseMode = order.includes(arg as PulseMode)
      ? (arg as PulseMode)
      : order[(order.indexOf(current) + 1) % order.length]!
    await update($, mode, () => nextMode)
    await $.store.set(MODE_KEY, nextMode)
    return { text: `Pulse is now ${nextMode}.` }
  })

  // Pushed by the engine after each main-thread turn and on rate-limit moves.
  on('session.measure', async ($, e, next) => {
    const s = toSnap(e.context, e.rateLimits)
    await update($, snap, () => s)

    if (e.changed.includes('context') && s.tokens !== null) {
      await update($, history, h => [...h, s.tokens!].slice(-HISTORY_LEN))
    }

    if (s.percent !== null) {
      const pct = s.percent
      const last = await read($, alerted)
      const crossed = THRESHOLDS.filter(t => pct >= t && t > last).pop()
      if (crossed !== undefined) {
        await update($, alerted, () => crossed)
        $.ui.toast(
          crossed >= 95
            ? `Context ${pct}% full — compaction is imminent`
            : crossed >= 85
              ? `Context ${pct}% full — consider /compact soon`
              : `Context ${pct}% full`,
          { timeoutMs: 6000 },
        )
      } else if (pct < last - 10) {
        await update($, alerted, () => THRESHOLDS.filter(t => pct >= t).pop() ?? 0)
      }
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const m = await read($, mode)
    if (e.props.hasSurvey || m === 'off') return next(e)

    const s = await read($, snap)
    const hist = await read($, history)
    const isWorking = e.props.isWorking
    const now = Date.now()

    const window = s?.window ?? 0
    const tokens = s?.tokens ?? null
    const pct = s?.percent ?? (tokens !== null && window ? Math.round((tokens / window) * 100) : 0)
    const fc = forecast(hist, tokens, window)

    const metrics: Metric[] = [
      {
        key: 'context',
        name: 'Context',
        short: 'ctx',
        pct,
        detail: tokens !== null ? `${fmt(tokens)} of ${fmt(window)}` : 'waiting for first reply',
        tip:
          tokens !== null
            ? `Context ${pct}% — ${fmt(tokens)} of ${fmt(window)} tokens${fc ? `, about ${fc.left} turns left at this pace` : ''}`
            : 'Context: waiting for the first reply',
        isLive: isWorking,
      },
      ...(s?.limits ?? []).map(l => {
        const lp = Math.round(l.percentUsed)
        const r = resetsIn(l.resetsAt, now)
        const at = r ? resetsAt(l.resetsAt) : ''
        return {
          key: `limit-${l.kind}`,
          name: limitName(l.kind),
          short: l.kind === 'five_hour' ? '5h' : l.kind === 'seven_day' ? 'wk' : limitName(l.kind),
          pct: lp,
          detail: r ? `resets in ${r}` : 'used',
          tip: `${limitName(l.kind)} limit ${lp}% used${r ? `, resets in ${r} (${at})` : ''}`,
          isLive: false,
        }
      }),
    ]

    const setMode = (to: PulseMode) => async () => {
      await update($, mode, () => to)
      await $.store.set(MODE_KEY, to)
    }
    const compact = async () => {
      $.ui.toast('Compacting…')
      await $.session.compact()
    }
    const needsCompact = pct >= 75

    // ── terminal ─────────────────────────────────────────────────────────
    if (e.surface === 'terminal' || e.surface === 'vscode') {
      const { Box, Text, Button } = $.ui.resolve(e)
      return (
        <Box flexDirection="row" flexWrap="nowrap" overflow="hidden" gap={3}>
          {metrics.map(x => (
            <Text key={x.key} wrap="truncate">
              <Text color={zone(x.pct).from} bold>
                {x.isLive ? '◉' : pieGlyph(x.pct)} {m === 'mini' ? x.short : x.name} {x.pct}%
              </Text>
              {m === 'full' && <Text dimColor>{`  ${x.detail}`}</Text>}
            </Text>
          ))}
          <Box flexGrow={1} />
          {needsCompact && <Button key="compact" label="compact" variant="primary" onPress={compact} />}
          <Button key="mode" plain label={m === 'full' ? '–' : '+'} onPress={setMode(m === 'full' ? 'mini' : 'full')} />
        </Box>
      )
    }

    // ── desktop / mobile ─────────────────────────────────────────────────
    const { Box, Text, Button, Svg } = $.ui.resolve(e)
    const room = e.props.bodyColumns
    const shown = metrics.slice(0, room >= 90 ? metrics.length : room >= 60 ? 2 : 1)

    if (m === 'mini') {
      return (
        <Box key="pulse" flexDirection="row" alignItems="center" gap={3} paddingX={1}>
          {shown.map(x => (
            <Box key={x.key} flexDirection="row" alignItems="center" gap={1}>
              <Svg source={donutSvg(x.pct, 16, x.isLive, x.tip)} alt={x.tip} width={16} height={16} isInteractive />
              <Text color={zone(x.pct).from} bold>
                {x.name} {x.pct}%
              </Text>
            </Box>
          ))}
          <Box flexGrow={1} />
          {needsCompact && <Button key="compact" label="Compact" variant="primary" onPress={compact} />}
          <Button key="mode" plain label="+" onPress={setMode('full')} />
        </Box>
      )
    }

    return (
      <Box key="pulse" flexDirection="row" alignItems="center" gap={4} paddingX={1}>
        {shown.map(x => (
          <Box key={x.key} flexDirection="row" alignItems="center" gap={1}>
            <Svg source={donutSvg(x.pct, 34, x.isLive, x.tip)} alt={x.tip} width={34} height={34} isInteractive />
            <Box flexDirection="column">
              <Text color={zone(x.pct).from} bold>
                {x.name}
              </Text>
              <Text dimColor>{x.detail}</Text>
            </Box>
          </Box>
        ))}
        <Box flexGrow={1} />
        {needsCompact && <Button key="compact" label="Compact" variant="primary" onPress={compact} />}
        <Button key="mode" plain label="–" onPress={setMode('mini')} />
      </Box>
    )
  })
}
