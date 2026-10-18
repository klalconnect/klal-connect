// Exercises translate.js against a stubbed Google Translate response: the
// cache hit/miss path, input validation, and the fully-disabled state when no
// key is configured (what production looks like until GOOGLE_TRANSLATE_API_KEY
// is set).
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const MOD_URL = pathToFileURL(path.join(import.meta.dirname, 'translate.js')).href;

let failures = 0;
const check = (label, cond, got) => {
  if (!cond) { failures++; console.log(`  FAIL ${label} -> ${JSON.stringify(got)}`); }
  else console.log(`  ok   ${label} -> ${JSON.stringify(got)}`);
};

process.env.KC_STORE = 'memory';

// ---- disabled without a key --------------------------------------------------
console.log('\nno key configured:');
delete process.env.GOOGLE_TRANSLATE_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
globalThis.fetch = async () => { throw new Error('must not call out with no key'); };
const disabled = await import(`${MOD_URL}?v=disabled`);
check('translateEnabled() is false', disabled.translateEnabled() === false);
try {
  await disabled.translate('hello', 'he');
  check('translate() throws with no key', false);
} catch (err) {
  check('translate() throws with no key', err.statusCode === 503, err.message);
}

// ---- enabled, happy path + cache --------------------------------------------
console.log('\nkey configured:');
process.env.GOOGLE_TRANSLATE_API_KEY = 'test-key';
let calls = 0;
globalThis.fetch = async (url, opts) => {
  calls++;
  const body = JSON.parse(opts.body);
  check('request targets the v2 REST endpoint', String(url).startsWith('https://translation.googleapis.com/language/translate/v2?key=test-key'), url);
  check('request omits source (auto-detect)', body.source === undefined, body);
  return {
    ok: true,
    status: 200,
    json: async () => ({ data: { translations: [{ translatedText: 'שלום', detectedSourceLanguage: 'en' }] } }),
  };
};
const live = await import(`${MOD_URL}?v=live`);
check('translateEnabled() is true', live.translateEnabled() === true);
const r1 = await live.translate('hello', 'he');
check('translated text', r1.text === 'שלום', r1);
check('detected source language', r1.detectedSourceLanguage === 'en', r1);
check('one upstream call so far', calls === 1, calls);

const r2 = await live.translate('hello', 'he');
check('second identical call is served from cache', calls === 1 && r2.text === 'שלום', calls);

// ---- validation --------------------------------------------------------------
console.log('\nvalidation:');
try { await live.translate('', 'he'); check('empty text rejected', false); }
catch (err) { check('empty text rejected', err.statusCode === 400, err.message); }

try { await live.translate('hi', 'klingon'); check('unsupported target rejected', false); }
catch (err) { check('unsupported target rejected', err.statusCode === 400, err.message); }

try { await live.translate('x'.repeat(3000), 'he'); check('overlong text rejected', false); }
catch (err) { check('overlong text rejected', err.statusCode === 400, err.message); }

// ---- upstream failure ---------------------------------------------------------
console.log('\nupstream failure:');
globalThis.fetch = async () => ({ ok: false, status: 403, json: async () => ({ error: { message: 'bad key' } }) });
const broken = await import(`${MOD_URL}?v=broken`);
try { await broken.translate('a new sentence nobody cached yet', 'he'); check('upstream error surfaces as 503', false); }
catch (err) { check('upstream error surfaces as 503', err.statusCode === 503, err.message); }

// ---- Claude engine (preferred when ANTHROPIC_API_KEY is set) ----------------
console.log('\nclaude key configured:');
process.env.ANTHROPIC_API_KEY = 'test-claude-key';
// The SDK keeps the fetch it was built with, so one stub serves both cases.
let claudeCalls = 0;
let claudeDown = false;
globalThis.fetch = async (url, opts) => {
  if (claudeDown) return new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'bad key' } }), { status: 401, headers: { 'content-type': 'application/json' } });
  claudeCalls++;
  const body = JSON.parse(opts.body);
  check('claude request goes to the messages endpoint', String(url).includes('/v1/messages'), String(url));
  check('claude request names the target language', body.messages[0].content.startsWith('Translate into English'), body.messages[0].content.slice(0, 40));
  return new Response(JSON.stringify({
    id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn',
    content: [{ type: 'text', text: 'Baruch Hashem, we made a simcha.' }],
    usage: { input_tokens: 10, output_tokens: 10 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
};
const viaClaude = await import(`${MOD_URL}?v=claude`);
check('engine is claude', viaClaude.translateEngine() === 'claude');
const c1 = await viaClaude.translate('ברוך השם, מיר האבן געמאכט א שמחה', 'en');
check('claude translation returned', c1.text === 'Baruch Hashem, we made a simcha.', c1);
await viaClaude.translate('ברוך השם, מיר האבן געמאכט א שמחה', 'en');
check('repeat served from cache', claudeCalls === 1, claudeCalls);

claudeDown = true;
try { await viaClaude.translate('something new', 'en'); check('claude error surfaces as 503', false); }
catch (err) { check('claude error surfaces as 503', err.statusCode === 503, err.message); }

console.log(failures ? `\n${failures} FAILURE(S)` : '\ntranslate.js behaves correctly with and without a key');
process.exit(failures ? 1 : 0);
