package com.ideaassist.app

internal object GenerationFeedback {
    fun elapsedSeconds(startedAt: Long, now: Long) = ((now - startedAt).coerceAtLeast(0) / 1000)
    fun message(seconds: Long, cloud: Boolean): String = when {
        seconds >= 30 -> "응답이 아직 도착하지 않았어요. 더 기다리거나 취소할 수 있어요."
        seconds >= 10 -> if(cloud) "응답을 기다리는 중이에요. 제공업체 상황에 따라 더 걸릴 수 있어요." else "이 기기에서 작업을 진행 중이에요. 기기 성능에 따라 더 걸릴 수 있어요."
        cloud -> "AI 응답을 기다리고 있어요."
        else -> "이 기기에서 AI 작업을 진행하고 있어요."
    }
}
