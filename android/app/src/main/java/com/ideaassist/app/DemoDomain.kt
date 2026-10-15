package com.ideaassist.app

import org.json.JSONArray
import org.json.JSONObject
import java.text.Normalizer
import kotlin.random.Random

/** Explicit opt-in rules demo. These templates never claim to be model inference. */
object DemoDomain {
    val categoryIds = listOf("food", "program", "contest")
    val categoryNames = listOf("음식 개발", "프로그램 개발", "공모전 주제")
    fun validCategory(id: String) = id in categoryIds || id == "custom"
    fun categoryName(id: String, topic: String = "") = if(id=="custom") topic else categoryNames[categoryIds.indexOf(id)]
    fun topic(value: String): String = normalize(value).also { require(it.isNotBlank() && it.length <= 80) { "주제·분야를 1~80자로 입력해 주세요." } }
    val roles = listOf("소재", "방식", "분위기")
    val directions = listOf("unique" to "더 독특하게", "realistic" to "더 현실적으로", "fun" to "더 재미있게", "premium" to "더 고급스럽게")
    val pools = mapOf(
        "food" to listOf(listOf("김치", "딸기", "두부", "고구마", "귤", "곡물", "녹차", "치즈", "버섯", "꿀", "콩", "토마토"), listOf("자전거", "도시락", "시장", "캠핑", "정원", "기차", "구독", "공유", "지도", "체험", "키트", "배달"), listOf("구름", "새벽", "계절", "파도", "우주", "여행", "편지", "숲", "동네", "추억", "축제", "별빛")),
        "program" to listOf(listOf("기억", "독서", "습관", "시간", "일정", "소리", "걷기", "취향", "공부", "약속", "기록", "집중"), listOf("지도", "알림", "게임", "라디오", "도서관", "달력", "카드", "교환", "추천", "채팅", "대시보드", "우산"), listOf("빛", "여행", "우주", "온도", "동네", "새벽", "계절", "숲", "파도", "구름", "모험", "편지")),
        "contest" to listOf(listOf("고립", "쓰레기", "돌봄", "안전", "청년", "환경", "반려동물", "노인", "건강", "장애", "일자리", "교육"), listOf("공유", "공원", "학교", "골목", "이동", "교환", "지도", "시장", "라디오", "자전거", "키트", "도서관"), listOf("마을", "비", "계절", "연결", "빛", "축제", "여행", "편지", "추억", "숲", "새벽", "온도"))
    )
    fun normalize(value: String) = Normalizer.normalize(value, Normalizer.Form.NFKC).trim().replace(Regex("\\s+"), " ")
    fun draw(category: String, previous: List<String>, locked: Set<Int>, custom: List<String>, useCustom: Boolean): List<String> {
        require(validCategory(category)) { "사용할 수 없는 분야입니다." }
        require(locked.size <= 2 && locked.all { it in 0..2 && previous.getOrNull(it)?.isNotBlank() == true }) { "유효한 단어를 최대 2개까지만 고정할 수 있습니다." }
        val selected = MutableList(3) { i -> if (i in locked) previous.getOrElse(i) { "" } else "" }
        val open = (0..2).filter { it !in locked }.shuffled()
        if (useCustom && custom.isNotEmpty() && open.isNotEmpty()) {
            val candidates = custom.distinct().filter { it !in selected }.shuffled()
            val count = minOf(candidates.size, open.size, Random.nextInt(1, 3))
            repeat(count) { selected[open[it]] = candidates[it] }
        }
        for (i in open) if (selected[i].isEmpty()) {
            val pool = if(category=="custom") pools.values.flatMap { it[i] }.distinct() else pools.getValue(category)[i]
            val candidates = pool.filter { it !in selected && it != previous.getOrNull(i) }
            selected[i] = candidates.random()
        }
        return selected
    }
    fun generate(categoryId: String, words: List<String>, condition: String, current: JSONObject? = null, direction: String? = null, type: String = "generate"): JSONObject {
        val (a, b, c) = words
        if (type == "elaborate") return JSONObject().put("target_user", "${if(categoryId=="custom") current?.optString("topic").orEmpty()+" 분야에서 " else ""}$a 관련 경험을 더 간편하게 만들고 싶은 소규모 사용자입니다.")
            .put("problem", "$a 경험을 시작할 때 필요한 정보와 도구가 흩어져 있다는 가설을 확인합니다.")
            .put("value", "$b 방식을 이용해 접근을 줄이고 $c 분위기로 편안하게 참여하도록 제안합니다.")
            .put("core_features", JSONArray(listOf("$a 관련 요청과 취향 입력", "$b 방식의 사용 흐름 안내", "$c 느낌의 결과 공유와 피드백")))
            .put("first_prototype", "종이 화면 세 장으로 ${current?.optString("title") ?: a}의 첫 사용 흐름을 만들고 세 명에게 시험합니다.")
            .put("risks", JSONArray(listOf("사용자가 실제로 필요로 하는지 인터뷰로 확인해야 합니다.", "운영 비용과 $b 방식의 실행 조건을 확인해야 합니다.")))
        val directionText = directions.firstOrNull { it.first == direction }?.second ?: "작게 시작하기"
        val title = when (categoryId) { "food" -> "$c $a 한입"; "program" -> "$a $b 노트"; else -> "$c $a 연결" }
        val action = when (categoryId) { "food" -> "$a 재료를 중심으로 새로운 메뉴를 구성"; "program" -> "$a 기록을 정리하는 작은 앱을 구성"; "custom" -> "$a 소재를 이용해 작은 경험의 견본을 구성"; else -> "$a 문제를 함께 살펴보는 참여 활동을 구성" }
        return JSONObject().put("title", if (direction == null) title else "$title · $directionText")
            .put("one_liner", "$b 방식을 통해 $a 경험에 $c 분위기를 더하는 작은 제안입니다.")
            .put("description", "$action 합니다. $b 방식을 이용해 사용자에게 전달하고, $c 느낌의 디자인과 안내를 적용합니다. $directionText 방향으로 첫 경험을 시험합니다.${if (condition.isBlank()) "" else " 조건: $condition"}")
            .put("steps", JSONArray(listOf("$a 관련 필요를 사용자 세 명에게 질문하고 정리하기", "$b 방식을 종이 또는 작은 시제품으로 만들어 시험하기", "$c 분위기를 적용한 결과를 보여주고 개선점 기록하기")))
            .put("word_links", JSONObject().put("material", "$a 단어를 핵심 소재와 사용자 필요로 연결합니다.").put("method", "$b 단어를 전달 방식과 사용 흐름으로 연결합니다.").put("mood", "$c 단어를 디자인과 참여 분위기로 연결합니다."))
            .put("source", "rules").put("model", "explicit-rules-demo")
    }
}
