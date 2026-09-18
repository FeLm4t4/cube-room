import { describe, expect, it } from 'vitest'
import {
  applyMove,
  createScramble,
  createSolvedCube,
  faceMove,
  inverseMove,
  isSolved,
  moveToNotation,
  type Axis,
  type Face,
  type Layer,
  type Move,
} from './model'

const FACES: Face[] = ['U', 'D', 'F', 'B', 'R', 'L']
const AXES: Axis[] = ['x', 'y', 'z']
const LAYERS: Layer[] = [-1, 0, 1]

describe('キューブの構造', () => {
  it('26 個の小片に各色 9 枚、合計 54 枚のステッカーを持つ', () => {
    const cube = createSolvedCube()
    const stickers = cube.flatMap((cubie) => cubie.stickers)

    expect(cube).toHaveLength(26)
    expect(new Set(cube.map((cubie) => cubie.id)).size).toBe(26)
    expect(stickers).toHaveLength(54)
    for (const face of FACES) {
      expect(stickers.filter((sticker) => sticker.color === face)).toHaveLength(9)
    }
    expect(isSolved(cube)).toBe(true)
  })

  it('R は右面の外側から見て時計回りに座標とステッカーを動かす', () => {
    const cube = createSolvedCube()
    const before = JSON.stringify(cube)
    const next = applyMove(cube, faceMove('R'))
    const corner = next.find((cubie) => cubie.id === '1,1,1')!

    expect(corner.position).toEqual([1, 1, -1])
    expect(corner.stickers.find((sticker) => sticker.color === 'U')?.normal).toEqual([0, 0, -1])
    expect(corner.stickers.find((sticker) => sticker.color === 'F')?.normal).toEqual([0, 1, 0])
    expect(next.filter((cubie) => cubie.position[0] !== 1)).toEqual(
      cube.filter((cubie) => cubie.position[0] !== 1),
    )
    expect(JSON.stringify(cube)).toBe(before)
  })
})

describe('回転の可逆性', () => {
  it.each(FACES)('%s を 4 回回すと完全に元へ戻る', (face) => {
    const original = createSolvedCube()
    let cube = original
    for (let index = 0; index < 4; index += 1) cube = applyMove(cube, faceMove(face))
    expect(cube).toEqual(original)
  })

  for (const axis of AXES) {
    for (const layer of LAYERS) {
      it(`${axis} 軸の ${layer} 層は正転・逆転・半回転を取り消せる`, () => {
        const original = createSolvedCube()

        for (const turns of [-1, 1, 2] as const) {
          const move: Move = { axis, layer, turns }
          expect(applyMove(applyMove(original, move), inverseMove(move))).toEqual(original)
        }
      })
    }
  }

  it('長いスクランブルでも座標が崩れず、逆順の逆回転で復元できる', () => {
    const original = createSolvedCube()
    const moves = createScramble(120)
    const scrambled = moves.reduce(applyMove, original)

    expect(new Set(scrambled.map((cubie) => cubie.position.join(','))).size).toBe(26)
    for (const cubie of scrambled) {
      expect(cubie.position.every((value) => [-1, 0, 1].includes(value))).toBe(true)
      for (const sticker of cubie.stickers) {
        expect(sticker.normal.reduce((sum, value) => sum + Math.abs(value), 0)).toBe(1)
        expect(sticker.normal.every(Number.isInteger)).toBe(true)
      }
    }

    const restored = [...moves].reverse().map(inverseMove).reduce(applyMove, scrambled)
    expect(restored).toEqual(original)
  })
})

describe('完成判定', () => {
  it.each(FACES)('%s の回転で未完成となり、戻すと完成となる', (face) => {
    const moved = applyMove(createSolvedCube(), faceMove(face))
    expect(isSolved(moved)).toBe(false)
    expect(isSolved(applyMove(moved, faceMove(face, true)))).toBe(true)
  })

  it('中央層だけの回転は完成と判定しない', () => {
    for (const axis of AXES) {
      expect(isSolved(applyMove(createSolvedCube(), { axis, layer: 0, turns: 1 }))).toBe(false)
    }
  })

  it('本体を任意の軸で持ち替えても完成と判定する', () => {
    let cube = createSolvedCube()

    for (const axis of AXES) {
      for (const turns of [1, -1, 2] as const) {
        for (const layer of LAYERS) cube = applyMove(cube, { axis, layer, turns })
        expect(isSolved(cube)).toBe(true)
      }
    }
  })

  it('小片やステッカーが欠けた状態を完成と判定しない', () => {
    const cube = createSolvedCube()
    expect(isSolved(cube.slice(1))).toBe(false)
    cube[0]!.stickers.pop()
    expect(isSolved(cube)).toBe(false)
  })
})

describe('操作記号とスクランブル', () => {
  it.each(FACES)('%s の通常・逆・半回転を表記する', (face) => {
    const move = faceMove(face)
    expect(moveToNotation(move)).toBe(face)
    expect(moveToNotation(faceMove(face, true))).toBe(`${face}'`)
    expect(moveToNotation({ ...move, turns: 2 })).toBe(`${face}2`)
  })

  it('中央層の M・E・S も慣例の方向で表記する', () => {
    expect(moveToNotation({ axis: 'x', layer: 0, turns: 1 })).toBe('M')
    expect(moveToNotation({ axis: 'y', layer: 0, turns: 1 })).toBe('E')
    expect(moveToNotation({ axis: 'z', layer: 0, turns: -1 })).toBe('S')
  })

  it('指定した手数の外層回転を生成し、同じ軸の連続を避ける', () => {
    const moves = createScramble()
    expect(moves).toHaveLength(20)
    expect(createScramble(0)).toEqual([])

    moves.forEach((move, index) => {
      expect([-1, 1]).toContain(move.layer)
      expect([-1, 1, 2]).toContain(move.turns)
      if (index > 0) expect(move.axis).not.toBe(moves[index - 1]!.axis)
    })
  })

  it('無効な手数を拒否する', () => {
    for (const length of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => createScramble(length)).toThrow(RangeError)
    }
  })
})
