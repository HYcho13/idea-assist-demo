#include <jni.h>
#include "llama.h"
#include <algorithm>
#include <atomic>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <string>
#include <vector>

namespace {
struct Engine {
    std::atomic<bool> cancelled{false};
    llama_model * model = nullptr;
    llama_context * context = nullptr;
    ~Engine() { if (context) llama_free(context); if (model) llama_model_free(model); }
};
Engine * engine(jlong h) { return reinterpret_cast<Engine *>(h); }
bool aborted(void * data) { return static_cast<Engine *>(data)->cancelled.load(); }
bool loading(float, void * data) { return !aborted(data); }
void check(Engine * e) { if (e->cancelled.load()) throw std::runtime_error("작업이 취소되었습니다."); }
void fail(JNIEnv * env, const char * message) {
    if (!env->ExceptionCheck()) env->ThrowNew(env->FindClass("java/lang/IllegalStateException"), message);
}
std::string bytes(JNIEnv * env, jbyteArray value) {
    std::string s(env->GetArrayLength(value), '\0');
    env->GetByteArrayRegion(value, 0, s.size(), reinterpret_cast<jbyte *>(s.data()));
    return s;
}
void progress(JNIEnv * env, jobject fn, int n) {
    std::string s = "로컬 AI 생성 중 · " + std::to_string(n) + " 토큰";
    // NewStringUTF is safe here: only ASCII + BMP Korean (output itself uses byte arrays).
    jstring msg = env->NewStringUTF(s.c_str());
    jclass cls = env->GetObjectClass(fn);
    jmethodID method = env->GetMethodID(cls, "invoke", "(Ljava/lang/Object;)Ljava/lang/Object;");
    if (!method) { env->DeleteLocalRef(msg); env->DeleteLocalRef(cls); throw std::runtime_error("진행 콜백 오류"); }
    jobject result = env->CallObjectMethod(fn, method, msg);
    if (result) env->DeleteLocalRef(result);
    env->DeleteLocalRef(msg); env->DeleteLocalRef(cls);
    if (env->ExceptionCheck()) throw std::runtime_error("진행 콜백 오류");
}
}
extern "C" JNIEXPORT jlong JNICALL
Java_com_ideaassist_app_NativeLlm_nativeCreate(JNIEnv * env, jobject) {
    try {
        static std::once_flag initialized;
        std::call_once(initialized, [] { llama_backend_init(); });
        return reinterpret_cast<jlong>(new Engine());
    } catch (...) { fail(env, "로컬 엔진 초기화에 실패했습니다."); return 0; }
}
extern "C" JNIEXPORT void JNICALL
Java_com_ideaassist_app_NativeLlm_nativeReset(JNIEnv *, jobject, jlong h) { engine(h)->cancelled.store(false); }
extern "C" JNIEXPORT void JNICALL
Java_com_ideaassist_app_NativeLlm_nativeCancel(JNIEnv *, jobject, jlong h) { engine(h)->cancelled.store(true); }
extern "C" JNIEXPORT void JNICALL
Java_com_ideaassist_app_NativeLlm_nativeDispose(JNIEnv *, jobject, jlong h) { delete engine(h); }
extern "C" JNIEXPORT void JNICALL
Java_com_ideaassist_app_NativeLlm_nativeLoad(JNIEnv * env, jobject, jlong h, jstring path, jint threads) {
    Engine * e = engine(h);
    try {
        check(e);
        if (e->model && e->context) return;
        const char * raw = env->GetStringUTFChars(path, nullptr);
        if (!raw) return;
        std::string file(raw);
        env->ReleaseStringUTFChars(path, raw);
        auto mp = llama_model_default_params();
        mp.n_gpu_layers = 0; mp.load_mode = LLAMA_LOAD_MODE_MMAP;
        mp.progress_callback = loading; mp.progress_callback_user_data = e;
        std::unique_ptr<llama_model, decltype(&llama_model_free)> model(
            llama_model_load_from_file(file.c_str(), mp), llama_model_free);
        check(e);
        if (!model) throw std::runtime_error("모델 로드 실패: 기기의 메모리와 GGUF 파일을 확인하세요.");
        auto cp = llama_context_default_params();
        cp.n_ctx = 3072; cp.n_batch = 256; cp.n_ubatch = 128;
        cp.n_threads = cp.n_threads_batch = std::clamp(static_cast<int>(threads), 1, 4);
        cp.flash_attn_type = LLAMA_FLASH_ATTN_TYPE_DISABLED;
        cp.abort_callback = aborted; cp.abort_callback_data = e;
        std::unique_ptr<llama_context, decltype(&llama_free)> context(
            llama_init_from_model(model.get(), cp), llama_free);
        check(e);
        if (!context) throw std::runtime_error("추론 컨텍스트를 만들 수 없습니다. 여유 메모리를 확인하세요.");
        e->model = model.release(); e->context = context.release();
    } catch (const std::exception & ex) { fail(env, ex.what()); }
}
extern "C" JNIEXPORT jbyteArray JNICALL
Java_com_ideaassist_app_NativeLlm_nativeGenerate(JNIEnv * env, jobject, jlong h,
    jbyteArray promptBytes, jbyteArray grammarBytes, jint maximum, jobject callback) {
    Engine * e = engine(h);
    try {
        check(e);
        if (!e->context) throw std::runtime_error("모델을 먼저 준비하세요.");
        const auto prompt = bytes(env, promptBytes), grammar = bytes(env, grammarBytes);
        const auto vocab = llama_model_get_vocab(e->model);
        int count = -llama_tokenize(vocab, prompt.data(), prompt.size(), nullptr, 0, true, true);
        int limit = std::clamp(static_cast<int>(maximum), 1, 1024);
        if (count <= 0 || count + limit > 3072) throw std::runtime_error("입력이 너무 깁니다. 조건이나 기존 아이디어를 줄여 주세요.");
        std::vector<llama_token> tokens(count);
        if (llama_tokenize(vocab, prompt.data(), prompt.size(), tokens.data(), count, true, true) != count)
            throw std::runtime_error("입력 토큰 변환 실패");
        llama_memory_clear(llama_get_memory(e->context), true);
        std::unique_ptr<llama_sampler, decltype(&llama_sampler_free)> sampler(
            llama_sampler_chain_init(llama_sampler_chain_default_params()), llama_sampler_free);
        auto constraint = llama_sampler_init_grammar(vocab, grammar.c_str(), "root");
        if (!sampler || !constraint) throw std::runtime_error("JSON 문법 초기화 실패");
        llama_sampler_chain_add(sampler.get(), constraint);
        llama_sampler_chain_add(sampler.get(), llama_sampler_init_penalties(llama_vocab_n_tokens(vocab), 128, 1.08f, 0.0f, 0.0f));
        llama_sampler_chain_add(sampler.get(), llama_sampler_init_top_k(20));
        llama_sampler_chain_add(sampler.get(), llama_sampler_init_top_p(0.8f, 1));
        llama_sampler_chain_add(sampler.get(), llama_sampler_init_temp(0.7f));
        llama_sampler_chain_add(sampler.get(), llama_sampler_init_dist(LLAMA_DEFAULT_SEED));
        for (int offset = 0; offset < count; offset += 256) {
            check(e);
            auto batch = llama_batch_get_one(tokens.data() + offset, std::min(256, count - offset));
            if (llama_decode(e->context, batch)) { check(e); throw std::runtime_error("입력 추론 실패"); }
        }
        std::string output;
        bool finished = false;
        for (int n = 0; n < limit; ++n) {
            check(e);
            llama_token token = llama_sampler_sample(sampler.get(), e->context, -1);
            if (llama_vocab_is_eog(vocab, token)) { finished = true; break; }
            char buffer[256];
            int size = llama_token_to_piece(vocab, token, buffer, sizeof(buffer), 0, false);
            if (size < 0) {
                std::vector<char> larger(-size);
                size = llama_token_to_piece(vocab, token, larger.data(), larger.size(), 0, false);
                if (size < 0) throw std::runtime_error("출력 토큰 변환 실패");
                output.append(larger.data(), size);
            } else output.append(buffer, size);
            if (output.size() > 32768) throw std::runtime_error("출력이 제한을 초과했습니다.");
            if ((n + 1) % 16 == 0) progress(env, callback, n + 1);
            // Grammar only permits a single root object; a closing final brace completes it.
            if (output.find_last_not_of(" \r\n\t") != std::string::npos && output[output.find_last_not_of(" \r\n\t")] == '}') {
                int depth = 0; bool quoted = false, escape = false;
                for (char c : output) {
                    if (quoted) { if (escape) escape = false; else if (c == '\\') escape = true; else if (c == '"') quoted = false; }
                    else if (c == '"') quoted = true;
                    else if (c == '{') ++depth;
                    else if (c == '}') --depth;
                }
                if (depth == 0 && !quoted) { finished = true; break; }
            }
            auto batch = llama_batch_get_one(&token, 1);
            if (llama_decode(e->context, batch)) { check(e); throw std::runtime_error("출력 추론 실패"); }
        }
        check(e);
        if (!finished) throw std::runtime_error("출력이 토큰 제한에 도달했습니다. 짧은 조건으로 다시 시도하세요.");
        jbyteArray result = env->NewByteArray(output.size());
        if (result) env->SetByteArrayRegion(result, 0, output.size(), reinterpret_cast<const jbyte *>(output.data()));
        return result;
    } catch (const std::exception & ex) { fail(env, ex.what()); return nullptr; }
}
