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
import Reveal, { RevealGroup } from '../components/ui/Reveal'
import { ErrorState, ProductGridSkeleton, SectionHeading, Stars } from '../components/ui/Atoms'
import { Seo, absoluteUrl, graph, organizationSchema } from '../lib/seo'

export default function Home() {
  const { region, config, href } = useRegion()

  const featured = useAsync(
    () => api.listProducts({ region, sort: 'featured', inStockOnly: true, limit: 6 }),
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
        <video
          className="absolute inset-0 h-full w-full object-cover"
          src={VIDEOS.hero}
          autoPlay
          loop
          muted
          playsInline
        />
        <div className="absolute inset-0 bg-gradient-to-b from-background/70 via-background/25 to-background" />

        <div className="relative z-10 mx-auto flex min-h-[86vh] max-w-[1600px] flex-col justify-center px-4 py-24 sm:px-6 lg:px-10">
          <div className="max-w-[820px]">
            <div className="animate-fade-up mb-5 inline-flex items-center gap-2 rounded-full border border-ink/20 bg-ink/5 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.15em] text-ink/80">
              <span aria-hidden="true">{config.flag}</span>
              {config.hero.eyebrow}
            </div>

            <h1
              className="animate-fade-up relative font-grotesk text-[42px] uppercase leading-[1.02] text-ink sm:text-[64px] md:text-[78px] lg:text-[92px]"
              style={{ animationDelay: '90ms' }}
            >
              Meet Orbis
              <br />
              take him home
              <span className="absolute -bottom-7 right-0 -rotate-1 font-condiment text-[26px] normal-case text-accent opacity-90 mix-blend-exclusion sm:-bottom-11 sm:text-[40px] lg:-bottom-14 lg:text-[52px]">
                small runs only
              </span>
            </h1>

            <p
              className="animate-fade-up mt-16 max-w-md font-mono text-[13px] uppercase leading-relaxed text-ink/80 sm:mt-20 lg:mt-24"
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
            {featured.data.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </RevealGroup>
        )}
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

      {/* ---------------------------------------------------- studio */}
      <section className="relative w-full overflow-hidden">
        <video
          className="absolute inset-0 h-full w-full object-cover"
          src={VIDEOS.atelier}
          autoPlay
          loop
          muted
          playsInline
        />
        <div className="absolute inset-0 bg-background/60" />
        <div className="relative z-10 mx-auto max-w-[1600px] px-4 py-28 sm:px-6 lg:px-10">
          {/* Established-since signature. Pinned to the section's right
              edge rather than trailing the heading, so it can never crowd
              the name however wide the viewport gets. */}
          <span className="pointer-events-none absolute right-4 top-20 rotate-2 text-right font-condiment text-[30px] normal-case leading-[0.85] text-accent opacity-90 mix-blend-exclusion sm:right-6 sm:top-24 sm:text-[52px] lg:right-10 lg:top-28 lg:text-[64px]">
            since
            <br />
            2020
          </span>

          <Reveal className="max-w-[640px]">
            <h2 className="font-grotesk text-[32px] uppercase leading-[1.05] text-ink sm:text-[46px] lg:text-[58px]">
              Hello!
              <br />
              I&apos;m <span className="text-accent">orbis</span>
            </h2>
            <p className="mt-12 font-mono text-[13px] uppercase leading-relaxed text-ink/80">
              He started as a single sketch — a small figure, a long way from home. Six years later
              we cast him in resin, paint him by hand and number him underneath, and we make the
              things he would keep around him: steel, stoneware, machined aluminium, heavy cotton.
            </p>
            <p className="mt-5 max-w-md font-mono text-[12px] leading-relaxed text-muted">
              Figures are made in numbered editions, and when one sells out we do not reissue it.
              Everything else we restock when we can. Made in small batches, shipped from a warehouse
              in {config.country}, and backed for {config.policy.warrantyMonths} months.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ------------------------------------------------------- cta */}
      <section className="relative w-full overflow-hidden">
        <video className="block h-auto w-full" src={VIDEOS.cta} autoPlay loop muted playsInline />
        <div className="absolute inset-0 flex items-center bg-background/35">
          <div className="mx-auto w-full max-w-[1600px] px-4 text-right sm:px-6 lg:px-10">
            <h2 className="font-grotesk text-[18px] uppercase leading-[1.15] text-ink sm:text-[30px] md:text-[44px] lg:text-[58px]">
              <span className="mb-3 block sm:mb-6 lg:mb-10">Start a shelf.</span>
              <span className="block">Three figures.</span>
              <span className="block">One long journey.</span>
            </h2>
            <Link
              to={href('/shop/figures')}
              className="press mt-6 inline-flex items-center gap-2 rounded-full bg-neon px-6 py-3 font-grotesk text-[12px] uppercase text-ink sm:mt-10"
            >
              Shop the figures
              <ArrowRight size={15} />
            </Link>
          </div>
        </div>
      </section>
    </>
  )
}
