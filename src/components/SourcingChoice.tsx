import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { useRegion } from '../regions/RegionContext'
import { formatMoney } from '../lib/money'
import Flag from './ui/Flag'
import Reveal from './ui/Reveal'
import type { Product } from '../types'

// ---------------------------------------------------------------------
// Two ways into the shop, for stores that sell both local and imported
// stock. Only Pakistan does today, and the section hides itself entirely
// where importShipping is not configured rather than showing an empty
// half.
//
// Every figure on these cards is read from the catalogue and the region
// config — product counts, delivery windows, the returns period. The
// pattern this copies used marketplace numbers ("150,000+ products",
// "Millions of products"); claiming those over a catalogue of seventeen
// would be the one thing on the page a shopper could immediately catch
// us out on.
// ---------------------------------------------------------------------

export default function SourcingChoice({ products }: { products: Product[] }) {
  const { config, href } = useRegion()
  const imported = config.importShipping
  if (!imported) return null

  const local = products.filter((p) => (p.origin ?? 'local') !== 'import')
  const abroad = products.filter((p) => p.origin === 'import')
  if (abroad.length === 0) return null

  const localTier = config.shipping[0]
  const importTier = imported.tiers[0]
  const cheapestPay = config.paymentMethods.find((m) => m.id === 'cod')

  return (
    <section className="mx-auto max-w-[1600px] px-4 pb-20 sm:px-6 lg:px-10">
      <div className="grid gap-4 lg:grid-cols-2">
        <Reveal>
          <Card
            code={config.code}
            eyebrow={config.country}
            title={`Shop from ${config.country}`}
            body={config.policy.dutiesNote}
            pills={[
              `${local.length} product${local.length === 1 ? '' : 's'}`,
              cheapestPay ? cheapestPay.label : config.paymentMethods[0].label,
              `${config.policy.returnsDays}-day returns`,
            ]}
            cta={`Shop from ${config.country}`}
            to={`${href('/shop')}?from=local`}
            footnote={`${localTier.label} · ${localTier.eta} · ${
              localTier.freeOver !== undefined
                ? `free over ${formatMoney(localTier.freeOver, config)}`
                : formatMoney(localTier.amount, config)
            }`}
            tone="home"
          />
        </Reveal>

        <Reveal delay={90}>
          <Card
            code={null}
            eyebrow={imported.from}
            title={`Shop from ${imported.from}`}
            body="Factory-direct pricing on pieces we do not make ourselves. Freight and customs are handled before it reaches you."
            pills={[
              `${abroad.length} product${abroad.length === 1 ? '' : 's'}`,
              'Customs handled',
              importTier.eta.replace(' business days', ' days'),
            ]}
            cta={`Explore ${imported.from}`}
            to={`${href('/shop')}?from=import`}
            footnote={`${importTier.label} · ${formatMoney(importTier.amount, config)}${
              importTier.freeOver !== undefined
                ? `, free over ${formatMoney(importTier.freeOver, config)}`
                : ''
            }`}
            tone="abroad"
          />
        </Reveal>
      </div>
    </section>
  )
}

function Card({
  code,
  eyebrow,
  title,
  body,
  pills,
  cta,
  to,
  footnote,
  tone,
}: {
  code: 'us' | 'ae' | 'pk' | null
  eyebrow: string
  title: string
  body: string
  pills: string[]
  cta: string
  to: string
  footnote: string
  tone: 'home' | 'abroad'
}) {
  // Dark cards on a white page: this section is a fork in the road, and
  // it has to read as heavier than the product grids around it.
  const ground =
    tone === 'home'
      ? 'from-[#2B2F6B] via-[#3B3E86] to-[#6C4BA8]'
      : 'from-[#14524B] via-[#1C6E5E] to-[#3F8A5B]'

  return (
    <Link
      to={to}
      className={`group relative flex h-full flex-col overflow-hidden rounded-[26px] bg-gradient-to-br ${ground} p-7 shadow-card transition-shadow duration-300 hover:shadow-card-hover sm:p-9`}
    >
      {/* Soft lights, purely decorative — they give the gradient somewhere
          to catch rather than reading as flat paint. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-20 left-10 h-44 w-44 rounded-full bg-white/[0.07] blur-3xl"
      />

      <div className="relative flex items-center gap-2">
        {code ? (
          <Flag code={code} className="h-3 w-[18px]" />
        ) : (
          <span className="rounded-[2px] bg-white/20 px-1.5 py-0.5 font-body text-[11px] font-semibold tracking-wide text-white">
            CN
          </span>
        )}
        <span className="font-body text-[13px] uppercase tracking-[0.16em] text-white/75">
          {eyebrow}
        </span>
        <ArrowRight
          size={16}
          className="ml-auto text-white/70 transition-transform duration-300 group-hover:translate-x-1"
        />
      </div>

      <h3 className="relative mt-5 font-grotesk text-[26px] uppercase leading-[1.05] text-white sm:text-[32px]">
        {title}
      </h3>

      <p className="relative mt-3 max-w-[42ch] font-body text-[14px] leading-relaxed text-white/75">
        {body}
      </p>

      <div className="relative mt-6 flex flex-wrap gap-2">
        {pills.map((pill) => (
          <span
            key={pill}
            className="rounded-full border border-white/20 bg-white/10 px-3.5 py-1.5 font-body text-[13px] text-white/90 backdrop-blur-sm"
          >
            {pill}
          </span>
        ))}
      </div>

      <div className="relative mt-auto pt-7">
        <span className="inline-flex items-center gap-2 font-grotesk text-[15px] uppercase text-white">
          {cta}
          <ArrowRight size={14} className="transition-transform duration-300 group-hover:translate-x-1" />
        </span>
        <div className="mt-2 font-body text-[12px] uppercase tracking-wide text-white/55">
          {footnote}
        </div>
      </div>
    </Link>
  )
}
