import { NORM, ST } from "./hex-data-st"
import { TW_PHRASES, TW_VARIANTS_PHRASES, TW_VARIANTS } from "./hex-data-tw"

// ============================================================================
// 簡體中文 -> 台灣繁體（OpenCC s2tw / s2twp）
// ----------------------------------------------------------------------------
// 轉換順序（與 OpenCC s2twp.json 相同）：
//   1. CJK 相容表意文字正規化
//   2. mmseg 最長匹配切詞（STPhrases + 由台灣詞彙產生的簡體詞條）
//   3. 簡 -> 繁：STPhrases / 產生詞條 -> STCharacters
//   4. 台灣化（同一個 short-circuit 字典組，逐位置依序嘗試）：
//        TWPhrases -> TWVariantsPhrases -> TWVariants
//      s2tw 則省略 TWPhrases。
//
// 為什麼需要「由台灣詞彙產生的簡體詞條」：
//   OpenCC 的切詞只做一次，後面的 TWPhrases 只能在同一個切詞段內匹配。
//   例如「U盘」若被切成「U」+「盘」，就無法匹配 TWPhrases 的「U盤」。
//   因此把 TWPhrases/HKPhrases 的詞條用 t2s 反推成簡體，加入切詞與簡繁
//   轉換字典，讓「U盘」「内存」「软件」等能整段匹配。
//
// TWVariantsPhrases 必須排在 TWVariants 前面：它保護特定專有名詞，
// 例如「純喫茶」「張棟樑」，避免被 TWVariants 的「喫 -> 吃」等規則改掉。
// ============================================================================

function buildDict(raw) {
  const map = new Map()
  let max = 0
  for (const line of raw.split("\n")) {
    if (!line) continue
    const tab = line.indexOf("\t")
    if (tab < 0) {
      // value 與 key 相同
      map.set(line, line)
      if (line.length > max) max = line.length
      continue
    }
    const key = line.slice(0, tab)
    const value = line.slice(tab + 1)
    map.set(key, value)
    if (key.length > max) max = key.length
  }
  return { map, max }
}

function isMultiCodePoint(text) {
  const first = text.codePointAt(0)
  return first > 0xffff ? text.length > 2 : text.length > 1
}

function matchPrefix(dict, text, start, minLength) {
  let length = Math.min(dict.max, text.length - start)
  for (; length >= minLength; length--) {
    const value = dict.map.get(text.slice(start, start + length))
    if (value !== undefined) return { length, value }
  }
  return null
}

function matchSeg(text, start) {
  let length = Math.min(SEG_MAX, text.length - start)
  for (; length >= 2; length--) {
    if (SEG_KEYS.has(text.slice(start, start + length))) return length
  }
  return 0
}

function nextCharLength(text, index) {
  return text.codePointAt(index) > 0xffff ? 2 : 1
}

function normalizeText(text) {
  let out = ""
  for (const ch of text) out += NORM_DICT.map.get(ch) || ch
  return out
}

// mmseg：先找最長詞；找不到時，把連續「不能作為任何詞首」的字併成一段。
// 保留這些段的邊界很重要，因為後面的 TWPhrases 只在同一段內匹配。
function splitSegments(text) {
  const segments = []
  let index = 0
  while (index < text.length) {
    const matched = matchSeg(text, index)
    if (matched > 0) {
      segments.push(text.slice(index, index + matched))
      index += matched
      continue
    }
    let end = index + nextCharLength(text, index)
    while (end < text.length && !SEG_FIRST.has(text.codePointAt(end))) {
      end += nextCharLength(text, end)
    }
    segments.push(text.slice(index, end))
    index = end
  }
  return segments
}

function convertSegment(dict, text) {
  let out = ""
  let index = 0
  while (index < text.length) {
    const matched = matchPrefix(dict, text, index, 1)
    if (matched) {
      out += matched.value
      index += matched.length
    } else {
      const length = nextCharLength(text, index)
      out += text.slice(index, index + length)
      index += length
    }
  }
  return out
}

function convertTw(text, dicts) {
  let out = ""
  let index = 0
  while (index < text.length) {
    let matched = null
    for (const dict of dicts) {
      matched = matchPrefix(dict, text, index, 1)
      if (matched) break
    }
    if (matched) {
      out += matched.value
      index += matched.length
    } else {
      const length = nextCharLength(text, index)
      out += text.slice(index, index + length)
      index += length
    }
  }
  return out
}

const NORM_DICT = buildDict(NORM)
const ST_DICT = buildDict(ST)
const TW_PHRASES_DICT = buildDict(TW_PHRASES)
const TW_VARIANTS_PHRASES_DICT = buildDict(TW_VARIANTS_PHRASES)
const TW_VARIANTS_DICT = buildDict(TW_VARIANTS)

// 切詞字典 = ST 合併字典中「兩個字以上」的詞條，再加上 TWPhrases /
// TWVariantsPhrases 的詞條。後者讓「已經是繁體」的詞也能整段匹配，
// 例如 內存 -> 記憶體、純喫茶（避免被 喫 -> 吃 改掉）。
// 單字（含單一增補平面字）不列入切詞，否則會阻止連續字合併。
const SEG_KEYS = new Set()
const SEG_FIRST = new Set()
let SEG_MAX = 0
function addSegKey(key) {
  if (!isMultiCodePoint(key) || SEG_KEYS.has(key)) return
  SEG_KEYS.add(key)
  SEG_FIRST.add(key.codePointAt(0))
  if (key.length > SEG_MAX) SEG_MAX = key.length
}
for (const key of ST_DICT.map.keys()) addSegKey(key)
for (const key of TW_PHRASES_DICT.map.keys()) addSegKey(key)
for (const key of TW_VARIANTS_PHRASES_DICT.map.keys()) addSegKey(key)

function convertText(text, withTaiwanPhrases) {
  const dicts = withTaiwanPhrases
    ? [TW_PHRASES_DICT, TW_VARIANTS_PHRASES_DICT, TW_VARIANTS_DICT]
    : [TW_VARIANTS_PHRASES_DICT, TW_VARIANTS_DICT]
  const segments = splitSegments(normalizeText(text))
  let out = ""
  for (const segment of segments) {
    out += convertTw(convertSegment(ST_DICT, segment), dicts)
  }
  return out
}

export function convertS2TW(text) {
  return convertText(text, false)
}

export function convertS2TWP(text) {
  return convertText(text, true)
}
