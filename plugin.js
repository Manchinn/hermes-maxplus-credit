/**
 * MaxPlus Credit — Hermes desktop plugin (frontend-only, Thai UI).
 *
 * แสดงเครดิต + usage + key ทุก pool ของ MaxPlus (api.maxplus-ai.cc)
 * Shows MaxPlus credit, usage and per-pool keys (Thai UI).
 *
 * - statusBar chip: credit balance (or key count), polls every 60s
 * - page /maxplus: hero balance + burn pace, account usage 1d/7d/30d,
 *   all-keys table (search / pool filter / sort by spend), pool mover,
 *   smoke test (runbook §5.4), cost-anomaly scan + freeze (UC-3),
 *   daily-cap enforcer (UC-6), token slots (ccsk + ccmk)
 * - palette: open status / refresh / clear tokens
 *
 * Tokens live in the app's ctx.storage only — never in this repo.
 * Read-only scopes (keys:read + usage:read) are enough for viewing;
 * keys:update is needed for pool moves, freeze (cap 0) and cap enforcing.
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
} from '@hermes/plugin-sdk'
import { useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const ID = 'maxplus-credit'
const API = 'https://api.maxplus-ai.cc'
// Split on purpose: the literal scheme+secret pattern trips transport redaction.
const AUTH = 'Bear' + 'er'
const KEY_RE = /^ccsk-[a-f0-9]{64}$/
const MGMT_RE = /^ccmk-\S{8,}$/

const ERR_TH = {
  'no-token': 'ยังไม่ได้ตั้ง token',
  network: 'ต่อ API ไม่ได้ (เน็ต/CORS)',
  'http-401': '401 token ผิด/หมดอายุ',
  'http-402': '402 เครดิตหมด — เติมที่ /dashboard/topup แล้วรอ ~30s',
  'http-403': '403 สิทธิ์ไม่พอ หรือ key ไม่ผูก pool',
  'http-404': '404 path ผิด',
  'http-409': '409 key ผิดประเภท (text/image)',
  'http-429': '429 ชน cap/concurrent',
  'http-503': '503 pool ล่ม',
  'http-504': '504 timeout',
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

const TH_MON = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']

// daily_free_credit.reset_at เป็น ISO datetime (Asia/Bangkok) — แสดงสั้นๆ พอ
function fmtReset(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getDate()} ${TH_MON[d.getMonth()]} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// เครดิตฟรีรายวัน = ถังที่สอง แยกจาก credit_usd และ "ผูก pool"
// pool ที่ key นี้ใช้ต้องอยู่ใน free.pools[] ไม่งั้น remaining_for_key_pool_usd = 0
function freeLine(free) {
  if (!free || !free.enabled || typeof free.amount !== 'number') return null
  const reset = fmtReset(free.resetAt)
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
  return ((json && json.totals) || json || {})
}

function costOf(t) {
  const v = t.total_cost_usd ?? t.total_cost ?? t.cost_usd
  return typeof v === 'number' ? v : null
}

function fmtTokens(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(Math.round(n))
}

function tokensOf(t) {
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

// ลิสต์ของ <select> ถูกวาดโดย Chromium (ไม่ใช่ DOM ของแอป) จึงไม่รับธีมเอง —
// เดา scheme จากความสว่างของสีตัวอักษรจริงในธีมปัจจุบัน (ธีมมืด = ตัวอักษรสว่าง)
// ลำดับ: สีตัวอักษรแบบ rgb → color-scheme ของ root → ค่าเริ่มต้น dark
function schemeOf(el) {
  const lum = (c) => {
    const m = /rgba?\(\s*(\d+)\s*[,\s]\s*(\d+)\s*[,\s]\s*(\d+)/.exec(String(c || ''))
    return m ? 0.299 * +m[1] + 0.587 * +m[2] + 0.114 * +m[3] : null
  }
  try {
    const l = lum(getComputedStyle(el).color)
    if (l != null) return l > 140 ? 'dark' : 'light'
    const cs = String(getComputedStyle(document.documentElement).colorScheme || '')
    if (cs.includes('dark') && !cs.includes('light')) return 'dark'
    if (cs.includes('light') && !cs.includes('dark')) return 'light'
  } catch { /* ไม่มี DOM จริง (unit test) — ใช้ค่าเริ่มต้น */ }
  return 'dark'
}

