// Token burn pace: the tokens one main-loop turn spent (its subagents' included) per minute of
// the turn's wall time. Cache reads are billed at a tenth of fresh input, so they count a tenth
// here too. Pure functions, no mods API.

export const BURN = Object.freeze({
  // Tokens per minute that count as heavy; about the 90th percentile of past sessions.
  defaultPerMin: 100_000,
  // At this many times the threshold the pace is "very high".
  blazeFactor: 2,
  // Short or small turns swing the pace on one cache write; they are measured but never flagged.
  minTurnTokens: 20_000,
  minTurnMs: 5_000,
  cacheReadWeight: 0.1,
  maxPerMin: 10_000_000,
})

export const BURN_EFFECTS = ['rainbow', 'still', 'plain']
export const EMPTY_BURN = Object.freeze({ turn: null, last: null, hidden: false })

const MINUTE_MS = 60_000
const count = (n) => (Number.isFinite(n) && n > 0 ? n : 0)

export function weightedTokens(usage) {
  if (!usage) return 0
  return Math.round(count(usage.input_tokens) + count(usage.output_tokens) + count(usage.cache_creation_input_tokens) + BURN.cacheReadWeight * count(usage.cache_read_input_tokens))
}

// null below the threshold (or with the alert off), else 'hot' or 'blaze'.
export function burnLevel(perMin, threshold) {
  if (!(threshold > 0) || !(perMin >= threshold)) return null
  return perMin >= threshold * BURN.blazeFactor ? 'blaze' : 'hot'
}

// A main-loop turn began: tokens from now on count toward it.
export function startTurn(burn, turnId, at) {
  return { ...burn, turn: { id: turnId, startedAt: at, tokens: 0 } }
}

// Any turn ended, the main loop's or a subagent's, at `now`. A subagent run that began inside the
// open main turn adds its tokens to it; one that began earlier would swell a short turn, so it is
// left out. When the main turn itself ends, its pace becomes `last`; a new heavy turn shows the
// alert again.
export function endTurn(burn, e, threshold, now) {
  const open = burn.turn
  if (!open) return burn
  if (e.agentId !== undefined || e.turnId !== open.id) {
    if (count(e.durationMs) > now - open.startedAt) return burn
    return { ...burn, turn: { ...open, tokens: open.tokens + weightedTokens(e.usage) } }
  }
  const tokens = open.tokens + weightedTokens(e.usage)
  const ms = count(e.durationMs)
  const isMeasurable = tokens >= BURN.minTurnTokens && ms >= BURN.minTurnMs
  const perMin = ms ? Math.round(tokens / (ms / MINUTE_MS)) : 0
  const level = isMeasurable ? burnLevel(perMin, threshold) : null
  return { turn: null, last: { tokens, ms, perMin, level, threshold }, hidden: level ? false : burn.hidden }
}

// A saved `last` (from $.state, after a reload) judged again by the threshold in effect now.
export function restoreLast(saved, threshold) {
  const n = (k) => (Number.isFinite(saved?.[k]) && saved[k] >= 0 ? saved[k] : null)
  const [tokens, ms, perMin] = [n('tokens'), n('ms'), n('perMin')]
  if (tokens === null || ms === null || perMin === null) return null
  const isMeasurable = tokens >= BURN.minTurnTokens && ms >= BURN.minTurnMs
  return { tokens, ms, perMin, level: isMeasurable ? burnLevel(perMin, threshold) : null, threshold }
}

export const isBurning = (burn) => Boolean(burn?.last?.level)
