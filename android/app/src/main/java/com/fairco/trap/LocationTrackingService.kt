package com.fairco.trap

import com.fairco.trap.util.LocaleManager
import android.content.Context
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

    // Resolve getString() in the app-selected language, not the system one.
    override fun attachBaseContext(newBase: Context) {
        super.attachBaseContext(LocaleManager.applyLocale(newBase))
    }

    private lateinit var functions: FirebaseFunctions
    private lateinit var fusedLocationClient: FusedLocationProviderClient
    // Created lazily: the constructor throws on some devices when the audio
    // stack is busy, and a field initializer would crash the whole service.
    private var toneGenerator: ToneGenerator? = null
    private var lastSentLatLng: LatLng? = null

    // ---------------------------------------------------------------------------
    // Adaptive update intervals
    //
    // We use different intervals depending on battery level to avoid draining the
    // battery during long play sessions. The high-accuracy GPS chip is expensive;
    // backing off when the battery is low keeps the game playable for longer.
    //
    // Normal  : 10 s interval / 5 s minimum / 8 m distance (GPS, capture accuracy)
    // Low bat : 30 s interval / 20 s minimum / 15 m distance (balanced power)
    // While GameActivity is visible it runs its own GPS loop, so the service
    // skips the server call to avoid sending every position twice.
    // ---------------------------------------------------------------------------
    companion object {
        private const val INTERVAL_NORMAL_MS     = 10_000L
        private const val MIN_INTERVAL_NORMAL_MS = 5_000L
        private const val MIN_DISTANCE_NORMAL_M  = 8f

        private const val INTERVAL_LOW_BAT_MS     = 30_000L
        private const val MIN_INTERVAL_LOW_BAT_MS = 20_000L
        private const val MIN_DISTANCE_LOW_BAT_M  = 15f

        /** Battery percentage below which we switch to the power-saving profile. */
        private const val LOW_BATTERY_THRESHOLD = 20

        var isRunning = false
            private set
    }

    private val locationCallback = object : LocationCallback() {
        override fun onLocationResult(result: LocationResult) {
            val location = result.lastLocation ?: return
            val latLng = LatLng(location.latitude, location.longitude)
            if (GameActivity.isInForeground) return
            sendLocationIfChanged(latLng)

            // Swap "starting…" for the generic active text once — never expose
            // the user's raw coordinates in the notification shade.
            if (!trackingNotifUpdated) {
                trackingNotifUpdated = true
                postTrackingNotification(getString(R.string.notif_tracking_active))
            }
        }
    }

    private var trackingNotifUpdated = false

    private fun postTrackingNotification(text: String) {
        if (android.os.Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED
        ) return
        try {
            androidx.core.app.NotificationManagerCompat.from(this).notify(
                NotificationHelper.NOTIF_ID_TRACKING,
                NotificationHelper.buildTrackingNotification(this, text),
            )
        } catch (_: SecurityException) { }
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
        try {
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
                startForeground(
                    NotificationHelper.NOTIF_ID_TRACKING,
                    notification,
                    android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
                )
            } else {
                startForeground(NotificationHelper.NOTIF_ID_TRACKING, notification)
            }
        } catch (e: Exception) {
            // Android 12+/14+: a location FGS cannot start from the background
            // (e.g. a sticky restart after the process was killed). The player
            // restarts tracking by opening the app.
            isRunning = false
            stopSelf()
            return START_NOT_STICKY
        }

        trackingNotifUpdated = false
        startLocationUpdates()
        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        isRunning = false
        fusedLocationClient.removeLocationUpdates(locationCallback)
        toneGenerator?.release()
        toneGenerator = null
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun playAlertTone() {
        try {
            val tg = toneGenerator ?: ToneGenerator(AudioManager.STREAM_NOTIFICATION, 100)
                .also { toneGenerator = it }
            tg.startTone(ToneGenerator.TONE_CDMA_ALERT_CALL_GUARD, 800)
        } catch (e: RuntimeException) {
            Log.w("LocationTrackingService", "Alert tone unavailable: ${e.message}")
        }
    }

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
                .setMinUpdateDistanceMeters(MIN_DISTANCE_LOW_BAT_M)
                .build()
        } else {
            LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, INTERVAL_NORMAL_MS)
                .setMinUpdateIntervalMillis(MIN_INTERVAL_NORMAL_MS)
                .setMinUpdateDistanceMeters(MIN_DISTANCE_NORMAL_M)
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
                        "timeout"  -> getString(R.string.svc_effect_frozen, effectValue.toInt())
                        "laughter" -> getString(R.string.svc_effect_laughter)
                        "slowdown" -> getString(R.string.svc_effect_slowed, effectValue.toInt())
                        "penalty"  -> getString(R.string.svc_effect_penalty, effectValue.toInt())
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
                    if (isSoundEnabled) playAlertTone()
                }

                // Proximity alerts while the game screen is closed; the notifier
                // de-duplicates against alerts already shown by GameActivity.
                @Suppress("UNCHECKED_CAST")
                (response?.get("nearbyTraps") as? List<Map<String, Any>>)?.forEach { raw ->
                    NearbyTrap.fromServer(raw)?.let { TrapProximityNotifier.notify(this, it) }
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
