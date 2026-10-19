package com.ideaassist.app

import android.content.Context
import android.util.AtomicFile
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.time.Instant

/** Version 1 is the same interchange schema as src/demo/storage.js. */
class AppStore(context: Context) {
    private val file = AtomicFile(File(context.filesDir, "idea-assist-library-v1.json"))
    var loadError: String? = null
        private set
    fun read(): JSONObject = try {
        if (!file.baseFile.exists() && !File(file.baseFile.path + ".bak").exists()) fresh()
        else validate(JSONObject(String(file.readFully(), Charsets.UTF_8)))
    } catch (_: Exception) {
        loadError = "저장 파일을 읽지 못했습니다. 기존 파일을 덮어쓰지 않고 보호한 채 임시로 시작합니다."
        fresh()
    }
    fun write(value: JSONObject, recover: Boolean = false) {
        check(loadError == null || recover) { loadError ?: "저장 파일 오류" }
        val checked = validate(value)
        val stream = file.startWrite()
        try {
            stream.write(checked.toString().toByteArray(Charsets.UTF_8))
            file.finishWrite(stream)
            loadError = null
        } catch (error: Exception) {
            file.failWrite(stream)
            throw error
        }
    }
    companion object {
        fun nextIdeaName(ideas: JSONArray): String {
            val largest=(0 until ideas.length()).mapNotNull { index -> Regex("^새 아이디어 ([1-9]\\d*)$").matchEntire(ideas.getJSONObject(index).optString("name"))?.groupValues?.get(1)?.toLongOrNull() }.filter { it in 1..9007199254740990L }.maxOrNull() ?: 0L
            return "새 아이디어 ${largest+1}"
        }
        fun fresh() = JSONObject().put("version", 1).put("ideas", JSONArray()).put("folders", JSONArray().put(JSONObject().put("id", "default").put("name", "기본 폴더"))).put("customWords", JSONArray()).put("draft", JSONObject.NULL)
        private val ideaKeys = setOf("id", "title", "name", "one_liner", "description", "steps", "used_words", "word_links", "categoryId", "category", "topic", "condition", "source", "model", "revision", "direction", "what_changed", "folderId", "savedAt", "elaboration", "elaborationSource", "elaborationModel")
        fun cleanIdea(idea: JSONObject): JSONObject {
            val result = JSONObject()
            for (key in ideaKeys) if (idea.has(key)) result.put(key, idea.get(key))
            if (result.optString("source") == "local") result.put("source", "rules")
            if (result.optString("elaborationSource") == "local") result.put("elaborationSource", "rules")
            return result
        }
        fun validate(input: JSONObject): JSONObject {
            require(input.optInt("version") == 1) { "지원하지 않는 백업 버전입니다." }
            val ideas = input.getJSONArray("ideas")
            val folders = input.getJSONArray("folders")
            val custom = input.getJSONArray("customWords")
            require(ideas.length() <= 500 && folders.length() <= 30 && custom.length() <= 10) { "백업 항목 수가 제한을 초과했습니다." }
            fun text(obj: JSONObject, key: String, max: Int = 2000) {
                val value = obj.get(key)
                require(value is String && value.isNotBlank() && value.length <= max) { "$key 항목을 읽을 수 없습니다." }
            }
            fun texts(values: JSONArray, max: Int = 2000) {
                repeat(values.length()) { index ->
                    val value = values.get(index)
                    require(value is String && value.isNotBlank() && value.length <= max) { "잘못된 텍스트 항목입니다." }
                }
            }
            val folderIds = mutableSetOf<String>()
            val cleanFolders = JSONArray()
            repeat(folders.length()) { index ->
                val f = folders.getJSONObject(index)
                text(f, "id", 100); text(f, "name", 30)
                require(folderIds.add(f.getString("id"))) { "중복 폴더입니다." }
                cleanFolders.put(JSONObject().put("id", f.getString("id")).put("name", f.getString("name")))
            }
            if (cleanFolders.length() == 0) { cleanFolders.put(JSONObject().put("id", "default").put("name", "기본 폴더")); folderIds.add("default") }
            texts(custom, 12)
            require((0 until custom.length()).map { custom.getString(it) }.distinct().size == custom.length()) { "중복 사용자 단어입니다." }
            val ids = mutableSetOf<String>()
            val cleanIdeas = JSONArray()
            repeat(ideas.length()) { index ->
                val idea = cleanIdea(ideas.getJSONObject(index))
                text(idea, "id", 100); text(idea, "title"); text(idea, "name", 80); text(idea, "description"); text(idea, "one_liner")
                require(ids.add(idea.getString("id"))) { "중복 아이디어입니다." }
                require(DemoDomain.validCategory(idea.optString("categoryId")) && idea.optString("folderId") in folderIds) { "분야 또는 폴더가 올바르지 않습니다." }
                if(idea.optString("categoryId")=="custom") DemoDomain.topic(idea.getString("topic"))
                val words = idea.getJSONArray("used_words"); val steps = idea.getJSONArray("steps")
                require(words.length() == 3 && steps.length() == 3) { "단어와 실행 단계는 각각 세 개여야 합니다." }
                texts(words, 12); texts(steps)
                Instant.parse(idea.getString("savedAt"))
                idea.optJSONObject("elaboration")?.let { detail ->
                    listOf("target_user", "problem", "value", "first_prototype").forEach { text(detail, it) }
                    val features = detail.getJSONArray("core_features")
                    require(features.length() == 3) { "핵심 기능은 세 개여야 합니다." }
                    texts(features); texts(detail.getJSONArray("risks"))
                }
                cleanIdeas.put(idea)
            }
            for(index in cleanIdeas.length()-1 downTo 0) {
                val idea=cleanIdeas.getJSONObject(index)
                if(Regex("^(자동 검증 · 규칙|직접 주제 검증 · 규칙) [0-9a-f]{6}$").matches(idea.getString("name"))) idea.put("name",nextIdeaName(cleanIdeas))
            }
            return JSONObject().put("version", 1).put("ideas", cleanIdeas).put("folders", cleanFolders).put("customWords", custom).put("draft", input.optJSONObject("draft") ?: JSONObject.NULL)
        }
    }
}
