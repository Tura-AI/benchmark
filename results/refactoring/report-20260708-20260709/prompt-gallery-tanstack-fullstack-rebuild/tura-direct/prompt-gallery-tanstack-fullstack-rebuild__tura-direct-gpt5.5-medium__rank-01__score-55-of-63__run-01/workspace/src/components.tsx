import { Link, useNavigate } from '@tanstack/react-router';
import { useState, useTransition } from 'react';
import type { AnalyticsSummary, CartSummary, CatalogResponse, PromptCard, SortMode } from './types';
import { addToCartFn, checkoutFn, removeFromCartFn, toggleFavoriteFn } from './server/functions';

export function money(cents: number) {
  return cents === 0 ? 'Free' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

type StoreSearch = { model?: string; category?: string; sort?: SortMode; q?: string; favorites?: boolean };

export function Shell({ children, counts }: { children: React.ReactNode; counts?: CatalogResponse['counts'] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="app">
      <button className="burger" type="button" onClick={() => setOpen(true)} aria-label="Open navigation">Menu</button>
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand"><span className="bolt">P</span><b>POWER</b><em>PROMPT</em></div>
        <Link className="navitem" to="/">Explore</Link>
        <Link className="navitem" to="/" search={{ favorites: true, sort: 'Featured' }}>Favorites <small>{counts?.favorites ?? 0}</small></Link>
        <Link className="navitem" to="/cart">Cart <small>{counts?.cart ?? 0}</small></Link>
        <Link className="navitem" to="/admin">Creator analytics</Link>
        <div className="side-label">Categories</div>
        <Link className="cat" to="/" search={{ category: 'beauty', sort: 'Featured' }}><span />Beauty</Link>
        <Link className="cat" to="/" search={{ category: 'commerce', sort: 'Featured' }}><span />Commerce</Link>
        <Link className="cat" to="/" search={{ category: 'cinema', sort: 'Featured' }}><span />Cinema</Link>
        <Link className="cat" to="/" search={{ category: 'systems', sort: 'Featured' }}><span />Systems</Link>
        <div className="promo"><b>Creator-grade prompts</b><p>Featured, free and paid packs are ranked by sales, rating and model fit.</p></div>
      </aside>
      {open && <button className="scrim" type="button" aria-label="Close navigation" onClick={() => setOpen(false)} />}
      <main id="content" className="main">{children}</main>
    </div>
  );
}

export function Storefront({ catalog, search }: { catalog: CatalogResponse; search: StoreSearch }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState(search.q ?? '');
  const apply = (next: StoreSearch) => navigate({ to: '/', search: { sort: 'Featured', ...search, ...next } });
  return (
    <Shell counts={catalog.counts}>
      <header className="topbar">
        <div>
          <p className="eyebrow">Prompt gallery</p>
          <h1>Premium prompts for image, copy and commerce workflows.</h1>
        </div>
        <form className="search" onSubmit={(e) => { e.preventDefault(); apply({ q: query }); }}>
          <input aria-label="Search prompts" placeholder="Search POWERPROMPT" value={query} onChange={(e) => setQuery(e.target.value)} />
          <button type="submit">Search</button>
        </form>
      </header>
      <section className="filters" aria-label="Prompt filters">
        <button className={!search.model || search.model === 'all' ? 'active' : ''} onClick={() => apply({ model: 'all' })}>All</button>
        {catalog.models.map((model) => <button key={model} className={search.model === model ? 'active' : ''} onClick={() => apply({ model })}>{model}</button>)}
        <button className={search.favorites ? 'active' : ''} onClick={() => apply({ favorites: !search.favorites })}>Favorites</button>
        <span className="split" />
        {(['Featured', 'Newest', 'Popular'] as SortMode[]).map((sort) => <button key={sort} className={(search.sort ?? 'Featured') === sort ? 'active' : ''} onClick={() => apply({ sort })}>{sort}</button>)}
      </section>
      <div className="countline">{catalog.counts.featured} featured · {catalog.counts.free} free · {catalog.counts.paid} paid · Cart {catalog.counts.cart}</div>
      <section className="masonry" aria-label="Prompt cards">
        {catalog.prompts.map((prompt) => <PromptTile key={prompt.id} prompt={prompt} />)}
      </section>
      {catalog.prompts.length === 0 && <p className="empty">No prompts match this view.</p>}
    </Shell>
  );
}

export function PromptTile({ prompt }: { prompt: PromptCard }) {
  const [isPending, startTransition] = useTransition();
  const [fav, setFav] = useState(prompt.isFavorite);
  const [carted, setCarted] = useState(prompt.inCart);
  const act = (kind: 'favorite' | 'cart') => startTransition(async () => {
    if (kind === 'favorite') { await toggleFavoriteFn({ data: { promptId: prompt.id } }); setFav((v) => !v); toast(fav ? 'Removed from Favorites' : 'Saved to Favorites'); }
    else { await addToCartFn({ data: { promptId: prompt.id } }); setCarted(true); toast('Added to Cart'); }
  });
  return (
    <article className="tile" style={{ ['--ratio' as string]: prompt.ratio }}>
      <Link className="media" to="/prompts/$promptId" params={{ promptId: prompt.id }} aria-label={`Open ${prompt.title}`}>
        <img src={prompt.image} alt="" loading="lazy" />
        <span className="shade" />
      </Link>
      <div className="overlay">
        <button aria-pressed={fav} disabled={isPending} onClick={() => act('favorite')}>{fav ? 'Saved' : 'Save'}</button>
        <button disabled={isPending || carted} onClick={() => act('cart')}>{carted ? 'In cart' : prompt.priceCents === 0 ? 'Get free' : 'Add'}</button>
      </div>
      <div className="tilebody">
        <div><b>{prompt.title}</b><p>{prompt.creator} · {prompt.model}</p></div>
        <strong>{money(prompt.priceCents)}</strong>
      </div>
    </article>
  );
}

export function DetailView({ prompt, related }: { prompt: PromptCard; related: PromptCard[] }) {
  return (
    <Shell>
      <div className="detail">
        <img src={prompt.image} alt="" />
        <section>
          <p className="eyebrow">{prompt.model} · {prompt.category}</p>
          <h1>{prompt.title}</h1>
          <p>{prompt.description}</p>
          <div className="metrics"><span>{prompt.rating.toFixed(1)} rating</span><span>{prompt.sales} sales</span><span>{money(prompt.priceCents)}</span></div>
          <div className="actions"><CartButton prompt={prompt} /><Link to="/cart">Open Cart</Link></div>
        </section>
      </div>
      <h2 className="section-title">Related prompt previews</h2>
      <section className="masonry related">{related.slice(0, 4).map((item) => <PromptTile key={item.id} prompt={item} />)}</section>
    </Shell>
  );
}

function CartButton({ prompt }: { prompt: PromptCard }) {
  const [done, setDone] = useState(prompt.inCart);
  return <button className="primary" disabled={done} onClick={async () => { await addToCartFn({ data: { promptId: prompt.id } }); setDone(true); toast('Added to Cart'); }}>{done ? 'In Cart' : 'Add to Cart'}</button>;
}

export function CartView({ cart }: { cart: CartSummary }) {
  const [state, setState] = useState(cart);
  const [message, setMessage] = useState('');
  return (
    <Shell counts={{ all: 0, free: 0, paid: 0, featured: 0, favorites: 0, cart: state.items.length }}>
      <header className="pagehead"><p className="eyebrow">Cart</p><h1>Checkout simulation</h1></header>
      <section className="cartgrid">
        <div className="cartitems">
          {state.items.map((item) => <div className="cartrow" key={item.id}><img src={item.image} alt="" /><div><b>{item.title}</b><p>{item.model} · {item.creator}</p></div><strong>{money(item.priceCents)}</strong><button onClick={async () => setState(await removeFromCartFn({ data: { promptId: item.id } }))}>Remove</button></div>)}
          {state.items.length === 0 && <p className="empty">Your Cart is empty.</p>}
        </div>
        <aside className="summary"><p>Subtotal <b>{money(state.subtotalCents)}</b></p><p>Platform fee <b>{money(state.feeCents)}</b></p><p className="total">Total <b>{money(state.totalCents)}</b></p><button className="primary" disabled={!state.items.length} onClick={async () => { const result = await checkoutFn(); setState(result.cart); setMessage(result.orderId ? `Order ${result.orderId} complete` : 'Cart is empty'); }}>Checkout</button>{message && <small>{message}</small>}</aside>
      </section>
    </Shell>
  );
}

export function AdminView({ analytics }: { analytics: AnalyticsSummary }) {
  return (
    <Shell>
      <header className="pagehead"><p className="eyebrow">Creator admin</p><h1>Sales, conversion and category revenue</h1></header>
      <section className="admincards">
        <Metric label="Average price" value={money(analytics.averagePriceCents)} />
        <Metric label="Daily trend rows" value={String(analytics.dailySales.length)} />
        <Metric label="Top category" value={analytics.categoryRevenue[0]?.category ?? 'None'} />
      </section>
      <section className="tables">
        <DataTable title="Creator revenue" rows={analytics.creatorRevenue.map((r) => [r.creator, money(r.revenueCents), `${(r.conversionRate * 100).toFixed(2)}%`, money(r.averageOrderValueCents ?? 0)])} headers={['Creator','Revenue','Conversion','AOV']} />
        <DataTable title="Daily sales" rows={analytics.dailySales.map((r) => [r.day, money(r.revenueCents), String(r.orders)])} headers={['Day','Revenue','Orders']} />
      </section>
    </Shell>
  );
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="metric"><span>{label}</span><b>{value}</b></div>; }

function DataTable({ title, headers, rows }: { title: string; headers: string[]; rows: string[][] }) {
  return <div className="panel"><h2>{title}</h2><table><thead><tr>{headers.map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((r, i) => <tr key={i}>{r.map((c) => <td key={c}>{c}</td>)}</tr>)}</tbody></table></div>;
}

function toast(text: string) {
  if (typeof document === 'undefined') return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1800);
}
