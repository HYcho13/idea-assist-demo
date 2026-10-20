package com.ideaassist.app

/** The same UTF-16 length/control-character policy as the web client. */
object UserCondition {
    const val MAX_LENGTH = 100
    fun validate(value: String): String {
        require(value.length <= MAX_LENGTH) { "조건은 최대 100자까지 입력할 수 있어요." }
        require(value.none { it.code in 0..31 || it.code in 127..159 || it.code == 0x061c || it.code in 0x200e..0x200f || it.code in 0x202a..0x202e || it.code in 0x2066..0x2069 }) { "조건에 사용할 수 없는 제어문자가 있어요. 일반 글자로 다시 입력해 주세요." }
        var index = 0
        while (index < value.length) {
            val char = value[index]
            if (Character.isHighSurrogate(char)) {
                require(index + 1 < value.length && Character.isLowSurrogate(value[index + 1])) { "조건에 올바르지 않은 글자가 있어요." }
                index += 2
            } else {
                require(!Character.isLowSurrogate(char)) { "조건에 올바르지 않은 글자가 있어요." }
                index++
            }
        }
        return value.trim()
    }
}
