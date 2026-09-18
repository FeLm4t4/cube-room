import { useEffect, useId, useRef } from 'react'
import { moveToNotation, type Move } from '../cube/model'
import { Icon } from './Icon'
import './SolutionTrail.css'

export interface SolutionTrailProps {
  moves: readonly Move[]
  cursor: number
  busy: boolean
  playing: boolean
  optimizing: boolean
  searchSeconds: 1 | 5 | 10
  onSearchSecondsChange: (seconds: 1 | 5 | 10) => void
  onSeek: (index: number) => void
  onPlay: () => void
  onPause: () => void
  onClose: () => void
}

const SEARCH_SECONDS = [1, 5, 10] as const

const NOTATION_DESCRIPTIONS: Record<string, { layer: string; view: string }> = {
  U: { layer: '上の面', view: '上' },
  D: { layer: '下の面', view: '下' },
  F: { layer: '手前の面', view: '手前' },
  B: { layer: '奥の面', view: '奥' },
  L: { layer: '左の面', view: '左' },
  R: { layer: '右の面', view: '右' },
  M: { layer: '左右の間にある中央の層', view: '左' },
  E: { layer: '上下の間にある中央の層', view: '下' },
  S: { layer: '前後の間にある中央の層', view: '手前' },
}

function describeMove(move: Move) {
  const notation = moveToNotation(move)
  const description = NOTATION_DESCRIPTIONS[notation[0]]
  const rotation = notation.endsWith('2') ? '180°回転' : notation.endsWith("'") ? '反時計回りに90°回転' : '時計回りに90°回転'
  return `${description.layer}を${description.view}から見て${rotation}`
}

export function SolutionTrail({ moves, cursor, busy, playing, optimizing, searchSeconds, onSearchSecondsChange, onSeek, onPlay, onPause, onClose }: SolutionTrailProps) {
  const id = useId()
  const listRef = useRef<HTMLOListElement>(null)
  const currentRef = useRef<HTMLButtonElement>(null)
  const current = Math.min(Math.max(cursor, 0), moves.length)
  const complete = moves.length > 0 && current === moves.length
  const remaining = moves.length - current

  useEffect(() => {
    const list = listRef.current
    const button = currentRef.current
    if (!list || !button) return
    // ページ全体の位置を変えず、手順欄の中だけで現在の手を見える位置にする。
    const listBounds = list.getBoundingClientRect()
    const buttonBounds = button.getBoundingClientRect()
    if (buttonBounds.left < listBounds.left + 5) list.scrollLeft += buttonBounds.left - listBounds.left - 5
    else if (buttonBounds.right > listBounds.right - 5) list.scrollLeft += buttonBounds.right - listBounds.right + 5
  }, [current, moves.length])

  const progress = optimizing ? '解法を計算中…' : playing ? `自動再生中・残り ${remaining} 手` : busy ? `移動中・${current} / ${moves.length} 手` : complete ? `完了・${moves.length} 手` : moves.length ? `残り ${remaining} 手` : '回転は不要です'

  return (
    <section id="solution-trail" className="solution-trail" aria-labelledby={`${id}-title`}>
      <div className="trail-heading">
        <div className="trail-heading-main"><h2 id={`${id}-title`}>解法例</h2><span className="trail-position"><strong>{current}</strong> / {moves.length} 手</span></div>
        <button type="button" className="trail-close" onClick={onClose} aria-label="解法例を閉じる" title="解法例を閉じる"><Icon name="close" size={19} /></button>
      </div>

      <div className="trail-toolbar">
        <p id={`${id}-hint`} className="trail-hint">手順を押すと、その位置まで回します。</p>
        <div className="trail-controls" role="group" aria-label="解法の再生操作">
          <button type="button" className="trail-control" onClick={() => onSeek(current - 1)} disabled={busy || current === 0} aria-label="解法を一手戻る"><Icon name="arrow-right" size={15} className="trail-previous-icon" /><span>前へ</span></button>
          <button type="button" className={`trail-control trail-play${playing ? ' is-playing' : ''}`} onClick={playing ? onPause : onPlay} disabled={!playing && (busy || current === moves.length)} aria-label={playing ? '解法の自動再生を一時停止' : '解法を最後まで再生'}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">{playing ? <><rect x="3" y="2" width="3" height="12" rx=".7" /><rect x="10" y="2" width="3" height="12" rx=".7" /></> : <path d="M4 2.3a.6.6 0 0 1 .9-.5l8 5.7a.6.6 0 0 1 0 1l-8 5.7a.6.6 0 0 1-.9-.5V2.3Z" />}</svg>
            <span>{playing ? '一時停止' : '最後まで再生'}</span>
          </button>
          <button type="button" className="trail-control" onClick={() => onSeek(current + 1)} disabled={busy || current === moves.length} aria-label="解法を一手進む"><span>次へ</span><Icon name="arrow-right" size={15} /></button>
        </div>
      </div>

      <ol ref={listRef} className="trail-steps" aria-label="解法の手順" aria-describedby={`${id}-hint`} aria-busy={busy}>
        {Array.from({ length: moves.length + 1 }, (_, index) => {
          const move = index === 0 ? null : moves[index - 1]
          const notation = move ? moveToNotation(move) : '開始'
          const isCurrent = index === current
          const isNext = index === current + 1
          const done = index < current
          const explanation = move ? `${index} 手目 ${notation}：${describeMove(move)}` : '解法例を開いたときの状態'
          return (
            <li key={index} className={`trail-step${isCurrent ? ' is-current' : ''}${isNext ? ' is-next' : ''}${done ? ' is-done' : ''}`}>
              <button ref={isCurrent ? currentRef : undefined} type="button" onClick={() => onSeek(index)} disabled={busy || isCurrent} aria-current={isCurrent ? 'step' : undefined} aria-label={`${index === 0 ? '開始位置' : `${index} 手目 ${notation}`}に移動${isCurrent ? '（現在の位置）' : ''}`} title={explanation}>
                <span className="trail-step-meta">{isCurrent ? '現在' : isNext ? '次' : <>{done && <Icon name="check" size={10} strokeWidth={2} />}{index}</>}</span>
                <span className="trail-step-name">{notation}</span>
              </button>
              {index < moves.length && <span className="trail-separator" aria-hidden="true">›</span>}
            </li>
          )
        })}
      </ol>

      <div className="trail-search-settings">
        <span id={`${id}-search-label`} className="trail-search-label">探索時間の上限</span>
        <div className="trail-search-options" role="group" aria-labelledby={`${id}-search-label`} aria-describedby={`${id}-search-hint`}>
          {SEARCH_SECONDS.map(seconds => <button key={seconds} type="button" aria-pressed={searchSeconds === seconds} onClick={() => onSearchSecondsChange(seconds)}>{seconds}秒</button>)}
        </div>
        <p id={`${id}-search-hint`} className="trail-search-hint">操作が止まると探索します。</p>
      </div>

      <div className="trail-footer">
        <p className={`trail-progress${complete ? ' is-complete' : ''}`} role="status" aria-live="polite" aria-atomic="true">{complete && !optimizing && <Icon name="check" size={14} />}{optimizing && <span className="trail-working-dot" aria-hidden="true" />}{progress}</p>
        <p className="trail-notation">′＝逆回転 / 2＝180° / M・E・S＝中央の層</p>
        <p className="trail-disclaimer">最短手数を保証するものではありません。</p>
      </div>
    </section>
  )
}
