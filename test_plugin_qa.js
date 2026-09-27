/**
 * Automated QA Test Suite for MaxPlus Credit plugin.js
 * Tests helper functions, formatting, parsing, token masking, regex validators, boundary fuzzing, and syntax.
 */

const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { execSync } = require('child_process');

const PLUGIN_PATH = path.resolve(__dirname, 'plugin.js');

console.log('======================================================');
console.log('  MaxPlus Credit plugin.js Comprehensive QA Test Suite');
console.log('======================================================\n');

// 1. Syntax Check via node --check
console.log('[STEP 1] Running syntax check: node --check plugin.js');
try {
  execSync(`node --check "${PLUGIN_PATH}"`, { stdio: 'pipe' });
  console.log('  PASSED: node --check plugin.js completed with 0 errors.\n');
} catch (err) {
  console.error('  FAILED: node --check failed:', err.message);
  process.exit(1);
}

// 2. Extract & instantiate helper functions from plugin.js
console.log('[STEP 2] Loading & extracting functions from plugin.js');
const source = fs.readFileSync(PLUGIN_PATH, 'utf8');

// Isolate helper code between 'const KEY_RE =' and 'export default {'
const startMarker = 'const API =';
const endMarker = 'export default {';

const startIndex = source.indexOf(startMarker);
const endIndex = source.indexOf(endMarker);

if (startIndex === -1 || endIndex === -1) {
  console.error('  FAILED: Could not locate helper functions section in plugin.js');
  process.exit(1);
}

const helpersCode = source.slice(startIndex, endIndex) + `
globalThis.KEY_RE = KEY_RE;
globalThis.MGMT_RE = MGMT_RE;
globalThis.ERR_TH = ERR_TH;
globalThis.errKey = errKey;
globalThis.fmtUsd = fmtUsd;
globalThis.fmtReset = fmtReset;
globalThis.freeLine = freeLine;
globalThis.totalsOf = totalsOf;
globalThis.costOf = costOf;
globalThis.fmtTokens = fmtTokens;
globalThis.tokensOf = tokensOf;
globalThis.pickKey = pickKey;
globalThis.pickKeyList = pickKeyList;
globalThis.maskToken = maskToken;
globalThis.API = API;
globalThis.AUTH = AUTH;
globalThis.baseFor = baseFor;
globalThis.isReasoningModel = isReasoningModel;
globalThis.classifyModelCategory = classifyModelCategory;
globalThis.buildProbePayload = buildProbePayload;
globalThis.parseProbeResponse = parseProbeResponse;
`;

const sandbox = {
  Date,
  Math,
  String,
  Number,
  Array,
  Object,
  RegExp,
  JSON,
  console,
  encodeURIComponent,
};
sandbox.globalThis = sandbox;

vm.createContext(sandbox);
vm.runInContext(helpersCode, sandbox);

const {
  KEY_RE,
  MGMT_RE,
  ERR_TH,
  errKey,
  fmtUsd,
  fmtReset,
  freeLine,
  totalsOf,
  costOf,
  fmtTokens,
  tokensOf,
  pickKey,
  pickKeyList,
  maskToken,
  API,
  AUTH,
  baseFor,
  isReasoningModel,
  classifyModelCategory,
  buildProbePayload,
  parseProbeResponse,
} = sandbox;

console.log('  PASSED: Successfully loaded functions into sandbox environment.\n');

// Test Harness
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failures = [];

function assertTest(fnName, testDesc, actual, expected, condition) {
  totalTests++;
  const passed = condition !== undefined ? condition : (JSON.stringify(actual) === JSON.stringify(expected) || Object.is(actual, expected));
  if (passed) {
    passedTests++;
    console.log(`  [PASS] [${fnName}] ${testDesc}`);
    console.log(`         -> Output: ${JSON.stringify(actual)}`);
  } else {
    failedTests++;
    console.error(`  [FAIL] [${fnName}] ${testDesc}`);
    console.error(`         -> Expected: ${JSON.stringify(expected)}`);
    console.error(`         -> Actual:   ${JSON.stringify(actual)}`);
    failures.push({ fnName, testDesc, actual, expected });
  }
}

console.log('[STEP 3] Executing Unit & Edge Case Tests');
console.log('------------------------------------------------------');

