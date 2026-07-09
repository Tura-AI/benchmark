import { Link, createFileRoute, notFound } from '@tanstack/react-router'
import { loadPrompt } from '~/data/server'
import { FormatMoney } from '~/ui/FormatMoney'

export const Route = createFileRoute('/prompts/$promptId')({
  loader: async ({ params }) => {
    const id = Number(params.promptId)
    if (!Number.isInteger(id)) throw notFound()
    return loadPrompt({ data: { id } })
  },
  component: PromptDetail,
})

function PromptDetail() {
  const prompt = Route.useLoaderData()
  return (
    <main className="detail-page">
      <a href="/" className="back-link">POWERPROMPT Gallery</a>
      <section className="detail-card">
        <div className="detail-media" style={{ aspectRatio: prompt.aspect }}>
          <img src={prompt.image} alt={prompt.title} />
        </div>
        <div className="detail-copy">
          <div className="model"><span className="d" />{prompt.model} / {prompt.category}</div>
          <h1>{prompt.title}</h1>
          <p>{prompt.description}</p>
          <dl className="stats">
            <div><dt>Rating</dt><dd>{prompt.rating.toFixed(1)}</dd></div>
            <div><dt>Sold</dt><dd>{prompt.sold.toLocaleString()}</dd></div>
            <div><dt>Seller</dt><dd>{prompt.creator}</dd></div>
          </dl>
          <div className="detail-buy">
            <strong><FormatMoney value={prompt.price} /></strong>
            <Link to="/cart" className="btn-ink">Cart</Link>
          </div>
        </div>
      </section>
    </main>
  )
}
