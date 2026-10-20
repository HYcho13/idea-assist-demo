package com.ideaassist.app

import org.json.JSONArray
import org.json.JSONObject
import java.net.URL
import javax.net.ssl.HttpsURLConnection

/** Fixed HTTPS endpoint; keys are headers only, never part of URLs or results. */
internal object GeminiApi {
    const val MODEL = "gemini-3.8-flash"
    const val ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/$MODEL:generateContent"
    const val MODEL_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/$MODEL"
    fun normalizeKey(value: String): String {
        val key=value.trim { it.isWhitespace() || it=='\u200b' || it=='\ufeff' }
        require(key.isNotEmpty()) { "Google AI Studio에서 복사한 전체 API 키를 입력하세요." }
        require(!Regex("^[\"'`]|[\"'`]$|^(?:Bearer\\s|(?:GEMINI_API_KEY|GOOGLE_API_KEY)\\s*=|x-goog-api-key\\s*:)",RegexOption.IGNORE_CASE).containsMatchIn(key)) { "따옴표·변수 이름·Bearer는 제외하고 API 키 값만 붙여넣으세요." }
        require(!Regex("\\*{2,}|…|\\.{3}|•").containsMatchIn(key)) { "가려진 키나 생략된 키는 사용할 수 없습니다. AI Studio의 복사 버튼으로 전체 키를 복사하세요." }
        require(key.length<=8192) { "API 키가 너무 깁니다. 키 값 외의 설명이나 코드를 함께 복사하지 않았는지 확인하세요." }
        require(key.all { it.code in 33..126 }) { "API 키 안에 공백·줄바꿈 또는 잘못된 문자가 있습니다. 전체 키를 다시 복사하세요." }
        return key
    }
    /** Explicit metadata-only check; no generation and no credential persistence. */
    fun verifyKey(value: String, onConnection: (HttpsURLConnection?) -> Unit = {}): String {
        val key=normalizeKey(value)
        val request=URL(MODEL_ENDPOINT).openConnection() as HttpsURLConnection
        request.instanceFollowRedirects=false; request.connectTimeout=15000; request.readTimeout=15000
        request.requestMethod="GET"; request.setRequestProperty("x-goog-api-key",key); request.useCaches=false
        onConnection(request)
        try {
            val code=request.responseCode
            fun read(stream: java.io.InputStream?): JSONObject?=stream?.use {
                val buffer=java.io.ByteArrayOutputStream(); val block=ByteArray(4096)
                while(true) { val count=it.read(block); if(count<0) break; check(buffer.size()+count<=64*1024) { "모델 정보가 너무 큽니다." }; buffer.write(block,0,count) }
                JSONObject(buffer.toString("UTF-8"))
            }
            if(code !in 200..299) error(errorMessage(code,runCatching { read(request.errorStream) }.getOrNull()))
            val payload=read(request.inputStream)
            check(payload?.optString("name")=="models/$MODEL" || payload?.optString("baseModelId")==MODEL) { "Google Gemini 모델 정보를 확인하지 못했습니다." }
            return "키 인증·모델 정보 조회 성공. 실제 생성과 사용량 한도는 별도 확인이 필요해요."
        } catch(error: IllegalStateException) { throw error }
        catch(error: Exception) { throw IllegalStateException("Google Gemini 연결 확인에 실패했습니다. 인터넷과 키 설정을 확인하세요.") }
        finally { request.disconnect(); onConnection(null) }
    }
    fun request(system: String, prompt: String, schema: JSONObject): JSONObject = JSONObject()
        .put("systemInstruction",JSONObject().put("parts",JSONArray().put(JSONObject().put("text",system))))
        .put("contents",JSONArray().put(JSONObject().put("role","user").put("parts",JSONArray().put(JSONObject().put("text",prompt)))))
        // TextResponseFormat.MimeType is an enum, not a literal MIME string.
        .put("generationConfig",JSONObject().put("thinkingConfig",JSONObject().put("thinkingLevel","low")).put("maxOutputTokens",4096).put("responseFormat",JSONObject().put("text",JSONObject().put("mimeType","APPLICATION_JSON").put("schema",schema))))
    /** Only fixed messages are returned. Provider bodies can echo keys or private input. */
    fun errorMessage(code: Int, payload: JSONObject? = null): String {
        val error=payload?.optJSONObject("error")
        val message=error?.optString("message").orEmpty().lowercase()
        val details=error?.optJSONArray("details")
        val reasons=(0 until (details?.length() ?: 0)).map { details?.optJSONObject(it)?.optString("reason") }
        val suffix=" (HTTP $code)."
        return when {
            "api key expired" in message -> "Google이 API 키 만료를 응답했습니다. AI Studio에서 키 상태를 확인하고 사용 가능한 전체 키를 다시 입력하세요. [API_KEY_INVALID]" + suffix
            "API_KEY_INVALID" in reasons || "api key not valid" in message -> "Google이 유효하지 않은 API 키로 거절했습니다. 전체 키 복사 여부와 AI Studio의 키 상태를 확인하세요. 코드 변경으로 키 인증을 우회할 수는 없습니다. [API_KEY_INVALID]" + suffix
            "reported as leaked" in message -> "Google Gemini가 노출된 키의 사용을 차단했습니다. AI Studio에서 새 키를 발급하고 기존 키를 폐기하세요." + suffix
            "SERVICE_DISABLED" in reasons -> "이 프로젝트에서 Gemini API가 비활성화돼 있습니다. Google Cloud에서 Generative Language API 설정을 확인하세요." + suffix
            reasons.any { it in listOf("API_KEY_SERVICE_BLOCKED","API_KEY_HTTP_REFERRER_BLOCKED","API_KEY_IP_ADDRESS_BLOCKED","API_KEY_ANDROID_APP_BLOCKED","API_KEY_IOS_APP_BLOCKED") } -> "Google Gemini 키의 API 또는 앱·웹 사용 제한이 현재 실행 환경과 맞지 않습니다. 키의 제한 설정을 확인하세요." + suffix
            "BILLING_DISABLED" in reasons || error?.optString("status")=="FAILED_PRECONDITION" -> "Google Gemini 계정·프로젝트의 사용 조건을 충족하지 못했습니다. 이용 지역, 무료 이용 대상과 결제 상태를 확인하세요." + suffix
            code==400 -> "Google Gemini 요청 형식 또는 모델 옵션이 거절됐습니다. 키 오류로 단정할 수 없습니다. 최신 앱인지 확인하세요." + suffix
            code==401 -> "Google Gemini 키 인증에 실패했습니다. 선택한 제공업체와 개인 키를 확인하세요." + suffix
            code==403 -> "Google Gemini 접근이 거부됐습니다. 키의 사용 제한과 프로젝트·API 권한을 확인하세요." + suffix
            code==404 -> "이 Google 프로젝트에서 Gemini 모델을 사용할 수 없습니다." + suffix
            code==429 -> "Google Gemini 요청 또는 사용량 한도를 초과했습니다." + suffix
            else -> "Google Gemini 요청 실패. 잠시 후 다시 시도하세요." + suffix
        }
    }
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
