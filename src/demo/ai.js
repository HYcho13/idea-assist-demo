import { buildMessages, schemaFor, parseOutput, makeResult, withCancellation } from './ai-contract.js'
// Official @mlc-ai/web-llm 0.2.85 preset; estimated VRAM 1888.97 MB.
export const MODEL_ID = 'Qwen2.5-1.5B-Instruct-q4f32_1-MLC'
let worker = null
let engine = null
let pending = false
let lifecycle = 0

export async function checkGPU() {
  if (!globalThis.navigator?.gpu) return false
  try { return Boolean(await globalThis.navigator.gpu.requestAdapter()) } catch { return false }
}
export async function loadModel(onProgress) {
  if (engine) return engine
  if (pending) throw new Error('모델을 준비 중이에요.')
  pending = true
  const token = ++lifecycle
  let loadingWorker
  const checkCancelled = () => {
    if (token !== lifecycle) { const error = new Error('AI 모델 준비를 취소했어요.'); error.name = 'AbortError'; throw error }
  }
  try {
    if (!await checkGPU()) throw new Error('이 브라우저에서 WebGPU를 사용할 수 없어요. 최신 Chrome 또는 Edge와 GPU 지원이 필요합니다. 간편 시연은 바로 사용할 수 있어요.')
    checkCancelled()
    const { CreateWebWorkerMLCEngine } = await import('@mlc-ai/web-llm')
    checkCancelled()
    loadingWorker = new Worker(new URL('./ai-worker.js', import.meta.url), { type: 'module' })
    worker = loadingWorker
    const loaded = await CreateWebWorkerMLCEngine(loadingWorker, MODEL_ID, { initProgressCallback: progress => { if (token === lifecycle) onProgress?.(progress) } }, { context_window_size: 4096 })
    checkCancelled()
    engine = loaded
    return engine
  } catch (error) {
    loadingWorker?.terminate()
    if (token === lifecycle) { worker = null; engine = null }
    if (/fetch|network|download/i.test(error.message)) throw new Error('AI 모델 파일을 내려받지 못했어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.')
    throw error
  } finally { if (token === lifecycle) pending = false }
}
export function stopModel() {
  lifecycle++
  try { engine?.interruptGenerate() } catch { /* Worker may already be gone. */ }
  worker?.terminate()
  engine = null
  worker = null
  pending = false
}

const examples = {
  food: {
    input: { category: '음식 개발', material: '딸기', method: '자전거', mood: '구름', condition: '작게 시험하기' },
    output: { title: '구름 한입 딸기 카트', one_liner: '자전거 카트에서 구름 모양 딸기 디저트를 파는 작은 서비스', description: '딸기와 요거트를 구름 모양 컵에 담아 제공합니다. 자전거 카트를 이용해 동네 공원을 이동하며 시식 메뉴 하나로 시작합니다.', steps: ['딸기 요거트 메뉴 한 가지를 만들어 시식하기', '자전거 카트에서 제공할 주문과 전달 동선 그리기', '구름 모양 포장 견본을 만들어 세 명에게 의견 묻기'], word_links: { material: '딸기를 디저트의 핵심 재료로 사용합니다.', method: '자전거 카트로 판매 장소를 옮깁니다.', mood: '구름 모양 컵과 가벼운 질감으로 분위기를 만듭니다.' } },
  },
  program: {
    input: { category: '프로그램 개발', material: '독서', method: '지도', mood: '여행', condition: '작게 시험하기' },
    output: { title: '독서 여행 지도', one_liner: '읽은 책의 장소와 감상을 지도 위에 저장하는 기록 앱', description: '사용자는 독서 중 떠올린 장소를 지도에 표시하고 짧은 감상을 저장합니다. 여행 경로처럼 기록을 다시 둘러보며 읽은 책을 떠올립니다.', steps: ['독서 기록에 필요한 장소와 감상 입력 항목 정하기', '지도 위에 기록 카드 세 개를 배치한 화면 그리기', '여행처럼 기록을 둘러보며 원하는 책을 찾는지 확인하기'], word_links: { material: '독서 후 남긴 감상을 기록 소재로 사용합니다.', method: '지도 위에 책의 장소와 감상을 표시합니다.', mood: '여행하듯 기록을 둘러보는 화면을 제공합니다.' } },
  },
  contest: {
    input: { category: '공모전 주제', material: '고립', method: '공원', mood: '편지', condition: '작게 시험하기' },
    output: { title: '공원의 안부 편지', one_liner: '고립감을 느끼는 이웃이 공원에서 짧은 안부를 교환하는 활동', description: '공원에 짧은 안부 편지를 적는 작은 공간을 제안합니다. 고립감을 느끼는 참여자가 부담 없이 메시지를 읽고 답할 수 있는지 먼저 인터뷰로 확인합니다.', steps: ['고립감을 경험한 이웃에게 참여 의향을 질문하기', '공원 활동 안내와 익명 메시지 카드를 종이로 만들기', '편지를 주고받는 작은 활동 후 편안했는지 질문하기'], word_links: { material: '고립 문제 중 가벼운 안부 교환에 대한 필요를 살펴봅니다.', method: '공원을 참여 활동의 장소로 활용합니다.', mood: '편지처럼 짧고 따뜻한 메시지로 참여를 돕습니다.' } },
  },
}

export async function modelGenerate(args, options = {}) {
  if (!engine) throw new Error('먼저 AI 모델을 준비해 주세요.')
  return generateOnDevice(args, engine, options)
}

export async function generateOnDevice(args, activeEngine, options = {}) {
  const messages = buildMessages(args, examples[args.categoryId])
  return withCancellation(async () => {
    const response = await activeEngine.chat.completions.create({
      messages, temperature: 0.5, max_tokens: 1400,
      response_format: { type: 'json_object', schema: JSON.stringify(schemaFor(args.type)) },
    })
    if (response.choices?.[0]?.message?.refusal) throw new Error('온디바이스 AI가 요청을 거절했어요. 입력을 바꾸어 주세요.')
    if (response.choices?.[0]?.finish_reason !== 'stop') throw new Error('AI 응답이 끝까지 완성되지 않았어요. 다시 시도해 주세요.')
    return makeResult(parseOutput(response.choices[0].message.content, args.type, args.current || args.previous), args, 'webllm', MODEL_ID)
  }, { ...options, onAbort: () => activeEngine.interruptGenerate() })
}