// ─── AUTH and Security ───────────────────────────────────────
console.log('\n--- Testing Security & Auth constants ---');
{
  assertTest('AUTH', 'Bearer scheme reconstruction', AUTH, 'Bearer');
  assertTest('KEY_RE', 'Valid ccsk key 64 hex', KEY_RE.test('ccsk-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'), true);
  assertTest('KEY_RE', 'Invalid ccsk key (short hex)', KEY_RE.test('ccsk-12345'), false);
  assertTest('KEY_RE', 'Invalid ccsk prefix', KEY_RE.test('sk-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'), false);
  assertTest('KEY_RE', 'Invalid ccsk uppercase hex', KEY_RE.test('ccsk-0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF'), false);
  assertTest('MGMT_RE', 'Valid ccmk management key', MGMT_RE.test('ccmk-admin123456'), true);
  assertTest('MGMT_RE', 'Invalid ccmk key (too short)', MGMT_RE.test('ccmk-123'), false);
  assertTest('MGMT_RE', 'Invalid prefix for mgmt', MGMT_RE.test('mgmt-123456789'), false);
}

// ─── fmtUsd ──────────────────────────────────────────────────
console.log('\n--- Testing fmtUsd() ---');
{
  assertTest('fmtUsd', 'Positive float (12.3456)', fmtUsd(12.3456), '$12.35');
  assertTest('fmtUsd', 'Zero (0)', fmtUsd(0), '$0.00');
  assertTest('fmtUsd', 'Negative float (-5.5)', fmtUsd(-5.5), '$-5.50');
  assertTest('fmtUsd', 'IEEE-754 0.1 + 0.2', fmtUsd(0.1 + 0.2), '$0.30');
  assertTest('fmtUsd', 'Very small float (0.00001)', fmtUsd(0.00001), '$0.00');
  assertTest('fmtUsd', 'Large number (1000000.5)', fmtUsd(1000000.5), '$1000000.50');
  assertTest('fmtUsd', 'NaN', fmtUsd(NaN), '—');
  assertTest('fmtUsd', 'Infinity', fmtUsd(Infinity), '—');
  assertTest('fmtUsd', '-Infinity', fmtUsd(-Infinity), '—');
  assertTest('fmtUsd', 'null', fmtUsd(null), '—');
  assertTest('fmtUsd', 'undefined', fmtUsd(undefined), '—');
  assertTest('fmtUsd', 'String "12.34"', fmtUsd('12.34'), '—');
}

// ─── fmtTokens ───────────────────────────────────────────────
console.log('\n--- Testing fmtTokens() ---');
{
  assertTest('fmtTokens', 'Millions (1,500,000)', fmtTokens(1500000), '1.5M');
  assertTest('fmtTokens', 'Millions boundary (1,000,000)', fmtTokens(1000000), '1.0M');
  assertTest('fmtTokens', 'Thousands (2,450)', fmtTokens(2450), '2.5k');
  assertTest('fmtTokens', 'Thousands boundary (1,000)', fmtTokens(1000), '1.0k');
  assertTest('fmtTokens', 'Hundreds (999)', fmtTokens(999), '999');
  assertTest('fmtTokens', 'Zero (0)', fmtTokens(0), '0');
  assertTest('fmtTokens', 'Rounding float (12.6)', fmtTokens(12.6), '13');
  assertTest('fmtTokens', 'NaN', fmtTokens(NaN), null);
  assertTest('fmtTokens', 'Infinity', fmtTokens(Infinity), null);
  assertTest('fmtTokens', '-Infinity', fmtTokens(-Infinity), null);
  assertTest('fmtTokens', 'null', fmtTokens(null), null);
  assertTest('fmtTokens', 'undefined', fmtTokens(undefined), null);
  assertTest('fmtTokens', 'String "5000"', fmtTokens('5000'), null);
}

// ─── maskToken ───────────────────────────────────────────────
console.log('\n--- Testing maskToken() ---');
{
  assertTest('maskToken', 'Long token (> 12 chars: ccsk-1234567890abcdef)', maskToken('ccsk-1234567890abcdef'), 'ccsk-…cdef');
  assertTest('maskToken', '13 chars token (1234567890abc)', maskToken('1234567890abc'), '12345…0abc');
  assertTest('maskToken', '12 chars token (123456789012)', maskToken('123456789012'), '12345…');
  assertTest('maskToken', 'Short token (<= 12 chars: ccsk-12345)', maskToken('ccsk-12345'), 'ccsk-…');
  assertTest('maskToken', 'null', maskToken(null), '—');
  assertTest('maskToken', 'undefined', maskToken(undefined), '—');
  assertTest('maskToken', 'empty string', maskToken(''), '—');
}

