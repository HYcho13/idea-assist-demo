package com.ideaassist.app

import android.app.Instrumentation
import android.content.ContextWrapper
import android.content.Intent
import android.os.Bundle
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.CheckBox
import android.widget.Spinner
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.time.Instant
import java.util.UUID

/** Ordinary native UI/persistence tests. Rule mode is explicit and never represented as AI. */
class AppCoreInstrumentation : Instrumentation() {
    override fun onCreate(arguments: Bundle?) { super.onCreate(arguments); start() }
    override fun onStart() {
        val passed = JSONArray()
        try {
            for (category in DemoDomain.categoryIds) repeat(50) {
                val first = DemoDomain.draw(category, emptyList(), emptySet(), emptyList(), false)
                val next = DemoDomain.draw(category, first, setOf(0, 1), emptyList(), false)
                check(next[0] == first[0] && next[1] == first[1] && next[2] != first[2] && next.distinct().size == 3)
            }
            passed.put("slot_lock_reroll_unique_150")
            check(runCatching { DemoDomain.draw("food", listOf("a", "b", "c"), setOf(0, 1, 2), emptyList(), false) }.isFailure)
            check(AppSession.validatedDraftWords(JSONArray(listOf("a", " ", "c"))) == null)
            check(AppSession.validatedDraftWords(JSONArray(listOf("a", "a", "c"))) == null)
            passed.put("invalid_locks_and_draft_rejected")
            val sandbox = object : ContextWrapper(targetContext) {
                override fun getFilesDir(): File = File(targetContext.cacheDir, "core-check-${SystemClock.elapsedRealtime()}").apply { mkdirs() }
            }
            val wordList = listOf("딸기", "도시락", "추억")
            val fixture = DemoDomain.generate("food", wordList, "작게 시작하기")
                .put("id", UUID.randomUUID().toString()).put("name", "규칙 저장 검사")
                .put("categoryId", "food").put("category", "음식 개발")
                .put("used_words", JSONArray(wordList)).put("folderId", "default")
                .put("revision", 1).put("savedAt", Instant.now().toString())
            val store = AppStore(sandbox)
            val library = AppStore.fresh().put("ideas", JSONArray().put(fixture))
            store.write(library)
            check(store.read().getJSONArray("ideas").getJSONObject(0).getString("source") == "rules")
            check(AppStore.validate(JSONObject(library.toString())).getJSONArray("ideas").length() == 1)
            check(runCatching { AppStore.validate(JSONObject().put("version", 999)) }.isFailure)
            passed.put("atomic_storage_and_backup_validation")
            val missingKey = AiEngine(targetContext).apply { mode = "cloud" }
            check(runCatching { missingKey.generate("food", "음식 개발", wordList, "작게 시작하기") }.isFailure)
            missingKey.close()
            passed.put("cloud_missing_key_rejected_without_request")

            val validator = AiEngine(targetContext)
            val realShape = JSONObject("""{"title":"구름 딸기 자전거 카트","one_liner":"자전거 카트에서 딸기 디저트를 제공하는 작은 서비스입니다.","description":"딸기 디저트를 구름 모양 컵에 담습니다. 자전거 카트로 동네를 이동하며 시식합니다.","steps":["딸기 디저트 세 종류를 만들어 비교합니다.","자전거 카트와 포장 컵을 시험합니다.","구름 모양 컵을 세 명에게 보여줍니다."],"word_links":{"material":"딸기를 디저트의 중심 재료로 사용합니다.","method":"자전거 카트로 시제품을 운반합니다.","mood":"구름 모양 컵으로 가벼운 분위기를 만듭니다."}}""")
            val aiWords = listOf("딸기", "자전거", "구름")
            validator.validateTask(realShape, false, aiWords, null, "generate")
            val paraphrase = JSONObject(realShape.toString()).put("description", "구름 모양 컵에 딸기 디저트를 제공합니다. 자전거 카트에서 동네 주민에게 시식을 안내합니다.")
            check(runCatching { validator.validateTask(paraphrase, false, aiWords, realShape, "develop") }.isFailure)
            paraphrase.getJSONArray("steps").put(0, "딸기 요거트 한 종류만 만들어 두 명에게 시식합니다.")
            validator.validateTask(paraphrase, false, aiWords, realShape, "develop")
            val english = JSONObject(realShape.toString())
            english.getJSONArray("steps").put(0, "Prepare a dessert and test the recipe.")
            check(runCatching { validator.validateTask(english, false, aiWords, null, "generate") }.isFailure)
            val wrongWord = JSONObject(realShape.toString())
            wrongWord.getJSONObject("word_links").put("material", "콘을 디저트의 중심 재료로 사용합니다.")
            check(runCatching { validator.validateTask(wrongWord, false, aiWords, null, "generate") }.isFailure)
            validator.close()
            passed.put("ai_language_word_link_and_real_step_change_validation")
            val googleResponse=JSONObject().put("candidates",JSONArray().put(JSONObject().put("finishReason","STOP").put("content",JSONObject().put("parts",JSONArray().put(JSONObject().put("text",realShape.toString()))))))
            check(GeminiApi.parse(googleResponse).getString("title")==realShape.getString("title"))
            googleResponse.getJSONArray("candidates").getJSONObject(0).put("finishReason","MAX_TOKENS")
            check(runCatching { GeminiApi.parse(googleResponse) }.isFailure)
            check(runCatching { GeminiApi.parse(JSONObject().put("promptFeedback",JSONObject().put("blockReason","SAFETY"))) }.isFailure)
            check(GeminiApi.ENDPOINT.startsWith("https://generativelanguage.googleapis.com/"))
            check(GeminiApi.request("system","topic",JSONObject().put("type","object")).getJSONObject("generationConfig").has("responseFormat"))
            check(runCatching { DemoDomain.topic(" ") }.isFailure && runCatching { DemoDomain.topic("가".repeat(81)) }.isFailure)
            passed.put("google_request_shape_refusal_truncation_and_topic_validation")

            val session = AppSession.get(targetContext)
            runOnMainSync { session.engine.mode = "demo"; session.current = null; session.dirty = false; session.screen = "home"; session.categoryId="food"; session.topic="" }
            val activity = startActivitySync(Intent(targetContext, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity
            runOnMainSync {
                val nativeButtons=walk(activity.window.decorView).filterIsInstance<Button>().toList()
                check(nativeButtons.any { it.text.contains("새로운 메뉴와 맛있는 경험") && it.elevation == 0f })
                check(nativeButtons.count { it.contentDescription?.toString() == "무작위 아이디어 생성" } == 1)
                check(nativeButtons.any { it.text.toString() == "홈" } && nativeButtons.any { it.text.toString() == "보관함" })
            }
            fun click(title: String) = runOnMainSync {
                val matches = walk(activity.window.decorView).filterIsInstance<Button>().filter { it.text.toString() == title || it.contentDescription?.toString() == title }.toList()
                check(matches.size == 1) { "Expected one native button: $title, got ${matches.size}" }
                check(matches[0].isEnabled); matches[0].performClick()
            }
            click("선택하고 시작하기")
            runOnMainSync {
                for (i in listOf(0, 1)) {
                    val view = walk(activity.window.decorView).first { it.contentDescription?.toString() == "${session.words[i]} 고정" }
                    view.performClick()
                }
            }
            val before = session.words.toList()
            click("다시 뽑기")
            check(session.words.take(2) == before.take(2) && session.words[2] != before[2])
            click("이 조합으로 창조하기")
            await { !session.busy && session.current != null }
            check(session.current!!.getString("source") == "rules")
            runOnMainSync {
                val direction=walk(activity.window.decorView).filterIsInstance<Button>().first { it.contentDescription?.toString() == "더 현실적으로" }
                check((direction.parent as ViewGroup).childCount == 2) { "Development actions must use the web's two-column grid" }
            }
            click("더 현실적으로")
            await { !session.busy && session.current?.optString("direction") == "realistic" }
            click("한 걸음 더 구체화하기")
            await { !session.busy && session.current?.has("elaboration") == true }
            click("구체화한 아이디어 저장하기")
            val name = "자동 검증 · 규칙 ${UUID.randomUUID().toString().take(6)}"
            runOnMainSync { walk(activity.window.decorView).filterIsInstance<EditText>().first().setText(name) }
            click("저장하기")
            check(session.screen == "saved" && !session.dirty)
            click("보관함에서 확인하기")
            check(session.screen == "archive" && !session.dirty)
            val saved = AppStore(targetContext).read().getJSONArray("ideas")
            check((0 until saved.length()).any { saved.getJSONObject(it).getString("name") == name })
            click(name)
            check(session.current!!.getString("name") == name && session.current!!.getString("source") == "rules")
            passed.put("native_view_category_lock_generate_develop_elaborate_save_archive_reopen")
            click("홈")
            val directTopic="반려동물과 함께하는 여행"
            runOnMainSync { walk(activity.window.decorView).filterIsInstance<EditText>().first().setText(directTopic) }
            click("입력한 주제로 시작하기")
            check(session.categoryId=="custom" && session.topic==directTopic)
            click("다시 뽑기")
            click("이 조합으로 창조하기")
            await { !session.busy && session.current?.optString("topic")==directTopic }
            click("더 현실적으로")
            await { !session.busy && session.current?.optString("direction")=="realistic" }
            click("한 걸음 더 구체화하기")
            await { !session.busy && session.current?.has("elaboration")==true }
            click("구체화한 아이디어 저장하기")
            val topicName="직접 주제 검증 · 규칙 ${UUID.randomUUID().toString().take(6)}"
            runOnMainSync { walk(activity.window.decorView).filterIsInstance<EditText>().first().setText(topicName) }
            click("저장하기"); click("보관함에서 확인하기"); click(topicName)
            check(session.topic==directTopic && session.current!!.getString("topic")==directTopic)
            val topicLibrary=AppStore(targetContext).read()
            check(topicLibrary.getJSONObject("draft").getString("topic")==directTopic)
            val roundTrip=AppStore.validate(JSONObject(topicLibrary.toString())).getJSONArray("ideas")
            check((0 until roundTrip.length()).any { roundTrip.getJSONObject(it).optString("topic")==directTopic })
            passed.put("native_direct_topic_generate_develop_elaborate_save_backup_reopen")
            // Use an isolated consent store; test acknowledgement is never user consent.
            val fixturePreferenceName="core-cloud-consent-${UUID.randomUUID()}"
            val fixturePreferences=targetContext.getSharedPreferences(fixturePreferenceName,0)
            val actualStore=session.cloudConsentStore
            val savedMode=session.engine.mode; val savedProvider=session.engine.cloudProvider
            val savedModel=session.engine.cloudModel; val savedKey=session.engine.apiKey
            val oldModePreference=session.preferences.getString("mode",null)
            val oldProviderPreference=session.preferences.getString("cloudProvider",null)
            try {
                runOnMainSync { session.cloudConsentStore=CloudConsentStore(fixturePreferences) }
                click("모델 설정")
                runOnMainSync { check(walk(activity.window.decorView).none { it is EditText }) }
                click("클라우드 AI")
                check(session.screen=="cloud-key")
                runOnMainSync {
                    val consent=walk(activity.window.decorView).filterIsInstance<CheckBox>().single()
                    check(!consent.isChecked)
                    val save=walk(activity.window.decorView).filterIsInstance<Button>().single { it.contentDescription?.toString()=="설정 저장하기" }
                    check(!save.isEnabled)
                    walk(activity.window.decorView).filterIsInstance<EditText>().single().setText("mock-key-settings-only-no-network")
                    check(!save.isEnabled); consent.isChecked=true; check(save.isEnabled)
                }
                click("설정 저장하기")
                check(session.screen=="settings" && session.engine.mode=="cloud")
                check(CloudConsentStore(fixturePreferences).accepted(savedProvider))
                check(session.preferences.all.values.none { it == "mock-key-settings-only-no-network" })
                click("설정 마치기"); click("모델 설정"); click("클라우드 AI")
                runOnMainSync { check(walk(activity.window.decorView).filterIsInstance<CheckBox>().single().isChecked) }
                runOnMainSync { walk(activity.window.decorView).filterIsInstance<Spinner>().single().setSelection(if(savedProvider=="openai")1 else 0) }
                waitForIdleSync()
                runOnMainSync { check(!walk(activity.window.decorView).filterIsInstance<CheckBox>().single().isChecked) }
                click("‹ 생성 방식")
                check(session.engine.cloudProvider==savedProvider && session.engine.apiKey=="mock-key-settings-only-no-network")
                passed.put("native_separate_key_page_staged_save_provider_consent_persistence_no_network")
            } finally {
                runOnMainSync {
                    session.cloudConsentStore=actualStore; session.engine.mode=savedMode; session.engine.cloudProvider=savedProvider
                    session.engine.cloudModel=savedModel; session.engine.apiKey=savedKey
                    val restore=session.preferences.edit()
                    if(oldModePreference==null)restore.remove("mode") else restore.putString("mode",oldModePreference)
                    if(oldProviderPreference==null)restore.remove("cloudProvider") else restore.putString("cloudProvider",oldProviderPreference)
                    check(restore.commit())
                }
                targetContext.deleteSharedPreferences(fixturePreferenceName)
            }
            File(targetContext.filesDir, "core-smoke-report.json").writeText(JSONObject().put("passed", true).put("checks", passed).toString(2))
            finish(0, Bundle().apply { putString("stream", "\nNATIVE_CORE_PASS: ${passed.length()} groups\n") })
        } catch (error: Throwable) {
            File(targetContext.filesDir, "core-smoke-report.json").writeText(JSONObject().put("passed", false).put("checks", passed).put("error", error.message).toString(2))
            finish(1, Bundle().apply { putString("stream", "\nNATIVE_CORE_FAIL: ${error.message}\n") })
        }
    }
    private fun walk(view: View): Sequence<View> = sequence {
        yield(view)
        if (view is ViewGroup) for (i in 0 until view.childCount) yieldAll(walk(view.getChildAt(i)))
    }
    private fun await(condition: () -> Boolean) {
        val deadline = SystemClock.elapsedRealtime() + 10000
        while (!condition()) {
            check(SystemClock.elapsedRealtime() < deadline) { "Native UI operation timed out" }
            SystemClock.sleep(30)
        }
        waitForIdleSync()
    }
}
