package com.fairco.trap.ui

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.appcompat.app.AlertDialog
import androidx.lifecycle.lifecycleScope
import com.fairco.trap.BaseActivity
import com.fairco.trap.BuildConfig
import com.fairco.trap.GameActivity
import com.fairco.trap.IntroActivity
import com.fairco.trap.LandingActivity
import com.fairco.trap.R
import com.fairco.trap.databinding.ActivitySplashBinding
import com.fairco.trap.util.LocaleManager
import com.fairco.trap.util.TranslationManager
import com.google.firebase.Firebase
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.firestore
import com.google.firebase.functions.functions
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeoutOrNull

@SuppressLint("CustomSplashScreen")
class SplashActivity : BaseActivity() {

    private lateinit var b: ActivitySplashBinding

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        b = ActivitySplashBinding.inflate(layoutInflater)
        setContentView(b.root)

        b.tvSplashVersion.text = getString(R.string.splash_version_format, BuildConfig.VERSION_NAME)

        b.logoRevealGroup.alpha = 1f
        b.tvSplashVersion.alpha = 0.5f

        try {
            b.logoRevealGroup.scaleX = 0.9f
            b.logoRevealGroup.scaleY = 0.9f
            b.logoRevealGroup.animate().scaleX(1f).scaleY(1f).setDuration(500).start()
        } catch (e: Exception) {
            // Ignore animation errors
        }

        lifecycleScope.launch {
            val locale = LocaleManager.getLocale(this@SplashActivity)
            // Run translation fetch and version check in parallel.
            val versionDeferred = async {
                withTimeoutOrNull(4000L) { checkAppVersion() }
            }
            withTimeoutOrNull(2000L) {
                TranslationManager.fetchIfNeeded(locale)
            }
            delay(1500L)
            val updateType = versionDeferred.await()
            if (!isFinishing) {
                when (updateType) {
                    UpdateType.FORCE -> showForceUpdateDialog()
                    UpdateType.SOFT  -> showSoftUpdateDialog()
                    else             -> navigate()
                }
            }
        }
    }

    private enum class UpdateType { FORCE, SOFT }

    private suspend fun checkAppVersion(): UpdateType? {
        return try {
            val result = Firebase.functions("europe-west1")
                .getHttpsCallable("getPublicGameSettings")
                .call()
                .await()
            val data = (result.getData() as? Map<*, *>)?.get("settings") as? Map<*, *>
                ?: return null
            val minCode = (data["minAndroidVersionCode"] as? Number)?.toInt() ?: 1
            val latestCode = (data["latestAndroidVersionCode"] as? Number)?.toInt() ?: 1
            val current = BuildConfig.VERSION_CODE
            when {
                minCode > 1 && current < minCode -> UpdateType.FORCE
                latestCode > 1 && current < latestCode -> UpdateType.SOFT
                else -> null
            }
        } catch (_: Exception) {
            null  // fail open — never block on network error
        }
    }

    private fun openPlayStore() {
        val packageName = packageName
        try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=$packageName")))
        } catch (_: Exception) {
            startActivity(Intent(Intent.ACTION_VIEW,
                Uri.parse("https://play.google.com/store/apps/details?id=$packageName")))
        }
    }

    private fun showForceUpdateDialog() {
        AlertDialog.Builder(this)
            .setTitle(getString(R.string.title_update_required))
            .setMessage(getString(R.string.msg_update_required))
            .setCancelable(false)
            .setPositiveButton(getString(R.string.action_update_now)) { _, _ -> openPlayStore() }
            .show()
    }

    private fun showSoftUpdateDialog() {
        AlertDialog.Builder(this)
            .setTitle(getString(R.string.title_update_available))
            .setMessage(getString(R.string.msg_update_available))
            .setCancelable(true)
            .setPositiveButton(getString(R.string.action_update_now)) { _, _ -> openPlayStore() }
            .setNegativeButton(getString(R.string.action_later)) { _, _ ->
                lifecycleScope.launch { if (!isFinishing) navigate() }
            }
            .setOnCancelListener {
                lifecycleScope.launch { if (!isFinishing) navigate() }
            }
            .show()
    }

    private suspend fun navigate() {
        val user = FirebaseAuth.getInstance().currentUser
        val locale = LocaleManager.apiLang(this)

        // Persist locale to Firestore so backend always knows the user's language
        if (user != null) {
            try {
                Firebase.firestore.collection("users").document(user.uid)
                    .update("locale", locale)
                    .await()
            } catch (_: Exception) { /* non-critical — doc may not exist yet */ }
        }

        when {
            IntroActivity.shouldShow(this) -> {
                launchActivity(Intent(this, IntroActivity::class.java))
            }
            user != null && user.isEmailVerified -> {
                val updatedVersion = checkTncVersion(user.uid)
                if (updatedVersion != null) {
                    showTncDialog(updatedVersion, user.uid)
                } else {
                    launchActivity(Intent(this, GameActivity::class.java))
                }
            }
            else -> {
                launchActivity(Intent(this, LandingActivity::class.java))
            }
        }
    }

    /**
     * Returns the new server TnC version if the user hasn't accepted it yet, null if up to date.
     * Fails open (returns null) so a backend outage never blocks gameplay.
     */
    private suspend fun checkTncVersion(uid: String): Long? {
        return try {
            val locale = LocaleManager.apiLang(this)
            val result = Firebase.functions("europe-west1")
                .getHttpsCallable("getTermsAndConditions")
                .call(hashMapOf("locale" to locale))
                .await()
            val data = result.getData() as? Map<*, *> ?: return null
            val serverVersion = (data["version"] as? Number)?.toLong() ?: return null

            val userDoc = Firebase.firestore.collection("users").document(uid).get().await()
            val acceptedVersion = userDoc.getLong("acceptedTermsVersion") ?: 0L

            if (serverVersion > acceptedVersion) serverVersion else null
        } catch (e: Exception) {
            null
        }
    }

    private fun showTncDialog(tncVersion: Long, uid: String) {
        AlertDialog.Builder(this)
            .setTitle(getString(R.string.title_tnc_updated))
            .setMessage(getString(R.string.msg_tnc_updated))
            .setCancelable(false)
            .setPositiveButton(getString(R.string.action_accept_continue)) { _, _ ->
                lifecycleScope.launch {
                    val saved = withTimeoutOrNull(5000L) {
                        try {
                            Firebase.firestore.collection("users").document(uid)
                                .update("acceptedTermsVersion", tncVersion)
                                .await()
                            true
                        } catch (_: Exception) { null }
                    }
                    if (saved == null) {
                        android.widget.Toast.makeText(
                            this@SplashActivity,
                            getString(R.string.auth_tnc_save_failed),
                            android.widget.Toast.LENGTH_SHORT
                        ).show()
                    }
                    launchActivity(Intent(this@SplashActivity, GameActivity::class.java))
                }
            }
            .setNegativeButton(getString(R.string.action_decline_logout)) { _, _ ->
                FirebaseAuth.getInstance().signOut()
                launchActivity(Intent(this, LandingActivity::class.java))
            }
            .show()
    }

    private fun launchActivity(intent: Intent) {
        startActivity(intent)
        if (android.os.Build.VERSION.SDK_INT >= 34) {
            overrideActivityTransition(
                android.app.Activity.OVERRIDE_TRANSITION_OPEN,
                android.R.anim.fade_in,
                android.R.anim.fade_out
            )
        } else {
            @Suppress("DEPRECATION")
            overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out)
        }
        finish()
    }

    override fun onDestroy() {
        super.onDestroy()
        b.root.removeCallbacks(null)
    }
}
