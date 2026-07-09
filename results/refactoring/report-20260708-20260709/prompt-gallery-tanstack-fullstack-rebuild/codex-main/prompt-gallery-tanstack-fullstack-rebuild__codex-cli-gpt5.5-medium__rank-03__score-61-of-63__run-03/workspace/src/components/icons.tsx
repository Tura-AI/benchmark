export function BoltIcon() {
  return (
    <span className="bolt">
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M13 2 4.5 13.5H11l-1 8.5L19.5 10H13l0-8Z" />
      </svg>
    </span>
  )
}

export function Price({ price, className = '' }: { price: number; className?: string }) {
  return <span className={`price ${price === 0 ? 'free' : ''} ${className}`}>{price === 0 ? 'Free' : `$${price}`}</span>
}
