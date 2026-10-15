// What the user already has: their agents and skills, from Claude Code's folder and this
// repository's .claude folder. Reads names only; any failure leaves the list empty.

const MAX_ASSETS = 60
// A name, not a hidden folder (.git) or a readme.
const NAME = /^(?!\.)(?!README$)[\w.-]{1,64}$/i

async function names($, dir, kind) {
  try {
    const entries = await $.fs.list(dir)
    return entries
      .filter((e) => (kind === 'agent' ? e.kind !== 'dir' && e.name.endsWith('.md') : e.kind !== 'file'))
      .map((e) => (kind === 'agent' ? e.name.slice(0, -3) : e.name))
      .filter((n) => NAME.test(n))
  } catch {
    return []
  }
}

async function list($, dirs, kind) {
  const found = await Promise.all(dirs.map((d) => names($, d, kind)))
  return [...new Set(found.flat())].slice(0, MAX_ASSETS).map((name) => ({ name }))
}

async function exists($, path) {
  try {
    return Boolean(await $.fs.exists(path))
  } catch {
    return false
  }
}

// The working directory, Claude Code's folder and the user's agents and skills (user + project).
export async function readWorkspace($, claudeDir) {
  let cwd = ''
  try {
    cwd = String((await $.session.cwd()) || '')
  } catch {
    // No working directory: repository-scoped findings stay off.
  }
  const isRepo = Boolean(cwd) && (await exists($, cwd + '/.git'))
  const roots = [claudeDir, cwd && cwd + '/.claude'].filter(Boolean)
  const [agents, skills] = await Promise.all([list($, roots.map((r) => r + '/agents'), 'agent'), list($, roots.map((r) => r + '/skills'), 'skill')])
  return Object.freeze({ cwd, isRepo, claudeDir, agents, skills })
}
