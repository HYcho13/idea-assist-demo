package com.ideaassist.app

import org.json.JSONArray
import org.json.JSONObject

/** Fixed HTTPS endpoint; keys are headers only, never part of URLs or results. */
internal object GeminiApi {
    const val MODEL = "gemini-3.8-flash"
    const val ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/$MODEL:generateContent"
    fun request(system: String, prompt: String, schema: JSONObject): JSONObject = JSONObject()
        .put("systemInstruction",JSONObject().put("parts",JSONArray().put(JSONObject().put("text",system))))
        .put("contents",JSONArray().put(JSONObject().put("role","user").put("parts",JSONArray().put(JSONObject().put("text",prompt)))))
        .put("generationConfig",JSONObject().put("maxOutputTokens",4096).put("responseFormat",JSONObject().put("text",JSONObject().put("mimeType","application/json").put("schema",schema))))
    fun parse(response: JSONObject): JSONObject {
        check(!response.has("error") && response.optJSONObject("promptFeedback")?.has("blockReason") != true) { "Google Gemini가 요청을 거절했습니다. 입력이나 계정 설정을 확인하세요." }
        val candidates=response.optJSONArray("candidates")
        val candidate=candidates?.optJSONObject(0)
        check(candidate != null && candidate.optString("finishReason")=="STOP") { "Google Gemini 응답이 끝까지 완성되지 않았습니다. 다시 시도하세요." }
        val parts=candidate.getJSONObject("content").getJSONArray("parts")
        val text=StringBuilder()
        repeat(parts.length()) { i ->
            val part=parts.getJSONObject(i)
            if(!part.optBoolean("thought")) { check(part.opt("text") is String) { "Google Gemini 응답 내용을 읽지 못했습니다." }; text.append(part.getString("text")) }
        }
        check(text.isNotBlank()) { "Google Gemini 응답에 텍스트가 없습니다." }
        return JSONObject(text.toString())
    }
}
