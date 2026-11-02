package com.fairco.trap

import android.content.Context
import androidx.appcompat.app.AppCompatActivity
import com.fairco.trap.util.BackendContextWrapper
import com.fairco.trap.util.LocaleManager

/**
 * Base class for all activities.
 *
 * Applies the user-selected locale and wraps the Context so that every
 * [getString] call is first resolved against the backend translation cache
 * ([com.fairco.trap.util.TranslationManager]) before falling back to the
 * compiled Android XML string resources.
 *
 * To change the app language at runtime, call [setAppLocale] — it saves the
 * preference and calls [recreate] so all views re-inflate with fresh strings.
 */
abstract class BaseActivity : AppCompatActivity() {

    override fun attachBaseContext(newBase: Context) {
        val locale = LocaleManager.getLocale(newBase)
        val localeContext = LocaleManager.applyLocale(newBase)
        super.attachBaseContext(BackendContextWrapper(localeContext, locale))
    }

    /** Save [locale] to preferences and recreate the activity to apply it. */
    fun setAppLocale(locale: String) {
        LocaleManager.setLocale(this, locale)
        recreate()
    }
}
