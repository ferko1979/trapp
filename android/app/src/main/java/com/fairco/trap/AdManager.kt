package com.fairco.trap

import android.app.Activity
import android.content.Context
import android.util.Log
import com.google.android.gms.ads.AdError
import com.google.android.gms.ads.AdRequest
import com.google.android.gms.ads.FullScreenContentCallback
import com.google.android.gms.ads.LoadAdError
import com.google.android.gms.ads.rewarded.RewardedAd
import com.google.android.gms.ads.rewarded.RewardedAdLoadCallback
import com.google.android.gms.ads.rewardedinterstitial.RewardedInterstitialAd
import com.google.android.gms.ads.rewardedinterstitial.RewardedInterstitialAdLoadCallback

/**
 * AdManager — rewarded interstitial shown at natural game-flow breaks
 * (e.g. after a successful trap placement). No user opt-in required.
 * Ad unit type: Rewarded Interstitial (TrappOne)
 */
object AdManager {

    private const val TAG = "AdManager"
    // Debug builds always use Google's test unit so we never click our own live ads.
    private val DEFAULT_UNIT_ID =
        if (BuildConfig.DEBUG) "ca-app-pub-3940256099942544/5354046379" else "ca-app-pub-6648859971587001/5582567533"

    @Volatile private var unitId = DEFAULT_UNIT_ID
    private var ad: RewardedInterstitialAd? = null
    private var isLoading = false

    /** Called on startup once backend settings are loaded. Clears cached ad if the ID changed. */
    fun configure(newUnitId: String) {
        if (BuildConfig.DEBUG || newUnitId.isBlank() || newUnitId == unitId) return
        unitId = newUnitId
        ad = null
        isLoading = false
    }

    fun preload(context: Context) {
        if (isLoading || ad != null) return
        isLoading = true
        RewardedInterstitialAd.load(
            context.applicationContext,
            unitId,
            AdRequest.Builder().build(),
            object : RewardedInterstitialAdLoadCallback() {
                override fun onAdLoaded(loaded: RewardedInterstitialAd) {
                    ad = loaded
                    isLoading = false
                }
                override fun onAdFailedToLoad(error: LoadAdError) {
                    Log.w(TAG, "Failed to load: ${error.message}")
                    ad = null
                    isLoading = false
                }
            }
        )
    }

    fun showIfReady(activity: Activity, onDone: () -> Unit = {}) {
        val current = ad
        if (current == null) {
            preload(activity)
            onDone()
            return
        }
        ad = null
        current.fullScreenContentCallback = object : FullScreenContentCallback() {
            override fun onAdDismissedFullScreenContent() {
                preload(activity)
                onDone()
            }
            override fun onAdFailedToShowFullScreenContent(error: AdError) {
                Log.w(TAG, "Failed to show: ${error.message}")
                preload(activity)
                onDone()
            }
        }
        current.show(activity) { /* reward not used for break placements */ }
    }
}

/**
 * RewardedAdManager — opt-in rewarded video shown when the user chooses to
 * watch an ad in exchange for a speed boost (reduced hold time).
 * Ad unit type: Rewarded (Video Banner)
 */
object RewardedAdManager {

    private const val TAG = "RewardedAdManager"
    // Debug builds always use Google's test unit so we never click our own live ads.
    private val DEFAULT_UNIT_ID =
        if (BuildConfig.DEBUG) "ca-app-pub-3940256099942544/5224354917" else "ca-app-pub-6648859971587001/8212356456"

    @Volatile private var unitId = DEFAULT_UNIT_ID
    private var ad: RewardedAd? = null
    private var isLoading = false

    /** Called on startup once backend settings are loaded. Clears cached ad if the ID changed. */
    fun configure(newUnitId: String) {
        if (BuildConfig.DEBUG || newUnitId.isBlank() || newUnitId == unitId) return
        unitId = newUnitId
        ad = null
        isLoading = false
    }

    fun preload(context: Context) {
        if (isLoading || ad != null) return
        isLoading = true
        RewardedAd.load(
            context.applicationContext,
            unitId,
            AdRequest.Builder().build(),
            object : RewardedAdLoadCallback() {
                override fun onAdLoaded(loaded: RewardedAd) {
                    ad = loaded
                    isLoading = false
                }
                override fun onAdFailedToLoad(error: LoadAdError) {
                    Log.w(TAG, "Failed to load: ${error.message}")
                    ad = null
                    isLoading = false
                }
            }
        )
    }

    fun isReady(): Boolean = ad != null

    /**
     * Shows the rewarded ad.
     * [onRewarded] fires only if the user watches and earns the reward.
     * [onNotAvailable] fires if no ad is ready yet.
     */
    fun show(
        activity: Activity,
        onRewarded: () -> Unit,
        onNotAvailable: () -> Unit = {},
    ) {
        val current = ad
        if (current == null) {
            preload(activity)
            onNotAvailable()
            return
        }
        ad = null
        var earned = false

        current.fullScreenContentCallback = object : FullScreenContentCallback() {
            override fun onAdDismissedFullScreenContent() {
                preload(activity)
                if (earned) onRewarded()
            }
            override fun onAdFailedToShowFullScreenContent(error: AdError) {
                Log.w(TAG, "Failed to show: ${error.message}")
                preload(activity)
                onNotAvailable()
            }
        }
        current.show(activity) { _ -> earned = true }
    }
}
