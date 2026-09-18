import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { CubeStage, type CubePerformance, type CubeStageHandle } from './components/CubeStage'
import { Icon } from './components/Icon'
import { SolutionTrail } from './components/SolutionTrail'
import { createScramble, faceMove, inverseMove, isSolved, moveToNotation, type Face, type Move } from './cube/model'
import { useSolution } from './cube/useSolution'
import './App.css'

const GITHUB_URL = 'https://github.com/FeLm4t4/cube-room'
const MIN_SHUFFLE_LENGTH = 20
const MAX_SHUFFLE_LENGTH = 40
const FACES: { face: Face; label: string; color: string }[] = [
  { face: 'U', label: '上', color: '#f4f6f8' },
  { face: 'F', label: '手前', color: '#43b28b' },
  { face: 'R', label: '右', color: '#ed604c' },
  { face: 'D', label: '下', color: '#ffe21a' },
  { face: 'B', label: '奥', color: '#437ddd' },
  { face: 'L', label: '左', color: '#ff720d' },
]
const SPEEDS = [{ label: 'ゆっくり', duration: 360 }, { label: '標準', duration: 220 }, { label: '速い', duration: 120 }]
type ModalKind = 'help' | 'reset' | null
type Operation = 'play' | 'shuffle' | 'undo' | 'solution'
interface TrailState { moves: Move[]; cursor: number }

function formatTime(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1000)
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

function containDialogFocus(event: ReactKeyboardEvent<HTMLDialogElement>) {
  if (event.key !== 'Tab') return
  const dialog = event.currentTarget
  const targets = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter((element) => element.getClientRects().length > 0)
  const first = targets[0]
  const last = targets.at(-1)
  if (!first || !last) {
    event.preventDefault()
    return
  }
  const outside = !dialog.contains(document.activeElement)
  if (event.shiftKey && (document.activeElement === first || outside)) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && (document.activeElement === last || outside)) {
    event.preventDefault()
    first.focus()
  }
}

