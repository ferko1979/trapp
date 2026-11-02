package com.fairco.trap.util

import android.content.Context
import android.content.ContextWrapper
import android.content.res.Resources

class BackendContextWrapper(base: Context, private val locale: String) : ContextWrapper(base) {

    private val backendResources by lazy {
        BackendResources(baseContext.resources, locale)
    }

    override fun getResources(): Resources = backendResources
}

@Suppress("DEPRECATION")
private class BackendResources(
    private val wrapped: Resources,
    private val locale: String,
) : Resources(wrapped.assets, wrapped.displayMetrics, wrapped.configuration) {

    override fun getString(id: Int): String {
        val key = entryName(id) ?: return wrapped.getString(id)
        return TranslationManager.get(locale, key) ?: wrapped.getString(id)
    }

    override fun getString(id: Int, vararg formatArgs: Any): String {
        val key = entryName(id) ?: return wrapped.getString(id, *formatArgs)
        return TranslationManager.get(locale, key, *formatArgs) ?: wrapped.getString(id, *formatArgs)
    }

    private fun entryName(id: Int): String? = try {
        wrapped.getResourceEntryName(id)
    } catch (_: Exception) {
        null
    }
}