// ─── fmtReset ────────────────────────────────────────────────
console.log('\n--- Testing fmtReset() ---');
{
  const dateObj = new Date(2026, 0, 15, 8, 30, 0); // Jan 15 2026 08:30:00 local
  const iso = dateObj.toISOString();
  const res = fmtReset(iso);
  assertTest('fmtReset', 'Valid date formatting (contains 15, ม.ค., and time)', typeof res === 'string' && res.includes('15') && res.includes('ม.ค.'), true);
  assertTest('fmtReset', 'Invalid date string', fmtReset('invalid-date'), null);
  assertTest('fmtReset', 'null', fmtReset(null), null);
  assertTest('fmtReset', 'undefined', fmtReset(undefined), null);
  assertTest('fmtReset', 'empty string', fmtReset(''), null);
}

// ─── freeLine ────────────────────────────────────────────────
console.log('\n--- Testing freeLine() ---');
{
  // Disabled / null / invalid amount
  assertTest('freeLine', 'null free object', freeLine(null), null);
  assertTest('freeLine', 'Disabled free object', freeLine({ enabled: false, amount: 5 }), null);
  assertTest('freeLine', 'Missing amount', freeLine({ enabled: true }), null);
  assertTest('freeLine', 'Non-number amount', freeLine({ enabled: true, amount: '5' }), null);

  // Eligible pool
  const freeEligible = {
    enabled: true,
    amount: 5.0,
    eligible: true,
    remainingForKeyPool: 3.5,
    pools: ['fast', 'image'],
  };
  assertTest('freeLine', 'Eligible pool with remainingForKeyPool', freeLine(freeEligible), 'เครดิตฟรี เหลือ $3.50 · pool นี้ใช้ได้');

  const freeEligibleFallback = {
    enabled: true,
    amount: 5.0,
    eligible: true,
    remaining: 4.0,
    pools: ['fast'],
  };
  assertTest('freeLine', 'Eligible pool fallback to remaining', freeLine(freeEligibleFallback), 'เครดิตฟรี เหลือ $4.00 · pool นี้ใช้ได้');

  // Ineligible pool
  const freeIneligible = {
    enabled: true,
    amount: 5.0,
    eligible: false,
    pools: ['fast', 'image'],
  };
  assertTest('freeLine', 'Ineligible pool with pools list', freeLine(freeIneligible), 'เครดิตฟรี $5.00/วัน เฉพาะ pool fast, image — pool นี้ใช้ไม่ได้');

  const freeIneligibleNoPools = {
    enabled: true,
    amount: 10.0,
    eligible: false,
    pools: [],
  };
  assertTest('freeLine', 'Ineligible pool without pools list', freeLine(freeIneligibleNoPools), 'เครดิตฟรี $10.00/วัน — pool นี้ใช้ไม่ได้');
}

// ─── totalsOf ────────────────────────────────────────────────
console.log('\n--- Testing totalsOf() ---');
{
  assertTest('totalsOf', 'Object with totals property', totalsOf({ totals: { spend: 10 } }), { spend: 10 });
  assertTest('totalsOf', 'Direct totals object (no wrapper)', totalsOf({ spend: 10 }), { spend: 10 });
  assertTest('totalsOf', 'null input', totalsOf(null), {});
  assertTest('totalsOf', 'undefined input', totalsOf(undefined), {});
}

// ─── costOf ──────────────────────────────────────────────────
console.log('\n--- Testing costOf() ---');
{
  assertTest('costOf', 'total_cost_usd field', costOf({ total_cost_usd: 12.34 }), 12.34);
  assertTest('costOf', 'total_cost field fallback', costOf({ total_cost: 5.67 }), 5.67);
  assertTest('costOf', 'cost_usd field fallback', costOf({ cost_usd: 8.90 }), 8.90);
  assertTest('costOf', 'null input', costOf(null), null);
  assertTest('costOf', 'undefined input', costOf(undefined), null);
  assertTest('costOf', 'Non-number cost', costOf({ total_cost_usd: '12.34' }), null);
}

