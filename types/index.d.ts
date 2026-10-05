// $.state values: the host keeps them for the session across module reloads (an options change
// reloads the plugin). The mod rewrites them to defaults itself on /clear, /resume and /branch.
declare module 'claude-code' {
  interface PluginState {
    'session-chronicle': {
      view: {
        tab: string
        detailId: string | null
        days: number
        aiUsage: { calls: number; in: number; out: number }
        // Explanations of live now-* findings (digest ones are cached in $.store).
        nowExplain: Record<string, { text: string; model: string; tokens?: { in: number; out: number } }>
        // Live signals buildNow needs: code files edited since the last review, risky command counts.
        live: { unreviewed: string[]; risky: Record<string, number> }
        sessionDismissed: string[]
      }
    }
  }
}
