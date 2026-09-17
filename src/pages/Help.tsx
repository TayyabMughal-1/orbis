import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, Mail, MessageCircle, Phone } from 'lucide-react'
import { useRegion } from '../regions/RegionContext'
import { freeShippingThreshold } from '../lib/pricing'
import { formatThreshold, formatMoney } from '../lib/money'
import { Seo, breadcrumbSchema, graph, organizationSchema } from '../lib/seo'
import Reveal from '../components/ui/Reveal'
import type { RegionConfig } from '../regions/config'

// ---------------------------------------------------------------------
// Help / FAQ.
//
// Every answer is generated from the region config, so the UAE page
// talks about Tabby and 14-day returns while the Pakistan page talks
// about cash on delivery and 7 — and none of it can drift out of date
// when a shipping rate changes, because there is only one source.
//
// It also earns its keep in search: FAQPage structured data makes these
// answers eligible to appear directly in results, and "cash on delivery
// Pakistan" is the sort of query that converts.
// ---------------------------------------------------------------------

function buildFaq(config: RegionConfig): { q: string; a: string }[] {
  const threshold = freeShippingThreshold(config)
  const cheapest = config.shipping[0]
  const fastest = config.shipping[config.shipping.length - 1]
  const money = (n: number) => formatMoney(n, config, false)

  return [
    {
      q: `How long does delivery take in ${config.country}?`,
      a:
        `${cheapest.label} delivery takes ${cheapest.eta.toLowerCase()} and costs ${money(cheapest.amount)}` +
        (threshold !== null ? `, free on orders over ${formatThreshold(threshold, config)}` : '') +
        `. If you need it sooner, ${fastest.label.toLowerCase()} arrives ${fastest.eta.toLowerCase()} for ${money(fastest.amount)}. ` +
        config.policy.dutiesNote,
    },
    {
      q: `Which payment methods can I use in ${config.country}?`,
      a:
        `We accept ${config.paymentMethods.map((m) => m.label.toLowerCase()).join(', ')}. ` +
        (config.paymentMethods.some((m) => m.offline)
          ? `Methods marked as pay-on-delivery are settled when your order arrives${
              config.paymentMethods.find((m) => m.surcharge)
                ? `, with a ${money(config.paymentMethods.find((m) => m.surcharge)!.surcharge!)} handling fee`
                : ''
            }.`
          : 'Payment is taken securely at checkout.'),
    },
    {
      q: `Are prices shown with ${config.taxLabel}?`,
      a: config.taxIncludedInPrice
        ? `Yes. Every price in the ${config.country} store already includes ${config.taxLabel} at ${(config.taxRate * 100).toFixed(0)}%, so the price you see is the price you pay. Your receipt breaks out the ${config.taxLabel} portion.`
        : `Prices are shown before sales tax, which is added at checkout once you enter your delivery state — rates differ across states, and a few states charge none at all.`,
    },
    {
      q: 'Can I return something?',
      a: `Yes — you have ${config.policy.returnsDays} days from delivery, as long as the item is unused and in its original packaging. Email ${config.support.email} with your order number and we will arrange the collection.`,
    },
    {
      q: 'Why are prices different from your other stores?',
      a: `Each Orbis Store is priced for its own market in its own currency — ${config.currency.code} here — because landed cost, duties, local taxes and shipping all differ. We do not convert one price list at an exchange rate. You can switch stores from the selector in the header, though orders ship only within the store you place them in.`,
    },
    {
      q: 'Do you restock sold-out pieces?',
      a: 'Figures are made in numbered editions, and when an edition sells out it is gone — we do not reissue it. Homeware, lighting and prints are restocked when we can. Apparel is restocked between seasons, though a colourway may not return.',
    },
    {
      q: 'How do I track my order?',
      a: `Your confirmation email contains the order number. Enter it on the order tracking page and you will see its current status, delivery method and expected arrival. Our team is on ${config.support.phone}, ${config.support.hours.toLowerCase()}.`,
    },
  ]
}

export default function Help() {
  const { config, href } = useRegion()
  const faq = buildFaq(config)
  const [open, setOpen] = useState<number | null>(0)

  const schema = graph(
    organizationSchema(config),
    breadcrumbSchema(config, [
      { name: config.storeName, path: '/' },
      { name: 'Help', path: '/help' },
    ]),
    {
      '@type': 'FAQPage',
      mainEntity: faq.map((item) => ({
        '@type': 'Question',
        name: item.q,
        acceptedAnswer: { '@type': 'Answer', text: item.a },
      })),
    },
  )

  return (
    <>
      <Seo
        title={`Delivery, payment and returns in ${config.country}`}
        description={`How Orbis Store ships to ${config.country}: delivery times, ${config.paymentMethods
          .slice(0, 3)
          .map((m) => m.label.toLowerCase())
          .join(', ')}, ${config.taxLabel} and ${config.policy.returnsDays}-day returns.`}
        path="/help"
        jsonLd={schema}
      />

      <div className="mx-auto max-w-[900px] px-4 py-16 sm:px-6">
        <Reveal>
          <h1 className="font-grotesk text-[34px] uppercase leading-none text-ink sm:text-[46px]">
            Help
          </h1>
          <p className="mt-4 max-w-lg font-body text-[12px] leading-relaxed text-muted">
            Everything below is specific to the {config.country} store — delivery, payment,{' '}
            {config.taxLabel} and returns all work differently in our other markets.
          </p>
        </Reveal>

        <div className="mt-12 divide-y divide-ink/10 border-y border-ink/10">
          {faq.map((item, i) => {
            const isOpen = open === i
            return (
              <div key={item.q}>
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : i)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center justify-between gap-4 py-5 text-left"
                >
                  <span className="font-grotesk text-[14px] uppercase text-ink">{item.q}</span>
                  <ChevronDown
                    size={17}
                    className={`flex-none text-muted transition-transform duration-300 ${
                      isOpen ? 'rotate-180 text-accent' : ''
                    }`}
                  />
                </button>
                {/* Grid-rows trick: animates height without measuring it. */}
                <div
                  className={`grid transition-all duration-300 ease-arrive ${
                    isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                  }`}
                >
                  <div className="overflow-hidden">
                    <p className="pb-6 pr-8 font-body text-[12px] leading-relaxed text-muted">
                      {item.a}
                    </p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <Reveal className="mt-14">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Contact icon={Mail} label="Email us" value={config.support.email} href={`mailto:${config.support.email}`} />
            <Contact
              icon={Phone}
              label="Call us"
              value={config.support.phone}
              href={`tel:${config.support.phone.replace(/[^\d+]/g, '')}`}
            />
            <Contact icon={MessageCircle} label="Opening hours" value={config.support.hours} />
          </div>

          <div className="mt-8 text-center">
            <Link
              to={href('/shop')}
              className="press inline-flex rounded-full bg-neon px-7 py-3 font-grotesk text-[12px] uppercase text-ink"
            >
              Back to the shop
            </Link>
          </div>
        </Reveal>
      </div>
    </>
  )
}

function Contact({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: typeof Mail
  label: string
  value: string
  href?: string
}) {
  const body = (
    <>
      <Icon size={16} className="mb-3 text-accent" strokeWidth={1.7} />
      <div className="font-body text-[10px] uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 font-body text-[12px] text-ink">{value}</div>
    </>
  )
  const className =
    'block rounded-[16px] border border-ink/12 bg-ink/[0.02] p-5 transition-colors hover:border-ink/30'
  return href ? (
    <a href={href} className={className}>
      {body}
    </a>
  ) : (
    <div className={className}>{body}</div>
  )
}
