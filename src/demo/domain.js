import { categories, wordPools, conditions, directions } from './data.js'

export const uid = () => globalThis.crypto?.randomUUID?.() || `idea-${Date.now()}-${Math.random().toString(36).slice(2)}`
export const normalize = value => value.normalize('NFKC').trim().replace(/\s+/g, ' ')
export function particle(value, pair) {
  const code = value.charCodeAt(value.length - 1) - 0xac00
  const hasFinal = code >= 0 && code <= 11171 && code % 28 !== 0
  const [withFinal, withoutFinal] = pair.split('/')
  if (pair === '으로/로' && code >= 0 && code % 28 === 8) return `${value}로`
  return `${value}${hasFinal ? withFinal : withoutFinal}`
}
const pick = (values, random) => values[Math.min(values.length - 1, Math.floor(random() * values.length))]

export function drawWords(categoryId, { current = [], locked = [], custom = [], random = Math.random } = {}) {
  const pools = categoryId === 'custom' ? [0, 1, 2].map(i => [...new Set(Object.values(wordPools).flatMap(p => p[i]))]) : wordPools[categoryId]
  if (!pools) throw new Error('사용할 수 없는 카테고리예요.')
  if (locked.length > 2 || custom.length > 2) throw new Error('고정 단어는 최대 2개예요.')
  if (locked.some(i => !Number.isInteger(i) || i < 0 || i > 2 || !current[i])) throw new Error('고정 단어를 다시 확인해 주세요.')
  const cleanCustom = custom.map(normalize)
  if (cleanCustom.some(w => !w || w.length > 12) || new Set(cleanCustom).size !== cleanCustom.length) throw new Error('내 단어는 12자 이하의 서로 다른 단어여야 해요.')
  const result = Array(3).fill(null)
  locked.forEach(i => { result[i] = current[i] })
  cleanCustom.forEach((word, i) => { result[i] = word })
  const used = new Set(result.filter(Boolean))
  for (let i = 0; i < 3; i++) {
    if (result[i]) continue
    const candidates = pools[i].filter(w => !used.has(w) && !current.includes(w))
    const available = candidates.length ? candidates : pools[i].filter(w => !used.has(w))
    if (!available.length) throw new Error('단어가 부족해요. 다른 조합을 골라 주세요.')
    result[i] = pick(available, random)
    used.add(result[i])
  }
  if (new Set(result).size !== 3) throw new Error('서로 다른 단어 3개를 골라 주세요.')
  return { words: result, condition: pick(conditions, random) }
}

export function validateIdea(value, words) {
  if (!value || ['title', 'one_liner', 'description'].some(key => typeof value[key] !== 'string' || !value[key].trim() || value[key].length > 2000)) throw new Error('결과 내용을 충분히 만들지 못했어요. 다시 시도해 주세요.')
  if (!Array.isArray(value.steps) || value.steps.length !== 3 || value.steps.some(v => typeof v !== 'string' || !v.trim() || v.length > 1000)) throw new Error('실행 단계 3개를 만들지 못했어요. 다시 시도해 주세요.')
  if (!Array.isArray(value.used_words) || value.used_words.length !== 3 || !words.every(w => value.used_words.includes(w))) throw new Error('결과에 세 단어를 모두 연결하지 못했어요. 다시 시도해 주세요.')
  const combined = `${value.title} ${value.one_liner} ${value.description} ${value.steps.join(' ')}`
  if (!words.every(w => combined.includes(w))) throw new Error('단어를 설명에 연결하지 못했어요. 다시 시도하거나 다른 조합을 골라 주세요.')
  return value
}

