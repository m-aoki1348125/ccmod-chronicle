// A small digest shaped like indexer/chronicle_index.py output.
export const NOW_ISO = '2026-10-03T10:00:00.000Z'

export const DIGEST = {
  schema: 2,
  generatedAt: '2026-10-03T19:00:00+09:00',
  stats: { scanned: 2, reused: 0, sessions: 2 },
  history: {
    prompts: 1200,
    slash: { '/model': 139, '/effort': 2, '/btw': 2 },
    resumePrompts: 47,
    correctionPrompts: 29,
    memoryCuePrompts: 5,
    imagePrompts: 15,
    byDay: {},
  },
  sessions: [
    {
      id: 's1', project: '/work/demo-app', start: '2026-10-03T01:00:00Z', end: '2026-10-03T09:00:00Z',
      title: 'Ship the settings page', firstPrompt: 'secret first prompt text', away: ['Edited /home/alice/clients/acme/src/auth.py', 'Release candidate tagged'],
      models: { 'claude-opus-5-5': 10 },
      usageByModel: { 'claude-opus-5-5': { in: 10, out: 1000, cacheRead: 500000, cacheWrite: 10 } },
      tools: { Bash: 40, Edit: 30, Agent: 1, mcp__notes__query: 2 }, risky: { 'terraform apply': 3 },
      agents: { 'code-reviewer': 1 }, skills: {}, mcp: { notes: 2 }, editExts: { '.py': 30 },
      editedFiles: ['/work/demo-app/agent.py'],
      compactions: [{ trigger: 'auto', preTokens: 990000, at: '2026-10-03T05:00:00Z' }],
      turns: { count: 3, sumMs: 4000000, maxMs: 3600000, p50Ms: 200000 },
      apiErrors: { rateLimit: 2, credits: 1 }, toolErrors: 120, denials: 2,
      permModes: { auto: 50 }, subUsage: {}, subTools: {},
    },
    {
      id: 's0', project: '/work/old', start: '2026-09-01T01:00:00Z', end: '2026-09-01T02:00:00Z',
      title: null, firstPrompt: 'old prompt', away: [], models: {}, usageByModel: {}, tools: {}, risky: {},
      agents: {}, skills: {}, mcp: {}, editExts: {}, editedFiles: [], compactions: [],
      turns: { count: 0, sumMs: 0, maxMs: 0, p50Ms: 0 }, apiErrors: {}, toolErrors: 0, denials: 0,
      permModes: {}, subUsage: {}, subTools: {},
    },
  ],
}
