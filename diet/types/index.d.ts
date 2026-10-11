export type Trim = {
  id: string
  tool: string
  before: number
  after: number
  path: string | null
  at: number
}

declare module 'claude-code' {
  interface PluginState {
    diet: {
      trims: Trim[]
      isOn: boolean
      limit: number
      savedChars: number
    }
  }
}
