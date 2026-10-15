// A surface module (drawn by a Client element): text whose letters cycle through the rainbow,
// with a lighter band sweeping across, as Claude Code highlights `ultrathink` in the prompt.
// Runs on the drawing thread, so it imports nothing.

export const RAINBOW = Object.freeze(['#eb5f57', '#f58b57', '#fac35f', '#91c882', '#82aadc', '#9b82c8', '#c882b4'])
export const RAINBOW_LIGHT = Object.freeze(['#f5918b', '#f9b08b', '#fcd793', '#b7dcab', '#adc9eb', '#bcaadc', '#dcaacd'])
const FRAME_MS = 120
// Letters the light band covers, and the blank frames after it leaves the text.
const BAND = 3
const PAUSE = 8

export function rainbowColor(i, tick, length) {
  const sweep = tick % (length + BAND + PAUSE)
  const isLit = i >= sweep - BAND && i < sweep
  const palette = isLit ? RAINBOW_LIGHT : RAINBOW
  return palette[(((i - tick) % palette.length) + palette.length) % palette.length]
}

export default function Rainbow(props, surface) {
  const { Text } = surface.elements
  if (surface.state === undefined) {
    surface.setState(0)
    let tick = 0
    surface.every(FRAME_MS, () => {
      tick += 1
      surface.setState(tick)
    })
  }
  const chars = Array.from(String(props?.text ?? ''))
  const tick = surface.state ?? 0
  return Text({
    bold: Boolean(props?.bold),
    wrap: 'truncate-end',
    children: chars.map((c, i) => Text({ color: rainbowColor(i, tick, chars.length), children: [c] })),
  })
}