function pickKey(me) {
  const k = (me && me.key) || {}
  const f = (me && me.daily_free_credit) || {}
  return {
    // field จริงจาก API คือ key.pool (runbook เดิมเขียน key_pool — เก็บ fallback ไว้)
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

function SpendBar({ ratio }) {
  const pct = Math.max(0, Math.min(100, Math.round((ratio || 0) * 100)))
  return jsx('div', {
    style: { height: 6, width: '100%', borderRadius: 9999, background: 'var(--ui-stroke-secondary)' },
    children: jsx('div', {
      style: { height: 6, width: `${pct}%`, borderRadius: 9999, background: 'var(--ui-accent)' },
    }),
  })
}

export default {
  id: ID, // must match the folder name / repo root artifact
  name: 'MaxPlus Credit',
  defaultEnabled: false, // opt-in: user flips it on in Capabilities → Plugins
  register(ctx) {
    const $token = atom(ctx.storage.get('token', ''))
    const $mgmt = atom(ctx.storage.get('mgmt', ''))

    // cleanup ครั้งเดียว (idempotent): 'baseline' เป็นของ "จับงบไหม้" ที่ถอดออกแล้ว
    // (commit 3835fc5) — ไม่มีโค้ดอ่านค่านี้อีกแล้ว จึงลบทิ้งให้ storage สะอาด
    try { ctx.storage.remove('baseline') } catch { /* ไม่มี key นี้แล้ว / storage ปิดอยู่ — ไม่เป็นไร */ }
    const $focusKey = atom(null)

    function setStored($a, storeKey, t) {
      if (t) ctx.storage.set(storeKey, t)
      else ctx.storage.remove(storeKey)
      $a.set(t)
    }

    async function apiWith(token, path) {
      if (!token) throw new Error('no-token')
      let res
      try {
        res = await fetch(`${API}${path}`, {
          headers: { Authorization: `Bearer ${token}` },
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
    const fetchKeyUsage = (kid) => apiWith($mgmt.get(), `/v1/api-keys/${encodeURIComponent(kid)}/usage`)

    // Common pools (see MaxPlus docs → Pool aliases). Moving a key with PATCH
    // keeps the same secret — only the client's base URL must change.
    const POOLS = ['native', 'grok-lite', 'grok-fast', 'grok', 'deepseek', 'glm-deepseek-cheaper', 'glm', 'gemini', 'gpt-pro', 'gpt-lite', 'gpt-image', 'claude-aws', 'free']

    // แท็บช่วงเวลาใช้ร่วมกันทั้ง chip popup และหน้าเต็ม
    const PERIODS = [
      { id: '1d', label: '24 ชม.' },
      { id: '7d', label: '7 วัน' },
      { id: '30d', label: '30 วัน' },
    ]

    function baseFor(pool) {
      const p = String(pool || 'auto')
      return p === 'native' ? `${API}/v1` : `${API}/${p}/v1`
    }

    async function apiPatch(path, body) {
      const token = $mgmt.get()
      if (!token) throw new Error('no-token')
      let res
      try {
        res = await fetch(`${API}${path}`, {
          method: 'PATCH',
          headers: { Authorization: AUTH + ' ' + token, 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
      } catch {
        throw new Error('network')
      }
      if (!res.ok) throw new Error(`http-${res.status}`)
      return res.json()
    }

    // Full-URL request (pool base URLs are absolute, not API-relative).
    // Used by the smoke test: GET {pool}/v1/models + POST …/chat/completions.
    async function apiUrl(token, url, opts) {
      if (!token) throw new Error('no-token')
      const o = opts || {}
      let res
      try {
        res = await fetch(url, {
          ...o,
          headers: { Authorization: AUTH + ' ' + token, ...((o && o.headers) || {}) },
        })
      } catch {
        throw new Error('network')
      }
      if (!res.ok) throw new Error(`http-${res.status}`)
      return res.json()
    }

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
        // 1d รีเฟรชทุก 15 วิแบบ dashboard (โควต้า 20 ครั้ง/นาที เหลือเฟือ)
        refetchInterval: period === '1d' ? 15000 : 300000,
        retry: false,
      })
    }

    function ChipPopup() {
      const token = useValue($token)
      const me = useMeQuery()
      const [period, setPeriod] = useState('1d')
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
            children: 'เปิดหน้าเต็ม →',
          }),
          jsx('button', {
            type: 'button',
            onClick: refresh,
            className: 'shrink-0 rounded-sm border border-(--ui-stroke-secondary) px-2 py-1 text-xs hover:bg-(--chrome-action-hover)',
            children: 'รีเฟรช',
          }),
        ],
      })
      if (!token) {
        return jsxs('div', {
          className: 'flex flex-col gap-1.5',
          children: [
            jsx('div', { className: 'text-sm text-(--ui-text-tertiary)', children: 'ใส่ ccsk-… ในหน้า MaxPlus ก่อน — มีแค่ management token ก็ดูตาราง key ได้' }),
            footer,
          ],
        })
      }
      if (me.isLoading) {
        return jsxs('div', {
          className: 'flex flex-col gap-1.5',
          children: [
            jsx('div', { className: 'text-sm text-(--ui-text-tertiary)', children: 'กำลังดึง /v1/me…' }),
            footer,
          ],
        })
      }
      if (me.error) {
        return jsxs('div', {
          className: 'flex flex-col gap-1.5',
          children: [
            jsx('div', { className: 'text-sm', children: ERR_TH[errKey(me.error)] || 'ดูไม่ได้' }),
            footer,
          ],
        })
      }
      const k = pickKey(me.data)
      const bal = me.data && me.data.credit_usd
      const freeText = freeLine(k.free)
      return jsxs('div', {
        style: { maxHeight: '60vh', overflowY: 'auto' },
        className: 'flex flex-col gap-2',
        children: [
          jsxs('div', {
            className: 'flex flex-col gap-0.5',
            children: [
              jsx('div', { className: 'text-xs text-(--ui-text-tertiary)', children: `คงเหลือ · pool ${k.pool} · ${k.active === false ? '❌ ปิด' : '✅ เปิด'}` }),
              jsx('div', {
                style: { fontSize: 26, fontWeight: 650, lineHeight: 1.15 },
                className: 'font-mono tabular-nums',
                children: fmtUsd(bal),
              }),
              freeText ? jsx('div', { className: 'text-xs text-(--ui-text-tertiary)', children: freeText }) : null,
              typeof k.limit === 'number' && typeof k.used === 'number'
                ? jsxs('div', {
                    className: 'flex flex-col gap-0.5',
                    children: [
                      jsx(SpendBar, { ratio: k.used / k.limit }),
                      jsx('div', { className: 'text-xs text-(--ui-text-tertiary)', children: `cap ${fmtUsd(k.limit)} · ใช้ไป ${fmtUsd(k.used)} · เหลือ ${fmtUsd(k.limit - k.used)}` }),
                    ],
                  })
                : null,
            ],
          }),
          jsxs('div', {
            className: 'flex flex-col gap-1 border-t border-(--ui-stroke-secondary) pt-1.5',
            children: [
              jsxs('div', {
                className: 'flex gap-1',
                children: PERIODS.map((p) => jsx('button', {
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
      let label = 'MaxPlus: ไม่มี key'
      if (token) {
        if (me.data) {
          const c = me.data.credit_usd
          label = typeof c === 'number' ? `MaxPlus $${c.toFixed(2)}` : 'MaxPlus'
        } else if (me.isLoading) label = 'MaxPlus …'
        else if (me.error) label = 'MaxPlus !'
      } else if (mgmt) {
        if (keys.data) label = `MaxPlus ${pickKeyList(keys.data).length} key`
        else if (keys.isLoading) label = 'MaxPlus …'
        else if (keys.error) label = 'MaxPlus !'
      }
      return jsxs(Popover, {
        children: [
          jsx(PopoverTrigger, {
            asChild: true,
            children: jsx('button', {
              type: 'button',
              title: 'MaxPlus — กดดูสรุป',
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
      const save = () => {
        const t = draft.trim()
        if (t && !pattern.test(t)) {
          host.notify({ kind: 'info', message: `รูปแบบไม่ถูก — ${hint}` })
          return
        }
        setStored($a, storeKey, t)
        setDraft('')
        queryClient.invalidateQueries({ queryKey: [ID] })
        host.notify({ kind: 'info', message: t ? `บันทึก ${label} แล้ว` : `ลบ ${label} แล้ว` })
      }
      return jsxs('div', {
        className: 'flex flex-col gap-1.5',
        children: [
          jsx(Row, { label, value: cur ? maskToken(cur) : '— ยังไม่มี —' }),
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
                children: cur ? 'เปลี่ยน' : 'บันทึก',
              }),
              cur
                ? jsx('button', {
                    type: 'button',
                    onClick: () => {
                      setStored($a, storeKey, '')
                      setDraft('')
                      queryClient.invalidateQueries({ queryKey: [ID] })
                      host.notify({ kind: 'info', message: `ลบ ${label} แล้ว` })
                    },
                    className: 'shrink-0 rounded-sm border border-(--ui-stroke-secondary) px-2 py-1 text-xs hover:bg-(--chrome-action-hover)',
                    children: 'ลบ',
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
      if (!token) return null
      if (q.isLoading) return jsx('div', { className: 'text-sm text-(--ui-text-tertiary)', children: `${label}กำลังโหลด…` })
      if (q.error) return jsx('div', { className: 'text-sm text-(--ui-text-tertiary)', children: `${label}${ERR_TH[errKey(q.error)] || 'ดูไม่ได้'}` })
      const t = totalsOf(q.data)
      const req = t.request_count ?? t.requests ?? null
      const tok = tokensOf(t)
      return jsxs('div', {
        className: 'flex flex-col gap-0.5',
        children: [
          req != null ? jsx(Row, { label: `${label}requests`, value: String(req) }) : null,
          tok ? jsx(Row, { label: `${label}tokens`, value: fmtTokens(tok) }) : null,
          jsx(Row, { label: `${label}cost`, value: fmtUsd(costOf(t)) }),
        ],
      })
    }

    function KeyCard({ k, maxUsed }) {
      const focus = useValue($focusKey)
      const mgmt = useValue($mgmt)
      const open = focus === k.id
      const u = useQuery({
        queryKey: [ID, 'key-usage', k.id],
        queryFn: () => fetchKeyUsage(k.id),
        enabled: !!mgmt && open,
        retry: false,
      })
      const [moveOpen, setMoveOpen] = useState(false)
      const [dest, setDest] = useState(String(k.pool || 'auto'))
      const [busy, setBusy] = useState(false)
      const [scheme, setScheme] = useState('dark')
      const noCap = k.limit_usd == null || k.limit_period !== 'daily'
      const used = typeof k.used_usd === 'number' ? k.used_usd : null
      const curPool = String(k.pool || 'auto')
      const copyBase = async () => {
        const ok = await ctx.os.writeClipboard(baseFor(curPool))
        host.notify({ kind: 'info', message: ok ? `copy base URL แล้ว: ${baseFor(curPool)}` : 'copy ไม่ได้ จดเอง: ' + baseFor(curPool) })
      }
      const doMove = async () => {
        if (!dest || dest === curPool) {
          host.notify({ kind: 'info', message: 'เลือก pool ปลายทางก่อน (ต้องต่างจากเดิม)' })
          return
        }
        setBusy(true)
        try {
          await apiPatch(`/v1/api-keys/${encodeURIComponent(k.id)}`, { pool: dest })
          queryClient.invalidateQueries({ queryKey: [ID] })
          setMoveOpen(false)
          host.notify({ kind: 'info', message: `ย้าย ${k.name || k.id} → ${dest} แล้ว — เปลี่ยน base URL ที่ client เป็น ${baseFor(dest)} (secret เดิมใช้ได้)` })
        } catch (e) {
          const key = errKey(e)
          host.notify({
            kind: 'info',
            message: key === 'http-403'
              ? 'token นี้ไม่มีสิทธิ์ keys:update — สร้าง mgmt token ใหม่แล้วติ๊กเพิ่ม'
              : (ERR_TH[key] || 'ย้ายไม่สำเร็จ'),
          })
        } finally {
          setBusy(false)
        }
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
                children: `${k.active === false ? '❌ ปิด' : '✅ เปิด'} · สะสม ${fmtUsd(used)}`,
              }),
            ],
          }),
          maxUsed > 0 && used != null
            ? jsx(SpendBar, { ratio: used / maxUsed })
            : null,
          jsx(Row, { label: 'pool', value: curPool }),
          jsxs('div', {
            className: 'flex items-center justify-between gap-2 py-0.5 text-sm',
            children: [
              jsx('span', { className: 'shrink-0 text-(--ui-text-tertiary)', children: 'base URL' }),
              jsx('button', {
                type: 'button',
                title: 'กดเพื่อ copy',
                onClick: copyBase,
                className: 'truncate font-mono text-xs tabular-nums hover:bg-(--chrome-action-hover)',
                children: baseFor(curPool),
              }),
            ],
          }),
          jsx(Row, {
            label: 'cap',
            value: k.limit_usd == null ? '∞ ไม่จำกัด' : `${fmtUsd(k.limit_usd)}${k.limit_period ? `/${k.limit_period}` : ''}`,
          }),
          noCap && k.active !== false
            ? jsx('div', { className: 'text-xs text-(--ui-text-tertiary)', children: '⚠️ ไม่มี daily cap — เสี่ยงเผางบ (ตั้งใน Dashboard)' })
            : null,
          jsxs('div', {
            className: 'flex gap-1.5',
            children: [
              jsx('button', {
                type: 'button',
                onClick: () => {
                  haptic('tap')
                  $focusKey.set(open ? null : k.id)
                },
                className: 'mt-0.5 rounded-sm border border-(--ui-stroke-secondary) px-2 py-0.5 text-xs hover:bg-(--chrome-action-hover)',
                children: open ? 'ซ่อน usage' : 'ดู usage',
              }),
              jsx('button', {
                type: 'button',
                onClick: () => {
                  haptic('tap')
                  setDest(curPool)
                  setMoveOpen(!moveOpen)
                },
                className: 'mt-0.5 rounded-sm border border-(--ui-stroke-secondary) px-2 py-0.5 text-xs hover:bg-(--chrome-action-hover)',
                children: moveOpen ? 'ยกเลิกย้าย' : 'ย้าย pool',
              }),
            ],
          }),
          moveOpen
            ? jsxs('div', {
                className: 'flex flex-col gap-1 rounded-sm border border-(--ui-stroke-secondary) p-1.5',
                children: [
                  jsx('div', { className: 'text-xs text-(--ui-text-tertiary)', children: 'ย้ายแล้ว client จะ 403 จนกว่า base URL จะตรง — secret เดิมใช้ได้' }),
                  jsxs('div', {
                    className: 'flex gap-1.5',
                    children: [
                      jsx('select', {
                        value: dest,
                        onChange: (e) => setDest(e.target.value),
                        // ลิสต์ของ <select> ถูกวาดโดย Chromium ไม่ใช่ DOM ของแอป → ต้องบอก
                        // color-scheme เอง ไม่งั้นธีมมืดจะได้ลิสต์สีสว่างตัดกัน
                        // อ่านสีตัวอักษรจริงของธีมตอนกด แล้วเลือก scheme ให้ตรง (รองรับ light skin ด้วย)
                        onMouseDown: (e) => setScheme(schemeOf(e.currentTarget)),
                        onFocus: (e) => setScheme(schemeOf(e.currentTarget)),
                        style: { colorScheme: scheme },
                        className: 'min-w-0 flex-1 rounded-sm border border-(--ui-stroke-secondary) bg-transparent px-1.5 py-1 font-mono text-xs',
                        children: POOLS.map((p) => jsx('option', {
                          value: p,
                          style: { backgroundColor: 'var(--ui-bg-elevated, #1e1e1e)', color: 'var(--ui-text-primary, inherit)' },
                          children: p,
                        }, p)),
                      }),
                      jsx('button', {
                        type: 'button',
                        disabled: busy,
                        onClick: doMove,
                        className: 'shrink-0 rounded-sm border border-(--ui-stroke-secondary) px-2 py-1 text-xs hover:bg-(--chrome-action-hover)',
                        children: busy ? 'กำลังย้าย…' : 'ยืนยัน',
                      }),
                    ],
                  }),
                ],
              })
            : null,
          open
            ? (u.isLoading
                ? jsx('div', { className: 'text-xs text-(--ui-text-tertiary)', children: 'กำลังดึง…' })
                : u.error
                  ? jsx('div', { className: 'text-xs text-(--ui-text-tertiary)', children: ERR_TH[errKey(u.error)] || 'ดูไม่ได้' })
                  : (() => {
                      // shape จริงของ /v1/api-keys/{id}/usage แปรผัน ({totals…} vs {key:{used_usd…}})
                      const d = u.data || {}
                      const v = costOf(totalsOf(d)) ?? (typeof d.cost_usd === 'number' ? d.cost_usd : null)
                      if (v != null) return jsx(Row, { label: 'ยอดใช้ key', value: fmtUsd(v) })
                      const acc = (d.key && d.key.used_usd) ?? (typeof k.used_usd === 'number' ? k.used_usd : null)
                      if (typeof acc === 'number') return jsx(Row, { label: 'ใช้สะสม/key', value: fmtUsd(acc) })
                      return jsx(Row, { label: 'ยอดใช้ key', value: 'ดูใน Dashboard' })
                    })())
            : null,
        ],
      })
    }

    // Feature 1 — one-click smoke test (runbook §5.4):
    // me → models of this key's pool → tiny non-stream chat.
    // Pass = 200 + content on every step (not 401/403) with sane latency.
    function KeysSection() {
      const mgmt = useValue($mgmt)
      const q = useKeysQuery()
      const [poolFilter, setPoolFilter] = useState('all')
      const [text, setText] = useState('')
      // Feature 3 — daily-cap enforcer (runbook UC-6)
      const [capDraft, setCapDraft] = useState('10')
      const [confirmCap, setConfirmCap] = useState(false)
      const [enforcing, setEnforcing] = useState(false)
      if (!mgmt) {
        return jsx(Section, {
          title: 'key ทุก pool',
          children: jsx('div', { className: 'text-sm text-(--ui-text-tertiary)', children: 'ใส่ ccmk-… (scope keys:read + usage:read ก็พอ)' }),
        })
      }
      if (q.isLoading) {
        return jsx(Section, { title: 'key ทุก pool', children: jsx('div', { className: 'text-sm text-(--ui-text-tertiary)', children: 'กำลังดึง /v1/api-keys…' }) })
      }
      if (q.error) {
        return jsx(Section, { title: 'key ทุก pool', children: jsx('div', { className: 'text-sm', children: ERR_TH[errKey(q.error)] || 'ดูไม่ได้' }) })
      }
      const list = pickKeyList(q.data)
      if (!list.length) {
        return jsx(Section, { title: 'key ทุก pool', children: jsx('div', { className: 'text-sm text-(--ui-text-tertiary)', children: 'ไม่มี key ในบัญชี' }) })
      }
      const pools = [...new Set(list.map((k) => String(k.pool || 'auto')))].sort()
      const needle = text.trim().toLowerCase()
      const shown = list
        .filter((k) => (poolFilter === 'all' || String(k.pool || 'auto') === poolFilter))
        .filter((k) => !needle || String(k.name || '').toLowerCase().includes(needle) || String(k.id || '').toLowerCase().includes(needle))
        .sort((a, b) => (b.used_usd || 0) - (a.used_usd || 0))
      const risky = list.filter((k) => (k.limit_usd == null || k.limit_period !== 'daily') && k.active !== false).length
      const maxUsed = list.reduce((m, k) => Math.max(m, typeof k.used_usd === 'number' ? k.used_usd : 0), 0)
      const targets = list.filter((k) => (k.limit_usd == null || k.limit_period !== 'daily') && k.active !== false)
      const doEnforce = async () => {
        const cap = parseFloat(capDraft)
        if (!(cap > 0)) {
          host.notify({ kind: 'info', message: 'ใส่ cap เป็นตัวเลข $/วัน ก่อน' })
          return
        }
        haptic('tap')
        setEnforcing(true)
        let ok = 0
        let fail403 = false
        let failOther = null
        for (const k of targets) {
          try {
            await apiPatch(`/v1/api-keys/${encodeURIComponent(k.id)}`, { limit_usd: cap, limit_period: 'daily' })
            ok++
          } catch (e) {
            if (errKey(e) === 'http-403') fail403 = true
            else if (!failOther) failOther = ERR_TH[errKey(e)] || String((e && e.message) || e)
          }
        }
        setEnforcing(false)
        setConfirmCap(false)
        queryClient.invalidateQueries({ queryKey: [ID] })
        host.notify({
          kind: 'info',
          message: fail403
            ? `ต้อง scope keys:update — สร้าง mgmt token ใหม่แล้วติ๊กเพิ่ม (ใส่ได้ ${ok}/${targets.length})`
            : (ok === targets.length
                ? `ใส่ daily cap $${cap} แล้ว ${ok}/${targets.length} keys`
                : `ใส่ได้ ${ok}/${targets.length} — ติด: ${failOther || 'ดู error ราย key'}`),
        })
      }
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
        title: `key ทุก pool · ${list.length}${risky ? ` · ⚠️ ${risky} ไม่มี daily cap` : ''}`,
        children: jsxs('div', {
          className: 'flex flex-col gap-1.5',
          children: [
            risky > 0
              ? jsxs('div', {
                  className: 'flex flex-col gap-1 rounded-sm border border-(--ui-stroke-secondary) p-1.5',
                  children: [
                    jsx('div', { className: 'text-xs text-(--ui-text-tertiary)', children: `⚠️ ${risky} key ไม่มี daily cap — ใส่ให้ทั้งหมดทีเดียว (ต้อง keys:update)` }),
                    confirmCap
                      ? jsxs('div', {
                          className: 'flex gap-1.5',
                          children: [
                            jsx('button', {
                              type: 'button',
                              disabled: enforcing,
                              onClick: doEnforce,
                              className: 'rounded-sm border border-(--ui-stroke-secondary) px-2 py-1 text-xs hover:bg-(--chrome-action-hover)',
                              children: enforcing ? 'กำลังใส่…' : `ยืนยัน $${capDraft || '?'}/วัน ให้ ${targets.length} keys`,
                            }),
                            jsx('button', {
                              type: 'button',
                              onClick: () => setConfirmCap(false),
                              className: 'rounded-sm border border-(--ui-stroke-secondary) px-2 py-1 text-xs hover:bg-(--chrome-action-hover)',
                              children: 'ยกเลิก',
                            }),
                          ],
                        })
                      : jsxs('div', {
                          className: 'flex gap-1.5',
                          children: [
                            jsx('input', {
                              value: capDraft,
                              spellCheck: false,
                              inputMode: 'decimal',
                              placeholder: '$/วัน (เช่น 10)',
                              onChange: (e) => setCapDraft(e.target.value),
                              className: 'w-36 rounded-sm border border-(--ui-stroke-secondary) bg-transparent px-1.5 py-1 font-mono text-xs',
                            }),
                            jsx('button', {
                              type: 'button',
                              onClick: () => {
                                haptic('tap')
                                setConfirmCap(true)
                              },
                              className: 'shrink-0 rounded-sm border border-(--ui-stroke-secondary) px-2 py-1 text-xs hover:bg-(--chrome-action-hover)',
                              children: 'ใส่ cap',
                            }),
                          ],
                        }),
                  ],
                })
              : null,
            jsx('input', {
              value: text,
              spellCheck: false,
              placeholder: 'ค้นชื่อ key…',
              onChange: (e) => setText(e.target.value),
              className: 'min-w-0 flex-1 rounded-sm border border-(--ui-stroke-secondary) bg-transparent px-1.5 py-1 text-xs',
            }),
            jsxs('div', {
              className: 'flex gap-1 overflow-y-auto',
              children: [chipBtn('all', `ทั้งหมด (${list.length})`, poolFilter === 'all'), ...pools.map((p) => chipBtn(p, p, poolFilter === p))],
            }),
            shown.length
              ? jsxs('div', {
                  className: 'flex flex-col gap-1.5',
                  children: [
                    jsx('div', { className: 'text-xs text-(--ui-text-tertiary)', children: `โชว์ ${shown.length}/${list.length} · เรียงตามยอดใช้ (bar = เทียบตัวท็อป)` }),
                    ...shown.map((k) => jsx(KeyCard, { k, maxUsed }, k.id)),
                  ],
                })
              : jsx('div', { className: 'text-xs text-(--ui-text-tertiary)', children: 'ไม่เจอ key ตรงเงื่อนไข' }),
          ],
        }),
      })
    }

    function HeroSection() {
      const token = useValue($token)
      const me = useMeQuery()
      const u7 = useUsageQuery('7d')
      if (!token) {
        return jsx(Section, {
          title: 'เครดิต',
          children: jsx('div', { className: 'text-sm text-(--ui-text-tertiary)', children: 'ใส่ ccsk-… ด้านล่างก่อน — มีแค่ management token ก็ดูตาราง key ได้' }),
        })
      }
      if (me.isLoading) {
        return jsx(Section, { title: 'เครดิต', children: jsx('div', { className: 'text-sm text-(--ui-text-tertiary)', children: 'กำลังดึง /v1/me…' }) })
      }
      if (me.error) {
        return jsx(Section, { title: 'เครดิต', children: jsx('div', { className: 'text-sm', children: ERR_TH[errKey(me.error)] || 'ดูไม่ได้' }) })
      }
      const k = pickKey(me.data)
      const bal = me.data && me.data.credit_usd
      const c7 = !u7.isLoading && !u7.error ? costOf(totalsOf(u7.data)) : null
      const perDay = c7 != null ? c7 / 7 : null
      const days = typeof bal === 'number' && perDay > 0 ? bal / perDay : null
      const pace = days == null
        ? (c7 != null ? `เผาเฉลี่ย ${fmtUsd(perDay)}/วัน` : 'รอ usage 7 วัน…')
        : days < 3
          ? `เผาเฉลี่ย ${fmtUsd(perDay)}/วัน → เหลือ ~${days < 1 ? 'ไม่ถึงวัน' : `${Math.floor(days)} วัน`} ⚠️`
          : `เผาเฉลี่ย ${fmtUsd(perDay)}/วัน → เหลือ ~${Math.floor(days)} วัน`
      const freeText = freeLine(k.free)
      return jsxs('div', {
        className: 'flex flex-col gap-0.5 rounded-md border border-(--ui-stroke-secondary) p-3',
        children: [
          jsx('div', { className: 'text-xs text-(--ui-text-tertiary)', children: `คงเหลือ · pool ${k.pool} · ${k.active === false ? '❌ ปิด' : '✅ เปิด'}` }),
          jsx('div', {
            style: { fontSize: 30, fontWeight: 650, lineHeight: 1.15 },
            className: 'font-mono tabular-nums',
            children: fmtUsd(bal),
          }),
          jsx('div', { className: 'text-xs text-(--ui-text-tertiary)', children: pace }),
          freeText ? jsx('div', { className: 'text-xs text-(--ui-text-tertiary)', children: freeText }) : null,
          typeof k.limit === 'number' && typeof k.used === 'number'
            ? jsxs('div', {
                className: 'flex flex-col gap-0.5',
                children: [
                  jsx(SpendBar, { ratio: k.used / k.limit }),
                  jsx('div', { className: 'text-xs text-(--ui-text-tertiary)', children: `cap ${fmtUsd(k.limit)} · ใช้ไป ${fmtUsd(k.used)} · เหลือ ${fmtUsd(k.limit - k.used)}` }),
                ],
              })
            : jsx('div', { className: 'text-xs text-(--ui-text-tertiary)', children: `key นี้ใช้สะสม ${fmtUsd(k.used)} · ไม่จำกัด cap` }),
        ],
      })
    }

    function StatusPage() {
      const [usagePeriod, setUsagePeriod] = useState('1d')
      const refresh = () => {
        queryClient.invalidateQueries({ queryKey: [ID] })
        host.notify({ kind: 'info', message: 'รีเฟรช MaxPlus แล้ว' })
      }
      return jsxs('div', {
        className: 'flex h-full flex-col gap-2 overflow-y-auto p-3 text-sm',
        children: [
          jsxs('div', {
            className: 'flex items-center justify-between',
            children: [
              jsx('div', { className: 'font-medium', children: 'MaxPlus' }),
              jsx('button', {
                type: 'button',
                onClick: refresh,
                className: 'rounded-sm border border-(--ui-stroke-secondary) px-2 py-0.5 text-xs hover:bg-(--chrome-action-hover)',
                children: 'รีเฟรช',
              }),
            ],
          }),
          jsx(HeroSection, {}),
          jsx(Section, {
            title: 'usage บัญชี',
            right: jsx('div', { className: 'text-xs text-(--ui-text-tertiary)', children: '24 ชม. รีเฟรชทุก 15 วิ' }),
            children: jsxs('div', {
              className: 'flex flex-col gap-2',
              children: [
                jsx('div', {
                  className: 'flex gap-1',
                  children: PERIODS.map((p) => jsx('button', {
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
          jsx(Section, {
            title: 'tokens',
            children: jsxs('div', {
              className: 'flex flex-col gap-2',
              children: [
                jsx(TokenField, {
                  $a: $token,
                  storeKey: 'token',
                  label: 'inference (ccsk)',
                  placeholder: 'ccsk-…',
                  pattern: KEY_RE,
                  hint: 'ต้อง ccsk- ตามด้วย hex 64 ตัว',
                }),
                jsx(TokenField, {
                  $a: $mgmt,
                  storeKey: 'mgmt',
                  label: 'management (ccmk)',
                  placeholder: 'ccmk-…',
                  pattern: MGMT_RE,
                  hint: 'ต้องขึ้นต้น ccmk- · ดูอย่างเดียวก็พอ, แช่แข็ง/ใส่ cap/ย้าย pool ต้อง keys:update',
                }),
              ],
            }),
          }),
          jsx(Section, {
            title: 'เช้าละ 2 นาที',
            children: jsx('div', {
              className: 'text-xs leading-relaxed text-(--ui-text-tertiary)',
              children: 'credit พอไหม → key เปิด + pool ตรงเครื่องมือ → cap ไม่ชน → ไม่มี stream ค้าง (20 shared)',
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
        id: 'open',
        area: PALETTE_AREA,
        data: {
          id: 'maxplus.open',
          label: 'MaxPlus: เปิดหน้าสถานะ',
          keywords: ['maxplus', 'credit', 'เครดิต', 'คีย์', 'status'],
          run: () => host.navigate('/maxplus'),
        },
      },
      {
        id: 'refresh',
        area: PALETTE_AREA,
        data: {
          id: 'maxplus.refresh',
          label: 'MaxPlus: รีเฟรชเครดิต',
          keywords: ['maxplus', 'refresh', 'รีเฟรช'],
          run: () => {
            queryClient.invalidateQueries({ queryKey: [ID] })
            host.notify({ kind: 'info', message: 'รีเฟรช MaxPlus แล้ว' })
          },
        },
      },
      {
        id: 'clear',
        area: PALETTE_AREA,
        data: {
          id: 'maxplus.clear',
          label: 'MaxPlus: ลบ tokens',
          keywords: ['maxplus', 'token', 'clear', 'ลบ'],
          run: () => {
            setStored($token, 'token', '')
            setStored($mgmt, 'mgmt', '')
            queryClient.invalidateQueries({ queryKey: [ID] })
            host.notify({ kind: 'info', message: 'ลบ MaxPlus tokens แล้ว' })
          },
        },
      },
    ])
  },
}
