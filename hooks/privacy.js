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
export const isShareableLine = (s) => typeof s === 'string' && s.length <= MAX_SHARED_LINE && !CONTROL.test(s) && !PATH_LIKE.test(s)

// The finding as the model may see it. localDetails findings name files: send only a count.
export function shareableFinding(f, t = makeT('en')) {
  const details = Array.isArray(f.details) ? f.details : []
  const local = f.localDetails === true
  return {
    title: isShareableLine(f.title) ? f.title : t('withheld'),
    evidence: local ? t('localEvidence', { n: details.length }) : isShareableLine(f.evidence) ? f.evidence : t('withheld'),
    action: f.action,
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
