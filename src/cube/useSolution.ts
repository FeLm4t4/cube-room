import { useCallback, useEffect, useRef, useState } from 'react'
import type { Cubie, Move } from './model'
import { advanceSolution } from './solution'
import { SolutionSearchClient } from './searchClient'
import type { SearchSeconds } from './searchProtocol'

export function useSolution(
  enabled: boolean,
  canAccept: () => boolean,
  getCube: () => readonly Cubie[] | undefined,
  searchSeconds: SearchSeconds,
) {
  const movesRef = useRef<Move[]>([])
  const clientRef = useRef<SolutionSearchClient | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const enabledRef = useRef(enabled)
  const acceptRef = useRef(canAccept)
  const getCubeRef = useRef(getCube)
  const interactingRef = useRef(false)
  const [moves, setMoves] = useState<Move[]>([])
  const [revision, setRevision] = useState(0)
  const [pageVisible, setPageVisible] = useState(!document.hidden)
  const [optimizing, setOptimizing] = useState(false)
  const optimizingRef = useRef(false)
  enabledRef.current = enabled
  acceptRef.current = canAccept
  getCubeRef.current = getCube

  const updateOptimizing = useCallback((next: boolean) => {
    if (optimizingRef.current === next) return
    optimizingRef.current = next
    setOptimizing(next)
  }, [])

  const interrupt = useCallback(() => {
    clearTimeout(timerRef.current)
    timerRef.current = undefined
    clientRef.current?.cancel()
  }, [])

  const replace = useCallback((next: Move[]) => {
    interrupt()
    movesRef.current = next
    setMoves(next)
    setRevision((previous) => previous + 1)
    return next
  }, [interrupt])

  const apply = useCallback((move: Move, solved: boolean) => {
    return replace(solved ? [] : advanceSolution(movesRef.current, move))
  }, [replace])
  const reset = useCallback(() => replace([]), [replace])

  const setInteractionActive = useCallback((active: boolean) => {
    if (interactingRef.current === active) return
    interactingRef.current = active
    interrupt()
    // 回転を取り消した場合や、押してすぐ離した場合にも停止後の探索を再開する。
    setRevision((previous) => previous + 1)
  }, [interrupt])

  useEffect(() => {
    const client = new SolutionSearchClient(
      () => new Worker(new URL('./solution.worker.ts', import.meta.url), { type: 'module' }),
      (candidate) => {
        if (!enabledRef.current || interactingRef.current || document.hidden || !acceptRef.current()) return
        if (candidate.length >= movesRef.current.length) return
        // 改善解の受け取りでは探索の世代を進めず、最初に設定した期限を保つ。
        movesRef.current = candidate
        setMoves(candidate)
      },
      updateOptimizing,
    )
    clientRef.current = client
    return () => {
      clearTimeout(timerRef.current)
      client.dispose()
      clientRef.current = null
    }
  }, [updateOptimizing])

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden) interrupt()
      setPageVisible(!document.hidden)
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [interrupt])

  useEffect(() => {
    interrupt()
    if (!enabled || !pageVisible || interactingRef.current || movesRef.current.length < 2) return
    timerRef.current = setTimeout(() => {
      timerRef.current = undefined
      if (!enabledRef.current || interactingRef.current || document.hidden || !acceptRef.current()) return
      const cube = getCubeRef.current()
      if (!cube) return
      clientRef.current?.start(cube, movesRef.current, searchSeconds * 1000)
    }, 300)
    return interrupt
  }, [enabled, revision, pageVisible, searchSeconds, interrupt])

  return { moves, movesRef, optimizing, apply, reset, interrupt, setInteractionActive }
}
