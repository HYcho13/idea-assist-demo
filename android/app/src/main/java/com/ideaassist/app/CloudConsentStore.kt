package com.ideaassist.app

import android.content.SharedPreferences

/** Only versioned/provider-specific acknowledgement; never stores API keys. */
internal class CloudConsentStore(private val preferences: SharedPreferences) {
    private fun key(provider: String): String {
        require(provider in listOf("openai","gemini")) { "AI 제공업체를 선택하세요." }
        return "consent-v1-$provider"
    }
    fun accepted(provider: String) = preferences.getBoolean(key(provider),false)
    fun save(provider: String, accepted: Boolean) {
        require(accepted) { "선택한 제공업체의 전송·API 비용 안내에 동의해 주세요." }
        check(preferences.edit().putBoolean(key(provider),true).commit()) { "동의 설정을 저장하지 못했습니다. 다시 시도하세요." }
    }
}
