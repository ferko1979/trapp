package com.fairco.trap

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat
import com.google.firebase.auth.FirebaseAuth

/**
 * Restarts [LocationTrackingService] after the device boots so the game
 * stays active in the background without the player having to reopen the app.
 *
 * Only starts the service when a user is already signed in — avoids
 * running the GPS tracker for logged-out devices.
 */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED &&
            intent.action != "android.intent.action.QUICKBOOT_POWERON"
        ) return

        val user = FirebaseAuth.getInstance().currentUser ?: return

        if (user.isEmailVerified) {
            val serviceIntent = Intent(context, LocationTrackingService::class.java)
            ContextCompat.startForegroundService(context, serviceIntent)
        }
    }
}
