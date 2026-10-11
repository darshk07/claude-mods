import { atom, read, update } from 'claude-code'
import type { Register, SessionContextUsage, SessionRateLimit } from 'claude-code'

import type { PulseMode, PulseSnap, PulseTotals } from '../types'

// ── state ────────────────────────────────────────────────────────────────
const snap = atom({ plugin: 'pulse', key: 'snap' } as const, null)
const totals = atom({ plugin: 'pulse', key: 'totals' } as const, {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  turns: 0,
})
const history = atom({ plugin: 'pulse', key: 'history' } as const, [])
const mode = atom({ plugin: 'pulse', key: 'mode' } as const, 'full')
const alerted = atom({ plugin: 'pulse', key: 'alerted' } as const, 0)

const THRESHOLDS = [70, 85, 95]
const HISTORY_LEN = 32
const MODE_KEY = 'mode'

// ── palette ──────────────────────────────────────────────────────────────
const C = {
  cool: '#34d399',
  coolEnd: '#22d3ee',
  warm: '#fbbf24',
  warmEnd: '#fb923c',
  hot: '#f43f5e',
  hotEnd: '#e879f9',
  accent: '#a78bfa',
  track: 'rgba(148,163,184,0.22)',
  input: '#60a5fa',
  cacheRead: '#34d399',
  cacheWrite: '#a78bfa',
  output: '#f472b6',
}

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
const zone = (pct: number) => ({ from: colorAt(pct), to: colorAt(pct + 18), name: pct >= 85 ? 'hot' : pct >= 60 ? 'warm' : 'cool' })

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

// ── svg pieces (desktop / mobile) ────────────────────────────────────────
function donutSvg(pct: number, size: number, isWorking: boolean, label: string) {
  const z = zone(pct)
  const stroke = size >= 40 ? 6 : 4
  const r = size / 2 - stroke / 2 - 2
  const c = 2 * Math.PI * r
  const dash = (Math.min(100, Math.max(0, pct)) / 100) * c
  const mid = size / 2
  const fontSize = size >= 40 ? 13 : 0
  const pulse = isWorking
    ? `<circle cx="${mid}" cy="${mid}" r="${r}" fill="none" stroke="${z.from}" stroke-width="${stroke}" opacity="0.5">
         <animate attributeName="r" values="${r};${r + 3};${r}" dur="1.6s" repeatCount="indefinite"/>
         <animate attributeName="opacity" values="0.45;0;0.45" dur="1.6s" repeatCount="indefinite"/>
       </circle>`
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <title>${label}</title>
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${z.from}"/><stop offset="1" stop-color="${z.to}"/>
    </linearGradient>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="1.6" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  ${pulse}
  <circle cx="${mid}" cy="${mid}" r="${r}" fill="none" stroke="${C.track}" stroke-width="${stroke}"/>
  <circle cx="${mid}" cy="${mid}" r="${r}" fill="none" stroke="url(#g)" stroke-width="${stroke}"
    stroke-linecap="round" stroke-dasharray="${dash.toFixed(2)} ${c.toFixed(2)}"
    transform="rotate(-90 ${mid} ${mid})" filter="url(#glow)">
    <animate attributeName="stroke-dasharray" from="0 ${c.toFixed(2)}" to="${dash.toFixed(2)} ${c.toFixed(2)}" dur="0.9s" fill="freeze" calcMode="spline" keySplines="0.2 0.8 0.2 1" keyTimes="0;1"/>
  </circle>
  ${fontSize ? `<text x="${mid}" y="${mid}" text-anchor="middle" dominant-baseline="central" font-family="ui-sans-serif,system-ui,Segoe UI,sans-serif" font-weight="700" font-size="${fontSize}" fill="${z.from}">${Math.round(pct)}%</text>` : ''}
</svg>`
}

function mixSvg(t: PulseTotals, width: number) {
  const parts = [
    { v: t.cacheRead, c: C.cacheRead, n: 'cache read' },
    { v: t.cacheWrite, c: C.cacheWrite, n: 'cache write' },
    { v: t.input, c: C.input, n: 'fresh input' },
    { v: t.output, c: C.output, n: 'output' },
  ]
  const sum = parts.reduce((a, p) => a + p.v, 0) || 1
  const h = 8
  let x = 0
  const rects = parts
    .filter(p => p.v > 0)
    .map(p => {
      const w = Math.max(2, (p.v / sum) * width)
      const r = `<rect x="${x.toFixed(1)}" y="0" width="${w.toFixed(1)}" height="${h}" fill="${p.c}"><title>${p.n}: ${fmt(p.v)}</title></rect>`
      x += w
      return r
    })
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}">
  <defs><clipPath id="k"><rect width="${width}" height="${h}" rx="${h / 2}"/></clipPath></defs>
  <rect width="${width}" height="${h}" rx="${h / 2}" fill="${C.track}"/>
  <g clip-path="url(#k)">${rects}</g>
</svg>`
}