// This is a rule-based demonstration engine, explicitly labelled in the UI.
// Actual neural generation lives in ai.js; a failed AI call never silently uses these templates.
export function composeIdea({ categoryId, words, condition, variant = 0, topic = '' }) {
  if (words.length !== 3 || new Set(words).size !== 3) throw new Error('서로 다른 단어 3개가 필요해요.')
  const [a, b, c] = words
  const category = categoryId === 'custom' && topic.trim() ? { name: topic } : categories.find(x => x.id === categoryId)
  if (!category) throw new Error('카테고리를 선택해 주세요.')
  const templates = {
    custom: [0, 1, 2].map(i => ({ title: `${a} ${['연결', '실험', '발견'][i]}`, one_liner: `${topic} 주제에 ${a}, ${b}, ${c}를 연결하는 시연용 제안입니다.`, description: `${topic} 분야에서 ${a}를 소재로 작은 사용자 경험을 만듭니다. ${b}를 전달 방식으로, ${c}를 분위기로 연결합니다. 주제 적합성은 AI가 판단한 것이 아니며 직접 확인해야 합니다.`, steps: [`${topic}에서 ${a}와 연결할 필요를 사용자에게 질문하기`, `${b} 방식의 간단한 견본을 종이로 만들기`, `${c} 분위기의 안내를 적용하고 주제와 맞는지 의견 듣기`] })),
    food: [
      { title: `${a} 한입 여행`, one_liner: `${a} 메뉴를 ${b} 방식으로 즐기는 ${c} 콘셉트의 작은 음식 서비스`, description: `주재료는 ${a}, 제공 방식의 모티프는 ${b}, 공간과 포장의 분위기는 ${c}입니다. 메뉴 하나로 시작하고, 고객이 맛과 제공 경험을 함께 평가하게 합니다.`, steps: [`${a} 중심의 시식 메뉴 한 가지 만들기`, `${b} 모티프로 제공 동선과 포장 견본 만들기`, `${c} 콘셉트로 시식 카드 제작 후 3명에게 의견 듣기`] },
      { title: `${c}의 ${a} 실험실`, one_liner: `${b}에서 착안한 체험으로 직접 완성하는 ${a} 메뉴`, description: `${a} 중심의 작은 음식 키트를 만듭니다. ${b}의 특징을 체험 방식에 옮기고, ${particle(c, '을/를')} 테마로 고명과 포장을 바꿀 수 있게 합니다. 완성 메뉴와 체험 난이도를 함께 살펴봅니다.`, steps: [`${particle(a, '으로/로')} 만들 수 있는 간단한 키트 구성하기`, `${b}에서 떠올린 조립 순서와 안내 카드 만들기`, `${c} 테마로 2가지 견본을 만들어 체험 시간 비교하기`] },
      { title: `${b} 맛 편지`, one_liner: `${particle(a, '과/와')} ${particle(c, '을/를')} 연결하는 소규모 테마 메뉴 예약 서비스`, description: `${particle(a, '을/를')} 중심으로 한 메뉴를 예약받고, ${b}에서 착안한 전달 방식과 ${c}의 분위기를 담은 이야기를 함께 제공합니다. 처음에는 하루 한 번, 메뉴 하나만 예약받아 운영 부담을 확인합니다.`, steps: [`${a} 메뉴의 1인분 견본과 가격 가정 적기`, `${b} 모티프의 주문·전달 흐름을 종이에 그리기`, `${c} 콘셉트의 예약 카드로 지인 3명에게 사용성 묻기`] },
    ],
    program: [
      { title: `${a} 작은 지도`, one_liner: `${particle(a, '을/를')} ${b} 방식으로 기록하는 ${c} 테마의 앱`, description: `${particle(a, '과/와')} 관련된 기록을 짧게 입력하고 ${b}에서 착안한 화면으로 다시 찾는 앱입니다. ${particle(c, '을/를')} 화면의 시각적 모티프로 사용합니다. 첫 버전은 입력, 목록, 상세의 세 화면에 집중합니다.`, steps: [`${particle(a, '을/를')} 기록할 입력 항목 3개 정하기`, `${b} 방식의 기록 조회 화면을 종이에 그리기`, `${c} 스타일의 화면 3개를 연결해 사용해 보기`] },
      { title: `${c} ${a} 챌린지`, one_liner: `${b}를 활용해 ${a}를 실천하고 결과를 돌아보는 도구`, description: `사용자가 ${a} 관련 작은 목표 하나를 세우고 ${b}의 특징을 빌린 피드백을 받습니다. ${c} 분위기의 결과 카드를 만들되, 처음에는 혼자 사용하는 목표·체크·회고 기능만 제공합니다.`, steps: [`${a} 목표와 완료 조건을 한 문장으로 정하기`, `${b}에서 착안한 체크·피드백 흐름 만들기`, `${c} 결과 카드를 붙여 하루 사용 후 불편 기록하기`] },
      { title: `${b} 취향 상자`, one_liner: `${a} 기록을 ${c} 테마로 모아 다시 발견하는 서비스`, description: `${a} 기록을 ${b}에서 착안한 카드 구조로 정리합니다. 사용자는 ${c}를 연상시키는 테마를 선택해 기록을 둘러봅니다. 자동 추천보다 직접 저장하고 다시 찾는 경험을 먼저 검증합니다.`, steps: [`${a} 기록 예시 5개 준비하기`, `${b} 모티프의 저장·조회 화면 연결하기`, `${c} 테마로 두 사용자가 원하는 기록을 찾는지 확인하기`] },
    ],
    contest: [
      { title: `${a} 연결 프로젝트`, one_liner: `${particle(b, '을/를')} 활용해 ${a} 문제를 다루는 ${c} 테마의 참여 활동`, description: `${particle(a, '과/와')} 관련된 불편을 가진 사람의 경험을 듣고, ${particle(b, '을/를')} 활동 장소나 도구의 모티프로 삼습니다. ${particle(c, '을/를')} 참여 메시지에 연결합니다. 해결을 단정하지 않고 작은 참여 활동의 효과를 확인하는 제안입니다.`, steps: [`${a}에 관한 불편 사례를 직접 듣기`, `${particle(b, '을/를')} 활용한 참여 활동 한 가지 설계하기`, `${c} 메시지로 3명에게 제안을 보여주고 어려움 기록하기`] },
      { title: `${c}의 작은 변화`, one_liner: `${a}에 대한 관심을 ${b} 체험으로 연결하는 캠페인`, description: `${a} 주제를 짧은 이야기와 작은 체험으로 전달합니다. ${b}의 방식을 빌려 참여 장벽을 낮추고 ${c} 분위기의 안내를 제공합니다. 초안 단계에서는 참여 의향과 이해도를 관찰합니다.`, steps: [`${a}에 대한 확인 가능한 사례와 질문 정리하기`, `${b} 체험을 5분 활동으로 줄이기`, `${c} 안내문을 만들어 참여 후 이해도를 질문하기`] },
      { title: `${b} 도움 상자`, one_liner: `${a}의 불편을 줄일 작은 도구를 ${c} 테마로 제안`, description: `${a} 문제 중 한 가지 상황에 집중한 간단한 도움 도구를 만듭니다. ${b}에서 구성 방식을 가져오고 ${c}를 설명과 디자인의 모티프로 사용합니다. 실제 필요성은 당사자의 피드백으로 확인합니다.`, steps: [`${a} 문제 중 하나의 사용 상황 선택하기`, `${b} 방식의 도움 도구 견본 만들기`, `${c} 테마의 설명과 함께 당사자 의견을 구하기`] },
    ],
  }
  return validateIdea({ ...templates[categoryId][variant % 3], id: uid(), used_words: [...words], categoryId, category: category.name, ...(categoryId === 'custom' ? { topic } : {}), condition, source: 'local', revision: 1 }, words)
}

