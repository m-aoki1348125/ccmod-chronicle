import { expect, test } from 'claude-code/testing'
import { SETTINGS_SPEC, SETTING_KEYS, currentValues, parseSetting } from '../hooks/settings-spec.js'
import { FIELDS, settingsField } from '../hooks/ai-config.js'

test('every setting is a known /config field', async () => {
  for (const key of SETTING_KEYS) expect(settingsField('ccmod-chronicle.' + key, 'ccmod-chronicle')).toBe(key)
  expect(SETTING_KEYS.length).toBe(11)
})

test('defaults fill in what the options leave unset', async () => {
  const v = currentValues({ aiModel: 'opus' })
  expect(v.aiModel).toBe('opus')
  expect(v.language).toBe('auto')
  expect(v.retentionDays).toBe(0)
  expect(v.reviewerAgents).toBe('')
})

test('parseSetting accepts what /config can store and rejects the rest', async () => {
  expect(parseSetting('aiModel', 'sonnet')).toEqual({ value: 'sonnet' })
  expect(parseSetting('aiModel', 'gpt').error).toBe('settingInvalid')
  expect(parseSetting('autoExplain', 'off')).toEqual({ value: false })
  expect(parseSetting('retentionDays', ' 30 ')).toEqual({ value: 30 })
  expect(parseSetting('retentionDays', '-1').error).toBe('settingRange')
  expect(parseSetting('excludeProjects', '/a,\n /b ,')).toEqual({ value: '/a,/b' })
  expect(parseSetting('nope', 'x').error).toBe('settingUnknown')
  expect(SETTINGS_SPEC.every((s) => s.default !== undefined)).toBe(true)
})

test('the /config field list and the Settings spec are the same set', async () => {
  expect([...FIELDS].sort()).toEqual([...SETTING_KEYS].sort())
})

test('hand-edited values are shown as what actually applies', async () => {
  // A model that is not offered shows the default; a fraction shows rounded down, as it applies.
  const v = currentValues({ aiModel: 'gpt-x', retentionDays: 1.5 })
  expect([v.aiModel, v.retentionDays]).toEqual(['haiku', 1])
})

test('Windows line endings separate list entries', async () => {
  expect(parseSetting('excludeProjects', 'C:\\a\r\nD:\\b')).toEqual({ value: 'C:\\a,D:\\b' })
})

test('full-width digits are accepted for numbers', async () => {
  expect(parseSetting('retentionDays', '３０')).toEqual({ value: 30 })
})
