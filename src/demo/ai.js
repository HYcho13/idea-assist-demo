import { validateIdea, uid } from './domain.js'
export const MODEL_ID = 'Qwen2.5-0.5B-Instruct-q4f32_1-MLC'
let worker = null
let engine = null
let pending = false

export async function checkGPU() {
  if (!navigator.gpu) return false
  try { return Boolean(await navigator.gpu.requestAdapter()) } catch { return false }
}
export async function loadModel(onProgress) {
  if (engine) return engine
  if (pending) throw new Error('모델을 준비 중이에요.')
  if (!await checkGPU()) throw new Error('이 브라우저에서 WebGPU를 사용할 수 없어요. 최신 Chrome 또는 Edge와 GPU 지원이 필요합니다. 간편 시연은 바로 사용할 수 있어요.')
  pending = true
  try {
    const { CreateWebWorkerMLCEngine } = await import('@mlc-ai/web-llm')
    worker = new Worker(new URL('./ai-worker.js', import.meta.url), { type: 'module' })
    engine = await CreateWebWorkerMLCEngine(worker, MODEL_ID, { initProgressCallback: onProgress }, { context_window_size: 4096 })
    return engine
  } catch (error) {
    worker?.terminate()
    worker = null
    engine = null
    if (/fetch|network|download/i.test(error.message)) throw new Error('AI 모델 파일을 내려받지 못했어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.')
    throw error
  } finally { pending = false }
}
export function stopModel() {
  engine?.interruptGenerate()
  worker?.terminate()
  engine = null
  worker = null
  pending = false
}

const textField = { type: 'string' }
const threeTexts = { type: 'array', items: textField, minItems: 3, maxItems: 3 }
const ideaSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    title: textField, one_liner: textField, description: textField, steps: threeTexts,
    word_links: { type: 'object', additionalProperties: false, properties: { material: textField, method: textField, mood: textField }, required: ['material', 'method', 'mood'] },
  },
  required: ['title', 'one_liner', 'description', 'steps', 'word_links'],
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
const detailSchema = {
  type: 'object', additionalProperties: false,
  properties: { target_user: textField, problem: textField, value: textField, core_features: threeTexts, first_prototype: textField, risks: { type: 'array', items: textField, minItems: 1, maxItems: 3 } },
  required: ['target_user', 'problem', 'value', 'core_features', 'first_prototype', 'risks'],
}

export async function modelGenerate({ categoryId, category, words, condition, current, direction, directionId, type = 'generate' }) {
  if (!engine) throw new Error('먼저 AI 모델을 준비해 주세요.')
  const system = '너는 발상을 돕는 한국어 아이디어 코치다. 모든 내용은 한국어로 간결하게 작성한다. 각 필드는 짧은 한 문장만 작성한다. 소재, 방식, 분위기를 하나의 제품이나 서비스로 연결한다. 확인하지 않은 시장 통계나 성공 가능성을 만들지 않는다. JSON 형식만 출력한다.'
  const task = type === 'develop' ? '현재 아이디어의 핵심을 유지하고 지정 방향으로 실제 내용을 바꿔라. 설명에서 달라진 방식을 구체적으로 써라.' : type === 'elaborate' ? '현재 아이디어를 타깃, 문제, 가치, 핵심 기능 3개, 첫 실험, 위험으로 구체화하라.' : '입력 단어 3개를 모두 사용하는 새로운 아이디어 한 개를 만들어라. 설명 2문장과 실행 단계 3개를 작성하라.'
  const input = { category, material: words[0], method: words[1], mood: words[2], condition, ...(current ? { current_idea: { title: current.title, description: current.description, steps: current.steps } } : {}), ...(direction ? { direction } : {}) }
  let timer
  try {
    timer = setTimeout(() => engine?.interruptGenerate(), 90000)
    const example = examples[categoryId]
    const response = await engine.chat.completions.create({
      messages: [
        { role: 'system', content: system },
        ...(type !== 'elaborate' ? [{ role: 'user', content: `다음 입력을 실제 서비스 아이디어로 연결해라.\n${JSON.stringify(example.input)}` }, { role: 'assistant', content: JSON.stringify(example.output) }] : []),
        { role: 'user', content: `${task}\n${JSON.stringify(input)}\n${type !== 'elaborate' ? '앞의 예시를 복사하지 말고 이번 입력의 소재, 방식, 분위기를 연결하라. 한 줄 설명은 누구나 이해할 문장으로, description은 실제 사용하는 장면을 작성하라. 실행 단계는 각각 수행할 수 있는 작업이다. word_links는 단어를 반복하지 말고 아이디어에 활용한 방법을 문장으로 적어라.' : ''}` },
      ],
      temperature: 0.5, max_tokens: 1100,
      response_format: { type: 'json_object', schema: JSON.stringify(type === 'elaborate' ? detailSchema : ideaSchema) },
    })
    if (response.choices?.[0]?.finish_reason !== 'stop') throw new Error('AI 응답이 끝까지 완성되지 않았어요. 다시 시도해 주세요.')
    let output
    try { output = JSON.parse(response.choices[0].message.content) } catch { throw new Error('AI 응답 형식을 읽지 못했어요. 다시 시도해 주세요.') }
    if (type === 'elaborate') {
      if (['target_user', 'problem', 'value', 'first_prototype'].some(k => typeof output[k] !== 'string' || !output[k].trim()) || !Array.isArray(output.core_features) || output.core_features.length !== 3 || output.core_features.some(x => typeof x !== 'string' || !x.trim()) || !Array.isArray(output.risks) || output.risks.some(x => typeof x !== 'string')) throw new Error('구체화 내용을 만들지 못했어요. 다시 시도해 주세요.')
      return output
    }
    if (!output.word_links || ['material', 'method', 'mood'].some(k => typeof output.word_links[k] !== 'string' || !output.word_links[k].trim())) throw new Error('AI가 단어의 연결 방식을 작성하지 못했어요. 다시 시도해 주세요.')
    if (output.one_liner.length < 12 || output.description.length < 30 || output.steps.some(s => s.length < 8) || ['material', 'method', 'mood'].some(k => output.word_links[k].length < 8)) throw new Error('AI 결과가 너무 짧아 아이디어를 설명하지 못했어요. 다시 생성하거나 간편 시연을 사용해 주세요.')
    if (new Set(output.steps.map(s => s.trim())).size !== 3) throw new Error('AI가 실행 단계를 반복해서 작성했어요. 다시 생성하거나 간편 시연을 사용해 주세요.')
    const links = `${words[0]}: ${output.word_links.material}\n${words[1]}: ${output.word_links.method}\n${words[2]}: ${output.word_links.mood}`
    return validateIdea({ ...output, description: `${output.description}\n\n세 단어의 연결\n${links}`, used_words: [...words], id: current?.id || uid(), categoryId, category, condition, source: 'webllm', model: MODEL_ID, revision: current ? (current.revision || 1) + 1 : 1, ...(direction ? { direction: directionId, what_changed: `${direction} 방향으로 다시 생성한 버전입니다.` } : {}) }, words)
  } finally { clearTimeout(timer) }
}
