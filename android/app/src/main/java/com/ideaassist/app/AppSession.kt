package com.ideaassist.app

import android.content.Context
import android.os.Handler
import android.os.Looper
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.Future

/** Activity-free session: one worker, memory-only key, safe rotation and cancellation. */
class AppSession private constructor(context: Context) {
    internal var store = AppStore(context.applicationContext)
    var library = store.read()
    val preferences = context.applicationContext.getSharedPreferences("native-ui", Context.MODE_PRIVATE)
    val engine = AiEngine(context.applicationContext)
    internal var cloudConsentStore = CloudConsentStore(context.applicationContext.getSharedPreferences("cloud-consent", Context.MODE_PRIVATE))
    var categoryId = "food"
    var topic = ""
    var words = DemoDomain.draw(categoryId, emptyList(), emptySet(), emptyList(), false)
    val locks = mutableSetOf<Int>()
    var condition = ""
    var useCustom = true
    var current: JSONObject? = null
    var prior: JSONObject? = null
    var dirty = false
    var screen = "home"
    var filter = "all"
    var search = ""
    var busy = false
        private set
    var operationKind = "generate"
        private set
    var status = ""
        private set
    var error = store.loadError ?: ""
    var listener: ((String) -> Unit)? = null
    private val handler = Handler(Looper.getMainLooper())
    private val executor = Executors.newSingleThreadExecutor()
    private var future: Future<*>? = null
    private var operation = 0
    init {
        engine.mode = preferences.getString("mode", "local")?.takeIf { it in listOf("local", "cloud", "demo") } ?: "local"
        engine.cloudProvider = preferences.getString("cloudProvider","openai")?.takeIf { it in listOf("openai","gemini") } ?: "openai"
        engine.cloudModel = if(engine.cloudProvider=="gemini") GeminiApi.MODEL else "gpt-4.1-mini"
        library.optJSONObject("draft")?.let { draft ->
            categoryId = draft.optString("categoryId").takeIf { DemoDomain.validCategory(it) } ?: "food"
            topic = draft.optString("topic").takeIf { it.isBlank() || runCatching { DemoDomain.topic(it) }.isSuccess } ?: ""
            val restoredWords = validatedDraftWords(draft.optJSONArray("words"))
            val restoredLocks = draft.optJSONArray("locks")
            val validLocks = restoredLocks != null && restoredLocks.length() <= 2 &&
                (0 until restoredLocks.length()).all { restoredLocks.opt(it) is Int && restoredLocks.getInt(it) in 0..2 } &&
                (0 until restoredLocks.length()).map { restoredLocks.getInt(it) }.distinct().size == restoredLocks.length()
            val validCategory = DemoDomain.validCategory(draft.optString("categoryId")) && (categoryId != "custom" || topic.isNotBlank())
            val validDraft = restoredWords != null && validLocks && validCategory
            words = if (validDraft) restoredWords!! else DemoDomain.draw(categoryId, emptyList(), emptySet(), emptyList(), false)
            if (validDraft) repeat(restoredLocks!!.length()) { locks.add(restoredLocks.getInt(it)) }
            condition = draft.optString("condition").takeIf { runCatching { UserCondition.validate(it) }.isSuccess } ?: ""
            useCustom = draft.optBoolean("useCustom", true)
            current = if (validDraft) draft.optJSONObject("idea")?.let { AppStore.cleanIdea(it) } else null
            current?.let { idea ->
                if(Regex("^(자동 검증 · 규칙|직접 주제 검증 · 규칙) [0-9a-f]{6}$").matches(idea.optString("name"))) {
                    val ideas=library.getJSONArray("ideas")
                    (0 until ideas.length()).map { ideas.getJSONObject(it) }.firstOrNull { it.optString("id")==idea.optString("id") }?.let { idea.put("name",it.getString("name")) }
                }
            }
            dirty = draft.optBoolean("dirty", false) && current != null
            screen = if (current != null) "result" else "home"
        }
    }
    fun customWords(): List<String> = library.getJSONArray("customWords").let { values -> (0 until values.length()).map { values.getString(it) } }
    fun cloudConsent(provider: String) = cloudConsentStore.accepted(provider)
    fun saveCloudSettings(provider: String, key: String, consent: Boolean) {
        require(provider in listOf("openai","gemini")) { "AI 제공업체를 선택하세요." }
        val clean=if(provider=="gemini") GeminiApi.normalizeKey(key) else key.trim()
        require(clean.isNotEmpty() && (provider=="gemini" || clean.length<=512) && clean.all { it.code in 33..126 }) { "본인의 개인 API 키를 입력하고 형식을 확인해 주세요." }
        cloudConsentStore.save(provider,consent)
        check(preferences.edit().putString("mode","cloud").putString("cloudProvider",provider).commit()) { "클라우드 설정을 저장하지 못했습니다. 다시 시도하세요." }
        engine.cloudProvider=provider; engine.cloudModel=if(provider=="gemini") GeminiApi.MODEL else "gpt-4.1-mini"
        engine.apiKey=clean; engine.mode="cloud"
    }
    fun persist() {
        UserCondition.validate(condition)
        val snapshot = JSONObject(library.toString())
        snapshot.put("draft", JSONObject().put("categoryId", categoryId).put("topic",topic).put("words", JSONArray(words)).put("locks", JSONArray(locks.toList())).put("condition", condition).put("useCustom", useCustom).put("idea", current?.let { AppStore.cleanIdea(it) } ?: JSONObject.NULL).put("dirty", dirty))
        store.write(snapshot)
        library = snapshot
    }
    fun notifyChanged() { listener?.invoke("state") }
    fun cancel() {
        operation++
        engine.cancel()
        future?.cancel(true)
        future = null
        busy = false
        status = "작업을 취소했습니다."
        notifyChanged()
    }
    fun prepare() = launch("로컬 AI 모델을 준비하고 있습니다…", "prepare") { progress ->
        engine.prepareLocal(progress)
        null
    }
    fun generate(type: String = "generate", direction: String? = null) {
        if (busy) return
        val conditionFailure=runCatching { UserCondition.validate(if(type=="generate") condition else current?.optString("condition") ?: condition) }.exceptionOrNull()
        if(conditionFailure!=null) { error=conditionFailure.message.orEmpty(); notifyChanged(); return }
        if (engine.mode == "local" && !engine.localReady()) {
            error = "로컬 AI 모델이 아직 없습니다. AI 설정에서 모델을 내려받거나 직접 입력한 클라우드 키를 사용해 주세요."
            notifyChanged(); return
        }
        if (engine.mode == "cloud" && engine.apiKey.isBlank()) {
            error = "클라우드 AI는 직접 입력한 API 키가 필요합니다. 키는 현재 앱 프로세스의 메모리에만 보관합니다."
            notifyChanged(); return
        }
        if(engine.mode=="cloud" && !cloudConsent(engine.cloudProvider)) {
            error="개인 API 키 설정에서 전송·API 비용 동의를 확인하고 설정을 저장해 주세요."
            notifyChanged(); return
        }
        val inputWords = words.toList()
        val inputCategory = categoryId
        val inputTopic = if(inputCategory=="custom") DemoDomain.topic(topic) else ""
        val inputCondition = UserCondition.validate(if(type=="generate") condition else current?.optString("condition") ?: condition)
        val before = current?.let { JSONObject(it.toString()) }
        val mode = engine.mode
        val model = engine.cloudModel
        val providerDirection = direction?.let { id -> DemoDomain.directions.firstOrNull { it.first == id }?.second ?: id }
        launch(if (type == "elaborate") "아이디어를 구체화하고 있습니다…" else "세 단어를 아이디어로 연결하고 있습니다…", type) { progress ->
            val category = DemoDomain.categoryName(inputCategory,inputTopic)
            val output = if (mode == "demo") DemoDomain.generate(inputCategory, inputWords, inputCondition, before, direction, type, topic = inputTopic)
                else engine.generate(inputCategory, category, inputWords, inputCondition, if (type == "generate") null else before, providerDirection, type, progress)
            val source = when (mode) { "demo" -> "rules"; "cloud" -> if(engine.cloudProvider=="gemini") "gemini" else "cloud"; else -> "native-llama" }
            val modelName = output.optString("model").ifBlank { when (mode) { "demo" -> "explicit-rules-demo"; "cloud" -> model; else -> AiEngine.MODEL_LABEL } }
            if (type == "elaborate") {
                require(before != null) { "먼저 아이디어를 만들어 주세요." }
                listOf("target_user", "problem", "value", "first_prototype").forEach { require(output.optString(it).isNotBlank()) { "AI 구체화 응답이 불완전합니다. 다시 시도해 주세요." } }
                require(output.getJSONArray("core_features").length() == 3 && output.has("risks")) { "AI 핵심 기능 응답이 불완전합니다." }
                JSONObject(before.toString()).put("elaboration", output).put("elaborationSource", source).put("elaborationModel", modelName).put("revision", before.optInt("revision", 1) + 1)
            } else {
                listOf("title", "one_liner", "description").forEach { require(output.optString(it).isNotBlank()) { "AI 응답이 불완전합니다. 다시 시도해 주세요." } }
                require(output.getJSONArray("steps").length() == 3) { "AI 실행 단계 응답이 불완전합니다." }
                val links = output.getJSONObject("word_links")
                listOf("material", "method", "mood").forEach { require(links.optString(it).isNotBlank()) { "AI 단어 연결 응답이 불완전합니다." } }
                AppStore.cleanIdea(output).put("id", if (type == "develop") before?.optString("id") ?: UUID.randomUUID().toString() else UUID.randomUUID().toString())
                    .put("categoryId", inputCategory).put("category", category).put("topic",inputTopic).put("used_words", JSONArray(inputWords)).put("condition", inputCondition)
                    .put("source", source).put("model", modelName).put("revision", if (type == "develop") (before?.optInt("revision", 1) ?: 0) + 1 else 1)
                    .also { if (direction != null) it.put("direction", direction).put("what_changed", "${DemoDomain.directions.firstOrNull { pair -> pair.first == direction }?.second ?: direction} 방향으로 발전시켰습니다.") }
            }
        }
    }
    private fun launch(initialStatus: String, kind: String = "generate", task: ((String) -> Unit) -> JSONObject?) {
        if (busy) return
        val ticket = ++operation
        operationKind = kind
        busy = true; status = initialStatus; error = ""
        notifyChanged()
        future = executor.submit {
            try {
                val value = task { update -> handler.post { if (ticket == operation) { status = update; listener?.invoke("progress") } } }
                handler.post {
                    if (ticket == operation) {
                        busy = false; status = if (value == null) "로컬 AI 모델이 준비되었습니다." else ""
                        if (value != null) { prior = current; current = value; dirty = true; screen = "result" }
                        try { persist() } catch (failure: Exception) { error = failure.message ?: "임시 결과를 저장하지 못했습니다." }
                        notifyChanged()
                    }
                }
            } catch (failure: Throwable) {
                handler.post {
                    if (ticket == operation) {
                        busy = false
                        val raw = failure.message ?: "AI 작업을 완료하지 못했습니다. 설정을 확인하고 다시 시도해 주세요."
                        error = if (engine.apiKey.isBlank()) raw.take(350) else raw.replace(engine.apiKey, "[키 숨김]").take(350)
                        notifyChanged()
                    }
                }
            }
        }
    }
    companion object {
        internal fun validatedDraftWords(values: JSONArray?): List<String>? {
            if (values == null || values.length() != 3) return null
            val result = (0..2).map { index ->
                val value = values.opt(index)
                if (value !is String) return null
                val normalized = DemoDomain.normalize(value)
                if (value.length > 12 || normalized.isBlank() || normalized.length > 12) return null
                normalized
            }
            return result.takeIf { it.distinct().size == 3 }
        }
        @Volatile private var instance: AppSession? = null
        fun get(context: Context): AppSession = instance ?: synchronized(this) { instance ?: AppSession(context).also { instance = it } }
    }
}
