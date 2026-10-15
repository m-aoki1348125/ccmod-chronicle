// What may leave the machine, in one place. Pure functions, no mods API.
// Contract: model payloads carry counts, model names, dates and project folder basenames —
// never prompt text, paths or file names. Builders only emit counts and fixed wording; this
// filter is a backstop that withholds anything that looks like a path, URL or control text.

import { makeT } from './i18n.js'

const MAX_SHARED_LINE = 160
// A shareable line has no path-like token, no control characters and a bounded length.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/
// Path-like: a token with two or more "/", one starting with ~/ ./ ../ or /x/, a slash token
// ending in a file extension (src/a.py, /x.txt), a URL scheme, a fullwidth slash or any backslash.
const PATH_LIKE = /(^|\s)(~|\.{1,2})?\/[^\s/]+\/|[^\s/]+\/[^\s/]+\/|(^|\s)(~|\.{1,2})\/|\S*\/[^\s/]+\.[A-Za-z0-9]{1,6}(?=\s|$)|:\/\/|\uff0f|\\/
const isSafeText = (s) => typeof s === 'string' && !CONTROL.test(s) && !PATH_LIKE.test(s)
export const isShareableLine = (s) => isSafeText(s) && s.length <= MAX_SHARED_LINE

// The finding as the model may see it. localDetails findings name files: send only a count.
export function shareableFinding(f, t = makeT('en')) {
  const details = Array.isArray(f.details) ? f.details : []
  const local = f.localDetails === true
  // A finding that names local things (a command, the user's own agents) supplies its own wording
  // for the model: sharedTitle and sharedAction.
  const title = f.sharedTitle ?? f.title
  const action = f.sharedAction ?? f.action
  return {
    title: isShareableLine(title) ? title : t('withheld'),
    evidence: local ? t('localEvidence', { n: details.length }) : isShareableLine(f.evidence) ? f.evidence : t('withheld'),
    // Actions are fixed wording and may run long; they get the same path and control check.
    action: isSafeText(action) ? action : t('withheld'),
    severity: f.severity,
    topic: typeof f.doc === 'string' ? f.doc.split('/').filter(Boolean).pop() : null,
    details: local ? [] : details.filter(isShareableLine),
  }
}

// Every finding offers a prompt to copy; rule-specific prompts win.
export function copyText(f, t = makeT('en')) {
  return f.prompt || t('copyFallback', { title: f.title, evidence: f.evidence, doc: f.doc || t('none') })
}

// Model output is shown as Markdown; drop links of any scheme and reference-style links.
export function stripLinks(text) {
  return String(text)
    .replace(/^\s*\[[^\]]+\]:\s*\S+.*$/gm, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/!?\[([^\]]*)\]\[[^\]]*\]/g, '$1')
    .replace(/<?\b(?:[a-z][a-z0-9+.-]*:\/\/|mailto:|javascript:|data:|file:)[^\s>)]*>?/gi, '[link removed]')
}
