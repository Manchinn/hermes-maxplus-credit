/**
 * MaxPlus Credit — Hermes desktop plugin (read-only, i18n EN/TH).
 *
 * Shows MaxPlus credit balance, usage statistics and API keys per pool (api.maxplus-ai.cc).
 *
 * - statusBar chip: credit balance (or key count), polls every 60s
 * - page /maxplus: hero balance + burn pace, account usage 1d/7d/30d,
 *   all-keys table (search / pool filter / sort by spend), per-key usage,
 *   token slots (ccsk + ccmk) — read-only
 * - palette: open status / refresh / clear tokens
 *
 * Tokens live in ctx.storage only.
 * Spec-compliant ctx.i18n.register({ en, th }) + internal language toggle (auto/en/th).
 */

import {
  STATUSBAR_AREAS,
  PALETTE_AREA,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ROUTES_AREA,
  SIDEBAR_NAV_AREA,
  host,
  haptic,
  useQuery,
  queryClient,
  atom,
  useValue,
  usePluginI18n,
} from '@hermes/plugin-sdk'
import { useState, useRef, useMemo } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const ID = 'maxplus-credit'
const API = 'https://api.maxplus-ai.cc'
const AUTH = 'Bear' + 'er'
const KEY_RE = /^ccsk-[a-f0-9]{64}$/
const MGMT_RE = /^ccmk-\S{8,}$/
const JEV_OFFICIAL_URL = 'https://api.typesafe.ai/v1/systemone'
const JEV_9ROUTER_URL = 'http://localhost:20128/v1/systemone'

/* ─── i18n message bundles ──────────────────────────────── */

const MESSAGES_EN = {
  chip: {
    noKey: 'MaxPlus: no key',
    loading: 'MaxPlus …',
    error: 'MaxPlus !',
    tooltip: 'MaxPlus — Click for summary',
    keysCount: (n) => `MaxPlus ${n} keys`,
  },
  popup: {
    header: (pool, active) => `Balance · pool ${pool} · ${active ? '✅ Active' : '❌ Inactive'}`,
    needToken: 'Enter ccsk-… in MaxPlus page first — management token alone is enough for key table',
    loading: 'Fetching /v1/me…',
  },
  common: {
    openFull: 'Open full page →',
    refresh: 'Refresh',
    refreshed: 'Refreshed MaxPlus',
    save: 'Save',
    change: 'Change',
    delete: 'Delete',
    loading: 'Loading…',
    unavailable: 'Unavailable',
    all: 'All',
    none: '— none —',
    copied: 'Copied to clipboard',
    copyFailed: 'Could not copy',
    lang: 'Language',
    langAuto: 'Auto',
    langEn: 'EN',
    langTh: 'TH',
    period1d: '24h',
    period7d: '7 days',
    period30d: '30 days',
  },
  hero: {
    title: 'Credit Balance',
    needToken: 'Enter ccsk-… below first — management token alone is enough for key table',
    loading: 'Fetching /v1/me…',
    header: (pool, active) => `Balance · pool ${pool} · ${active ? '✅ Active' : '❌ Inactive'}`,
    paceWaiting: 'Waiting for 7-day usage…',
    paceAverage: (perDay) => `Avg burn ${perDay}/day`,
    paceWarn: (perDay, days) => `Avg burn ${perDay}/day → ~${days} left ⚠️`,
    paceNormal: (perDay, days) => `Avg burn ${perDay}/day → ~${days} left`,
    lessThanDay: 'less than a day',
    daysCount: (days) => `${days} days`,
  },
  usage: {
    title: 'Account Usage',
    subtitle: '24h · Auto-refreshes every 15s',
    requests: 'requests',
    tokens: 'tokens',
    cost: 'cost',
  },
  keys: {
    title: 'All Pool Keys',
    titleWithCount: (n) => `All Pool Keys · ${n}`,
    titleWithCountAndSpend: (n, spent) => `All Pool Keys · ${n} keys · Total ${spent}`,
    needToken: 'Enter ccmk-… (scope keys:read + usage:read is sufficient)',
    loading: 'Fetching /v1/api-keys…',
    empty: 'No keys found in account',
    searchPlaceholder: 'Search key name…',
    allPools: (n) => `All (${n})`,
    shownSummary: (shown, total) => `Showing ${shown}/${total} · Sorted by spend`,
    noMatch: 'No keys match the criteria',
  },
  card: {
    active: '✅ Active',
    inactive: '❌ Inactive',
    accumulated: (spent) => `key total spent ${spent} · no cap`,
    capInfo: (cap, used, left) => `cap ${cap} · used ${used} · left ${left}`,
    freeTail: (time) => ` · resets ${time}`,
    freeEligible: (left, tail) => `Free credit ${left} · available for this pool${tail}`,
    freeIneligible: (amount, pools, tail) => `Free credit ${amount}/day${pools ? ` only for pool ${pools}` : ''} — not available for this pool${tail}`,
    freeQuota: (amt) => `quota ${amt}`,
    freeRemaining: (amt) => `remaining ${amt}`,
    showUsage: 'Show usage',
    hideUsage: 'Hide usage',
    fetchingUsage: 'Fetching…',
    keySpend: 'Key spend',
    keySpendTotal: 'Accumulated / key',
    viewDashboard: 'View in Dashboard',
    copyBaseUrlTooltip: 'Click to copy',
    copiedBaseUrl: (url) => `Copied base URL: ${url}`,
    copyFailedBaseUrl: (url) => `Could not copy, note manually: ${url}`,
    spendSummary: (active, used) => `${active ? '✅ Active' : '❌ Inactive'} · Total ${used}`,
  },
  token: {
    title: 'Tokens',
    inferenceLabel: 'inference (ccsk)',
    inferenceHint: 'Must be ccsk- followed by 64 hex characters',
    mgmtLabel: 'management (ccmk)',
    mgmtHint: 'Must start with ccmk- · sufficient to view all keys',
    formatError: (hint) => `Invalid format — ${hint}`,
    saved: (label) => `Saved ${label}`,
    deleted: (label) => `Deleted ${label}`,
  },
  palette: {
    openLabel: 'MaxPlus: Open Status Page',
    refreshLabel: 'MaxPlus: Refresh Credit',
    clearLabel: 'MaxPlus: Clear Tokens',
    clearedMessage: 'Deleted MaxPlus tokens',
  },
  probe: {
    title: 'Model Connection & Pool Inspector',
    subtitle: 'Verify real model availability and latency per pool with tiny probes',
    poolLabel: 'Target Pool',
    customPoolPlaceholder: 'Channel name (e.g. nonono)',
    keyLabel: 'API Key (ccsk)',
    keyPlaceholder: 'ccsk-… (defaults to active key)',
    jevModeLabel: 'Jev AI Assist',
    jevOfficial: 'Official TypeSafe',
    jev9router: '9Router Gateway',
    jevDisabled: 'Heuristic Only',
    jevTokenLabel: 'TypeSafe API Key',
    jevTokenPlaceholder: 'TypeSafe API key for Jev…',
    fetchModels: 'Fetch Models',
    fetchingModels: 'Fetching…',
    probeAll: 'Probe All',
    probingAll: 'Probing…',
    stopProbe: 'Stop',
    testSingle: 'Test',
    testingSingle: '…',
    statusOnline: 'Online',
    statusFailed: 'Failed',
    statusPending: 'Untested',
    allStatuses: 'All Statuses',
    allCategories: 'All Categories',
    catReasoning: 'Reasoning',
    catCoding: 'Coding',
    catVision: 'Vision',
    catGeneral: 'General',
    searchPlaceholder: 'Search model id…',
    noModels: 'No models found in this pool',
    noMatch: 'No models match filter',
    summaryText: (online, total, avgMs) => `${online}/${total} models online · Avg ${avgMs}ms`,
    needTokenOrKey: 'Please enter a valid ccsk- key to probe models on this pool',
    checkpointLabel: 'checkpoint',
    copyModelTooltip: 'Click to copy model ID',
    copiedModel: (m) => `Copied model ID: ${m}`,
  },
  errors: {
    'no-token': 'Token not set',
    network: 'Cannot connect to API (network/CORS)',
    'http-401': '401 Invalid or expired token',
    'http-402': '402 Credit depleted — top up at /dashboard/topup and wait ~30s',
    'http-403': '403 Permission denied or key not bound to pool',
    'http-404': '404 Path not found',
    'http-409': '409 Incorrect key type (text/image)',
    'http-429': '429 Rate limit or concurrent limit reached',
    'http-500': '500 Server error',
    'http-503': '503 Pool unavailable',
    'http-504': '504 Gateway timeout',
  },
}