export function developIdea(idea, direction) {
  const option = directions.find(x => x.id === direction)
  if (!option) throw new Error('발전 방향을 선택해 주세요.')
  const [a, b, c] = idea.used_words
  const additions = {
    unique: [`사용자가 ${particle(a, '을/를')} 평소와 다른 형태로 경험하고, ${b} 방식을 한 단계 뒤집어 봅니다. ${c} 테마를 선택 가능한 요소로 바꿉니다.`, '익숙한 한 요소를 뒤집어 예상 밖의 경험을 추가했어요.', [`${a}의 기존 사용 방식과 반대되는 아이디어 2개 적기`, `${b} 방식의 새 흐름 한 가지 그리기`, `${c} 테마의 두 견본을 비교해 차별점 질문하기`]],
    realistic: [`${particle(a, '과/와')} 관련된 핵심 경험 하나만 남기고 ${particle(b, '은/는')} 이미 있는 도구로 대체합니다. ${c} 테마는 안내 카드 하나에 적용해 첫 시제품 범위를 줄입니다.`, '기존 도구를 활용하고 첫 시제품 범위를 줄였어요.', [`${a} 핵심 경험을 종이 또는 기존 도구로 만들기`, `${b} 방식의 필수 단계만 남겨 시간과 준비물 적기`, `${c} 안내 카드로 3명에게 시험하고 개선점 기록하기`]],
    fun: [`사용자가 ${particle(a, '을/를')} 선택하는 작은 미션을 넣고 ${b}의 과정을 게임처럼 단계별로 진행합니다. ${c} 테마의 완료 카드를 모으는 재미를 더합니다.`, '선택 미션과 단계별 완료 피드백을 추가했어요.', [`${a} 선택지 2개와 짧은 미션 만들기`, `${b} 과정을 3개 단계로 나누어 체험하기`, `${c} 완료 카드를 만들어 재미와 피로도 묻기`]],
    premium: [`${a}의 품질 기준을 명확하게 하고 ${b} 경험의 안내와 마감을 다듬습니다. ${c} 테마의 색상과 문구를 통일해 일관된 경험을 제공합니다.`, '품질 기준과 안내, 디자인의 일관성을 높였어요.', [`${a}의 품질 기준과 확인 방법 정리하기`, `${b} 경험에서 어색한 안내 2곳 개선하기`, `${c} 색상·문구를 통일한 견본으로 첫인상 확인하기`]],
  }
  const [description, what_changed, steps] = additions[direction]
  const base = idea.base_description || idea.description
  return validateIdea({ ...idea, base_description: base, description: `${base}\n\n${description}`, what_changed, steps, direction, source: 'local', revision: (idea.revision || 1) + 1, elaboration: undefined }, idea.used_words)
}

