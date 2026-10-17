'use strict'
// 生成 256×256 应用图标：Action Blue 圆角方形＋白色粗体 M
// 纯 Node 实现（zlib 内置），4× 超采样抗锯齿，输出 build/icon.png
const zlib = require('zlib')
const fs = require('fs')
const path = require('path')

const S = 256
const SS = 4
const BIG = S * SS
const RADIUS = 58
const BG = [0, 102, 204]
const FG = [255, 255, 255]

function inRoundedRect(x, y, w, h, r) {
  if (x < 0 || y < 0 || x >= w || y >= h) return false
  const nx = Math.max(r, Math.min(w - r, x))
  const ny = Math.max(r, Math.min(h - r, y))
  const dx = x - nx
  const dy = y - ny
  return dx * dx + dy * dy <= r * r
}

function distToSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1
  const dy = y2 - y1
  const len2 = dx * dx + dy * dy
  let t = len2 === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  const ex = px - (x1 + t * dx)
  const ey = py - (y1 + t * dy)
  return Math.sqrt(ex * ex + ey * ey)
}

// M 字形：左右竖笔＋中间下探的 V
const STROKES = [
  [72, 78, 72, 178],
  [184, 78, 184, 178],
  [72, 78, 128, 150],
  [184, 78, 128, 150],
]
const HALF_T = 17

function isM(x, y) {
  for (const s of STROKES) {
    if (distToSeg(x, y, s[0], s[1], s[2], s[3]) <= HALF_T) return true
  }
  return false
}

const img = new Uint8Array(S * S * 4)
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    let bgHits = 0
    let fgHits = 0
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const bx = x * SS + sx + 0.5
        const by = y * SS + sy + 0.5
        if (!inRoundedRect(bx, by, BIG, BIG, RADIUS * SS)) continue
        bgHits++
        if (isM(bx / SS, by / SS)) fgHits++
      }
    }
    const i = (y * S + x) * 4
    if (bgHits === 0) {
      img[i + 3] = 0
    } else {
      const f = fgHits / bgHits
      img[i] = Math.round(BG[0] * (1 - f) + FG[0] * f)
      img[i + 1] = Math.round(BG[1] * (1 - f) + FG[1] * f)
      img[i + 2] = Math.round(BG[2] * (1 - f) + FG[2] * f)
      img[i + 3] = Math.round((bgHits / (SS * SS)) * 255)
    }
  }
}

const CRC_TABLE = []
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  CRC_TABLE[n] = c >>> 0
}

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length)
  return out
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(S, 0)
ihdr.writeUInt32BE(S, 4)
ihdr[8] = 8
ihdr[9] = 6

const raw = Buffer.alloc(S * (S * 4 + 1))
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0
  Buffer.from(img.buffer, y * S * 4, S * 4).copy(raw, y * (S * 4 + 1) + 1)
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])

const outPath = path.join(__dirname, '..', 'build', 'icon.png')
fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, png)
console.log('icon written:', outPath, png.length, 'bytes')
