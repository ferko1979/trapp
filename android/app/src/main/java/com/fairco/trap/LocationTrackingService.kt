package com.fairco.trap

import android.Manifest
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.BatteryManager
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.core.content.ContextCompat
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.maps.model.LatLng
import com.google.firebase.Firebase
import com.google.firebase.functions.FirebaseFunctions
import com.google.firebase.functions.functions
import kotlin.math.abs

class LocationTrackingService : Service() {

    private lateinit var functions: FirebaseFunctions
    private lateinit var fusedLocationClient: FusedLocationProviderClient
    private val toneGenerator = ToneGenerator(AudioManager.STREAM_NOTIFICATION, 100)
    private var lastSentLatLng: LatLng? = null

    // ---------------------------------------------------------------------------
    // Adaptive update intervals
    //
    // We use different intervals depending on battery level to avoid draining the
    // battery during long play sessions. The high-accuracy GPS chip is expensive;
    // backing off when the battery is low keeps the game playable for longer.
    //
    // Normal  : 5 s interval / 3 s minimum  (GPS always-on, highest accuracy)
    // Low bat : 15 s interval / 10 s minimum (balanced power / network-based)
    // ---------------------------------------------------------------------------
    companion object {
        private const val INTERVAL_NORMAL_MS     = 5_000L
        private const val MIN_INTERVAL_NORMAL_MS = 3_000L

        private const val INTERVAL_LOW_BAT_MS     = 15_000L
        private const val MIN_INTERVAL_LOW_BAT_MS = 10_000L

        /** Battery percentage below which we switch to the power-saving profile. */
        private const val LOW_BATTERY_THRESHOLD = 20

        var isRunning = false
            private set
    }

