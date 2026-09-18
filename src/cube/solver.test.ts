import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import min2phase from '../vendor/min2phase.js'
import { applyMove, createSolvedCube, faceMove, isSolved, moveToNotation } from './model'
import type { Axis, Face, Layer, Move } from './model'
import { cubeToFacelets } from './solver'

const TABLES = Uint8Array.from(readFileSync(new URL('../vendor/min2phase-tables.bin', import.meta.url)))
const FACES: Face[] = ['U', 'R', 'F', 'D', 'L', 'B']

function stateAfter(moves: readonly Move[]) {
  return moves.reduce(applyMove, createSolvedCube())
}

function deterministicMoves(length: number, seed: number, middle = false): Move[] {
  let state = seed >>> 0
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x1_0000_0000
  }
  const result: Move[] = []
  for (let index = 0; index < length; index += 1) {
    const axes = (['x', 'y', 'z'] as Axis[]).filter((axis) => axis !== result.at(-1)?.axis)
    const layers: Layer[] = middle ? [-1, 0, 1] : [-1, 1]
    result.push({
      axis: axes[Math.floor(random() * axes.length)],
      layer: layers[Math.floor(random() * layers.length)],
      turns: ([-1, 1, 2] as const)[Math.floor(random() * 3)],
    })
  }
  return result
}

function installTableFetch() {
  const fetcher = vi.fn(async (_url: unknown, options?: RequestInit) => {
    options?.signal?.throwIfAborted()
    return new Response(TABLES.slice().buffer)
  })
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}

