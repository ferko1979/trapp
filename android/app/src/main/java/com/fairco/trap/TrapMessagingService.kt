package com.fairco.trap

import android.content.Context
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.Firebase
import com.google.firebase.firestore.firestore
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import org.json.JSONObject

/**
 * Receives FCM tokens and push messages when the app is in the background or killed.
 *
 * For trap_captured_you messages the raw trap data is persisted to SharedPreferences
 * so GameActivity.onResume() can show the TrappedOverlay immediately — same path
 * as the background LocationTrackingService, so double-show is already prevented.
 */
class TrapMessagingService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        val uid = FirebaseAuth.getInstance().currentUser?.uid ?: return
        Firebase.firestore.collection("users").document(uid)
            .update("fcmToken", token)
            .addOnFailureListener { /* non-fatal; retries on next token refresh */ }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        NotificationHelper.createChannels(this)

        val d     = message.data
        val type  = d["type"] ?: ""
        val title = message.notification?.title ?: d["title"] ?: return
        val body  = message.notification?.body  ?: d["body"]  ?: ""

        when (type) {
            "trap_captured_you" -> handleCapturedYou(d, title, body)
            "trap_captured"     -> handleCapturedVictory(d, title, body)
            "trap_disarmed"     -> NotificationHelper.showAlert(this, title, body)
            else                -> if (title.isNotBlank()) NotificationHelper.showAlert(this, title, body)
        }
    }

    /**
     * Stores the victory event to SharedPreferences so [GameActivity] can show a
     * celebration overlay when the app comes to the foreground.
     */
    private fun handleCapturedVictory(d: Map<String, String>, title: String, body: String) {
        val prefs = getSharedPreferences("Settings", Context.MODE_PRIVATE)
        if (prefs.getString("pending_capture_victory_event", null) != null) return

        val json = JSONObject().apply {
            put("trapTypeId",        d["trapTypeId"]        ?: "")
            put("iconKey",           d["iconKey"]           ?: "")
            put("soundKey",          d["soundKey"]          ?: "")
            put("emoji",             d["emoji"]             ?: "")
            put("imageUrl",          d["imageUrl"]          ?: "")
            put("effectKind",        d["effectKind"]        ?: "warning")
            put("capturedUsername",  d["capturedUsername"]  ?: "")
        }.toString()

        prefs.edit().putString("pending_capture_victory_event", json).apply()

        // Notification still shows so owner is alerted even if app is in background
        NotificationHelper.showAlert(this, title, body)
    }

    /**
     * Stores the capture event to SharedPreferences so [GameActivity] picks it up
     * on next resume, then shows an alarm-level notification to wake the player.
     * Only stores when no pending event is already queued (first-writer wins).
     */
    private fun handleCapturedYou(d: Map<String, String>, title: String, body: String) {
        val prefs = getSharedPreferences("Settings", Context.MODE_PRIVATE)
        if (prefs.getString("pending_trapped_event", null) != null) return // already queued

        val json = JSONObject().apply {
            put("trapTypeId",    d["trapTypeId"]    ?: "")
            put("iconKey",       d["iconKey"]       ?: "")
            put("soundKey",      d["soundKey"]      ?: "")
            put("emoji",         d["emoji"]         ?: "")
            put("imageUrl",      d["imageUrl"]      ?: "")
            put("effectKind",    d["effectKind"]    ?: "warning")
            put("effectValue",   d["effectValue"]?.toDoubleOrNull() ?: 0.0)
            put("ownerUid",      d["ownerUid"]      ?: "")
            put("ownerUsername", d["ownerUsername"] ?: "")
        }.toString()

        prefs.edit().putString("pending_trapped_event", json).apply()

        NotificationHelper.showCapturedNotification(
            context       = this,
            trapName      = d["trapTypeId"] ?: "Trap",
            ownerUsername = d["ownerUsername"] ?: "",
            effectDesc    = body,
            effectKind    = d["effectKind"] ?: "warning",
        )
    }
}
