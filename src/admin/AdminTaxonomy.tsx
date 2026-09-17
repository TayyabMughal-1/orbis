import { useCallback, useState, type FormEvent } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { adminApi, type TaxonomyRow, type TaxonomyInput } from '../api/admin'
import { errorMessage } from '../api/client'
import { useAsync } from '../lib/useAsync'
import { ErrorState } from '../components/ui/Atoms'
import Flag from '../components/ui/Flag'
import { REGIONS, REGION_CODES, type RegionCode } from '../regions/config'

// ---------------------------------------------------------------------
// Departments and collections.
//
// One screen for both because they are the same shape — an id, a name,
// some copy, an order and a switch. What differs is the rule behind them,
// and that difference is the reason both exist:
//
//   A department is where a product lives. Exactly one, and the catalogue
//   filters by it, so a department still holding products cannot be
//   deleted — the API returns 409 and the products stay put.
//
//   A collection is a grouping laid over the top. A product can be in any
//   number of them or none, and deleting one only removes the membership,
//   never the product.
// ---------------------------------------------------------------------

const input =
  'w-full rounded-[10px] border border-ink/15 bg-background px-3 py-2 font-body text-[12px] text-ink outline-none transition-colors focus:border-accent'

type Kind = 'category' | 'collection'

export default function AdminTaxonomy() {
  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <Panel
        kind="category"
        title="Departments"
        blurb="Where a product lives. Every product is in exactly one, and the shop filters by them."
        bodyLabel="Blurb"
        emptyHint="No departments yet."
      />
      <Panel
        kind="collection"
        title="Collections"
        blurb="Groupings laid over the departments — New in, Last chance, a seasonal edit. A product can be in as many as you like."
        bodyLabel="Description"
        emptyHint="No collections yet. Create one, then pick it on any product."
      />
    </div>
  )
}

function Panel({
  kind,
  title,
  blurb,
  bodyLabel,
  emptyHint,
}: {
  kind: Kind
  title: string
  blurb: string
  bodyLabel: string
  emptyHint: string
}) {
  const load = useCallback(
    () => (kind === 'category' ? adminApi.listCategories() : adminApi.listCollections()),
    [kind],
  )
  const rows = useAsync(load, [kind])

  const [draft, setDraft] = useState<TaxonomyInput>({
    label: '',
    body: '',
    position: 0,
    regions: [...REGION_CODES],
  })
  const [editing, setEditing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = kind === 'category' ? adminApi.saveCategory : adminApi.saveCollection
  const remove = kind === 'category' ? adminApi.deleteCategory : adminApi.deleteCollection

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!draft.label.trim()) return
    setBusy(true)
    setError(null)
    try {
      await save(draft)
      setDraft({ label: '', body: '', position: 0, regions: [...REGION_CODES] })
      setEditing(null)
      rows.reload()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function onDelete(row: TaxonomyRow) {
    if (!window.confirm(`Delete "${row.label}"?`)) return
    setError(null)
    try {
      await remove(row.id)
      rows.reload()
    } catch (err) {
      // The 409 from a department that still holds products lands here and
      // says which, so this is worth showing rather than swallowing.
      setError(errorMessage(err))
    }
  }

  function edit(row: TaxonomyRow) {
    setEditing(row.id)
    setDraft({
      id: row.id,
      label: row.label,
      body: row.body,
      position: row.position,
      active: row.active,
      regions: row.regions?.length ? row.regions : [...REGION_CODES],
    })
  }

  return (
    <section className="rounded-[20px] border border-ink/[0.07] bg-background p-6 shadow-card">
      <h2 className="font-grotesk text-[16px] uppercase text-ink">{title}</h2>
      <p className="mt-2 max-w-[46ch] font-body text-[11px] leading-relaxed text-muted">{blurb}</p>

      <form onSubmit={submit} className="mt-5 grid gap-2.5">
        <input
          className={input}
          placeholder="Name"
          value={draft.label}
          onChange={(e) => setDraft({ ...draft, label: e.target.value })}
        />
        <input
          className={input}
          placeholder={bodyLabel}
          value={draft.body ?? ''}
          onChange={(e) => setDraft({ ...draft, body: e.target.value })}
        />
        {kind === 'category' && (
          <div className="flex flex-wrap gap-1.5">
            {REGION_CODES.map((code) => {
              const on = draft.regions?.includes(code) ?? false
              return (
                <button
                  key={code}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      regions: on
                        ? (draft.regions ?? []).filter((r) => r !== code)
                        : [...(draft.regions ?? []), code as RegionCode],
                    })
                  }
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-body text-[10px] transition-colors ${
                    on
                      ? 'border-accent bg-accent text-background'
                      : 'border-ink/15 text-muted hover:border-ink/35'
                  }`}
                >
                  <Flag code={code} className="h-2 w-3" />
                  {REGIONS[code].countryCode}
                </button>
              )
            })}
          </div>
        )}

        <div className="flex items-center gap-2.5">
          <input
            className={`${input} w-24`}
            type="number"
            placeholder="Order"
            value={draft.position ?? 0}
            onChange={(e) => setDraft({ ...draft, position: Number(e.target.value) })}
          />
          <label className="flex items-center gap-2 font-body text-[11px] text-muted">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-[#2F7D00]"
              checked={draft.active ?? true}
              onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
            />
            Live
          </label>
          <button
            type="submit"
            disabled={busy || !draft.label.trim()}
            className="press ml-auto inline-flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 font-grotesk text-[11px] uppercase text-background disabled:opacity-40"
          >
            <Plus size={13} />
            {editing ? 'Save' : 'Add'}
          </button>
          {editing && (
            <button
              type="button"
              onClick={() => {
                setEditing(null)
                setDraft({ label: '', body: '', position: 0, regions: [...REGION_CODES] })
              }}
              className="font-body text-[11px] text-muted underline"
            >
              cancel
            </button>
          )}
        </div>
      </form>

      {error && (
        <p className="mt-4 rounded-[10px] border border-red-500/25 bg-red-50 p-3 font-body text-[11px] leading-relaxed text-red-700">
          {error}
        </p>
      )}

      <div className="mt-6">
        {rows.loading && <p className="font-body text-[11px] text-muted">Loading…</p>}
        {rows.error && <ErrorState message={rows.error} onRetry={rows.reload} />}
        {rows.data && rows.data.length === 0 && (
          <p className="font-body text-[11px] text-muted">{emptyHint}</p>
        )}
        {rows.data && rows.data.length > 0 && (
          <ul className="divide-y divide-ink/[0.07]">
            {rows.data.map((row) => (
              <li key={row.id} className="flex items-start gap-3 py-3">
                <button
                  type="button"
                  onClick={() => edit(row)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-grotesk text-[12px] uppercase text-ink">{row.label}</span>
                    {!row.active && (
                      <span className="rounded-full bg-ink/10 px-2 py-0.5 font-body text-[9px] uppercase text-muted">
                        paused
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 truncate font-body text-[10px] text-muted">
                    /{row.id}
                    {row.body ? ` · ${row.body}` : ''}
                  </div>
                </button>
                <span className="flex items-center gap-1.5 whitespace-nowrap pt-0.5 font-body text-[10px] text-muted">
                  {kind === 'category' &&
                    (row.regions ?? []).map((r) => (
                      <Flag key={r} code={r} className="h-2 w-3" />
                    ))}
                  {row.productCount} product{row.productCount === 1 ? '' : 's'}
                </span>
                <button
                  type="button"
                  onClick={() => onDelete(row)}
                  aria-label={`Delete ${row.label}`}
                  className="press rounded-full p-1.5 text-muted transition-colors hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
