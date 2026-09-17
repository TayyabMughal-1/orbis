import { createHash } from 'node:crypto'
import { ApiError } from './errors.js'

// ---------------------------------------------------------------------
// Signed Cloudinary uploads.
//
// The file never passes through this API. The dashboard asks for a
// signature, then posts the file straight from the browser to
// Cloudinary — so a 40MB video does not have to fit inside a serverless
// function's request body, its memory, or its fifteen-second budget.
//
// Signed rather than unsigned, which is the other way to do this. An
// unsigned preset is a public string that lets anyone who reads your
// JavaScript upload to your account for as long as it exists. A
// signature is minted per upload, only for a signed-in admin, expires,
// and is scoped to one folder. The API secret never leaves the server.
// ---------------------------------------------------------------------

export type UploadSignature = {
  cloudName: string
  apiKey: string
  timestamp: number
  signature: string
  folder: string
}

/** Where uploads land, so the media library stays navigable. */
const FOLDER = 'orbis/products'

export function uploadsConfigured(): boolean {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET,
  )
}

/**
 * Cloudinary signs the upload parameters, not the file: sort the params
 * you intend to send, join them as a query string, append the API
 * secret, SHA-1 the lot. Every signed param must then be sent with the
 * upload and must match exactly, or it rejects the request.
 */
export function signUpload(): UploadSignature {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME
  const apiKey = process.env.CLOUDINARY_API_KEY
  const apiSecret = process.env.CLOUDINARY_API_SECRET

  if (!cloudName || !apiKey || !apiSecret) {
    throw new ApiError(
      503,
      'uploads_not_configured',
      'Uploads are off because CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET are not set on the server. You can still paste a URL.',
    )
  }

  const timestamp = Math.floor(Date.now() / 1000)
  const toSign = `folder=${FOLDER}&timestamp=${timestamp}`
  const signature = createHash('sha1').update(toSign + apiSecret).digest('hex')

  return { cloudName, apiKey, timestamp, signature, folder: FOLDER }
}