export function elaborateIdea(idea) {
  const [a, b, c] = idea.used_words
  const targets = { food: '새로운 맛을 가볍게 경험하고 싶은 사람', program: '작은 일상 기록과 실천을 쉽게 관리하고 싶은 사람', contest: '해당 불편을 경험하는 당사자와 지역 참여자' }
  return {
    target_user: targets[idea.categoryId] || `${idea.topic} 분야의 경험을 작게 시험하고 싶은 사용자`,
    problem: `${a} 관련 경험을 쉽게 시도하거나 필요할 때 다시 찾기 어렵다는 가설을 확인합니다.`,
    value: `${a}의 핵심 소재, ${b}의 방식, ${c}의 분위기를 한 가지 경험으로 연결합니다.`,
    core_features: [`${a} 중심의 한 가지 경험`, `${b} 모티프의 간단한 이용 흐름`, `${c} 테마의 결과와 피드백`],
    first_prototype: '종이 화면 또는 작은 견본 하나를 만든 뒤 3명에게 직접 사용해 보게 하고, 이해한 점과 막힌 점을 기록합니다.',
    risks: ['실제 사용자의 필요는 인터뷰로 확인해야 합니다.', '준비 시간·재료·기술 난이도는 견본을 만들며 다시 확인합니다.'],
  }
}

export function suggestNames(idea, tone) {
  const [a, , c] = idea.used_words
  const options = { base: [`${a} 한 장`, `${c} 노트`, `${a} 연결`], cute: [`${a}몽`, `${c} 소풍`, `작은 ${a}`], hip: [`${a} LAB`, `${c} WAVE`, `${a} STUDIO`] }
  return options[tone] || options.base
}
