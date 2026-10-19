package com.ideaassist.app

import org.json.JSONArray
import org.json.JSONObject

/** Same UTF-8 TXT interchange format as src/demo/backup.js; no settings or draft. */
object LibraryBackup {
    const val MAX_BYTES = 10_000_000
    private fun pick(value: JSONObject, keys: List<String>) = JSONObject().apply {
        keys.forEach { if(value.has(it)) put(it,value.get(it)) }
    }
    private fun snapshot(value: JSONObject): JSONObject {
        val checked=AppStore.validate(value)
        val ideas=checked.getJSONArray("ideas")
        repeat(ideas.length()) { index ->
            val idea=ideas.getJSONObject(index)
            idea.optJSONObject("word_links")?.let { idea.put("word_links",pick(it,listOf("material","method","mood"))) }
            idea.optJSONObject("elaboration")?.let { idea.put("elaboration",pick(it,listOf("target_user","problem","value","core_features","first_prototype","risks"))) }
        }
        return checked.put("draft",JSONObject.NULL)
    }
    private fun strings(values: JSONArray)=(0 until values.length()).map { values.getString(it) }
    private fun source(value: String)=when(value) {
        "local","rules" -> "간편 시연 · 규칙 기반 결과"
        "webllm" -> "실제 온디바이스 AI 모델 생성"
        "native-llama" -> "실제 네이티브 온디바이스 AI · llama.cpp 생성"
        "cloud" -> "실제 클라우드 AI · OpenAI 생성"
        "gemini" -> "실제 클라우드 AI · Google Gemini 생성"
        else -> "출처 미확인 · 이전 결과"
    }
    fun exportText(value: JSONObject): String {
        val data=snapshot(value)
        val ideas=data.getJSONArray("ideas")
        val folders=data.getJSONArray("folders")
        val names=(0 until folders.length()).associate { folders.getJSONObject(it).let { f -> f.getString("id") to f.getString("name") } }
        val lines=mutableListOf("아이디어 보조 · 보관함 내보내기",
            "저장한 아이디어: ${ideas.length()}개","폴더: ${names.values.joinToString(" · ")}",
            "내 단어: ${strings(data.getJSONArray("customWords")).joinToString(" · ").ifEmpty { "없음" }}","")
        repeat(ideas.length()) { index ->
            val idea=ideas.getJSONObject(index)
            val words=strings(idea.getJSONArray("used_words"))
            val topic=idea.optString("topic").takeIf { it.isNotBlank() }?.let { " / $it" } ?: ""
            val model=idea.optString("model").takeIf { it.isNotBlank() }?.let { " / $it" } ?: ""
            lines.addAll(listOf("=".repeat(40),"${index+1}. ${idea.getString("name")}","원래 제목: ${idea.getString("title")}",
                "분야: ${idea.optString("category",idea.getString("categoryId"))}$topic","폴더: ${names[idea.getString("folderId")]}",
                "저장일: ${idea.getString("savedAt")}","생성 방식: ${source(idea.optString("source"))}$model",
                "단어: ${words.joinToString(" · ")}","조합 조건: ${idea.optString("condition").ifBlank { "없음" }}",
                "","[한 줄 소개]",idea.getString("one_liner"),"","[아이디어 설명]",idea.getString("description"),"","[작게 시작하는 방법]"))
            lines.addAll(strings(idea.getJSONArray("steps")).mapIndexed { i,s -> "${i+1}. $s" })
            idea.optJSONObject("word_links")?.let { links ->
                lines.addAll(listOf("","[세 단어의 연결]"))
                listOf("material","method","mood").forEachIndexed { i,key -> lines.add("${words[i]}: ${links.optString(key)}") }
            }
            if(idea.optString("what_changed").isNotBlank()) lines.addAll(listOf("","[다듬은 내용]",idea.getString("what_changed")))
            idea.optJSONObject("elaboration")?.let { d ->
                lines.addAll(listOf("","[구체화]","대상 사용자: ${d.getString("target_user")}","해결할 불편: ${d.getString("problem")}","핵심 가치: ${d.getString("value")}","핵심 기능:"))
                lines.addAll(strings(d.getJSONArray("core_features")).mapIndexed { i,s -> "${i+1}. $s" })
                lines.addAll(listOf("첫 프로토타입: ${d.getString("first_prototype")}","먼저 확인할 위험:"))
                lines.addAll(strings(d.getJSONArray("risks")).mapIndexed { i,s -> "${i+1}. $s" })
                val detailModel=idea.optString("elaborationModel").takeIf { it.isNotBlank() }?.let { " / $it" } ?: ""
                lines.add("구체화 생성 방식: ${source(idea.optString("elaborationSource"))}$detailModel")
            }
            lines.add("")
        }
        val result="\uFEFF"+lines.joinToString("\r\n")
        require(result.toByteArray(Charsets.UTF_8).size<=MAX_BYTES) { "백업은 10MB 이하여야 합니다. 보관함 크기를 확인해 주세요." }
        return result
    }
}
