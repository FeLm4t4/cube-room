import { shortenSolution } from './solution'
import type { Move } from './model'

export interface SolutionRequest {
  id: number
  moves: Move[]
}

export interface SolutionResponse {
  id: number
  moves: Move[]
  error?: string
}

self.onmessage = (event: MessageEvent<SolutionRequest>) => {
  const { id, moves } = event.data

  try {
    self.postMessage({ id, moves: shortenSolution(moves) } satisfies SolutionResponse)
  } catch (error) {
    // 短縮に失敗しても、元の有効な手順と要求 ID を返して画面の状態を保つ。
    self.postMessage({ id, moves, error: error instanceof Error ? error.message : '手順の短縮に失敗しました。' } satisfies SolutionResponse)
  }
}
