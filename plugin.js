/**
 * MaxPlus Credit — Hermes desktop plugin (frontend-only, v4 bilingual).
 *
 * แสดงเครดิต + usage + key ทุก pool ของ MaxPlus (api.maxplus-ai.cc)
 * Shows MaxPlus credit, usage and per-pool keys (Thai · English UI).
 *
 * - statusBar chip: credit balance (or key count), polls every 60s
 * - page /maxplus: hero balance + burn pace, account usage 1d/7d/30d,
 *   all-keys table (search / pool filter / sort by spend), pool mover,
 *   token slots (ccsk + ccmk)
 * - palette: open status / refresh / clear tokens
 *
 * Tokens live in the app's ctx.storage only — never in this repo.
 * Read-only scopes (keys:read + usage:read) are enough for viewing;
 * keys:update is needed only for moving a key to another pool.
 */

import {
  STATUSBAR_AREAS,
  PALETTE_AREA,
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
const KEY_RE = /^ccsk-[a-f0-9]{64}$/
const MGMT_RE = /^ccmk-\S{8,}$/

const ERR_TH = {
  'no-token': 'ยังไม่ได้ตั้ง token · No token set',
  network: 'ต่อ API ไม่ได้ (เน็ต/CORS) · Cannot reach API (network/CORS)',
  'http-401': '401 token ผิด/หมดอายุ · invalid/expired token',
  'http-402': '402 เครดิตหมด — เติมที่ /dashboard/topup แล้วรอ ~30s · out of credit, top up then wait ~30s',
  'http-403': '403 สิทธิ์ไม่พอ หรือ key ไม่ผูก pool · missing scope or wrong pool',
  'http-404': '404 path ผิด · bad path',
  'http-409': '409 key ผิดประเภท (text/image) · wrong key type',
  'http-429': '429 ชน cap/concurrent · cap or concurrency hit',
  'http-503': '503 pool ล่ม · pool down',
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

function totalsOf(json) {
  return ((json && json.totals) || json || {})
}

function costOf(t) {
  const v = t.total_cost_usd ?? t.total_cost ?? t.cost_usd
  return typeof v === 'number' ? v : null
}

function pickKey(me) {
  const k = (me && me.key) || {}
  const free = (me && me.daily_free_credit) || {}
  return {
    pool: k.key_pool || free.key_pool || '—',
    limit: k.limit_usd ?? null,
    used: k.limit_used_usd ?? null,
    active: k.active ?? null,
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
          headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify(body),
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
        refetchInterval: 300000,
        retry: false,
      })
    }

    function Chip() {
      const token = useValue($token)
      const mgmt = useValue($mgmt)
      const me = useMeQuery()
      const keys = useKeysQuery()
      let label = 'MaxPlus: no key'
      if (token) {
        if (me.data) {
          const c = me.data.credit_usd
          label = typeof c === 'number' ? `MaxPlus $${c.toFixed(2)}` : 'MaxPlus'
        } else if (me.isLoading) label = 'MaxPlus …'
        else if (me.error) label = 'MaxPlus !'
      } else if (mgmt) {
        if (keys.data) label = `MaxPlus ${pickKeyList(keys.data).length} keys`
        else if (keys.isLoading) label = 'MaxPlus …'
        else if (keys.error) label = 'MaxPlus !'
      }
      return jsx('button', {
        type: 'button',
        title: 'MaxPlus credit — open status · เปิดหน้าสถานะ',
        className: 'inline-flex h-full items-center gap-1 px-1.5 text-[0.6875rem] text-(--ui-text-tertiary) transition-colors hover:bg-(--chrome-action-hover) hover:text-foreground',
        onClick: () => {
          haptic('tap')
          host.navigate('/maxplus')
        },
        children: label,
      })
    }

    function TokenField({ $a, storeKey, label, placeholder, pattern, hint }) {
      const cur = useValue($a)
      const [draft, setDraft] = useState('')
      const save = () => {
        const t = draft.trim()
        if (t && !pattern.test(t)) {
          host.notify({ kind: 'info', message: `รูปแบบไม่ถูก · Bad format — ${hint}` })
          return
        }
        setStored($a, storeKey, t)
        setDraft('')
        queryClient.invalidateQueries({ queryKey: [ID] })
        host.notify({ kind: 'info', message: t ? `บันทึก ${label} แล้ว · saved` : `ลบ ${label} แล้ว · removed` })
      }
      return jsxs('div', {
        className: 'flex flex-col gap-1.5',
        children: [
          jsx(Row, { label, value: cur ? maskToken(cur) : '— ยังไม่มี · none —' }),
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
                children: cur ? 'เปลี่ยน · Change' : 'บันทึก · Save',
              }),
              cur
                ? jsx('button', {
                    type: 'button',
                    onClick: () => {
                      setStored($a, storeKey, '')
                      setDraft('')
                      queryClient.invalidateQueries({ queryKey: [ID] })
                      host.notify({ kind: 'info', message: `ลบ ${label} แล้ว · removed` })
                    },
                    className: 'shrink-0 rounded-sm border border-(--ui-stroke-secondary) px-2 py-1 text-xs hover:bg-(--chrome-action-hover)',
                    children: 'ลบ · Remove',
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
      if (q.isLoading) return jsx('div', { className: 'text-sm text-(--ui-text-tertiary)', children: `${label}กำลังโหลด… · loading…` })
      if (q.error) return jsx('div', { className: 'text-sm text-(--ui-text-tertiary)', children: `${label}${ERR_TH[errKey(q.error)] || 'ดูไม่ได้ · unavailable'}` })
      const t = totalsOf(q.data)
      const req = t.request_count ?? t.requests ?? null
      return jsxs('div', {
        className: 'flex flex-col gap-0.5',
        children: [
          jsx(Row, { label: `${label}cost`, value: fmtUsd(costOf(t)) }),
          req != null ? jsx(Row, { label: `${label}requests`, value: String(req) }) : null,
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
      const noCap = k.limit_usd == null || k.limit_period !== 'daily'
      const used = typeof k.used_usd === 'number' ? k.used_usd : null
      const curPool = String(k.pool || 'auto')
      const copyBase = async () => {
        const ok = await ctx.os.writeClipboard(baseFor(curPool))
        host.notify({ kind: 'info', message: ok ? `copy base URL แล้ว · copied: ${baseFor(curPool)}` : 'copy ไม่ได้ จดเอง · copy failed: ' + baseFor(curPool) })
      }
      const doMove = async () => {
        if (!dest || dest === curPool) {
          host.notify({ kind: 'info', message: 'เลือก pool ปลายทางก่อน (ต้องต่างจากเดิม) · pick a different pool' })
          return
        }
        setBusy(true)
        try {
          await apiPatch(`/v1/api-keys/${encodeURIComponent(k.id)}`, { pool: dest })
          queryClient.invalidateQueries({ queryKey: [ID] })
          setMoveOpen(false)
          host.notify({ kind: 'info', message: `ย้าย ${k.name || k.id} → ${dest} แล้ว · moved — เปลี่ยน base URL ที่ client เป็น ${baseFor(dest)} (secret เดิมใช้ได้ · same secret)` })
        } catch (e) {
          const key = errKey(e)
          host.notify({
            kind: 'info',
            message: key === 'http-403'
              ? 'token นี้ไม่มีสิทธิ์ keys:update — สร้าง mgmt token ใหม่แล้วติ๊กเพิ่ม · token lacks keys:update'
              : (ERR_TH[key] || 'ย้ายไม่สำเร็จ · move failed'),
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
                children: `${k.active === false ? '❌ ปิด/off' : '✅ เปิด/on'} · สะสม/total ${fmtUsd(used)}`,
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
                title: 'กดเพื่อ copy · click to copy',
                onClick: copyBase,
                className: 'truncate font-mono text-xs tabular-nums hover:bg-(--chrome-action-hover)',
                children: baseFor(curPool),
              }),
            ],
          }),
          jsx(Row, {
            label: 'cap',
            value: k.limit_usd == null ? '∞ (unlimited · ไม่จำกัด)' : `${fmtUsd(k.limit_usd)}${k.limit_period ? `/${k.limit_period}` : ''}`,
          }),
          noCap && k.active !== false
            ? jsx('div', { className: 'text-xs text-(--ui-text-tertiary)', children: '⚠️ ไม่มี daily cap — เสี่ยงเผางบ (ตั้งใน Dashboard) · no daily cap, set one in Dashboard' })
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
                children: open ? 'ซ่อน usage · Hide' : 'ดู usage · Usage',
              }),
              jsx('button', {
                type: 'button',
                onClick: () => {
                  haptic('tap')
                  setDest(curPool)
                  setMoveOpen(!moveOpen)
                },
                className: 'mt-0.5 rounded-sm border border-(--ui-stroke-secondary) px-2 py-0.5 text-xs hover:bg-(--chrome-action-hover)',
                children: moveOpen ? 'ยกเลิกย้าย · Cancel' : 'ย้าย pool · Move',
              }),
            ],
          }),
          moveOpen
            ? jsxs('div', {
                className: 'flex flex-col gap-1 rounded-sm border border-(--ui-stroke-secondary) p-1.5',
                children: [
                  jsx('div', { className: 'text-xs text-(--ui-text-tertiary)', children: 'ย้ายแล้ว client จะ 403 จนกว่า base URL จะตรง — secret เดิมใช้ได้ · clients 403 until base URL matches — same secret' }),
                  jsxs('div', {
                    className: 'flex gap-1.5',
                    children: [
                      jsx('select', {
                        value: dest,
                        onChange: (e) => setDest(e.target.value),
                        className: 'min-w-0 flex-1 rounded-sm border border-(--ui-stroke-secondary) bg-transparent px-1.5 py-1 font-mono text-xs',
                        children: POOLS.map((p) => jsx('option', { value: p, children: p }, p)),
                      }),
                      jsx('button', {
                        type: 'button',
                        disabled: busy,
                        onClick: doMove,
                        className: 'shrink-0 rounded-sm border border-(--ui-stroke-secondary) px-2 py-1 text-xs hover:bg-(--chrome-action-hover)',
                        children: busy ? 'กำลังย้าย… · moving…' : 'ยืนยัน · Confirm',
                      }),
                    ],
                  }),
                ],
              })
            : null,
          open
            ? (u.isLoading
                ? jsx('div', { className: 'text-xs text-(--ui-text-tertiary)', children: 'กำลังดึง… · loading…' })
                : u.error
                  ? jsx('div', { className: 'text-xs text-(--ui-text-tertiary)', children: ERR_TH[errKey(u.error)] || 'ดูไม่ได้ · unavailable' })
                  : (() => {
                      const d = u.data || {}
                      const v = costOf(totalsOf(d)) ?? (typeof d.cost_usd === 'number' ? d.cost_usd : null)
                      if (v != null) return jsx(Row, { label: 'usage/key', value: fmtUsd(v) })
                      const acc = (d.key && d.key.used_usd) ?? (typeof k.used_usd === 'number' ? k.used_usd : null)
                      if (typeof acc === 'number') return jsx(Row, { label: 'ใช้สะสม/key · lifetime/key', value: fmtUsd(acc) })
                      return jsx(Row, { label: 'usage/key', value: 'ดูใน Dashboard · check Dashboard' })
                    })())
            : null,
        ],
      })
    }

    function KeysSection() {
      const mgmt = useValue($mgmt)
      const q = useKeysQuery()
      const [poolFilter, setPoolFilter] = useState('all')
      const [text, setText] = useState('')
      if (!mgmt) {
        return jsx(Section, {
          title: 'key ทุก pool · Keys by pool',
          children: jsx('div', { className: 'text-sm text-(--ui-text-tertiary)', children: 'ใส่ ccmk-… (scope keys:read + usage:read ก็พอ) · add ccmk-… (keys:read + usage:read is enough)' }),
        })
      }
      if (q.isLoading) {
        return jsx(Section, { title: 'key ทุก pool · Keys by pool', children: jsx('div', { className: 'text-sm text-(--ui-text-tertiary)', children: 'กำลังดึง /v1/api-keys… · loading…' }) })
      }
      if (q.error) {
        return jsx(Section, { title: 'key ทุก pool · Keys by pool', children: jsx('div', { className: 'text-sm', children: ERR_TH[errKey(q.error)] || 'ดูไม่ได้ · unavailable' }) })
      }
      const list = pickKeyList(q.data)
      if (!list.length) {
        return jsx(Section, { title: 'key ทุก pool · Keys by pool', children: jsx('div', { className: 'text-sm text-(--ui-text-tertiary)', children: 'ไม่มี key ในบัญชี · no keys' }) })
      }
      const pools = [...new Set(list.map((k) => String(k.pool || 'auto')))].sort()
      const needle = text.trim().toLowerCase()
      const shown = list
        .filter((k) => (poolFilter === 'all' || String(k.pool || 'auto') === poolFilter))
        .filter((k) => !needle || String(k.name || '').toLowerCase().includes(needle) || String(k.id || '').toLowerCase().includes(needle))
        .sort((a, b) => (b.used_usd || 0) - (a.used_usd || 0))
      const risky = list.filter((k) => (k.limit_usd == null || k.limit_period !== 'daily') && k.active !== false).length
      const maxUsed = list.reduce((m, k) => Math.max(m, typeof k.used_usd === 'number' ? k.used_usd : 0), 0)
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
        title: `key ทุก pool · ${list.length} keys${risky ? ` · ⚠️ ${risky} ไม่มี daily cap · no daily cap` : ''}`,
        children: jsxs('div', {
          className: 'flex flex-col gap-1.5',
          children: [
            jsx('input', {
              value: text,
              spellCheck: false,
              placeholder: 'ค้นชื่อ key… · search keys…',
              onChange: (e) => setText(e.target.value),
              className: 'min-w-0 flex-1 rounded-sm border border-(--ui-stroke-secondary) bg-transparent px-1.5 py-1 text-xs',
            }),
            jsxs('div', {
              className: 'flex gap-1 overflow-y-auto',
              children: [chipBtn('all', `ทั้งหมด · All (${list.length})`, poolFilter === 'all'), ...pools.map((p) => chipBtn(p, p, poolFilter === p))],
            }),
            shown.length
              ? jsxs('div', {
                  className: 'flex flex-col gap-1.5',
                  children: [
                    jsx('div', { className: 'text-xs text-(--ui-text-tertiary)', children: `โชว์ ${shown.length}/${list.length} · เรียงตามยอดใช้ · sorted by spend (bar = vs top)` }),
                    ...shown.map((k) => jsx(KeyCard, { k, maxUsed }, k.id)),
                  ],
                })
              : jsx('div', { className: 'text-xs text-(--ui-text-tertiary)', children: 'ไม่เจอ key ตรงเงื่อนไข · no matches' }),
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
          title: 'เครดิต · Credit',
          children: jsx('div', { className: 'text-sm text-(--ui-text-tertiary)', children: 'ใส่ ccsk-… ด้านล่างก่อน — มีแค่ management token ก็ดูตาราง key ได้ · add ccsk-… below, or use management token for the table' }),
        })
      }
      if (me.isLoading) {
        return jsx(Section, { title: 'เครดิต · Credit', children: jsx('div', { className: 'text-sm text-(--ui-text-tertiary)', children: 'กำลังดึง /v1/me… · loading…' }) })
      }
      if (me.error) {
        return jsx(Section, { title: 'เครดิต · Credit', children: jsx('div', { className: 'text-sm', children: ERR_TH[errKey(me.error)] || 'ดูไม่ได้ · unavailable' }) })
      }
      const k = pickKey(me.data)
      const bal = me.data && me.data.credit_usd
      const c7 = !u7.isLoading && !u7.error ? costOf(totalsOf(u7.data)) : null
      const perDay = c7 != null ? c7 / 7 : null
      const days = typeof bal === 'number' && perDay > 0 ? bal / perDay : null
      const pace = days == null
        ? (c7 != null ? `เผาเฉลี่ย ${fmtUsd(perDay)}/วัน · burns ${fmtUsd(perDay)}/day` : 'รอ usage 7 วัน… · waiting for 7d usage…')
        : days < 3
          ? `เผาเฉลี่ย ${fmtUsd(perDay)}/วัน → เหลือ ~${days < 1 ? 'ไม่ถึงวัน' : `${Math.floor(days)} วัน`} ⚠️ · ~${days < 1 ? '<1' : Math.floor(days)} days left`
          : `เผาเฉลี่ย ${fmtUsd(perDay)}/วัน → เหลือ ~${Math.floor(days)} วัน · ~${Math.floor(days)} days left`
      return jsxs('div', {
        className: 'flex flex-col gap-0.5 rounded-md border border-(--ui-stroke-secondary) p-3',
        children: [
          jsx('div', { className: 'text-xs text-(--ui-text-tertiary)', children: `คงเหลือ · Balance · pool ${k.pool} · ${k.active === false ? '❌ off·ปิด' : '✅ on·เปิด'}` }),
          jsx('div', {
            style: { fontSize: 30, fontWeight: 650, lineHeight: 1.15 },
            className: 'font-mono tabular-nums',
            children: fmtUsd(bal),
          }),
          jsx('div', { className: 'text-xs text-(--ui-text-tertiary)', children: pace }),
          typeof k.limit === 'number' && typeof k.used === 'number'
            ? jsxs('div', {
                className: 'flex flex-col gap-0.5',
                children: [
                  jsx(SpendBar, { ratio: k.used / k.limit }),
                  jsx('div', { className: 'text-xs text-(--ui-text-tertiary)', children: `cap ${fmtUsd(k.limit)} · ใช้ไป/used ${fmtUsd(k.used)} · เหลือ/left ${fmtUsd(k.limit - k.used)}` }),
                ],
              })
            : jsx('div', { className: 'text-xs text-(--ui-text-tertiary)', children: `ใช้ไป/used ${fmtUsd(k.used)} · key นี้ไม่จำกัด cap · uncapped` }),
        ],
      })
    }

    function StatusPage() {
      const refresh = () => {
        queryClient.invalidateQueries({ queryKey: [ID] })
        host.notify({ kind: 'info', message: 'รีเฟรช MaxPlus แล้ว · refreshed' })
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
                children: 'รีเฟรช · Refresh',
              }),
            ],
          }),
          jsx(HeroSection, {}),
          jsx(Section, {
            title: 'usage บัญชี · Account usage',
            children: jsxs('div', {
              className: 'flex flex-col',
              children: [
                jsx(UsageBlock, { period: '1d', label: '24 ชม. · 24h ' }),
                jsx(UsageBlock, { period: '7d', label: '7 วัน · 7d ' }),
                jsx(UsageBlock, { period: '30d', label: '30 วัน · 30d ' }),
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
                  hint: 'ต้อง ccsk- ตามด้วย hex 64 ตัว · ccsk- + 64 hex chars',
                }),
                jsx(TokenField, {
                  $a: $mgmt,
                  storeKey: 'mgmt',
                  label: 'management (ccmk)',
                  placeholder: 'ccmk-…',
                  pattern: MGMT_RE,
                  hint: 'ต้องขึ้นต้น ccmk- (read-only ก็พอ) · must start with ccmk- (read-only OK)',
                }),
              ],
            }),
          }),
          jsx(Section, {
            title: 'เช้าละ 2 นาที · 2-min morning check',
            children: jsx('div', {
              className: 'text-xs leading-relaxed text-(--ui-text-tertiary)',
              children: 'credit พอไหม → key เปิด + pool ตรงเครื่องมือ → cap ไม่ชน → ไม่มี stream ค้าง (20 shared) · enough credit → keys on + pools match tools → caps unhit → no stuck streams',
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
          label: 'MaxPlus: เปิดหน้าสถานะ · Open status',
          keywords: ['maxplus', 'credit', 'เครดิต', 'คีย์', 'status'],
          run: () => host.navigate('/maxplus'),
        },
      },
      {
        id: 'refresh',
        area: PALETTE_AREA,
        data: {
          id: 'maxplus.refresh',
          label: 'MaxPlus: รีเฟรชเครดิต · Refresh credit',
          keywords: ['maxplus', 'refresh', 'รีเฟรช'],
          run: () => {
            queryClient.invalidateQueries({ queryKey: [ID] })
            host.notify({ kind: 'info', message: 'รีเฟรช MaxPlus แล้ว · refreshed' })
          },
        },
      },
      {
        id: 'clear',
        area: PALETTE_AREA,
        data: {
          id: 'maxplus.clear',
          label: 'MaxPlus: ลบ tokens · Clear tokens',
          keywords: ['maxplus', 'token', 'clear', 'ลบ'],
          run: () => {
            setStored($token, 'token', '')
            setStored($mgmt, 'mgmt', '')
            queryClient.invalidateQueries({ queryKey: [ID] })
            host.notify({ kind: 'info', message: 'ลบ MaxPlus tokens แล้ว · cleared' })
          },
        },
      },
    ])
  },
}
