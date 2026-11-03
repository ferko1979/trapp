package com.fairco.trap

import android.content.Context
import androidx.annotation.StringRes
import com.fairco.trap.util.LocaleManager
import com.google.firebase.FirebaseNetworkException
import com.google.firebase.FirebaseTooManyRequestsException
import com.google.firebase.auth.FirebaseAuthInvalidCredentialsException
import com.google.firebase.auth.FirebaseAuthInvalidUserException
import com.google.firebase.auth.FirebaseAuthUserCollisionException
import com.google.firebase.auth.FirebaseAuthWeakPasswordException
import com.google.firebase.functions.FirebaseFunctionsException
import java.io.IOException

/**
 * Player-facing text for a failed server call, in the app language.
 * The backend answers with English sentences or short codes ("inside-trap-zone:25", "closer:5:30:25");
 * known ones are mapped to string resources here and nothing raw is ever shown —
 * anything unrecognised falls back to a localized generic message.
 */
object ServerErrorText {

    data class Res(@StringRes val id: Int, val args: List<Any> = emptyList())

    private lateinit var appContext: Context

    fun init(context: Context) {
        appContext = context.applicationContext
    }

    /** Localized text for [e]; [fallback] when the error is not recognised. */
    fun of(e: Throwable?, @StringRes fallback: Int = R.string.error_generic_retry): String =
        of(appContext, e, fallback)

    fun of(context: Context, e: Throwable?, @StringRes fallback: Int = R.string.error_generic_retry): String {
        val res = resolve(e) ?: Res(fallback)
        return LocaleManager.applyLocale(context).getString(res.id, *res.args.toTypedArray())
    }

    /** Same for a bare server message (e.g. one stored in a state object). */
    fun ofMessage(msg: String?, @StringRes fallback: Int = R.string.error_generic_retry): String {
        val res = resolveMessage(msg) ?: Res(fallback)
        return LocaleManager.applyLocale(appContext).getString(res.id, *res.args.toTypedArray())
    }

    /** Known error → string resource, or null when it is not recognised. */
    fun resolve(e: Throwable?): Res? {
        if (e == null) return null
        resolveMessage(e.message)?.let { return it }
        if (isNetwork(e)) return Res(R.string.error_network)
        when (e) {
            is FirebaseTooManyRequestsException -> return Res(R.string.error_too_many_attempts)
            is FirebaseAuthUserCollisionException -> return Res(R.string.error_email_in_use)
            is FirebaseAuthWeakPasswordException -> return Res(R.string.error_password_too_short)
            is FirebaseAuthInvalidUserException,
            is FirebaseAuthInvalidCredentialsException -> return null  // caller's fallback (e.g. "Login failed.")
        }
        if (e is FirebaseFunctionsException) {
            return when (e.code) {
                FirebaseFunctionsException.Code.UNAVAILABLE,
                FirebaseFunctionsException.Code.DEADLINE_EXCEEDED -> Res(R.string.error_network)
                FirebaseFunctionsException.Code.UNAUTHENTICATED -> Res(R.string.error_sign_in_again)
                FirebaseFunctionsException.Code.PERMISSION_DENIED -> Res(R.string.error_permission_denied)
                FirebaseFunctionsException.Code.RESOURCE_EXHAUSTED -> Res(R.string.error_too_many_attempts)
                else -> null
            }
        }
        return null
    }

    fun resolveMessage(msg: String?): Res? {
        val m = msg?.trim().orEmpty()
        if (m.isEmpty()) return null
        return when {
            m.startsWith("inside-trap-zone") || m.contains("inside the trap zone", true) ->
                Res(R.string.error_inside_trap_zone)
            m.startsWith("closer:") -> {
                val needed = m.split(":").getOrNull(1)?.toIntOrNull() ?: 0
                if (needed > 0) Res(R.string.error_too_far_to_disassemble_detail, listOf(needed))
                else Res(R.string.error_too_far_to_disassemble)
            }
            m.contains("Reveal the trap first", true) -> Res(R.string.label_reveal_first)
            m.contains("Trap not found", true) -> Res(R.string.error_trap_gone)
            m.contains("session not found", true) -> Res(R.string.error_session_expired)
            m.contains("different age group", true) -> Res(R.string.error_trap_other_age_group)
            m.contains("No trap of this type available", true) -> Res(R.string.error_no_traps)
            m.contains("too far away", true) -> {
                val excess = Regex("You are (\\d+) m too far").find(m)?.groupValues?.get(1)?.toIntOrNull()
                if (excess != null) Res(R.string.error_target_far, listOf(excess)) else Res(R.string.error_too_far_to_place)
            }
            m.contains("Space your traps out", true) || m.contains("trap(s) within", true) ->
                Res(R.string.error_too_many_traps_nearby)
            m.contains("quota was reduced", true) -> Res(R.string.error_quota_penalty)
            m.contains("No more placements available today", true) ||
                m.contains("No traps available for today", true) -> Res(R.string.error_no_traps_daily_limit)
            m.contains("of your chosen home base", true) -> {
                val away = Regex("You are (\\d+)m away").find(m)?.groupValues?.get(1)?.toIntOrNull() ?: 0
                Res(R.string.error_home_base_too_far, listOf(away))
            }
            m.contains("Player location not available", true) -> Res(R.string.error_location_unavailable)
            m.contains("Username is already taken", true) -> Res(R.string.error_username_taken)
            m.contains("Already friends", true) -> Res(R.string.msg_already_friends)
            m.contains("Cannot friend yourself", true) || m.contains("Cannot message yourself", true) ->
                Res(R.string.error_cannot_target_self)
            m.contains("user not found", true) || m.contains("Username not found", true) ||
                m.contains("Recipient not found", true) -> Res(R.string.error_user_not_found)
            m.contains("Too many attempts", true) -> Res(R.string.error_too_many_attempts)
            m.contains("Authentication required", true) || m.contains("Login required", true) ||
                m.contains("Must be signed in", true) -> Res(R.string.error_sign_in_again)
            else -> null
        }
    }

    private fun isNetwork(e: Throwable): Boolean {
        var t: Throwable? = e
        while (t != null) {
            if (t is FirebaseNetworkException || t is IOException) return true
            t = t.cause
        }
        return false
    }
}
