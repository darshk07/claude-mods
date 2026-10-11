export type PulseSnap = {
  tokens: number | null
  window: number
  percent: number | null
  limits: { kind: string; percentUsed: number; resetsAt: string | null }[]
}

export type PulseMode = 'full' | 'mini' | 'off'

declare module 'claude-code' {
  interface PluginState {
    pulse: {
      snap: PulseSnap | null
      history: number[]
      mode: PulseMode
      alerted: number
    }
  }
}
