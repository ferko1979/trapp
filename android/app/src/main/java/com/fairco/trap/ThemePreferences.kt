package com.fairco.trap

import android.content.Context

object ThemePreferences {

    enum class ThemeMode { AUTOMATIC, ALWAYS_LIGHT, ALWAYS_DARK }

    private const val PREFS_NAME = "trap_theme_prefs"
    private const val KEY_MODE   = "theme_mode"

    fun save(context: Context, mode: ThemeMode) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_MODE, mode.name)
            .apply()
    }

    fun load(context: Context): ThemeMode {
        val raw = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getString(KEY_MODE, ThemeMode.AUTOMATIC.name)
        return try {
            ThemeMode.valueOf(raw ?: ThemeMode.AUTOMATIC.name)
        } catch (_: IllegalArgumentException) {
            ThemeMode.AUTOMATIC
        }
    }
}