const MESSAGES_TH = {
  chip: {
    noKey: 'MaxPlus: ไม่มี key',
    loading: 'MaxPlus …',
    error: 'MaxPlus !',
    tooltip: 'MaxPlus — กดดูสรุป',
    keysCount: (n) => `MaxPlus ${n} key`,
  },
  popup: {
    header: (pool, active) => `คงเหลือ · pool ${pool} · ${active ? '✅ เปิด' : '❌ ปิด'}`,
    needToken: 'ใส่ ccsk-… ในหน้า MaxPlus ก่อน — มีแค่ management token ก็ดูตาราง key ได้',
    loading: 'กำลังดึง /v1/me…',
  },
  common: {
    openFull: 'เปิดหน้าเต็ม →',
    refresh: 'รีเฟรช',
    refreshed: 'รีเฟรช MaxPlus แล้ว',
    save: 'บันทึก',
    change: 'เปลี่ยน',
    delete: 'ลบ',
    loading: 'กำลังโหลด…',
    unavailable: 'ดูไม่ได้',
    all: 'ทั้งหมด',
    none: '— ยังไม่มี —',
    copied: 'คัดลอกลงคลิปบอร์ดแล้ว',
    copyFailed: 'คัดลอกไม่สำเร็จ',
    lang: 'ภาษา',
    langAuto: 'อัตโนมัติ',
    langEn: 'EN',
    langTh: 'TH',
    period1d: '24 ชม.',
    period7d: '7 วัน',
    period30d: '30 วัน',
  },
  hero: {
    title: 'เครดิต',
    needToken: 'ใส่ ccsk-… ด้านล่างก่อน — มีแค่ management token ก็ดูตาราง key ได้',
    loading: 'กำลังดึง /v1/me…',
    header: (pool, active) => `คงเหลือ · pool ${pool} · ${active ? '✅ เปิด' : '❌ ปิด'}`,
    paceWaiting: 'รอ usage 7 วัน…',
    paceAverage: (perDay) => `เผาเฉลี่ย ${perDay}/วัน`,
    paceWarn: (perDay, days) => `เผาเฉลี่ย ${perDay}/วัน → เหลือ ~${days} ⚠️`,
    paceNormal: (perDay, days) => `เผาเฉลี่ย ${perDay}/วัน → เหลือ ~${days}`,
    lessThanDay: 'ไม่ถึงวัน',
    daysCount: (days) => `${days} วัน`,
  },
  usage: {
    title: 'usage บัญชี',
    subtitle: '24 ชม. รีเฟรชทุก 15 วิ',
    requests: 'requests',
    tokens: 'tokens',
    cost: 'cost',
  },
  keys: {
    title: 'key ทุก pool',
    titleWithCount: (n) => `key ทุก pool · ${n}`,
    titleWithCountAndSpend: (n, spent) => `key ทุก pool · ${n} keys · ยอดสะสม ${spent}`,
    needToken: 'ใส่ ccmk-… (scope keys:read + usage:read ก็พอ)',
    loading: 'กำลังดึง /v1/api-keys…',
    empty: 'ไม่มี key ในบัญชี',
    searchPlaceholder: 'ค้นชื่อ key…',
    allPools: (n) => `ทั้งหมด (${n})`,
    shownSummary: (shown, total) => `โชว์ ${shown}/${total} · เรียงตามยอดใช้สะสม`,
    noMatch: 'ไม่เจอ key ตรงเงื่อนไข',
  },
  card: {
    active: '✅ เปิด',
    inactive: '❌ ปิด',
    accumulated: (spent) => `key นี้ใช้สะสม ${spent} · ไม่จำกัด cap`,
    capInfo: (cap, used, left) => `cap ${cap} · ใช้ไป ${used} · เหลือ ${left}`,
    freeTail: (time) => ` · รีเซ็ต ${time}`,
    freeEligible: (left, tail) => `เครดิตฟรี ${left} · pool นี้ใช้ได้${tail}`,
    freeIneligible: (amount, pools, tail) => `เครดิตฟรี ${amount}/วัน${pools ? ` เฉพาะ pool ${pools}` : ''} — pool นี้ใช้ไม่ได้${tail}`,
    freeQuota: (amt) => `โควตา ${amt}`,
    freeRemaining: (amt) => `เหลือ ${amt}`,
    showUsage: 'ดู usage',
    hideUsage: 'ซ่อน usage',
    fetchingUsage: 'กำลังดึง…',
    keySpend: 'ยอดใช้ key',
    keySpendTotal: 'ใช้สะสม/key',
    viewDashboard: 'ดูใน Dashboard',
    copyBaseUrlTooltip: 'กดเพื่อ copy',
    copiedBaseUrl: (url) => `copy base URL แล้ว: ${url}`,
    copyFailedBaseUrl: (url) => `copy ไม่ได้ จดเอง: ${url}`,
    spendSummary: (active, used) => `${active ? '✅ เปิด' : '❌ ปิด'} · สะสม ${used}`,
  },
  token: {
    title: 'tokens',
    inferenceLabel: 'inference (ccsk)',
    inferenceHint: 'ต้อง ccsk- ตามด้วย hex 64 ตัว',
    mgmtLabel: 'management (ccmk)',
    mgmtHint: 'ต้องขึ้นต้น ccmk- · ดู key ทุก pool แค่นี้ก็พอ',
    formatError: (hint) => `รูปแบบไม่ถูก — ${hint}`,
    saved: (label) => `บันทึก ${label} แล้ว`,
    deleted: (label) => `ลบ ${label} แล้ว`,
  },
  palette: {
    openLabel: 'MaxPlus: เปิดหน้าสถานะ',
    refreshLabel: 'MaxPlus: รีเฟรชเครดิต',
    clearLabel: 'MaxPlus: ลบ tokens',
    clearedMessage: 'ลบ MaxPlus tokens แล้ว',
  },
  probe: {
    title: 'ตรวจสอบการเชื่อมต่อ Model ใน Pool',
    subtitle: 'ตรวจสถานะจริงและ Latency ของแต่ละโมเดลด้วย tiny probe',
    poolLabel: 'Pool ที่ต้องการตรวจ',
    customPoolPlaceholder: 'ชื่อ channel (เช่น nonono)',
    keyLabel: 'API Key (ccsk)',
    keyPlaceholder: 'ccsk-… (ค่าเริ่มต้นใช้คีย์หลัก)',
    jevModeLabel: 'ตัวช่วย Jev AI',
    jevOfficial: 'ทางการ (TypeSafe Official)',
    jev9router: '9Router (Local Gateway)',
    jevDisabled: 'ใช้กฎพื้นฐาน (Heuristic)',
    jevTokenLabel: 'TypeSafe API Key',
    jevTokenPlaceholder: 'ใส่ TypeSafe API key สำหรับ Jev…',
    fetchModels: 'ดึงรายชื่อโมเดล',
    fetchingModels: 'กำลังดึง…',
    probeAll: 'ทดสอบทั้งหมด',
    probingAll: 'กำลังทดสอบ…',
    stopProbe: 'หยุด',
    testSingle: 'ทดสอบ',
    testingSingle: '…',
    statusOnline: 'ใช้งานได้',
    statusFailed: 'มีปัญหา',
    statusPending: 'ยังไม่ตรวจ',
    allStatuses: 'ทุกสถานะ',
    allCategories: 'ทุกหมวด',
    catReasoning: 'สายคิดวิเคราะห์ (Reasoning)',
    catCoding: 'สายโค้ด (Coding)',
    catVision: 'สายภาพ (Vision)',
    catGeneral: 'แชททั่วไป (General)',
    searchPlaceholder: 'ค้นหาชื่อโมเดล…',
    noModels: 'ไม่พบโมเดลใน pool นี้',
    noMatch: 'ไม่มีโมเดลที่ตรงกับตัวกรอง',
    summaryText: (online, total, avgMs) => `ใช้งานได้ ${online}/${total} ตัว · Latency เฉลี่ย ${avgMs}ms`,
    needTokenOrKey: 'โปรดระบุคีย์ ccsk- เพื่อทดสอบโมเดลใน pool นี้',
    checkpointLabel: 'checkpoint จริง',
    copyModelTooltip: 'กดเพื่อ copy ชื่อ model',
    copiedModel: (m) => `copy model ID แล้ว: ${m}`,
  },
  errors: {
    'no-token': 'ยังไม่ได้ตั้ง token',
    network: 'ต่อ API ไม่ได้ (เน็ต/CORS)',
    'http-401': '401 token ผิด/หมดอายุ',
    'http-402': '402 เครดิตหมด — เติมที่ /dashboard/topup แล้วรอ ~30s',
    'http-403': '403 สิทธิ์ไม่พอ หรือ key ไม่ผูก pool',
    'http-404': '404 path ผิด',
    'http-409': '409 key ผิดประเภท (text/image)',
    'http-429': '429 ชน cap/concurrent',
    'http-500': '500 เซิร์ฟเวอร์มีปัญหา',
    'http-503': '503 pool ล่ม',
    'http-504': '504 timeout',
  },
}

function resolveMsg(dict, key, args = []) {
  if (!dict) return null
  const val = key.split('.').reduce((acc, part) => (acc && typeof acc === 'object' ? acc[part] : undefined), dict)
  if (typeof val === 'string') return val
  if (typeof val === 'function') return val(...args)
  return null
}

function errKey(err) {
  const m = String((err && err.message) || err || '')
  if (m === 'no-token' || m === 'network') return m
  const h = m.match(/http-(\d{3})/)
  return h ? `http-${h[1]}` : 'network'
}

function fmtUsd(n) {
  return typeof n === 'number' && Number.isFinite(n) ? `$${n.toFixed(2)}` : '—'
}

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']

function fmtReset(iso, isTh) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const p = (n) => String(n).padStart(2, '0')
  const mList = isTh === false ? MONTHS_EN : MONTHS_TH
  return `${d.getDate()} ${mList[d.getMonth()]} ${p(d.getHours())}:${p(d.getMinutes())}`
}

const ERR_TH = MESSAGES_TH.errors