function sparkSvg(hist: number[], window: number, width: number, height: number, color: string) {
  const pts = hist.length === 1 ? [hist[0]!, hist[0]!] : hist
  const step = width / Math.max(1, pts.length - 1)
  const y = (v: number) => height - 2 - (Math.min(v, window) / window) * (height - 4)
  const line = pts.map((v, i) => `${(i * step).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const last = pts[pts.length - 1]!
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <title>Context over the last ${hist.length} measurements</title>
  <defs><linearGradient id="a" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${color}" stop-opacity="0.45"/><stop offset="1" stop-color="${color}" stop-opacity="0"/>
  </linearGradient></defs>
  <polygon points="0,${height} ${line} ${width},${height}" fill="url(#a)"/>
  <polyline points="${line}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>
  <circle cx="${width}" cy="${y(last).toFixed(1)}" r="2.6" fill="${color}"/>
</svg>`
}

// ── terminal pieces ──────────────────────────────────────────────────────
const PIE = ['○', '◔', '◑', '◕', '●']
const SPARK = '▁▂▃▄▅▆▇█'
const pieGlyph = (pct: number) => PIE[Math.min(4, Math.round((pct / 100) * 4))]!
const bar = (pct: number, cells: number) => {
  const full = Math.round((Math.min(100, pct) / 100) * cells)
  return ['━'.repeat(full), '─'.repeat(cells - full)] as const
}
const sparkText = (hist: number[], window: number) =>
  hist.map(v => SPARK[Math.min(7, Math.floor((Math.min(v, window) / window) * 8))]).join('')

// ── the mod ──────────────────────────────────────────────────────────────
export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'pulse',
      description: 'Pulse banner: /pulse (cycle full → mini → off), /pulse full|mini|off|reset',
      argumentHint: 'full | mini | off | reset',
    })
    const saved = await $.store.get(MODE_KEY)
    if (saved === 'full' || saved === 'mini' || saved === 'off') await update($, mode, () => saved as PulseMode)
    const u = await $.session.usage()
    await update($, snap, () => toSnap(u.context, u.rateLimits))
    return next(e)
  })

  on('command.run', { command: 'pulse' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'reset') {
      await update($, totals, () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0 }))
      await update($, history, () => [])
      await update($, alerted, () => 0)
      return { text: 'Pulse counters reset.' }
    }
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
            ? `◉ Pulse: context ${pct}% full — compaction is imminent`
            : crossed >= 85
              ? `◕ Pulse: context ${pct}% full — consider /compact soon`
              : `◑ Pulse: context ${pct}% full`,
          { timeoutMs: 6000 },
        )
      } else if (pct < last - 10) {
        await update($, alerted, () => THRESHOLDS.filter(t => pct >= t).pop() ?? 0)
      }
    }
    return next(e)
  })

  // Token totals: every turn, subagents included; turns count the main loop only.
  on('turn.complete', async ($, e, next) => {
    const u = e.usage
    if (u) {
      await update($, totals, t => ({
        input: t.input + u.input_tokens,
        output: t.output + u.output_tokens,
        cacheRead: t.cacheRead + u.cache_read_input_tokens,
        cacheWrite: t.cacheWrite + u.cache_creation_input_tokens,
        turns: t.turns + (e.agentId ? 0 : 1),
      }))
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const m = await read($, mode)
    if (e.props.hasSurvey || m === 'off') return next(e)

    const s = await read($, snap)
    const t = await read($, totals)
    const hist = await read($, history)
    const isWorking = e.props.isWorking
    const cols = e.props.bodyColumns
    const now = Date.now()

    const window = s?.window ?? 0
    const tokens = s?.tokens ?? null
    const pct = s?.percent ?? (tokens !== null && window ? Math.round((tokens / window) * 100) : 0)
    const z = zone(pct)
    const fc = forecast(hist, tokens, window)
    const lastDelta = hist.length >= 2 ? hist[hist.length - 1]! - hist[hist.length - 2]! : null
    const inputAll = t.input + t.cacheRead + t.cacheWrite
    const hit = inputAll > 0 ? Math.round((t.cacheRead / inputAll) * 100) : null
    const limits = s?.limits ?? []
    const hasData = tokens !== null

    const toggle = (to: PulseMode) => async () => {
      await update($, mode, () => to)
      await $.store.set(MODE_KEY, to)
    }
    const compact = async () => {
      $.ui.toast('Pulse: compacting…')
      await $.session.compact()
    }

    // ── terminal ─────────────────────────────────────────────────────────
    if (e.surface === 'terminal' || e.surface === 'vscode') {
      const { Box, Text, Button } = $.ui.resolve(e)
      const [on1, off1] = bar(pct, m === 'mini' ? 8 : cols >= 110 ? 18 : 10)
      const sep = <Text color="subtle"> │ </Text>
      return (
        <Box flexDirection="row" flexWrap="nowrap" overflow="hidden">
          <Text color={z.from} bold>
            {isWorking ? '◉' : pieGlyph(pct)} PULSE{' '}
          </Text>
          {!hasData ? (
            <Text dimColor>warming up · window {window ? fmt(window) : '—'}</Text>
          ) : (
            <Text>
              <Text color={z.from} bold>
                {pct}%{' '}
              </Text>
              <Text color={z.from}>{on1}</Text>
              <Text color="subtle">{off1}</Text>
              <Text> {fmt(tokens!)}</Text>
              <Text dimColor>/{fmt(window)}</Text>
            </Text>
          )}
          {m === 'full' && hasData && lastDelta !== null && lastDelta > 0 && (
            <Text>
              {sep}
              <Text color={C.accent}>+{fmt(lastDelta)}</Text>
              {fc && <Text dimColor> ≈{fc.left} turns left</Text>}
            </Text>
          )}
          {m === 'full' && cols >= 90 && t.turns > 0 && (
            <Text>
              {sep}
              <Text color={C.input}>in {fmt(t.input)}</Text>
              <Text color={C.cacheRead}> ⚡{hit}%</Text>
              <Text color={C.output}> out {fmt(t.output)}</Text>
            </Text>
          )}
          {m === 'full' && cols >= 120 && hist.length >= 2 && (
            <Text>
              {sep}
              <Text color={z.from}>{sparkText(hist.slice(-12), window)}</Text>
            </Text>
          )}
          {limits.length > 0 && (
            <Text>
              {sep}
              {limits.map(l => {
                const r = resetsIn(l.resetsAt, now)
                return (
                  <Text>
                    <Text color={zone(l.percentUsed).from} bold>
                      {pieGlyph(l.percentUsed)} {limitName(l.kind)} {Math.round(l.percentUsed)}%
                    </Text>
                    {r && <Text dimColor> ↻{r}</Text>}
                    <Text> </Text>
                  </Text>
                )
              })}
            </Text>
          )}
          <Text> </Text>
          {pct >= 75 && <Button key="compact" label="compact" variant="primary" onPress={compact} />}
          <Button key="mode" plain label={m === 'full' ? ' ▴' : ' ▾'} onPress={toggle(m === 'full' ? 'mini' : 'full')} />
        </Box>
      )
    }

    // ── desktop / mobile ─────────────────────────────────────────────────
    const { Box, Text, Button, Svg } = $.ui.resolve(e)
    const donutLabel = hasData
      ? `Context ${pct}% — ${fmt(tokens!)} of ${fmt(window)} tokens`
      : 'Context: waiting for the first response'

    if (m === 'mini') {
      return (
        <Box key="pulse" flexDirection="row" alignItems="center" gap={1}>
          <Svg source={donutSvg(pct, 22, isWorking, donutLabel)} alt={donutLabel} width={22} height={22} isInteractive />
          <Text color={z.from} bold>
            {hasData ? `${pct}%` : '—'}
          </Text>
          <Text dimColor>
            {hasData ? `${fmt(tokens!)} / ${fmt(window)}` : 'warming up'}
          </Text>
          {limits.map(l => {
            const lp = Math.round(l.percentUsed)
            const label = `${limitName(l.kind)} usage ${lp}%`
            return (
              <Box key={`limit-${l.kind}`} flexDirection="row" alignItems="center" gap={1}>
                <Svg source={donutSvg(lp, 22, false, label)} alt={label} width={22} height={22} isInteractive />
                <Text color={zone(lp).from} bold>
                  {limitName(l.kind)} {lp}%
                </Text>
                {resetsIn(l.resetsAt, now) && <Text dimColor>↻ {resetsIn(l.resetsAt, now)}</Text>}
              </Box>
            )
          })}
          {pct >= 75 && <Button key="compact" label="Compact" variant="primary" onPress={compact} />}
          <Button key="mode" plain label="▾" onPress={toggle('full')} />
        </Box>
      )
    }

    const showMix = cols >= 70 && t.turns > 0
    const showSpark = cols >= 95 && hist.length >= 2
    const showLimits = cols >= 100 && limits.length > 0

    return (
      <Box
        key="pulse"
        flexDirection="row"
        alignItems="center"
        gap={2}
        paddingX={1}
        borderStyle="round"
        borderColor={z.from}
      >
        <Svg source={donutSvg(pct, 48, isWorking, donutLabel)} alt={donutLabel} width={48} height={48} isInteractive />

        <Box flexDirection="column">
          <Text color={z.from} bold>
            {isWorking ? 'PULSE · live' : 'PULSE'} {hasData ? `${pct}%` : ''}
          </Text>
          <Text color={z.from}>
            {hasData ? fmt(tokens!) : '—'}
            <Text dimColor> / {window ? fmt(window) : '—'} ctx</Text>
          </Text>
          <Text dimColor>
            {!hasData
              ? 'waiting for first response'
              : lastDelta !== null && lastDelta > 0
                ? `+${fmt(lastDelta)} last turn${fc ? ` · ≈${fc.left} turns left` : ''}`
                : lastDelta !== null && lastDelta < 0
                  ? `−${fmt(-lastDelta)} freed`
                  : `${fmt(Math.max(0, window - tokens!))} free`}
          </Text>
        </Box>

        {showMix && (
          <Box flexDirection="column" gap={0}>
            <Text dimColor>session tokens · {t.turns} turns</Text>
            <Svg source={mixSvg(t, 150)} alt="Token mix" width={150} height={8} isInteractive />
            <Text>
              <Text color={C.cacheRead}>⚡{hit ?? 0}% cached</Text>
              <Text dimColor> · </Text>
              <Text color={C.input}>in {fmt(t.input + t.cacheWrite)}</Text>
              <Text dimColor> · </Text>
              <Text color={C.output}>out {fmt(t.output)}</Text>
            </Text>
          </Box>
        )}

        {showSpark && (
          <Box flexDirection="column">
            <Text dimColor>context trend</Text>
            <Svg source={sparkSvg(hist, window, 110, 26, z.from)} alt="Context trend" width={110} height={26} isInteractive />
          </Box>
        )}

        {showLimits &&
          limits.map(l => {
            const lp = Math.round(l.percentUsed)
            const r = resetsIn(l.resetsAt, now)
            const at = r ? resetsAt(l.resetsAt) : ''
            const label = `${limitName(l.kind)} usage ${lp}%${r ? `, resets in ${r}` : ''}`
            return (
              <Box key={`limit-${l.kind}`} flexDirection="row" alignItems="center" gap={1}>
                <Svg source={donutSvg(lp, 48, false, label)} alt={label} width={48} height={48} isInteractive />
                <Box flexDirection="column">
                  <Text color={zone(lp).from} bold>
                    {limitName(l.kind)} {lp}%
                  </Text>
                  <Text color={zone(lp).from}>{r ? `↻ resets in ${r}` : 'used'}</Text>
                  {at && <Text dimColor>at {at}</Text>}
                </Box>
              </Box>
            )
          })}

        <Box flexGrow={1} />
        {pct >= 75 && <Button key="compact" label="Compact" variant="primary" onPress={compact} />}
        <Button key="mode" plain label="▴" onPress={toggle('mini')} />
      </Box>
    )
  })
}
