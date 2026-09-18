import { describe, expect, it, vi } from 'vitest'
import { applyMove, createSolvedCube, faceMove, inverseMove, isSolved } from './model'
import type { Axis, Cubie, Layer, Move } from './model'
import { advanceSolution, invertMoves, shortenSolution, simplifyMoves } from './solution'
import * as solutionModule from './solution'
import type { SolutionRequest, SolutionResponse } from './solution.worker'

const R = faceMove('R')
const U = faceMove('U')
const F = faceMove('F')
const R2: Move = { ...R, turns: 2 }
const U2: Move = { ...U, turns: 2 }
const HALF_TURN_LOOP = Array.from({ length: 6 }, () => [R2, U2]).flat()
const NONTRIVIAL_STATE = [
  U, F, R2,
  { axis: 'x', layer: 0, turns: -1 },
  { axis: 'z', layer: 0, turns: 2 },
  faceMove('D', true),
] satisfies Move[]

function apply(moves: readonly Move[], cube: Cubie[] = createSolvedCube()) {
  return moves.reduce(applyMove, cube)
}

function deterministicMoves(length: number, seed: number, middle = true): Move[] {
  let state = seed >>> 0
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x1_0000_0000
  }
  const axes: Axis[] = ['x', 'y', 'z']
  const layers: Layer[] = middle ? [-1, 0, 1] : [-1, 1]
  const turns = [-1, 1, 2] as const
  const result: Move[] = []

  while (result.length < length) {
    const available = axes.filter((axis) => axis !== result.at(-1)?.axis)
    result.push({
      axis: available[Math.floor(random() * available.length)],
      layer: layers[Math.floor(random() * layers.length)],
      turns: turns[Math.floor(random() * turns.length)],
    })
  }
  return result
}

function expectSameTransformation(original: readonly Move[], replacement: readonly Move[]) {
  expect(apply(replacement)).toEqual(apply(original))
  const state = apply(NONTRIVIAL_STATE)
  expect(apply(replacement, state)).toEqual(apply(original, state))
}

describe('逆手順と軽量な合成', () => {
  it('中央層と半回転を含めて逆順の逆手を作り、元の状態に戻す', () => {
    const moves = deterministicMoves(40, 31)
    expect(apply([...moves, ...invertMoves(moves)])).toEqual(createSolvedCube())
    expect(invertMoves([R, U2])).toEqual([U2, inverseMove(R)])
  })

  it('平行な層を交換して相殺し、同じ層の四分の一回転を合成する', () => {
    const L = faceMove('L')
    expect(simplifyMoves([R, L, inverseMove(R)])).toEqual([L])
    expect(simplifyMoves([R, R])).toEqual([R2])
    expect(simplifyMoves([R2, R2])).toEqual([])
    expect(simplifyMoves([R2, inverseMove(R)])).toEqual([R])
  })

  it('相殺で消えた別軸の区間をまたいで、さらに合成する', () => {
    const moves = [R, U, F, inverseMove(F), inverseMove(U), inverseMove(R)]
    expect(simplifyMoves(moves)).toEqual([])
  })

  it('中央層を含む同軸の三層を正確に合成する', () => {
    const moves: Move[] = [
      { axis: 'x', layer: 0, turns: 1 },
      R,
      { axis: 'x', layer: -1, turns: 2 },
      { axis: 'x', layer: 0, turns: 2 },
      inverseMove(R),
      { axis: 'x', layer: 0, turns: 1 },
    ]
    const simplified = simplifyMoves(moves)
    expect(simplified).toEqual([{ axis: 'x', layer: -1, turns: 2 }])
    expectSameTransformation(moves, simplified)
  })

  it('入力の配列と Move オブジェクトを変更しない', () => {
    const moves = Object.freeze([Object.freeze({ ...R }), Object.freeze({ ...U2 })])
    const before = JSON.stringify(moves)
    invertMoves(moves)
    simplifyMoves(moves)
    advanceSolution(moves, F)
    shortenSolution(moves)
    expect(JSON.stringify(moves)).toBe(before)
  })
})

