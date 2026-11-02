package com.fairco.trap

/**
 * Configuration for the invite feature, typically fetched from the backend.
 */
data class InviteConfig(
    val androidPlayStoreUrl: String,
    val iosAppStoreUrl: String,
    val universalUrl: String,          // preferred link — universal / dynamic
    val inviteMessage: String,         // full message for share sheet
    val inviteMessageShort: String,    // compact for SMS
    val referralCode: String = "",     // unique code for auto-friend on registration
) {
    /** Returns the best single download URL to embed in the message. */
    val downloadUrl: String get() = universalUrl
        .ifBlank { androidPlayStoreUrl }
        .ifBlank { iosAppStoreUrl }
        .ifBlank { "https://playtrapnow.web.app" }  // fallback

    fun buildFullMessage(senderName: String = ""): String {
        return inviteMessage
            .replace("{downloadUrl}", downloadUrl)
            .let { if (senderName.isNotBlank()) it.replace("{playerName}", senderName) else it }
    }

    fun buildShortMessage(senderName: String = ""): String {
        return inviteMessageShort
            .replace("{downloadUrl}", downloadUrl)
            .let { if (senderName.isNotBlank()) it.replace("{playerName}", senderName) else it }
    }
}
