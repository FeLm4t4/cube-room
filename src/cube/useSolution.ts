import { useCallback, useEffect, useRef, useState } from 'react'
import type { Move } from './model'
import { advanceSolution } from './solution'

interface SolutionMessage {
  id: number
  moves: Move[]
  error?: string
}

export function useSolution(enabled: boolean, canAccept: () => boolean) {
  const movesRef = useRef<Move[]>([])
  const versionRef = useRef(0)
  const workerRef = useRef<Worker | null>(null)
  const inFlightRef = useRef(false)
  const pendingRef = useRef<SolutionMessage | null>(null)
  const enabledRef = useRef(enabled)
  const acceptRef = useRef(canAccept)
  const [moves, setMoves] = useState<Move[]>([])
  const [optimizing, setOptimizing] = useState(false)
  const optimizingRef = useRef(false)
  enabledRef.current = enabled
  acceptRef.current = canAccept

  const updateOptimizing = useCallback((next: boolean) => {
    if (optimizingRef.current === next) return
    optimizingRef.current = next
    setOptimizing(next)
  }, [])

  const replace = useCallback((next: Move[]) => {
    versionRef.current += 1
    pendingRef.current = null
    movesRef.current = next
    setMoves(next)
    return next
  }, [])

  const apply = useCallback((move: Move, solved: boolean) => {
    return replace(solved ? [] : advanceSolution(movesRef.current, move))
  }, [replace])
  const reset = useCallback(() => replace([]), [replace])

  useEffect(() => {
    let worker: Worker
    try {
      worker = new Worker(new URL('./solution.worker.ts', import.meta.url), { type: 'module' })
    } catch {
      // Workerを使えない環境でも、逆手順と回転の合成はそのまま使える。
      return
    }
    workerRef.current = worker
    worker.onmessage = (event: MessageEvent<SolutionMessage>) => {
      inFlightRef.current = false
      const result = event.data
      if (!result.error && result.id === versionRef.current && enabledRef.current && acceptRef.current()
        && result.moves.length < movesRef.current.length) {
        replace(result.moves)
      }
      const pending = pendingRef.current
      pendingRef.current = null
      if (pending && pending.id === versionRef.current && enabledRef.current && acceptRef.current()) {
        inFlightRef.current = true
        updateOptimizing(true)
        worker.postMessage(pending)
      } else {
        updateOptimizing(false)
      }
    }
    worker.onerror = (event) => {
      event.preventDefault()
      worker.terminate()
      workerRef.current = null
      inFlightRef.current = false
      pendingRef.current = null
      updateOptimizing(false)
    }
    return () => {
      worker.terminate()
      workerRef.current = null
      inFlightRef.current = false
      pendingRef.current = null
    }
  }, [replace, updateOptimizing])

  useEffect(() => {
    if (!enabled || moves.length < 4 || !workerRef.current) {
      pendingRef.current = null
      updateOptimizing(false)
      return
    }
    updateOptimizing(true)
    const request = { id: versionRef.current, moves }
    const timer = window.setTimeout(() => {
      if (request.id !== versionRef.current || !acceptRef.current()) return
      updateOptimizing(true)
      if (inFlightRef.current) pendingRef.current = request
      else {
        inFlightRef.current = true
        workerRef.current?.postMessage(request)
      }
    }, 300)
    return () => window.clearTimeout(timer)
  }, [enabled, moves, updateOptimizing])

  return { moves, movesRef, optimizing, apply, reset }
}
