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
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

object TrapProximityNotifier {

    private const val CHANNEL_ID = "trap_proximity"
    private const val NOTIF_ID   = 7001
    const val EXTRA_OPEN_DISARM  = "openDisarm"

    /** Same trap re-alerts only after this long, whoever (service or game screen) saw it first. */
    private const val REALERT_AFTER_MS = 15 * 60_000L
    private val lastAlertAt = mutableMapOf<String, Long>()

    fun createChannel(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val res = LocaleManager.applyLocale(context)
            val channel = NotificationChannel(
                CHANNEL_ID,
                res.getString(R.string.notif_channel_nearby),
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = res.getString(R.string.notif_channel_nearby_desc)
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 300, 150, 300, 150, 300)
                setSound(
                    RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM),
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build()
                )
            }
            context.getSystemService(NotificationManager::class.java)
                .createNotificationChannel(channel)
        }
    }

    fun notify(context: Context, trap: NearbyTrap) {
        val now = System.currentTimeMillis()
        synchronized(lastAlertAt) {
            val last = lastAlertAt[trap.trapId]
            if (last != null && now - last < REALERT_AFTER_MS) return
            lastAlertAt[trap.trapId] = now
            lastAlertAt.entries.removeAll { now - it.value > REALERT_AFTER_MS }
        }
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED
        ) return

        // Tap / "Disarm" → game screen, which opens the disarm sheet for this trap
        val openAppIntent = Intent(context, GameActivity::class.java).apply {
            putExtra(EXTRA_OPEN_DISARM, trap.trapId)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val openAppPending = PendingIntent.getActivity(
            context, 0, openAppIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // "Show on Map" action → opens Google Maps centered on the trap
        val mapPending: PendingIntent? = if (trap.lat != 0.0 || trap.lng != 0.0) {
            val mapIntent = Intent(Intent.ACTION_VIEW,
                Uri.parse("geo:${trap.lat},${trap.lng}?q=${trap.lat},${trap.lng}(Trap)&z=18"))
                .apply { flags = Intent.FLAG_ACTIVITY_NEW_TASK }
            PendingIntent.getActivity(
                context, 1, mapIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        } else null

        val res = LocaleManager.applyLocale(context)
        val notif = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_trap_warning)
            .setContentTitle(res.getString(R.string.notif_danger_title, trap.distanceMeters))
            .setContentText(
                res.getString(R.string.notif_danger_text, trap.distanceMeters, trap.radiusMeters)
            )
            .setStyle(NotificationCompat.BigTextStyle()
                .bigText(res.getString(R.string.notif_danger_big, trap.distanceMeters, trap.radiusMeters))
            )
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setAutoCancel(true)
            .setContentIntent(openAppPending)
            .apply {
                if (mapPending != null) {
                    addAction(0, res.getString(R.string.notif_action_show_map), mapPending)
                }
                addAction(0, res.getString(R.string.notif_action_disarm), openAppPending)
            }
            .build()

        try {
            NotificationManagerCompat.from(context).notify(NOTIF_ID, notif)
        } catch (_: SecurityException) { /* POST_NOTIFICATIONS not granted */ }
    }
}
