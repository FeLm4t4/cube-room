import type { Cubie, Move } from './model'
import type { SolutionRequest, SolutionResponse } from './searchProtocol'

export interface SearchWorker {
  onmessage: ((event: MessageEvent<SolutionResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage: (message: SolutionRequest) => void
  terminate: () => void
}

export class SolutionSearchClient {
  private worker: SearchWorker | null = null
  private serial = 0
  private active: number | null = null
  private deadline: ReturnType<typeof setTimeout> | undefined

  constructor(
    private createWorker: () => SearchWorker,
    private onCandidate: (moves: Move[]) => void,
    private onWorking: (working: boolean) => void,
  ) {}

  start(cube: readonly Cubie[], moves: Move[], timeoutMs: number) {
    this.cancel()
    const id = ++this.serial
    try {
      if (!this.worker) {
        this.worker = this.createWorker()
        this.worker.onmessage = (event) => {
          const response = event.data
          // 古い候補だけでなく、古い完了通知でも現在の探索を変更しない。
          if (response.id !== this.active) return
          if (response.type === 'candidate') this.onCandidate(response.moves)
          else {
            this.active = null
            clearTimeout(this.deadline)
            this.deadline = undefined
            this.onWorking(false)
          }
        }
        const currentWorker = this.worker
        this.worker.onerror = (event) => {
          event.preventDefault()
          if (this.worker !== currentWorker) return
          this.dispose()
        }
      }
      this.active = id
      this.onWorking(true)
      // 初回の読み込みを含めた上限。同期探索が長引いた場合も確実に止める。
      this.deadline = setTimeout(() => {
        if (this.active === id) this.cancel()
      }, timeoutMs)
      this.worker.postMessage({ type: 'solve', id, cube, moves, timeoutMs })
    } catch {
      this.dispose()
    }
  }

  cancel() {
    clearTimeout(this.deadline)
    this.deadline = undefined
    if (this.active !== null) {
      this.active = null
      // 停止通知を受信できない同期処理も終了する。探索表は静的ファイルから再利用する。
      this.worker?.terminate()
      this.worker = null
    }
    this.onWorking(false)
  }

  dispose() {
    this.cancel()
    this.worker?.terminate()
    this.worker = null
  }
}