// ─── tokensOf ────────────────────────────────────────────────
console.log('\n--- Testing tokensOf() ---');
{
  const usageFull = {
    input_tokens: 100,
    output_tokens: 200,
    cache_read_tokens: 50,
  };
  assertTest('tokensOf', 'Standard token fields', tokensOf(usageFull), 350);

  const usageAliases = {
    prompt_tokens: 150,
    completion_tokens: 250,
    cache_creation_tokens: 25,
  };
  assertTest('tokensOf', 'Alias token fields', tokensOf(usageAliases), 425);

  const usageShort = {
    input: 10,
    output: 20,
    cache_tokens: 5,
  };
  assertTest('tokensOf', 'Short alias token fields', tokensOf(usageShort), 35);

  assertTest('tokensOf', 'Empty object', tokensOf({}), 0);
  assertTest('tokensOf', 'null input', tokensOf(null), 0);
  assertTest('tokensOf', 'undefined input', tokensOf(undefined), 0);
  assertTest('tokensOf', 'Non-numeric string values', tokensOf({ input_tokens: '100', output_tokens: '200' }), 0);
}

// ─── pickKey ─────────────────────────────────────────────────
console.log('\n--- Testing pickKey() ---');
{
  const apiMe = {
    key: {
      pool: 'claude-tier',
      limit_usd: 50.0,
      limit_used_usd: 12.5,
      limit_period: 'monthly',
      active: true,
    },
    daily_free_credit: {
      enabled: true,
      amount_usd: 5.0,
      used_usd: 1.0,
      reserved_usd: 0.5,
      remaining_usd: 3.5,
      pools: ['claude-tier'],
      reset_at: '2026-09-18T00:00:00Z',
      eligible_for_key_pool: true,
      remaining_for_key_pool_usd: 3.5,
    },
  };

  const parsed = pickKey(apiMe);
  assertTest('pickKey', 'Parsed pool', parsed.pool, 'claude-tier');
  assertTest('pickKey', 'Parsed limit', parsed.limit, 50.0);
  assertTest('pickKey', 'Parsed used', parsed.used, 12.5);
  assertTest('pickKey', 'Parsed period', parsed.period, 'monthly');
  assertTest('pickKey', 'Parsed active', parsed.active, true);
  assertTest('pickKey', 'Parsed free.enabled', parsed.free.enabled, true);
  assertTest('pickKey', 'Parsed free.amount', parsed.free.amount, 5.0);
  assertTest('pickKey', 'Parsed free.eligible', parsed.free.eligible, true);
  assertTest('pickKey', 'Parsed free.remainingForKeyPool', parsed.free.remainingForKeyPool, 3.5);

  // Fallback / missing data
  const parsedEmpty = pickKey(null);
  assertTest('pickKey', 'Null me fallback pool', parsedEmpty.pool, '—');
  assertTest('pickKey', 'Null me fallback limit', parsedEmpty.limit, null);
  assertTest('pickKey', 'Null me fallback free.enabled', parsedEmpty.free.enabled, false);
  assertTest('pickKey', 'Null me fallback free.pools', parsedEmpty.free.pools, []);
}

// ─── pickKeyList ─────────────────────────────────────────────
console.log('\n--- Testing pickKeyList() ---');
{
  const jsonWithDataKeys = { data: { keys: [{ id: 'k1' }, { id: 'k2' }, null, 'invalid'] } };
  assertTest('pickKeyList', 'JSON with data.keys filtering non-objects', pickKeyList(jsonWithDataKeys), [{ id: 'k1' }, { id: 'k2' }]);

  const jsonWithKeys = { keys: [{ id: 'k3' }] };
  assertTest('pickKeyList', 'JSON with top-level keys', pickKeyList(jsonWithKeys), [{ id: 'k3' }]);

  const jsonArray = [{ id: 'k4' }, { id: 'k5' }];
  assertTest('pickKeyList', 'Direct array JSON', pickKeyList(jsonArray), [{ id: 'k4' }, { id: 'k5' }]);

  assertTest('pickKeyList', 'null input', pickKeyList(null), []);
  assertTest('pickKeyList', 'undefined input', pickKeyList(undefined), []);
  assertTest('pickKeyList', 'Empty object', pickKeyList({}), []);
}