async function freshSolver() {
  vi.resetModules()
  return import('./solver')
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('面の向きと中心色', () => {
  it('完成状態を URFDLB の 54 面へ変換する', () => {
    expect(cubeToFacelets(createSolvedCube())).toBe(FACES.map((face) => face.repeat(9)).join(''))
  })

  it.each(FACES)('%s 面の正転・逆転・半回転が元ライブラリの座標と一致する', (face) => {
    for (const turns of [-1, 1, 2] as const) {
      const move = { ...faceMove(face), turns }
      expect(cubeToFacelets(stateAfter([move]))).toBe(min2phase.fromScramble(moveToNotation(move)))
    }
  })

  it('複数の外層回転も元ライブラリの facelet と一致する', () => {
    const moves = deterministicMoves(80, 432)
    expect(cubeToFacelets(stateAfter(moves))).toBe(min2phase.fromScramble(moves.map(moveToNotation).join(' ')))
  })
})

describe('実ソルバーの候補', () => {
  it.each([1, 7, 81])('seed %i の 80 手から、有効な 21 手以下の候補を逐次返す', async (seed) => {
    installTableFetch()
    const { solveCube } = await freshSolver()
    const cube = stateAfter(deterministicMoves(80, seed))
    const candidates: Move[][] = []
    await solveCube(cube, { timeoutMs: 200, maxMoves: 21, onCandidate: (moves) => candidates.push(moves) })
    expect(candidates.length).toBeGreaterThan(0)
    candidates.forEach((moves, index) => {
      expect(moves.length).toBeLessThanOrEqual(21)
      if (index > 0) expect(moves.length).toBeLessThan(candidates[index - 1].length)
      expect(isSolved(moves.reduce(applyMove, cube))).toBe(true)
    })
  })

  it('中央層を含む状態を、本体の向きを変えても完成させる', async () => {
    installTableFetch()
    const { solveCube } = await freshSolver()
    const rotation = ([-1, 0, 1] as Layer[]).map((layer): Move => ({ axis: 'z', layer, turns: 1 }))
    const cube = stateAfter([...deterministicMoves(80, 987, true), ...rotation])
    const candidates: Move[][] = []
    await solveCube(cube, { timeoutMs: 250, maxMoves: 21, onCandidate: (moves) => candidates.push(moves) })
    expect(candidates.length).toBeGreaterThan(0)
    for (const moves of candidates) expect(isSolved(moves.reduce(applyMove, cube))).toBe(true)
  })

  it('1 手の中央層と 2 手の状態は、表を読まずに短い候補を返す', async () => {
    const fetcher = installTableFetch()
    const { solveCube } = await freshSolver()
    for (const initial of [
      [{ axis: 'x', layer: 0, turns: 1 }] satisfies Move[],
      [faceMove('F'), { axis: 'y', layer: 0, turns: 2 }] satisfies Move[],
    ]) {
      const cube = stateAfter(initial)
      const candidates: Move[][] = []
      const result = await solveCube(cube, { timeoutMs: 1000, maxMoves: 2, onCandidate: (moves) => candidates.push(moves) })
      expect(result.reason).toBe('complete')
      expect(candidates).toHaveLength(1)
      expect(candidates[0].length).toBeLessThanOrEqual(2)
      expect(isSolved(candidates[0].reduce(applyMove, cube))).toBe(true)
    }
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('既知の手順より短い上限が 0 なら探索も通信も行わない', async () => {
    const fetcher = installTableFetch()
    const { solveCube } = await freshSolver()
    const onCandidate = vi.fn()
    const result = await solveCube(stateAfter([faceMove('R')]), { timeoutMs: 1000, maxMoves: 0, onCandidate })
    expect(result.reason).toBe('complete')
    expect(onCandidate).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('読み込んだ探索表を次の要求でも使う', async () => {
    const fetcher = installTableFetch()
    const { solveCube } = await freshSolver()
    const cube = stateAfter([faceMove('R'), faceMove('U'), faceMove('F')])
    for (let index = 0; index < 2; index += 1) {
      const candidates: Move[][] = []
      await solveCube(cube, { timeoutMs: 300, maxMoves: 3, onCandidate: (moves) => candidates.push(moves) })
      expect(candidates).toHaveLength(1)
      expect(candidates[0]).toHaveLength(3)
    }
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('候補を実適用して完成しなければ公開しない', async () => {
    installTableFetch()
    const { solveCube } = await freshSolver()
    const vendor = (await import('../vendor/min2phase.js')).default
    vi.spyOn(vendor.Search.prototype, 'solution').mockReturnValue('R')
    const onCandidate = vi.fn()
    await expect(solveCube(stateAfter([faceMove('R'), faceMove('U')]), {
      timeoutMs: 1000, maxMoves: 21, onCandidate,
    })).rejects.toThrow('探索結果がキューブを完成させることを確認できませんでした。')
    expect(onCandidate).not.toHaveBeenCalled()
  })
})

describe('期限とキャンセル', () => {
  it('表の読込中も期限が進み、fetch を中断する', async () => {
    const { solveCube } = await freshSolver()
    let receivedSignal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn((_url: unknown, options?: RequestInit) => new Promise((_resolve, reject) => {
      receivedSignal = options?.signal ?? undefined
      receivedSignal?.addEventListener('abort', () => reject(new DOMException('中断', 'AbortError')), { once: true })
    })))
    const started = performance.now()
    const result = await solveCube(stateAfter(deterministicMoves(80, 7)), {
      timeoutMs: 25, maxMoves: 21, onCandidate: vi.fn(),
    })
    expect(result.reason).toBe('timeout')
    expect(receivedSignal?.aborted).toBe(true)
    expect(performance.now() - started).toBeLessThan(250)
  })

  it('解がない深さ上限でも、再帰中の時計で指定時間内に打ち切る', async () => {
    installTableFetch()
    const { solveCube } = await freshSolver()
    const started = performance.now()
    const onCandidate = vi.fn()
    const result = await solveCube(stateAfter(deterministicMoves(80, 999)), {
      timeoutMs: 30, maxMoves: 12, onCandidate,
    })
    expect(result.reason).toBe('timeout')
    expect(onCandidate).not.toHaveBeenCalled()
    expect(performance.now() - started).toBeLessThan(250)
  })

  it('探索中の外部キャンセルを受け付け、残り時間の探索を続けない', async () => {
    installTableFetch()
    const { solveCube } = await freshSolver()
    const controller = new AbortController()
    const cube = stateAfter(deterministicMoves(80, 28))
    const started = performance.now()
    const timer = setTimeout(() => controller.abort(), 35)
    try {
      const result = await solveCube(cube, {
        timeoutMs: 1000, maxMoves: 21, signal: controller.signal, onCandidate: vi.fn(),
      })
      expect(result.reason).toBe('cancelled')
      expect(performance.now() - started).toBeLessThan(300)
    } finally {
      clearTimeout(timer)
    }
  })

  it('開始前にキャンセルされた要求は候補も通信も返さない', async () => {
    const fetcher = installTableFetch()
    const { solveCube } = await freshSolver()
    const controller = new AbortController()
    controller.abort()
    const onCandidate = vi.fn()
    const result = await solveCube(stateAfter(deterministicMoves(80, 3)), {
      timeoutMs: 1000, maxMoves: 21, signal: controller.signal, onCandidate,
    })
    expect(result.reason).toBe('cancelled')
    expect(onCandidate).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('候補公開時に中断されたら次の候補を探索しない', async () => {
    installTableFetch()
    const { solveCube } = await freshSolver()
    const controller = new AbortController()
    const onCandidate = vi.fn(() => controller.abort())
    const result = await solveCube(stateAfter(deterministicMoves(80, 19)), {
      timeoutMs: 1000, maxMoves: 21, signal: controller.signal, onCandidate,
    })
    expect(result.reason).toBe('cancelled')
    expect(onCandidate).toHaveBeenCalledTimes(1)
  })
})
