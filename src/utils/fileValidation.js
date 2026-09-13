// Shared bill-upload restrictions, applied client-side before anything is
// sent to S3 — mirrors the backend's own allowlist (app/schemas/upload.py's
// ALLOWED_CONTENT_TYPES) so a rejected file fails fast here instead of
// round-tripping to the presigned-upload endpoint just to get the same
// rejection back.
import { compressImageFile } from './imageCompression.js'

export const ALLOWED_BILL_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'])
export const MAX_BILL_FILE_SIZE = 2 * 1024 * 1024 // 2MB

// Validates type, and — for an oversized image — auto-compresses it under
// the cap instead of just rejecting it (see imageCompression.js): a phone
// camera photo is routinely 4-8MB despite a bill only ever needing to stay
// legible, so making the manager go find a way to shrink it themselves
// would just make the upload feel broken. A PDF can't be shrunk the same
// way, so an oversized one still gets a flat reject.
// Returns { file, error }: `file` is what to actually upload (the original,
// or a compressed replacement) whenever `error` is null; `error` is
// 'type' | 'size' otherwise.
export async function prepareBillFile(file) {
  if (!ALLOWED_BILL_TYPES.has(file.type)) return { file: null, error: 'type' }
  if (file.size <= MAX_BILL_FILE_SIZE) return { file, error: null }
  if (file.type === 'application/pdf') return { file: null, error: 'size' }
  const compressed = await compressImageFile(file, MAX_BILL_FILE_SIZE)
  if (!compressed) return { file: null, error: 'size' }
  return { file: compressed, error: null }
}
