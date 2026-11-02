package com.fairco.trap.util

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import com.google.firebase.Firebase
import com.google.firebase.functions.functions
import kotlinx.coroutines.tasks.await
import org.json.JSONObject

/**
 * Downloads and caches backend app strings from Firestore via the
 * `getAppTranslations` Cloud Function.  Every call to [fetchIfNeeded]
 * sends the cached version timestamp; the server only returns the full
 * string map when a newer version exists.
 *
 * Usage:
 *   1. Call [initialize] once in Application.onCreate().
 *   2. Call [fetchIfNeeded] early in the launch flow (e.g. SplashActivity).
 *   3. Read strings via [get] — BackendContextWrapper calls this automatically.
 */
object TranslationManager {

    private const val TAG = "TranslationManager"
    private const val PREFS_NAME = "backend_translations"

    private var prefs: SharedPreferences? = null

    // locale → { key → value }
    private val cache = mutableMapOf<String, MutableMap<String, String>>()
    // locale → server epoch-ms version
    private val versions = mutableMapOf<String, Long>()

    // ── Init ──────────────────────────────────────────────────────────────────

    fun initialize(context: Context) {
        if (prefs != null) return
        prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        loadAll()
    }

    private fun loadAll() {
        val p = prefs ?: return
        for ((key, value) in p.all) {
            when {
                key.startsWith("s:") -> {
                    val locale = key.removePrefix("s:")
                    cache[locale] = parseJson(value as? String ?: "{}").toMutableMap()
                }
                key.startsWith("v:") -> {
                    val locale = key.removePrefix("v:")
                    versions[locale] = (value as? Long) ?: 0L
                }
            }
        }
        Log.d(TAG, "Loaded cached locales: ${cache.keys}")
    }

    private fun parseJson(json: String): Map<String, String> = try {
        val obj = JSONObject(json)
        buildMap { for (k in obj.keys()) put(k, obj.getString(k)) }
    } catch (e: Exception) {
        Log.e(TAG, "Cache parse error", e)
        emptyMap()
    }

    // ── Fetch from server ─────────────────────────────────────────────────────

    /**
     * Checks the server for a newer translation version for [locale].
     * If one exists the full string map is downloaded and cached locally.
     * Safe to call from a coroutine; network errors are swallowed so the
     * app always falls back to compiled XML strings.
     */
    suspend fun fetchIfNeeded(locale: String) {
        val cachedVersion = versions[locale] ?: 0L
        try {
            val result = Firebase.functions("europe-west1")
                .getHttpsCallable("getAppTranslations")
                .call(mapOf("locale" to locale, "cachedVersion" to cachedVersion))
                .await()

            @Suppress("UNCHECKED_CAST")
            val data = result.data as? Map<String, Any> ?: return
            val upToDate = data["upToDate"] as? Boolean ?: true

            if (!upToDate) {
                val version = (data["version"] as? Number)?.toLong() ?: 0L
                @Suppress("UNCHECKED_CAST")
                val strings = (data["strings"] as? Map<String, String>) ?: return
                save(locale, strings, version)
                Log.i(TAG, "Updated $locale: ${strings.size} strings (v$version)")
            } else {
                Log.d(TAG, "$locale is up to date")
            }
        } catch (e: Exception) {
            Log.w(TAG, "Fetch failed for $locale (using cached strings): ${e.message}")
        }
    }

    private fun save(locale: String, strings: Map<String, String>, version: Long) {
        cache[locale] = strings.toMutableMap()
        versions[locale] = version
        prefs?.edit()
            ?.putString("s:$locale", JSONObject(strings).toString())
            ?.putLong("v:$locale", version)
            ?.apply()
    }

    // ── String lookup ─────────────────────────────────────────────────────────

    /**
     * Returns the backend string for [key] in [locale], or null if not cached.
     * Falls back to "en" if the locale-specific entry is missing.
     * Applies [formatArgs] via String.format when provided.
     */
    fun get(locale: String, key: String, vararg formatArgs: Any?): String? {
        val raw = cache[locale]?.get(key)
            ?: if (locale != "en") cache["en"]?.get(key) else null
        val value = raw ?: return null
        if (formatArgs.isEmpty()) return value
        @Suppress("UNCHECKED_CAST")
        return try { String.format(value, *(formatArgs as Array<out Any>)) } catch (_: Exception) { value }
    }

    fun hasCachedLocale(locale: String): Boolean = cache.containsKey(locale)
    fun cachedVersion(locale: String): Long = versions[locale] ?: 0L
}
