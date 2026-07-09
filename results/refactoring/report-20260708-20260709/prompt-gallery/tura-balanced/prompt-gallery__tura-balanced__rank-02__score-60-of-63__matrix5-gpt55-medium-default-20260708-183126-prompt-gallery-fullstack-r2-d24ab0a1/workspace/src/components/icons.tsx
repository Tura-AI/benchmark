import type { ReactElement } from 'react'

type IconProps = { size?: number }

export function BoltIcon({ size = 18 }: IconProps) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4.5 13.5H11l-1 8.5L19.5 10H13V2Z" /></svg>
}

export function Icon({ name }: { name: 'home' | 'search' | 'heart' | 'cart' | 'clock' | 'api' | 'figma' | 'ext' | 'grid' | 'star' | 'menu' | 'spark' | 'x' | 'bag' }) {
  const common = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor' }
  const paths: Record<typeof name, ReactElement> = {
    home: <><path d="M3 11.5 12 4l9 7.5" /><path d="M5 10v10h14V10" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
    heart: <path d="M12 20s-7-4.4-9.2-8.3C1.1 8.5 2.6 5 6 5c2 0 3.2 1.2 4 2.3C10.8 6.2 12 5 14 5c3.4 0 4.9 3.5 3.2 6.7C19 15.6 12 20 12 20Z" />,
    cart: <><path d="M6 7h13l-1.2 9.5a2 2 0 0 1-2 1.75H9.2a2 2 0 0 1-2-1.75L6 7Z" /><path d="M9 7a3 3 0 0 1 6 0" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    api: <><path d="m8 16-4-4 4-4" /><path d="m16 8 4 4-4 4" /></>,
    figma: <><circle cx="9" cy="6" r="3" /><circle cx="9" cy="18" r="3" /><circle cx="15" cy="12" r="3" /></>,
    ext: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 9h18" /></>,
    grid: <><circle cx="7" cy="7" r="2.4" /><circle cx="17" cy="7" r="2.4" /><circle cx="7" cy="17" r="2.4" /><circle cx="17" cy="17" r="2.4" /></>,
    star: <path d="M12 2l2.9 6.3 6.9.6-5.2 4.6 1.6 6.8L12 17.3 5.8 20.9l1.6-6.8L2.2 8.9l6.9-.6z" />,
    menu: <path d="M4 7h16M4 12h16M4 17h16" />,
    spark: <path d="M12 3 21 12 12 21 3 12z" />,
    x: <path d="M6 6l12 12M18 6 6 18" />,
    bag: <><path d="M6 8h12l-1 12H7L6 8Z" /><path d="M9 8a3 3 0 0 1 6 0" /></>,
  }
  return <svg {...common}>{paths[name]}</svg>
}
