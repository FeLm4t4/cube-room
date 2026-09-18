export type Axis = 'x' | 'y' | 'z'
export type Layer = -1 | 0 | 1
export type Direction = -1 | 1
export type Vec3 = readonly [number, number, number]
export type Face = 'U' | 'D' | 'F' | 'B' | 'R' | 'L'

export interface Sticker {
  normal: Vec3
  color: Face
}

export interface Cubie {
  id: string
  position: Vec3
  stickers: Sticker[]
}

export interface Move {
  axis: Axis
  layer: Layer
  turns: Direction | 2
}

export const AXIS_INDEX = { x: 0, y: 1, z: 2 } as const

const COORDINATES = [-1, 0, 1] as const
const AXES: readonly Axis[] = ['x', 'y', 'z']
const FACE_MOVES: Record<Face, Move> = {
  U: { axis: 'y', layer: 1, turns: -1 },
  D: { axis: 'y', layer: -1, turns: 1 },
  F: { axis: 'z', layer: 1, turns: -1 },
  B: { axis: 'z', layer: -1, turns: 1 },
  R: { axis: 'x', layer: 1, turns: -1 },
  L: { axis: 'x', layer: -1, turns: 1 },
}

const NOTATION: Record<Axis, Record<Layer, { face: string; clockwise: Direction }>> = {
  x: {
    [-1]: { face: 'L', clockwise: 1 },
    0: { face: 'M', clockwise: 1 },
    1: { face: 'R', clockwise: -1 },
  },
  y: {
    [-1]: { face: 'D', clockwise: 1 },
    0: { face: 'E', clockwise: 1 },
    1: { face: 'U', clockwise: -1 },
  },
  z: {
    [-1]: { face: 'B', clockwise: 1 },
    0: { face: 'S', clockwise: -1 },
    1: { face: 'F', clockwise: -1 },
  },
}

export function createSolvedCube(): Cubie[] {
  const cube: Cubie[] = []

  for (const x of COORDINATES) {
    for (const y of COORDINATES) {
      for (const z of COORDINATES) {
        if (x === 0 && y === 0 && z === 0) continue

        const stickers: Sticker[] = []
        if (x === 1) stickers.push({ normal: [1, 0, 0], color: 'R' })
        if (x === -1) stickers.push({ normal: [-1, 0, 0], color: 'L' })
        if (y === 1) stickers.push({ normal: [0, 1, 0], color: 'U' })
        if (y === -1) stickers.push({ normal: [0, -1, 0], color: 'D' })
        if (z === 1) stickers.push({ normal: [0, 0, 1], color: 'F' })
        if (z === -1) stickers.push({ normal: [0, 0, -1], color: 'B' })

        cube.push({ id: `${x},${y},${z}`, position: [x, y, z], stickers })
      }
    }
  }

  return cube
}

// 座標を整数のまま回し、繰り返し操作による浮動小数点誤差を防ぐ。
export function rotateVector(vector: Vec3, axis: Axis, turns: Direction | 2): Vec3 {
  const [x, y, z] = vector
  let result: Vec3

  if (turns === 2) {
    result = axis === 'x' ? [x, -y, -z] : axis === 'y' ? [-x, y, -z] : [-x, -y, z]
  } else if (axis === 'x') {
    result = [x, -turns * z, turns * y]
  } else if (axis === 'y') {
    result = [turns * z, y, -turns * x]
  } else {
    result = [-turns * y, turns * x, z]
  }

  // -0 を取り除き、保存・比較に使う座標を常に同じ表現にする。
  return [result[0] || 0, result[1] || 0, result[2] || 0]
}

export function applyMove(cube: readonly Cubie[], move: Move): Cubie[] {
  const index = AXIS_INDEX[move.axis]

  return cube.map((cubie) => {
    if (cubie.position[index] !== move.layer) return cubie

    return {
      ...cubie,
      position: rotateVector(cubie.position, move.axis, move.turns),
      stickers: cubie.stickers.map((sticker) => ({
        ...sticker,
        normal: rotateVector(sticker.normal, move.axis, move.turns),
      })),
    }
  })
}

export function inverseMove(move: Move): Move {
  return { ...move, turns: move.turns === 2 ? 2 : move.turns === 1 ? -1 : 1 }
}

export function faceMove(face: Face, inverse = false): Move {
  const move = { ...FACE_MOVES[face] }
  return inverse ? inverseMove(move) : move
}

export function moveToNotation(move: Move): string {
  const { face, clockwise } = NOTATION[move.axis][move.layer]
  return `${face}${move.turns === 2 ? '2' : move.turns === clockwise ? '' : "'"}`
}

export function isSolved(cube: readonly Cubie[]): boolean {
  if (cube.length !== 26) return false

  const faces = new Map<string, { color: Face; count: number }>()

  for (const cubie of cube) {
    for (const sticker of cubie.stickers) {
      const key = sticker.normal.join(',')
      const face = faces.get(key)

      if (face && face.color !== sticker.color) return false
      faces.set(key, { color: sticker.color, count: (face?.count ?? 0) + 1 })
    }
  }

  // 色の初期位置ではなく面ごとの一致を調べ、本体を持ち替えても完成とする。
  return faces.size === 6 && [...faces.values()].every((face) => face.count === 9)
}

export function createScramble(length = 20): Move[] {
  if (!Number.isInteger(length) || length < 0) {
    throw new RangeError('スクランブルの長さは 0 以上の整数にしてください。')
  }

  const moves: Move[] = []
  let previousAxis: Axis | undefined

  for (let index = 0; index < length; index += 1) {
    const candidates = AXES.filter((axis) => axis !== previousAxis)
    const axis = candidates[Math.floor(Math.random() * candidates.length)]!
    const turns = ([-1, 1, 2] as const)[Math.floor(Math.random() * 3)]!

    moves.push({ axis, layer: Math.random() < 0.5 ? -1 : 1, turns })
    previousAxis = axis
  }

  return moves
}
