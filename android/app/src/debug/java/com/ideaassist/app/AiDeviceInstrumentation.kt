package com.ideaassist.app

import android.app.Instrumentation
import android.os.Bundle
import android.os.SystemClock
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** Debug-only real inference check. It never uses or reads a cloud credential. */
class AiDeviceInstrumentation : Instrumentation() {
    private var options = Bundle()
    override fun onCreate(arguments: Bundle?) {
        super.onCreate(arguments)
        options = arguments ?: Bundle()
        start()
    }

    override fun onStart() {
        val report = JSONObject().put("engine", "native-llama")
            .put("model", AiEngine.MODEL_LABEL).put("modelSha256", AiEngine.MODEL_SHA256)
        val results = JSONArray()
        val started = SystemClock.elapsedRealtime()
        report.put("status", "running").put("passed", JSONObject.NULL).put("results", results)
        File(targetContext.filesDir, "ai-smoke-report.json").writeText(report.toString(2))
        try {
            val engine = AiEngine(targetContext)
            engine.mode = "local"
            engine.prepareLocal { progress(it) }
            val categoryId = options.getString("category", "food")!!
            val category = when (categoryId) {
                "program" -> "프로그램 개발"
                "contest" -> "공모전 주제"
                else -> "음식 개발"
            }
            val words = when (categoryId) {
                "program" -> listOf("독서", "달력", "여유")
                "contest" -> listOf("환경", "지도", "연결")
                else -> listOf("딸기", "자전거", "구름")
            }
            report.put("categoryId", categoryId).put("words", JSONArray(words))
            val condition = "일주일 안에 작은 시제품 시험하기"
            var current: JSONObject? = null
            for (type in listOf("generate", "develop", "elaborate")) {
                val caseStarted = SystemClock.elapsedRealtime()
                progress("실제 추론 검사 시작: $type")
                val output = engine.generate(
                    categoryId, category, words, condition, current,
                    if (type == "develop") "더 현실적으로" else null,
                    type, ::progress
                )
                validate(output, type)
                val result = JSONObject().put("type", type)
                    .put("elapsedMs", SystemClock.elapsedRealtime() - caseStarted)
                    .put("output", output)
                results.put(result)
                File(targetContext.filesDir, "ai-smoke-$type.json").writeText(output.toString(2))
                if (type != "elaborate") {
                    current = JSONObject(output.toString())
                        .put("used_words", JSONArray(words))
                        .put("categoryId", categoryId).put("category", category)
                    if (type == "develop") {
                        val previous = results.getJSONObject(0).getJSONObject("output")
                        check(previous.getString("description") != output.getString("description")) {
                            "발전 결과의 설명이 이전 결과와 동일합니다."
                        }
                    }
                }
                progress("실제 추론 검사 통과: $type")
                report.put("results", results)
                File(targetContext.filesDir, "ai-smoke-report.json").writeText(report.toString(2))
            }
            report.put("status", "finished").put("passed", true).put("elapsedMs", SystemClock.elapsedRealtime() - started)
            File(targetContext.filesDir, "ai-smoke-report.json").writeText(report.toString(2))
            finish(0, Bundle().apply { putString("stream", "\nREAL_LOCAL_AI_PASS: generate/develop/elaborate\n") })
        } catch (error: Throwable) {
            report.put("status", "finished").put("passed", false).put("results", results)
                .put("elapsedMs", SystemClock.elapsedRealtime() - started)
                .put("error", error.message ?: error.javaClass.simpleName)
            File(targetContext.filesDir, "ai-smoke-report.json").writeText(report.toString(2))
            finish(1, Bundle().apply { putString("stream", "\nREAL_LOCAL_AI_FAIL: ${error.message}\n") })
        }
    }

    private fun progress(message: String) {
        sendStatus(0, Bundle().apply { putString("stream", "$message\n") })
    }

    private fun validate(output: JSONObject, type: String) {
        val textKeys = if (type == "elaborate")
            listOf("target_user", "problem", "value", "first_prototype")
        else listOf("title", "one_liner", "description")
        textKeys.forEach { check(output.getString(it).trim().isNotEmpty()) { "빈 항목: $it" } }
        val listKey = if (type == "elaborate") "core_features" else "steps"
        val list = output.getJSONArray(listKey)
        check(list.length() == 3) { "$listKey 항목은 3개여야 합니다." }
        val items = (0 until list.length()).map { list.getString(it).trim() }
        check(items.all { it.isNotEmpty() } && items.toSet().size == 3) { "빈 항목 또는 반복: $listKey" }
        if (type == "elaborate") check(output.getJSONArray("risks").length() > 0)
        else {
            val links = output.getJSONObject("word_links")
            listOf("material", "method", "mood").forEach {
                check(links.getString(it).trim().isNotEmpty()) { "단어 연결 설명 누락: $it" }
            }
        }
    }
}
