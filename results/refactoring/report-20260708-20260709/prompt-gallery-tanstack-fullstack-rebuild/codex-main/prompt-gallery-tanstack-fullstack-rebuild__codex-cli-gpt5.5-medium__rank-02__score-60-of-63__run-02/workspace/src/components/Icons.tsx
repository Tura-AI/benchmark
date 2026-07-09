export function Bolt() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M13 2 4.5 13.5H11l-1 8.5L19.5 10H13V2Z" />
    </svg>
  )
}

export function Icon({ name }: { name: string }) {
  const paths: Record<string, string[]> = {
    home: ['M3 11.5 12 4l9 7.5', 'M5 10v10h14V10'],
    search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z', 'm20 20-3.5-3.5'],
    history: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 7v5l3 2'],
    heart: ['M12 20s-7-4.4-9.2-8.3C1.1 8.5 2.6 5 6 5c2 0 3.2 1.2 4 2.3C10.8 6.2 12 5 14 5c3.4 0 4.9 3.5 3.2 6.7C19 15.6 12 20 12 20Z'],
    grid: ['M4 4h6v6H4z', 'M14 4h6v6h-6z', 'M4 14h6v6H4z', 'M14 14h6v6h-6z'],
    bag: ['M6 7h13l-1.2 9.5a2 2 0 0 1-2 1.75H9.2a2 2 0 0 1-2-1.75L6 7Z', 'M9 7a3 3 0 0 1 6 0'],
    spark: ['M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18'],
    plus: ['M12 5v14M5 12h14'],
    bookmark: ['M6 4h12v17l-6-4-6 4V4Z'],
    close: ['M6 6l12 12M18 6 6 18'],
    api: ['m8 16-4-4 4-4', 'm16 8 4 4-4 4'],
    image: ['M12 4 4 19h16z'],
    circle: ['M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z'],
    flux: ['M12 3 21 12 12 21 3 12Z'],
    menu: ['M4 7h16M4 12h16M4 17h16'],
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]?.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}
