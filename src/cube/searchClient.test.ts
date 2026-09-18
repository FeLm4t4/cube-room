import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSolvedCube, faceMove } from './model'
import { SolutionSearchClient, type SearchWorker } from './searchClient'
import type { SolutionRequest, SolutionResponse } from './searchProtocol'

class FakeWorker implements SearchWorker {
  onmessage: SearchWorker['onmessage'] = null
  onerror: SearchWorker['onerror'] = null
  postMessage = vi.fn<(message: SolutionRequest) => void>()
  terminate = vi.fn()
  emit(response: SolutionResponse) { this.onmessage?.({ data: response } as MessageEvent<SolutionResponse>) }
}

function setup() {
  const workers: FakeWorker[] = []
  const candidate = vi.fn()
  const working = vi.fn()
  const client = new SolutionSearchClient(() => {
    const worker = new FakeWorker()
    workers.push(worker)
    return worker
  }, candidate, working)
  return { workers, candidate, working, client }
}

afterEach(() => vi.useRealTimers())

describe('探索の時間制限と割り込み', () => {
  it.each([1000, 5000, 10000])('%i ms の期限は途中で改善解が届いても延長しない', (timeoutMs) => {
    vi.useFakeTimers()
    const { client, workers, candidate, working } = setup()
    client.start(createSolvedCube(), [faceMove('R'), faceMove('U')], timeoutMs)
    const worker = workers[0]
    expect(worker.postMessage.mock.calls[0][0]).toMatchObject({ id: 1, timeoutMs })
    vi.advanceTimersByTime(timeoutMs - 1)
    worker.emit({ type: 'candidate', id: 1, moves: [faceMove('R')] })
    expect(candidate).toHaveBeenCalledOnce()
    expect(worker.terminate).not.toHaveBeenCalled()
    expect(working).toHaveBeenLastCalledWith(true)
    vi.advanceTimersByTime(1)
    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(working).toHaveBeenLastCalledWith(false)
    worker.emit({ type: 'candidate', id: 1, moves: [] })
    expect(candidate).toHaveBeenCalledOnce()
  })

  it('新しい操作で実行中の Worker を終了し、古い候補・完了・エラーを無視する', () => {
    vi.useFakeTimers()
    const { client, workers, candidate, working } = setup()
    client.start(createSolvedCube(), [faceMove('R')], 10000)
    client.cancel()
    expect(workers[0].terminate).toHaveBeenCalledOnce()
    client.start(createSolvedCube(), [faceMove('U')], 5000)
    workers[0].emit({ type: 'candidate', id: 1, moves: [] })
    workers[0].emit({ type: 'done', id: 1, reason: 'complete' })
    workers[0].emit({ type: 'done', id: 1, reason: 'error', error: '古いエラー' })
    workers[0].onerror?.({ preventDefault() {} } as ErrorEvent)
    expect(candidate).not.toHaveBeenCalled()
    expect(working).toHaveBeenLastCalledWith(true)
    expect(workers[1].terminate).not.toHaveBeenCalled()
    workers[1].emit({ type: 'candidate', id: 2, moves: [faceMove('U')] })
    expect(candidate).toHaveBeenLastCalledWith([faceMove('U')])
    vi.advanceTimersByTime(5000)
    expect(workers[1].terminate).toHaveBeenCalledOnce()
  })

  it('早く探索し終えた Worker は再利用し、前の期限で次の探索を止めない', () => {
    vi.useFakeTimers()
    const { client, workers, working } = setup()
    client.start(createSolvedCube(), [faceMove('R')], 1000)
    vi.advanceTimersByTime(300)
    workers[0].emit({ type: 'done', id: 1, reason: 'complete' })
    expect(working).toHaveBeenLastCalledWith(false)
    client.start(createSolvedCube(), [faceMove('U')], 5000)
    expect(workers).toHaveLength(1)
    vi.advanceTimersByTime(700)
    expect(workers[0].terminate).not.toHaveBeenCalled()
    expect(working).toHaveBeenLastCalledWith(true)
    client.dispose()
    expect(workers[0].terminate).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('Worker を利用できない場合も探索中表示を残さない', () => {
    const candidate = vi.fn()
    const working = vi.fn()
    const client = new SolutionSearchClient(() => { throw new Error('Worker unavailable') }, candidate, working)
    expect(() => client.start(createSolvedCube(), [faceMove('R')], 1000)).not.toThrow()
    expect(candidate).not.toHaveBeenCalled()
    expect(working).toHaveBeenLastCalledWith(false)
  })
})
