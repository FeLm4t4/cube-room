import type { CSSProperties } from 'react'

export type IconName =
  | 'cube'
  | 'arrow-up-right'
  | 'arrow-right'
  | 'shuffle'
  | 'undo'
  | 'reset'
  | 'help'
  | 'close'
  | 'check'
  | 'clock'
  | 'turn'
  | 'orbit'
  | 'mouse'
  | 'github'
  | 'keyboard'
  | 'spark'

type IconProps = {
  name: IconName
  size?: number
  className?: string
  strokeWidth?: number
  style?: CSSProperties
}

export function Icon({ name, size = 20, className, strokeWidth = 1.7, style }: IconProps) {
  const shapes = {
    cube: <><path d="m12 2 8.5 4.9v10.2L12 22l-8.5-4.9V6.9L12 2Z" /><path d="m3.5 6.9 8.5 5 8.5-5M12 12v10M7.75 4.45l8.5 5v10.1M16.25 4.45l-8.5 5v10.1M3.5 12l8.5 5 8.5-5" /></>,
    'arrow-up-right': <><path d="M6 18 18 6M6 6h12v12" /></>,
    'arrow-right': <><path d="M4 12h16m-6-6 6 6-6 6" /></>,
    shuffle: <><path d="M3 6h3c4 0 8 12 12 12h3M3 18h3c1.5 0 3-1.7 4.5-4M14 9c1.5-1.8 2.7-3 4-3h3m-4-4 4 4-4 4m0 4 4 4-4 4" /></>,
    undo: <><path d="m8 5-5 5 5 5M3 10h10a7 7 0 0 1 0 14" transform="translate(0 -3)" /></>,
    reset: <><path d="M3 10a9 9 0 1 1 2.6 8.4M3 4v6h6" /></>,
    help: <><circle cx="12" cy="12" r="9" /><path d="M9.5 8.8a2.5 2.5 0 1 1 4.2 1.9c-1.2.8-1.7 1.2-1.7 2.8M12 17h.01" /></>,
    close: <><path d="m6 6 12 12M6 18 18 6" /></>,
    check: <><path d="m5 12 4 4L19 6" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 6v6l4 2" /></>,
    turn: <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M4 9.4h16M4 14.6h16M9.4 4v16M14.6 4v16M1 12h5m-2-2 2 2-2 2" /></>,
    orbit: <><circle cx="12" cy="12" r="3" /><ellipse cx="12" cy="12" rx="10" ry="5" transform="rotate(-35 12 12)" /><path d="m19 3 2 3-3 1" /></>,
    mouse: <><rect x="6" y="2.5" width="12" height="19" rx="6" /><path d="M12 2.5V10M6 10h12M12 5.5v2" /></>,
    github: <><path d="M9 19c-4.3 1.3-4.3-2.2-6-2.6m12 5v-3.3c0-1 .1-1.5-.5-2 3.5-.4 7.1-1.7 7.1-7.6A5.9 5.9 0 0 0 20 4.4 5.5 5.5 0 0 0 19.9.3S18.6-.1 15.6 2a14.3 14.3 0 0 0-7.8 0C4.8-.1 3.5.3 3.5.3a5.5 5.5 0 0 0-.1 4.1 5.9 5.9 0 0 0-1.6 4.1c0 5.9 3.6 7.2 7.1 7.6-.5.4-.8 1-.8 2v3.3" transform="translate(1 1) scale(.92)" /></>,
    keyboard: <><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 15h10" /></>,
    spark: <><path d="m12 2 2.7 7.3L22 12l-7.3 2.7L12 22l-2.7-7.3L2 12l7.3-2.7L12 2Z" /></>,
  }

  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} style={style} aria-hidden="true">{shapes[name]}</svg>
}
