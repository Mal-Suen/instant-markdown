'use strict'
// 审计测试：main.js 的 decodeFileText / encodeFileText 编码探测与写回逻辑。
// 覆盖：UTF-8 BOM、UTF-16LE/BE、纯 UTF-8、GBK 回退、BOM 剥离、
// GBK 有损往返检测（返回 null）、各编码 encode→decode 往返一致性。

const test = require('node:test')
const assert = require('node:assert')
const { loadFunction } = require('./helpers/extract_fn')

let iconv = null
try {
  iconv = require('iconv-lite')
} catch {}

const decodeFileText = loadFunction('decodeFileText', {})
const encodeFileText = loadFunction('encodeFileText', { iconv })

test('decodeFileText：UTF-8 BOM 剥离并标记 utf-8-bom', () => {
  const body = Buffer.from('# 中文标题\n', 'utf8')
  const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body])
  const r = decodeFileText(buf)
  assert.strictEqual(r.encoding, 'utf-8-bom')
  assert.strictEqual(r.content, '# 中文标题\n')
})

test('decodeFileText：UTF-16LE 带 BOM 解码', () => {
  const body = Buffer.from('内容abc', 'utf16le')
  const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), body])
  const r = decodeFileText(buf)
  assert.strictEqual(r.encoding, 'utf-16le')
  assert.strictEqual(r.content, '内容abc')
})

test('decodeFileText：UTF-16BE 带 BOM 解码', () => {
  const le = Buffer.from('内容abc', 'utf16le')
  const be = Buffer.alloc(le.length)
  for (let i = 0; i + 1 < le.length; i += 2) {
    be[i] = le[i + 1]
    be[i + 1] = le[i]
  }
  const buf = Buffer.concat([Buffer.from([0xfe, 0xff]), be])
  const r = decodeFileText(buf)
  assert.strictEqual(r.encoding, 'utf-16be')
  assert.strictEqual(r.content, '内容abc')
})

test('decodeFileText：无 BOM 合法 UTF-8 判为 utf-8', () => {
  const r = decodeFileText(Buffer.from('# plain utf8\n', 'utf8'))
  assert.strictEqual(r.encoding, 'utf-8')
  assert.strictEqual(r.content, '# plain utf8\n')
})

test('decodeFileText：GBK 字节回退解码为 gbk', () => {
  const gbkBytes = Buffer.from([0xd6, 0xd0, 0xce, 0xc4]) // 「中文」GBK
  const r = decodeFileText(gbkBytes)
  assert.strictEqual(r.encoding, 'gbk')
  assert.strictEqual(r.content, '中文')
})

test('decodeFileText：空 Buffer 判为 utf-8', () => {
  const r = decodeFileText(Buffer.alloc(0))
  assert.strictEqual(r.encoding, 'utf-8')
  assert.strictEqual(r.content, '')
})

test('decodeFileText：仅 BOM 无正文', () => {
  const r = decodeFileText(Buffer.from([0xff, 0xfe]))
  assert.strictEqual(r.encoding, 'utf-16le')
  assert.strictEqual(r.content, '')
})

test('encodeFileText：utf-8-bom 写回带 BOM', () => {
  const buf = encodeFileText('正文', 'utf-8-bom')
  assert.ok(Buffer.isBuffer(buf))
  assert.strictEqual(buf[0], 0xef)
  assert.strictEqual(buf[1], 0xbb)
  assert.strictEqual(buf[2], 0xbf)
  assert.strictEqual(buf.subarray(3).toString('utf8'), '正文')
})

test('encodeFileText：utf-16le 写回带 BOM', () => {
  const buf = encodeFileText('正文', 'utf-16le')
  assert.strictEqual(buf[0], 0xff)
  assert.strictEqual(buf[1], 0xfe)
  assert.strictEqual(buf.subarray(2).toString('utf16le'), '正文')
})

test('encodeFileText：utf-16be 写回带 BOM 且字节序交换', () => {
  const buf = encodeFileText('正文', 'utf-16be')
  assert.strictEqual(buf[0], 0xfe)
  assert.strictEqual(buf[1], 0xff)
  assert.strictEqual(buf.subarray(2).swap16().toString('utf16le'), '正文')
})

test('encodeFileText：gbk 可表示字符写回成功', () => {
  const buf = encodeFileText('中文abc', 'gbk')
  assert.ok(Buffer.isBuffer(buf), 'GBK 可表示时应返回 Buffer')
  assert.strictEqual(buf.toString('hex'), 'd6d0cec4' + Buffer.from('abc').toString('hex'))
})

test('encodeFileText：gbk 不可表示字符返回 null（有损回退信号）', () => {
  const buf = encodeFileText('中文😀', 'gbk')
  assert.strictEqual(buf, null, '含 GBK 外字符时应返回 null 触发调用方回退')
})

test('encodeFileText：未知编码默认写 UTF-8', () => {
  const buf = encodeFileText('正文', 'whatever')
  assert.ok(Buffer.isBuffer(buf))
  assert.strictEqual(buf.toString('utf8'), '正文')
})

test('encode→decode 往返：四种编码均无损还原', () => {
  const text = '标题 abc 123\n- 列表项'
  for (const enc of ['utf-8', 'utf-8-bom', 'utf-16le', 'utf-16be']) {
    const buf = encodeFileText(text, enc)
    const back = decodeFileText(buf)
    assert.strictEqual(back.content, text, enc + ' 往返应无损')
    assert.strictEqual(back.encoding, enc)
  }
})
