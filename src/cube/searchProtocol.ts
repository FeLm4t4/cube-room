import type { Cubie, Move } from './model'

export type SearchSeconds = 1 | 5 | 10

export type SolutionRequest = {
  type: 'solve'
  id: number
  cube: readonly Cubie[]
  moves: Move[]
  timeoutMs: number
} | { type: 'cancel'; id: number }

export type SolutionResponse = {
  type: 'candidate'
  id: number
  moves: Move[]
} | {
  type: 'done'
  id: number
  reason: 'complete' | 'timeout' | 'cancelled' | 'error'
  error?: string
}
