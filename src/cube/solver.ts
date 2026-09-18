import min2phase from '../vendor/min2phase.js'
import { applyMove, faceMove, isSolved } from './model'
import type { Axis, Cubie, Face, Layer, Move } from './model'

export interface SolveOptions {
  timeoutMs: number
  maxMoves: number
  signal?: AbortSignal
  onCandidate: (moves: Move[]) => void
  onProgress?: (phase: 'loading' | 'searching') => void
}

export interface SolveResult {
  reason: 'complete' | 'timeout' | 'cancelled'
}

const TABLE_URL = new URL('../vendor/min2phase-tables.bin', import.meta.url).href
const SLICE_MS = 16
const PROBES_PER_SLICE = 128
const ALL_MOVES: Move[] = (['x', 'y', 'z'] as Axis[]).flatMap((axis) =>
  ([-1, 0, 1] as Layer[]).flatMap((layer) =>
    ([-1, 1, 2] as const).map((turns) => ({ axis, layer, turns }))),
)
let tablesReady = false

export function cubeToFacelets(cube: readonly Cubie[]): string {
  const facelets = new Array<string>(54)

  for (const cubie of cube) {
    const [x, y, z] = cubie.position
    for (const { normal: [nx, ny, nz], color } of cubie.stickers) {
      // URFDLB の各面を外側から見る。上面・下面・背面では列や行の向きが変わる。
      const index = ny === 1 ? (z + 1) * 3 + x + 1
        : nx === 1 ? 9 + (1 - y) * 3 + 1 - z
          : nz === 1 ? 18 + (1 - y) * 3 + x + 1
            : ny === -1 ? 27 + (1 - z) * 3 + x + 1
              : nx === -1 ? 36 + (1 - y) * 3 + z + 1
                : nz === -1 ? 45 + (1 - y) * 3 + 1 - x : -1
      if (index < 0 || index >= 54 || facelets[index] !== undefined) {
        throw new Error('キューブの面配置を読み取れません。')
      }
      facelets[index] = color
    }
  }

  if (facelets.filter(Boolean).length !== 54 || new Set([4, 13, 22, 31, 40, 49].map((index) => facelets[index])).size !== 6) {
    throw new Error('キューブの面または中心が不足しています。')
  }
  // min2phase は各面の中心色を基準に色を読み替えるため、中央層や持ち替えにも対応する。
  return facelets.join('')
}

function parseMoves(text: string): Move[] {
  if (!text.trim()) return []
  return text.trim().split(/\s+/).map((token) => {
    if (!/^[URFDLB](?:2|')?$/.test(token)) throw new Error('探索結果の回転記号を読み取れません。')
    const move = faceMove(token[0] as Face, token.endsWith("'"))
    return token.endsWith('2') ? { ...move, turns: 2 } : move
  })
}

async function loadTables(signal: AbortSignal) {
  if (tablesReady) return
  const response = await fetch(TABLE_URL, { signal, cache: 'force-cache' })
  if (!response.ok) throw new Error('探索用データを読み込めませんでした。')
  const buffer = await response.arrayBuffer()
  signal.throwIfAborted()
  min2phase.loadTables(buffer)
  tablesReady = true
}

function yieldToEvents() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0))
}

export async function solveCube(cube: readonly Cubie[], options: SolveOptions): Promise<SolveResult> {
  const started = performance.now()
  const timeout = Math.min(10_000, Math.max(0, options.timeoutMs))
  const deadline = started + timeout
  const controller = new AbortController()
  const abort = () => controller.abort()
  options.signal?.addEventListener('abort', abort, { once: true })
  if (options.signal?.aborted) abort()
  const timer = setTimeout(abort, timeout)
  const stopped = () => controller.signal.aborted || performance.now() >= deadline
  const reason = (): SolveResult => ({ reason: options.signal?.aborted ? 'cancelled' : 'timeout' })
  const maxMoves = Math.min(21, Math.max(0, Math.floor(options.maxMoves)))
  let bestLength = maxMoves + 1

  function publish(moves: Move[]) {
    if (stopped() || moves.length >= bestLength) return false
    let restored: readonly Cubie[] = cube
    for (const move of moves) restored = applyMove(restored, move)
    if (!isSolved(restored)) throw new Error('探索結果がキューブを完成させることを確認できませんでした。')
    if (stopped()) return false
    bestLength = moves.length
    options.onCandidate(moves)
    return true
  }

  try {
    if (stopped()) return reason()
    if (isSolved(cube)) {
      publish([])
      return { reason: 'complete' }
    }
    if (maxMoves === 0) return { reason: 'complete' }

    // 既に短い手順には大きな表を読み込まない。中央層を含む 1〜2 手は直接調べる。
    for (const first of ALL_MOVES) {
      if (stopped()) return reason()
      const once = applyMove(cube, first)
      if (isSolved(once)) {
        publish([first])
        return { reason: 'complete' }
      }
    }
    if (maxMoves === 1) return { reason: 'complete' }
    if (maxMoves === 2) {
      for (const first of ALL_MOVES) {
        if (stopped()) return reason()
        const once = applyMove(cube, first)
        for (const second of ALL_MOVES) {
          if (first.axis === second.axis && first.layer === second.layer) continue
          if (isSolved(applyMove(once, second))) {
            publish([first, second])
            return { reason: 'complete' }
          }
        }
        await yieldToEvents()
      }
      return { reason: 'complete' }
    }

    const facelets = cubeToFacelets(cube)
    options.onProgress?.('loading')
    await loadTables(controller.signal)
    if (stopped()) return reason()
    options.onProgress?.('searching')
    const search = new min2phase.Search()
    let first = true

    while (!stopped()) {
      search.setControl(stopped, Math.min(deadline, performance.now() + SLICE_MS))
      const text = first
        ? search.solution(facelets, maxMoves, PROBES_PER_SLICE, 0, 0)
        : search.next(PROBES_PER_SLICE, 0, 0)
      first = false
      if (stopped()) return reason()
      if (text === 'Error 7') return { reason: 'complete' }
      if (text !== 'Error 8') {
        if (text.startsWith('Error')) throw new Error(`キューブの状態を探索できませんでした (${text})。`)
        publish(parseMoves(text))
        if (bestLength <= 2) return { reason: 'complete' }
      }
      // message / AbortSignal を処理できるよう、探索の片ごとに Worker のイベントへ戻る。
      await yieldToEvents()
    }
    return reason()
  } catch (error) {
    if (stopped() || (error instanceof Error && error.name === 'SearchInterrupted')) return reason()
    throw error
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', abort)
  }
}