describe('完全な置換の辞書による区間短縮', () => {
  it('単純な合成では消えない 12 手の半回転ループを除く', () => {
    expect(simplifyMoves(HALF_TURN_LOOP)).toHaveLength(12)
    const shortened = shortenSolution(HALF_TURN_LOOP)
    expect(shortened).toEqual([])
    expectSameTransformation(HALF_TURN_LOOP, shortened)
  })

  it('R2 U2 を交互に行う 11 手を U2 の 1 手に短縮する', () => {
    const moves = HALF_TURN_LOOP.slice(0, 11)
    expect(simplifyMoves(moves)).toHaveLength(11)
    const shortened = shortenSolution(moves)
    expect(shortened).toEqual([U2])
    expectSameTransformation(moves, shortened)
  })

  it('長い区間の中にある複数のループを見つける', () => {
    const moves = [F, ...HALF_TURN_LOOP, U, ...HALF_TURN_LOOP, faceMove('B')]
    const shortened = shortenSolution(moves)
    expect(shortened.length).toBeLessThanOrEqual(3)
    expectSameTransformation(moves, shortened)
  })

  it('中央層も動く持ち替えを挟んだ面操作を正しい 1 手に変換する', () => {
    const rotation: Move[] = [-1, 0, 1].map((layer) => ({ axis: 'x', layer: layer as Layer, turns: 1 }))
    const moves = [...rotation, U, ...invertMoves(rotation)]
    const shortened = shortenSolution(moves)
    expect(shortened).toHaveLength(1)
    expectSameTransformation(moves, shortened)
  })

  it('色がそろった本体の持ち替えと、無操作を同じ置換として扱わない', () => {
    const rotation: Move[] = [-1, 0, 1].map((layer) => ({ axis: 'z', layer: layer as Layer, turns: 1 }))
    const moves = [...rotation, ...HALF_TURN_LOOP]
    expect(isSolved(apply(moves))).toBe(true)
    expect(apply(moves)).not.toEqual(createSolvedCube())
    const shortened = shortenSolution(moves)
    expect(shortened).toHaveLength(3)
    expectSameTransformation(moves, shortened)
  })

  it.each([1, 7, 12345, 0xabcdef])('seed %i の 80 手を戻す手順は短縮後も正確に戻る', (seed) => {
    const shuffle = deterministicMoves(80, seed, false)
    const inverse = invertMoves(shuffle)
    const shortened = shortenSolution(inverse)
    expect(shortened.length).toBeLessThanOrEqual(simplifyMoves(inverse).length)
    expect(apply(shortened, apply(shuffle))).toEqual(createSolvedCube())
    expectSameTransformation(inverse, shortened)
  })

  it('中央層を含む 80 手でも、非完成の状態に対する変換を保つ', () => {
    const moves = deterministicMoves(80, 1984)
    const shortened = shortenSolution(moves)
    expect(shortened.length).toBeLessThanOrEqual(moves.length)
    expectSameTransformation(moves, shortened)
  })
})

describe('ユーザーの操作に追従する残り手順', () => {
  it('残り手順の先頭を実行すると、その 1 手を除く', () => {
    expect(advanceSolution([R, U, F], R)).toEqual([U, F])
    expect(advanceSolution([], R)).toEqual([inverseMove(R)])
  })

  it('任意の追加操作と途中の短縮を繰り返しても、同じ完成状態へ戻せる', () => {
    const shuffle = deterministicMoves(80, 443, false)
    let cube = apply(shuffle)
    let solution = shortenSolution(invertMoves(shuffle))
    const userMoves = deterministicMoves(20, 90)

    for (let index = 0; index < userMoves.length; index += 1) {
      const actual = index % 3 === 0 && solution.length > 0 ? solution[0] : userMoves[index]
      cube = applyMove(cube, actual)
      solution = advanceSolution(solution, actual)
      if (index % 4 === 0) solution = shortenSolution(solution)
      expect(apply(solution, cube)).toEqual(createSolvedCube())
    }
  })
})

describe('短縮 Worker の応答', () => {
  it('要求 ID を保ち、失敗した場合は元の手順とエラーを返す', async () => {
    const worker = { onmessage: null as ((event: MessageEvent<SolutionRequest>) => void) | null, postMessage: vi.fn() }
    vi.stubGlobal('self', worker)

    try {
      await import('./solution.worker')
      const request = { id: 42, moves: HALF_TURN_LOOP.slice(0, 11) }
      worker.onmessage!({ data: request } as MessageEvent<SolutionRequest>)
      expect(worker.postMessage).toHaveBeenLastCalledWith({ id: 42, moves: [U2] } satisfies SolutionResponse)

      vi.spyOn(solutionModule, 'shortenSolution').mockImplementationOnce(() => { throw new Error('辞書を利用できません。') })
      worker.onmessage!({ data: request } as MessageEvent<SolutionRequest>)
      expect(worker.postMessage).toHaveBeenLastCalledWith({
        id: 42, moves: request.moves, error: '辞書を利用できません。',
      } satisfies SolutionResponse)
    } finally {
      vi.restoreAllMocks()
      vi.unstubAllGlobals()
    }
  })
})
