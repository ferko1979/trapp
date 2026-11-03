package com.fairco.trap.util

import android.content.Context
import android.content.res.Configuration
import java.util.Locale

object LocaleManager {

    private const val PREFS_NAME = "Settings"
    private const val KEY_LANG = "App_Lang"

    fun getLocale(context: Context): String =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getString(KEY_LANG, "en") ?: "en"

    fun setLocale(context: Context, locale: String) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit().putString(KEY_LANG, locale).apply()
    }

    /** Language code for the backend: regional variants ("en-US") collapse to the base language. */
    fun apiLang(context: Context): String = getLocale(context).substringBefore('-')

    fun applyLocale(context: Context): Context {
        val lang = getLocale(context)
        val locale = Locale.forLanguageTag(lang)
        Locale.setDefault(locale)
        val config = Configuration(context.resources.configuration)
        config.setLocale(locale)
        return context.createConfigurationContext(config)
    }
}
