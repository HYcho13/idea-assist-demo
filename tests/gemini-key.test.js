import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { normalizeGeminiKey } from '../src/demo/gemini-key.js'
import { geminiVerifyKey, GEMINI_MODEL, GEMINI_MODEL_ENDPOINT, geminiError } from '../src/demo/gemini-ai.js'
import { validateCloudSettings } from '../src/demo/cloud-settings.js'
const mock='mock-key-for-metadata-tests-only'
const reply=(payload,status=200)=>({ok:status===200,status,json:async()=>payload})
test('Gemini keys reject copy wrappers, masked/incomplete text and whitespace without exposing values',()=>{
  assert.equal(normalizeGeminiKey(`\ufeff\u200b ${mock} \u200b`),mock)
  for(const value of [`"${mock}"`,`'${mock}'`,`GEMINI_API_KEY=${mock}`,`Bearer ${mock}`,'hidden****key','short...key','short…key','line\nbreak','inner space','한글', 'x'.repeat(8193)]) assert.throws(()=>normalizeGeminiKey(value),error=>!error.message.includes(mock))
})
test('long Gemini credentials are not silently truncated in storage validation or header transmission',async()=>{
  const long='mock-long-auth-key-'+ 'x'.repeat(1600)
  assert.equal(validateCloudSettings('gemini',long,true),long)
  let captured
  await geminiVerifyKey({apiKey:long,fetchImpl:async(url,options)=>{captured={url,...options};return reply({name:`models/${GEMINI_MODEL}`})}})
  assert.equal(captured.headers['x-goog-api-key'],long)
  assert.equal(captured.url,GEMINI_MODEL_ENDPOINT)
  assert.equal(captured.method,'GET'); assert.equal(captured.body,undefined)
  assert.ok(!captured.url.includes(long)); assert.equal(captured.cache,'no-store'); assert.equal(captured.redirect,'error')
})
test('metadata check distinguishes authentication from model generation and safely handles provider errors',async()=>{
  assert.match(await geminiVerifyKey({apiKey:mock,fetchImpl:async()=>reply({name:`models/${GEMINI_MODEL}`})}),/실제 생성.*별도/)
  assert.match(await geminiVerifyKey({apiKey:mock,fetchImpl:async()=>reply({name:'models/versioned-name',baseModelId:GEMINI_MODEL})}),/성공/)
  const payload={error:{status:'INVALID_ARGUMENT',message:`API key not valid. ${mock}`,details:[{reason:'API_KEY_INVALID'}]}}
  await assert.rejects(geminiVerifyKey({apiKey:mock,fetchImpl:async()=>reply(payload,400)}),error=>error.message.includes('API_KEY_INVALID')&&!error.message.includes(mock))
  assert.match(geminiError(400,payload),/유효하지/)
  assert.match(geminiError(400,{error:{message:'API key expired.'}}),/만료/)
  await assert.rejects(geminiVerifyKey({apiKey:mock,fetchImpl:async()=>reply({name:'models/wrong'})}),/모델 정보/)
  await assert.rejects(geminiVerifyKey({apiKey:mock,fetchImpl:async()=>{throw Error(mock)}}),error=>!error.message.includes(mock))
})
test('metadata check validates before sending, and cancellation aborts the request',async()=>{
  let calls=0
  await assert.rejects(geminiVerifyKey({apiKey:`"${mock}"`,fetchImpl:async()=>{calls++}}),/따옴표/); assert.equal(calls,0)
  const controller=new AbortController();controller.abort()
  await assert.rejects(geminiVerifyKey({apiKey:mock,signal:controller.signal,fetchImpl:async()=>{calls++}}),{name:'AbortError'}); assert.equal(calls,0)
  let signal
  await assert.rejects(geminiVerifyKey({apiKey:mock,timeoutMs:5,fetchImpl:async(_,options)=>{signal=options.signal;return {ok:true,json:()=>new Promise(()=>{})}}}),{name:'TimeoutError'})
  assert.equal(signal.aborted,true)
})
test('all screen and dialog headings share 32/41 bold typography including generated results',()=>{
  const css=readFileSync(new URL('../src/apple-ui.css',import.meta.url),'utf8')
  assert.match(css,/--title-size: 32px/)
  assert.match(css,/--title-leading: 41px/)
  assert.match(css,/--title-weight: 700/)
  assert.match(css,/\.app-body h2, \.app-body \.loading-page h2, \.app-body h2.idea-title, \.modal h2 \{[^}]*font-size: var\(--title-size\);[^}]*line-height: var\(--title-leading\);[^}]*font-weight: var\(--title-weight\)/)
  assert.doesNotMatch(css,/\.idea-title \{[^}]*30px|\.modal h2 \{[^}]*26px/)
  const native=readFileSync(new URL('../android/app/src/main/java/com/ideaassist/app/MainActivity.kt',import.meta.url),'utf8')
  assert.match(native,/private fun titleLabel\(title: String\) = label\(title, 32f, true\)/)
  assert.match(native,/typeface = Typeface.create\("sans-serif", Typeface.BOLD\)/)
  assert.match(native,/COMPLEX_UNIT_SP, 41f/)
  assert.match(native,/isFallbackLineSpacing = false; lineHeight = height/)
  assert.match(native,/body.addView\(titleLabel\(title\)/)
  for(const title of ['나만의 주제를 적어주세요','어떤 주제로 만들까요?','생각을 만드는 방식','개인 API 키 입력']) assert.ok(native.includes(`titleLabel("${title}")`))
})
