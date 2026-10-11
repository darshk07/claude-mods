export type Pin = { id: string; text: string; at: number }

declare module 'claude-code' {
  interface PluginState {
    anchor: {
      pins: Pin[]
      epoch: number
      isOn: boolean
    }
  }
}
