import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readConsent, saveConsent, readCloudProvider, saveCloudProvider, validateCloudSettings, CONSENT_VERSION } from '../src/demo/cloud-settings.js'
const memory=()=>{const values=new Map();return {values,getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)}}
test('saved provider survives reload without persisting a key or applying consent to another provider',()=>{
  const storage=memory(); assert.equal(readCloudProvider(storage),'openai')
  saveConsent('gemini',true,storage); saveCloudProvider('gemini',storage)
  assert.equal(readCloudProvider(storage),'gemini'); assert.equal(readConsent('openai',storage),false)
  assert.throws(()=>saveCloudProvider('invalid',storage))
  assert.ok([...storage.values.values()].every(value=>['gemini','accepted'].includes(value)))
})
test('saved cost consent survives reopening and is isolated by provider and notice version',()=>{
  const storage=memory()
  assert.equal(readConsent('openai',storage),false)
  saveConsent('openai',true,storage)
  assert.equal(readConsent('openai',storage),true); assert.equal(readConsent('gemini',storage),false)
  const reopened={getItem:k=>storage.values.get(k)}
  assert.equal(readConsent('openai',reopened),true)
  assert.equal(readConsent('not-a-provider',storage),false)
  assert.equal([...storage.values.keys()][0],`idea-assist-cloud-consent-v${CONSENT_VERSION}-openai`)
  assert.deepEqual([...storage.values.values()],['accepted'])
})
test('key and explicit consent are required; rejected or unsaved edits never create consent',()=>{
  const storage=memory()
  for(const [provider,key,consent] of [['openai','',true],['openai','mock',false],['invalid','mock',true],['gemini','line\nbreak',true],['gemini','x'.repeat(513),true]]) assert.throws(()=>validateCloudSettings(provider,key,consent))
  assert.throws(()=>saveConsent('openai',false,storage)); assert.equal(storage.values.size,0)
  const mock='mock-key-for-settings-tests-only'
  assert.equal(validateCloudSettings('gemini',` ${mock} `,true),mock)
  saveConsent('gemini',true,storage)
  assert.ok(!JSON.stringify([...storage.values]).includes(mock))
})
test('blocked consent persistence fails visibly instead of pretending settings were saved',()=>{
  const blocked={getItem:()=>{throw Error('blocked')},setItem:()=>{throw Error('blocked')}}
  assert.equal(readConsent('gemini',blocked),false)
  assert.throws(()=>saveConsent('gemini',true,blocked),/저장하지 못/)
})
test('engine selection and key form are separate, stage edits, and never call a model on save',()=>{
  const source=readFileSync(new URL('../src/EngineSettings.jsx',import.meta.url),'utf8')
  assert.match(source,/page === 'credentials'/)
  const overview=source.slice(source.indexOf('return <section className="engine-overview"'))
  assert.doesNotMatch(overview,/type="password"|type="checkbox"/)
  assert.match(source,/setDraftKey\(apiKey\)/); assert.match(source,/setConsent\(readConsent\(provider\)\)/)
  assert.match(source,/setConsent\(readConsent\(value\)\)/)
  const save=source.slice(source.indexOf('function save()'),source.indexOf("if (page === 'credentials')"))
  assert.doesNotMatch(save,/fetch|cloudGenerate|geminiGenerate/)
  assert.match(save,/validateCloudSettings/); assert.match(save,/saveConsent/); assert.match(save,/setMode\('cloud'\)/)
})
