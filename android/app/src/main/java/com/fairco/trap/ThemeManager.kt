package com.fairco.trap

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.util.Log
import androidx.appcompat.app.AppCompatDelegate
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.Calendar

/**
 * Manages the application theme based on user preference, time of day, and light sensor data.
 */
object ThemeManager {

    private val _isDarkMode = MutableStateFlow(false)
    val isDarkMode: StateFlow<Boolean> = _isDarkMode.asStateFlow()

    private lateinit var appContext: Context
    private var sensorManager: SensorManager? = null
    private var lightSensor: Sensor? = null
    // Float.MAX_VALUE means no reading yet
    private var lastLux = Float.MAX_VALUE
    // Tracks whether we're currently in sensor-overridden-light state during nighttime
    private var sensorNightOverride = false

    private val sensorListener = object : SensorEventListener {
        override fun onSensorChanged(event: SensorEvent) {
            lastLux = event.values[0]
            evaluateAutoTheme()
        }
        override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
    }

    fun initialize(context: Context) {
        appContext = context.applicationContext
        sensorManager = appContext.getSystemService(Context.SENSOR_SERVICE) as SensorManager
        lightSensor = sensorManager?.getDefaultSensor(Sensor.TYPE_LIGHT)
        
        // Apply saved preference immediately on startup
        applyStoredPreference()
    }

    // Called at startup and after any preference change
    fun applyStoredPreference() {
        when (ThemePreferences.load(appContext)) {
            ThemePreferences.ThemeMode.ALWAYS_DARK  -> applyTheme(true,  stopSensor = true)
            ThemePreferences.ThemeMode.ALWAYS_LIGHT -> applyTheme(false, stopSensor = true)
            ThemePreferences.ThemeMode.AUTOMATIC    -> {
                startSensorListener()
                evaluateAutoTheme()
            }
        }
    }

    fun setMode(mode: ThemePreferences.ThemeMode) {
        ThemePreferences.save(appContext, mode)
        applyStoredPreference()
    }

    fun toggleManualOverride() {
        val nextMode = if (_isDarkMode.value) {
            ThemePreferences.ThemeMode.ALWAYS_LIGHT
        } else {
            ThemePreferences.ThemeMode.ALWAYS_DARK
        }
        setMode(nextMode)
    }

    // Auto logic
    internal fun evaluateAutoTheme() {
        if (ThemePreferences.load(appContext) != ThemePreferences.ThemeMode.AUTOMATIC) return

        val nightByTime = isNightTime()

        val dark: Boolean = if (!nightByTime) {
            // DAYTIME (6 AM – 8 PM): clock wins unconditionally.
            // The sensor is ignored here — emulator virtual sensors report 0 lux,
            // and pockets/shaded sensors cause false positives.
            false
        } else {
            // NIGHTTIME (8 PM – 6 AM): dark by default.
            // Sensor can override to light if the environment is genuinely very bright
            // (e.g., stadium, brightly lit office at 10 PM).
            // Hysteresis: enter light-override at >= 500 lux, exit below 200 lux.
            val hasSensor = lastLux != Float.MAX_VALUE
            if (hasSensor) {
                if (sensorNightOverride) lastLux < 200f   // stay light until it gets dim
                else !( lastLux >= 500f )                 // go light only if very bright
            } else {
                true   // no sensor → follow clock strictly
            }.also { isDark -> sensorNightOverride = !isDark }
        }

        applyTheme(dark, stopSensor = false)
    }

    private fun isNightTime(): Boolean {
        val hour = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)
        // Night is between 20:00 (8 PM) and 06:00 (6 AM)
        return hour >= 20 || hour < 6
    }

    private fun applyTheme(dark: Boolean, stopSensor: Boolean) {
        if (stopSensor) stopSensorListener()

        // Always enforce the delegate — without this, startup auto-evaluation
        // is a no-op when dark==false and Android falls back to MODE_NIGHT_FOLLOW_SYSTEM,
        // which means the emulator/system dark mode overrides our app logic.
        AppCompatDelegate.setDefaultNightMode(
            if (dark) AppCompatDelegate.MODE_NIGHT_YES
            else      AppCompatDelegate.MODE_NIGHT_NO
        )
        if (_isDarkMode.value != dark) {
            Log.d("ThemeManager", "Theme changed: ${if (dark) "DARK" else "LIGHT"}")
            _isDarkMode.value = dark
        }
    }

    private fun startSensorListener() {
        lightSensor?.also {
            sensorManager?.registerListener(sensorListener, it, SensorManager.SENSOR_DELAY_NORMAL)
        }
    }

    private fun stopSensorListener() {
        sensorManager?.unregisterListener(sensorListener)
        // Clear stale readings so they don't bleed into the next auto-mode session
        lastLux = Float.MAX_VALUE
        sensorNightOverride = false
    }
}
