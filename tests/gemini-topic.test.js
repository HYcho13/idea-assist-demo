import test from 'node:test'
import assert from 'node:assert/strict'
import { geminiGenerate, geminiError, GEMINI_ENDPOINT, GEMINI_MODEL } from '../src/demo/gemini-ai.js'
import { drawWords, composeIdea, developIdea, elaborateIdea } from '../src/demo/domain.js'
import { validateTopic } from '../src/demo/topic.js'
import { schemaFor, sourceLabel } from '../src/demo/ai-contract.js'
import { freshLibrary, saveRecord, validateLibrary } from '../src/demo/storage.js'

const args={ type:'generate',categoryId:'custom',category:'독서 여행',topic:'독서 여행',words:['독서','지도','여행'],condition:'작게 시험하기' }
const output={ title:'독서 여행 지도',one_liner:'독서 감상을 지도에 담아 여행하듯 둘러보는 작은 경험입니다.',description:'독서 중 떠올린 장소를 지도에 표시하고 짧은 감상을 저장합니다. 여행 경로를 따라 기록을 다시 둘러보며 읽은 책을 떠올립니다.',steps:['독서 기록에 필요한 장소와 감상 입력 항목 정하기','지도 위에 기록 카드 세 개를 배치한 화면 그리기','여행처럼 기록을 둘러보며 원하는 책을 찾는지 확인하기'],word_links:{material:'독서 감상을 기록의 중심 소재로 사용합니다.',method:'지도 위에 기록의 장소와 감상을 표시합니다.',mood:'여행하듯 둘러보는 편안한 경험을 제공합니다.'} }
const payload=(value=output,finishReason='STOP')=>({candidates:[{finishReason,content:{parts:[{text:JSON.stringify(value)}]}}]})
const reply=(value,status=200)=>({ok:status===200,status,json:async()=>value})
const key='mock-google-key-not-a-real-credential'
test('Gemini uses fixed Google endpoint, header key, JSON schema and true provenance',async()=>{
  let captured
  const result=await geminiGenerate(args,{apiKey:key,fetchImpl:async(url,options)=>{captured={url,...options};return reply(payload())}})
  assert.equal(captured.url,GEMINI_ENDPOINT); assert.equal(captured.headers['x-goog-api-key'],key)
  assert.ok(!captured.url.includes(key) && !captured.body.includes(key)); assert.ok(!captured.headers.Authorization)
  const body=JSON.parse(captured.body)
  assert.equal(body.generationConfig.responseFormat.text.mimeType,'APPLICATION_JSON')
  assert.equal(captured.headers['Content-Type'],'application/json')
  assert.deepEqual(body.generationConfig.responseFormat.text.schema,schemaFor('generate'))
  assert.match(body.contents[0].parts[0].text,/독서 여행/)
  assert.equal(result.source,'gemini'); assert.equal(result.model,GEMINI_MODEL); assert.equal(result.topic,args.topic)
  assert.match(sourceLabel(result.source),/Google Gemini/)
  const restored=validateLibrary(saveRecord(freshLibrary(),result,{name:result.title,folderId:'default'}))
  assert.equal(restored.ideas[0].topic,args.topic); assert.equal(restored.ideas[0].source,'gemini'); assert.ok(!JSON.stringify(restored).includes(key))
})
test('Gemini development and elaboration preserve input context and validate task-specific responses',async()=>{
  const current={...output,id:'existing',revision:2,used_words:args.words,topic:args.topic}
  const changed={...output,description:'독서 여행 지도를 함께 만드는 작은 모임입니다. 지도에 한 권의 장소만 표시하고 여행처럼 기록을 교환합니다.',steps:['독서 장소 한 개만 골라 두 사람에게 감상을 묻기',...output.steps.slice(1)]}
  const value=await geminiGenerate({...args,type:'develop',current,direction:'더 현실적으로',directionId:'realistic'},{apiKey:key,fetchImpl:async()=>reply(payload(changed))})
  assert.equal(value.id,current.id); assert.equal(value.revision,3); assert.equal(value.source,'gemini')
  const detail=elaborateIdea({...current,categoryId:'custom'})
  let body
  assert.deepEqual(await geminiGenerate({...args,type:'elaborate',current},{apiKey:key,fetchImpl:async(_,opts)=>{body=JSON.parse(opts.body);return reply(payload(detail))}}),detail)
  assert.deepEqual(body.generationConfig.responseFormat.text.schema,schemaFor('elaborate'))
  assert.equal(body.generationConfig.responseFormat.text.mimeType,'APPLICATION_JSON')
})
test('Gemini error classification distinguishes request, credentials, restrictions and quota without leaking provider data',async()=>{
  const failure=(status,reason,message=key)=>({error:{status,message,details:[{reason}]}})
  const cases=[
    [400,failure('INVALID_ARGUMENT',''),/요청 형식/],
    [400,failure('INVALID_ARGUMENT','API_KEY_INVALID'),/유효하지/],
    [400,failure('INVALID_ARGUMENT','','API key expired. '+key),/만료/],
    [403,failure('PERMISSION_DENIED','','Your API key was reported as leaked. '+key),/노출된 키/],
    [403,failure('PERMISSION_DENIED','SERVICE_DISABLED'),/비활성화/],
    [403,failure('PERMISSION_DENIED','API_KEY_HTTP_REFERRER_BLOCKED'),/사용 제한/],
    [400,failure('FAILED_PRECONDITION',''),/사용 조건/],
    [401,failure('UNAUTHENTICATED',''),/인증/],
    [403,failure('PERMISSION_DENIED',''),/접근이 거부/],
    [429,failure('RESOURCE_EXHAUSTED',''),/한도/],
  ]
  for(const [status,body,expected] of cases){
    assert.match(geminiError(status,body),expected)
    await assert.rejects(geminiGenerate(args,{apiKey:key,fetchImpl:async()=>reply(body,status)}),error=>expected.test(error.message)&&!error.message.includes(key))
  }
  for(const status of [400,403,500]) await assert.rejects(geminiGenerate(args,{apiKey:key,fetchImpl:async()=>({ok:false,status,json:async()=>{throw Error(key)}})}),error=>/Google Gemini/.test(error.message)&&!error.message.includes(key))
})
test('Gemini missing key, malformed/refused/truncated response and HTTP errors never silently use rules or expose keys',async()=>{
  let calls=0
  await assert.rejects(geminiGenerate(args,{fetchImpl:async()=>{calls++}}),/API 키/); assert.equal(calls,0)
  for(const value of [payload(output,'MAX_TOKENS'),payload(output,'SAFETY'),{promptFeedback:{blockReason:'SAFETY'}},{candidates:[]},payload({}),{candidates:[{finishReason:'STOP',content:{parts:[{text:'{'}]}}]}]) await assert.rejects(geminiGenerate(args,{apiKey:key,fetchImpl:async()=>reply(value)}))
  for(const status of [400,401,403,404,429,500]) await assert.rejects(geminiGenerate(args,{apiKey:key,fetchImpl:async()=>reply({error:{message:key}},status)}),e=>!e.message.includes(key)&&/Google Gemini/.test(e.message))
  await assert.rejects(geminiGenerate(args,{apiKey:key,fetchImpl:async()=>{throw Error(key)}}),e=>/CORS/.test(e.message)&&!e.message.includes(key))
})
test('Gemini cancellation and body-read timeout reject and abort the actual request',async()=>{
  const abort=new AbortController(); abort.abort(); let calls=0
  await assert.rejects(geminiGenerate(args,{apiKey:key,signal:abort.signal,fetchImpl:async()=>{calls++}}),{name:'AbortError'}); assert.equal(calls,0)
  let signal
  await assert.rejects(geminiGenerate(args,{apiKey:key,timeoutMs:5,fetchImpl:async(_,opts)=>{signal=opts.signal;return {ok:true,json:()=>new Promise(()=>{})}}}),{name:'TimeoutError'}); assert.equal(signal.aborted,true)
})
test('direct topics validate, reroll/lock, develop, elaborate and round-trip without pretending domain-specific word generation',()=>{
  assert.equal(validateTopic('  반려동물  여행 '),'반려동물 여행')
  for(const value of ['', '  ', '가'.repeat(81)]) assert.throws(()=>validateTopic(value))
  const first=drawWords('custom'),next=drawWords('custom',{current:first.words,locked:[0,1]})
  assert.deepEqual(next.words.slice(0,2),first.words.slice(0,2)); assert.notEqual(next.words[2],first.words[2])
  const topic='반려동물 여행'; const idea=composeIdea({categoryId:'custom',topic,words:first.words,condition:first.condition})
  assert.match(idea.description,/반려동물 여행/)
  const developed=developIdea(idea,'realistic'); const detail=elaborateIdea(developed)
  assert.match(detail.target_user,/반려동물 여행/)
  const library=saveRecord(freshLibrary(),{...developed,elaboration:detail},{name:'주제 검사',folderId:'default'})
  assert.equal(validateLibrary(JSON.parse(JSON.stringify(library))).ideas[0].topic,topic)
  assert.throws(()=>validateLibrary({...library,ideas:[{...library.ideas[0],topic:''}]}))
})
