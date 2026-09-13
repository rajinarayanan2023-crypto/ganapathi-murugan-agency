// Client-side bill-photo compression — resizes to a reasonable max
// dimension and re-encodes as JPEG at a moderate quality, entirely in the
// browser, before the file is ever uploaded (uploads go straight
// browser→S3 — see apiClient.uploadBillFile — so nothing on the backend
// ever gets a chance to compress it after the fact). A bill photo only
// needs to stay legible, not print-quality: dropping an unnecessary 12MP
// camera resolution down to ~1800px does almost all the size reduction on
// its own, so quality rarely has to drop far before the text is still sharp.
const MAX_DIMENSION = 1800 // px, longer side
const INITIAL_QUALITY = 0.8
const MIN_QUALITY = 0.5
const QUALITY_STEP = 0.1
// Above this, don't even attempt it — decoding something this large into a
// canvas risks freezing/crashing the tab, especially on a phone. Treated
// the same as an unsupported format (HEIC on non-Safari browsers, mainly):
// the caller falls back to a flat size-based reject.
const SAFETY_MAX_ORIGINAL_BYTES = 25 * 1024 * 1024

function fitDimensions(width, height, maxDimension) {
  if (width <= maxDimension && height <= maxDimension) return { width, height }
  const scale = maxDimension / Math.max(width, height)
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
}

// Returns a new, smaller File under targetBytes, or null if this browser
// can't decode the image (HEIC outside Safari is the common case) or the
// source is too large to safely attempt — either way the caller falls back
// to a flat size-based reject instead of silently uploading the original.
export async function compressImageFile(file, targetBytes) {
  if (file.size > SAFETY_MAX_ORIGINAL_BYTES) return null

  let bitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return null
  }

  try {
    const { width, height } = fitDimensions(bitmap.width, bitmap.height, MAX_DIMENSION)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height)

    let quality = INITIAL_QUALITY
    let blob = await canvasToBlob(canvas, quality)
    while (blob && blob.size > targetBytes && quality > MIN_QUALITY) {
      quality -= QUALITY_STEP
      blob = await canvasToBlob(canvas, quality)
    }
    if (!blob || blob.size > targetBytes) return null

    const newName = file.name.replace(/\.[^./\\]+$/, '') + '.jpg'
    return new File([blob], newName, { type: 'image/jpeg' })
  } finally {
    bitmap.close?.()
  }
}
