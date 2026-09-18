declare class Search {
  solution(facelets: string, maxDepth: number, probeMax: number, probeMin: number, verbose: number): string
  next(probeMax: number, probeMin: number, verbose: number): string
  setControl(shouldStop: () => boolean, sliceUntil: number): void
}

declare const min2phase: {
  Search: typeof Search
  loadTables(buffer: ArrayBuffer): void
  fromScramble(scramble: string): string
}

export default min2phase
