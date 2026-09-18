import { shortenSolution } from './solution'
import { solveCube } from './solver'
import type { SolutionRequest, SolutionResponse } from './searchProtocol'
export type { SolutionRequest, SolutionResponse } from './searchProtocol'

let current: { id: number; controller: AbortController } | null = null

function send(message: SolutionResponse) {
  self.postMessage(message)
}

self.onmessage = (event: MessageEvent<SolutionRequest>) => {
  const request = event.data
  if (request.type === 'cancel') {
    if (current?.id === request.id) current.controller.abort()
    return
  }
  current?.controller.abort()
  const job = { id: request.id, controller: new AbortController() }
  current = job
  const startedAt = performance.now()

  void (async () => {
    let best = request.moves
    const accept = (candidate: typeof best) => {
      if (current !== job || job.controller.signal.aborted || candidate.length >= best.length) return
      best = candidate
      send({ type: 'candidate', id: job.id, moves: candidate })
    }
    try {
      accept(shortenSolution(best))
      const result = best.length < 2 ? { reason: 'complete' as const } : await solveCube(request.cube, {
        timeoutMs: Math.max(0, request.timeoutMs - (performance.now() - startedAt)),
        maxMoves: Math.min(21, best.length - 1),
        signal: job.controller.signal,
        onCandidate: accept,
      })
      if (current === job) send({ type: 'done', id: job.id, reason: result.reason })
    } catch (error) {
      // 失敗しても画面にある有効な解法を残し、古い結果を新しい状態へ適用しない。
      if (current === job) send({ type: 'done', id: job.id, reason: 'error', error: error instanceof Error ? error.message : String(error) })
    } finally {
      if (current === job) current = null
    }
  })()
}
