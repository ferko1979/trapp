package com.fairco.trap

import com.fairco.trap.util.LocaleManager
import androidx.annotation.StringRes
import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.google.firebase.auth.auth
import com.google.firebase.functions.functions
import com.google.firebase.Firebase
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await

class InviteViewModel(application: Application) : AndroidViewModel(application) {

    private val functions = Firebase.functions("europe-west1")
    private fun str(@StringRes id: Int, vararg args: Any): String =
        LocaleManager.applyLocale(getApplication()).getString(id, *args)
    private val auth = Firebase.auth

    val inviteConfig    = MutableStateFlow<InviteConfig?>(null)

    // ── Backend: fetch invite config ──────────────────────────────────────
    fun loadInviteConfig(lang: String = "en") = viewModelScope.launch {
        try {
            val result = functions.getHttpsCallable("generateInviteLink")
                .call(mapOf("lang" to lang)).await()
            @Suppress("UNCHECKED_CAST")
            val data = result.getData() as? Map<String, Any> ?: return@launch
            inviteConfig.value = InviteConfig(
                androidPlayStoreUrl = data["androidPlayStoreUrl"] as? String ?: "",
                iosAppStoreUrl      = data["iosAppStoreUrl"]      as? String ?: "",
                universalUrl        = data["universalUrl"]        as? String ?: "",
                inviteMessage       = data["inviteMessage"]       as? String ?: "",
                inviteMessageShort  = data["inviteMessageShort"]  as? String ?: "",
                referralCode        = data["referralCode"]        as? String ?: "",
            )
        } catch (e: Exception) {
            // Non-fatal — use defaults so the feature still works
            inviteConfig.value = InviteConfig(
                androidPlayStoreUrl = "",
                iosAppStoreUrl = "",
                universalUrl = "https://playtrapnow.web.app",
                inviteMessage = str(R.string.invite_default_message, "https://playtrapnow.web.app"),
                inviteMessageShort = str(R.string.invite_default_short, "https://playtrapnow.web.app"),
                referralCode = "",
            )
        }
    }

    // ── Build message ─────────────────────────────────────────────────────
    fun buildInviteMessage(forSms: Boolean = false): String {
        val cfg = inviteConfig.value ?: return str(R.string.invite_email_subject)
        val senderName = auth.currentUser?.displayName ?: ""
        return if (forSms) cfg.buildShortMessage(senderName)
               else        cfg.buildFullMessage(senderName)
    }

}
