// Generates PWA raster icons with pureimage (pure JS, no native deps).
// Brand mark: ivory rounded field, sage rounded square, ivory checkmark.
import * as PImage from 'pureimage'
import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const IVORY = '#ffffff'
const SAGE = '#1f9d5c'

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

async function makeIcon(size, path, { maskable = false } = {}) {
  const img = PImage.make(size, size)
  const ctx = img.getContext('2d')
  const s = size / 64

  ctx.fillStyle = IVORY
  ctx.fillRect(0, 0, size, size)

  const inset = maskable ? 12 : 8
  const field = size - inset * 2 * s
  ctx.fillStyle = SAGE
  roundRect(ctx, inset * s, inset * s, field, field, 11 * s)
  ctx.fill()

  ctx.strokeStyle = IVORY
  ctx.lineWidth = 5 * s
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(size * 0.34, size * 0.52)
  ctx.lineTo(size * 0.45, size * 0.63)
  ctx.lineTo(size * 0.67, size * 0.39)
  ctx.stroke()

  await mkdir(dirname(path), { recursive: true })
  await PImage.encodePNGToStream(img, createWriteStream(path))
  console.log('wrote', path)
}

await makeIcon(192, resolve(root, 'public/pwa-192x192.png'))
await makeIcon(512, resolve(root, 'public/pwa-512x512.png'))
await makeIcon(180, resolve(root, 'public/apple-touch-icon.png'))