// ─── errKey & ERR_TH ─────────────────────────────────────────
console.log('\n--- Testing errKey() & ERR_TH ---');
{
  assertTest('errKey', 'String "no-token"', errKey('no-token'), 'no-token');
  assertTest('errKey', 'Error("no-token")', errKey(new Error('no-token')), 'no-token');
  assertTest('errKey', 'String "network"', errKey('network'), 'network');
  assertTest('errKey', 'Error("network")', errKey(new Error('network')), 'network');
  assertTest('errKey', 'String "http-401"', errKey('http-401'), 'http-401');
  assertTest('errKey', 'Error("http-401")', errKey(new Error('http-401')), 'http-401');
  assertTest('errKey', 'Error("http-402")', errKey(new Error('http-402')), 'http-402');
  assertTest('errKey', 'Error("http-403")', errKey(new Error('http-403')), 'http-403');
  assertTest('errKey', 'Error("http-404")', errKey(new Error('http-404')), 'http-404');
  assertTest('errKey', 'Error("http-409")', errKey(new Error('http-409')), 'http-409');
  assertTest('errKey', 'Error("http-429")', errKey(new Error('http-429')), 'http-429');
  assertTest('errKey', 'Error("http-500")', errKey(new Error('http-500')), 'http-500');
  assertTest('errKey', 'Error("http-503")', errKey(new Error('http-503')), 'http-503');
  assertTest('errKey', 'Error("http-504")', errKey(new Error('http-504')), 'http-504');
  assertTest('errKey', 'Unrecognized error string ("fetch failed")', errKey('fetch failed'), 'network');
  assertTest('errKey', 'Unrecognized Error object', errKey(new Error('something unknown')), 'network');
  assertTest('errKey', 'null', errKey(null), 'network');
  assertTest('errKey', 'undefined', errKey(undefined), 'network');

  // Verify ERR_TH mappings
  assertTest('ERR_TH', 'no-token Thai message', ERR_TH['no-token'], 'ยังไม่ได้ตั้ง token');
  assertTest('ERR_TH', 'network Thai message', ERR_TH['network'], 'ต่อ API ไม่ได้ (เน็ต/CORS)');
  assertTest('ERR_TH', 'http-401 Thai message', ERR_TH['http-401'], '401 token ผิด/หมดอายุ');
  assertTest('ERR_TH', 'http-402 Thai message', ERR_TH['http-402'], '402 เครดิตหมด — เติมที่ /dashboard/topup แล้วรอ ~30s');
  assertTest('ERR_TH', 'http-403 Thai message', ERR_TH['http-403'], '403 สิทธิ์ไม่พอ หรือ key ไม่ผูก pool');
  assertTest('ERR_TH', 'http-404 Thai message', ERR_TH['http-404'], '404 path ผิด');
  assertTest('ERR_TH', 'http-409 Thai message', ERR_TH['http-409'], '409 key ผิดประเภท (text/image)');
  assertTest('ERR_TH', 'http-429 Thai message', ERR_TH['http-429'], '429 ชน cap/concurrent');
  assertTest('ERR_TH', 'http-500 Thai message', ERR_TH['http-500'], '500 เซิร์ฟเวอร์มีปัญหา');
  assertTest('ERR_TH', 'http-503 Thai message', ERR_TH['http-503'], '503 pool ล่ม');
  assertTest('ERR_TH', 'http-504 Thai message', ERR_TH['http-504'], '504 timeout');
}

// ─── Summary ─────────────────────────────────────────────────

// ─── baseFor ─────────────────────────────────────────────────
console.log('\n--- Testing baseFor() ---');
{
  assertTest('baseFor', 'native pool', baseFor('native'), 'https://api.maxplus-ai.cc/v1');
  assertTest('baseFor', 'v1 pool', baseFor('v1'), 'https://api.maxplus-ai.cc/v1');
  assertTest('baseFor', 'auto pool', baseFor('auto'), 'https://api.maxplus-ai.cc/v1');
  assertTest('baseFor', 'null fallback', baseFor(null), 'https://api.maxplus-ai.cc/v1');
  assertTest('baseFor', 'empty string fallback', baseFor(''), 'https://api.maxplus-ai.cc/v1');
  assertTest('baseFor', 'nonono channel pool', baseFor('nonono'), 'https://api.maxplus-ai.cc/nonono/v1');
  assertTest('baseFor', 'chinese-specials pool', baseFor('chinese-specials'), 'https://api.maxplus-ai.cc/chinese-specials/v1');
  assertTest('baseFor', 'deepseek-officials pool', baseFor('deepseek-officials'), 'https://api.maxplus-ai.cc/deepseek-officials/v1');
}

