import type { Elements } from 'claude-code'

import type { JargonEntry } from '../types'

type Kit = Pick<Elements['terminal'], 'Box' | 'Text'>

export const CARD_MAX_WIDTH = 64

/**
 * A margin note: one accent bar down the left, the term in the accent and
 * bold, its kind dim beside it, the definition at full strength, and the
 * reply's own use of it dim beneath. No frame, no heading.
 */
export function card(
  { Box, Text }: Kit,
  entry: JargonEntry,
  note: string | undefined,
  width: number,
) {
  return (
    <Box
      flexDirection="column"
      width={width}
      borderStyle="quote"
      borderColor="claude"
      paddingLeft={1}
    >
      <Text wrap="wrap">
        <Text bold color="claude">
          {entry.term}
        </Text>
        {entry.kind ? (
          <Text dimColor italic>
            {'  '}
            {entry.kind}
          </Text>
        ) : null}
      </Text>
      <Text wrap="wrap">{entry.definition}</Text>
      {note ? (
        <Text dimColor wrap="wrap">
          Here: {note}
        </Text>
      ) : null}
    </Box>
  )
}

export function cardWidth(columns: number | undefined): number {
  return Math.max(24, Math.min(CARD_MAX_WIDTH, (columns ?? 80) - 4))
}

const WIDE =
  /[\p{Extended_Pictographic}\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}]/u

/** Cells a label takes: wide (CJK, emoji) characters count two. */
export function cellWidth(text: string): number {
  let n = 0
  for (const ch of text) n += WIDE.test(ch) ? 2 : 1

  return n
}

/**
 * Where each chip starts in a row laid out as `flexWrap="wrap"` with
 * `columnGap`: the lead label first, then the chips, a chip that does not fit
 * starting the next line at 0.
 */
export function chipOffsets(
  labels: string[],
  rowWidth: number,
  leadWidth: number,
  gap: number,
): number[] {
  let cursor = leadWidth

  return labels.map(label => {
    const w = cellWidth(label)
    const x = cursor === 0 || cursor + gap + w > rowWidth ? 0 : cursor + gap
    cursor = x + w

    return x
  })
}

/**
 * The card's `left` against its chip at `x`: 0 while it fits to the right,
 * else shifted left so its right edge meets the row's, never past the row's
 * left edge.
 */
export function cardLeft(x: number, width: number, rowWidth: number): number {
  if (x + width <= rowWidth) return 0

  return Math.max(-x, rowWidth - x - width)
}
