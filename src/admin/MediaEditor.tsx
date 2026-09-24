import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Link2, Trash2, Upload } from 'lucide-react'
import { adminApi } from '../api/admin'
import { errorMessage } from '../api/client'
import Media from '../components/ui/Media'
import type { MediaItem } from '../types'

// ---------------------------------------------------------------------
// The product's images and video.
//
// Two ways in, because both are genuinely useful: upload a file, or
// paste a URL for something already hosted. Uploads go straight from
// this browser to Cloudinary using a signature minted by the API — the
// file never passes through our own server, which is what makes a 40MB
// video possible at all on a serverless function.
//
// If Cloudinary is not configured the upload button says so and pasting
// a URL still works, rather than the whole panel disappearing.
//
// Order matters: the first item is the one on the product card and in
// the carousel, so the list is reorderable rather than a set.
// ---------------------------------------------------------------------

const VIDEO = /\.(mp4|webm|mov|m4v)(\?|$)/i

/** Cloudinary marks video with /video/upload/ in the delivery URL. */
const looksLikeVideo = (url: string) => VIDEO.test(url) || url.includes('/video/upload/')

export default function MediaEditor({
  media,
  onChange,
}: {
  media: MediaItem[]
  onChange: (next: MediaItem[]) => void
}) {
  const [canUpload, setCanUpload] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [url, setUrl] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let alive = true
    adminApi
      .uploadStatus()
      .then((s) => alive && setCanUpload(s.configured))
      .catch(() => alive && setCanUpload(false))
    return () => {
      alive = false
    }
  }, [])

  function add(item: MediaItem) {
    onChange([...media, item])
  }

  function fromUrl(raw: string): MediaItem | null {
    const src = raw.trim()
    if (!src) return null
    if (!/^https?:\/\//i.test(src)) {
      setError('Use a full URL starting with https://')
      return null
    }
    return looksLikeVideo(src) ? { kind: 'video', src } : { kind: 'image', src }
  }

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setBusy(true)
    setError(null)
    try {
      for (const file of Array.from(files)) {
        setProgress(0)
        const src = await adminApi.upload(file, setProgress)
        add(file.type.startsWith('video/') ? { kind: 'video', src } : { kind: 'image', src })
      }
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
      setProgress(0)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  function move(index: number, by: number) {
    const next = [...media]
    const target = index + by
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {media.map((item, i) => (
          <div
            key={`${i}-${'src' in item ? item.src : item.shape}`}
            className="group relative overflow-hidden rounded-[12px] border border-ink/[0.07] bg-surface shadow-card"
          >
            <div className="relative aspect-square w-full overflow-hidden">
              <Media item={item} />
            </div>

            {i === 0 && (
              <span className="absolute left-2 top-2 rounded-full bg-ink px-2 py-0.5 font-body text-[11px] uppercase tracking-wide text-background">
                Main
              </span>
            )}

            <div className="flex items-center justify-between border-t border-ink/[0.07] px-2 py-1.5">
              <span className="font-body text-[11px] uppercase tracking-wide text-muted">
                {item.kind}
              </span>
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  aria-label="Move earlier"
                  className="rounded p-1 text-muted hover:text-ink disabled:opacity-25"
                >
                  <ArrowUp size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={i === media.length - 1}
                  aria-label="Move later"
                  className="rounded p-1 text-muted hover:text-ink disabled:opacity-25"
                >
                  <ArrowDown size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => onChange(media.filter((_, j) => j !== i))}
                  aria-label="Remove"
                  className="rounded p-1 text-muted hover:text-red-600"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          </div>
        ))}

        {media.length === 0 && (
          <p className="col-span-full font-body text-[13px] text-muted">
            No images yet. Upload one, or paste a URL.
          </p>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          ref={fileInput}
          type="file"
          accept="image/*,video/*"
          multiple
          hidden
          onChange={(e) => onFiles(e.target.files)}
        />
        <button
          type="button"
          disabled={busy || canUpload === false}
          onClick={() => fileInput.current?.click()}
          title={
            canUpload === false
              ? 'Set the Cloudinary keys on the server to enable uploads'
              : undefined
          }
          className="press inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 font-grotesk text-[13px] uppercase text-background disabled:opacity-40"
        >
          <Upload size={13} />
          {busy ? `Uploading ${progress}%` : 'Upload'}
        </button>

        <div className="flex min-w-[240px] flex-1 items-center gap-2 rounded-full border border-ink/15 bg-background px-3">
          <Link2 size={13} className="flex-none text-muted" />
          <input
            value={url}
            onChange={(e) => {
              setUrl(e.target.value)
              setError(null)
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              // Inside a form, Enter would submit the product instead.
              e.preventDefault()
              const item = fromUrl(url)
              if (item) {
                add(item)
                setUrl('')
              }
            }}
            placeholder="or paste an image or video URL"
            className="w-full bg-transparent py-2 font-body text-[14px] text-ink outline-none placeholder:text-muted"
          />
          <button
            type="button"
            onClick={() => {
              const item = fromUrl(url)
              if (item) {
                add(item)
                setUrl('')
              }
            }}
            disabled={!url.trim()}
            className="flex-none font-grotesk text-[13px] uppercase text-accent disabled:opacity-40"
          >
            Add
          </button>
        </div>
      </div>

      {busy && (
        <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-ink/10">
          <div
            className="h-full rounded-full bg-accent transition-all duration-200"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {canUpload === false && (
        <p className="mt-3 font-body text-[13px] leading-relaxed text-muted">
          Uploads are off — the server has no Cloudinary keys. Pasting a URL still works. See the
          README for the three variables to set.
        </p>
      )}

      {error && (
        <p className="mt-3 rounded-[10px] border border-red-500/25 bg-red-50 p-3 font-body text-[13px] leading-relaxed text-red-700">
          {error}
        </p>
      )}
    </div>
  )
}