function freeLine(free, tr, isTh) {
  if (!free || !free.enabled || typeof free.amount !== 'number' || free.amount <= 0) return null
  if (tr) {
    const reset = fmtReset(free.resetAt, isTh)
    const tail = reset ? tr('card.freeTail', reset) : ''
    const poolTxt = Array.isArray(free.pools) && free.pools.length ? free.pools.join(', ') : null
    if (free.eligible) {
      const left = typeof free.remainingForKeyPool === 'number' ? free.remainingForKeyPool : free.remaining
      const leftTxt = typeof left === 'number' ? tr('card.freeRemaining', fmtUsd(left)) : tr('card.freeQuota', fmtUsd(free.amount))
      return tr('card.freeEligible', leftTxt, tail)
    }
    return tr('card.freeIneligible', fmtUsd(free.amount), poolTxt, tail)
  }
  const reset = fmtReset(free.resetAt, true)
  const tail = reset ? ` · รีเซ็ต ${reset}` : ''
  const poolTxt = Array.isArray(free.pools) && free.pools.length ? free.pools.join(', ') : null
  if (free.eligible) {
    const left = typeof free.remainingForKeyPool === 'number' ? free.remainingForKeyPool : free.remaining
    const leftTxt = typeof left === 'number' ? `เหลือ ${fmtUsd(left)}` : `โควตา ${fmtUsd(free.amount)}`
    return `เครดิตฟรี ${leftTxt} · pool นี้ใช้ได้${tail}`
  }
  return `เครดิตฟรี ${fmtUsd(free.amount)}/วัน${poolTxt ? ` เฉพาะ pool ${poolTxt}` : ''} — pool นี้ใช้ไม่ได้${tail}`
}

function totalsOf(json) {
  return (json && json.totals) || json || {}
}

function costOf(t) {
  const v = t && (t.total_cost_usd ?? t.total_cost ?? t.cost_usd)
  return typeof v === 'number' ? v : null
}

function fmtTokens(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(Math.round(n))
}

function tokensOf(t) {
  if (!t || typeof t !== 'object') return 0
  const pick = (...ks) => {
    for (const k of ks) if (typeof t[k] === 'number') return t[k]
    return 0
  }
  return (
    pick('input_tokens', 'prompt_tokens', 'input') +
    pick('output_tokens', 'completion_tokens', 'output') +
    pick('cache_read_tokens', 'cache_creation_tokens', 'cache_tokens')
  )
}

function pickKey(me) {
  const k = (me && me.key) || {}
  const f = (me && me.daily_free_credit) || {}
  return {
    pool: k.pool || k.key_pool || f.key_pool || '—',
    limit: k.limit_usd ?? null,
    used: k.limit_used_usd ?? null,
    period: k.limit_period ?? null,
    active: k.active ?? null,
    free: {
      enabled: !!f.enabled,
      amount: typeof f.amount_usd === 'number' ? f.amount_usd : null,
      used: typeof f.used_usd === 'number' ? f.used_usd : null,
      reserved: typeof f.reserved_usd === 'number' ? f.reserved_usd : null,
      remaining: typeof f.remaining_usd === 'number' ? f.remaining_usd : null,
      pools: Array.isArray(f.pools) ? f.pools : [],
      resetAt: f.reset_at || null,
      eligible: !!f.eligible_for_key_pool,
      remainingForKeyPool: typeof f.remaining_for_key_pool_usd === 'number' ? f.remaining_for_key_pool_usd : null,
    },
  }
}

function pickKeyList(json) {
  const d = (json && json.data) || json || {}
  const arr = Array.isArray(d.keys) ? d.keys : Array.isArray(d) ? d : []
  return arr.filter((k) => k && typeof k === 'object')
}

function maskToken(t) {
  if (!t) return '—'
  return t.length > 12 ? `${t.slice(0, 5)}…${t.slice(-4)}` : `${t.slice(0, 5)}…`
}

function Row({ label, value }) {
  return jsxs('div', {
    className: 'flex items-center justify-between gap-2 py-0.5 text-sm',
    children: [
      jsx('span', { className: 'shrink-0 text-(--ui-text-tertiary)', children: label }),
      jsx('span', { className: 'truncate font-mono tabular-nums', children: value }),
    ],
  })
}

function Section({ title, right, children }) {
  return jsxs('div', {
    className: 'flex flex-col gap-1 rounded-md border border-(--ui-stroke-secondary) p-2.5',
    children: [
      jsxs('div', {
        className: 'flex items-center justify-between gap-2',
        children: [
          jsx('div', { className: 'text-xs font-medium text-(--ui-text-tertiary)', children: title }),
          right || null,
        ],
      }),
      children,
    ],
  })
}

function CapInfo({ k, fallback, tr }) {
  if (typeof k.limit === 'number' && typeof k.used === 'number') {
    return jsxs('div', {
      className: 'flex flex-col gap-0.5',
      children: [
        jsx(SpendBar, { ratio: k.used / k.limit }),
        jsx('div', {
          className: 'text-xs text-(--ui-text-tertiary)',
          children: tr('card.capInfo', fmtUsd(k.limit), fmtUsd(k.used), fmtUsd(k.limit - k.used)),
        }),
      ],
    })
  }
  if (fallback) {
    return jsx('div', {
      className: 'text-xs text-(--ui-text-tertiary)',
      children: tr('card.accumulated', fmtUsd(k.used)),
    })
  }
  return null
}

function SpendBar({ ratio }) {
  const pct = Math.max(0, Math.min(100, Math.round((ratio || 0) * 100)))
  return jsx('div', {
    style: { height: 6, width: '100%', borderRadius: 9999, background: 'var(--ui-stroke-secondary)' },
    children: jsx('div', {
      style: { height: 6, width: `${pct}%`, borderRadius: 9999, background: 'var(--ui-accent)' },
    }),
  })
}

function baseFor(pool) {
  const p = String(pool || 'auto').trim()
  if (p === 'native' || p === 'v1' || !p || p === 'auto') return `${API}/v1`
  return `${API}/${p}/v1`
}

function isReasoningModel(id) {
  if (!id || typeof id !== 'string') return false
  const s = id.toLowerCase()
  return /r1|reason|think|deepseek-v4\.1|o1|o3|opus-4\.[6-8]-thinking/.test(s)
}

function classifyModelCategory(id) {
  if (!id || typeof id !== 'string') return 'general'
  const s = id.toLowerCase()
  if (isReasoningModel(s)) return 'reasoning'
  if (/code|coder|dev|swe|program/.test(s)) return 'coding'
  if (/vision|vl|omni|image|multimodal/.test(s)) return 'vision'
  return 'general'
}

function buildProbePayload(modelId, isReasoning) {
  return {
    model: modelId,
    messages: [{ role: 'user', content: 'ping' }],
    max_tokens: isReasoning ? 80 : 8,
  }
}

function parseProbeResponse(status, json, durationMs) {
  const ok = status === 200
  let errorMsg = null
  let checkpoint = null
  if (json) {
    if (json.model) checkpoint = String(json.model)
    if (json.error) {
      errorMsg = typeof json.error === 'string' ? json.error : (json.error.message || JSON.stringify(json.error))
    }
  }
  return {
    status,
    ok,
    latencyMs: Math.max(0, Math.round(durationMs || 0)),
    checkpoint,
    error: errorMsg,
  }
}

async function classifyWithJev({ provider, token, modelId, endpointOverride }) {
  const fallback = {
    isReasoning: isReasoningModel(modelId),
    category: classifyModelCategory(modelId),
    source: 'heuristic',
  }
  if (!provider || provider === 'disabled') {
    return fallback
  }

  const endpoint = endpointOverride || (provider === 'official' ? JEV_OFFICIAL_URL : JEV_9ROUTER_URL)
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `${AUTH} ${token}`

  const model = provider === 'official' ? 'jev-latest' : 'ocz/jev-1.13-free'
  const body = JSON.stringify({
    model,
    state: `Model ID is ${modelId}. Classify its capabilities for probe testing.`,
    questions: {
      is_reasoning: {
        type: 'noul',
        instructions: 'Is this model a reasoning, chain-of-thought, or thinking model that requires a larger completion token budget?',
      },
      category: {
        type: 'choice',
        criteria: {
          reasoning: 'Reasoning or thinking model',
          coding: 'Dedicated code generation or engineering model',
          vision: 'Vision or multimodal model',
          general: 'General conversation or standard instruction chat',
        },
      },
    },
  })

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 6000)
    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!res.ok) return fallback
    const data = await res.json()
    const answers = data && data.answers
    if (!answers) return fallback

    const noulVal = answers.is_reasoning?.noul ?? answers.is_reasoning?.probability ?? 0
    const catChoice = answers.category?.choice || fallback.category

    return {
      isReasoning: noulVal >= 0.5 || isReasoningModel(modelId),
      category: catChoice,
      source: `jev-${provider}`,
    }
  } catch {
    return fallback
  }
}

