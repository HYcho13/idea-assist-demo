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
        sendStatus(0,Bundle().apply { putString("stream","\nNATIVE_CORE_START\n") })
        val passed = JSONArray()
        fun checkTitle(root: View, text: String) {
            val title=walk(root).filterIsInstance<android.widget.TextView>().single { it.text.toString()==text }
            val metrics=targetContext.resources.displayMetrics
            val expected=android.util.TypedValue.applyDimension(android.util.TypedValue.COMPLEX_UNIT_SP,41f,metrics).toInt()
            val expectedSize=android.util.TypedValue.applyDimension(android.util.TypedValue.COMPLEX_UNIT_SP,32f,metrics)
            check(title.lineHeight==expected && kotlin.math.abs(title.textSize-expectedSize)<1f && title.typeface.isBold) { "Heading must be 32/41 Bold: $text" }
        }
        var isolatedSession: AppSession?=null
        var originalStore: AppStore?=null
        var originalLibrary: JSONObject?=null
        try {
            check(UserCondition.validate("")=="")
            check(UserCondition.validate("가".repeat(100)).length==100)
            check(UserCondition.validate("  1인 가구를 위한 서비스  ")=="1인 가구를 위한 서비스")
            listOf("가".repeat(101),"a\u0000b","a\nb","\u202etext","\ud800").forEach { check(runCatching { UserCondition.validate(it) }.isFailure) }
            passed.put("optional_condition_100_limit_control_bidi_unicode_validation")
            check(GenerationFeedback.elapsedSeconds(1000,10999)==9L)
            check(GenerationFeedback.elapsedSeconds(1000,11000)==10L)
            check(GenerationFeedback.elapsedSeconds(1000,900)==0L)
            check(GenerationFeedback.message(10,true).contains("제공업체"))
            check(GenerationFeedback.message(30,true).contains("취소"))
            val latencyConfig=GeminiApi.request("system","prompt",JSONObject().put("type","object")).getJSONObject("generationConfig")
            check(latencyConfig.getJSONObject("thinkingConfig").getString("thinkingLevel")=="low")
            check(latencyConfig.getInt("maxOutputTokens")==4096)
            check(AiEngine(targetContext).compactGuidance(false).contains("description은 60~160자"))
            passed.put("low_thinking_compact_guidance_and_monotonic_wait_feedback")
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
            val exportFixture=JSONObject(library.toString()).put("apiKey","mock-private-settings-no-export").put("draft",JSONObject().put("apiKey","mock-private-draft-no-export"))
            exportFixture.getJSONArray("ideas").getJSONObject(0).put("apiKey","mock-private-record-no-export")
            val exportedTxt=LibraryBackup.exportText(exportFixture)
            check(exportedTxt.startsWith("\uFEFF") && exportedTxt.contains("[아이디어 설명]") && exportedTxt.contains("[작게 시작하는 방법]"))
            check(!exportedTxt.contains("mock-private") && !exportedTxt.contains("apiKey") && !exportedTxt.contains("IDEA-ASSIST-BACKUP") && !exportedTxt.contains("복원 데이터"))
            check(LibraryBackup.exportText(AppStore.fresh()).contains("저장한 아이디어: 0개"))
            passed.put("readable_txt_export_only_no_restore_data_or_private_settings")
            val legacy=JSONObject(fixture.toString()).put("id","legacy-name").put("name","직접 주제 검증 · 규칙 abc123")
            val manual=JSONObject(fixture.toString()).put("id","manual-name").put("name","사용자 제목")
            val migrated=AppStore.validate(AppStore.fresh().put("ideas",JSONArray().put(manual).put(legacy)))
            check(migrated.getJSONArray("ideas").getJSONObject(0).getString("name")=="사용자 제목")
            check(migrated.getJSONArray("ideas").getJSONObject(1).getString("name")=="새 아이디어 1")
            check(AppStore.nextIdeaName(migrated.getJSONArray("ideas"))=="새 아이디어 2")
            check(AppStore.validate(JSONObject(migrated.toString())).toString()==migrated.toString())
            passed.put("numbered_default_names_and_exact_legacy_name_migration_preserve_manual_names")
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
            val googleFormat=GeminiApi.request("system","topic",JSONObject().put("type","object")).getJSONObject("generationConfig").getJSONObject("responseFormat").getJSONObject("text")
            check(googleFormat.getString("mimeType")=="APPLICATION_JSON")
            check(googleFormat.getJSONObject("schema").getString("type")=="object")
            val privateFixture="mock-private-input-not-for-display"
            fun googleFailure(status: String,reason: String="",message: String=privateFixture)=JSONObject().put("error",JSONObject().put("status",status).put("message",message).put("details",JSONArray().put(JSONObject().put("reason",reason))))
            val googleErrors=listOf(
                Triple(400,googleFailure("INVALID_ARGUMENT"),"요청 형식"),
                Triple(400,googleFailure("INVALID_ARGUMENT","API_KEY_INVALID"),"유효하지"),
                Triple(400,googleFailure("INVALID_ARGUMENT",message="API key expired. $privateFixture"),"만료"),
                Triple(403,googleFailure("PERMISSION_DENIED",message="Your API key was reported as leaked. $privateFixture"),"노출된 키"),
                Triple(403,googleFailure("PERMISSION_DENIED","SERVICE_DISABLED"),"비활성화"),
                Triple(403,googleFailure("PERMISSION_DENIED","API_KEY_ANDROID_APP_BLOCKED"),"사용 제한"),
                Triple(400,googleFailure("FAILED_PRECONDITION"),"사용 조건"),
                Triple(429,googleFailure("RESOURCE_EXHAUSTED"),"한도")
            )
            googleErrors.forEach { (code,payload,expected) ->
                val safe=GeminiApi.errorMessage(code,payload)
                check(expected in safe && privateFixture !in safe)
            }
            val longMock="mock-long-auth-key-"+"x".repeat(1600)
            check(GeminiApi.normalizeKey("\ufeff\u200b $longMock \u200b")==longMock)
            listOf("\"mock-key\"","GEMINI_API_KEY=mock-key","Bearer mock-key","masked****key","short…key","line\nbreak","x".repeat(8193)).forEach { check(runCatching { GeminiApi.normalizeKey(it) }.isFailure) }
            check(GeminiApi.MODEL_ENDPOINT.endsWith("/models/${GeminiApi.MODEL}") && !GeminiApi.MODEL_ENDPOINT.contains(":generateContent"))
            passed.put("gemini_complete_key_validation_no_truncation_and_metadata_check_endpoint")
            passed.put("google_json_enum_and_safe_provider_error_classification")
            check(runCatching { DemoDomain.topic(" ") }.isFailure && runCatching { DemoDomain.topic("가".repeat(81)) }.isFailure)
            passed.put("google_request_shape_refusal_truncation_and_topic_validation")

            val session = AppSession.get(targetContext)
            isolatedSession=session; originalStore=session.store; originalLibrary=session.library
            runOnMainSync { session.store=store; session.library=AppStore.fresh() }
            runOnMainSync { session.engine.mode = "demo"; session.current = null; session.dirty = false; session.screen = "home"; session.categoryId="food"; session.topic="" }
            sendStatus(0,Bundle().apply { putString("stream","\nNATIVE_CORE_UI_START\n") })
            val activity = startActivitySync(Intent(targetContext, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)) as MainActivity
            sendStatus(0,Bundle().apply { putString("stream","\nNATIVE_CORE_UI_READY\n") })
            runOnMainSync {
                val nativeButtons=walk(activity.window.decorView).filterIsInstance<Button>().toList()
                check(nativeButtons.any { it.text.contains("새로운 메뉴와 맛있는 경험") && it.elevation == 0f })
                check(nativeButtons.count { it.contentDescription?.toString() == "새 아이디어 주제 선택" } == 1)
                check(nativeButtons.any { it.text.toString() == "홈" } && nativeButtons.any { it.text.toString() == "보관함" })
                val title=walk(activity.window.decorView).filterIsInstance<android.widget.TextView>().single { it.text.toString().startsWith("어떤 아이디어를\n") }
                val expected=android.util.TypedValue.applyDimension(android.util.TypedValue.COMPLEX_UNIT_SP,41f,targetContext.resources.displayMetrics).toInt()
                check(title.lineHeight==expected) { "Home heading line height: ${title.lineHeight}, expected $expected" }
                checkTitle(activity.window.decorView,"어떤 아이디어를\n만들어 볼까요?")
            }
            fun click(title: String) = runOnMainSync {
                val matches = walk(activity.window.decorView).filterIsInstance<Button>().filter { it.text.toString() == title || it.contentDescription?.toString() == title }.toList()
                check(matches.size == 1) { "Expected one native button: $title, got ${matches.size}" }
                check(matches[0].isEnabled); matches[0].performClick()
            }
            fun dialogButtons()=walk(checkNotNull(activity.topicDialog?.window?.decorView)).filterIsInstance<Button>().toList()
            fun clickTopic(title: String) {
                runOnMainSync {
                    val match=dialogButtons().single { it.text.toString()==title || it.contentDescription?.toString()==title }
                    check(match.isEnabled); match.performClick()
                }
                waitForIdleSync()
            }
            val initialCategory=session.categoryId
            val initialWords=session.words.toList()
            click("새 아이디어 주제 선택")
            runOnMainSync {
                check(dialogButtons().map { it.contentDescription.toString() }.containsAll(DemoDomain.categoryNames+listOf("직접 입력","취소")))
                check(dialogButtons().filter { it.contentDescription.toString() in DemoDomain.categoryNames }.all { it.compoundDrawables[0]!=null && it.compoundDrawables[2]!=null && it.text.toString().contains("\n") })
                check(!session.busy && session.current==null && session.categoryId==initialCategory && session.words==initialWords)
                checkTitle(activity.topicDialog!!.window!!.decorView,"어떤 주제로 만들까요?")
            }
            clickTopic("직접 입력")
            runOnMainSync {
                val field=walk(activity.topicDialog!!.window!!.decorView).filterIsInstance<EditText>().single()
                checkTitle(activity.topicDialog!!.window!!.decorView,"나만의 주제를 적어주세요")
                val generate=dialogButtons().single { it.text.toString()=="단어 조합으로 이동" }
                check(!generate.isEnabled)
                field.setText("   "); check(!generate.isEnabled)
                field.setText("반려동물과 함께하는 여행"); check(generate.isEnabled)
            }
            runOnMainSync { check(dialogButtons().single { it.contentDescription?.toString()=="선택지로 돌아가기" }.text.isEmpty()) }
            clickTopic("선택지로 돌아가기"); clickTopic("직접 입력")
            runOnMainSync { check(walk(activity.topicDialog!!.window!!.decorView).filterIsInstance<EditText>().single().text.toString()=="반려동물과 함께하는 여행") }
            clickTopic("취소")
            check(activity.topicDialog==null && session.screen=="home" && session.categoryId==initialCategory && session.words==initialWords)
            for(index in 0..3) {
                // A missing cloud key makes any accidental automatic generation fail visibly.
                runOnMainSync { session.engine.mode="cloud" }
                click("새 아이디어 주제 선택")
                if(index<3) clickTopic(DemoDomain.categoryNames[index]) else {
                    clickTopic("직접 입력")
                    runOnMainSync { walk(activity.topicDialog!!.window!!.decorView).filterIsInstance<EditText>().single().setText("  반려동물과 함께하는 여행  ") }
                    clickTopic("단어 조합으로 이동")
                }
                check(activity.topicDialog==null && session.screen=="words")
                check(!session.busy && session.current==null && session.error.isBlank() && !session.dirty)
                check(session.condition.isEmpty())
                check(session.categoryId==if(index<3) DemoDomain.categoryIds[index] else "custom")
                if(index==3) check(session.topic=="반려동물과 함께하는 여행")
                runOnMainSync {
                    val locked=session.words[0]
                    walk(activity.window.decorView).first { it.contentDescription?.toString()=="$locked 고정" }.performClick()
                }
                val lockedWord=session.words[0]
                click("다시 뽑기")
                check(session.words[0]==lockedWord && session.current==null && !session.busy)
                val chosenWords=session.words.toList()
                runOnMainSync { session.engine.mode="demo" }
                click("이 조합으로 창조하기")
                await { !session.busy && session.current!=null }
                check(session.screen=="result")
                check((0..2).map { session.current!!.getJSONArray("used_words").getString(it) }==chosenWords)
                val retained=session.current!!.toString()
                click("새 아이디어 주제 선택"); clickTopic("취소")
                check(session.current!!.toString()==retained && session.dirty)
                runOnMainSync { session.current=null; session.dirty=false; session.categoryId="food"; session.topic="" }
                click("홈")
            }
            passed.put("native_plus_four_topics_words_first_no_cloud_call_lock_reroll_then_explicit_generation_cancel_preserves_state")
            click("선택하고 시작하기")
            val enteredCondition="1인 가구를 위한 서비스"
            runOnMainSync {
                val input=walk(activity.window.decorView).filterIsInstance<EditText>().single { it.contentDescription=="아이디어 생성 조건 · 선택" }
                check(input.text.isEmpty())
                input.setText("가".repeat(101)); check(input.text.length==100)
                input.setText(enteredCondition)
                check(session.condition==enteredCondition)
                check(session.library.getJSONObject("draft").getString("condition")==enteredCondition)
                check(walk(activity.window.decorView).filterIsInstance<android.widget.TextView>().any { it.text.toString()=="${enteredCondition.length}/100" })
            }
            runOnMainSync {
                val title=walk(activity.window.decorView).filterIsInstance<android.widget.TextView>().single { it.text.toString().startsWith("뜻밖의 세 단어를\n") }
                val expected=android.util.TypedValue.applyDimension(android.util.TypedValue.COMPLEX_UNIT_SP,41f,targetContext.resources.displayMetrics).toInt()
                check(title.lineHeight==expected) { "Words heading line height: ${title.lineHeight}, expected $expected" }
                checkTitle(activity.window.decorView,"뜻밖의 세 단어를\n조합해 보세요.")
                val buttons=walk(activity.window.decorView).filterIsInstance<Button>().toList()
                check(buttons.none { it.text.toString()=="‹ 홈" })
                check(buttons.count { it.text.toString()=="홈" }==1)
                for (i in listOf(0, 1)) {
                    val view = walk(activity.window.decorView).first { it.contentDescription?.toString() == "${session.words[i]} 고정" }
                    view.performClick()
                }
            }
            val before = session.words.toList()
            click("다시 뽑기")
            check(session.words.take(2) == before.take(2) && session.words[2] != before[2])
            check(session.condition==enteredCondition)
            click("이 조합으로 창조하기")
            await { !session.busy && session.current != null }
            check(session.current!!.getString("source") == "rules")
            check(session.current!!.getString("condition")==enteredCondition)
            runOnMainSync { check(walk(activity.window.decorView).filterIsInstance<android.widget.TextView>().any { it.text.toString()==enteredCondition }) }
            passed.put("native_condition_input_count_reroll_draft_and_result_snapshot")
            val beforeLeave=session.current!!.toString()
            fun clickLeave(title: String) {
                runOnMainSync {
                    val root=checkNotNull(activity.leaveDialog?.window?.decorView)
                    walk(root).filterIsInstance<Button>().single { it.text.toString()==title || it.contentDescription?.toString()==title }.performClick()
                }
                waitForIdleSync()
            }
            click("홈")
            runOnMainSync {
                val root=checkNotNull(activity.leaveDialog?.window?.decorView)
                checkTitle(root,"이 생각을\n저장할까요?")
                check(walk(root).filterIsInstance<Button>().map { it.text.toString() }.toList().containsAll(listOf("저장하러 가기","저장하지 않고 이동","계속 다듬기")))
            }
            clickLeave("계속 다듬기")
            check(activity.leaveDialog==null && session.current!!.toString()==beforeLeave && session.dirty && session.screen=="result")
            click("홈"); clickLeave("대화상자 닫기")
            check(activity.leaveDialog==null && session.current!!.toString()==beforeLeave && session.screen=="result")
            click("홈"); clickLeave("저장하러 가기")
            check(activity.leaveDialog==null && session.screen=="save" && session.dirty)
            runOnMainSync { activity.onBackPressed() }
            check(session.screen=="result" && session.current!!.toString()==beforeLeave)
            click("홈"); clickLeave("저장하지 않고 이동")
            check(session.screen=="home" && session.current==null && !session.dirty)
            // Resume the same generated fixture so the rest of the regression stays independent.
            runOnMainSync { session.current=JSONObject(beforeLeave); session.dirty=true; session.screen="result"; session.notifyChanged() }
            waitForIdleSync()
            passed.put("styled_unsaved_dialog_stay_close_save_navigation_and_explicit_discard")
            runOnMainSync {
                checkTitle(activity.window.decorView,session.current!!.optString("title"))
                check(walk(activity.window.decorView).filterIsInstance<Button>().none { it.text.toString()=="‹ 단어 조합" })
                val direction=walk(activity.window.decorView).filterIsInstance<Button>().first { it.contentDescription?.toString() == "더 현실적으로" }
                check((direction.parent as ViewGroup).childCount == 2) { "Development actions must use the web's two-column grid" }
            }
            click("더 현실적으로")
            check(!session.busy && session.current?.has("direction")!=true)
            click("이 방식으로 다듬기")
            await { !session.busy && session.current?.optString("direction") == "realistic" }
            click("한 걸음 더 구체화하기")
            await { !session.busy && session.current?.has("elaboration") == true }
            click("구체화한 아이디어 저장하기")
            val name = "새 아이디어 1"
            runOnMainSync {
                check(walk(activity.window.decorView).filterIsInstance<EditText>().first().text.toString()==name)
                checkTitle(activity.window.decorView,"생각을\n담아두세요")
            }
            click("저장하기")
            check(session.screen == "saved" && !session.dirty)
            click("보관함에서 확인하기")
            check(session.screen == "archive" && !session.dirty)
            runOnMainSync { checkTitle(activity.window.decorView,"모아둔 생각들.") }
            runOnMainSync {
                val views=walk(activity.window.decorView).filterIsInstance<android.widget.TextView>().toList()
                check(views.any { it.text.toString()=="↓ 백업" })
                check(views.none { it.text.contains("가져오기") || it.text.contains("기존 JSON 백업") || it.text.contains("TXT로 읽고") })
            }
            val saved = session.store.read().getJSONArray("ideas")
            check((0 until saved.length()).any { saved.getJSONObject(it).getString("name") == name })
            click(name)
            runOnMainSync { check(walk(activity.window.decorView).filterIsInstance<Button>().none { it.text.toString()=="‹ 단어 조합" }) }
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
            check(!session.busy && session.current?.has("direction")!=true)
            click("이 방식으로 다듬기")
            await { !session.busy && session.current?.optString("direction")=="realistic" }
            click("한 걸음 더 구체화하기")
            await { !session.busy && session.current?.has("elaboration")==true }
            click("구체화한 아이디어 저장하기")
            val topicName="새 아이디어 2"
            runOnMainSync { check(walk(activity.window.decorView).filterIsInstance<EditText>().first().text.toString()==topicName) }
            click("저장하기"); click("보관함에서 확인하기"); click(topicName)
            check(session.topic==directTopic && session.current!!.getString("topic")==directTopic)
            val topicLibrary=session.store.read()
            check(topicLibrary.getJSONObject("draft").getString("topic")==directTopic)
            val roundTrip=AppStore.validate(JSONObject(topicLibrary.toString())).getJSONArray("ideas")
            check((0 until roundTrip.length()).any { roundTrip.getJSONObject(it).optString("topic")==directTopic })
            passed.put("native_direct_topic_generate_develop_elaborate_save_backup_reopen")
            val exportPath=File(targetContext.cacheDir,"core-saf-export.txt")
            val exportUri=android.net.Uri.fromFile(exportPath)
            val documentResult=MainActivity::class.java.getDeclaredMethod("onActivityResult",Int::class.javaPrimitiveType,Int::class.javaPrimitiveType,Intent::class.java).apply { isAccessible=true }
            runOnMainSync { documentResult.invoke(activity,101,android.app.Activity.RESULT_OK,Intent().setData(exportUri)) }
            val exportedText=exportPath.readText(Charsets.UTF_8)
            check(exportedText.contains("저장한 아이디어: 2개") && exportedText.contains(topicName) && exportedText.contains("[구체화]"))
            val beforeRemovedImport=session.library.toString()
            runOnMainSync { documentResult.invoke(activity,102,android.app.Activity.RESULT_OK,Intent().setData(exportUri)) }
            check(session.library.toString()==beforeRemovedImport)
            passed.put("native_document_export_txt_removed_import_callback_does_not_change_library")
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
                runOnMainSync {
                    check(walk(activity.window.decorView).none { it is EditText })
                    checkTitle(activity.window.decorView,"생각을 만드는 방식")
                    check(walk(activity.window.decorView).filterIsInstance<android.widget.TextView>().none { it.text.toString()=="클라우드 연결 설정" })
                }
                click("클라우드 AI")
                check(session.screen=="cloud-key")
                runOnMainSync {
                    checkTitle(activity.window.decorView,"개인 API 키 입력")
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
                runOnMainSync {
                    val spinner=walk(activity.window.decorView).filterIsInstance<Spinner>().single()
                    if(spinner.selectedItemPosition!=1) spinner.setSelection(1)
                }
                waitForIdleSync()
                runOnMainSync {
                    val keyField=walk(activity.window.decorView).filterIsInstance<EditText>().single()
                    keyField.setText(longMock); check(keyField.text.toString()==longMock)
                    check(walk(activity.window.decorView).filterIsInstance<Button>().any { it.contentDescription?.toString()=="Gemini 연결 확인 · 생성 없이" })
                }
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
            val location=error.stackTrace.firstOrNull { it.className.startsWith("com.ideaassist.app") }
            finish(1, Bundle().apply { putString("stream", "\nNATIVE_CORE_FAIL: ${error.message} at $location\n") })
        } finally {
            isolatedSession?.let { session -> runOnMainSync {
                session.store=checkNotNull(originalStore); session.library=checkNotNull(originalLibrary)
                session.current=null; session.prior=null; session.dirty=false; session.screen="home"
            } }
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
