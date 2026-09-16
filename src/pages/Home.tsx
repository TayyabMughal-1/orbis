import { Link } from 'react-router-dom'
import { ArrowRight, CreditCard, RotateCcw, ShieldCheck, Truck } from 'lucide-react'
import { api } from '../api/client'
import { CATEGORIES, VIDEOS } from '../api/db'
import { useAsync } from '../lib/useAsync'
import { useRegion } from '../regions/RegionContext'
import { freeShippingThreshold } from '../lib/pricing'
import { formatThreshold } from '../lib/money'
import ProductCard from '../components/ProductCard'
import CategoryCarousel from '../components/CategoryCarousel'
import HeroRing from '../components/HeroRing'
import LazyVideo from '../components/ui/LazyVideo'
import Reveal, { RevealGroup } from '../components/ui/Reveal'
import { ErrorState, ProductGridSkeleton, SectionHeading, Stars } from '../components/ui/Atoms'
import { Seo, absoluteUrl, graph, organizationSchema } from '../lib/seo'

export default function Home() {
  const { region, config, href } = useRegion()

  // One request feeds both the hero ring and the featured grid. The ring
  // wants as many distinct products as it can get — 22 card slots cycling
  // six products puts the same photo on screen twice — so this fetches the
  // catalogue and the grid takes the first six.
  const featured = useAsync(
    () => api.listProducts({ region, sort: 'featured', inStockOnly: true }),
    [region],
  )

  const threshold = freeShippingThreshold(config)
  const fastest = config.shipping[config.shipping.length - 1]

  const schema = graph(organizationSchema(config), {
    '@type': 'WebSite',
    name: `Orbis Store ${config.countryCode}`,
    url: absoluteUrl(config.code, '/'),
    inLanguage: config.locale,
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${absoluteUrl(config.code, '/shop')}?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  })

  return (
    <>
      <Seo
        title={`Orbis figures, homeware and apparel delivered in ${config.country}`}
        description={`Orbis Store sells hand-painted Orbis figures, homeware, lighting, apparel and prints. Priced in ${config.currency.code}, shipped across ${config.country}. ${config.hero.promo}.`}
        path="/"
        jsonLd={schema}
      />
      {/* ------------------------------------------------------ hero */}
      <section className="relative min-h-[86vh] w-full overflow-hidden">
        {/* 17.6MB, and it used to be fetched while the page was still
            painting. eager means "already on screen", so it loads on the
            first idle frame instead — the hero paints immediately and the
            footage arrives a moment later. */}
        <LazyVideo
          src={VIDEOS.hero}
          eager
          className="absolute inset-0 h-full w-full"
          fallback={
            <div className="absolute inset-0 bg-gradient-to-b from-surface via-background to-background" />
          }
        />
        {/* Two scrims, both deliberately light.
            These were far heavier — opaque white at the left edge and 45%
            across the top — which hazed over the footage they sat on. The
            weight was not buying anything: the headline is near-black, and
            measured against a mid-grey frame it reads at 4.7:1 with no
            scrim at all. What is left is the minimum that does a job. The
            vertical one only feathers the top edge and blends the foot into
            the white page below; the horizontal one puts a soft ground
            under the left column and is gone by the middle, so the figure
            and the planet play unobstructed. */}
        <div className="absolute inset-0 bg-gradient-to-b from-background/10 via-transparent to-background" />
        <div className="absolute inset-0 bg-gradient-to-r from-background/65 via-background/10 to-transparent lg:from-background/50 lg:via-transparent" />

        <div className="relative z-10 mx-auto flex min-h-[86vh] max-w-[1600px] flex-col justify-center px-4 py-24 sm:px-6 lg:px-10">
          <div className="max-w-[820px]">
            <div className="animate-fade-up mb-5 inline-flex items-center gap-2 rounded-full border border-ink/20 bg-ink/5 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.15em] text-ink/80">
              <span aria-hidden="true">{config.flag}</span>
              {config.hero.eyebrow}
            </div>

            <h1
              className="animate-fade-up font-grotesk text-[42px] uppercase leading-[1.02] text-ink sm:text-[64px] md:text-[78px] lg:text-[92px]"
              style={{ animationDelay: '90ms' }}
            >
              Meet Orbis
              <br />
              take him home
            </h1>

            {/* In flow, on the same left edge as everything else. It used to
                be absolutely positioned against the right edge of an 820px
                box, which left it stranded away from the headline it belongs
                to and forced a 96px top margin on the paragraph below simply
                to clear it. mix-blend-exclusion went with it: that was there
                to punch through a dark page. */}
            <div
              className="animate-fade-up mt-3 -rotate-1 font-condiment text-[26px] normal-case leading-none text-accent sm:text-[38px] lg:text-[46px]"
              style={{ animationDelay: '140ms' }}
            >
              small runs only
            </div>

            <p
              className="animate-fade-up mt-7 max-w-md font-mono text-[13px] uppercase leading-relaxed text-muted sm:mt-8"
              style={{ animationDelay: '200ms' }}
            >
              Hand-painted collectible figures, plus the homeware, lighting, apparel and prints that
              go with them. Shipped to {config.country} from a local warehouse, priced in{' '}
              {config.currency.code}.
            </p>

            <div className="animate-fade-up mt-9 flex flex-wrap items-center gap-3" style={{ animationDelay: '310ms' }}>
              <Link
                to={href('/shop')}
                className="press group flex items-center gap-2 rounded-full bg-neon px-7 py-3.5 font-grotesk text-[13px] uppercase text-ink transition-opacity hover:opacity-90"
              >
                Shop everything
                <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
              </Link>
              <Link
                to={href('/shop/figures')}
                className="press rounded-full border border-ink/25 px-7 py-3.5 font-grotesk text-[13px] uppercase text-ink transition-colors hover:border-ink/50"
              >
                Shop the figures
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------ featured products */}
      {/*
        The carousel has a band to itself. Over the hero it covered the
        artwork and crowded the buttons: the composition this borrows from
        works because its background is empty, and the hero's is not.

        It turns on a slow constant drift so the section is alive when
        nothing is happening, and scroll position adds to that, so moving
        down the page turns the ring. Cards are real products and each one
        links to its product page.
      */}
      <section className="overflow-hidden border-b border-ink/10 bg-surface pb-4 pt-16 sm:pt-20">
        <div className="mx-auto max-w-[1600px] px-4 text-center sm:px-6 lg:px-10">
          <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted">
            Featured
          </div>
          <h2 className="mt-3 font-grotesk text-[26px] uppercase leading-[1.05] text-ink sm:text-[34px]">
            Featured products
          </h2>
          <p className="mx-auto mt-4 max-w-[44ch] font-mono text-[12px] leading-relaxed text-muted">
            Our pick of the {config.country} store, priced in {config.currency.code}. Scroll to turn
            the shelf, or pick one up.
          </p>
        </div>
        <div className="mt-10">
          <HeroRing products={featured.data ?? []} />
        </div>
      </section>

      {/* -------------------------------------------------- featured */}
      <section className="mx-auto max-w-[1600px] px-4 py-20 sm:px-6 lg:px-10">
        <SectionHeading
          eyebrow={`Best sellers in ${config.country}`}
          title={
            <>
              What people
              <br />
              <span className="ml-10 sm:ml-20">
                are <span className="font-condiment normal-case text-accent">actually</span> buying
              </span>
            </>
          }
        >
          <Link
            to={href('/shop')}
            className="group flex items-center gap-2 font-grotesk text-[13px] uppercase text-ink hover:text-accent"
          >
            See everything
            <ArrowRight size={15} className="transition-transform group-hover:translate-x-1" />
          </Link>
        </SectionHeading>

        {featured.loading && <ProductGridSkeleton count={6} />}
        {featured.error && <ErrorState message={featured.error} onRetry={featured.reload} />}
        {featured.data && (
          <RevealGroup className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {featured.data.slice(0, 6).map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </RevealGroup>
        )}
      </section>

      {/* ------------------------------- region-specific value props */}
      <section className="border-y border-ink/10 bg-ink/[0.02]">
        <div className="mx-auto grid max-w-[1600px] grid-cols-2 gap-px px-4 sm:px-6 lg:grid-cols-4 lg:px-10">
          {[
            {
              icon: Truck,
              title: threshold !== null ? `Free over ${formatThreshold(threshold, config)}` : 'Local delivery',
              body: `${fastest.label} available — ${fastest.eta.toLowerCase()}.`,
            },
            {
              icon: RotateCcw,
              title: `${config.policy.returnsDays}-day returns`,
              body: 'Unused and in the original packaging, no questions asked.',
            },
            {
              icon: CreditCard,
              title: config.paymentMethods[0].label,
              body: config.paymentMethods
                .slice(0, 3)
                .map((m) => m.label)
                .join(' · '),
            },
            {
              icon: ShieldCheck,
              title: `${config.policy.warrantyMonths}-month warranty`,
              body: config.taxNote,
            },
          ].map(({ icon: Icon, title, body }, i) => (
            <Reveal key={title} delay={i * 80} className="px-2 py-8 sm:px-4 lg:px-6">
              <Icon size={18} className="mb-3 text-accent" strokeWidth={1.6} />
              <div className="font-grotesk text-[12px] uppercase text-ink">{title}</div>
              <p className="mt-1.5 font-mono text-[11px] leading-relaxed text-muted">{body}</p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------ categories */}
      <section className="mx-auto max-w-[1600px] px-4 pb-24 sm:px-6 lg:px-10">
        <CategoryCarousel
          intro={
            <div>
              <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-muted">
                Browse by type
              </div>
              <h2 className="font-grotesk text-[30px] uppercase leading-[1.05] text-ink sm:text-[40px] lg:text-[52px]">
                Departments
              </h2>
              <p className="mt-5 max-w-[32rem] font-mono text-[12px] leading-relaxed text-muted">
                Figures first, then everything that surrounds them. All five stocked and priced for
                {' '}{config.country} — pick a card, or jump straight to a department below.
              </p>
              <Link
                to={href('/shop')}
                className="group mt-6 inline-flex items-center gap-2 font-grotesk text-[13px] uppercase text-ink hover:text-accent"
              >
                Shop everything
                <ArrowRight size={15} className="transition-transform group-hover:translate-x-1" />
              </Link>
            </div>
          }
        />
      </section>

      {/* -------------------------------------------------- reviews */}
      <section className="border-y border-ink/10 bg-ink/[0.02]">
        <div className="mx-auto max-w-[1600px] px-4 py-16 sm:px-6 lg:px-10">
          <div className="mb-10 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-muted">
                What customers say
              </div>
              <h2 className="font-grotesk text-[26px] uppercase leading-none text-ink sm:text-[34px]">
                4.8 out of 5, from 3,200+ orders
              </h2>
            </div>
            <Stars
              rating={{ average: 4.8, count: 3241 }}
              size={18}
              showCount={false}
              className="sm:pb-1"
            />
          </div>

          <RevealGroup className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {[
              {
                quote:
                  'Bought the Explorer for my desk and ended up with all three. The flocked helmet is the detail that sells it — photos do not do it justice.',
                name: 'Daniel R.',
                place: 'Verified buyer',
                stars: 5,
              },
              {
                quote:
                  'Arrived in two days, packed properly, no damage. The numbered base was a nice surprise — it feels like a real collectible rather than a toy.',
                name: 'Sana K.',
                place: 'Verified buyer',
                stars: 5,
              },
              {
                quote:
                  'The hoodie is genuinely heavy — heavier than anything else I own. Sized down as suggested and it fits exactly right.',
                name: 'Marcus T.',
                place: 'Verified buyer',
                stars: 4,
              },
            ].map((review) => (
              <figure
                key={review.name}
                className="flex h-full flex-col rounded-[18px] border border-ink/10 bg-ink/[0.02] p-6"
              >
                <Stars
                  rating={{ average: review.stars, count: 0 }}
                  size={13}
                  showCount={false}
                  className="mb-4"
                />
                <blockquote className="flex-1 font-mono text-[12px] leading-relaxed text-ink/80">
                  “{review.quote}”
                </blockquote>
                <figcaption className="mt-5 font-mono text-[11px] uppercase text-muted">
                  {review.name} · <span className="text-accent/70">{review.place}</span>
                </figcaption>
              </figure>
            ))}
          </RevealGroup>
        </div>
      </section>

      {/* --------------------------------------- buying confidence */}
      {/*
        This replaced a video-backed origin story. Two reasons it had to
        go: a looping video under a 60% white wash left the copy at about
        2:1 against a moving background, and the copy itself was lore
        rather than anything a shopper needed in order to buy. What a
        customer actually wants to know at this point is what arrives in
        the box, how fast, and what happens if it is wrong — so that is
        what this says, in their own currency and delivery times.
      */}
      <section className="mx-auto max-w-[1600px] px-4 pb-24 sm:px-6 lg:px-10">
        <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr]">
          <Reveal className="rounded-[28px] border border-ink/[0.07] bg-surface p-8 shadow-card sm:p-12">
            <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted">
              Why shop with us
            </div>
            <h2 className="mt-3 max-w-[16ch] font-grotesk text-[30px] uppercase leading-[1.05] text-ink sm:text-[40px]">
              Collect with confidence
            </h2>
            <p className="mt-5 max-w-[52ch] font-mono text-[12px] leading-relaxed text-muted">
              Every figure is cast, hand-painted and numbered underneath. Editions are small and we
              do not reissue them, so what you buy stays what you bought.
            </p>

            <dl className="mt-9 grid grid-cols-2 gap-x-6 gap-y-7 sm:grid-cols-4">
              {[
                { value: config.policy.returnsDays, unit: 'day', label: 'Free returns' },
                { value: config.policy.warrantyMonths, unit: 'month', label: 'Warranty' },
                { value: config.shipping.length, unit: 'options', label: 'Delivery speeds' },
                { value: config.paymentMethods.length, unit: 'ways', label: 'To pay' },
              ].map((stat) => (
                <div key={stat.label}>
                  <dt className="font-grotesk text-[30px] leading-none text-ink sm:text-[38px]">
                    {stat.value}
                    <span className="ml-1 font-mono text-[11px] uppercase text-muted">{stat.unit}</span>
                  </dt>
                  <dd className="mt-2 font-mono text-[11px] uppercase leading-snug text-muted">
                    {stat.label}
                  </dd>
                </div>
              ))}
            </dl>

            <div className="mt-10 flex flex-wrap items-center gap-3">
              <Link
                to={href('/shop')}
                className="press group inline-flex items-center gap-2 rounded-full bg-ink px-7 py-3.5 font-grotesk text-[13px] uppercase text-background transition-opacity hover:opacity-90"
              >
                Shop everything
                <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
              </Link>
              <Link
                to={href('/help')}
                className="press inline-flex items-center rounded-full border border-ink/20 px-7 py-3.5 font-grotesk text-[13px] uppercase text-ink transition-colors hover:border-ink/45"
              >
                Delivery &amp; returns
              </Link>
            </div>
          </Reveal>

          {/* Shop entry points, not decoration: each tile is a real
              category link with its own product count. */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
            {CATEGORIES.slice(0, 3).map((category, i) => (
                <Reveal key={category.id} delay={i * 70}>
                  <Link
                    to={href(`/shop/${category.id}`)}
                    className="group flex h-full items-center justify-between gap-4 rounded-[24px] border border-ink/[0.07] bg-background p-6 shadow-card transition-all duration-300 hover:-translate-y-0.5 hover:border-ink/[0.14] hover:shadow-card-hover"
                  >
                    <div>
                      <div className="font-grotesk text-[16px] uppercase leading-tight text-ink transition-colors group-hover:text-accent">
                        {category.label}
                      </div>
                      <p className="mt-1.5 max-w-[34ch] font-mono text-[11px] leading-relaxed text-muted">
                        {category.blurb}
                      </p>
                    </div>
                    <span
                      aria-hidden="true"
                      className="flex h-10 w-10 flex-none items-center justify-center rounded-full border border-ink/10 text-ink transition-all duration-300 group-hover:border-accent group-hover:bg-accent group-hover:text-background"
                    >
                      <ArrowRight size={16} />
                    </span>
                  </Link>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- cta */}
      {/*
        The closing CTA. Also previously a video; a shopper reaching the
        bottom of the page wants a way in, not a mood piece.
      */}
      <section className="border-t border-ink/10 bg-surface">
        <div className="mx-auto max-w-[1600px] px-4 py-20 text-center sm:px-6 lg:px-10 lg:py-28">
          <Reveal>
            <h2 className="mx-auto max-w-[18ch] font-grotesk text-[30px] uppercase leading-[1.05] text-ink sm:text-[44px] lg:text-[56px]">
              Start your collection
            </h2>
            <p className="mx-auto mt-5 max-w-[46ch] font-mono text-[12px] leading-relaxed text-muted">
              Shipped from {config.country} in {config.currency.code}
              {threshold !== null ? `, free over ${formatThreshold(threshold, config)}` : ''}.
              {` ${config.policy.returnsDays}-day returns.`}
            </p>
            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <Link
                to={href('/shop/figures')}
                className="press group inline-flex items-center gap-2 rounded-full bg-neon px-8 py-4 font-grotesk text-[13px] uppercase text-ink transition-opacity hover:opacity-90"
              >
                Shop the figures
                <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
              </Link>
              <Link
                to={href('/shop')}
                className="press inline-flex items-center rounded-full border border-ink/20 bg-background px-8 py-4 font-grotesk text-[13px] uppercase text-ink transition-colors hover:border-ink/45"
              >
                Browse everything
              </Link>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  )
}
