package com.fairco.trap

import com.fairco.trap.util.LocaleManager
import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

object NotificationHelper {
    const val CHANNEL_TRACKING = "trap_tracking_channel"
    const val CHANNEL_ALERTS   = "trap_alerts_channel"
    const val CHANNEL_CAPTURED = "trap_captured_channel"

    const val NOTIF_ID_TRACKING = 1001
    const val NOTIF_ID_ALERT    = 1002
    const val NOTIF_ID_CAPTURED = 2001

    fun createChannels(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val res = LocaleManager.applyLocale(context)

        val trackingChannel = NotificationChannel(
            CHANNEL_TRACKING,
            res.getString(R.string.notif_channel_tracking),
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = res.getString(R.string.notif_channel_tracking_desc)
        }

        val alertChannel = NotificationChannel(
            CHANNEL_ALERTS,
            res.getString(R.string.notif_channel_alerts),
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = res.getString(R.string.notif_channel_alerts_desc)
        }

        // High-urgency channel for capture events — uses alarm ringtone + vibration.
        val capturedChannel = NotificationChannel(
            CHANNEL_CAPTURED,
            res.getString(R.string.notif_channel_capture),
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = res.getString(R.string.notif_channel_capture_desc)
            enableVibration(true)
            vibrationPattern = longArrayOf(0, 500, 200, 500, 200, 500)
            setSound(
                RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM),
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build()
            )
        }

        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(trackingChannel)
        manager.createNotificationChannel(alertChannel)
        manager.createNotificationChannel(capturedChannel)

        // Also create the proximity notifier channel here so there's one call site.
        TrapProximityNotifier.createChannel(context)
    }

    fun buildTrackingNotification(context: Context, text: String): android.app.Notification {
        return NotificationCompat.Builder(context, CHANNEL_TRACKING)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle(LocaleManager.applyLocale(context).getString(R.string.notif_tracking_title))
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    fun showAlert(context: Context, title: String, text: String) {
        if (!hasNotificationPermission(context)) return

        val notification = NotificationCompat.Builder(context, CHANNEL_ALERTS)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentTitle(title)
            .setContentText(text)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .build()

        NotificationManagerCompat.from(context).notify(NOTIF_ID_ALERT, notification)
    }

    /**
     * Shows a high-priority notification when the player is captured by a trap
     * while the app is running in the background.
     * Tapping opens [GameActivity] which will display the TrappedOverlay.
     */
    fun showCapturedNotification(
        context: Context,
        trapName: String,
        ownerUsername: String,
        effectDesc: String,
        effectKind: String,
    ) {
        if (!hasNotificationPermission(context)) return

        // GameActivity shows the overlay from the pending_trapped_event stored by the caller.
        val openIntent = Intent(context, GameActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val pending = PendingIntent.getActivity(
            context, NOTIF_ID_CAPTURED, openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // Emoji prefix that reflects the trap effect.
        val effectEmoji = when (effectKind) {
            "timeout"  -> "⏱"
            "laughter" -> "😂"
            "slowdown" -> "🐌"
            "penalty"  -> "⚡"
            else       -> "🪤"
        }

        val res = LocaleManager.applyLocale(context)
        val hasOwner = ownerUsername.isNotBlank()
        val title = if (hasOwner) res.getString(R.string.notif_trapped_title_by, effectEmoji, ownerUsername)
                    else res.getString(R.string.notif_trapped_title, effectEmoji)
        val body = if (hasOwner) res.getString(R.string.notif_trapped_body_by, ownerUsername)
                   else res.getString(R.string.notif_trapped_body)
        val notif = NotificationCompat.Builder(context, CHANNEL_CAPTURED)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentTitle(title)
            .setContentText(effectDesc.ifBlank { trapName })
            .setStyle(NotificationCompat.BigTextStyle()
                .bigText(if (effectDesc.isBlank()) body else "$effectDesc\n\n$body")
            )
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setAutoCancel(true)
            .setContentIntent(pending)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .build()

        try {
            NotificationManagerCompat.from(context).notify(NOTIF_ID_CAPTURED, notif)
        } catch (_: SecurityException) { /* POST_NOTIFICATIONS not granted */ }
    }

    private fun hasNotificationPermission(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < 33) return true
        return ContextCompat.checkSelfPermission(
            context, Manifest.permission.POST_NOTIFICATIONS
        ) == PackageManager.PERMISSION_GRANTED
    }
}
