package com.fairco.trap

import android.app.Application
import android.os.Handler
import android.os.Looper
import android.util.Log
import coil.Coil
import coil.ImageLoader
import coil.decode.SvgDecoder
import com.fairco.trap.util.TranslationManager
import com.google.android.gms.ads.MobileAds
import com.google.android.gms.maps.MapsInitializer
import com.google.android.gms.maps.OnMapsSdkInitializedCallback
import com.google.firebase.FirebaseApp

class TrapApplication : Application(), OnMapsSdkInitializedCallback {

    override fun onCreate() {
        super.onCreate()

        // Register SVG decoder so Coil can render trap image data URIs (image/svg+xml).
        Coil.setImageLoader(
            ImageLoader.Builder(this)
                .components { add(SvgDecoder.Factory()) }
                .crossfade(true)
                .build()
        )

        // Load cached backend translations immediately so BackendContextWrapper
        // can serve them before the network fetch in SplashActivity.
        TranslationManager.initialize(applicationContext)

        // Initialize and start theme management
        ThemeManager.initialize(this)

        // Initialize Maps, Firebase and App Check with a slight delay to avoid SecurityException on Android 15
        // which sometimes occurs when GMS is called too early in the Application lifecycle.
        // We do this on the main thread to ensure proper synchronization and avoid "Database lock unavailable"
        // errors that can occur when multiple threads attempt to initialize the Maps SDK cache simultaneously.
        Handler(Looper.getMainLooper()).post {
            try {
                Log.d("TrapApplication", "Pre-initializing Maps SDK...")
                MapsInitializer.initialize(applicationContext, MapsInitializer.Renderer.LATEST, this)

                Log.d("TrapApplication", "Initializing Firebase...")
                FirebaseApp.initializeApp(this)
                initializeFirebaseAppCheck()

                // Initialize the Mobile Ads SDK once. Actual ad preloading happens in
                // GameActivity AFTER the EU/GDPR UMP consent form is handled.
                MobileAds.initialize(this) { initStatus ->
                    Log.d("TrapApplication", "AdMob initialized: $initStatus")
                }
            } catch (e: Exception) {
                Log.e("TrapApplication", "Initialization failed: ${e.message}")
            }
        }

        // Create notification channels
        TrapProximityNotifier.createChannel(this)
    }

    override fun onMapsSdkInitialized(renderer: MapsInitializer.Renderer) {
        when (renderer) {
            MapsInitializer.Renderer.LATEST -> Log.d("TrapApplication", "The latest version of the Maps SDK renderer is in use.")
            MapsInitializer.Renderer.LEGACY -> Log.d("TrapApplication", "The legacy version of the Maps SDK renderer is in use.")
        }
    }

    private fun initializeFirebaseAppCheck() {
        try {
            // Check if GMS is available before initializing App Check to avoid SecurityException
            // on devices with broken or missing Google Play Services.
            val availability = com.google.android.gms.common.GoogleApiAvailability.getInstance()
                .isGooglePlayServicesAvailable(this)
            
            if (availability != com.google.android.gms.common.ConnectionResult.SUCCESS) {
                Log.w("TrapApplication", "Google Play Services not available (code $availability). Skipping App Check.")
                return
            }

            AppCheckInit.install()
            Log.d("TrapApplication", "App Check initialized.")
        } catch (e: Exception) {
            Log.e("TrapApplication", "Failed to initialize App Check: ${e.message}")
        }
    }
}
