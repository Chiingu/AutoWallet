import { Fragment } from 'react'
import type { ReactNode } from 'react'

// The AI writes a little Markdown (**bold**, "- " lists, "1. " lists). We turn just that into
// React elements. Everything else stays plain text: the answer is never inserted as HTML.

type Block =
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'bullets'; items: string[] }
  | { kind: 'numbers'; start: number; items: string[] }

function toBlocks(text: string): Block[] {
  const blocks: Block[] = []
  let paragraph: string[] = []
  const endParagraph = () => {
    if (paragraph.length > 0) blocks.push({ kind: 'paragraph', lines: paragraph })
    paragraph = []
  }

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim().replace(/^#{1,6}\s+/, '') // a "## title" becomes a normal line
    const bullet = /^[-*•]\s+(.*)$/.exec(line)
    const numbered = /^(\d+)[.)]\s+(.*)$/.exec(line)

    if (bullet) {
      endParagraph()
      const last = blocks.at(-1)
      if (last?.kind === 'bullets') last.items.push(bullet[1])
      else blocks.push({ kind: 'bullets', items: [bullet[1]] })
    } else if (numbered) {
      endParagraph()
      const last = blocks.at(-1)
      if (last?.kind === 'numbers') last.items.push(numbered[2])
      else blocks.push({ kind: 'numbers', start: Number(numbered[1]), items: [numbered[2]] })
    } else if (line) {
      paragraph.push(line)
    } else {
      endParagraph() // an empty line ends a paragraph, but a list goes on after it
    }
  }
  endParagraph()
  return blocks
}

/** "**bold**" → <strong>bold</strong> */
function withBold(text: string): ReactNode[] {
  return text.split(/\*\*(.+?)\*\*/g).map((part, index) => (index % 2 === 1 ? <strong key={index}>{part}</strong> : part))
}

export function FormattedAnswer({ text }: { text: string }) {
  return (
    <div className="assistant-formatted-answer space-y-2">
      {toBlocks(text).map((block, index) => {
        if (block.kind === 'bullets') {
          return (
            <ul key={index} className="list-disc space-y-1 pl-5">
              {block.items.map((item, i) => (
                <li key={i}>{withBold(item)}</li>
              ))}
            </ul>
          )
        }
        if (block.kind === 'numbers') {
          return (
            <ol key={index} start={block.start} className="list-decimal space-y-1 pl-5">
              {block.items.map((item, i) => (
                <li key={i}>{withBold(item)}</li>
              ))}
            </ol>
          )
        }
        return (
          <p key={index}>
            {block.lines.map((line, i) => (
              <Fragment key={i}>
                {i > 0 && <br />}
                {withBold(line)}
              </Fragment>
            ))}
          </p>
        )
      })}
    </div>
  )
}
