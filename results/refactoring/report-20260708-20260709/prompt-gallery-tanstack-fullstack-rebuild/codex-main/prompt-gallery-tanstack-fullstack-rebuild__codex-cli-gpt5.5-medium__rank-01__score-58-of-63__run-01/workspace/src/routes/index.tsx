import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Dock } from '../components/Dock'
import { Lightbox } from '../components/Lightbox'
import { MobileTop } from '../components/MobileTop'
import { PromptTile } from '../components/PromptTile'
import { Sidebar } from '../components/Sidebar'
import { Toast } from '../components/Toast'
import { TopFilters } from '../components/TopFilters'
import type { PromptCard, Toast as ToastType } from '../components/types'
import {
  addToCartFn,
  fallbackFilters,
  getMarketplace,
  toggleFavoriteFn,
} from '../server/market'

export const Route = createFileRoute('/')({
  loader: () => ({ prompts: [], filters: fallbackFilters }),
  component: Storefront,
})

function Storefront() {
  const initial = Route.useLoaderData()
  const [prompts, setPrompts] = useState(initial.prompts as PromptCard[])
  const [filters, setFilters] = useState(initial.filters)
  const [model, setModel] = useState('All')
  const [category, setCategory] = useState('All')
  const [sort, setSort] = useState<'featured' | 'newest' | 'popular'>('featured')
  const [query, setQuery] = useState('')
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [freeOnly, setFreeOnly] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [drawer, setDrawer] = useState(false)
  const [preview, setPreview] = useState<PromptCard | null>(null)
  const [toast, setToast] = useState<ToastType | null>(null)
  const [cartCount, setCartCount] = useState(filters.counts.cart)
  const showToast = useCallback((text: string) => setToast({ text }), [])

  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(async () => {
      const next = await getMarketplace({
        data: { model, category, sort, query, favoritesOnly, freeOnly },
      })
      if (!cancelled) {
        setPrompts(next.prompts as PromptCard[])
        setFilters(next.filters)
        setCartCount(next.filters.counts.cart)
      }
    }, 120)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [category, favoritesOnly, freeOnly, model, query, sort])

  const columns = useMemo(() => {
    const buckets: PromptCard[][] = [[], [], [], []]
    prompts.forEach((prompt, index) => buckets[index % buckets.length].push(prompt))
    return buckets
  }, [prompts])

  async function onFavorite(prompt: PromptCard) {
    const result = await toggleFavoriteFn({ data: { promptId: prompt.id } })
    setPrompts((items) =>
      items.map((item) =>
        item.id === prompt.id ? { ...item, isFavorite: result.isFavorite ? 1 : 0 } : item,
      ),
    )
    showToast(result.isFavorite ? 'Saved to Favorites' : 'Removed from Favorites')
  }

  async function onCart(prompt: PromptCard) {
    const cart = await addToCartFn({ data: { promptId: prompt.id } })
    setCartCount(cart.items.reduce((sum, item) => sum + item.quantity, 0))
    showToast(`Added: ${prompt.title}`)
  }

  function resetHome() {
    setModel('All')
    setCategory('All')
    setQuery('')
    setFavoritesOnly(false)
    setFreeOnly(false)
  }

  return (
    <>
      <Sidebar
        categories={filters.categories}
        activeCategory={category}
        favoritesCount={filters.counts.favorites}
        isOpen={drawer}
        onClose={() => setDrawer(false)}
        onSearch={() => {
          setSearchOpen((value) => !value)
          setDrawer(false)
        }}
        onFavorites={() => {
          resetHome()
          setFavoritesOnly(true)
          setDrawer(false)
        }}
        onFree={() => {
          resetHome()
          setFreeOnly(true)
          setDrawer(false)
          showToast('Showing free prompts')
        }}
        onCategory={(next) => {
          setCategory(next)
          setFavoritesOnly(false)
          setFreeOnly(false)
          setDrawer(false)
        }}
      />
      <main className="main">
        <MobileTop onMenu={() => setDrawer(true)} />
        <TopFilters
          model={model}
          sort={sort}
          query={query}
          searchOpen={searchOpen}
          onModel={(next) => {
            setModel(next)
            setFavoritesOnly(false)
          }}
          onSort={setSort}
          onQuery={setQuery}
        />
        <section className="gallery" aria-label="Prompt marketplace">
          <div className="gallery-head">
            <div>
              <p className="mono kicker">Featured prompt systems</p>
              <h1>POWERPROMPT Gallery</h1>
            </div>
            <div className="market-stats">
              <span>{filters.counts.featured} Featured</span>
              <span>{filters.counts.free} Free</span>
              <span>{filters.counts.paid} Paid</span>
            </div>
          </div>
          {prompts.length ? (
            <div className="masonry">
              {columns.map((column, index) => (
                <div className="ms-col" key={index}>
                  {column.map((prompt) => (
                    <PromptTile
                      key={prompt.id}
                      prompt={prompt}
                      onPreview={setPreview}
                      onFavorite={onFavorite}
                      onCart={onCart}
                    />
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <div className="empty">
              <div className="big">Nothing here yet</div>
              <p>Try a different model, category, or search.</p>
            </div>
          )}
        </section>
      </main>
      <Dock
        cartCount={cartCount}
        onSearch={() => setSearchOpen((value) => !value)}
        onFavorites={() => {
          resetHome()
          setFavoritesOnly(true)
        }}
      />
      <Lightbox prompt={preview} onClose={() => setPreview(null)} onCart={onCart} />
      <Toast toast={toast} onDone={() => setToast(null)} />
    </>
  )
}
