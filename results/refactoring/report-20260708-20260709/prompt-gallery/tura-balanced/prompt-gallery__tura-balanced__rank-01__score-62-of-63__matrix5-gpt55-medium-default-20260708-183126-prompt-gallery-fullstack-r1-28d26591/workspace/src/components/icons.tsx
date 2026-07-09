import { ArrowRight, Bookmark, Boxes, Clock3, Code2, Gift, Heart, Home, Menu, Search, ShoppingBag, Sparkles, Star, Wand2, X } from 'lucide-react'

export const Icons = { ArrowRight, Bookmark, Boxes, Clock3, Code2, Gift, Heart, Home, Menu, Search, ShoppingBag, Sparkles, Star, Wand2, X }

export function Bolt({ small = false }: { small?: boolean }) {
  return (
    <span className="bolt" style={small ? { width: 28, height: 28, borderRadius: 7 } : undefined}>
      <svg viewBox="0 0 24 24" fill="currentColor" width={small ? 15 : 16} height={small ? 15 : 16} aria-hidden="true">
        <path d="M13 2 4.5 13.5H11l-1 8.5L19.5 10H13l0-8Z" />
      </svg>
    </span>
  )
}
