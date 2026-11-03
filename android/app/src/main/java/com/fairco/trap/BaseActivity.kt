package com.fairco.trap

import android.content.Context
import android.os.Bundle
import android.view.View
import androidx.appcompat.app.AppCompatActivity
import androidx.core.graphics.drawable.toDrawable
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import com.fairco.trap.util.BackendContextWrapper
import com.fairco.trap.ui.theme.Radar
import com.fairco.trap.util.LocaleManager
import androidx.compose.ui.graphics.toArgb

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
 *
 * Android 15+ (targetSdk 35+) always draws edge-to-edge, so the content view is
 * padded by the system bar / cutout / keyboard insets here. Screens that lay out
 * under the bars themselves (the full-bleed map) override [padForSystemBars].
 * Dark Radar screens set [radarBars] so the bar areas match the page instead of
 * showing the light window background with dark icons.
 */
abstract class BaseActivity : AppCompatActivity() {

    protected open val padForSystemBars: Boolean = true
    protected open val radarBars: Boolean = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (radarBars) {
            window.setBackgroundDrawable(Radar.Bg.toArgb().toDrawable())
            WindowCompat.getInsetsController(window, window.decorView).apply {
                isAppearanceLightStatusBars = false
                isAppearanceLightNavigationBars = false
            }
        }
        if (!padForSystemBars) return
        ViewCompat.setOnApplyWindowInsetsListener(findViewById<View>(android.R.id.content)) { v, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or
                    WindowInsetsCompat.Type.displayCutout() or
                    WindowInsetsCompat.Type.ime()
            )
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }
    }

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