async function probeModel({ baseUrl, token, modelId, isReasoning, timeoutMs = 15000, signal }) {
  const url = `${baseUrl}/chat/completions`
  const payload = buildProbePayload(modelId, isReasoning)
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `${AUTH} ${token}`,
  }

  const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  const onAbort = () => controller.abort()
  if (signal) signal.addEventListener('abort', onAbort)

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (signal) signal.removeEventListener('abort', onAbort)
    const t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()
    let json = null
    try {
      json = await res.json()
    } catch {}
    return parseProbeResponse(res.status, json, t1 - t0)
  } catch (err) {
    clearTimeout(timer)
    if (signal) signal.removeEventListener('abort', onAbort)
    const t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()
    const isTimeout = err.name === 'AbortError'
    return {
      status: isTimeout ? 504 : 0,
      ok: false,
      latencyMs: Math.max(0, Math.round(t1 - t0)),
      checkpoint: null,
      error: isTimeout ? 'Timeout (>15s)' : 'Network / Connection error',
    }
  }
}

export default {
  id: ID,
  name: 'MaxPlus Credit',
  defaultEnabled: false,
  register(ctx) {
    ctx.i18n.register({ en: MESSAGES_EN, th: MESSAGES_TH })

    const $token = atom(ctx.storage.get('token', ''))
    const $mgmt = atom(ctx.storage.get('mgmt', ''))
    const $lang = atom(ctx.storage.get('lang', 'auto'))
    const $jevProvider = atom(ctx.storage.get('jev_provider', 'official'))
    const $jevToken = atom(ctx.storage.get('typesafe_key', ''))
    const $probePool = atom(ctx.storage.get('probe_pool', 'native'))

    try { ctx.storage.remove('baseline') } catch {}

    function setStored($a, storeKey, t) {
      if (t) ctx.storage.set(storeKey, t)
      else ctx.storage.remove(storeKey)
      $a.set(t)
    }

    function setLang(l) {
      if (l && l !== 'auto') ctx.storage.set('lang', l)
      else ctx.storage.remove('lang')
      $lang.set(l || 'auto')
    }

    function useT() {
      const appT = usePluginI18n(ID)
      const userLang = useValue($lang)
      return (key, ...args) => {
        if (userLang === 'th') {
          return resolveMsg(MESSAGES_TH, key, args) ?? resolveMsg(MESSAGES_EN, key, args) ?? key
        }
        if (userLang === 'en') {
          return resolveMsg(MESSAGES_EN, key, args) ?? key
        }
        return appT(key, ...args)
      }
    }

    function t(key, ...args) {
      const userLang = $lang.get()
      if (userLang === 'th') {
        return resolveMsg(MESSAGES_TH, key, args) ?? resolveMsg(MESSAGES_EN, key, args) ?? key
      }
      if (userLang === 'en') {
        return resolveMsg(MESSAGES_EN, key, args) ?? key
      }
      return ctx.i18n.t(key, ...args)
    }

    function getErrorMessage(err, translator) {
      const k = errKey(err)
      return translator(`errors.${k}`) || translator('common.unavailable')
    }

    async function apiWith(token, path) {
      if (!token) throw new Error('no-token')
      let res
      try {
        res = await fetch(`${API}${path}`, {
          headers: { Authorization: `${AUTH} ${token}` },
        })
      } catch {
        throw new Error('network')
      }
      if (!res.ok) throw new Error(`http-${res.status}`)
      return res.json()
    }

    const fetchMe = () => apiWith($token.get(), '/v1/me')
    const fetchUsage = (period) => apiWith($token.get(), `/v1/usage?period=${period}`)
    const fetchKeys = () => apiWith($mgmt.get(), '/v1/api-keys')

    // baseFor is now defined in top-level helpers

    function useMeQuery() {
      const token = useValue($token)
      return useQuery({
        queryKey: [ID, 'me'],
        queryFn: fetchMe,
        enabled: !!token,
        refetchInterval: 60000,
        retry: false,
      })
    }

    function useKeysQuery() {
      const mgmt = useValue($mgmt)
      return useQuery({
        queryKey: [ID, 'keys'],
        queryFn: fetchKeys,
        enabled: !!mgmt,
        refetchInterval: 60000,
        retry: false,
      })
    }

    function useUsageQuery(period) {
      const token = useValue($token)
      return useQuery({
        queryKey: [ID, 'usage', period],
        queryFn: () => fetchUsage(period),
        enabled: !!token,
        refetchInterval: period === '1d' ? 15000 : 300000,
        retry: false,
      })
    }

    /* ─── Language switcher ─────────────────────────── */

    function LangSwitch() {
      const lang = useValue($lang)
      const tr = useT()
      return jsxs('div', {
        className: 'flex items-center gap-0.5 rounded-sm border border-(--ui-stroke-secondary) p-0.5 text-xs',
        children: [
          jsx('button', {
            type: 'button',
            onClick: () => {
              haptic('tap')
              setLang('auto')
            },
            className: `rounded px-1.5 py-0.5 text-[0.6875rem] transition-colors ${
              lang === 'auto' ? 'bg-blue-500/20 text-blue-300 font-medium' : 'text-(--ui-text-tertiary) hover:text-foreground'
            }`,
            title: 'Auto (Follow App Language)',
            children: tr('common.langAuto'),
          }),
          jsx('button', {
            type: 'button',
            onClick: () => {
              haptic('tap')
              setLang('en')
            },
            className: `rounded px-1.5 py-0.5 text-[0.6875rem] transition-colors ${
              lang === 'en' ? 'bg-blue-500/20 text-blue-300 font-medium' : 'text-(--ui-text-tertiary) hover:text-foreground'
            }`,
            children: tr('common.langEn'),
          }),
          jsx('button', {
            type: 'button',
            onClick: () => {
              haptic('tap')
              setLang('th')
            },
            className: `rounded px-1.5 py-0.5 text-[0.6875rem] transition-colors ${
              lang === 'th' ? 'bg-blue-500/20 text-blue-300 font-medium' : 'text-(--ui-text-tertiary) hover:text-foreground'
            }`,
            children: tr('common.langTh'),
          }),
        ],
      })
    }

    function ChipPopup() {
      const token = useValue($token)
      const me = useMeQuery()
      const [period, setPeriod] = useState('1d')
      const tr = useT()
      const currentLang = useValue($lang)
      const isTh = currentLang === 'th'

      const refresh = () => {
        haptic('tap')
        queryClient.invalidateQueries({ queryKey: [ID] })
      }
      const openFull = () => {
        haptic('tap')
        host.navigate('/maxplus')
      }
      const footer = jsxs('div', {
        className: 'flex gap-1.5',
        children: [
          jsx('button', {
            type: 'button',
            onClick: openFull,
            className: 'flex-1 rounded-sm border border-(--ui-stroke-secondary) px-2 py-1 text-xs hover:bg-(--chrome-action-hover)',
            children: tr('common.openFull'),
          }),
          jsx('button', {
            type: 'button',
            onClick: refresh,
            className: 'shrink-0 rounded-sm border border-(--ui-stroke-secondary) px-2 py-1 text-xs hover:bg-(--chrome-action-hover)',
            children: tr('common.refresh'),
          }),
        ],
      })
      if (!token) {
        return jsxs('div', {
          className: 'flex flex-col gap-1.5',
          children: [
            jsx('div', { className: 'text-sm text-(--ui-text-tertiary)', children: tr('popup.needToken') }),
            footer,
          ],
        })
      }
      if (me.isLoading) {
        return jsxs('div', {
          className: 'flex flex-col gap-1.5',
          children: [
            jsx('div', { className: 'text-sm text-(--ui-text-tertiary)', children: tr('popup.loading') }),
            footer,
          ],
        })
      }
      if (me.error) {
        return jsxs('div', {
          className: 'flex flex-col gap-1.5',
          children: [
            jsx('div', { className: 'text-sm', children: getErrorMessage(me.error, tr) }),
            footer,
          ],
        })
      }
      const k = pickKey(me.data)
      const bal = me.data && me.data.credit_usd
      const freeText = freeLine(k.free, tr, isTh)

      const periodsList = [
        { id: '1d', label: tr('common.period1d') },
        { id: '7d', label: tr('common.period7d') },
        { id: '30d', label: tr('common.period30d') },
      ]

      return jsxs('div', {
        style: { maxHeight: '60vh', overflowY: 'auto' },
        className: 'flex flex-col gap-2',
        children: [
          jsxs('div', {
            className: 'flex flex-col gap-0.5',
            children: [
              jsx('div', { className: 'text-xs text-(--ui-text-tertiary)', children: tr('popup.header', k.pool, k.active !== false) }),
              jsx('div', {
                style: { fontSize: 26, fontWeight: 650, lineHeight: 1.15 },
                className: 'font-mono tabular-nums',
                children: fmtUsd(bal),
              }),
              freeText ? jsx('div', { className: 'text-xs text-(--ui-text-tertiary)', children: freeText }) : null,
              jsx(CapInfo, { k, tr }),
            ],
          }),
          jsxs('div', {
            className: 'flex flex-col gap-1 border-t border-(--ui-stroke-secondary) pt-1.5',
            children: [
              jsxs('div', {
                className: 'flex gap-1',
                children: periodsList.map((p) => jsx('button', {
                  type: 'button',
                  onClick: () => {
                    haptic('tap')
                    setPeriod(p.id)
                  },
                  className: 'flex-1 rounded-sm border px-2 py-0.5 text-xs ' + (period === p.id
                    ? 'border-(--ui-accent) text-foreground'
                    : 'border-(--ui-stroke-secondary) text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover)'),
                  children: p.label,
                }, p.id)),
              }),
              jsx(UsageBlock, { period, label: '' }),
            ],
          }),
          footer,
        ],
      })
    }

    function Chip() {
      const token = useValue($token)
      const mgmt = useValue($mgmt)
      const me = useMeQuery()
      const keys = useKeysQuery()
      const tr = useT()

      let label = tr('chip.noKey')
      if (token) {
        if (me.data) {
          const c = me.data.credit_usd
          label = typeof c === 'number' ? `MaxPlus $${c.toFixed(2)}` : 'MaxPlus'
        } else if (me.isLoading) label = tr('chip.loading')
        else if (me.error) label = tr('chip.error')
      } else if (mgmt) {
        if (keys.data) label = tr('chip.keysCount', pickKeyList(keys.data).length)
        else if (keys.isLoading) label = tr('chip.loading')
        else if (keys.error) label = tr('chip.error')
      }
      return jsxs(Popover, {
        children: [
          jsx(PopoverTrigger, {
            asChild: true,
            children: jsx('button', {
              type: 'button',
              title: tr('chip.tooltip'),
              className: 'inline-flex h-full items-center gap-1 px-1.5 text-[0.6875rem] text-(--ui-text-tertiary) transition-colors hover:bg-(--chrome-action-hover) hover:text-foreground',
              onClick: () => {
                haptic('tap')
              },
              children: label,
            }),
          }),
          jsx(PopoverContent, {
            side: 'top',
            align: 'end',
            sideOffset: 8,
            collisionPadding: 12,
            className: 'z-[1000] w-72 p-3',
            children: jsx(ChipPopup, {}),
          }),
        ],
      })
    }

    function TokenField({ $a, storeKey, label, placeholder, pattern, hint }) {
      const cur = useValue($a)
      const [draft, setDraft] = useState('')
      const tr = useT()
      const save = () => {
        const str = draft.trim()
        if (str && !pattern.test(str)) {
          host.notify({ kind: 'info', message: tr('token.formatError', hint) })
          return
        }
        setStored($a, storeKey, str)
        setDraft('')
        queryClient.invalidateQueries({ queryKey: [ID] })
        host.notify({ kind: 'info', message: str ? tr('token.saved', label) : tr('token.deleted', label) })
      }
      return jsxs('div', {
        className: 'flex flex-col gap-1.5',
        children: [
          jsx(Row, { label, value: cur ? maskToken(cur) : tr('common.none') }),
          jsxs('div', {
            className: 'flex gap-1.5',
            children: [
              jsx('input', {
                type: 'password',
                value: draft,
                spellCheck: false,
                autoComplete: 'off',
                placeholder,
                onChange: (e) => setDraft(e.target.value),
                onKeyDown: (e) => {
                  if (e.key === 'Enter') save()
                },
                className: 'min-w-0 flex-1 rounded-sm border border-(--ui-stroke-secondary) bg-transparent px-1.5 py-1 font-mono text-xs',
              }),
              jsx('button', {
                type: 'button',
                onClick: save,
                className: 'shrink-0 rounded-sm border border-(--ui-stroke-secondary) px-2 py-1 text-xs hover:bg-(--chrome-action-hover)',
                children: cur ? tr('common.change') : tr('common.save'),
              }),
              cur
                ? jsx('button', {
                    type: 'button',
                    onClick: () => {
                      setStored($a, storeKey, '')
                      setDraft('')
                      queryClient.invalidateQueries({ queryKey: [ID] })
                      host.notify({ kind: 'info', message: tr('token.deleted', label) })
                    },
                    className: 'shrink-0 rounded-sm border border-(--ui-stroke-secondary) px-2 py-1 text-xs hover:bg-(--chrome-action-hover)',
                    children: tr('common.delete'),
                  })
                : null,
            ],
          }),
        ],
      })
    }

    function UsageBlock({ period, label }) {
      const token = useValue($token)
      const q = useUsageQuery(period)
      const tr = useT()
      if (!token) return null
      if (q.isLoading) return jsx('div', { className: 'text-sm text-(--ui-text-tertiary)', children: `${label}${tr('common.loading')}` })
      if (q.error) return jsx('div', { className: 'text-sm text-(--ui-text-tertiary)', children: `${label}${getErrorMessage(q.error, tr)}` })
      const tData = totalsOf(q.data)
      const req = tData.request_count ?? tData.requests ?? null
      const tok = tokensOf(tData)
      return jsxs('div', {
        className: 'flex flex-col gap-0.5',
        children: [
          req != null ? jsx(Row, { label: `${label}${tr('usage.requests')}`, value: String(req) }) : null,
          tok ? jsx(Row, { label: `${label}${tr('usage.tokens')}`, value: fmtTokens(tok) }) : null,
          jsx(Row, { label: `${label}${tr('usage.cost')}`, value: fmtUsd(costOf(tData)) }),
        ],
      })
    }

    function KeyCard({ k }) {
      const tr = useT()
      const used = typeof k.used_usd === 'number' ? k.used_usd : null
      const curPool = String(k.pool || 'auto')
      const copyBase = async () => {
        const ok = await ctx.os.writeClipboard(baseFor(curPool))
        host.notify({ kind: 'info', message: ok ? tr('card.copiedBaseUrl', baseFor(curPool)) : tr('card.copyFailedBaseUrl', baseFor(curPool)) })
      }
      return jsxs('div', {
        className: 'flex flex-col gap-1 rounded-sm border border-(--ui-stroke-secondary) p-1.5',
        children: [
          jsxs('div', {
            className: 'flex items-center justify-between gap-2',
            children: [
              jsx('span', { className: 'truncate text-sm font-medium', children: k.name || k.id }),
              jsx('span', {
                className: 'shrink-0 font-mono text-xs text-(--ui-text-tertiary)',
                children: tr('card.spendSummary', k.active !== false, fmtUsd(used)),
              }),
            ],
          }),
          jsx(Row, { label: 'pool', value: curPool }),
          jsxs('div', {
            className: 'flex items-center justify-between gap-2 py-0.5 text-sm',
            children: [
              jsx('span', { className: 'shrink-0 text-(--ui-text-tertiary)', children: 'base URL' }),
              jsx('button', {
                type: 'button',
                title: tr('card.copyBaseUrlTooltip'),
                onClick: copyBase,
                className: 'truncate font-mono text-xs tabular-nums hover:bg-(--chrome-action-hover)',
                children: baseFor(curPool),
              }),
            ],
          }),
        ],
      })
    }

    function KeysSection() {
      const mgmt = useValue($mgmt)
      const q = useKeysQuery()
      const tr = useT()
      const [poolFilter, setPoolFilter] = useState('all')
      const [text, setText] = useState('')
      if (!mgmt) {
        return jsx(Section, {
          title: tr('keys.title'),
          children: jsx('div', { className: 'text-sm text-(--ui-text-tertiary)', children: tr('keys.needToken') }),
        })
      }
      if (q.isLoading) {
        return jsx(Section, { title: tr('keys.title'), children: jsx('div', { className: 'text-sm text-(--ui-text-tertiary)', children: tr('keys.loading') }) })
      }
      if (q.error) {
        return jsx(Section, { title: tr('keys.title'), children: jsx('div', { className: 'text-sm', children: getErrorMessage(q.error, tr) }) })
      }
      const list = pickKeyList(q.data)
      if (!list.length) {
        return jsx(Section, { title: tr('keys.title'), children: jsx('div', { className: 'text-sm text-(--ui-text-tertiary)', children: tr('keys.empty') }) })
      }
      const pools = [...new Set(list.map((k) => String(k.pool || 'auto')))].sort()
      const poolStats = list.reduce((acc, k) => {
        const p = String(k.pool || 'auto')
        if (!acc[p]) acc[p] = { count: 0, used: 0 }
        acc[p].count += 1
        if (typeof k.used_usd === 'number') acc[p].used += k.used_usd
        return acc
      }, {})
      const totalSpendAllKeys = list.reduce((sum, k) => sum + (typeof k.used_usd === 'number' ? k.used_usd : 0), 0)

      const needle = text.trim().toLowerCase()
      const shown = list
        .filter((k) => (poolFilter === 'all' || String(k.pool || 'auto') === poolFilter))
        .filter((k) => !needle || String(k.name || '').toLowerCase().includes(needle) || String(k.id || '').toLowerCase().includes(needle))
        .sort((a, b) => (b.used_usd || 0) - (a.used_usd || 0))

      const chipBtn = (id, label, active) => jsx('button', {
        type: 'button',
        onClick: () => {
          haptic('tap')
          setPoolFilter(id)
        },
        style: active ? { borderColor: 'var(--ui-accent)', fontWeight: 600 } : null,
        className: 'shrink-0 rounded-sm border border-(--ui-stroke-secondary) px-1.5 py-0.5 text-xs hover:bg-(--chrome-action-hover)',
        children: label,
      })
      return jsx(Section, {
        title: tr('keys.titleWithCountAndSpend', list.length, fmtUsd(totalSpendAllKeys)),
        children: jsxs('div', {
          className: 'flex flex-col gap-1.5',
          children: [
            jsx('input', {
              value: text,
              spellCheck: false,
              placeholder: tr('keys.searchPlaceholder'),
              onChange: (e) => setText(e.target.value),
              className: 'min-w-0 flex-1 rounded-sm border border-(--ui-stroke-secondary) bg-transparent px-1.5 py-1 text-xs',
            }),
            jsxs('div', {
              className: 'flex gap-1 overflow-x-auto pb-0.5',
              children: [
                chipBtn('all', `${tr('common.all')} (${list.length} · ${fmtUsd(totalSpendAllKeys)})`, poolFilter === 'all'),
                ...pools.map((p) => chipBtn(p, `${p} (${poolStats[p].count} · ${fmtUsd(poolStats[p].used)})`, poolFilter === p)),
              ],
            }),
            shown.length
              ? jsxs('div', {
                  className: 'flex flex-col gap-1.5',
                  children: [
                    jsx('div', { className: 'text-xs text-(--ui-text-tertiary)', children: tr('keys.shownSummary', shown.length, list.length) }),
                    ...shown.map((k) => jsx(KeyCard, { k }, k.id)),
                  ],
                })
              : jsx('div', { className: 'text-xs text-(--ui-text-tertiary)', children: tr('keys.noMatch') }),
          ],
        }),
      })
    }

    function HeroSection() {
      const token = useValue($token)
      const me = useMeQuery()
      const u7 = useUsageQuery('7d')
      const tr = useT()
      const currentLang = useValue($lang)
      const isTh = currentLang === 'th'

      if (!token) {
        return jsx(Section, {
          title: tr('hero.title'),
          children: jsx('div', { className: 'text-sm text-(--ui-text-tertiary)', children: tr('hero.needToken') }),
        })
      }
      if (me.isLoading) {
        return jsx(Section, { title: tr('hero.title'), children: jsx('div', { className: 'text-sm text-(--ui-text-tertiary)', children: tr('hero.loading') }) })
      }
      if (me.error) {
        return jsx(Section, { title: tr('hero.title'), children: jsx('div', { className: 'text-sm', children: getErrorMessage(me.error, tr) }) })
      }
      const k = pickKey(me.data)
      const bal = me.data && me.data.credit_usd
      const c7 = !u7.isLoading && !u7.error ? costOf(totalsOf(u7.data)) : null
      const perDay = c7 != null ? c7 / 7 : null
      const days = typeof bal === 'number' && perDay > 0 ? bal / perDay : null
      const pace = days == null
        ? (c7 != null ? tr('hero.paceAverage', fmtUsd(perDay)) : tr('hero.paceWaiting'))
        : days < 3
          ? tr('hero.paceWarn', fmtUsd(perDay), days < 1 ? tr('hero.lessThanDay') : tr('hero.daysCount', Math.floor(days)))
          : tr('hero.paceNormal', fmtUsd(perDay), tr('hero.daysCount', Math.floor(days)))
      const freeText = freeLine(k.free, tr, isTh)
      return jsxs('div', {
        className: 'flex flex-col gap-0.5 rounded-md border border-(--ui-stroke-secondary) p-3',
        children: [
          jsx('div', { className: 'text-xs text-(--ui-text-tertiary)', children: tr('hero.header', k.pool, k.active !== false) }),
          jsx('div', {
            style: { fontSize: 30, fontWeight: 650, lineHeight: 1.15 },
            className: 'font-mono tabular-nums',
            children: fmtUsd(bal),
          }),
          jsx('div', { className: 'text-xs text-(--ui-text-tertiary)', children: pace }),
          freeText ? jsx('div', { className: 'text-xs text-(--ui-text-tertiary)', children: freeText }) : null,
          jsx(CapInfo, { k, fallback: true, tr }),
        ],
      })
    }

    function ModelProbeSection({ keysList }) {
      const tr = useT()
      const token = useValue($token)
      const jevToken = useValue($jevToken)
      const jevProvider = useValue($jevProvider)
      const storedPool = useValue($probePool)

      const [poolInput, setPoolInput] = useState('')
      const [selectedPool, setSelectedPool] = useState(storedPool || 'native')
      const [overrideKey, setOverrideKey] = useState('')
      const [models, setModels] = useState([])
      const [loadingModels, setLoadingModels] = useState(false)
      const [probingAll, setProbingAll] = useState(false)
      const [probeResults, setProbeResults] = useState({})
      const [filterStatus, setFilterStatus] = useState('all')
      const [filterCategory, setFilterCategory] = useState('all')
      const [searchQuery, setSearchQuery] = useState('')
      const abortRef = useRef(null)

      const effectivePool = poolInput.trim() || selectedPool
      const effectiveBaseUrl = baseFor(effectivePool)

      const matchedKey = useMemo(() => {
        if (overrideKey.trim()) return overrideKey.trim()
        if (keysList && keysList.length) {
          const match = keysList.find((k) => String(k.pool || 'auto') === effectivePool)
          if (match && match.key) return match.key
        }
        return token || ''
      }, [overrideKey, keysList, effectivePool, token])

      const detectedPools = useMemo(() => {
        const defaultList = ['native', 'nonono', 'chinese-specials', 'deepseek-officials', 'event-pools']
        if (!keysList || !keysList.length) return defaultList
        const s = new Set(defaultList)
        keysList.forEach((k) => {
          if (k.pool) s.add(String(k.pool))
        })
        return Array.from(s)
      }, [keysList])

      const setPoolChoice = (p) => {
        haptic('tap')
        setSelectedPool(p)
        setPoolInput('')
        setStored($probePool, 'probe_pool', p)
      }

      const setJevChoice = (prov) => {
        haptic('tap')
        setStored($jevProvider, 'jev_provider', prov)
      }

      const fetchCatalog = async () => {
        if (!matchedKey) {
          host.notify({ kind: 'info', message: tr('probe.needTokenOrKey') })
          return
        }
        setLoadingModels(true)
        haptic('tap')
        try {
          const res = await fetch(`${effectiveBaseUrl}/models`, {
            headers: { Authorization: `${AUTH} ${matchedKey}` },
          })
          if (!res.ok) throw new Error(`http-${res.status}`)
          const data = await res.json()
          const list = (data && data.data && Array.isArray(data.data))
            ? data.data.map((m) => (typeof m === 'string' ? m : m.id)).filter(Boolean)
            : []
          setModels(list)
          const initialMap = {}
          list.forEach((m) => {
            initialMap[m] = {
              status: null,
              ok: null,
              latencyMs: null,
              checkpoint: null,
              error: null,
              category: classifyModelCategory(m),
              isReasoning: isReasoningModel(m),
              source: 'pending',
              probing: false,
            }
          })
          setProbeResults(initialMap)
          host.notify({ kind: 'info', message: `Found ${list.length} models in pool ${effectivePool}` })
        } catch (err) {
          host.notify({ kind: 'info', message: `Fetch models failed: ${err.message}` })
        } finally {
          setLoadingModels(false)
        }
      }

      const runProbe = async (modelId) => {
        if (!matchedKey) {
          host.notify({ kind: 'info', message: tr('probe.needTokenOrKey') })
          return
        }
        setProbeResults((prev) => ({
          ...prev,
          [modelId]: { ...(prev[modelId] || {}), probing: true },
        }))

        let isReasoning = isReasoningModel(modelId)
        let category = classifyModelCategory(modelId)
        let source = 'heuristic'

        if (jevProvider !== 'disabled') {
          try {
            const jRes = await classifyWithJev({
              provider: jevProvider,
              token: jevProvider === 'official' ? (jevToken || '') : '',
              modelId,
            })
            isReasoning = jRes.isReasoning
            category = jRes.category
            source = jRes.source
          } catch {}
        }

        const res = await probeModel({
          baseUrl: effectiveBaseUrl,
          token: matchedKey,
          modelId,
          isReasoning,
          timeoutMs: 15000,
        })

        setProbeResults((prev) => ({
          ...prev,
          [modelId]: {
            ...res,
            category,
            isReasoning,
            source,
            probing: false,
          },
        }))
      }

      const runProbeAll = async () => {
        if (!models.length) return
        if (!matchedKey) {
          host.notify({ kind: 'info', message: tr('probe.needTokenOrKey') })
          return
        }
        setProbingAll(true)
        haptic('tap')
        const ctrl = new AbortController()
        abortRef.current = ctrl

        const chunk = 3
        for (let i = 0; i < models.length; i += chunk) {
          if (ctrl.signal.aborted) break
          const batch = models.slice(i, i + chunk)
          await Promise.all(batch.map((m) => runProbe(m)))
        }
        setProbingAll(false)
      }

      const stopProbe = () => {
        haptic('tap')
        if (abortRef.current) {
          abortRef.current.abort()
          abortRef.current = null
        }
        setProbingAll(false)
      }

      const copyModelId = async (m) => {
        const ok = await ctx.os.writeClipboard(m)
        host.notify({ kind: 'info', message: ok ? tr('probe.copiedModel', m) : tr('common.copyFailed') })
      }

      const probedList = Object.entries(probeResults)
      const totalCount = models.length
      const onlineCount = probedList.filter(([, r]) => r && r.ok === true).length
      const failedCount = probedList.filter(([, r]) => r && r.status !== null && r.ok === false).length
      const latencies = probedList
        .filter(([, r]) => r && r.ok === true && typeof r.latencyMs === 'number')
        .map(([, r]) => r.latencyMs)
      const avgLatency = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0

      const needle = searchQuery.trim().toLowerCase()
      const filteredModels = models.filter((m) => {
        if (needle && !m.toLowerCase().includes(needle)) return false
        const r = probeResults[m]
        if (filterStatus === 'online' && (!r || !r.ok)) return false
        if (filterStatus === 'failed' && (!r || r.status === null || r.ok)) return false
        if (filterStatus === 'untested' && r && r.status !== null) return false
        const cat = (r && r.category) || classifyModelCategory(m)
        if (filterCategory !== 'all' && cat !== filterCategory) return false
        return true
      })

      const poolBtn = (p) => jsx('button', {
        type: 'button',
        onClick: () => setPoolChoice(p),
        style: effectivePool === p ? { borderColor: 'var(--ui-accent)', fontWeight: 600 } : null,
        className: 'shrink-0 rounded-sm border border-(--ui-stroke-secondary) px-2 py-0.5 text-xs hover:bg-(--chrome-action-hover)',
        children: p,
      })

      const jevBtn = (id, label) => jsx('button', {
        type: 'button',
        onClick: () => setJevChoice(id),
        style: jevProvider === id ? { borderColor: 'var(--ui-accent)', fontWeight: 600 } : null,
        className: 'rounded-sm border border-(--ui-stroke-secondary) px-2 py-0.5 text-xs hover:bg-(--chrome-action-hover)',
        children: label,
      })

      const filterBtn = (id, label, active, onClick) => jsx('button', {
        type: 'button',
        onClick,
        style: active ? { borderColor: 'var(--ui-accent)', fontWeight: 600 } : null,
        className: 'shrink-0 rounded-sm border border-(--ui-stroke-secondary) px-2 py-0.5 text-xs hover:bg-(--chrome-action-hover)',
        children: label,
      })

      return jsx(Section, {
        title: tr('probe.title'),
        right: totalCount > 0
          ? jsx('div', {
              className: 'font-mono text-xs text-(--ui-text-tertiary)',
              children: tr('probe.summaryText', onlineCount, totalCount, avgLatency),
            })
          : jsx('div', {
              className: 'text-xs text-(--ui-text-tertiary)',
              children: tr('probe.subtitle'),
            }),
        children: jsxs('div', {
          className: 'flex flex-col gap-2',
          children: [
            jsxs('div', {
              className: 'flex flex-col gap-2 rounded-sm border border-(--ui-stroke-secondary) p-2',
              children: [
                jsxs('div', {
                  className: 'flex flex-col gap-1',
                  children: [
                    jsx('div', { className: 'text-xs text-(--ui-text-tertiary)', children: tr('probe.poolLabel') }),
                    jsxs('div', {
                      className: 'flex items-center gap-1 overflow-x-auto pb-0.5',
                      children: [
                        ...detectedPools.map((p) => poolBtn(p)),
                        jsx('input', {
                          value: poolInput,
                          placeholder: tr('probe.customPoolPlaceholder'),
                          onChange: (e) => setPoolInput(e.target.value),
                          className: 'min-w-[140px] flex-1 rounded-sm border border-(--ui-stroke-secondary) bg-transparent px-1.5 py-0.5 font-mono text-xs',
                        }),
                      ],
                    }),
                  ],
                }),
                jsxs('div', {
                  className: 'flex flex-wrap items-center justify-between gap-2 border-t border-(--ui-stroke-secondary) pt-2',
                  children: [
                    jsxs('div', {
                      className: 'flex flex-wrap items-center gap-1.5',
                      children: [
                        jsx('span', { className: 'text-xs text-(--ui-text-tertiary)', children: tr('probe.jevModeLabel') }),
                        jevBtn('official', tr('probe.jevOfficial')),
                        jevBtn('9router', tr('probe.jev9router')),
                        jevBtn('disabled', tr('probe.jevDisabled')),
                      ],
                    }),
                    jsxs('div', {
                      className: 'flex items-center gap-1.5',
                      children: [
                        jsx('button', {
                          type: 'button',
                          disabled: loadingModels || probingAll,
                          onClick: fetchCatalog,
                          className: 'rounded-sm border border-(--ui-stroke-secondary) px-2.5 py-1 text-xs font-medium hover:bg-(--chrome-action-hover) disabled:opacity-50',
                          children: loadingModels ? tr('probe.fetchingModels') : tr('probe.fetchModels'),
                        }),
                        models.length > 0
                          ? jsx('button', {
                              type: 'button',
                              onClick: probingAll ? stopProbe : runProbeAll,
                              className: `rounded-sm border px-2.5 py-1 text-xs font-medium ${
                                probingAll
                                  ? 'border-rose-500/50 bg-rose-500/10 text-rose-300'
                                  : 'border-blue-500/50 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20'
                              }`,
                              children: probingAll ? tr('probe.stopProbe') : tr('probe.probeAll'),
                            })
                          : null,
                      ],
                    }),
                  ],
                }),
                jsxs('div', {
                  className: 'flex items-center gap-2 pt-0.5',
                  children: [
                    jsx('span', { className: 'shrink-0 text-xs text-(--ui-text-tertiary)', children: tr('probe.keyLabel') }),
                    jsx('input', {
                      type: 'password',
                      value: overrideKey,
                      placeholder: tr('probe.keyPlaceholder'),
                      onChange: (e) => setOverrideKey(e.target.value),
                      className: 'min-w-0 flex-1 rounded-sm border border-(--ui-stroke-secondary) bg-transparent px-1.5 py-0.5 font-mono text-xs',
                    }),
                    jsx('span', {
                      className: 'shrink-0 font-mono text-xs text-(--ui-text-tertiary)',
                      children: matchedKey ? maskToken(matchedKey) : tr('common.none'),
                    }),
                  ],
                }),
              ],
            }),
            models.length > 0
              ? jsxs('div', {
                  className: 'flex flex-col gap-2',
                  children: [
                    jsxs('div', {
                      className: 'flex items-center gap-3 rounded-sm border border-(--ui-stroke-secondary) px-2 py-1 text-xs',
                      children: [
                        jsxs('span', {
                          children: ['Total: ', jsx('strong', { children: totalCount })],
                        }),
                        jsxs('span', {
                          className: 'text-emerald-400',
                          children: ['Online: ', jsx('strong', { children: onlineCount })],
                        }),
                        jsxs('span', {
                          className: failedCount > 0 ? 'text-rose-400' : 'text-(--ui-text-tertiary)',
                          children: ['Failed: ', jsx('strong', { children: failedCount })],
                        }),
                        avgLatency > 0
                          ? jsxs('span', {
                              className: 'font-mono text-(--ui-text-tertiary)',
                              children: ['Avg Latency: ', jsx('strong', { children: `${avgLatency}ms` })],
                            })
                          : null,
                      ],
                    }),
                    jsxs('div', {
                      className: 'flex flex-col gap-1.5',
                      children: [
                        jsx('input', {
                          value: searchQuery,
                          placeholder: tr('probe.searchPlaceholder'),
                          onChange: (e) => setSearchQuery(e.target.value),
                          className: 'min-w-0 flex-1 rounded-sm border border-(--ui-stroke-secondary) bg-transparent px-1.5 py-1 text-xs',
                        }),
                        jsxs('div', {
                          className: 'flex items-center justify-between gap-2 overflow-x-auto pb-0.5',
                          children: [
                            jsxs('div', {
                              className: 'flex gap-1',
                              children: [
                                filterBtn('all', tr('probe.allStatuses'), filterStatus === 'all', () => setFilterStatus('all')),
                                filterBtn('online', `${tr('probe.statusOnline')} (${onlineCount})`, filterStatus === 'online', () => setFilterStatus('online')),
                                filterBtn('failed', `${tr('probe.statusFailed')} (${failedCount})`, filterStatus === 'failed', () => setFilterStatus('failed')),
                                filterBtn('untested', tr('probe.statusPending'), filterStatus === 'untested', () => setFilterStatus('untested')),
                              ],
                            }),
                            jsxs('div', {
                              className: 'flex gap-1',
                              children: [
                                filterBtn('all', tr('probe.allCategories'), filterCategory === 'all', () => setFilterCategory('all')),
                                filterBtn('reasoning', tr('probe.catReasoning'), filterCategory === 'reasoning', () => setFilterCategory('reasoning')),
                                filterBtn('coding', tr('probe.catCoding'), filterCategory === 'coding', () => setFilterCategory('coding')),
                                filterBtn('vision', tr('probe.catVision'), filterCategory === 'vision', () => setFilterCategory('vision')),
                                filterBtn('general', tr('probe.catGeneral'), filterCategory === 'general', () => setFilterCategory('general')),
                              ],
                            }),
                          ],
                        }),
                      ],
                    }),
                    filteredModels.length > 0
                      ? jsxs('div', {
                          className: 'flex max-h-80 flex-col gap-1 overflow-y-auto pr-1',
                          children: filteredModels.map((m) => {
                            const r = probeResults[m] || {}
                            const isProbing = r.probing
                            const isOk = r.ok === true
                            const isFail = r.status !== null && r.ok === false
                            const cat = r.category || classifyModelCategory(m)

                            let catColor = 'text-zinc-400 border-zinc-700 bg-zinc-800/40'
                            if (cat === 'reasoning') catColor = 'text-purple-300 border-purple-500/30 bg-purple-500/10'
                            else if (cat === 'coding') catColor = 'text-blue-300 border-blue-500/30 bg-blue-500/10'
                            else if (cat === 'vision') catColor = 'text-cyan-300 border-cyan-500/30 bg-cyan-500/10'

                            let statusBadge = jsx('span', {
                              className: 'rounded px-1.5 py-0.5 font-mono text-[0.6875rem] text-(--ui-text-tertiary)',
                              children: '—',
                            })
                            if (isProbing) {
                              statusBadge = jsx('span', {
                                className: 'animate-pulse rounded bg-blue-500/20 px-1.5 py-0.5 font-mono text-[0.6875rem] text-blue-300',
                                children: tr('probe.testingSingle'),
                              })
                            } else if (isOk) {
                              statusBadge = jsxs('div', {
                                className: 'flex items-center gap-1.5',
                                children: [
                                  jsx('span', {
                                    className: 'font-mono text-xs text-emerald-400 tabular-nums',
                                    children: `${r.latencyMs}ms`,
                                  }),
                                  jsx('span', {
                                    className: 'rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[0.6875rem] text-emerald-300',
                                    children: '200 OK',
                                  }),
                                ],
                              })
                            } else if (isFail) {
                              statusBadge = jsxs('div', {
                                className: 'flex items-center gap-1.5',
                                children: [
                                  r.latencyMs != null
                                    ? jsx('span', {
                                        className: 'font-mono text-xs text-(--ui-text-tertiary) tabular-nums',
                                        children: `${r.latencyMs}ms`,
                                      })
                                    : null,
                                  jsx('span', {
                                    className: 'rounded border border-rose-500/30 bg-rose-500/10 px-1.5 py-0.5 font-mono text-[0.6875rem] text-rose-300',
                                    children: r.status ? `HTTP ${r.status}` : 'ERR',
                                  }),
                                ],
                              })
                            }

                            return jsxs('div', {
                              className: 'flex items-center justify-between gap-2 rounded-sm border border-(--ui-stroke-secondary) p-1.5 hover:bg-(--chrome-action-hover)',
                              children: [
                                jsxs('div', {
                                  className: 'flex min-w-0 flex-col gap-0.5',
                                  children: [
                                    jsxs('div', {
                                      className: 'flex items-center gap-1.5',
                                      children: [
                                        jsx('button', {
                                          type: 'button',
                                          title: tr('probe.copyModelTooltip'),
                                          onClick: () => copyModelId(m),
                                          className: 'truncate font-mono text-xs font-medium text-foreground hover:underline',
                                          children: m,
                                        }),
                                        jsx('span', {
                                          className: `shrink-0 rounded border px-1 py-0.2 text-[0.625rem] ${catColor}`,
                                          children: cat,
                                        }),
                                        r.source && r.source.startsWith('jev')
                                          ? jsx('span', {
                                              className: 'rounded bg-amber-500/10 px-1 text-[0.625rem] text-amber-300',
                                              children: '⚡jev',
                                            })
                                          : null,
                                      ],
                                    }),
                                    r.checkpoint && r.checkpoint !== m
                                      ? jsx('div', {
                                          className: 'truncate font-mono text-[0.6875rem] text-(--ui-text-tertiary)',
                                          children: `↳ ${tr('probe.checkpointLabel')}: ${r.checkpoint}`,
                                        })
                                      : null,
                                    r.error
                                      ? jsx('div', {
                                          className: 'truncate text-[0.6875rem] text-rose-400',
                                          children: r.error,
                                        })
                                      : null,
                                  ],
                                }),
                                jsxs('div', {
                                  className: 'flex shrink-0 items-center gap-2',
                                  children: [
                                    statusBadge,
                                    jsx('button', {
                                      type: 'button',
                                      disabled: isProbing || probingAll,
                                      onClick: () => runProbe(m),
                                      className: 'rounded-sm border border-(--ui-stroke-secondary) px-2 py-0.5 text-xs hover:bg-(--chrome-action-hover) disabled:opacity-50',
                                      children: tr('probe.testSingle'),
                                    }),
                                  ],
                                }),
                              ],
                            }, m)
                          }),
                        })
                      : jsx('div', {
                          className: 'p-3 text-center text-xs text-(--ui-text-tertiary)',
                          children: tr('probe.noMatch'),
                        }),
                  ],
                })
              : null,
          ],
        }),
      })
    }

    function StatusPage() {
      const [usagePeriod, setUsagePeriod] = useState('1d')
      const keysQ = useKeysQuery()
      const keysList = pickKeyList(keysQ.data)
      const tr = useT()
      const refresh = () => {
        queryClient.invalidateQueries({ queryKey: [ID] })
        host.notify({ kind: 'info', message: tr('common.refreshed') })
      }

      const periodsList = [
        { id: '1d', label: tr('common.period1d') },
        { id: '7d', label: tr('common.period7d') },
        { id: '30d', label: tr('common.period30d') },
      ]

      return jsxs('div', {
        className: 'flex h-full flex-col gap-2 overflow-y-auto p-3 text-sm',
        children: [
          jsxs('div', {
            className: 'flex items-center justify-between',
            children: [
              jsx('div', { className: 'font-medium', children: 'MaxPlus' }),
              jsxs('div', {
                className: 'flex items-center gap-2',
                children: [
                  jsx(LangSwitch, {}),
                  jsx('button', {
                    type: 'button',
                    onClick: refresh,
                    className: 'rounded-sm border border-(--ui-stroke-secondary) px-2 py-0.5 text-xs hover:bg-(--chrome-action-hover)',
                    children: tr('common.refresh'),
                  }),
                ],
              }),
            ],
          }),
          jsx(HeroSection, {}),
          jsx(Section, {
            title: tr('usage.title'),
            right: jsx('div', { className: 'text-xs text-(--ui-text-tertiary)', children: tr('usage.subtitle') }),
            children: jsxs('div', {
              className: 'flex flex-col gap-2',
              children: [
                jsx('div', {
                  className: 'flex gap-1',
                  children: periodsList.map((p) => jsx('button', {
                    type: 'button',
                    onClick: () => {
                      haptic('tap')
                      setUsagePeriod(p.id)
                    },
                    className: 'flex-1 rounded-sm border px-2 py-0.5 text-xs ' + (usagePeriod === p.id
                      ? 'border-(--ui-accent) text-foreground'
                      : 'border-(--ui-stroke-secondary) text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover)'),
                    children: p.label,
                  }, p.id)),
                }),
                jsx(UsageBlock, { period: usagePeriod, label: '' }),
              ],
            }),
          }),
          jsx(KeysSection, {}),
          jsx(ModelProbeSection, { keysList }),
          jsx(Section, {
            title: tr('token.title'),
            children: jsxs('div', {
              className: 'flex flex-col gap-2',
              children: [
                jsx(TokenField, {
                  $a: $token,
                  storeKey: 'token',
                  label: tr('token.inferenceLabel'),
                  placeholder: 'ccsk-…',
                  pattern: KEY_RE,
                  hint: tr('token.inferenceHint'),
                }),
                jsx(TokenField, {
                  $a: $mgmt,
                  storeKey: 'mgmt',
                  label: tr('token.mgmtLabel'),
                  placeholder: 'ccmk-…',
                  pattern: MGMT_RE,
                  hint: tr('token.mgmtHint'),
                }),
                jsx(TokenField, {
                  $a: $jevToken,
                  storeKey: 'typesafe_key',
                  label: tr('probe.jevTokenLabel'),
                  placeholder: tr('probe.jevTokenPlaceholder'),
                  pattern: /.+/,
                  hint: 'TypeSafe System One API Key',
                }),
              ],
            }),
          }),
        ],
      })
    }

    ctx.register({
      id: 'chip',
      area: STATUSBAR_AREAS.right,
      order: 120,
      render: () => jsx(Chip, {}),
    })

    ctx.register({
      id: 'page',
      area: ROUTES_AREA,
      data: { path: '/maxplus' },
      render: () => jsx(StatusPage, {}),
    })

    ctx.register({
      id: 'nav',
      area: SIDEBAR_NAV_AREA,
      data: { path: '/maxplus', label: 'MaxPlus', codicon: 'credit-card' },
    })

    ctx.registerMany([
      {
        id: 'probe',
        area: PALETTE_AREA,
        data: {
          id: 'maxplus.probe',
          label: 'MaxPlus: Probe Models',
          keywords: ['maxplus', 'probe', 'models', 'connection', 'ping', 'เช็คโมเดล'],
          run: () => host.navigate('/maxplus'),
        },
      },
      {
        id: 'open',
        area: PALETTE_AREA,
        data: {
          id: 'maxplus.open',
          label: MESSAGES_EN.palette.openLabel,
          keywords: ['maxplus', 'credit', 'เครดิต', 'คีย์', 'status', 'เปิด'],
          run: () => host.navigate('/maxplus'),
        },
      },
      {
        id: 'refresh',
        area: PALETTE_AREA,
        data: {
          id: 'maxplus.refresh',
          label: MESSAGES_EN.palette.refreshLabel,
          keywords: ['maxplus', 'refresh', 'รีเฟรช'],
          run: () => {
            queryClient.invalidateQueries({ queryKey: [ID] })
            host.notify({ kind: 'info', message: t('common.refreshed') })
          },
        },
      },
      {
        id: 'clear',
        area: PALETTE_AREA,
        data: {
          id: 'maxplus.clear',
          label: MESSAGES_EN.palette.clearLabel,
          keywords: ['maxplus', 'token', 'clear', 'ลบ'],
          run: () => {
            setStored($token, 'token', '')
            setStored($mgmt, 'mgmt', '')
            queryClient.invalidateQueries({ queryKey: [ID] })
            host.notify({ kind: 'info', message: t('palette.clearedMessage') })
          },
        },
      },
    ])
  },
}
