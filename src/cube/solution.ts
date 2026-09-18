import { applyMove, createSolvedCube, inverseMove } from './model'
import type { Axis, Layer, Move, Vec3 } from './model'

const AXES: readonly Axis[] = ['x', 'y', 'z']
const LAYERS: readonly Layer[] = [-1, 0, 1]
const ALL_MOVES: readonly Move[] = AXES.flatMap((axis) =>
  LAYERS.flatMap((layer) => ([-1, 1, 2] as const).map((turns) => ({ axis, layer, turns }))),
)

const DICTIONARY_DEPTH = 3
const MAX_WINDOW = 96
const MAX_PASSES = 4
const MAX_INTERVALS = 32_000
const STICKER_COUNT = 54

type Permutation = Uint8Array
type AxisBlock = { axis: Axis; turns: [number, number, number] }
type Dictionary = { paths: Map<string, number>; movePermutations: readonly Permutation[] }

let cachedDictionary: Dictionary | undefined

export function invertMoves(moves: readonly Move[]): Move[] {
  return [...moves].reverse().map(inverseMove)
}

export function simplifyMoves(moves: readonly Move[]): Move[] {
  const blocks: AxisBlock[] = []

  for (const move of moves) {
    let block = blocks[blocks.length - 1]
    if (!block || block.axis !== move.axis) {
      block = { axis: move.axis, turns: [0, 0, 0] }
      blocks.push(block)
    }

    const layer = move.layer + 1
    block.turns[layer] = (block.turns[layer] + move.turns + 4) % 4
    if (block.turns.every((turns) => turns === 0)) blocks.pop()
  }

  // 同じ軸の平行な層は交換できる。順番をそろえると隣接する相殺も検出できる。
  return blocks.flatMap((block) => LAYERS.flatMap((layer): Move[] => {
    const turns = block.turns[layer + 1]
    return turns === 0 ? [] : [{ axis: block.axis, layer, turns: turns === 3 ? -1 : turns as 1 | 2 }]
  }))
}

export function advanceSolution(solution: readonly Move[], actualMove: Move): Move[] {
  return simplifyMoves([inverseMove(actualMove), ...solution])
}

function identityPermutation(): Permutation {
  return Uint8Array.from({ length: STICKER_COUNT }, (_, index) => index)
}

function slotKey(position: Vec3, normal: Vec3) {
  return `${position.join(',')}|${normal.join(',')}`
}

function createMovePermutations(): Permutation[] {
  const solved = createSolvedCube()
  const slots = solved.flatMap((cubie) => cubie.stickers.map((sticker) => slotKey(cubie.position, sticker.normal)))
  const indices = new Map(slots.map((slot, index) => [slot, index]))

  return ALL_MOVES.map((move) => {
    const movedSlots = applyMove(solved, move).flatMap((cubie) =>
      cubie.stickers.map((sticker) => slotKey(cubie.position, sticker.normal)),
    )
    return Uint8Array.from(movedSlots, (slot) => indices.get(slot)!)
  })
}

function appendPermutation(permutation: Permutation, next: Permutation) {
  for (let index = 0; index < STICKER_COUNT; index += 1) {
    permutation[index] = next[permutation[index]]
  }
}

function permutationKey(permutation: Permutation) {
  // 全ステッカーを別々の識別子として保存する完全な置換キー。色の一致とは区別する。
  return String.fromCharCode(...permutation)
}

function moveIndex(move: Move) {
  const axis = move.axis === 'x' ? 0 : move.axis === 'y' ? 1 : 2
  const turns = move.turns === -1 ? 0 : move.turns === 1 ? 1 : 2
  return axis * 9 + (move.layer + 1) * 3 + turns
}

function pathLength(path: number) {
  let length = 0
  for (let rest = path; rest > 0; rest >>>= 5) length += 1
  return length
}

function decodePath(path: number): Move[] {
  const moves: Move[] = []
  for (let rest = path; rest > 0; rest >>>= 5) {
    moves.push({ ...ALL_MOVES[(rest & 31) - 1] })
  }
  return moves.reverse()
}

function dictionary(): Dictionary {
  if (cachedDictionary) return cachedDictionary

  const movePermutations = createMovePermutations()
  const paths = new Map<string, number>()

  function visit(permutation: Permutation, path: number, depth: number, previous?: Move) {
    const key = permutationKey(permutation)
    const existing = paths.get(key)
    // 各手を 5 bit で詰める。数値が小さい経路は手数も同じか少ない。
    if (existing === undefined || path < existing) paths.set(key, path)
    if (depth === DICTIONARY_DEPTH) return

    for (let index = 0; index < ALL_MOVES.length; index += 1) {
      const move = ALL_MOVES[index]
      if (previous?.axis === move.axis && previous.layer >= move.layer) continue

      const next = permutation.slice()
      appendPermutation(next, movePermutations[index])
      visit(next, (path << 5) | (index + 1), depth + 1, move)
    }
  }

  visit(identityPermutation(), 0, 0)
  cachedDictionary = { paths, movePermutations }
  return cachedDictionary
}

function rewriteIntervals(moves: readonly Move[], table: Dictionary, budget: { remaining: number }): Move[] {
  const costs = new Uint32Array(moves.length + 1)
  const ends = new Uint32Array(moves.length)
  const replacements = new Uint32Array(moves.length)

  // 元の一手か、同じ完全置換を持つ短い区間かを選び、全体の手数を DP で比較する。
  for (let start = moves.length - 1; start >= 0; start -= 1) {
    costs[start] = 1 + costs[start + 1]
    ends[start] = start + 1
    replacements[start] = moveIndex(moves[start]) + 1
    const permutation = identityPermutation()
    const endLimit = Math.min(moves.length, start + MAX_WINDOW)

    for (let end = start; end < endLimit && budget.remaining > 0; end += 1) {
      appendPermutation(permutation, table.movePermutations[moveIndex(moves[end])])
      budget.remaining -= 1
      const replacement = table.paths.get(permutationKey(permutation))
      if (replacement === undefined) continue

      const cost = pathLength(replacement) + costs[end + 1]
      if (cost < costs[start]) {
        costs[start] = cost
        ends[start] = end + 1
        replacements[start] = replacement
      }
    }
  }

  const result: Move[] = []
  for (let start = 0; start < moves.length; start = ends[start]) {
    result.push(...decodePath(replacements[start]))
  }
  return result
}

export function shortenSolution(moves: readonly Move[]): Move[] {
  let result = simplifyMoves(moves)
  if (result.length <= 3) return result

  const table = dictionary()
  const budget = { remaining: MAX_INTERVALS }

  // 最短解の探索ではなく、同じ変換への置換だけを行う。探索量と反復回数を固定する。
  for (let pass = 0; pass < MAX_PASSES && budget.remaining > 0; pass += 1) {
    const next = simplifyMoves(rewriteIntervals(result, table, budget))
    if (next.length >= result.length) break
    result = next
    if (result.length <= 3) break
  }

  return result
}