    private val locationCallback = object : LocationCallback() {
        override fun onLocationResult(result: LocationResult) {
            val location = result.lastLocation ?: return
            val latLng = LatLng(location.latitude, location.longitude)
            sendLocationIfChanged(latLng)

            // Show a generic tracking message in the notification — never expose
            // the user's raw coordinates in the notification shade.
            val notif = NotificationHelper.buildTrackingNotification(
                this@LocationTrackingService,
                getString(R.string.notif_tracking_active),
            )

            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
                startForeground(
                    NotificationHelper.NOTIF_ID_TRACKING,
                    notif,
                    android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
                )
            } else {
                startForeground(NotificationHelper.NOTIF_ID_TRACKING, notif)
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        NotificationHelper.createChannels(this)
        functions = Firebase.functions("europe-west1")
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        isRunning = true
        if (!hasLocationPermission()) {
            stopSelf()
            return START_NOT_STICKY
        }

        val notification = NotificationHelper.buildTrackingNotification(
            this,
            getString(R.string.notif_tracking_starting)
        )
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
            startForeground(
                NotificationHelper.NOTIF_ID_TRACKING,
                notification,
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
            )
        } else {
            startForeground(NotificationHelper.NOTIF_ID_TRACKING, notification)
        }

        startLocationUpdates()
        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        isRunning = false
        fusedLocationClient.removeLocationUpdates(locationCallback)
        toneGenerator.release()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun hasLocationPermission(): Boolean {
        val fine = ContextCompat.checkSelfPermission(
            this, Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
        val coarse = ContextCompat.checkSelfPermission(
            this, Manifest.permission.ACCESS_COARSE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
        return fine || coarse
    }

    /**
     * Builds a [LocationRequest] tuned to the current battery level.
     *
     * On low battery we reduce frequency and drop from GPS-only to balanced
     * (network + GPS) to extend play time. This is a meaningful saving: the
     * PRIORITY_HIGH_ACCURACY mode keeps the GPS chip running continuously.
     */
    private fun buildLocationRequest(): LocationRequest {
        val batteryLevel = getBatteryLevel()
        val isLowBattery = batteryLevel in (0..LOW_BATTERY_THRESHOLD)

        return if (isLowBattery) {
            LocationRequest.Builder(Priority.PRIORITY_BALANCED_POWER_ACCURACY, INTERVAL_LOW_BAT_MS)
                .setMinUpdateIntervalMillis(MIN_INTERVAL_LOW_BAT_MS)
                .build()
        } else {
            LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, INTERVAL_NORMAL_MS)
                .setMinUpdateIntervalMillis(MIN_INTERVAL_NORMAL_MS)
                .build()
        }
    }

    private fun startLocationUpdates() {
        try {
            fusedLocationClient.requestLocationUpdates(
                buildLocationRequest(),
                locationCallback,
                Looper.getMainLooper()
            )
        } catch (_: SecurityException) {
            stopSelf()
        }
    }

    /**
     * Returns battery percentage (0–100), or -1 if unavailable.
     * A return value of -1 is treated as "not low" to avoid false power-saving.
     */
    private fun getBatteryLevel(): Int {
        val bm = getSystemService(BATTERY_SERVICE) as? BatteryManager ?: return -1
        return bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
    }

    private var isAppCheckThrottled = false
    private var lastAppCheckErrorTime = 0L

    private fun buildTrappedEventJson(
        trapTypeId: String, iconKey: String, emoji: String, imageUrl: String?,
        soundKey: String?, effectKind: String, effectValue: Double, ownerUsername: String
    ): String {
        return try {
            org.json.JSONObject().apply {
                put("trapTypeId",    trapTypeId)
                put("iconKey",       iconKey)
                put("emoji",         emoji)
                put("imageUrl",      imageUrl ?: "")
                put("soundKey",      soundKey ?: "")
                put("effectKind",    effectKind)
                put("effectValue",   effectValue)
                put("ownerUsername", ownerUsername)
            }.toString()
        } catch (e: Exception) {
            Log.w("LocationTrackingService", "buildTrappedEventJson failed: ${e.message}")
            ""
        }
    }

    /**
     * Only sends a location update to the server when the device has moved
     * meaningfully (> ~5 metres), to avoid wasting bandwidth and Cloud Function
     * invocations when the player is standing still or due to GPS jitter.
     */
    private fun sendLocationIfChanged(latLng: LatLng) {
        // If we recently hit a "Too many attempts" App Check error, back off for 5 minutes.
        // This error usually means the App Check debug token is missing in Firebase Console
        // or the environment is not passing integrity checks.
        if (isAppCheckThrottled && System.currentTimeMillis() - lastAppCheckErrorTime < 300_000L) {
            return
        }

        val previous = lastSentLatLng
        if (previous != null) {
            val latDiff = abs(previous.latitude - latLng.latitude)
            val lngDiff = abs(previous.longitude - latLng.longitude)
            // 0.00005 is roughly 5.5 meters.
            if (latDiff < 0.00005 && lngDiff < 0.00005) return
        }

        functions.getHttpsCallable("updatePlayerLocation")
            .call(hashMapOf("lat" to latLng.latitude, "lng" to latLng.longitude))
            .addOnSuccessListener { result ->
                isAppCheckThrottled = false
                @Suppress("UNCHECKED_CAST")
                val response = result.getData() as? Map<String, Any>
                val captured = response?.get("captured") as? Boolean ?: false

                val prefs = getSharedPreferences("Settings", MODE_PRIVATE)
                val isSoundEnabled = prefs.getBoolean("Sound_Enabled", true)

                if (captured) {
                    // Parse trap details so the app can show the correct overlay when
                    // the user taps the notification and GameActivity resumes.
                    val trapTypeId     = response?.get("trapTypeId")     as? String ?: ""
                    val iconKey        = response?.get("iconKey")        as? String ?: ""
                    val emoji          = response?.get("emoji")          as? String ?: ""
                    val imageUrl       = response?.get("imageUrl")       as? String
                    val soundKey       = response?.get("soundKey")       as? String
                    val effectKind     = response?.get("effectKind")     as? String ?: ""
                    val effectValue    = (response?.get("effectValue") as? Number)?.toDouble() ?: 0.0
                    val ownerUsername  = response?.get("ownerUsername")  as? String ?: ""

                    // Store event so GameActivity can show the overlay on next resume.
                    val json = buildTrappedEventJson(
                        trapTypeId, iconKey, emoji, imageUrl,
                        soundKey, effectKind, effectValue, ownerUsername
                    )
                    prefs.edit().putString("pending_trapped_event", json).apply()

                    // Human-readable effect description for the notification body.
                    val effectDesc = when (effectKind) {
                        "timeout"  -> "Frozen for ${effectValue.toInt()}s"
                        "laughter" -> "Laughter trap — 5s stun"
                        "slowdown" -> "Slowed by ${effectValue.toInt()}%"
                        "penalty"  -> "Score penalty: ${effectValue.toInt()} pts"
                        else       -> ""
                    }

                    // Show the push notification (opens the app / trapped overlay).
                    NotificationHelper.showCapturedNotification(
                        this,
                        trapTypeId,
                        ownerUsername,
                        effectDesc,
                        effectKind
                    )

                    // Alert tone for immediate physical feedback.
                    if (isSoundEnabled) {
                        toneGenerator.startTone(ToneGenerator.TONE_CDMA_ALERT_CALL_GUARD, 800)
                    }
                }
                lastSentLatLng = latLng
            }
            .addOnFailureListener { e ->
                // "Too many attempts" is a client-side rate limit from Firebase App Check.
                if (e.message?.contains("Too many attempts", ignoreCase = true) == true) {
                    isAppCheckThrottled = true
                    lastAppCheckErrorTime = System.currentTimeMillis()
                }
            }
    }
}
