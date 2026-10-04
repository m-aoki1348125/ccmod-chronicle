// What may leave the machine, in one place. Pure functions, no mods API.
// Contract: model payloads carry counts, model names, dates and project folder basenames —
// never prompt text, paths or file names. Builders only emit counts and fixed wording; this
// filter is a backstop that withholds anything that looks like a path, URL or control text.

const MAX_SHARED_LINE = 160
// A shareable line has no path-like token, no control characters and a bounded length.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/
// Path-like: a token with two or more "/", one starting with ~/ ./ ../ or /x/, a slash token
// ending in a file extension (src/a.py, /x.txt), a URL scheme, a fullwidth slash or any backslash.
const PATH_LIKE = /(^|\s)(~|\.{1,2})?\/[^\s/]+\/|[^\s/]+\/[^\s/]+\/|(^|\s)(~|\.{1,2})\/|\S*\/[^\s/]+\.[A-Za-z0-9]{1,6}(?=\s|$)|:\/\/|\uff0f|\\/
export const isShareableLine = (s) => typeof s === 'string' && s.length <= MAX_SHARED_LINE && !CONTROL.test(s) && !PATH_LIKE.test(s)

const WITHHELD = '（非送信）'

// The finding as the model may see it. localDetails findings name files: send only a count.
export function shareableFinding(f) {
  const details = Array.isArray(f.details) ? f.details : []
  const local = f.localDetails === true
  return {
    title: isShareableLine(f.title) ? f.title : WITHHELD,
    evidence: local ? `対象 ${details.length} 件（名前は非送信）` : isShareableLine(f.evidence) ? f.evidence : WITHHELD,
    action: f.action,
    severity: f.severity,
    topic: typeof f.doc === 'string' ? f.doc.split('/').filter(Boolean).pop() : null,
    details: local ? [] : details.filter(isShareableLine),
  }
}

// Every finding offers a prompt to copy; rule-specific prompts win.
export function copyText(f) {
  return f.prompt || `session-chronicle の指摘「${f.title}」（根拠: ${f.evidence}）について、私の使い方に合わせた具体的な改善手順を提案して。参考: ${f.doc || 'なし'}`
}

// Model output is shown as Markdown; drop links of any scheme and reference-style links.
export function stripLinks(text) {
  return String(text)
    .replace(/^\s*\[[^\]]+\]:\s*\S+.*$/gm, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/!?\[([^\]]*)\]\[[^\]]*\]/g, '$1')
    .replace(/<?\b(?:[a-z][a-z0-9+.-]*:\/\/|mailto:|javascript:|data:|file:)[^\s>)]*>?/gi, '[link removed]')
}
