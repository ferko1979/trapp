package com.fairco.trap

import androidx.annotation.StringRes

sealed class DisarmState {
    object Idle : DisarmState()
    data class NearbyDetected(val trap: NearbyTrap) : DisarmState()
    data class Revealing(
        val trap: NearbyTrap,
        val progressSeconds: Float,
        val requiredSeconds: Float,
        val tooFar: Boolean = false,
        /** Countdown seconds remaining before out-of-range cancel (null = not counting). */
        val outOfRangeCountdown: Int? = null
    ) : DisarmState()
    data class Disarming(
        val trap: NearbyTrap,
        val sessionId: String,
        val progressSeconds: Float,
        val requiredSeconds: Float,
        val tooFar: Boolean = false,
        val metersToClose: Int = 0,
        val outOfRangeCountdown: Int? = null
    ) : DisarmState()
    /** Player was captured by the trap while trying to disassemble. */
    data class CapturedWhileDisarming(val trap: NearbyTrap) : DisarmState()
    data class DisarmComplete(
        val trapId: String,
        val trapTypeId: String,
        val trapName: String,
        val iconKey: String
    ) : DisarmState()
    /** [message] = raw server text; when [resId] != 0 the UI shows getString(resId, *args) instead. */
    data class Error(
        val message: String = "",
        @StringRes val resId: Int = 0,
        val args: List<Any> = emptyList()
    ) : DisarmState()
}