// ─── isReasoningModel ────────────────────────────────────────
console.log('\n--- Testing isReasoningModel() ---');
{
  assertTest('isReasoningModel', 'deepseek-r1', isReasoningModel('deepseek-r1'), true);
  assertTest('isReasoningModel', 'deepseek-v4.1-flash', isReasoningModel('deepseek-v4.1-flash'), true);
  assertTest('isReasoningModel', 'claude-opus-4-6-thinking', isReasoningModel('claude-opus-4-6-thinking'), true);
  assertTest('isReasoningModel', 'o1-preview', isReasoningModel('o1-preview'), true);
  assertTest('isReasoningModel', 'o3-mini', isReasoningModel('o3-mini'), true);
  assertTest('isReasoningModel', 'claude-sonnet-4-6', isReasoningModel('claude-sonnet-4-6'), false);
  assertTest('isReasoningModel', 'swe-2', isReasoningModel('swe-2'), false);
  assertTest('isReasoningModel', 'null', isReasoningModel(null), false);
  assertTest('isReasoningModel', 'empty string', isReasoningModel(''), false);
}

// ─── classifyModelCategory ───────────────────────────────────
console.log('\n--- Testing classifyModelCategory() ---');
{
  assertTest('classifyModelCategory', 'deepseek-r1 reasoning', classifyModelCategory('deepseek-r1'), 'reasoning');
  assertTest('classifyModelCategory', 'deepseek-coder coding', classifyModelCategory('deepseek-coder-v2'), 'coding');
  assertTest('classifyModelCategory', 'swe-2 coding', classifyModelCategory('swe-2'), 'coding');
  assertTest('classifyModelCategory', 'qwen-vl vision', classifyModelCategory('qwen-vl-plus'), 'vision');
  assertTest('classifyModelCategory', 'gpt-4o-omni vision', classifyModelCategory('gpt-4o-omni'), 'vision');
  assertTest('classifyModelCategory', 'standard chat general', classifyModelCategory('meta-llama-3-8b-instruct'), 'general');
  assertTest('classifyModelCategory', 'null fallback general', classifyModelCategory(null), 'general');
}

// ─── buildProbePayload ───────────────────────────────────────
console.log('\n--- Testing buildProbePayload() ---');
{
  assertTest('buildProbePayload', 'Standard chat (8 tokens)', buildProbePayload('swe-2', false), {
    model: 'swe-2',
    messages: [{ role: 'user', content: 'ping' }],
    max_tokens: 8,
  });
  assertTest('buildProbePayload', 'Reasoning model (80 tokens)', buildProbePayload('deepseek-r1', true), {
    model: 'deepseek-r1',
    messages: [{ role: 'user', content: 'ping' }],
    max_tokens: 80,
  });
}

// ─── parseProbeResponse ──────────────────────────────────────
console.log('\n--- Testing parseProbeResponse() ---');
{
  assertTest('parseProbeResponse', 'HTTP 200 OK with checkpoint', parseProbeResponse(200, { model: 'deepseek-v4-flash-202605' }, 240.4), {
    status: 200,
    ok: true,
    latencyMs: 240,
    checkpoint: 'deepseek-v4-flash-202605',
    error: null,
  });
  assertTest('parseProbeResponse', 'HTTP 400 with string error', parseProbeResponse(400, { error: 'Model unavailable on selected channel' }, 85), {
    status: 400,
    ok: false,
    latencyMs: 85,
    checkpoint: null,
    error: 'Model unavailable on selected channel',
  });
  assertTest('parseProbeResponse', 'HTTP 403 with object error', parseProbeResponse(403, { error: { message: 'Key not bound to channel' } }, 95), {
    status: 403,
    ok: false,
    latencyMs: 95,
    checkpoint: null,
    error: 'Key not bound to channel',
  });
  assertTest('parseProbeResponse', 'HTTP 504 timeout', parseProbeResponse(504, null, 15000), {
    status: 504,
    ok: false,
    latencyMs: 15000,
    checkpoint: null,
    error: null,
  });
}

console.log('\n======================================================');
console.log(`  QA Test Suite Results: ${passedTests}/${totalTests} Passed (${Math.round((passedTests / totalTests) * 100)}%)`);
if (failedTests > 0) {
  console.log(`  FAILURES: ${failedTests}`);
  failures.forEach((f, i) => {
    console.log(`    ${i + 1}. [${f.fnName}] ${f.testDesc} (Expected: ${JSON.stringify(f.expected)}, Actual: ${JSON.stringify(f.actual)})`);
  });
  process.exit(1);
} else {
  console.log('  ALL TESTS PASSED WITH ZERO FAILURES! ✅');
  console.log('======================================================\n');
  process.exit(0);
}
