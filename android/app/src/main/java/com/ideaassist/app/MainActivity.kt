package com.ideaassist.app

import android.app.Activity
import android.app.AlertDialog
import android.app.Dialog
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Typeface
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.os.Build
import android.os.Bundle
import android.text.Editable
import android.text.InputFilter
import android.text.InputType
import android.text.TextWatcher
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.AbsoluteSizeSpan
import android.text.style.ForegroundColorSpan
import android.text.style.StyleSpan
import android.view.Gravity
import android.view.View
import android.view.WindowInsets
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.*
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.util.UUID

/** Native Android Views only: no browser, WebView, localhost or JavaScript bridge. */
class MainActivity : Activity() {
    private lateinit var session: AppSession
    private lateinit var body: LinearLayout
    private lateinit var root: LinearLayout
    private var progressText: TextView? = null
    private var listener: ((String) -> Unit)? = null
    private val selectedCustom = linkedSetOf<String>()
    private var saveName = ""
    private var saveFolder = "default"
    private var pendingElaboration = false
    private var nameOptions = emptyList<String>()
    private var topicInput = ""
    private var selectedDirection: String? = null
    private var directionIdeaKey = ""
    internal var topicDialog: Dialog? = null
        private set
    internal var leaveDialog: Dialog? = null
        private set
    private var draftProvider = "openai"
    private var draftKey = ""
    private var draftConsent = false
    @Volatile private var keyCheckTicket=0
    @Volatile private var keyCheckConnection: javax.net.ssl.HttpsURLConnection?=null
    private var checkingKey=false
    private fun cancelKeyVerification() { keyCheckTicket++; keyCheckConnection?.disconnect(); keyCheckConnection=null; checkingKey=false }
    private val ink = ApplePalette.ink
    private val green = ApplePalette.accent
    private val paper = ApplePalette.background
    private val muted = ApplePalette.secondary

    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        session = AppSession.get(this)
        topicInput = session.topic
        listener = { event ->
            if (event == "progress") progressText?.text = session.status
            else {
                if (pendingElaboration && !session.busy && session.error.isBlank() && session.current?.has("elaboration") == true) {
                    session.screen = "elaborate"; pendingElaboration = false
                }
                render()
            }
        }
        session.listener = listener
        if (Build.VERSION.SDK_INT >= 33) onBackInvokedDispatcher.registerOnBackInvokedCallback(0) { back() }
        render()
    }
    override fun onDestroy() {
        cancelKeyVerification()
        topicDialog?.dismiss()
        leaveDialog?.dismiss()
        if (session.listener === listener) session.listener = null
        super.onDestroy()
    }
    @Deprecated("Android 13+ uses the registered callback")
    override fun onBackPressed() = back()
    private fun back() {
        if (leaveDialog?.isShowing == true) { leaveDialog?.cancel(); return }
        if (topicDialog?.isShowing == true) { topicDialog?.cancel(); return }
        if (session.busy) { session.cancel(); return }
        when (session.screen) {
            "cloud-key" -> go("settings")
            "settings" -> go(if (session.current != null) "result" else "home")
            "custom" -> go("words")
            "save", "elaborate" -> go("result")
            "home" -> guarded { finish() }
            else -> guarded { go("home") }
        }
    }
    private fun dp(n: Int) = (n * resources.displayMetrics.density).toInt()
    private fun shape(color: Int, radius: Int = 18): Drawable = GradientDrawable().apply {
        setColor(color); cornerRadius = dp(radius).toFloat()
    }
    private fun touchSurface(color: Int, radius: Int = 16): Drawable = RippleDrawable(
        ColorStateList.valueOf(if (color == green) Color.argb(60, 255, 255, 255) else Color.argb(28, 0, 102, 214)),
        shape(color, radius), shape(Color.WHITE, radius)
    )
    private fun label(text: String, size: Float = 15f, bold: Boolean = false, color: Int = ink) = TextView(this).apply {
        this.text = text; textSize = size; setTextColor(color)
        typeface = Typeface.create(if (bold) "sans-serif-medium" else "sans-serif", Typeface.NORMAL)
        includeFontPadding = false
        setLineSpacing(dp(2).toFloat(), 1.15f)
    }
    private fun column() = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
    private fun space(parent: LinearLayout = body, height: Int = 12) { parent.addView(View(this), LinearLayout.LayoutParams(1, dp(height))) }
    private fun titleLabel(title: String) = label(title, 32f, true).apply {
        // Medium is not Bold. Use one real bold face for every screen/dialog title.
        typeface = Typeface.create("sans-serif", Typeface.BOLD)
        letterSpacing = -.035f
        val height = android.util.TypedValue.applyDimension(android.util.TypedValue.COMPLEX_UNIT_SP, 41f, resources.displayMetrics).toInt()
        if (Build.VERSION.SDK_INT >= 28) { isFallbackLineSpacing = false; lineHeight = height }
        else setLineSpacing(height - (paint.fontMetricsInt.descent - paint.fontMetricsInt.ascent).toFloat(), 1f)
    }
    private fun heading(title: String, subtitle: String = "") {
        body.addView(titleLabel(title).apply {
            if (title.endsWith("?") || title.endsWith(".")) text = rich(Triple(title.dropLast(1),32,ink),Triple(title.takeLast(1),32,green))
        })
        if (subtitle.isNotBlank()) { space(height = 12); body.addView(label(subtitle, 14f, color = muted)) }; space(height = 24)
    }
    private fun button(parent: LinearLayout, title: String, primary: Boolean = false, action: () -> Unit): Button {
        val button = Button(this).apply {
            text = title; isAllCaps = false; textSize = 15f
            contentDescription = title
            stateListAnimator = null; elevation = 0f; backgroundTintList = null
            minimumWidth = 0; minWidth = 0; includeFontPadding = false
            setTextColor(if (primary) Color.WHITE else green)
            background = touchSurface(if (primary) green else Color.WHITE, 16)
            typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
            setPadding(dp(16), dp(12), dp(16), dp(12)); minHeight = dp(if (primary) 52 else 48)
            setOnClickListener { attempt(action) }
        }
        parent.addView(button, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(9) })
        return button
    }
    private fun textAction(parent: LinearLayout, title: String, action: () -> Unit) = button(parent, title, action = action).apply {
        background = touchSurface(Color.TRANSPARENT); textSize = 13f; minHeight = dp(44)
    }
    private fun outlined(color: Int, selected: Boolean, radius: Int = 20): Drawable {
        val surface = GradientDrawable().apply { setColor(color); cornerRadius = dp(radius).toFloat(); if (selected) setStroke(dp(2), green) }
        return RippleDrawable(ColorStateList.valueOf(Color.argb(28, 0, 102, 214)), surface, shape(Color.WHITE, radius))
    }
    private fun rich(vararg parts: Triple<String, Int, Int>): CharSequence = SpannableStringBuilder().apply {
        parts.forEach { (value, size, color) ->
            val start = length; append(value)
            setSpan(AbsoluteSizeSpan(size, true), start, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            setSpan(ForegroundColorSpan(color), start, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            if (size >= 17) setSpan(StyleSpan(Typeface.BOLD), start, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        }
    }
    private fun chips(parent: LinearLayout, values: List<Pair<String, Boolean>>, action: (Int) -> Unit) {
        val row = LinearLayout(this)
        values.forEachIndexed { i, (title, active) ->
            val chip = button(row, title, action = { action(i) }).apply {
                textSize = 12f; minHeight = dp(44); background = touchSurface(if (active) green else Color.WHITE, 12)
                setTextColor(if (active) Color.WHITE else green)
            }
            chip.layoutParams = LinearLayout.LayoutParams(-2, -2).apply { rightMargin = dp(8) }
        }
        parent.addView(HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; addView(row) }); space(parent, 12)
    }
    private fun wordTags(parent: LinearLayout = body, words: List<String> = session.words) {
        val row = LinearLayout(this)
        words.forEach { row.addView(label(it, 12f, true, green).apply { background = shape(ApplePalette.tint, 10); setPadding(dp(10), dp(7), dp(10), dp(7)) }, LinearLayout.LayoutParams(-2, -2).apply { rightMargin = dp(6) }) }
        parent.addView(row); space(parent, 18)
    }
    private fun field(parent: LinearLayout, title: String, value: String = "", max: Int = 80, changed: (String) -> Unit = {}): EditText {
        val fieldLabel = label(title, 13f, true)
        if (title.isNotBlank()) { parent.addView(fieldLabel); space(parent, 8) }
        return EditText(this).apply {
            id = View.generateViewId(); fieldLabel.labelFor = id; contentDescription = title
            setSingleLine(true); textSize = 16f; setTextColor(ink); setText(value)
            filters = arrayOf(InputFilter.LengthFilter(max)); background = shape(Color.WHITE, 12)
            setPadding(dp(14), dp(13), dp(14), dp(13)); minHeight = dp(52)
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) { changed(s?.toString().orEmpty()) }
                override fun afterTextChanged(s: Editable?) {}
            })
            parent.addView(this, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(12) })
        }
    }
    private fun card(title: String, content: String, parent: LinearLayout = body) {
        val box = column().apply { background = shape(Color.WHITE, 20); setPadding(dp(20), dp(16), dp(20), dp(16)) }
        box.addView(label(title, 13f, true, muted)); space(box, 10); box.addView(label(content, 15f).apply { setLineSpacing(0f, 1.65f); setTextIsSelectable(true) })
        parent.addView(box, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(12) })
    }
    private fun attempt(action: () -> Unit) {
        try { action() } catch (error: Exception) {
            val text = error.message ?: "작업을 완료하지 못했습니다."
            session.error = if (session.engine.apiKey.isBlank()) text else text.replace(session.engine.apiKey, "[키 숨김]")
            Toast.makeText(this, session.error, Toast.LENGTH_LONG).show()
        }
    }
    private fun persist() = session.persist()
    private fun go(screen: String) {
        if(session.screen=="cloud-key" && screen!="cloud-key") cancelKeyVerification()
        if(screen!="result") selectedDirection=null
        if(session.screen=="cloud-key" && screen!="cloud-key") draftKey=""
        session.screen = screen; session.error = ""; render()
    }
    private fun guarded(action: () -> Unit) {
        if (session.busy) { Toast.makeText(this, "작업을 완료하거나 취소한 뒤 이동해 주세요.", Toast.LENGTH_SHORT).show(); return }
        if (!session.dirty || session.current == null) { action(); return }
        showLeaveDialog(action)
    }
    private fun showLeaveDialog(action: () -> Unit) {
        if (leaveDialog?.isShowing == true) return
        val dialog=Dialog(this)
        val panel=column().apply { setPadding(dp(24),dp(28),dp(24),dp(16)); background=shape(paper,28) }
        val header=LinearLayout(this).apply { gravity=Gravity.CENTER_VERTICAL }
        header.addView(ImageView(this).apply {
            setImageDrawable(NavIcon(1,green)); background=shape(ApplePalette.tint,18); setPadding(dp(15),dp(15),dp(15),dp(15))
            importantForAccessibility=View.IMPORTANT_FOR_ACCESSIBILITY_NO
        },LinearLayout.LayoutParams(dp(56),dp(56)))
        header.addView(View(this),LinearLayout.LayoutParams(0,1,1f))
        button(header,"",action={ dialog.cancel() }).apply {
            contentDescription="대화상자 닫기"; background=touchSurface(Color.TRANSPARENT,12)
            setCompoundDrawables(NavIcon(10,muted).apply { setBounds(0,0,dp(20),dp(20)) },null,null,null)
            setPadding(dp(12),dp(12),dp(12),dp(12)); minHeight=dp(44); layoutParams=LinearLayout.LayoutParams(dp(44),dp(44))
        }
        panel.addView(header); space(panel,20)
        panel.addView(titleLabel("이 생각을\n저장할까요?")); space(panel,12)
        panel.addView(label("아직 보관함에 저장하지 않았어요.\n지금 내용을 저장하거나, 저장하지 않고 이동할 수 있어요.",14f,color=muted)); space(panel,24)
        button(panel,"저장하러 가기",true) { dialog.dismiss(); openSave() }
        button(panel,"저장하지 않고 이동") {
            val previous=session.current
            try { session.current=null; session.dirty=false; persist() }
            catch(error: Exception) { session.current=previous; session.dirty=true; throw error }
            dialog.dismiss(); action()
        }.apply { setTextColor(Color.rgb(165,40,34)); background=outlined(Color.WHITE,false,16) }
        textAction(panel,"계속 다듬기") { dialog.cancel() }
        val scroll=ScrollView(this).apply { addView(panel) }
        dialog.setContentView(scroll); dialog.setCanceledOnTouchOutside(true)
        dialog.setOnDismissListener { if(leaveDialog===dialog) leaveDialog=null }
        leaveDialog=dialog
        dialog.window?.apply { setBackgroundDrawableResource(android.R.color.transparent); addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND); setDimAmount(.34f) }
        dialog.show()
        val width=minOf(resources.displayMetrics.widthPixels-dp(24),dp(420))
        scroll.measure(View.MeasureSpec.makeMeasureSpec(width,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(0,View.MeasureSpec.UNSPECIFIED))
        dialog.window?.setLayout(width,minOf(scroll.measuredHeight,(resources.displayMetrics.heightPixels*.85f).toInt()))
    }
    private fun modeLabel() = when (session.engine.mode) { "cloud" -> if(session.engine.cloudProvider=="gemini") "Google Gemini" else "OpenAI"; "demo" -> "규칙 시연"; else -> "기기 내 AI · 실험" }
    private fun sourceLabel(value: String) = when (value) {
        "native-llama" -> "실제 기기 내 AI · ${AiEngine.MODEL_LABEL}"
        "cloud" -> "실제 클라우드 AI · OpenAI"
        "gemini" -> "실제 클라우드 AI · Google Gemini"
        "rules", "local" -> "규칙 기반 시연 · AI 추론 아님"
        "webllm" -> "실제 웹 온디바이스 AI"
        else -> "출처 미확인 결과"
    }

    private fun render() {
        root = column().apply { setBackgroundColor(paper) }
        val header = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL; setPadding(dp(24), dp(12), dp(24), dp(8)) }
        val stage = mapOf("home" to "홈", "words" to "단어 조합", "custom" to "내 단어", "result" to "아이디어", "elaborate" to "구체화", "save" to "저장", "saved" to "저장 완료", "archive" to "보관함", "settings" to "생성 방식", "cloud-key" to "개인 API 키")
        header.addView(label(if (session.busy) "생성 중" else stage[session.screen] ?: "홈", 12f, color = muted), LinearLayout.LayoutParams(0, -2, 1f))
        val mode = Button(this).apply {
            contentDescription="모델 설정"
            text = "모델 설정  ⚙"; textSize = 12f; isAllCaps = false; setTextColor(green)
            stateListAnimator = null; elevation = 0f; backgroundTintList = null; includeFontPadding = false; minWidth = 0; minimumWidth = 0
            background = touchSurface(ApplePalette.tint, 22); isEnabled = !session.busy
            setPadding(dp(12), dp(8), dp(12), dp(8)); minHeight = dp(44); maxWidth = dp(160)
            setOnClickListener { go("settings") }
        }
        header.addView(mode, LinearLayout.LayoutParams(-2, -2)); root.addView(header)
        val scroll = ScrollView(this).apply { isFillViewport = true; clipToPadding = false }
        body = column().apply { setPadding(dp(24), dp(18), dp(24), dp(32)) }
        scroll.addView(body); root.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
        progressText = null
        if (session.busy) {
            heading("새로운 연결을\n찾고 있어요", "실제 모델 추론은 기기 성능에 따라 시간이 걸립니다.")
            body.addView(ProgressBar(this)); space()
            progressText = label(session.status, 15f).also { body.addView(it) }
            button(body, "작업 취소") { session.cancel() }
        } else {
            when (session.screen) {
                "words" -> wordsScreen()
                "custom" -> customScreen()
                "result" -> resultScreen()
                "elaborate" -> elaborateScreen()
                "save" -> saveScreen()
                "saved" -> savedScreen()
                "archive" -> archiveScreen()
                "settings" -> settingsScreen()
                "cloud-key" -> cloudKeyScreen()
                else -> homeScreen()
            }
            if (session.error.isNotBlank()) card("작업을 확인해 주세요", session.error)
        }
        root.addView(tabBar())
        setContentView(root)
        root.setOnApplyWindowInsetsListener { _, inset ->
            if (Build.VERSION.SDK_INT >= 30) {
                val bars = inset.getInsets(WindowInsets.Type.systemBars())
                root.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            } else root.setPadding(0, inset.systemWindowInsetTop, 0, inset.systemWindowInsetBottom)
            inset
        }
        root.requestApplyInsets()
    }
    private fun tabBar(): LinearLayout {
        val bar = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL; setPadding(dp(16), dp(7), dp(16), dp(7)); clipChildren = false; clipToPadding = false
            background = shape(Color.argb(245, 255, 255, 255), 0); minimumHeight = dp(82)
        }
        fun tab(text: String, kind: Int, action: () -> Unit) {
            val item = Button(this).apply {
                val active = if (kind == 0) session.screen == "home" else session.screen == "archive"
                this.text = text; isAllCaps = false; textSize = 12f; setTextColor(if (active) green else muted)
                stateListAnimator = null; elevation = 0f; backgroundTintList = null; includeFontPadding = false; minWidth = 0; minimumWidth = 0
                minHeight = dp(64); setPadding(dp(4), dp(8), dp(4), dp(8))
                isSelected = active
                background = touchSurface(Color.TRANSPARENT, 14)
                val icon = NavIcon(kind, if (active) green else muted, if(kind==1) records().size else 0).apply { setBounds(0, 0, dp(24), dp(24)) }
                setCompoundDrawables(null, icon, null, null); compoundDrawablePadding = dp(3)
                isEnabled = !session.busy; setOnClickListener { guarded(action) }
            }
            bar.addView(item, LinearLayout.LayoutParams(0, -2, 1f))
        }
        tab("홈", 0) { go("home") }
        val center = column().apply { gravity = Gravity.CENTER; clipChildren = false }
        val plus = Button(this).apply {
            text = "+"; textSize = 32f; setTextColor(Color.WHITE)
            stateListAnimator = null; elevation = 0f; backgroundTintList = null; includeFontPadding = false
            minWidth = 0; minimumWidth = 0; minHeight = 0; minimumHeight = 0; setPadding(0, 0, 0, 0)
            background = RippleDrawable(ColorStateList.valueOf(Color.argb(60,255,255,255)), GradientDrawable().apply { setColor(green); cornerRadius = dp(32).toFloat(); setStroke(dp(5), paper) }, shape(Color.WHITE, 32))
            setTextSize(android.util.TypedValue.COMPLEX_UNIT_DIP, 32f)
            contentDescription = "새 아이디어 주제 선택"; isEnabled = !session.busy
            setOnClickListener { showTopicPicker() }
        }
        center.addView(plus, LinearLayout.LayoutParams(dp(64), dp(64)))
        center.addView(label("새 아이디어", 11f, color = muted).apply { gravity=Gravity.CENTER; textAlignment=View.TEXT_ALIGNMENT_CENTER },LinearLayout.LayoutParams(-1,-2).apply { topMargin=dp(4) })
        center.translationY = -dp(12).toFloat()
        bar.addView(center, LinearLayout.LayoutParams(0, -2, 1f))
        tab("보관함", 1) { session.filter = "all"; go("archive") }
        return bar
    }
    private fun homeScreen() {
        heading("어떤 아이디어를\n만들어 볼까요?", "주제·분야를 직접 적거나 아래에서 골라보세요.")
        val topicBox=column().apply { background=shape(Color.WHITE,20); setPadding(dp(18),dp(18),dp(18),dp(18)) }
        field(topicBox,"나만의 주제·분야",topicInput,80) { topicInput=it }.apply { hint="예: 반려동물과 함께하는 여행"; background=outlined(paper,false,12) }
        topicBox.addView(label("공통 단어 3개를 뽑고, 입력한 주제 안에서 연결해요. 단어도 바꿀 수 있어요.",12f,color=muted)); space(topicBox)
        button(topicBox,"입력한 주제로 시작하기",true) { val value=DemoDomain.topic(topicInput); guarded { start("custom",value) } }
        body.addView(topicBox); space(height=24); body.addView(label("또는 추천 분야 선택",13f,true,muted)); space()
        val descriptions = listOf("새로운 메뉴와 맛있는 경험", "일상을 바꾸는 앱과 서비스", "우리 주변 문제를 새롭게 해결")
        DemoDomain.categoryIds.forEachIndexed { index, id ->
            val selected = session.categoryId == id
            button(body, DemoDomain.categoryNames[index]) {
                session.categoryId = id; render()
            }.apply {
                gravity = Gravity.CENTER_VERTICAL or Gravity.START; minHeight = dp(80)
                text = rich(Triple(DemoDomain.categoryNames[index] + "\n", 17, ink), Triple(descriptions[index], 12, muted))
                setLineSpacing(dp(5).toFloat(), 1f)
                background = outlined(Color.WHITE, selected)
                val icon = CategoryIcon(index).apply { setBounds(0, 0, dp(46), dp(46)) }
                val check = MarkIcon(if (selected) "✓" else "›", if (selected) green else muted).apply { setBounds(0,0,dp(20),dp(24)) }
                setCompoundDrawables(icon, null, check, null); compoundDrawablePadding = dp(12)
                isSelected = selected
                contentDescription = DemoDomain.categoryNames[index] + if (selected) " 선택됨" else ""
            }
        }
        space(height = 24); button(body, "선택하고 시작하기", true) { guarded { start(session.categoryId) } }.isEnabled = session.categoryId in DemoDomain.categoryIds
        body.addView(label("+  아래 +를 눌러 주제를 고르고 단어를 조합해요.", 12f, color = muted).apply { gravity = Gravity.CENTER })
        if (session.words.size == 3) { space(); textAction(body, "이전에 고른 단어 이어보기 →") { go("words") } }
    }
    private fun start(id: String, topic: String = "") {
        session.categoryId = id; session.topic = topic; session.locks.clear()
        session.words = DemoDomain.draw(id, emptyList(), emptySet(), emptyList(), false)
        session.condition = listOf("기존 재료와 도구로 작게 시작하기", "일주일 안에 작은 시제품 시험하기", "처음 보는 사람도 쉽게 이해할 수 있게 만들기", "한 사람이 혼자서도 사용할 수 있게 만들기").random()
        session.current = null; session.prior = null; session.dirty = false; session.screen = "words"
        persist(); render()
    }
    private fun showTopicPicker() {
        if (session.busy || topicDialog?.isShowing == true) return
        val dialog=Dialog(this)
        val panel=column().apply { setPadding(dp(24),dp(28),dp(24),dp(16)); background=shape(paper,28) }
        val scroll=ScrollView(this).apply { isFillViewport=false; addView(panel) }
        var draft=""
        fun choose(id: String, topic: String="") {
            dialog.dismiss()
            guarded { start(id,topic) }
        }
        lateinit var showChoices: () -> Unit
        fun iconButton(parent: LinearLayout, kind: Int, description: String, action: () -> Unit): Button = button(parent,"",action=action).apply {
            contentDescription=description; text=""; background=touchSurface(Color.TRANSPARENT,12)
            val icon=NavIcon(kind,muted).apply { setBounds(0,0,dp(20),dp(20)) }
            setCompoundDrawables(icon,null,null,null); setPadding(dp(12),dp(12),dp(12),dp(12))
            layoutParams=LinearLayout.LayoutParams(dp(44),dp(44)); minHeight=dp(44)
        }
        fun toolbar(back: (() -> Unit)? = null) {
            val row=LinearLayout(this).apply { gravity=Gravity.CENTER_VERTICAL }
            if(back!=null) iconButton(row,7,"선택지로 돌아가기",back)
            row.addView(View(this),LinearLayout.LayoutParams(0,1,1f))
            iconButton(row,10,"대화상자 닫기") { dialog.cancel() }
            panel.addView(row)
        }
        fun showInput() {
            panel.removeAllViews()
            toolbar {
                (getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager).hideSoftInputFromWindow(panel.windowToken,0)
                showChoices()
            }
            panel.addView(titleLabel("나만의 주제를 적어주세요")); space(panel,20)
            val counter=label("${draft.length}/80",12f,color=muted).apply { gravity=Gravity.END }
            val failure=label("",13f,color=Color.rgb(158,48,34)).apply { visibility=View.GONE }
            val field=field(panel,"주제·분야",draft,80) { value ->
                draft=value; counter.text="${value.length}/80"; failure.visibility=View.GONE
            }.apply {
                hint="예: 반려동물과 함께하는 여행"
                imeOptions=EditorInfo.IME_ACTION_GO
            }
            panel.addView(label("1~80자로 적어주세요. 입력한 주제 안에서 세 단어를 연결해요.",13f,color=muted)); space(panel,8)
            panel.addView(counter); space(panel,12); panel.addView(failure)
            val generate=button(panel,"단어 조합으로 이동",true) {
                try { choose("custom",DemoDomain.topic(draft)) }
                catch (error: IllegalArgumentException) { failure.text="주제·분야를 1~80자로 입력해 주세요."; failure.visibility=View.VISIBLE }
            }.apply { isEnabled=draft.isNotBlank() }
            field.addTextChangedListener(object: TextWatcher {
                override fun beforeTextChanged(s: CharSequence?,start: Int,count: Int,after: Int) {}
                override fun onTextChanged(s: CharSequence?,start: Int,before: Int,count: Int) { generate.isEnabled=!s.isNullOrBlank() }
                override fun afterTextChanged(s: Editable?) {}
            })
            field.setOnEditorActionListener { _,action,_ ->
                if(action==EditorInfo.IME_ACTION_GO) { if(generate.isEnabled) generate.performClick(); true } else false
            }
            button(panel,"취소") { dialog.cancel() }
            field.requestFocus()
            field.post { if(dialog.isShowing) (getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager).showSoftInput(field,InputMethodManager.SHOW_IMPLICIT) }
        }
        showChoices={
            panel.removeAllViews()
            val header=LinearLayout(this).apply { gravity=Gravity.TOP }
            header.addView(titleLabel("어떤 주제로 만들까요?"),LinearLayout.LayoutParams(0,-2,1f))
            iconButton(header,10,"대화상자 닫기") { dialog.cancel() }
            panel.addView(header); space(panel,12)
            panel.addView(label("주제를 고른 뒤 단어 조합을 확인하고 아이디어를 만들어요.",14f,color=muted)); space(panel,20)
            val descriptions=listOf("새로운 메뉴와 맛있는 경험","일상을 바꾸는 앱과 서비스","우리 주변 문제를 새롭게 해결","원하는 주제·분야를 자유롭게 작성")
            fun choice(index: Int,title: String, action: () -> Unit) {
                button(panel,title,action=action).apply {
                    text=rich(Triple(title+"\n",15,ink),Triple(descriptions[index],12,muted))
                    minHeight=dp(76); gravity=Gravity.START or Gravity.CENTER_VERTICAL; setLineSpacing(dp(4).toFloat(),1.2f)
                    setPadding(dp(16),dp(16),dp(16),dp(16)); background=touchSurface(Color.WHITE,18)
                    val icon: Drawable=if(index==1) MarkIcon("⌘",green) else NavIcon(if(index==0)2 else if(index==2)4 else 9,green)
                    icon.setBounds(0,0,dp(28),dp(28))
                    val chevron=NavIcon(8,muted).apply { setBounds(0,0,dp(18),dp(18)) }
                    setCompoundDrawables(icon,null,chevron,null); compoundDrawablePadding=dp(12)
                }
            }
            DemoDomain.categoryIds.forEachIndexed { index,id ->
                choice(index,DemoDomain.categoryNames[index]) { choose(id) }
            }
            choice(3,"직접 입력") { showInput() }
            space(panel,8); button(panel,"취소") { dialog.cancel() }
        }
        dialog.setContentView(scroll)
        dialog.setCanceledOnTouchOutside(true)
        dialog.setOnDismissListener { if(topicDialog===dialog) topicDialog=null }
        showChoices(); topicDialog=dialog
        dialog.window?.apply {
            setBackgroundDrawableResource(android.R.color.transparent)
            addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)
            setDimAmount(.34f)
            setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        }
        dialog.show()
        dialog.window?.setLayout(minOf(resources.displayMetrics.widthPixels-dp(24),dp(480)),WindowManager.LayoutParams.WRAP_CONTENT)
    }
    private fun wordsScreen() {
        body.addView(label(DemoDomain.categoryName(session.categoryId,session.topic), 12f, true, muted)); space(height = 8)
        heading("뜻밖의 세 단어를\n조합해 보세요.", "마음에 드는 단어는 최대 2개까지 고정해요.")
        val row = LinearLayout(this)
        session.words.forEachIndexed { i, word ->
            val item = column().apply { gravity = Gravity.CENTER; background = touchSurface(if (i in session.locks) ApplePalette.tint else Color.WHITE, 20); setPadding(dp(5), dp(18), dp(5), dp(18)); minimumHeight = dp(144) }
            item.background = outlined(if (i in session.locks) ApplePalette.tint else Color.WHITE, i in session.locks)
            item.addView(label(DemoDomain.roles[i], 12f, color = muted)); space(item, 16); item.addView(label(word, 21f, true)); space(item, 16)
            item.addView(label(if (i in session.locks) "고정됨" else "터치해서 고정", 10f, color = green))
            item.contentDescription = "$word ${if (i in session.locks) "고정 해제" else "고정"}"
            item.setOnClickListener {
                if (i in session.locks) session.locks.remove(i)
                else if (session.locks.size < 2) session.locks.add(i)
                else Toast.makeText(this, "최대 2개까지 고정할 수 있어요.", Toast.LENGTH_SHORT).show()
                attempt { persist(); render() }
            }
            row.addView(item, LinearLayout.LayoutParams(0, -2, 1f).apply { if (i < 2) rightMargin = dp(8) })
        }
        body.addView(row); space()
        val condition = column().apply { background = shape(ApplePalette.tint,16); setPadding(dp(15),dp(15),dp(15),dp(15)) }
        condition.addView(label("이번 조합의 조건",11f,color=muted)); space(condition,6); condition.addView(label(session.condition,13f)); body.addView(condition); space()
        button(body, "다시 뽑기") {
            session.words = DemoDomain.draw(session.categoryId, session.words, session.locks, emptyList(), false)
            persist(); render()
        }
        textAction(body, "+ 내 단어 추가하기") { selectedCustom.clear(); go("custom") }
        space(); button(body, "이 조합으로 창조하기", true) { generate() }
        body.addView(label(modeLabel() + " · 오류 시 임의 결과로 자동 대체하지 않습니다.", 12f, color = muted))
    }
    private fun generate(type: String = "generate", direction: String? = null) {
        pendingElaboration = type == "elaborate"
        session.generate(type, direction)
        if (!session.busy && session.error.isNotBlank()) {
            AlertDialog.Builder(this).setTitle("AI 준비가 필요해요").setMessage(session.error)
                .setPositiveButton("AI 설정 열기") { _, _ -> go("settings") }.setNegativeButton("돌아가기", null).show()
        }
    }
    private fun customScreen() {
        textAction(body, "‹ 단어 조합") { go("words") }
        heading("내 단어를\n더해 보세요.", "1~2개를 고르면 나머지는 무작위로 채워요.")
        val input = field(body, "새 단어 · 최대 12자", max = 12)
        button(body, "단어 추가") {
            val word = DemoDomain.normalize(input.text.toString())
            require(word.isNotEmpty() && word.length <= 12) { "1~12자의 단어를 입력해 주세요." }
            val existing = session.customWords(); require(word !in existing) { "이미 추가한 단어입니다. 목록에서 선택해 주세요." }
            require(existing.size < 10) { "내 단어는 최대 10개입니다." }
            session.library.put("customWords", JSONArray(existing + word)); if (selectedCustom.size < 2) selectedCustom.add(word)
            persist(); render()
        }
        body.addView(label("내 단어 ${session.customWords().size}/10 · ${selectedCustom.size}/2 선택", 12f, color = muted))
        session.customWords().forEach { word -> button(body, (if (word in selectedCustom) "☑  " else "□  ") + word) {
            if (word in selectedCustom) selectedCustom.remove(word) else { require(selectedCustom.size < 2) { "최대 2개만 선택할 수 있어요." }; selectedCustom.add(word) }; render()
        }.apply { gravity=Gravity.START or Gravity.CENTER_VERTICAL; background=outlined(Color.WHITE,word in selectedCustom,14) } }
        button(body, "선택한 단어 적용하기", true) {
            require(selectedCustom.isNotEmpty()) { "단어를 먼저 선택해 주세요." }
            val selected = selectedCustom.toList(); val locked = selected.indices.toSet()
            session.words = DemoDomain.draw(session.categoryId, selected + List(3 - selected.size) { "" }, locked, emptyList(), false)
            session.locks.clear(); session.locks.addAll(locked); persist(); go("words")
        }
    }
    private fun resultScreen() {
        val idea = session.current ?: run { homeScreen(); return }
        body.addView(label(sourceLabel(idea.optString("source")), 11f, color = muted)); space(height = 12)
        heading(idea.optString("name", idea.optString("title")), idea.optString("one_liner"))
        wordTags()
        val content = column().apply { background = shape(Color.WHITE,20); setPadding(dp(20),dp(20),dp(20),dp(20)) }
        content.addView(label("아이디어 설명",13f,true,muted)); space(content,10)
        content.addView(label(idea.optString("description"),15f).apply { setLineSpacing(0f,1.65f); setTextIsSelectable(true) }); space(content,20)
        content.addView(label("작게 시작하는 방법",13f,true,muted)); space(content,12)
        val steps = idea.getJSONArray("steps")
        for (i in 0 until steps.length()) {
            val row = LinearLayout(this).apply { gravity = Gravity.TOP }
            row.addView(label("${i+1}",12f,true,green).apply { gravity = Gravity.CENTER; background = shape(ApplePalette.tint,12) }, LinearLayout.LayoutParams(dp(24),dp(24)))
            row.addView(label(steps.getString(i),14f).apply { setLineSpacing(0f,1.5f) },LinearLayout.LayoutParams(0,-2,1f).apply { leftMargin=dp(10) })
            content.addView(row); space(content,12)
        }
        body.addView(content); space()
        if (idea.has("what_changed")) card("달라진 점", idea.optString("what_changed"))
        session.prior?.let { previous -> button(body, "이전 버전으로 되돌리기") {
            session.current = previous; session.prior = null
            session.dirty = !records().any { it.optString("id") == previous.optString("id") && it.optInt("revision") == previous.optInt("revision") }
            persist(); render()
        } }
        body.addView(label("어떤 방향으로 다듬을까요?", 16f, true))
        space()
        val captions = listOf("새로운 관점을 더해서", "실행하기 쉬운 방향으로", "즐거운 경험을 더해서", "완성도와 가치를 높여서")
        val key=idea.optString("id")+":"+idea.optInt("revision",1)
        if(directionIdeaKey!=key) { selectedDirection=null; directionIdeaKey=key }
        val directionButtons=mutableListOf<Pair<String,Button>>()
        val confirmation=column().apply { visibility=if(selectedDirection==null) View.GONE else View.VISIBLE }
        DemoDomain.directions.chunked(2).forEachIndexed { rowIndex, entries ->
            val row = LinearLayout(this)
            entries.forEachIndexed { col, (id,title) ->
                val item = button(row,title) {
                    selectedDirection=id
                    directionButtons.forEach { (choice,view) -> view.isSelected=choice==id; view.background=outlined(Color.WHITE,choice==id,16) }
                    confirmation.visibility=View.VISIBLE
                }.apply {
                    text = rich(Triple(title+"\n",14,ink),Triple(captions[rowIndex*2+col],11,muted)); minHeight=dp(82); setLineSpacing(dp(6).toFloat(),1f)
                    isSelected=selectedDirection==id; background=outlined(Color.WHITE,selectedDirection==id,16)
                }
                directionButtons.add(id to item)
                item.layoutParams=LinearLayout.LayoutParams(0,-2,1f).apply { bottomMargin=dp(9); if(col==0)rightMargin=dp(9) }
            }; body.addView(row)
        }
        button(confirmation,"이 방식으로 다듬기",true) { selectedDirection?.let { generate("develop",it) } }
        body.addView(confirmation)
        space()
        button(body, "이 아이디어 저장하기", true) { openSave() }
        button(body, if (idea.has("elaboration")) "구체화 내용 보기" else "한 걸음 더 구체화하기") {
            if (idea.has("elaboration")) go("elaborate") else generate("elaborate")
        }
        textAction(body, "같은 단어로 다시 만들기") { guarded { generate() } }
        textAction(body, "현재 결과 복사하기") {
            (getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("아이디어", idea.toString(2)))
            Toast.makeText(this, "결과를 복사했습니다.", Toast.LENGTH_SHORT).show()
        }
    }
    private fun arrayText(values: JSONArray) = (0 until values.length()).joinToString("\n\n") { "${it + 1}. ${values.getString(it)}" }
    private fun elaborateScreen() {
        val idea = session.current; val detail = idea?.optJSONObject("elaboration") ?: run { resultScreen(); return }
        textAction(body, "‹ 결과") { go("result") }
        body.addView(label(sourceLabel(idea.optString("elaborationSource")), 12f, true, green))
        heading("아이디어를\n한 걸음 더", idea.optString("title"))
        wordTags()
        listOf("target_user" to "누구를 위한 아이디어인가", "problem" to "어떤 불편을 해결하나", "value" to "이 조합의 가치").forEach { (key, name) -> card(name, detail.getString(key)) }
        card("핵심 기능 3개", arrayText(detail.getJSONArray("core_features")))
        card("첫 프로토타입", detail.getString("first_prototype")); card("먼저 확인할 위험", arrayText(detail.getJSONArray("risks")))
        body.addView(label("아이디어 초안입니다. 실제 필요와 실행 조건은 직접 확인해 주세요.", 12f, color = muted))
        button(body, "구체화한 아이디어 저장하기", true) { openSave() }
    }
    private fun openSave() {
        val idea = session.current ?: return
        saveName = idea.optString("name").ifBlank { records().firstOrNull { it.optString("id")==idea.optString("id") }?.optString("name").orEmpty() }.ifBlank { AppStore.nextIdeaName(session.library.getJSONArray("ideas")) }; saveFolder = idea.optString("folderId", "default"); nameOptions = emptyList(); go("save")
    }
    private fun folders() = session.library.getJSONArray("folders").let { a -> (0 until a.length()).map { a.getJSONObject(it) } }
    private fun records() = session.library.getJSONArray("ideas").let { a -> (0 until a.length()).map { a.getJSONObject(it) } }
    private fun saveScreen() {
        textAction(body, "‹ 결과") { go("result") }
        heading("생각을\n담아두세요", "이름과 폴더를 정해 이 기기에 저장합니다.")
        field(body, "아이디어 이름", saveName) { saveName = it }
        body.addView(label("이름 조합 제안 · 간편 규칙 방식", 12f, color = muted)); space()
        val first = session.words.first(); val mood = session.words.last()
        chips(body,listOf("담백하게","귀엽게","힙하게").map { it to false }) { i ->
            nameOptions = when(i) { 0 -> listOf("$first 한 장","$mood 노트","$first 연결"); 1 -> listOf("${first}몽","$mood 소풍","작은 $first"); else -> listOf("$first LAB","$mood WAVE","$first STUDIO") }; render()
        }
        if(nameOptions.isNotEmpty()) chips(body,nameOptions.map { it to (saveName==it) }) { saveName=nameOptions[it]; render() }
        body.addView(label("저장 폴더", 13f, true,muted)); space()
        folders().forEach { folder -> button(body, "▱  " + folder.getString("name") + if(saveFolder==folder.getString("id")) "   ✓" else "") { saveFolder = folder.getString("id"); render() }.apply { gravity=Gravity.START or Gravity.CENTER_VERTICAL; background=outlined(if(saveFolder==folder.getString("id"))ApplePalette.tint else Color.WHITE,saveFolder==folder.getString("id"),14) } }
        val folderRow=LinearLayout(this).apply { gravity=Gravity.CENTER_VERTICAL }
        val inputBox=column(); val newName = field(inputBox, "", max = 30).apply { hint="새 폴더 이름"; contentDescription="새 폴더 이름" }
        folderRow.addView(inputBox,LinearLayout.LayoutParams(0,-2,1f))
        val addFolder=button(folderRow, "+ 폴더") {
            val name = DemoDomain.normalize(newName.text.toString()); require(name.isNotBlank()) { "폴더 이름을 입력하세요." }
            require(folders().size < 30 && folders().none { it.getString("name") == name }) { "중복 폴더이거나 최대 개수에 도달했습니다." }
            saveFolder = UUID.randomUUID().toString()
            session.library.getJSONArray("folders").put(JSONObject().put("id", saveFolder).put("name", name)); persist(); render()
        }
        addFolder.layoutParams=LinearLayout.LayoutParams(-2,-2).apply { leftMargin=dp(8) }; body.addView(folderRow); space()
        button(body, "저장하기", true) {
            val name = DemoDomain.normalize(saveName); require(name.isNotBlank() && name.length <= 80) { "1~80자의 이름을 입력하세요." }
            val record = AppStore.cleanIdea(session.current!!).put("name", name).put("folderId", saveFolder).put("savedAt", Instant.now().toString())
            val previous = session.library; val next = JSONObject(previous.toString()).put("ideas", JSONArray(listOf(record) + records().filter { it.getString("id") != record.getString("id") }))
            session.store.write(next); session.library = next; session.current = record; session.dirty = false; persist(); go("saved")
            Toast.makeText(this, "이 기기에 저장했습니다.", Toast.LENGTH_SHORT).show()
        }
    }
    private fun savedScreen() {
        space(height=40)
        body.addView(label("✓",38f,true,green).apply { gravity=Gravity.CENTER; background=shape(ApplePalette.tint,40) },LinearLayout.LayoutParams(dp(80),dp(80)).apply { gravity=Gravity.CENTER_HORIZONTAL })
        space(height=28); heading("생각 하나를\n담았어요.","${session.current?.optString("name").orEmpty()}\n앱을 다시 열어도 이 기기에서 볼 수 있어요.")
        button(body,"보관함에서 확인하기",true) { session.filter=saveFolder; go("archive") }
        button(body,"새 아이디어 만들기") { showTopicPicker() }
    }
    private fun archiveScreen() {
        heading("모아둔 생각들.", "저장한 아이디어 ${records().size}개 · 이 기기의 앱에 보관")
        val tools = LinearLayout(this).apply { gravity=Gravity.END }
        val export=textAction(tools, "↓ 백업") { startActivityForResult(Intent(Intent.ACTION_CREATE_DOCUMENT).apply { addCategory(Intent.CATEGORY_OPENABLE); type = "text/plain"; putExtra(Intent.EXTRA_TITLE, "아이디어-보관함-백업.txt") }, 101) }
        export.layoutParams=LinearLayout.LayoutParams(-2,-2)
        body.addView(tools)
        val list = column()
        field(body, "", session.search, 100) { session.search = it; fillArchive(list) }.apply { hint="⌕  제목이나 단어로 찾아보기"; contentDescription="아이디어 검색"; background=shape(Color.rgb(229,229,234),14) }
        val filters=listOf("all" to "전체")+folders().map { it.getString("id") to it.getString("name") }
        chips(body,filters.map { it.second to (session.filter==it.first) }) { session.filter=filters[it].first; render() }
        body.addView(list); fillArchive(list)
    }
    private fun fillArchive(list: LinearLayout) {
        list.removeAllViews()
        val filtered = records().filter { (session.filter == "all" || it.getString("folderId") == session.filter) &&
            listOf(it.optString("name"), it.optString("description"), it.getJSONArray("used_words").toString()).joinToString(" ").contains(session.search, ignoreCase = true) }
        if (filtered.isEmpty()) list.addView(label(if (records().isEmpty()) "아직 담아둔 생각이 없어요. 아래 +로 시작해 보세요." else "조건에 맞는 아이디어가 없어요."))
        filtered.forEach { record ->
            val container=FrameLayout(this).apply { background=shape(Color.WHITE,20) }
            val contents=column().apply { setPadding(dp(20),dp(18),dp(20),dp(14)) }
            val meta="${record.optString("category")} · ${record.optString("savedAt").take(10)}"
            button(contents, record.getString("name")) {
                session.current = JSONObject(record.toString()); session.categoryId = record.getString("categoryId"); session.topic=record.optString("topic"); topicInput=session.topic
                session.words = record.getJSONArray("used_words").let { a -> (0..2).map { a.getString(it) } }
                session.condition = record.optString("condition"); session.locks.clear(); session.dirty = false; session.prior = null; go("result")
            }.apply {
                text=rich(Triple(meta+"\n\n",11,muted),Triple(record.getString("name")+"\n",18,ink),Triple(record.optString("one_liner"),13,muted))
                gravity=Gravity.START; setPadding(0,0,dp(28),dp(8)); background=touchSurface(Color.TRANSPARENT); setLineSpacing(dp(4).toFloat(),1.2f)
            }
            wordTags(contents,(0..2).map { record.getJSONArray("used_words").getString(it) })
            contents.addView(label(sourceLabel(record.optString("source")),11f,color=muted))
            container.addView(contents,FrameLayout.LayoutParams(-1,-2))
            val delete=Button(this).apply {
                text="×"; textSize=22f; setTextColor(muted); contentDescription="${record.getString("name")} 삭제"
                stateListAnimator=null; elevation=0f; backgroundTintList=null; background=touchSurface(Color.TRANSPARENT)
                minWidth=0; minimumWidth=0; minHeight=0; minimumHeight=0; setPadding(0,0,0,0)
                setOnClickListener {
                AlertDialog.Builder(this@MainActivity).setTitle("보관함에서 지울까요?").setMessage(record.getString("name"))
                    .setPositiveButton("삭제") { _, _ -> attempt {
                        session.library.put("ideas", JSONArray(records().filter { it.getString("id") != record.getString("id") })); persist(); render()
                    } }.setNegativeButton("취소", null).show()
                }
            }
            container.addView(delete,FrameLayout.LayoutParams(dp(44),dp(44),Gravity.TOP or Gravity.END).apply { topMargin=dp(8); rightMargin=dp(6) })
            list.addView(container,LinearLayout.LayoutParams(-1,-2).apply { bottomMargin=dp(12) })
        }
    }
    private fun settingsScreen() {
        body.addView(label("CHOOSE YOUR ENGINE",11f,true,green)); space(height=8)
        body.addView(titleLabel("생각을 만드는 방식")); space()
        body.addView(label("규칙 시연, 이 기기의 AI, 클라우드 AI 중 직접 선택하세요.",14f,color=muted)); space(height=24)
        engineChoice("간편 시연","규칙 조합 · 즉시 사용 · AI 추론 없음",4,session.engine.mode=="demo") {
            session.engine.mode="demo"; session.preferences.edit().putString("mode","demo").apply(); render()
        }
        engineChoice("온디바이스 AI","이 기기의 모델로 직접 생성",5,session.engine.mode=="local") {
            session.engine.mode="local"; session.preferences.edit().putString("mode","local").apply(); render()
        }
        engineChoice("클라우드 AI","OpenAI · Google Gemini / 개인 API 키 설정",6,session.engine.mode=="cloud",true) { openCloudKey() }
        val local=settingsBox("온디바이스 모델 준비")
        local.addView(label("${AiEngine.MODEL_LABEL} 모델을 약 1.11GB 내려받아 이 기기에서 생성·발전·구체화를 수행해요. 한국어 품질과 속도에는 한계가 있어요.",14f).apply { setLineSpacing(0f,1.6f) }); space(local)
        local.addView(label("CPU로 오프라인 추론하며 RAM 6GB 이상과 약 1.8GB 여유 RAM을 권장해요. 최초 다운로드와 모델 로딩에는 시간이 걸려요.",12f,color=muted)); space(local)
        local.addView(label(if(session.engine.localReady()) "✓ 온디바이스 모델 준비 완료" else "온디바이스 모델 준비 필요",12f,true,green).apply { background=shape(ApplePalette.tint,10); setPadding(dp(12),dp(12),dp(12),dp(12)) }); space(local)
        button(local,if(session.engine.localReady()) "준비된 온디바이스 AI 사용" else "온디바이스 모델 준비하기",true) {
            if(session.engine.localReady()) { session.engine.mode="local"; session.preferences.edit().putString("mode","local").apply(); go(if(session.current!=null) "result" else "home") } else session.prepare()
        }
        local.addView(label("llama.cpp · ${AiEngine.MODEL_LABEL}",11f,color=muted))
        button(body, "설정 마치기") { go(if (session.current != null) "result" else "home") }
    }
    private fun providerName(provider: String) = if(provider=="gemini") "Google Gemini" else "OpenAI"
    private fun settingsBox(title: String): LinearLayout {
        val box=column().apply { background=shape(Color.WHITE,18); setPadding(dp(18),dp(18),dp(18),dp(18)) }
        box.addView(label(title,15f,true)); space(box,12)
        body.addView(box,LinearLayout.LayoutParams(-1,-2).apply { bottomMargin=dp(14) }); return box
    }
    private fun engineChoice(title: String, caption: String, icon: Int, selected: Boolean, opens: Boolean=false, action: () -> Unit) {
        button(body,title,action=action).apply {
            text=rich(Triple(title+"\n",15,ink),Triple(caption,12,muted)); gravity=Gravity.START or Gravity.CENTER_VERTICAL
            background=outlined(if(selected)ApplePalette.tint else Color.WHITE,selected,18); minHeight=dp(84); setPadding(dp(18),dp(16),dp(18),dp(16)); setLineSpacing(dp(5).toFloat(),1f)
            val leading=NavIcon(icon,green).apply { setBounds(0,0,dp(24),dp(24)) }
            val trailing=MarkIcon(if(opens) "›" else if(selected) "✓" else "",green).apply { setBounds(0,0,dp(18),dp(24)) }
            setCompoundDrawables(leading,null,trailing,null); compoundDrawablePadding=dp(12); isSelected=selected
        }
    }
    private fun openCloudKey() {
        draftProvider=session.engine.cloudProvider; draftKey=session.engine.apiKey; draftConsent=session.cloudConsent(draftProvider); go("cloud-key")
    }
    private fun cloudKeyScreen() {
        textAction(body,"‹ 생성 방식") { go("settings") }.apply { gravity=Gravity.START or Gravity.CENTER_VERTICAL; setPadding(0,dp(12),0,dp(12)) }
        body.addView(label("PERSONAL API KEY",11f,true,green)); space(height=8)
        body.addView(titleLabel("개인 API 키 입력")); space()
        body.addView(label("제공업체와 키를 확인하고 설정을 저장하세요.",14f,color=muted)); space(height=24)
        val input=settingsBox("클라우드 AI 제공업체")
        val providerSelect=Spinner(this).apply {
            contentDescription="클라우드 AI 제공업체"; background=outlined(paper,false,12); setPadding(dp(12),dp(4),dp(12),dp(4)); minimumHeight=dp(48)
            adapter=ArrayAdapter(this@MainActivity,android.R.layout.simple_spinner_item,listOf("OpenAI","Google Gemini · AI Studio")).apply { setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item) }
            setSelection(if(draftProvider=="gemini")1 else 0)
            onItemSelectedListener=object : AdapterView.OnItemSelectedListener {
                override fun onNothingSelected(parent: AdapterView<*>?) {}
                override fun onItemSelected(parent: AdapterView<*>?,view: View?,position: Int,id: Long) {
                    val next=if(position==0) "openai" else "gemini"
                    if(next!=draftProvider) { cancelKeyVerification(); draftProvider=next; draftKey=if(next==session.engine.cloudProvider) session.engine.apiKey else ""; draftConsent=session.cloudConsent(next); render() }
                }
            }
        }
        val providerFrame=FrameLayout(this)
        providerFrame.addView(providerSelect,FrameLayout.LayoutParams(-1,-2))
        providerFrame.addView(ImageView(this).apply {
            setImageDrawable(MarkIcon("⌄",muted)); importantForAccessibility=View.IMPORTANT_FOR_ACCESSIBILITY_NO; isClickable=false
        },FrameLayout.LayoutParams(dp(20),dp(24),Gravity.END or Gravity.CENTER_VERTICAL).apply { rightMargin=dp(12) })
        input.addView(providerFrame,LinearLayout.LayoutParams(-1,-2)); space(input)
        val provider=providerName(draftProvider)
        input.addView(label("$provider · ${if(draftProvider=="gemini")GeminiApi.MODEL else "gpt-4.1-mini"}",11f,color=muted)); space(input)
        var saveButton: Button?=null
        var verifyButton: Button?=null
        val verificationStatus=label("",13f,color=muted)
        fun updateSaveButton() {
            saveButton?.apply { isEnabled=!checkingKey && draftKey.isNotBlank() && draftConsent; alpha=if(isEnabled)1f else .45f }
            verifyButton?.apply { isEnabled=!checkingKey && draftKey.isNotBlank() && draftConsent; text=if(checkingKey) "연결 확인 중…" else "Gemini 연결 확인 · 생성 없이" }
        }
        val key=field(input,"개인 API 키 · $provider",draftKey,if(draftProvider=="gemini")Int.MAX_VALUE else 512) { cancelKeyVerification(); verificationStatus.text=""; draftKey=it; updateSaveButton() }
        key.hint="선택한 제공업체의 키 · 저장하지 않음"; key.background=outlined(paper,false,12)
        key.inputType=InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
        key.isSaveEnabled=false; key.importantForAutofill=View.IMPORTANT_FOR_AUTOFILL_NO
        input.addView(label("업체별 키는 서로 호환되지 않아요. 저장 전 돌아가면 변경 내용은 적용되지 않아요.",12f,color=muted))
        if(draftProvider=="gemini") input.addView(label("AI Studio의 복사 버튼으로 전체 키를 복사하세요. 따옴표·변수 이름·가려진 키는 사용할 수 없어요. 긴 키도 자동으로 자르지 않아요.",12f,color=muted))
        val agreement=settingsBox("전송·비용 안내")
        agreement.addView(label("세 단어, 입력 주제·분야, 조건, 현재 아이디어와 발전 방향이 $provider 로 전송돼요. API 사용 비용이 발생할 수 있으며 취소 전 처리된 요청에도 비용이 생길 수 있어요. 제공업체별 데이터 정책이 적용돼요.",14f).apply { setLineSpacing(0f,1.6f) }); space(agreement)
        agreement.addView(CheckBox(this).apply {
            text="$provider 전송과 API 비용에 동의합니다"; contentDescription="전송·API 비용 동의"; textSize=14f; setTextColor(ink); buttonTintList=ColorStateList.valueOf(green); minHeight=dp(48)
            isChecked=draftConsent; isSaveEnabled=false
            setOnCheckedChangeListener { _,checked -> cancelKeyVerification(); verificationStatus.text=""; draftConsent=checked; updateSaveButton() }
        })
        space(agreement)
        agreement.addView(label("저장한 동의는 제공업체별로 유지돼요. 키는 앱 메모리에만 두며 앱 프로세스 종료 시 사라져요. 공용 키를 배포하지 마세요.",12f,color=muted))
        if(draftProvider=="gemini") {
            verifyButton=button(body,"Gemini 연결 확인 · 생성 없이") {
                val supplied=GeminiApi.normalizeKey(draftKey)
                check(draftConsent) { "전송·API 비용 안내 동의를 먼저 확인하세요." }
                val ticket=++keyCheckTicket
                checkingKey=true; verificationStatus.text="Google에 키 인증과 모델 정보를 확인하는 중…"; updateSaveButton()
                Thread({
                    val result=runCatching { GeminiApi.verifyKey(supplied) { connection ->
                        if(ticket==keyCheckTicket) keyCheckConnection=connection else connection?.disconnect()
                    } }
                    runOnUiThread {
                        if(!isDestroyed && ticket==keyCheckTicket && session.screen=="cloud-key") {
                            checkingKey=false; keyCheckConnection=null
                            verificationStatus.text=result.getOrElse { it.message ?: "Google Gemini 연결 확인에 실패했습니다." }
                            updateSaveButton()
                        }
                    }
                },"gemini-key-check").apply { isDaemon=true; start() }
            }
            body.addView(verificationStatus); space()
        }
        saveButton=button(body,"설정 저장하기",true) {
            session.saveCloudSettings(draftProvider,draftKey,draftConsent)
            go("settings"); Toast.makeText(this,"클라우드 설정을 저장했어요. 키 인증은 생성 시 확인해요.",Toast.LENGTH_LONG).show()
        }
        updateSaveButton()
        body.addView(label("저장은 키 인증이나 유료 요청을 실행하지 않아요. 실제 호출은 아이디어를 생성할 때 진행해요.",12f,color=muted))
    }
    @Deprecated("SAF result dispatch for minSdk 26 without an AndroidX dependency")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != 101 || resultCode != RESULT_OK) return
        val uri = data?.data ?: return
        attempt {
            val bytes = LibraryBackup.exportText(session.library).toByteArray(Charsets.UTF_8)
            contentResolver.openOutputStream(uri)?.use { it.write(bytes) } ?: error("백업 파일을 열지 못했습니다.")
            Toast.makeText(this, "백업을 내보냈습니다.", Toast.LENGTH_SHORT).show()
        }
    }
    private class MarkIcon(private val glyph: String, private val color: Int) : Drawable() {
        override fun draw(canvas: Canvas) { val p=Paint(Paint.ANTI_ALIAS_FLAG).apply { this.color=this@MarkIcon.color; textSize=bounds.height()*.8f; textAlign=Paint.Align.CENTER }; canvas.drawText(glyph,bounds.exactCenterX(),bounds.exactCenterY()-(p.ascent()+p.descent())/2,p) }
        override fun setAlpha(alpha: Int) {}; override fun setColorFilter(filter: android.graphics.ColorFilter?) {}
        @Deprecated("Drawable opacity") override fun getOpacity()=android.graphics.PixelFormat.TRANSLUCENT
    }
    private class CategoryIcon(private val index: Int) : Drawable() {
        override fun draw(canvas: Canvas) {
            val colors=intArrayOf(Color.rgb(247,229,211),Color.rgb(224,232,246),Color.rgb(227,238,226))
            val p=Paint(Paint.ANTI_ALIAS_FLAG).apply { color=colors[index] }
            canvas.drawRoundRect(android.graphics.RectF(bounds),bounds.width()*.3f,bounds.height()*.3f,p)
            val inset=(bounds.width()*.24f).toInt()
            val left=bounds.left+inset; val top=bounds.top+inset; val right=bounds.right-inset; val bottom=bounds.bottom-inset
            NavIcon(index+2,Color.rgb(83,88,96)).apply { setBounds(left,top,right,bottom); draw(canvas) }
        }
        override fun setAlpha(alpha: Int) {}; override fun setColorFilter(filter: android.graphics.ColorFilter?) {}
        @Deprecated("Drawable opacity") override fun getOpacity()=android.graphics.PixelFormat.TRANSLUCENT
    }
    private class NavIcon(private val kind: Int, private val color: Int, private val count: Int = 0) : Drawable() {
        private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 1.8f; strokeJoin = Paint.Join.ROUND; strokeCap = Paint.Cap.ROUND }
        override fun draw(canvas: Canvas) {
            canvas.save(); canvas.translate(bounds.left.toFloat(), bounds.top.toFloat()); canvas.scale(bounds.width()/24f, bounds.height()/24f); paint.color = color
            val path = Path()
            if (kind == 0) { path.moveTo(3f,11f); path.lineTo(12f,3f); path.lineTo(21f,11f); path.moveTo(5f,9f); path.lineTo(5f,21f); path.lineTo(10f,21f); path.lineTo(10f,15f); path.lineTo(14f,15f); path.lineTo(14f,21f); path.lineTo(19f,21f); path.lineTo(19f,9f) }
            else if (kind == 1) { path.moveTo(3f,7f); path.lineTo(3f,20f); path.lineTo(21f,20f); path.lineTo(21f,7f); path.lineTo(11f,7f); path.lineTo(9f,4f); path.lineTo(3f,4f); path.close() }
            else if (kind == 2) {
                path.moveTo(5f,3f); path.lineTo(5f,9f); path.lineTo(9f,9f); path.lineTo(9f,3f); path.moveTo(7f,3f); path.lineTo(7f,21f)
                path.moveTo(18f,3f); path.lineTo(18f,21f); path.moveTo(18f,3f); path.cubicTo(13f,6f,13f,13f,18f,13f)
            } else if (kind == 3) {
                canvas.drawRoundRect(2f,4f,22f,20f,3f,3f,paint)
                path.moveTo(9f,9f); path.lineTo(6f,12f); path.lineTo(9f,15f); path.moveTo(15f,9f); path.lineTo(18f,12f); path.lineTo(15f,15f)
            } else if(kind==7) {
                path.moveTo(19f,12f);path.lineTo(5f,12f);path.moveTo(11f,6f);path.lineTo(5f,12f);path.lineTo(11f,18f)
            } else if(kind==8) {
                path.moveTo(9f,6f);path.lineTo(15f,12f);path.lineTo(9f,18f)
            } else if(kind==9) {
                path.moveTo(4f,16f);path.lineTo(16f,4f);path.lineTo(20f,8f);path.lineTo(8f,20f);path.lineTo(3f,21f);path.close();path.moveTo(14f,6f);path.lineTo(18f,10f)
            } else if(kind==10) {
                path.moveTo(6f,6f);path.lineTo(18f,18f);path.moveTo(18f,6f);path.lineTo(6f,18f)
            } else if(kind==5) {
                canvas.drawRoundRect(5f,5f,19f,19f,3f,3f,paint)
                canvas.drawRoundRect(9f,9f,15f,15f,1f,1f,paint)
                for(v in listOf(8f,12f,16f)) { path.moveTo(v,2f);path.lineTo(v,5f);path.moveTo(v,19f);path.lineTo(v,22f);path.moveTo(2f,v);path.lineTo(5f,v);path.moveTo(19f,v);path.lineTo(22f,v) }
            } else if(kind==6) {
                path.moveTo(7f,19f);path.cubicTo(0f,19f,0f,10f,6f,10f);path.cubicTo(5f,2f,18f,2f,18f,10f);path.cubicTo(25f,10f,25f,19f,18f,19f);path.close()
            } else {
                path.moveTo(12f,2f); path.lineTo(14.8f,8.5f); path.lineTo(22f,9.2f); path.lineTo(16.5f,14f); path.lineTo(18f,21f)
                path.lineTo(12f,17.4f); path.lineTo(6f,21f); path.lineTo(7.5f,14f); path.lineTo(2f,9.2f); path.lineTo(9.2f,8.5f); path.close()
            }
            canvas.drawPath(path, paint)
            if(count>0) {
                val badge=Paint(Paint.ANTI_ALIAS_FLAG).apply { this.color=ApplePalette.accent }
                canvas.drawCircle(20f,5f,6f,badge); badge.color=Color.WHITE; badge.textSize=7f; badge.textAlign=Paint.Align.CENTER
                canvas.drawText(if(count>99)"99+" else count.toString(),20f,5f-(badge.ascent()+badge.descent())/2,badge)
            }
            canvas.restore()
        }
        override fun setAlpha(alpha: Int) { paint.alpha = alpha }
        override fun setColorFilter(filter: android.graphics.ColorFilter?) { paint.colorFilter = filter }
        @Deprecated("Drawable opacity") override fun getOpacity() = android.graphics.PixelFormat.TRANSLUCENT
    }
}
