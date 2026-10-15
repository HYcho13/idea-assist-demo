package com.ideaassist.app

/** JNI owns a reusable CPU model/context. All inference calls must run off the UI thread. */
class NativeLlm : AutoCloseable {
    companion object { init { System.loadLibrary("idea_llm") } }
    private val lifetime = Any()
    private var handle: Long = nativeCreate()
    @Volatile var ready: Boolean = false
        private set

    @Synchronized fun begin() = synchronized(lifetime) {
        check(handle != 0L) { "로컬 엔진이 종료되었습니다." }
        nativeReset(handle)
    }
    @Synchronized fun load(path: String, threads: Int) {
        check(handle != 0L)
        if (!ready) { nativeLoad(handle, path, threads); ready = true }
    }
    @Synchronized fun generate(prompt: String, grammar: String, maxTokens: Int,
                                progress: (String) -> Unit): String {
        check(ready) { "먼저 로컬 모델을 준비하세요." }
        return nativeGenerate(handle, prompt.toByteArray(Charsets.UTF_8),
            grammar.toByteArray(Charsets.UTF_8), maxTokens, progress).toString(Charsets.UTF_8)
    }
    fun cancel() = synchronized(lifetime) { if (handle != 0L) nativeCancel(handle) }
    @Synchronized override fun close() = synchronized(lifetime) {
        if (handle != 0L) { nativeDispose(handle); handle = 0L; ready = false }
    }
    private external fun nativeCreate(): Long
    private external fun nativeReset(handle: Long)
    private external fun nativeLoad(handle: Long, path: String, threads: Int)
    private external fun nativeGenerate(handle: Long, prompt: ByteArray, grammar: ByteArray,
                                        maxTokens: Int, progress: (String) -> Unit): ByteArray
    private external fun nativeCancel(handle: Long)
    private external fun nativeDispose(handle: Long)
}