export default function App() {
  const stageRef = useRef<CubeStageHandle>(null)
  const [ready, setReady] = useState(false)
  const readyRef = useRef(false)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const operationRef = useRef<Operation>('play')
  const [history, setHistory] = useState<Move[]>([])
  const historyRef = useRef<Move[]>([])
  const [scrambled, setScrambled] = useState(false)
  const scrambledRef = useRef(false)
  const [solved, setSolved] = useState(true)
  const [elapsed, setElapsed] = useState(0)
  const elapsedRef = useRef(0)
  const startedAtRef = useRef<number | null>(null)
  const [timerRunning, setTimerRunning] = useState(false)
  const [speed, setSpeed] = useState(220)
  const speedRef = useRef(220)
  const [inverse, setInverse] = useState(false)
  const inverseRef = useRef(false)
  const [interactionMode, setInteractionMode] = useState<'turn' | 'orbit'>('turn')
  const [showFps, setShowFps] = useState(false)
  const [performanceStats, setPerformanceStats] = useState<CubePerformance | null>(null)
  const [modal, setModal] = useState<ModalKind>(null)
  const modalRef = useRef<ModalKind>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const [error, setError] = useState('')
  const [shuffleProgress, setShuffleProgress] = useState(0)
  const [shuffleLength, setShuffleLength] = useState<number | null>(null)
  const generationRef = useRef(0)
  const [solutionVisible, setSolutionVisible] = useState(false)
  const solutionVisibleRef = useRef(false)
  const [trail, setTrail] = useState<TrailState>({ moves: [], cursor: 0 })
  const trailRef = useRef<TrailState>({ moves: [], cursor: 0 })
  const [solutionPlaying, setSolutionPlaying] = useState(false)
  const [searchSeconds, setSearchSeconds] = useState<1 | 5 | 10>(() => {
    try {
      const stored = Number(localStorage.getItem('cube-room.searchSeconds'))
      return stored === 5 || stored === 10 ? stored : 1
    } catch { return 1 }
  })
  const stopPlaybackRef = useRef(false)
  const pendingCursorRef = useRef<{ move: Move; cursor: number } | null>(null)
  const canAcceptSolution = useCallback(() => !busyRef.current, [])
  const getCubeForSolution = useCallback(() => stageRef.current?.getCube(), [])
  const { moves: solutionMoves, movesRef: solutionMovesRef, optimizing, apply: applySolution, reset: resetSolution, interrupt: interruptSolution, setInteractionActive } = useSolution(
    ready && !busy, canAcceptSolution, getCubeForSolution, searchSeconds,
  )
  const changeSearchSeconds = useCallback((seconds: 1 | 5 | 10) => {
    setSearchSeconds(seconds)
    try { localStorage.setItem('cube-room.searchSeconds', String(seconds)) }
    catch { /* 保存できない環境でも、この画面では選択した時間を使う。 */ }
  }, [])
  const rebaseTrail = useCallback((moves: readonly Move[]) => {
    const previous = trailRef.current
    if (previous.cursor === 0 && previous.moves.length === moves.length && moves.every((move, index) => move === previous.moves[index])) return
    const next = { moves: [...moves], cursor: 0 }
    trailRef.current = next
    setTrail(next)
  }, [])

  useEffect(() => {
    if (!solutionVisibleRef.current || busyRef.current) return
    const previous = trailRef.current
    const currentSolution = solutionMovesRef.current
    const remaining = previous.moves.slice(previous.cursor)
    if (remaining.length === currentSolution.length && remaining.every((move, index) => {
      const next = currentSolution[index]
      return move.axis === next.axis && move.layer === next.layer && move.turns === next.turns
    })) return
    // たどった手順と現在位置を残し、停止中に残りの解法だけを更新する。
    const next = { moves: [...previous.moves.slice(0, previous.cursor), ...currentSolution], cursor: previous.cursor }
    trailRef.current = next
    setTrail(next)
  }, [solutionMoves, solutionMovesRef, solutionVisible, busy])

  useEffect(() => () => {
    // 画面を閉じた後に、待機中の回転から次の手を実行しない。
    generationRef.current += 1
    readyRef.current = false
    stopPlaybackRef.current = true
  }, [])

  const resetClock = useCallback(() => {
    startedAtRef.current = null
    elapsedRef.current = 0
    setElapsed(0)
    setTimerRunning(false)
  }, [])

  const startClock = useCallback(() => {
    if (startedAtRef.current === null) startedAtRef.current = performance.now() - elapsedRef.current
    setTimerRunning(true)
  }, [])

  const pauseClock = useCallback(() => {
    if (startedAtRef.current !== null) {
      elapsedRef.current = performance.now() - startedAtRef.current
      setElapsed(elapsedRef.current)
    }
    startedAtRef.current = null
    setTimerRunning(false)
  }, [])

  useEffect(() => {
    if (!timerRunning) return
    const timer = window.setInterval(() => {
      if (startedAtRef.current !== null) {
        elapsedRef.current = performance.now() - startedAtRef.current
        setElapsed(elapsedRef.current)
      }
    }, 200)
    return () => window.clearInterval(timer)
  }, [timerRunning])

  const onMove = useCallback((move: Move, source: 'user' | 'program') => {
    const nowSolved = stageRef.current ? isSolved(stageRef.current.getCube()) : false
    const nextSolution = applySolution(move, nowSolved)
    const pending = pendingCursorRef.current
    if (operationRef.current === 'solution' && source === 'program' && pending
      && pending.move.axis === move.axis && pending.move.layer === move.layer && pending.move.turns === move.turns) {
      // 実際に回転が確定したときだけ、パンくずの現在位置を動かす。
      const next = { ...trailRef.current, cursor: pending.cursor }
      pendingCursorRef.current = null
      trailRef.current = next
      setTrail(next)
    } else if (solutionVisibleRef.current) {
      rebaseTrail(nextSolution)
    }
    setSolved(nowSolved)
    if (operationRef.current === 'shuffle' || operationRef.current === 'undo') return
    const next = [...historyRef.current, move]
    historyRef.current = next
    setHistory(next)
    if (nowSolved) pauseClock()
    else startClock()
  }, [applySolution, pauseClock, rebaseTrail, startClock])

  const beginOperation = useCallback((operation: Operation) => {
    if (!readyRef.current || busyRef.current || modalRef.current || !stageRef.current) return false
    busyRef.current = true
    interruptSolution()
    operationRef.current = operation
    setBusy(true)
    setError('')
    return true
  }, [interruptSolution])

  const endOperation = useCallback(() => {
    operationRef.current = 'play'
    busyRef.current = false
    setBusy(false)
  }, [])

  const playFace = useCallback(async (face: Face, reverse = false) => {
    if (!beginOperation('play')) return
    const generation = generationRef.current
    try {
      await stageRef.current!.playMove(faceMove(face, reverse), speedRef.current)
    } catch {
      if (generation === generationRef.current) setError('回転を完了できませんでした。もう一度お試しください。')
    } finally {
      if (generation === generationRef.current) endOperation()
    }
  }, [beginOperation, endOperation])

  const undo = useCallback(async () => {
    const previous = historyRef.current.at(-1)
    if (!previous || !beginOperation('undo')) return
    const generation = generationRef.current
    try {
      await stageRef.current!.playMove(inverseMove(previous), speedRef.current)
      if (generation !== generationRef.current) return
      const next = historyRef.current.slice(0, -1)
      historyRef.current = next
      setHistory(next)
      const nowSolved = isSolved(stageRef.current!.getCube())
      setSolved(nowSolved)
      if (next.length === 0) resetClock()
      else if (nowSolved) pauseClock()
      else startClock()
    } catch {
      if (generation === generationRef.current) setError('一手戻せませんでした。もう一度お試しください。')
    } finally {
      if (generation === generationRef.current) endOperation()
    }
  }, [beginOperation, endOperation, pauseClock, resetClock, startClock])

  const shuffle = useCallback(async () => {
    if (!beginOperation('shuffle')) return
    const generation = generationRef.current
    try {
      stageRef.current!.resetCube()
      resetSolution()
      rebaseTrail([])
      historyRef.current = []
      setHistory([])
      resetClock()
      scrambledRef.current = true
      setScrambled(true)
      setSolved(false)
      setShuffleProgress(0)
      const length = MIN_SHUFFLE_LENGTH + Math.floor(Math.random() * (MAX_SHUFFLE_LENGTH - MIN_SHUFFLE_LENGTH + 1))
      const moves = createScramble(length)
      setShuffleLength(length)
      for (let index = 0; index < moves.length; index += 1) {
        if (generation !== generationRef.current || !stageRef.current) return
        await stageRef.current!.playMove(moves[index], Math.min(speedRef.current, 50))
        if (generation !== generationRef.current) return
        setShuffleProgress(index + 1)
      }
      setSolved(isSolved(stageRef.current!.getCube()))
    } catch {
      if (generation === generationRef.current) setError('シャッフルを完了できませんでした。もう一度お試しください。')
    } finally {
      if (generation === generationRef.current) endOperation()
    }
  }, [beginOperation, endOperation, rebaseTrail, resetClock, resetSolution])

  const pauseSolution = useCallback(() => {
    stopPlaybackRef.current = true
  }, [])

  const seekSolution = useCallback(async (target: number) => {
    const path = trailRef.current.moves
    if (!solutionVisibleRef.current || target === trailRef.current.cursor || target < 0 || target > path.length) return
    if (!beginOperation('solution')) return
    const generation = generationRef.current
    stopPlaybackRef.current = false
    setSolutionPlaying(true)
    try {
      while (trailRef.current.cursor !== target && !stopPlaybackRef.current) {
        if (generation !== generationRef.current || !stageRef.current) return
        const cursor = trailRef.current.cursor
        const forwards = target > cursor
        const nextCursor = forwards ? cursor + 1 : cursor - 1
        const move = forwards ? path[cursor] : inverseMove(path[cursor - 1])
        pendingCursorRef.current = { move, cursor: nextCursor }
        await stageRef.current.playMove(move, speedRef.current)
        if (generation !== generationRef.current) return
        if (pendingCursorRef.current) throw new Error('回転が確定しませんでした。')
      }
    } catch {
      if (generation === generationRef.current) setError('手順の再生を中断しました。現在の位置から再開できます。')
    } finally {
      pendingCursorRef.current = null
      if (generation === generationRef.current) {
        setSolutionPlaying(false)
        endOperation()
      }
    }
  }, [beginOperation, endOperation])

  const closeSolution = useCallback(() => {
    stopPlaybackRef.current = true
    solutionVisibleRef.current = false
    setSolutionVisible(false)
  }, [])

  const toggleSolution = useCallback(() => {
    if (busyRef.current) return
    if (solutionVisibleRef.current) closeSolution()
    else {
      rebaseTrail(solutionMovesRef.current)
      solutionVisibleRef.current = true
      setSolutionVisible(true)
    }
  }, [closeSolution, rebaseTrail, solutionMovesRef])

  const closeModal = useCallback(() => {
    modalRef.current = null
    setModal(null)
  }, [])

  const openModal = useCallback((kind: Exclude<ModalKind, null>) => {
    stopPlaybackRef.current = true
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    modalRef.current = kind
    setModal(kind)
  }, [])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (modal && !dialog.open) {
      dialog.showModal()
      dialog.querySelector<HTMLButtonElement>('button')?.focus()
    } else if (!modal && dialog.open) {
      dialog.close()
      returnFocusRef.current?.focus()
    }
  }, [modal])

  const reset = useCallback(() => {
    if (busyRef.current || !readyRef.current) return
    stageRef.current?.resetCube()
    resetSolution()
    rebaseTrail([])
    historyRef.current = []
    setHistory([])
    scrambledRef.current = false
    setScrambled(false)
    setShuffleLength(null)
    setShuffleProgress(0)
    setSolved(true)
    setError('')
    resetClock()
    closeModal()
  }, [closeModal, rebaseTrail, resetClock, resetSolution])

  const requestReset = useCallback(() => {
    if (historyRef.current.length || scrambledRef.current) openModal('reset')
    else reset()
  }, [openModal, reset])

  const actionsRef = useRef({ playFace, undo, shuffle, openModal })
  actionsRef.current = { playFace, undo, shuffle, openModal }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || modalRef.current || busyRef.current || !readyRef.current || event.altKey) return
      const target = event.target
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select'))) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        event.preventDefault()
        void actionsRef.current.undo()
        return
      }
      if (event.ctrlKey || event.metaKey) return
      if (event.code === 'Space') {
        if (target instanceof HTMLElement && target.closest('button, a, summary, [role="button"]')) return
        event.preventDefault()
        void actionsRef.current.shuffle()
      } else if (/^[udfblr]$/i.test(event.key)) {
        event.preventDefault()
        void actionsRef.current.playFace(event.key.toUpperCase() as Face, event.shiftKey || inverseRef.current)
      } else if (event.key === '?') {
        event.preventDefault()
        actionsRef.current.openModal('help')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const won = solved && history.length > 0
  const shuffling = busy && operationRef.current === 'shuffle'
  const controlsDisabled = !ready || busy
  const status = !ready ? 'キューブを準備しています' : shuffling ? `${shuffleLength}手でシャッフルしています` : solutionPlaying ? '解法例をたどっています' : won ? '6面が揃いました' : scrambled || history.length ? 'プレイ中' : '完成状態'
  const renderModeLabel = performanceStats?.renderMode === 'GPU' ? 'GPU / WebGL 2' : performanceStats?.renderMode === 'software' ? 'ソフトウェア / WebGL 2' : 'WebGL 2'

  return (
    <div className="app-shell">
      <a href="#play" className="skip-link">キューブの操作へ進む</a>
      <header className="site-header">
        <a className="brand" href="#play" aria-label="CUBE ROOM ホーム">
          <span className="brand-mark"><Icon name="cube" size={30} strokeWidth={1.5} /></span>
          <span>CUBE ROOM<span className="brand-period">.</span></span>
        </a>
        <nav className="header-nav" aria-label="メインナビゲーション">
          <button type="button" onClick={() => openModal('help')}>操作ガイド</button>
          <a className="github-link" href={GITHUB_URL} target="_blank" rel="noreferrer" aria-label="GitHub リポジトリを新しいタブで開く">GitHub <Icon name="arrow-up-right" size={15} /></a>
        </nav>
      </header>

      <main id="play" className="main-content">
        <div className={`workspace-grid${solutionVisible ? ' has-solution' : ''}`}>
          <section className={`stage-card${won ? ' is-solved' : ''}`} aria-label="3D ルービックキューブ">
            <div className="stage-topbar">
              <span className="mode-pill">3 × 3 × 3</span>
              <div className="stage-actions">
                <button type="button" className={`fps-toggle${showFps ? ' selected' : ''}`} aria-label="FPS表示" aria-pressed={showFps} onClick={() => { if (!showFps) setPerformanceStats(null); setShowFps(!showFps) }}>FPS</button>
                <button type="button" className="icon-button view-reset" onClick={() => stageRef.current?.resetView()} disabled={!ready} aria-label="キューブの視点を元に戻す" title="視点を元に戻す"><Icon name="orbit" size={20} /></button>
              </div>
            </div>
            {showFps && <output className="performance-overlay" aria-label="描画性能"><span><strong>{performanceStats?.fps ?? '—'}</strong> FPS</span><span className="render-mode">{renderModeLabel}</span></output>}
            <div className="cube-stage-slot">
              <CubeStage ref={stageRef} onMove={onMove} onInteractionChange={setInteractionActive} onReady={() => { readyRef.current = true; setReady(true) }} disabled={busy || Boolean(modal)} interactionMode={interactionMode} duration={speed} onError={setError} showFps={showFps} onPerformance={setPerformanceStats} />
            </div>
            {won && <div className="success-note" role="status"><Icon name="check" size={19} /><span>6面が揃いました</span><span className="success-time">{formatTime(elapsed)}</span></div>}
            <div className="stage-bottom">
              <div className="stage-drag-hints"><span><span className="mouse-hint mouse-hint-left" /> 左ドラッグで回転</span><span><span className="mouse-hint mouse-hint-right" /> 右ドラッグで視点移動</span></div>
              <div className="touch-mode" role="group" aria-label="タッチ操作のモード">
                <button type="button" className={interactionMode === 'turn' ? 'selected' : ''} aria-pressed={interactionMode === 'turn'} onClick={() => setInteractionMode('turn')}><Icon name="turn" size={16} /> 回す</button>
                <button type="button" className={interactionMode === 'orbit' ? 'selected' : ''} aria-pressed={interactionMode === 'orbit'} onClick={() => setInteractionMode('orbit')}><Icon name="orbit" size={16} /> 見る</button>
              </div>
            </div>
          </section>

          <aside className="control-card" aria-label="キューブのコントロール">
            <div className="panel-heading"><p className="section-kicker">記録</p><button type="button" className="text-button reset-button" onClick={requestReset} disabled={controlsDisabled} aria-label="キューブと記録をリセット"><Icon name="reset" size={14} /> リセット</button></div>
            <div className="session-stats">
              <div><span className="stat-label">タイム</span><span className="stat-value timer-value" aria-label={`経過時間 ${formatTime(elapsed)}`}>{formatTime(elapsed)}<span className={`timer-dot${timerRunning ? ' is-running' : ''}`} /></span></div>
              <div><span className="stat-label">手数</span><span className="stat-value move-value">{String(history.length).padStart(2, '0')}<span className="stat-unit">手</span></span></div>
            </div>
            <p className={`session-status${won ? ' status-solved' : ''}`} aria-live="polite">{won ? <Icon name="check" size={15} /> : <span className={`status-dot${shuffling ? ' is-shuffling' : ''}`} />}{status}</p>
            <button type="button" className="primary-button shuffle-button" onClick={() => void shuffle()} disabled={controlsDisabled}><Icon name="shuffle" size={19} /><span>{shuffling ? `シャッフル中 ${shuffleProgress}/${shuffleLength}` : 'シャッフル'}</span><span className="shuffle-length">{shuffleLength ?? `${MIN_SHUFFLE_LENGTH}〜${MAX_SHUFFLE_LENGTH}`}手</span></button>
            <button type="button" className="undo-button" onClick={() => void undo()} disabled={controlsDisabled || !history.length}><Icon name="undo" size={17} /><span>一手戻す</span><span className="undo-shortcut">Ctrl / ⌘ Z</span></button>
            <button type="button" className={`solution-toggle${solutionVisible ? ' selected' : ''}`} onClick={toggleSolution} disabled={controlsDisabled} aria-expanded={solutionVisible} aria-controls="solution-trail"><Icon name="spark" size={17} /><span>解法例</span><span className="solution-count">{solutionMoves.length ? `残り ${solutionMoves.length}手` : '完成'}</span></button>

            <div className="panel-divider" />
            <div className="face-heading"><h2>面を回す</h2><button type="button" className="face-help" onClick={() => openModal('help')} aria-label="面の記号と回転方向について"><Icon name="help" size={16} /></button></div>
            <div className="face-buttons">
              {FACES.map(({ face, label, color }) => <button type="button" className="face-button" key={face} disabled={controlsDisabled} onClick={(event) => void playFace(face, event.shiftKey || inverse)} aria-label={`${label}の面を${inverse ? '反時計回り' : '時計回り'}に回す（${face}${inverse ? '′' : ''}）`}><span className="face-swatch" style={{ backgroundColor: color }} /><span className="face-letter">{face}{inverse && <span className="prime-mark">′</span>}</span><span className="face-name">{label}</span></button>)}
            </div>
            <label className="inverse-toggle"><input type="checkbox" checked={inverse} onChange={(event) => { inverseRef.current = event.target.checked; setInverse(event.target.checked) }} /><span className="checkbox-visual"><Icon name="check" size={11} strokeWidth={2.4} /></span><span>逆回転</span><span className="inverse-key-hint"><kbd>Shift</kbd> を押しながらでも</span></label>
            <div className="speed-setting"><h2>回転スピード</h2><div className="speed-options" role="group" aria-label="回転スピード">{SPEEDS.map((option) => <button type="button" key={option.duration} aria-pressed={speed === option.duration} className={speed === option.duration ? 'selected' : ''} onClick={() => { speedRef.current = option.duration; setSpeed(option.duration) }}>{option.label}</button>)}</div></div>
          </aside>

          {solutionVisible && <SolutionTrail moves={trail.moves} cursor={trail.cursor} busy={controlsDisabled} playing={solutionPlaying} optimizing={optimizing} searchSeconds={searchSeconds} onSearchSecondsChange={changeSearchSeconds} onSeek={(index) => void seekSolution(index)} onPlay={() => void seekSolution(trailRef.current.moves.length)} onPause={pauseSolution} onClose={closeSolution} />}

          <section className="history-bar" aria-label="最近の操作履歴">
            <p className="section-kicker">操作履歴</p>
            <div className="move-history">{history.length ? <>{history.length > 10 && <span className="history-ellipsis" aria-label="それ以前の手順を省略">…</span>}{history.slice(-10).map((move, index) => <span className={`move-chip${index === Math.min(history.length, 10) - 1 ? ' latest' : ''}`} key={`${history.length - Math.min(history.length, 10) + index}-${moveToNotation(move)}`}>{moveToNotation(move)}</span>)}</> : <span className="history-empty">操作履歴はまだありません</span>}</div>
            <Icon name="arrow-right" size={17} className="history-arrow" />
          </section>
          <button type="button" className="guide-link" onClick={() => openModal('help')}><Icon name="keyboard" size={18} /><span>操作ガイド・ショートカット</span><Icon name="arrow-up-right" size={16} /></button>
        </div>

        {error && <p className="error-notice" role="alert"><Icon name="help" size={18} />{error}<button type="button" onClick={() => setError('')} aria-label="エラーメッセージを閉じる"><Icon name="close" size={16} /></button></p>}

      </main>

      <dialog ref={dialogRef} className={`app-dialog ${modal === 'reset' ? 'reset-dialog' : 'help-dialog'}`} aria-labelledby="dialog-title" onKeyDown={containDialogFocus} onCancel={(event) => { event.preventDefault(); closeModal() }} onClick={(event) => { if (event.target === event.currentTarget) closeModal() }}>
        <div className="dialog-content">
          <button type="button" className="icon-button dialog-close" onClick={closeModal} aria-label="閉じる"><Icon name="close" size={22} /></button>
          {modal === 'reset' ? <>
            <h2 id="dialog-title">キューブをリセットしますか？</h2><p className="dialog-description">キューブを完成した状態に戻し、タイムと手数をリセットします。</p><div className="dialog-actions"><button type="button" className="secondary-button" onClick={closeModal}>続ける</button><button type="button" className="primary-button" onClick={reset}>リセットする<Icon name="arrow-right" size={17} /></button></div>
          </> : <>
            <h2 id="dialog-title">操作ガイド</h2><p className="dialog-description">シャッフルしたキューブの6つの面を、それぞれ同じ色に揃えたら完成です。</p>
            <div className="help-gestures"><div><span className="help-icon"><Icon name="turn" size={24} /></span><h3>面を回す</h3><p>色のついた面を左ドラッグ。動かした方向に、その段が回転します。</p></div><div><span className="help-icon"><Icon name="orbit" size={26} /></span><h3>視点を変える</h3><p>右ドラッグで本体の向きを変えます。ホイールで拡大・縮小できます。</p></div></div>
            <p className="touch-help"><strong>スマートフォン・タブレット</strong><span>「回す」で面をスワイプ、「見る」で視点を移動。2本指のピンチで拡大・縮小できます。</span></p>
            <div className="keyboard-help"><h3><Icon name="keyboard" size={18} /> キーボード操作</h3><div className="shortcut-list"><p><span><kbd>U</kbd><kbd>D</kbd><kbd>F</kbd><kbd>B</kbd><kbd>L</kbd><kbd>R</kbd></span><span>各面を時計回りに90°</span></p><p><span><kbd>Shift</kbd><span className="shortcut-plus">+</span><kbd>面のキー</kbd></span><span>反時計回りに90°</span></p><p><span><kbd>Space</kbd></span><span>シャッフル</span></p><p><span><kbd>Ctrl / ⌘</kbd><span className="shortcut-plus">+</span><kbd>Z</kbd></span><span>一手戻す</span></p></div></div>
            <p className="notation-help">U＝上、D＝下、F＝手前、B＝奥、L＝左、R＝右。各面を正面から見た向きで回転します。面の記号は初期位置が基準です。履歴の「′」は逆回転、「2」は180°回転を表します。</p>
            <button type="button" className="primary-button help-start" onClick={closeModal}>閉じる<Icon name="check" size={18} /></button>
          </>}
        </div>
      </dialog>
    </div>
  )
}
