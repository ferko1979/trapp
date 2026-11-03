package com.fairco.trap

import android.Manifest
import com.fairco.trap.ui.theme.TrappTheme
import com.fairco.trap.util.LocaleManager
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.location.Location
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.ToneGenerator
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.widget.*
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.content.res.AppCompatResources
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.core.content.ContextCompat
import androidx.core.graphics.toColorInt
import androidx.core.graphics.drawable.DrawableCompat
import androidx.core.view.isVisible
import androidx.core.view.updateLayoutParams
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.fairco.trap.databinding.ActivityGameBinding
import com.google.android.gms.location.*
import com.google.android.gms.maps.CameraUpdateFactory
import com.google.android.gms.maps.GoogleMap
import com.google.android.gms.maps.OnMapReadyCallback
import com.google.android.gms.maps.SupportMapFragment
import com.google.android.gms.maps.model.*
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.ListenerRegistration
import com.google.firebase.firestore.firestore
import com.google.firebase.functions.functions
import com.google.firebase.Firebase
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import java.text.SimpleDateFormat
import java.util.*

data class TrapInventoryItem(
    val id: String,
    val trapTypeId: String,
    val bagCount: Int,
    val maxBagSlots: Int,
    val weight: Float,
    val effectiveRefillHours: Double,
    val secondsUntilNextRefill: Long?,
    val canRefillNow: Boolean,
    val blockedBySlots: Boolean,
    val blockedByWeight: Boolean,
    val name: String,
    val iconKey: String,
    val effectKind: String,
    /** Localized description from backend (may be empty) */
    val description: String = "",
    /** Emoji character from backend (e.g. "🪤", "💣", "⏱") — no Android hardcoding needed */
    val emoji: String = "",
    /** Firebase Storage or HTTPS URL for trap artwork (null = use emoji) */
    val imageUrl: String? = null,
    /** Sound asset key bundled in res/raw (null = silent) */
    val soundKey: String? = null,
    /** Next refill epoch ms (for server-sync validation) */
    val nextRefillAtEpochMs: Long? = null,
)

data class ProgressionLevel(
    val id: String,
    val levelNumber: Int,
    val name: String,
    val minXP: Int,
    val badgeKey: String,
    val active: Boolean,
    val minZoomLevel: Float = 14f
)

class GameActivity : BaseActivity(), OnMapReadyCallback {

    // The map is full-bleed; insets are handled per-control in finishSetup().
    override val padForSystemBars = false

    companion object {
        const val MAX_PLACEMENT_DISTANCE = 50f
        private const val TEST_BANNER_UNIT_ID = "ca-app-pub-3940256099942544/6300978111"

        /** True while the map screen is visible; the background service then stays quiet. */
        @Volatile var isInForeground = false
    }

    private lateinit var binding: ActivityGameBinding
    private val badgeVm: InboxBadgeViewModel by viewModels()
    private val gameVm: GameViewModel by viewModels()
    private val hud = MapHudState()
    private val settingsUi = SettingsUiState()
    private lateinit var auth: FirebaseAuth
    private lateinit var map: GoogleMap
    private lateinit var fusedLocationClient: FusedLocationProviderClient

    private var userListener: ListenerRegistration? = null
    private var trapsListener: ListenerRegistration? = null
    private val placedTrapMarkers = mutableListOf<Marker>()
    private var lastTrapsSnapshot: List<DocumentSnapshot>? = null

    private var selectedTrapLatLng: LatLng? = null
    private var selectedTrapMarker: Marker? = null
    // Stored when placement/disassembly starts so we can update the map immediately on completion
    private var pendingPlacementLatLng: LatLng? = null
    private var pendingDisassembleTrapId: String? = null
    private var currentLocation: Location? = null

    private var isGpsRunning = false
    // True once the camera has been moved onto a real position of the player.
    private var cameraCentered = false
    private var consecutiveFailures = 0
    private var isSoundEnabled = true
    private var lastSonarPingMs = 0L
    private var lastOrangePingMs = 0L
    private var sonarTone: ToneGenerator? = null
    private var isReloadingMap = false

    private var currentDisplayName: String = ""
    private var currentUsername: String? = null

    private var lastCapturedUsername: String? = null
    private var lastCapturedUserId: String? = null

    private var currentUserXP: Int = 0
    private var currentUserScore: Int = 0
    private var currentUserLevelNumber: Int = 1
    private var currentUserLevelName: String = ""
    private var progressionLevels: List<ProgressionLevel> = emptyList()

    private var locationCallback: LocationCallback? = null

    private val functions by lazy { Firebase.functions("europe-west1") }
    private val disarmVm: TrapDisarmViewModel by viewModels()
    private var mediaPlayer: MediaPlayer? = null

    private var mapReady = false
    private var myTrapsListener: ListenerRegistration? = null
    private var myTrapsSnapshot: List<DocumentSnapshot> = emptyList()

    private var heartbeatJob: Runnable? = null
    private val heartbeatHandler = Handler(Looper.getMainLooper())

    // Stored so bagCard layout-change listener can compute the correct ad position
    private var navBarBottomInset = 0

    // Heatmap (#16)
    private var heatmapOverlay: com.google.android.gms.maps.model.TileOverlay? = null
    private var heatmapVisible = false

    // Home base safe zone
    private var homeBaseCircle: com.google.android.gms.maps.model.Circle? = null
    private var homeBaseLat: Double? = null
    private var homeBaseLng: Double? = null
    private var wasInSafeZone = false

    // Compass sensor — tracks device heading for the TrapCompassOverlay
    private var sensorManager: android.hardware.SensorManager? = null
    private val compassAzimuth = mutableFloatStateOf(0f)

    private val locationPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { permissions ->
            val fine = permissions[Manifest.permission.ACCESS_FINE_LOCATION] == true
            val coarse = permissions[Manifest.permission.ACCESS_COARSE_LOCATION] == true

            if (fine || coarse) {
                enableMyLocationOnMap()
                fetchLastKnownLocation()
                startGpsUpdates()
                startTrackingService()
            } else {
                toast(getString(R.string.error_location_denied))
            }
            requestNotificationPermissionIfNeeded()
        }

    private val notificationPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { /* trap alerts just stay silent if denied */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        val prefs = getSharedPreferences("Settings", MODE_PRIVATE)
        isSoundEnabled = prefs.getBoolean("Sound_Enabled", true)

        super.onCreate(savedInstanceState)

        auth = FirebaseAuth.getInstance()
        val user = auth.currentUser
        if (user == null) {
            startActivity(Intent(this, LandingActivity::class.java))
            finish()
            return
        }

        if (!user.isEmailVerified) {
            // Token might be stale (user just verified, or admin approved).
            // Force a refresh before blocking — if the fresh token confirms verified, proceed.
            user.getIdToken(/* forceRefresh= */ true)
                .addOnSuccessListener {
                    val freshUser = auth.currentUser
                    if (freshUser != null && freshUser.isEmailVerified) {
                        finishSetup()
                    } else {
                        auth.signOut()
                        Toast.makeText(this, getString(R.string.error_email_not_verified), Toast.LENGTH_LONG).show()
                        startActivity(Intent(this, LandingActivity::class.java))
                        finish()
                    }
                }
                .addOnFailureListener {
                    auth.signOut()
                    Toast.makeText(this, getString(R.string.error_email_not_verified), Toast.LENGTH_LONG).show()
                    startActivity(Intent(this, LandingActivity::class.java))
                    finish()
                }
            return
        }

        finishSetup()
    }

    private val baseTopMargins = HashMap<android.view.View, Int>()

    /** Shifts every top-aligned direct child of the map screen down by [inset] px. */
    private fun applyTopInset(inset: Int) {
        val root = binding.root
        for (i in 0 until root.childCount) {
            val child = root.getChildAt(i)
            val lp = child.layoutParams as? androidx.coordinatorlayout.widget.CoordinatorLayout.LayoutParams ?: continue
            if (lp.height == android.view.ViewGroup.LayoutParams.MATCH_PARENT || lp.anchorId != android.view.View.NO_ID) continue
            val vertical = lp.gravity and android.view.Gravity.VERTICAL_GRAVITY_MASK
            if (lp.gravity != android.view.Gravity.NO_GRAVITY && vertical != android.view.Gravity.TOP) continue
            val base = baseTopMargins.getOrPut(child) { lp.topMargin }
            if (lp.topMargin != base + inset) {
                lp.topMargin = base + inset
                child.layoutParams = lp
            }
        }
    }

    private fun finishSetup() {
        // Record email verification timestamp the first time the verified user opens the app.
        functions.getHttpsCallable("syncMyEmailVerification").call()
            .addOnFailureListener { /* non-critical, ignore */ }

        binding = ActivityGameBinding.inflate(layoutInflater)
        setContentView(binding.root)

        // Push bag card above the system navigation bar (tablets + gesture nav)
        androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(binding.root) { _, windowInsets ->
            val navInsets = windowInsets.getInsets(androidx.core.view.WindowInsetsCompat.Type.navigationBars())
            navBarBottomInset = navInsets.bottom
            // Edge-to-edge (Android 15+): keep the top-aligned overlays below the status bar / cutout.
            val topInset = windowInsets.getInsets(
                androidx.core.view.WindowInsetsCompat.Type.statusBars() or
                    androidx.core.view.WindowInsetsCompat.Type.displayCutout()
            ).top
            applyTopInset(topInset)
            // The bottom dock pads its tab bar above the nav bar itself.
            hud.navInsetPx = navBarBottomInset
            updateBannerAdPosition()
            windowInsets
        }
        // Reposition ad + right-side controls whenever the dock or ad container resizes
        binding.composeBottomDock.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ ->
            updateBannerAdPosition()
        }
        binding.bannerAdContainer.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ ->
            updateBannerAdPosition()
        }

        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this)

        saveFcmToken(auth.currentUser!!.uid)

        checkGooglePlayServices()
        bindActions()
        setupMap()
        loadGameData()
        setupBagBottomSheet()
        setupPlacementOverlay()
        setupDisassembleOverlay()
        setupTrappedOverlay()
        setupTrapCompass()
        requestLocationPermissionsIfNeeded()
        checkMapsApiKey()
        observeDisarmState()
        handleOpenDisarm(intent)
observeTheme()
        observeBagLoading()
        observePlacementPhase()
        observePlacementProgress()
        observeDisassemble()
        gameVm.fetchAdSettings()
        gameVm.fetchCardInventory()
        requestConsentAndInitializeAds()
        observeBannerAd()
        setupRewardOverlay()
        setupCaptureVictoryOverlay()
        gameVm.claimLoginReward()
    }

    private fun setupBagBottomSheet() {
        val settingsPrefs = getSharedPreferences("Settings", MODE_PRIVATE)
        if (settingsPrefs.getBoolean("reopen_settings", false)) {
            settingsPrefs.edit().remove("reopen_settings").apply()
            showSettingsDialog()
        }
        binding.composeTopHud.setContent { TrappTheme {
            val unread by badgeVm.unreadCount.collectAsState()
            MapTopHud(
                hud = hud,
                unreadCount = unread,
                onLevelClick = { showProfileEditDialog() },
                onLevelLongClick = {
                    toast(getString(R.string.msg_zoom_level_info, gameVm.bagState.value.mapMinZoom.toInt()))
                },
                onNearbyClick = {
                    when {
                        disarmVm.disarmState.value !is DisarmState.Idle ->
                            TrapAlertBottomSheet.show(supportFragmentManager)
                        hud.nearbyCount > 0 ->
                            toast(getString(R.string.mh_near_toast, hud.nearbyCount))
                        else -> toast(getString(R.string.mh_near_none_toast))
                    }
                },
                onBellClick = { startActivity(Intent(this@GameActivity, InboxActivity::class.java)) },
            )
        } }

        binding.composeBottomDock.setContent { TrappTheme {
            val bag by gameVm.bagState.collectAsState()
            val phase by gameVm.placementPhase.collectAsState()
            val density = androidx.compose.ui.platform.LocalDensity.current
            MapBottomDock(
                hud = hud,
                items = bag.items,
                loading = bag.loading,
                targetSet = phase == PlacementPhase.AWAITING_TRAP,
                navInset = with(density) { hud.navInsetPx.toDp() },
                onOpenPicker = { hud.pickerOpen = true },
                onPlace = { item -> startPlacementFromDock(item) },
                onCancelTarget = { gameVm.cancelPlacement() },
                onTab = { tab ->
                    when (tab) {
                        MapTab.MAP -> centerOnMyLocation()
                        MapTab.BAG -> hud.pickerOpen = true
                        MapTab.RANK -> startActivity(Intent(this@GameActivity, RankingActivity::class.java))
                        MapTab.SOCIAL -> startActivity(Intent(this@GameActivity, FriendsActivity::class.java))
                        MapTab.ME -> hud.meOpen = true
                    }
                },
            )
            if (hud.pickerOpen) {
                TrapPickerSheet(
                    viewModel = gameVm,
                    onDismiss = { hud.pickerOpen = false },
                    onPlaceTrap = { item ->
                        hud.pickerOpen = false
                        startPlacementFromDock(item)
                    },
                    onWatchRefillAd = { trapTypeId ->
                        showRefillRewardedAd(trapTypeId) {
                            val lang = LocaleManager.apiLang(this@GameActivity)
                            gameVm.loadBag(lang = lang)
                        }
                    },
                    onOpenAwards = { startActivity(Intent(this@GameActivity, AwardsActivity::class.java)) },
                    selectedTrapTypeId = resolveSelectedTrap(bag.items, hud.selectedTrapTypeId)?.trapTypeId,
                    onSelectTrap = { hud.selectedTrapTypeId = it.trapTypeId },
                )
            }
            if (hud.meOpen) {
                val unread by badgeVm.unreadCount.collectAsState()
                MeSheet(hud = hud, unreadCount = unread, onAction = ::onMeAction, onDismiss = { hud.meOpen = false })
            }
            if (hud.layersOpen) {
                val dark by ThemeManager.isDarkMode.collectAsState()
                LayersSheet(
                    heatmapOn = settingsUi.heatmap,
                    darkMap = dark,
                    onToggleHeatmap = { toggleHeatmap(); settingsUi.heatmap = heatmapVisible },
                    onToggleDark = { ThemeManager.toggleManualOverride() },
                    onReload = { hud.layersOpen = false; reloadMapTraps(showFeedback = true) },
                    onDismiss = { hud.layersOpen = false },
                )
            }
            if (hud.settingsOpen) {
                val membership by gameVm.membershipState.collectAsState()
                SettingsSheet(
                    lang = settingsUi.lang,
                    theme = settingsUi.theme,
                    sound = settingsUi.sound,
                    notifications = settingsUi.notifications,
                    hideFromNearby = settingsUi.hideFromNearby,
                    showUpgrade = !(membership.membership == "paid" && !membership.isExpired),
                    versionName = packageManager.getPackageInfo(packageName, 0).versionName ?: "",
                    onLang = ::applyLanguageSetting,
                    onTheme = { mode -> settingsUi.theme = mode; ThemeManager.setMode(mode) },
                    onSound = ::applySoundSetting,
                    onNotifications = ::applyNotificationsSetting,
                    onHideFromNearby = ::applyHideFromNearby,
                    onUpgrade = {
                        hud.settingsOpen = false
                        startActivity(Intent(this@GameActivity, SubscriptionActivity::class.java))
                    },
                    onChangeEmail = { hud.settingsOpen = false; showEmailChangeTicketDialog() },
                    onSupport = {
                        hud.settingsOpen = false
                        startActivity(Intent(this@GameActivity, SupportTicketsActivity::class.java))
                    },
                    onDeleteAccount = { hud.settingsOpen = false; confirmDeleteAccount() },
                    onDismiss = { hud.settingsOpen = false },
                )
            }
        } }

        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                while (true) {
                    kotlinx.coroutines.delay(1000)
                    val currentLang = LocaleManager.apiLang(this@GameActivity)
                    gameVm.tickRefillCountdowns(lang = currentLang)
                }
            }
        }
    }

    /** PLACE: arms at the tapped map target, or where the player stands. */
    private fun startPlacementFromDock(item: TrapInventoryItem) {
        if (gameVm.placementPhase.value == PlacementPhase.PLACING) return
        if (item.bagCount <= 0) {
            hud.pickerOpen = true
            return
        }
        val target = selectedTrapLatLng
            ?: currentLocation?.let { LatLng(it.latitude, it.longitude) }
        if (target == null) {
            toast(getString(R.string.mh_gps_wait_toast))
            return
        }
        hud.selectedTrapTypeId = item.trapTypeId
        hud.placementInfo = placementTargetInfo(target)
        selectedTrapLatLng = target
        gameVm.onTrapChosenForPlacement(item)
    }

    /** Neutral context for the hold sheet; the server decides whether the spot is allowed. */
    private fun placementTargetInfo(target: LatLng): String? {
        fun distTo(doc: DocumentSnapshot): Float? {
            if (doc.getString("status") != "active") return null
            val lat = doc.getDouble("lat") ?: return null
            val lng = doc.getDouble("lng") ?: return null
            val d = FloatArray(1)
            Location.distanceBetween(target.latitude, target.longitude, lat, lng, d)
            return d[0]
        }
        val nearest = (lastTrapsSnapshot.orEmpty() + myTrapsSnapshot).mapNotNull { distTo(it) }.minOrNull()
        val mineNear = myTrapsSnapshot.count { (distTo(it) ?: Float.MAX_VALUE) <= 200f }
        val parts = mutableListOf<String>()
        if (nearest != null) parts += getString(R.string.mh_nearest, nearest.toInt())
        if (mineNear > 0) parts += getString(R.string.mh_yours_near, mineNear)
        return parts.joinToString("  ·  ").ifBlank { null }
    }

    private fun setupPlacementOverlay() {
        binding.composePlacementOverlay.setContent { TrappTheme {
            val phase by gameVm.placementPhase.collectAsState()
            val trap by gameVm.selectedTrapForPlacement.collectAsState()
            val progress by gameVm.placementProgress.collectAsState()
            val startError by gameVm.placementStartError.collectAsState()
            val adSettings by gameVm.adSettings.collectAsState()
            val adUses by gameVm.placementAdUses.collectAsState()
            val membership by gameVm.membershipState.collectAsState()
            val cardCount by gameVm.unusedTimeCardCount.collectAsState()
            val isPaid = membership.membership == "paid" && !membership.isExpired
            val rewardedEffectivelyEnabled = adSettings.rewardedAdEnabled && !(isPaid && membership.disableRewardedAd)

            when {
                phase == PlacementPhase.PLACING && progress != null -> {
                    PlacementProgressOverlay(
                        trap = trap,
                        state = progress!!,
                        onCancel = { gameVm.cancelActivePlacement() },
                        rewardedAdEnabled = rewardedEffectivelyEnabled,
                        rewardedLabel = formatReductionLabel(adSettings),
                        adUsesRemaining = (adSettings.rewardedMaxUsesPerSession - adUses).coerceAtLeast(0),
                        onWatchAd = {
                            showRewardedAdPreRoll(isPlacement = true)
                        },
                        cardCount = cardCount,
                        onUseCard = { gameVm.useTimeDeductionCard("placement") }
                    )
                }
                phase == PlacementPhase.CONFIRMING && trap != null -> {
                    val density = androidx.compose.ui.platform.LocalDensity.current
                    PlacementHoldOverlay(
                        trap = trap!!,
                        startError = startError,
                        targetInfo = hud.placementInfo,
                        navInset = with(density) { hud.navInsetPx.toDp() },
                        onConfirm = {
                            val latLng = selectedTrapLatLng ?: run {
                                gameVm.cancelPlacement()
                                return@PlacementHoldOverlay
                            }
                            val confirmedTrap = gameVm.selectedTrapForPlacement.value ?: run {
                                gameVm.cancelPlacement()
                                return@PlacementHoldOverlay
                            }
                            placeSelectedTrapBackground(latLng, confirmedTrap.trapTypeId)
                        },
                        onCancel = { gameVm.cancelPlacement() },
                        onClose = { gameVm.dismissPlacementStartError() }
                    )
                }
            }
        } }
    }

    private fun observeBagLoading() {
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                gameVm.bagState.collect { state ->
                    if (!state.loading && mapReady) hideLoadingOverlay()
                    // Apply map zoom limit from the user's membership level.
                    // Resolved by backend: user_levels.mapMinZoom
                    //   → game_settings.defaultMapMinZoom → 10
                    if (mapReady && !state.loading) {
                        map.setMinZoomPreference(state.mapMinZoom)
                    }
                }
            }
        }
    }

    private fun observePlacementPhase() {
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                var previousPhase: PlacementPhase? = null
                gameVm.placementPhase.collect { phase ->
                    val overlayUp = phase == PlacementPhase.CONFIRMING || phase == PlacementPhase.PLACING
                    binding.composePlacementOverlay.isVisible = overlayUp
                    // The hold sheet owns the screen — hide the map chrome behind it.
                    binding.composeTopHud.isVisible = !overlayUp
                    binding.radarCard.isVisible = !overlayUp
                    binding.rightSideControls.isVisible = !overlayUp
                    if (phase == PlacementPhase.IDLE) {
                        selectedTrapMarker?.remove()
                        selectedTrapMarker = null
                        selectedTrapLatLng = null
                    }
                    // No interstitial at CONFIRMING — it fires immediately on top of the hold
                    // button overlay which disrupts UX. Interstitial is shown after successful
                    // placement (in observePlacementProgress) as a natural content break.
                    previousPhase = phase
                }
            }
        }
    }

    private fun observePlacementProgress() {
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                var optimisticMarkerAdded = false
                gameVm.placementProgress.collect { state ->
                    if (state?.isWaitingForServer == true && !optimisticMarkerAdded) {
                        optimisticMarkerAdded = true
                        // Optimistically add green marker so the trap appears immediately
                        // (Firestore real-time listener will replace it within ~1-2 s)
                        pendingPlacementLatLng?.let { ll ->
                            if (::map.isInitialized) {
                                val m = map.addMarker(
                                    com.google.android.gms.maps.model.MarkerOptions()
                                        .position(ll)
                                        .title(getString(R.string.label_your_trap))
                                        .icon(com.google.android.gms.maps.model.BitmapDescriptorFactory
                                            .defaultMarker(com.google.android.gms.maps.model.BitmapDescriptorFactory.HUE_GREEN))
                                )
                                if (m != null) placedTrapMarkers.add(m)
                            }
                            pendingPlacementLatLng = null
                        }
                    }
                    if (state?.isComplete == true) {
                        optimisticMarkerAdded = false
                        playSound("placed")
                        val hapticConst = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R)
                            android.view.HapticFeedbackConstants.CONFIRM
                        else
                            android.view.HapticFeedbackConstants.VIRTUAL_KEY
                        window.decorView.performHapticFeedback(hapticConst)
                        toast(getString(R.string.success_trap_placed))
                        // Natural break: show interstitial after a trap is successfully placed.
                        val membership = gameVm.membershipState.value
                        val isPaid = membership.membership == "paid" && !membership.isExpired
                        val ads = gameVm.adSettings.value
                        if (ads.interstitialAdEnabled && !(isPaid && membership.disableInterstitialAd)) {
                            AdManager.showIfReady(this@GameActivity)
                        }
                        gameVm.loadBag(lang = LocaleManager.apiLang(this@GameActivity))
                        reloadMapTraps()
                        gameVm.dismissPlacementProgress()
                    }
                    state?.error?.let { err ->
                        if (err.isNotEmpty()) {
                            toast(getString(R.string.error_placement_failed, err))
                            gameVm.dismissPlacementProgress()
                        }
                    }
                }
            }
        }
    }

    private fun hideLoadingOverlay() {
        if (binding.loadingOverlay.isVisible) {
            binding.loadingOverlay.animate()
                .alpha(0f)
                .setDuration(500)
                .withEndAction { binding.loadingOverlay.isVisible = false }
                .start()
        }
    }

    private fun observeTheme() {
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                ThemeManager.isDarkMode.collect { isDark ->
                    // Style the banner ad container to match the current theme
                    if (isDark) {
                        binding.bannerAdContainer.setBackgroundColor(0xFF0E1828.toInt())
                        binding.bannerAdTopBorder.setBackgroundColor(0xFF22385A.toInt())
                    } else {
                        binding.bannerAdContainer.setBackgroundColor(0xFFFFFFFF.toInt())
                        binding.bannerAdTopBorder.setBackgroundColor(0xFFEAF1FA.toInt())
                    }

                    if (::map.isInitialized) {
                        updateMapStyle(isDark)
                    }
                }
            }
        }
    }

    private fun updateMapStyle(isDark: Boolean) {
        if (isDark) {
            map.setMapStyle(MapStyleOptions.loadRawResourceStyle(this, R.raw.map_style_dark))
        } else {
            map.setMapStyle(null)
        }
    }

    private fun observeDisarmState() {
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                disarmVm.disarmState.collect { state ->
                    when (state) {
                        is DisarmState.NearbyDetected -> {
                            binding.btnDisarmNearby.isVisible = true
                            if (isSoundEnabled) {
                                if (sonarTone == null) sonarTone = ToneGenerator(AudioManager.STREAM_ALARM, 90)
                                sonarTone?.startTone(ToneGenerator.TONE_PROP_BEEP2, 400)
                            }
                            TrapAlertBottomSheet.show(supportFragmentManager)
                        }
                        is DisarmState.DisarmComplete -> {
                            binding.btnDisarmNearby.isVisible = false
                            playSound("disarmed")
                        }
                        is DisarmState.Idle -> {
                            binding.btnDisarmNearby.isVisible = false
                        }
                        else -> {
                            binding.btnDisarmNearby.isVisible = true
                        }
                    }
                }
            }
        }
    }

    private fun checkGooglePlayServices() {
        try {
            val availability = com.google.android.gms.common.GoogleApiAvailability.getInstance()
            val resultCode = availability.isGooglePlayServicesAvailable(this)
            if (resultCode != com.google.android.gms.common.ConnectionResult.SUCCESS) {
                if (availability.isUserResolvableError(resultCode)) {
                    availability.getErrorDialog(this, resultCode, 9000)?.show()
                } else {
                    toast(getString(R.string.error_gms_unavailable))
                }
            }
        } catch (e: Exception) {
            Log.e("GameActivity", "Error checking Google Play Services: ${e.message}", e)
        }
    }

    private fun checkMapsApiKey() {
        try {
            val ai = packageManager.getApplicationInfo(packageName, PackageManager.GET_META_DATA)
            val bundle = ai.metaData
            val key = bundle.getString("com.google.android.geo.API_KEY")
            
if (key.isNullOrEmpty() || key.contains("\${MAPS_API_KEY}") || key == "MISSING_MAPS_API_KEY") {
                Log.e("GameActivity", "CRITICAL: Google Maps API Key is missing!")
                AlertDialog.Builder(this)
                    .setTitle("Map Error: No API Key")
                    .setMessage("The map cannot load because the Google Maps API Key is missing. \\n\\nPlease add MAPS_API_KEY=your_key to your local.properties file and rebuild the app.")
                    .setPositiveButton("OK", null)
                    .setCancelable(false)
                    .show()
            }
        } catch (e: Exception) {
            Log.e("GameActivity", "Error checking Maps API Key: ${e.message}", e)
        }
    }

    override fun onStart() {
        super.onStart()
        badgeVm.startPolling()
    }

    override fun onStop() {
        super.onStop()
        badgeVm.stopPolling()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (::binding.isInitialized) handleOpenDisarm(intent)
    }

    /** Proximity-notification tap / "Disarm" action: open the disarm sheet. */
    private fun handleOpenDisarm(intent: Intent?) {
        if (intent?.getStringExtra(TrapProximityNotifier.EXTRA_OPEN_DISARM) == null) return
        intent.removeExtra(TrapProximityNotifier.EXTRA_OPEN_DISARM)
        // When idle the sheet opens by itself on the first NearbyDetected after the next fix.
        if (disarmVm.disarmState.value !is DisarmState.Idle) {
            TrapAlertBottomSheet.show(supportFragmentManager)
        }
    }

    override fun onResume() {
        super.onResume()
        isInForeground = true
if (isTrackingServiceRunning()) {
            binding.btnToggleRadar.setImageResource(android.R.drawable.ic_media_pause)
        }
        consecutiveFailures = 0
        if (hasLocationPermission()) {
            startGpsUpdates()
        }
        startCompassSensor()
        val lang = LocaleManager.apiLang(this@GameActivity)
        gameVm.loadBag(lang = lang)
        gameVm.fetchCardInventory()
        // Re-check membership every time the app comes to the foreground so that
        // any backend revocation that happened while the app was in the background
        // is picked up immediately (the Firestore listener may have been paused).
        gameVm.checkMembership(lang = lang)
        // Show the TrappedOverlay if the background service captured us while the
        // app was not in the foreground (event stored as JSON in SharedPreferences).
        checkAndShowPendingTrappedEvent()
        // Show the CaptureVictoryOverlay if our trap fired while the app was backgrounded.
        checkAndShowPendingCaptureVictoryEvent()
        // Claim any hourly Day-1 rewards that became due while the app was closed/backgrounded
        claimDueHourlyRewards()
        checkForUpdate()
    }

    /**
     * Called from [onResume] to display any [TrappedEvent] that was detected by
     * [LocationTrackingService] while the app was in the background.
     */
    private fun checkAndShowPendingTrappedEvent() {
        val prefs = getSharedPreferences("Settings", MODE_PRIVATE)
        val json = prefs.getString("pending_trapped_event", null)?.takeIf { it.isNotBlank() }
            ?: return
        prefs.edit().remove("pending_trapped_event").apply()

        try {
            val j = org.json.JSONObject(json)
            val evt = TrappedEvent(
                trapTypeId    = j.optString("trapTypeId"),
                iconKey       = j.optString("iconKey"),
                emoji         = j.optString("emoji"),
                imageUrl      = j.optString("imageUrl").takeIf { it.isNotBlank() },
                soundKey      = j.optString("soundKey").takeIf { it.isNotBlank() },
                effectKind    = j.optString("effectKind"),
                effectValue   = j.optDouble("effectValue", 0.0),
                ownerUid      = j.optString("ownerUid"),
                ownerUsername = j.optString("ownerUsername")
            )
            if (gameVm.trappedEvent.value == null) {
                gameVm.showTrappedEvent(evt)
                val sndKey = evt.soundKey ?: when (evt.effectKind) {
                    "timeout"  -> "trapped_timeout"
                    "laughter" -> "trapped_laughter"
                    else       -> "trapped"
                }
                playSound(sndKey)
            }
        } catch (e: Exception) {
            Log.w("GameActivity", "Failed to parse pending trapped event: ${e.message}")
        }
    }

    override fun onPause() {
        super.onPause()
        isInForeground = false
stopHeartbeat()
        currentLocation?.let { saveLastLocation(it) }
        stopGpsUpdates()
        stopCompassSensor()
    }

    private fun isTrackingServiceRunning(): Boolean {
        return LocationTrackingService.isRunning
    }

    private fun toggleTrackingService() {
        if (isTrackingServiceRunning()) {
            stopTrackingService()
        } else {
            startTrackingService()
        }
    }

    private fun startTrackingService() {
        val intent = Intent(this, LocationTrackingService::class.java)
        ContextCompat.startForegroundService(this, intent)
        binding.btnToggleRadar.setImageResource(android.R.drawable.ic_media_pause)
        startHeartbeat()
        updateUserTimeZoneOnce()
    }

    private fun stopTrackingService() {
        val intent = Intent(this, LocationTrackingService::class.java)
        stopService(intent)
        binding.btnToggleRadar.setImageResource(android.R.drawable.ic_media_play)
        stopHeartbeat()
    }

    private fun bindActions() {
        binding.btnDisarmNearby.setOnClickListener {
            TrapAlertBottomSheet.show(supportFragmentManager)
        }
        binding.btnLayers.setOnClickListener { hud.layersOpen = true }
        binding.btnToggleRadar.setOnClickListener { toggleTrackingService() }
        binding.myLocationButton.setOnClickListener { centerOnMyLocation() }
    }

    /** "Me" sheet actions — everything account-related that has no tab of its own. */
    private fun onMeAction(action: MeAction) {
        hud.meOpen = false
        when (action) {
            MeAction.PROFILE -> showProfileEditDialog()
            MeAction.AWARDS -> startActivity(Intent(this, AwardsActivity::class.java))
            MeAction.HISTORY -> startActivity(Intent(this, CaptureHistoryActivity::class.java))
            MeAction.INBOX -> startActivity(Intent(this, InboxActivity::class.java))
            MeAction.SETTINGS -> showSettingsDialog()
            MeAction.LOGOUT -> {
                auth.signOut()
                startActivity(Intent(this, LandingActivity::class.java))
                finish()
            }
        }
    }

    private fun sendFriendRequest(userId: String) {
        functions.getHttpsCallable("sendFriendRequest")
            .call(mapOf("toUid" to userId))
            .addOnSuccessListener { toast(getString(R.string.msg_friend_request_sent)) }
            .addOnFailureListener { e -> toast(getString(R.string.error_action_failed, e.message ?: "")) }
    }

    private fun startDirectMessage(userId: String) {
        functions.getHttpsCallable("getOrCreateConversation")
            .call(mapOf("otherUid" to userId))
            .addOnSuccessListener { result ->
                val data = result.getData() as? Map<*, *>
                val convId = data?.get("conversationId") as? String
                if (convId != null) {
                    val intent = Intent(this, ChatActivity::class.java)
                    intent.putExtra("conversationId", convId)
                    intent.putExtra("otherUid", userId)
                    startActivity(intent)
                }
            }
    }


    private fun loadGameData() {
        val lang = LocaleManager.apiLang(this@GameActivity)
        observeCurrentUser()
        loadProgressionLevels()
        observePlacedTraps()
        observeMyTraps()
        gameVm.loadBag(lang = lang)
        // Start hourly membership verification (also fires immediately on first call)
        gameVm.startHourlyMembershipCheck(lang = lang)
        observeMembershipState()
    }

    /**
     * Observes [GameViewModel.membershipState] and reacts to membership changes:
     * - Updates the membership badge chip immediately on each state change.
     * - When membership lapses (paid → free), shows a toast and the map zoom
     *   is automatically updated by [observeBagLoading] once the bag reloads.
     */
    private fun observeMembershipState() {
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                gameVm.membershipState.collect { state ->
                    // Keep the badge in sync regardless of who triggered the change
                    updateMembershipBadge(state)
                    if (!state.loading && state.isExpired && state.membership != "free") {
                        // Membership has expired but the backend hasn't downgraded yet —
                        // local notice only; the scheduled guard will downgrade server-side.
                        toast(getString(R.string.msg_membership_expired))
                    }
                }
            }
        }
    }

    private fun updateMembershipBadge(state: com.fairco.trap.MembershipState) {
        val label = when {
            state.loading  -> "—"
            state.isExpired -> "⚠ ${state.levelDisplayName} ${getString(R.string.label_member)}"
            else            -> "${state.levelDisplayName} ${getString(R.string.label_member)}"
        }
        hud.membershipLabel = if (state.loading) null else label
        hud.membershipPaid = state.membership == "paid" && !state.isExpired
    }

    private fun observeCurrentUser() {
        val uid = auth.currentUser?.uid ?: return
        var previousMembership: String? = null
        userListener = Firebase.firestore.collection("users").document(uid)
            .addSnapshotListener { snapshot, e ->
                if (e != null || snapshot == null) return@addSnapshotListener

                currentDisplayName = snapshot.getString("displayName") ?: getString(R.string.default_display_name)
                currentUsername = snapshot.getString("username")
                hud.displayName = currentDisplayName
                hud.username = currentUsername
                hud.photoUrl = snapshot.getString("photoUrl")

                currentUserXP = snapshot.getLong("xp")?.toInt() ?: 0
                currentUserScore = currentUserXP
                currentUserLevelNumber = snapshot.getLong("level")?.toInt() ?: 1
                // Store the backend's level name, but leave it blank (not "Novice")
                // when the field isn't set — updateUiWithUserData uses a better fallback.
                currentUserLevelName = snapshot.getString("levelName")?.takeIf { it.isNotBlank() } ?: ""

                lastCapturedUsername = snapshot.getString("lastCapturedUsername")
                lastCapturedUserId = snapshot.getString("lastCapturedUserId")

                @Suppress("UNCHECKED_CAST")
                val hb = snapshot.get("homeBase") as? Map<String, Any>
                val hbLat = (hb?.get("lat") as? Number)?.toDouble()
                val hbLng = (hb?.get("lng") as? Number)?.toDouble()
                val hbRadius = ((hb?.get("radiusMeters") as? Number)?.toDouble() ?: 100.0)
                if (hbLat != null && hbLng != null) {
                    homeBaseLat = hbLat
                    homeBaseLng = hbLng
                    drawHomeBaseCircle(hbLat, hbLng, hbRadius)
                } else {
                    homeBaseLat = null
                    homeBaseLng = null
                    homeBaseCircle?.remove()
                    homeBaseCircle = null
                }

                // Detect membership change (e.g. payment lapse revoked by backend guard).
                val membership = snapshot.getString("membership") ?: "free"
                if (previousMembership != null && previousMembership != membership) {
                    val lang = LocaleManager.apiLang(this@GameActivity)
                    // Force bag reload so mapMinZoom is updated immediately.
                    gameVm.loadBag(lang = lang)
                    if (membership == "free") {
                        toast(getString(R.string.msg_membership_revoked))
                    }
                }
                previousMembership = membership

                updateUiWithUserData()
            }
    }

    private fun loadProgressionLevels() {
        Firebase.firestore.collection("player_progression_levels")
            .orderBy("levelNumber")
            .get()
            .addOnSuccessListener { result ->
                progressionLevels = result.map { doc ->
                    ProgressionLevel(
                        id = doc.id,
                        levelNumber = doc.getLong("levelNumber")?.toInt() ?: 0,
                        name = doc.getString("name") ?: "",
                        minXP = doc.getLong("minXP")?.toInt() ?: 0,
                        badgeKey = doc.getString("badgeKey") ?: "",
                        active = doc.getBoolean("active") ?: true,
                        minZoomLevel = (doc.getDouble("minZoomLevel") ?: 14.0).toFloat()
                    )
                }
                updateUiWithUserData()
            }
            .addOnFailureListener { e ->
                Log.w("GameActivity", "loadProgressionLevels failed: ${e.message}", e)
                // Proceed with empty list — UI falls back to levelName from users/{uid}
                updateUiWithUserData()
            }
    }

    private fun observePlacedTraps() {
        trapsListener = Firebase.firestore.collection("traps")
            .whereEqualTo("status", "active")
            .addSnapshotListener { snapshot, e ->
                if (e != null || snapshot == null) return@addSnapshotListener
                lastTrapsSnapshot = snapshot.documents
                if (isReloadingMap) return@addSnapshotListener
                if (::map.isInitialized) renderPlacedTraps(snapshot.documents, myTrapsSnapshot)
                refreshHeatmap()
            }
    }

    private fun observeMyTraps() {
        val uid = auth.currentUser?.uid ?: return
        myTrapsListener = Firebase.firestore.collection("traps")
            .whereEqualTo("ownerUid", uid)
            .addSnapshotListener { snapshot, e ->
                if (e != null || snapshot == null) return@addSnapshotListener
                myTrapsSnapshot = snapshot.documents
                if (::map.isInitialized) renderPlacedTraps(lastTrapsSnapshot ?: emptyList(), snapshot.documents)
            }
    }

    private fun renderPlacedTraps(activeDocs: List<DocumentSnapshot>, myDocs: List<DocumentSnapshot> = emptyList()) {
        placedTrapMarkers.forEach { it.remove() }
        placedTrapMarkers.clear()

        val myUid = auth.currentUser?.uid
        val activeIds = activeDocs.map { it.id }.toSet()

        // Active traps: green = mine, red = others
        activeDocs.forEach { doc ->
            val lat = doc.getDouble("lat") ?: return@forEach
            val lng = doc.getDouble("lng") ?: return@forEach
            val ownerUid = doc.getString("ownerUid")
            val isMine = ownerUid == myUid
            val marker = map.addMarker(
                MarkerOptions()
                    .position(LatLng(lat, lng))
                    .title(if (isMine) getString(R.string.label_your_trap) else getString(R.string.label_active_trap))
                    .icon(BitmapDescriptorFactory.defaultMarker(
                        if (isMine) BitmapDescriptorFactory.HUE_GREEN else BitmapDescriptorFactory.HUE_RED
                    ))
            )
            if (marker != null) {
                marker.tag = TrapMarkerInfo(
                    trapId = doc.id,
                    ownerUid = ownerUid,
                    isMine = isMine,
                    lat = lat,
                    lng = lng,
                    trapTypeId = doc.getString("trapTypeId") ?: ""
                )
                placedTrapMarkers.add(marker)
            }
        }

        // My disassembled/removed traps: violet (ghost markers)
        myDocs.filter { it.id !in activeIds }.forEach { doc ->
            val lat = doc.getDouble("lat") ?: return@forEach
            val lng = doc.getDouble("lng") ?: return@forEach
            val status = doc.getString("status") ?: return@forEach
            if (status == "active") return@forEach
            val marker = map.addMarker(
                MarkerOptions()
                    .position(LatLng(lat, lng))
                    .title(getString(R.string.label_my_disassembled_trap))
                    .icon(BitmapDescriptorFactory.defaultMarker(BitmapDescriptorFactory.HUE_VIOLET))
                    .alpha(0.5f)
            )
            if (marker != null) placedTrapMarkers.add(marker)
        }
    }

    private fun reloadMapTraps(showFeedback: Boolean = false) {
        val uid = auth.currentUser?.uid ?: return
        if (isReloadingMap) return
        isReloadingMap = true
        if (showFeedback) {
            toast(getString(R.string.status_refreshing_map))
        }
        Firebase.firestore.collection("traps")
            .whereEqualTo("status", "active")
            .get(com.google.firebase.firestore.Source.SERVER)
            .addOnSuccessListener { activeSnap ->
                lastTrapsSnapshot = activeSnap.documents
                Firebase.firestore.collection("traps")
                    .whereEqualTo("ownerUid", uid)
                    .get(com.google.firebase.firestore.Source.SERVER)
                    .addOnSuccessListener { mySnap ->
                        myTrapsSnapshot = mySnap.documents
                        if (::map.isInitialized) renderPlacedTraps(activeSnap.documents, mySnap.documents)
                        refreshHeatmap()
                        isReloadingMap = false
                    }
                    .addOnFailureListener { isReloadingMap = false }
            }
            .addOnFailureListener { isReloadingMap = false }
    }

    private fun checkNearbyTraps(loc: Location) {
        val snapshot = lastTrapsSnapshot ?: return
        var minDistance = Float.MAX_VALUE
        var enemyNear = 0
        val myUid = auth.currentUser?.uid

        snapshot.forEach { doc ->
            if (doc.getString("status") != "active") return@forEach
            val tLat = doc.getDouble("lat") ?: return@forEach
            val tLng = doc.getDouble("lng") ?: return@forEach
            val dist = FloatArray(1)
            Location.distanceBetween(loc.latitude, loc.longitude, tLat, tLng, dist)
            if (dist[0] < minDistance) minDistance = dist[0]
            if (dist[0] <= 100f && doc.getString("ownerUid") != myUid) enemyNear++
        }

        runOnUiThread {
            hud.nearbyCount = enemyNear
            val distInt = if (minDistance == Float.MAX_VALUE) -1 else minDistance.toInt()
            binding.proximitySensorRadar.setNearestTrapDistance(distInt)
            when {
                minDistance < 25f -> {
                    binding.proximitySensorRadar.setStatusColor(Color.RED)
                    val now = System.currentTimeMillis()
                    if (isSoundEnabled && now - lastSonarPingMs > 3000L) {
                        lastSonarPingMs = now
                        if (sonarTone == null) sonarTone = ToneGenerator(AudioManager.STREAM_ALARM, 80)
                        sonarTone?.startTone(ToneGenerator.TONE_PROP_BEEP, 120)
                    }
                }
                minDistance < 100f -> {
                    binding.proximitySensorRadar.setStatusColor("#FFA500".toColorInt())
                    val now = System.currentTimeMillis()
                    if (isSoundEnabled && now - lastOrangePingMs > 8000L) {
                        lastOrangePingMs = now
                        if (sonarTone == null) sonarTone = ToneGenerator(AudioManager.STREAM_ALARM, 50)
                        sonarTone?.startTone(ToneGenerator.TONE_PROP_BEEP, 80)
                    }
                }
                else -> {
                    binding.proximitySensorRadar.setStatusColor(ContextCompat.getColor(this@GameActivity, R.color.accent_green))
                }
            }
        }
    }

    private fun updateUiWithUserData() {
        val levelProgress = calculateLevelProgress(currentUserXP, currentUserLevelNumber, progressionLevels)
        hud.points = currentUserScore
        hud.level = currentUserLevelNumber
        hud.levelProgress = levelProgress

        // Membership badge is kept up-to-date by observeMembershipState().
        // Sync it here too so it reflects the latest state after any user-doc change.
        updateMembershipBadge(gameVm.membershipState.value)
    }

    private fun calculateLevelProgress(xp: Int, currentLevel: Int, levels: List<ProgressionLevel>): Float {
        if (levels.isEmpty()) return 0f
        val currentLevelData = levels.find { it.levelNumber == currentLevel } ?: return 0f
        val nextLevelData = levels.find { it.levelNumber == currentLevel + 1 } ?: return 1f
        
        val range = nextLevelData.minXP - currentLevelData.minXP
        if (range <= 0) return 1f
        
        val progress = xp - currentLevelData.minXP
        return (progress.toFloat() / range.toFloat()).coerceIn(0f, 1f)
    }

    private fun placeSelectedTrapBackground(latLng: LatLng, trapTypeId: String) {
        pendingPlacementLatLng = latLng
        lifecycleScope.launch {
            try {
                val startResult = functions
                    .getHttpsCallable("startTrapPlacement")
                    .call(mapOf(
                        "trapTypeId" to trapTypeId,
                        "lat" to latLng.latitude,
                        "lng" to latLng.longitude
                    ))
                    .await()

                @Suppress("UNCHECKED_CAST")
                val startData = startResult.getData() as? Map<String, Any>
                    ?: throw Exception("Invalid response")
                val sessionId = startData["sessionId"] as? String
                    ?: throw Exception("No sessionId returned")
                val holdSecs = (startData["requiredHoldSeconds"] as? Number)?.toInt() ?: 3
                val leaveSecs = (startData["placementLeaveSeconds"] as? Number)?.toInt()
                    ?.coerceAtLeast(1) ?: 15

                gameVm.startPlacementProgress(sessionId, holdSecs, leaveSecs)
            } catch (e: Exception) {
                val serverMsg = e.message ?: ""
                val toastMsg = when {
                    serverMsg.contains("No traps available for today") -> getString(R.string.error_no_traps_daily_limit)
                    serverMsg.contains("Move closer") || serverMsg.contains("too far away", ignoreCase = true) -> {
                        val excess = Regex("You are (\\d+) m too far").find(serverMsg)
                            ?.groupValues?.get(1)?.toIntOrNull()
                        if (excess != null) getString(R.string.error_target_far, excess)
                        else getString(R.string.error_too_far_to_place)
                    }
                    serverMsg.contains("No trap of this type available") -> getString(R.string.error_no_traps)
                    serverMsg.contains("Space your traps out", ignoreCase = true) ||
                    serverMsg.contains("trap(s) within", ignoreCase = true) -> serverMsg
                    else -> getString(R.string.error_placement_failed, serverMsg.ifBlank { getString(R.string.error_unknown_reason) })
                }
                // Show error inside the overlay (keeps it visible so user can read it and tap Close)
                gameVm.notifyPlacementStartFailed(toastMsg)
            }
        }
    }

    /**
     * Plays a sound by resource name key.
     * Sound files go in res/raw/ (e.g. res/raw/sfx_trapped.ogg).
     * If a file is missing the call is silently skipped.
     */
    private fun playSound(soundKey: String) {
        if (!isSoundEnabled) return
        try {
            val resName = "sfx_${soundKey.lowercase().replace("[^a-z0-9_]".toRegex(), "_")}"
            val resId = resources.getIdentifier(resName, "raw", packageName)
            if (resId == 0) {
                Log.d("Sound", "Missing sound resource: $resName")
                return
            }
            mediaPlayer?.release()
            mediaPlayer = MediaPlayer.create(this, resId)?.also { mp ->
                mp.setOnCompletionListener { it.release(); mediaPlayer = null }
                mp.start()
            }
        } catch (e: Exception) {
            Log.w("Sound", "playSound($soundKey) failed: ${e.message}")
        }
    }

    @Deprecated("Use playSound(key) — this stub is kept for transition")
    private fun playActionSound() = Unit

    // ── Trap compass ──────────────────────────────────────────────────────────

    private fun setupTrapCompass() {
        binding.composeTrapCompass.setContent { TrappTheme {
            val disarmState by disarmVm.disarmState.collectAsState()
            val trap = when (val s = disarmState) {
                is DisarmState.NearbyDetected -> s.trap
                is DisarmState.Revealing      -> s.trap
                is DisarmState.Disarming      -> s.trap
                else                          -> null
            }
            val azimuth by compassAzimuth

            if (trap != null && trap.lat != 0.0 && trap.lng != 0.0) {
                val loc = currentLocation
                TrapCompassOverlay(
                    trap             = trap,
                    playerLat        = loc?.latitude  ?: 0.0,
                    playerLng        = loc?.longitude ?: 0.0,
                    deviceAzimuthDeg = azimuth,
                )
            }
        } }

        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                disarmVm.disarmState.collect { state ->
                    val hasTrap = state is DisarmState.NearbyDetected ||
                                  state is DisarmState.Revealing ||
                                  state is DisarmState.Disarming
                    binding.composeTrapCompass.isVisible = hasTrap
                }
            }
        }
    }

    private fun startCompassSensor() {
        val sm = getSystemService(android.content.Context.SENSOR_SERVICE)
            as? android.hardware.SensorManager ?: return
        sensorManager = sm
        val rotVec = sm.getDefaultSensor(android.hardware.Sensor.TYPE_ROTATION_VECTOR) ?: return
        sm.registerListener(compassSensorListener, rotVec,
            android.hardware.SensorManager.SENSOR_DELAY_NORMAL)
    }

    private fun stopCompassSensor() {
        sensorManager?.unregisterListener(compassSensorListener)
    }

    private val compassSensorListener = object : android.hardware.SensorEventListener {
        private val rotMatrix   = FloatArray(9)
        private val orientation = FloatArray(3)

        override fun onSensorChanged(event: android.hardware.SensorEvent) {
            if (event.sensor.type != android.hardware.Sensor.TYPE_ROTATION_VECTOR) return
            android.hardware.SensorManager.getRotationMatrixFromVector(rotMatrix, event.values)
            android.hardware.SensorManager.getOrientation(rotMatrix, orientation)
            val azimuthDeg = Math.toDegrees(orientation[0].toDouble()).toFloat()
            compassAzimuth.floatValue = (azimuthDeg + 360f) % 360f
        }

        override fun onAccuracyChanged(sensor: android.hardware.Sensor, accuracy: Int) = Unit
    }

    // ── Heatmap (#16) ────────────────────────────────────────────────────────

    fun toggleHeatmap() {
        heatmapVisible = !heatmapVisible
        if (heatmapVisible) refreshHeatmap() else {
            heatmapOverlay?.remove()
            heatmapOverlay = null
        }
    }

    private fun refreshHeatmap() {
        if (!heatmapVisible || !::map.isInitialized) return
        val docs = lastTrapsSnapshot ?: return
        val points = docs.mapNotNull { doc ->
            val lat = doc.getDouble("lat") ?: return@mapNotNull null
            val lng = doc.getDouble("lng") ?: return@mapNotNull null
            com.google.android.gms.maps.model.LatLng(lat, lng)
        }
        if (points.isEmpty()) return

        // HeatmapTileProvider.build() runs a kernel density estimator which can
        // be CPU-intensive on large datasets.  Compute off the main thread.
        lifecycleScope.launch(kotlinx.coroutines.Dispatchers.Default) {
            val provider = com.google.maps.android.heatmaps.HeatmapTileProvider.Builder()
                .data(points)
                .radius(40)
                .build()
            kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main) {
                if (heatmapVisible && ::map.isInitialized) {
                    heatmapOverlay?.remove()
                    heatmapOverlay = map.addTileOverlay(
                        com.google.android.gms.maps.model.TileOverlayOptions()
                            .tileProvider(provider)
                            .zIndex(10f)
                    )
                }
            }
        }
    }

    // ── Home base / safe zone ────────────────────────────────────────────────

    private fun callSetHomeBase(lat: Double, lng: Double) {
        lifecycleScope.launch {
            try {
                functions.getHttpsCallable("setHomeBase")
                    .call(mapOf("lat" to lat, "lng" to lng))
                    .await()
                toast(getString(R.string.home_base_set_toast))
                // Circle will redraw automatically when the Firestore snapshot fires.
            } catch (e: Exception) {
                toast(getString(R.string.home_base_set_failed, e.message ?: ""))
            }
        }
    }

    fun callRemoveHomeBase() {
        lifecycleScope.launch {
            try {
                functions.getHttpsCallable("removeHomeBase")
                    .call(null)
                    .await()
                homeBaseCircle?.remove()
                homeBaseCircle = null
                homeBaseLat = null
                homeBaseLng = null
                wasInSafeZone = false
                toast(getString(R.string.home_base_removed))
            } catch (e: Exception) {
                toast(getString(R.string.home_base_remove_failed, e.message ?: ""))
            }
        }
    }

    private fun drawHomeBaseCircle(lat: Double, lng: Double, radiusMeters: Double) {
        if (!::map.isInitialized) return
        homeBaseCircle?.remove()
        homeBaseCircle = map.addCircle(
            com.google.android.gms.maps.model.CircleOptions()
                .center(LatLng(lat, lng))
                .radius(radiusMeters)
                .strokeColor(android.graphics.Color.parseColor("#8838D3F2"))
                .fillColor(android.graphics.Color.parseColor("#2238D3F2"))
                .strokeWidth(3f)
                .zIndex(5f)
        )
    }

    private fun saveFcmToken(uid: String) {
        com.google.firebase.messaging.FirebaseMessaging.getInstance().token
            .addOnSuccessListener { token ->
                Firebase.firestore.collection("users").document(uid)
                    .update("fcmToken", token)
                    .addOnFailureListener { /* non-fatal; TrapMessagingService retries on token refresh */ }
            }
    }

    private fun showFreedFeedback(evt: TrappedEvent) {
        playSound("freed")
        toast(getString(R.string.msg_freed_toast))
        // If a timeout penalty was applied, show a local notification when it expires
        // so the player knows they can run again even if they minimised the app.
        if (evt.effectKind == "timeout" && evt.effectValue > 10) {
            val delayMs = (evt.effectValue * 1000).toLong()
            Handler(Looper.getMainLooper()).postDelayed({
                NotificationHelper.showAlert(
                    applicationContext,
                    getString(R.string.notif_freed_title),
                    getString(R.string.notif_freed_body)
                )
            }, delayMs)
        }
    }

    private fun updateBannerAdPosition() {
        val dockHeight = binding.composeBottomDock.height.takeIf { it > 0 } ?: return
        val dp8 = (8 * resources.displayMetrics.density).toInt()

        // Ad sits directly above the dock (the dock already includes the nav-bar inset)
        val adBottomMargin = dockHeight
        binding.bannerAdContainer.updateLayoutParams<androidx.coordinatorlayout.widget.CoordinatorLayout.LayoutParams> {
            bottomMargin = adBottomMargin
        }

        // Right-side controls sit above the ad (or directly above the bag when ad is gone)
        val adHeight = if (binding.bannerAdContainer.visibility == android.view.View.VISIBLE)
            binding.bannerAdContainer.height else 0
        binding.rightSideControls.updateLayoutParams<androidx.coordinatorlayout.widget.CoordinatorLayout.LayoutParams> {
            bottomMargin = adBottomMargin + adHeight + dp8
        }
        binding.composeTrapCompass.updateLayoutParams<androidx.coordinatorlayout.widget.CoordinatorLayout.LayoutParams> {
            bottomMargin = adBottomMargin + adHeight + dp8
        }
    }

    private fun checkForUpdate() {
        val currentVersionCode = packageManager.getPackageInfo(packageName, 0).longVersionCode.toInt()
        Firebase.firestore.collection("game_settings").document("main")
            .get()
            .addOnSuccessListener { doc ->
                val minVersionCode = doc.getLong("minimumVersionCode")?.toInt()
                    ?: return@addOnSuccessListener
                if (currentVersionCode < minVersionCode && !isFinishing && !isDestroyed) {
                    showUpdateRequiredDialog()
                }
            }
    }

    private fun showUpdateRequiredDialog() {
        AlertDialog.Builder(this)
            .setTitle(getString(R.string.title_update_available))
            .setMessage(getString(R.string.msg_update_available))
            .setCancelable(false)
            .setPositiveButton(getString(R.string.action_update_now)) { _, _ ->
                try {
                    startActivity(Intent(Intent.ACTION_VIEW,
                        android.net.Uri.parse("market://details?id=$packageName")))
                } catch (e: android.content.ActivityNotFoundException) {
                    startActivity(Intent(Intent.ACTION_VIEW,
                        android.net.Uri.parse("https://play.google.com/store/apps/details?id=$packageName")))
                }
            }
            .setNegativeButton(getString(R.string.action_later), null)
            .show()
    }

    private fun showProfileEditDialog() {
        startActivity(Intent(this, ProfileEditActivity::class.java))
    }

    /** Opens the settings sheet; every control there applies immediately (no save step). */
    private fun showSettingsDialog() {
        val prefs = getSharedPreferences("Settings", MODE_PRIVATE)
        settingsUi.lang = LocaleManager.getLocale(this)
        settingsUi.theme = ThemePreferences.load(this)
        settingsUi.sound = prefs.getBoolean("Sound_Enabled", true)
        settingsUi.notifications = prefs.getBoolean("Notifications_Enabled", true)
        settingsUi.hideFromNearby = null
        auth.currentUser?.uid?.let { uid ->
            Firebase.firestore.collection("users").document(uid).get()
                .addOnSuccessListener { doc -> settingsUi.hideFromNearby = doc.getBoolean("hideFromNearby") == true }
                .addOnFailureListener { toast(getString(R.string.error_generic_retry)) }
        }
        hud.settingsOpen = true
    }

    private fun applySoundSetting(on: Boolean) {
        settingsUi.sound = on
        isSoundEnabled = on
        getSharedPreferences("Settings", MODE_PRIVATE).edit().putBoolean("Sound_Enabled", on).apply()
    }

    private fun applyNotificationsSetting(on: Boolean) {
        settingsUi.notifications = on
        getSharedPreferences("Settings", MODE_PRIVATE).edit().putBoolean("Notifications_Enabled", on).apply()
    }

    private fun applyHideFromNearby(on: Boolean) {
        val uid = auth.currentUser?.uid ?: return
        val previous = settingsUi.hideFromNearby
        settingsUi.hideFromNearby = on
        Firebase.firestore.collection("users").document(uid).update("hideFromNearby", on)
            .addOnFailureListener {
                settingsUi.hideFromNearby = previous
                toast(getString(R.string.error_generic_retry))
            }
    }

    /** Switching language recreates the activity; the sheet reopens itself afterwards. */
    private fun applyLanguageSetting(code: String) {
        getSharedPreferences("Settings", MODE_PRIVATE).edit().putBoolean("reopen_settings", true).apply()
        setAppLocale(code)
    }

    private fun confirmDeleteAccount() {
        AlertDialog.Builder(this)
            .setTitle(R.string.delete_account_title)
            .setMessage(R.string.delete_account_message)
            .setNegativeButton(android.R.string.cancel, null)
            .setPositiveButton(R.string.delete_account_confirm) { _, _ ->
                toast(getString(R.string.delete_account_in_progress))
                functions.getHttpsCallable("deleteMyAccount")
                    .apply { setTimeout(300, java.util.concurrent.TimeUnit.SECONDS) }
                    .call(hashMapOf("confirm" to "DELETE"))
                    .addOnSuccessListener {
                        stopTrackingService()
                        auth.signOut()
                        Toast.makeText(this, R.string.delete_account_done, Toast.LENGTH_LONG).show()
                        startActivity(Intent(this, LandingActivity::class.java)
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
                        finish()
                    }
                    .addOnFailureListener { toast(getString(R.string.delete_account_failed)) }
            }
            .show()
    }

    private fun showEmailChangeTicketDialog() {
        val uid = auth.currentUser?.uid ?: return
        val currentEmail = auth.currentUser?.email ?: ""
        val username = currentUsername ?: ""
        val dp = resources.displayMetrics.density
        val sidePad = (20 * dp).toInt()
        val vertPad = (16 * dp).toInt()
        val smallGap = (8 * dp).toInt()

        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(sidePad, vertPad, sidePad, 0)
        }

        fun addReadRow(label: String, value: String) {
            container.addView(TextView(this).apply {
                text = label
                textSize = 11f
                setTextColor(0xFFA7B7CC.toInt())
            })
            container.addView(TextView(this).apply {
                text = value
                textSize = 14f
                setTextColor(0xFF15233A.toInt())
                setPadding(0, 2, 0, smallGap)
            })
        }

        addReadRow(getString(R.string.label_user_id), uid)
        if (username.isNotBlank()) addReadRow(getString(R.string.label_username), "@$username")
        addReadRow(getString(R.string.label_email_address), currentEmail)

        container.addView(TextView(this).apply {
            text = getString(R.string.label_new_email)
            textSize = 11f
            setTextColor(0xFFA7B7CC.toInt())
        })
        val newEmailInput = EditText(this).apply {
            hint = getString(R.string.hint_new_email)
            inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS
            textSize = 14f
        }
        container.addView(newEmailInput)

        AlertDialog.Builder(this)
            .setTitle(getString(R.string.title_request_email_change))
            .setView(container)
            .setPositiveButton(getString(R.string.action_submit)) { _, _ ->
                val newEmail = newEmailInput.text.toString().trim()
                if (!android.util.Patterns.EMAIL_ADDRESS.matcher(newEmail).matches()) {
                    toast(getString(R.string.error_invalid_email))
                    return@setPositiveButton
                }
                submitEmailChangeTicket(uid, username, currentEmail, newEmail)
            }
            .setNegativeButton(getString(R.string.action_cancel), null)
            .show()
    }

    private fun submitEmailChangeTicket(uid: String, username: String, currentEmail: String, newEmail: String) {
        Firebase.functions("europe-west1").getHttpsCallable("createSupportTicket")
            .call(mapOf(
                "subject" to "Email address change request",
                "message" to "I would like to change the email address on my account.\n\nUID: $uid\nUsername: @$username\nCurrent email: $currentEmail\nRequested new email: $newEmail",
                "category" to "email_change"
            ))
            .addOnSuccessListener { toast(getString(R.string.msg_email_change_request_sent)) }
            .addOnFailureListener { e -> toast(getString(R.string.error_action_failed, e.message ?: "")) }
    }

    private fun setupMap() {
        val mapFragment = supportFragmentManager.findFragmentById(R.id.map) as SupportMapFragment
        mapFragment.getMapAsync(this)
    }

    override fun onMapReady(googleMap: GoogleMap) {
        map = googleMap
        mapReady = true

        updateMapStyle(ThemeManager.isDarkMode.value)

        // Re-draw home base circle now that the map is ready (Firestore snapshot may have
        // fired before onMapReady, so we need to catch up here).
        val hbLat = homeBaseLat
        val hbLng = homeBaseLng
        if (hbLat != null && hbLng != null) drawHomeBaseCircle(hbLat, hbLng, 100.0)

        map.uiSettings.isMapToolbarEnabled = false
        map.uiSettings.isMyLocationButtonEnabled = false

        enableMyLocationOnMap()
        val known = currentLocation
        if (known != null) {
            centerCameraOnFirstFix(known)
        } else {
            // Until the first fix arrives, open where the player was last seen.
            val prefs = getSharedPreferences("Settings", MODE_PRIVATE)
            val lat = prefs.getFloat("last_lat", Float.NaN)
            val lng = prefs.getFloat("last_lng", Float.NaN)
            if (!lat.isNaN() && !lng.isNaN()) {
                map.moveCamera(CameraUpdateFactory.newLatLngZoom(LatLng(lat.toDouble(), lng.toDouble()), 17.5f))
            }
        }
        fetchLastKnownLocation()

        // Apply stored zoom if we already have bag data; otherwise use a permissive
        // temporary value — observeBagLoading() will update it once the bag loads.
        val initialZoom = gameVm.bagState.value.let {
            if (!it.loading) it.mapMinZoom else 10f
        }
        map.setMinZoomPreference(initialZoom)

        map.setOnMarkerClickListener { marker ->
            val info = marker.tag as? TrapMarkerInfo
            if (info != null) {
                gameVm.onTrapMarkerSelected(info)
                true
            } else {
                false
            }
        }

        // Long-press map to set home base safe zone
        map.setOnMapLongClickListener { latLng ->
            if (gameVm.placementPhase.value == PlacementPhase.IDLE) {
                val msg = if (homeBaseLat != null)
                    getString(R.string.dialog_home_base_move)
                else
                    getString(R.string.dialog_home_base_set_new)
                AlertDialog.Builder(this)
                    .setTitle(getString(R.string.dialog_home_base_title))
                    .setMessage(msg)
                    .setPositiveButton(getString(R.string.action_home_base_set)) { _, _ -> callSetHomeBase(latLng.latitude, latLng.longitude) }
                    .setNegativeButton(getString(R.string.action_cancel), null)
                    .show()
            }
        }

        // Tap map to choose placement location
        map.setOnMapClickListener { latLng ->
            when (gameVm.placementPhase.value) {
                PlacementPhase.IDLE, PlacementPhase.AWAITING_TRAP -> {
                    selectedTrapLatLng = latLng
                    selectedTrapMarker?.remove()
                    selectedTrapMarker = map.addMarker(
                        MarkerOptions()
                            .position(latLng)
                            .title(getString(R.string.label_placement_target))
                            .icon(BitmapDescriptorFactory.defaultMarker(BitmapDescriptorFactory.HUE_AZURE))
                    )
                    gameVm.onLocationChosen()
                }
                else -> {}
            }
        }

        if (!gameVm.bagState.value.loading) hideLoadingOverlay()
    }

    private fun enableMyLocationOnMap() {
        if (hasLocationPermission() && ::map.isInitialized) {
            @SuppressLint("MissingPermission")
            map.isMyLocationEnabled = true
        }
    }

    private fun fetchLastKnownLocation() {
        if (hasLocationPermission()) {
            @SuppressLint("MissingPermission")
            fusedLocationClient.lastLocation.addOnSuccessListener { loc ->
                if (loc != null) {
                    currentLocation = loc
                    hud.gpsAccuracyM = if (loc.hasAccuracy()) kotlin.math.round(loc.accuracy).toInt() else null
                    centerCameraOnFirstFix(loc)
                }
            }
        }
    }

    // Fired once per app session on the very first GPS fix.
    // The backend handles idempotency via the firstLoginTrapsGenerated flag on the user doc.
    private var firstLoginTrapGenFired = false

    private fun triggerFirstLoginTrapGenIfNeeded(lat: Double, lng: Double) {
        val uid = auth.currentUser?.uid ?: return
        val prefs = getSharedPreferences("TrapGenPrefs", MODE_PRIVATE)
        val key = "first_login_trap_gen_done_$uid"
        if (prefs.getBoolean(key, false)) return

        functions.getHttpsCallable("triggerFirstLoginTrapGen")
            .call(mapOf("lat" to lat, "lng" to lng))
            .addOnSuccessListener { result ->
                @Suppress("UNCHECKED_CAST")
                val data = result.data as? Map<String, Any>
                val skipped = data?.get("skipped") as? Boolean ?: false
                val placed = data?.get("placed") as? Number
                if (!skipped && placed != null && placed.toInt() > 0) {
                    android.util.Log.i("TrapGen", "First-login: placed ${placed.toInt()} traps nearby")
                }
                // Mark locally so we never send this call again for this uid
                prefs.edit().putBoolean(key, true).apply()
            }
            .addOnFailureListener { e ->
                android.util.Log.w("TrapGen", "First-login trap gen failed (will retry next session): ${e.message}")
                // Do NOT mark done — retry on next session
            }
    }

    @SuppressLint("MissingPermission")
    private fun startGpsUpdates() {
        if (!hasLocationPermission()) return
        if (isGpsRunning) return // Prevents leaking multiple callbacks if called repeatedly

        locationCallback = object : LocationCallback() {
            override fun onLocationResult(res: LocationResult) {
                currentLocation = res.lastLocation
                currentLocation?.let { loc ->
                    hud.gpsAccuracyM = if (loc.hasAccuracy()) kotlin.math.round(loc.accuracy).toInt() else null
                    centerCameraOnFirstFix(loc)
                    checkNearbyTraps(loc)
                    onLocationChanged(loc.latitude, loc.longitude)
                    // On the very first GPS fix of this session, attempt first-login trap gen
                    if (!firstLoginTrapGenFired) {
                        firstLoginTrapGenFired = true
                        triggerFirstLoginTrapGenIfNeeded(loc.latitude, loc.longitude)
                    }
                }
            }
        }
        val req = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 5000)
            .setMinUpdateIntervalMillis(3000)
            .build()
        fusedLocationClient.requestLocationUpdates(req, locationCallback!!, Looper.getMainLooper())
        isGpsRunning = true
    }

    /** Opens the map at ~200 m radius (zoom 17.5) on the player, once per activity. */
    private fun centerCameraOnFirstFix(loc: Location) {
        if (cameraCentered || !::map.isInitialized) return
        cameraCentered = true
        map.moveCamera(CameraUpdateFactory.newLatLngZoom(LatLng(loc.latitude, loc.longitude), 17.5f))
        saveLastLocation(loc)
    }

    private fun saveLastLocation(loc: Location) {
        getSharedPreferences("Settings", MODE_PRIVATE).edit()
            .putFloat("last_lat", loc.latitude.toFloat())
            .putFloat("last_lng", loc.longitude.toFloat())
            .apply()
    }

    private fun stopGpsUpdates() {
        locationCallback?.let { fusedLocationClient.removeLocationUpdates(it) }
        isGpsRunning = false
    }

    private fun updateUserTimeZoneOnce() {
        val uid = auth.currentUser?.uid ?: return
        val tz = TimeZone.getDefault().id
        Firebase.firestore.collection("users").document(uid).update("timeZone", tz)
    }

    private fun callPresence(status: String) {
        functions.getHttpsCallable("trackUserPresence")
            .call(mapOf("status" to status))
            .addOnFailureListener { /* silent */ }
    }

    private fun startHeartbeat() {
        callPresence("online")
        heartbeatJob = object : Runnable {
            override fun run() {
                callPresence("heartbeat")
                heartbeatHandler.postDelayed(this, 3 * 60 * 1000L)
            }
        }
        heartbeatHandler.postDelayed(heartbeatJob!!, 3 * 60 * 1000L)
    }

    private fun stopHeartbeat() {
        heartbeatJob?.let { heartbeatHandler.removeCallbacks(it) }
        heartbeatJob = null
        callPresence("offline")
    }

    private fun centerOnMyLocation() { currentLocation?.let { map.animateCamera(CameraUpdateFactory.newLatLngZoom(LatLng(it.latitude, it.longitude), 17.5f)) } }

    private var lastSentLatLng: LatLng? = null
    private var isAppCheckThrottled = false
    private var lastAppCheckErrorTime = 0L

    private fun onLocationChanged(lat: Double, lng: Double) {
        // 1. Throttling: Distance check (skip if moved < ~5.5m)
        val latLng = LatLng(lat, lng)
        val previous = lastSentLatLng
        if (previous != null) {
            val results = FloatArray(1)
            Location.distanceBetween(previous.latitude, previous.longitude, lat, lng, results)
            if (results[0] < 5.5f) return 
        }

        // 2. Throttling: App Check "Too many attempts" backoff (5 mins)
        if (isAppCheckThrottled && System.currentTimeMillis() - lastAppCheckErrorTime < 300_000L) {
            return
        }

        // Keep player_locations fresh so placement distance checks pass
        val selfUid = auth.currentUser?.uid
        if (selfUid != null) {
            Firebase.firestore.collection("player_locations").document(selfUid)
                .set(mapOf(
                    "lat" to lat,
                    "lng" to lng,
                    "updatedAt" to com.google.firebase.firestore.FieldValue.serverTimestamp()
                ))
                .addOnFailureListener { /* silent */ }
        }

        lifecycleScope.launch {
            try {
                val result = functions
                    .getHttpsCallable("updatePlayerLocation")
                    .call(mapOf("lat" to lat, "lng" to lng))
                    .await()

                consecutiveFailures = 0
                isAppCheckThrottled = false
                lastSentLatLng = latLng

                @Suppress("UNCHECKED_CAST")
                val data = result.getData() as? Map<String, Any> ?: return@launch

                // Check if the player was just captured by a trap
                if (data["captured"] as? Boolean == true) {
                    val evt = TrappedEvent(
                        trapTypeId    = data["trapTypeId"] as? String ?: "",
                        iconKey       = data["iconKey"] as? String ?: "",
                        emoji         = data["emoji"] as? String ?: "",
                        imageUrl      = data["imageUrl"] as? String,
                        soundKey      = data["soundKey"] as? String,
                        effectKind    = data["effectKind"] as? String ?: "",
                        effectValue   = (data["effectValue"] as? Number)?.toDouble() ?: 0.0,
                        ownerUid      = data["ownerUid"] as? String ?: "",
                        ownerUsername = data["ownerUsername"] as? String ?: ""
                    )
                    gameVm.showTrappedEvent(evt)
                    // Clear any pending event the background service may have stored
                    // so we don't double-show the overlay on the next onResume().
                    getSharedPreferences("Settings", MODE_PRIVATE)
                        .edit().remove("pending_trapped_event").apply()
                    // Play trap sound
                    val sndKey = evt.soundKey ?: when (evt.effectKind) {
                        "timeout"  -> "trapped_timeout"
                        "laughter" -> "trapped_laughter"
                        else       -> "trapped"
                    }
                    playSound(sndKey)
                    return@launch  // don't process as nearbyTraps
                }

                // Safe zone indicator
                val inSafeZone = data["inSafeZone"] as? Boolean == true
                if (inSafeZone && !wasInSafeZone) {
                    toast(getString(R.string.msg_in_safe_zone))
                }
                wasInSafeZone = inSafeZone
                if (inSafeZone) return@launch

                // Feed nearby traps to disarm ViewModel
                disarmVm.onLocationUpdateResponse(data, this@GameActivity)

            } catch (e: Exception) {
                consecutiveFailures = minOf(consecutiveFailures + 1, 8)
                val backoffMs = minOf(1000L shl (consecutiveFailures - 1), 300_000L)
                Log.e("GameActivity", "updatePlayerLocation failed (retry $consecutiveFailures, backoff ${backoffMs}ms): ${e.message}")

                if (e.message?.contains("Too many attempts", ignoreCase = true) == true) {
                    isAppCheckThrottled = true
                    lastAppCheckErrorTime = System.currentTimeMillis()
                }

                // After max failures, suppress further calls until the backoff window clears.
                // lastSentLatLng is intentionally NOT updated so the next real location
                // change (> 5.5m) resets the suppression naturally.
                if (consecutiveFailures >= 8) {
                    lastAppCheckErrorTime = System.currentTimeMillis()
                    isAppCheckThrottled = true
                }
            }
        }
    }

    // Approximate (coarse-only) location is a valid grant on Android 12+.
    private fun hasLocationPermission() =
        ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
        ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    private fun requestNotificationPermissionIfNeeded() {
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    private fun requestLocationPermissionsIfNeeded() {
        if (!hasLocationPermission()) {
            locationPermissionLauncher.launch(arrayOf(
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION,
            ))
        } else {
            requestNotificationPermissionIfNeeded()
            enableMyLocationOnMap()
            fetchLastKnownLocation()
            startGpsUpdates()
            startTrackingService()
        }
    }

    private fun setupDisassembleOverlay() {
        binding.composeTrapInfoOverlay.setContent { TrappTheme {
            val state by gameVm.disassembleUiState.collectAsState()
            val disassemblyProgress by gameVm.disassemblyProgress.collectAsState()
            val bagState by gameVm.bagState.collectAsState()
            val adSettings by gameVm.adSettings.collectAsState()
            val adUses by gameVm.disassemblyAdUses.collectAsState()
            val membershipD by gameVm.membershipState.collectAsState()
            val cardCount by gameVm.unusedTimeCardCount.collectAsState()
            val isPaidD = membershipD.membership == "paid" && !membershipD.isExpired
            val rewardedEnabledD = adSettings.rewardedAdEnabled && !(isPaidD && membershipD.disableRewardedAd)
            state.info?.let { info ->
                val trapItem = if (info.trapTypeId.isNotBlank())
                    bagState.items.firstOrNull { it.trapTypeId == info.trapTypeId }
                else null
                when {
                    disassemblyProgress != null -> {
                        DisassembleProgressOverlay(
                            state = disassemblyProgress!!,
                            trapItem = trapItem,
                            onCancel = {
                                gameVm.cancelActiveDisassembly()
                                gameVm.dismissDisassemble()
                            },
                            rewardedAdEnabled = rewardedEnabledD,
                            rewardedLabel = formatReductionLabel(adSettings),
                            adUsesRemaining = (adSettings.rewardedMaxUsesPerSession - adUses).coerceAtLeast(0),
                            onWatchAd = {
                                showRewardedAdPreRoll(isPlacement = false)
                            },
                            cardCount = cardCount,
                            onUseCard = { gameVm.useTimeDeductionCard("disassembly") }
                        )
                    }
                    else -> {
                        DisassembleOverlay(
                            info = info,
                            countdown = state.countdown,
                            isComplete = state.isComplete,
                            trapItem = trapItem,
                            startError = state.error,
                            onDisassembleConfirmed = { startDisassembleBackground(info) },
                            onDismiss = {
                                gameVm.clearDisassembleError()
                                gameVm.dismissDisassemble()
                            }
                        )
                    }
                }
            }
        } }
    }

    private fun setupTrappedOverlay() {
        binding.composeTrappedOverlay.setContent { TrappTheme {
            val event by gameVm.trappedEvent.collectAsState()
            if (event != null) {
                TrappedOverlay(
                    event = event!!,
                    onDismiss = {
                        val captured = event!!
                        gameVm.dismissTrappedEvent()
                        showFreedFeedback(captured)
                    },
                    onEnemyAction = { uid, action ->
                        when (action) {
                            EnemyAction.ADD_FRIEND -> sendFriendRequest(uid)
                            EnemyAction.MESSAGE    -> startDirectMessage(uid)
                        }
                    }
                )
            }
        } }

        // Show/hide the ComposeView itself based on state
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                gameVm.trappedEvent.collect { evt ->
                    binding.composeTrappedOverlay.isVisible = evt != null
                }
            }
        }
    }

    private fun setupRewardOverlay() {
        binding.composeRewardOverlay.setContent { TrappTheme {
            val reward by gameVm.pendingReward.collectAsState()
            if (reward != null) {
                RewardOverlay(
                    event = reward!!,
                    onDismiss = { onRewardCollected(gameVm.dismissReward()) }
                )
            }
        } }

        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                gameVm.pendingReward.collect { reward ->
                    binding.composeRewardOverlay.isVisible = reward != null
                }
            }
        }

        // When day 1 is active, save the start timestamp so we can claim hourly rewards
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                gameVm.day1Active.collect { active ->
                    if (active) {
                        val prefs = getSharedPreferences("Settings", MODE_PRIVATE)
                        if (prefs.getLong("day1_start_epoch_ms", 0L) == 0L) {
                            prefs.edit().putLong("day1_start_epoch_ms", System.currentTimeMillis()).apply()
                        }
                    }
                }
            }
        }
    }

    private fun setupCaptureVictoryOverlay() {
        binding.composeCaptureVictoryOverlay.setContent { TrappTheme {
            val victory by gameVm.captureVictoryEvent.collectAsState()
            if (victory != null) {
                CaptureVictoryOverlay(
                    event = victory!!,
                    onDismiss = { gameVm.dismissCaptureVictoryEvent() }
                )
            }
        } }

        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                gameVm.captureVictoryEvent.collect { evt ->
                    binding.composeCaptureVictoryOverlay.isVisible = evt != null
                    if (evt != null) {
                        // Play the trap's own sound when the overlay appears
                        evt.soundKey?.takeIf { it.isNotBlank() }?.let { playSound(it) }
                    }
                }
            }
        }
    }

    private fun checkAndShowPendingCaptureVictoryEvent() {
        val prefs = getSharedPreferences("Settings", MODE_PRIVATE)
        val json = prefs.getString("pending_capture_victory_event", null)?.takeIf { it.isNotBlank() }
            ?: return
        prefs.edit().remove("pending_capture_victory_event").apply()

        try {
            val j = org.json.JSONObject(json)
            val evt = CaptureVictoryEvent(
                trapTypeId       = j.optString("trapTypeId"),
                emoji            = j.optString("emoji"),
                imageUrl         = j.optString("imageUrl").takeIf { it.isNotBlank() },
                soundKey         = j.optString("soundKey").takeIf { it.isNotBlank() },
                effectKind       = j.optString("effectKind"),
                capturedUsername = j.optString("capturedUsername")
            )
            if (gameVm.captureVictoryEvent.value == null) {
                gameVm.showCaptureVictoryEvent(evt)
            }
        } catch (e: Exception) {
            Log.w("GameActivity", "Failed to parse pending capture victory event: ${e.message}")
        }
    }

    /**
     * Called when the player taps "Collect!" on the reward popup.
     * Reloads the bag (bag refills may have been applied) and flashes any XP gained.
     */
    private fun onRewardCollected(reward: RewardEvent?) {
        val lang = LocaleManager.apiLang(this@GameActivity)
        gameVm.loadBag(lang = lang)
        gameVm.fetchCardInventory()

        val totalXp = reward?.awards?.sumOf { it.xpGranted } ?: 0
        if (totalXp > 0) {
            flashXpGain(totalXp)
        }
    }

    /** Briefly shows the XP gain in the level pill. */
    private fun flashXpGain(xp: Int) {
        hud.xpFlash = xp
        lifecycleScope.launch {
            kotlinx.coroutines.delay(2000)
            if (hud.xpFlash == xp) hud.xpFlash = null
        }
    }

    /**
     * Checks whether any hourly Day-1 rewards are due and claims them.
     * Called from [onResume] — safe to call multiple times; backend deduplicates.
     */
    private fun claimDueHourlyRewards() {
        val prefs = getSharedPreferences("Settings", MODE_PRIVATE)
        val day1StartMs = prefs.getLong("day1_start_epoch_ms", 0L)
        if (day1StartMs == 0L) return

        val now = System.currentTimeMillis()
        val elapsedHours = ((now - day1StartMs) / 3_600_000L).toInt()

        if (elapsedHours >= 8) {
            // Day 1 bonus period fully elapsed — clear prefs and stop
            prefs.edit().remove("day1_start_epoch_ms").remove("day1_last_claimed_hour").apply()
            return
        }

        val lastClaimed = prefs.getInt("day1_last_claimed_hour", 0)
        val nextHour = lastClaimed + 1
        val maxHour = (elapsedHours + 1).coerceAtMost(8)  // +1 because hours are 1-indexed

        for (h in nextHour..maxHour) {
            gameVm.claimHourlyDay1Reward(h)
            prefs.edit().putInt("day1_last_claimed_hour", h).apply()
        }
    }

    private fun observeDisassemble() {
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                gameVm.disassembleUiState.collect { state ->
                    binding.composeTrapInfoOverlay.isVisible = state.info != null
                    if (state.isComplete) {
                        toast(getString(R.string.msg_disassemble_success))
                        pendingDisassembleTrapId = null
                        gameVm.dismissDisassemble()
                        gameVm.dismissDisassemblyProgress()
                        gameVm.loadBag(lang = LocaleManager.apiLang(this@GameActivity))
                        reloadMapTraps()
                    }
                    // Error is displayed inside the DisassembleOverlay — cleared when user taps dismiss
                }
            }
        }

        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                var optimisticFlipDone = false
                gameVm.disassemblyProgress.collect { state ->
                    if (state?.isWaitingForServer == true && !optimisticFlipDone) {
                        optimisticFlipDone = true
                        // Optimistically flip the disassembled trap to violet immediately
                        // (Firestore real-time listener will confirm within ~1-2 s)
                        pendingDisassembleTrapId?.let { tid ->
                            if (::map.isInitialized) {
                                placedTrapMarkers
                                    .find { (it.tag as? TrapMarkerInfo)?.trapId == tid }
                                    ?.apply {
                                        setIcon(com.google.android.gms.maps.model.BitmapDescriptorFactory
                                            .defaultMarker(com.google.android.gms.maps.model.BitmapDescriptorFactory.HUE_VIOLET))
                                        alpha = 0.5f
                                        title = getString(R.string.label_my_disassembled_trap)
                                    }
                            }
                        }
                    }
                    if (state == null) optimisticFlipDone = false
                    state?.error?.let { err ->
                        if (err.isNotEmpty()) {
                            gameVm.onDisassembleError(err)
                            gameVm.dismissDisassemblyProgress()
                        }
                    }
                }
            }
        }
    }

    // ── UMP Consent (EU/GDPR) ────────────────────────────────────────────────

    private fun requestConsentAndInitializeAds() {
        val params = com.google.android.ump.ConsentRequestParameters.Builder()
            .setTagForUnderAgeOfConsent(false)
            .build()
        val consentInfo = com.google.android.ump.UserMessagingPlatform.getConsentInformation(this)
        consentInfo.requestConsentInfoUpdate(this, params,
            {
                com.google.android.ump.UserMessagingPlatform.loadAndShowConsentFormIfRequired(this) { _ ->
                    initMobileAdsAndPreload()
                }
            },
            { _ ->
                // Consent info update failed — initialize anyway
                initMobileAdsAndPreload()
            }
        )
    }

    private fun initMobileAdsAndPreload() {
        // SDK already initialized in TrapApplication; just preload after consent.
        AdManager.preload(this)
        RewardedAdManager.preload(this)
    }

    // ── Rewarded ad pre-roll dialog ──────────────────────────────────────────

    private fun showRewardedAdPreRoll(isPlacement: Boolean) {
        val ads = gameVm.adSettings.value
        val label = formatReductionLabel(ads)
        AlertDialog.Builder(this)
            .setTitle(getString(if (isPlacement) R.string.ad_speedup_placement_title else R.string.ad_speedup_disassembly_title))
            .setMessage(getString(if (isPlacement) R.string.ad_speedup_placement_msg else R.string.ad_speedup_disassembly_msg, label))
            .setPositiveButton(getString(R.string.action_watch_ad)) { _, _ ->
                RewardedAdManager.show(
                    activity = this,
                    onRewarded = {
                        val secs = calculateRewardSeconds(ads, isPlacement)
                        if (isPlacement) {
                            gameVm.applyRewardToPlacement(secs)
                            gameVm.recordPlacementAdUse()
                        } else {
                            gameVm.applyRewardToDisassembly(secs)
                            gameVm.recordDisassemblyAdUse()
                        }
                        showRewardCongrat(label)
                    },
                    onNotAvailable = {
                        Toast.makeText(this, getString(R.string.ad_not_available), Toast.LENGTH_SHORT).show()
                    }
                )
            }
            .setNegativeButton(getString(R.string.action_no_thanks), null)
            .show()
    }

    private fun showRewardCongrat(label: String) {
        AlertDialog.Builder(this)
            .setTitle(getString(R.string.ad_time_reduced_title))
            .setMessage(getString(R.string.ad_time_reduced_msg, label))
            .setPositiveButton(getString(R.string.action_continue)) { dialog, _ -> dialog.dismiss() }
            .show()
    }

    private fun calculateRewardSeconds(ads: AdSettings, isPlacement: Boolean): Int {
        val total = if (isPlacement)
            gameVm.placementProgress.value?.totalSeconds ?: 0
        else
            gameVm.disassemblyProgress.value?.totalSeconds ?: 0

        return when (ads.rewardedReductionType) {
            "percent" -> (total * ads.rewardedReductionValue / 100.0).toInt().coerceAtLeast(1)
            "minutes" -> ads.rewardedReductionValue * 60
            "hours"   -> ads.rewardedReductionValue * 3600
            else      -> ads.rewardedReductionValue // "seconds"
        }
    }

    private fun formatReductionLabel(ads: AdSettings): String = when (ads.rewardedReductionType) {
        "percent" -> "${ads.rewardedReductionValue}%"
        "minutes" -> resources.getQuantityString(R.plurals.duration_minutes, ads.rewardedReductionValue, ads.rewardedReductionValue)
        "hours"   -> resources.getQuantityString(R.plurals.duration_hours, ads.rewardedReductionValue, ads.rewardedReductionValue)
        else      -> resources.getQuantityString(R.plurals.duration_seconds, ads.rewardedReductionValue, ads.rewardedReductionValue)
    }

    private var bannerAd: com.google.android.gms.ads.AdView? = null

    /** (Re)creates the banner when the unit ID changes; an AdView's unit cannot be swapped. */
    private fun loadBanner(unitId: String) {
        if (bannerAd?.adUnitId != unitId) {
            bannerAd?.destroy()
            binding.bannerAdView.removeAllViews()
            bannerAd = com.google.android.gms.ads.AdView(this).apply {
                setAdSize(com.google.android.gms.ads.AdSize.BANNER)
                adUnitId = unitId
            }
            binding.bannerAdView.addView(bannerAd)
        }
        bannerAd?.loadAd(com.google.android.gms.ads.AdRequest.Builder().build())
    }

    private fun observeBannerAd() {
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                kotlinx.coroutines.flow.combine(
                    gameVm.adSettings,
                    gameVm.membershipState
                ) { ads, membership -> Pair(ads, membership) }
                    .collect { (ads, membership) ->
                        if (!ads.loaded) return@collect
                        val isPaid = membership.membership == "paid" && !membership.isExpired
                        // Show banner only if globally enabled AND not suppressed by the user's package
                        val bannerUnit = if (BuildConfig.DEBUG) TEST_BANNER_UNIT_ID else ads.bannerAdUnitId
                        val showBanner = ads.bannerAdEnabled && bannerUnit.isNotBlank() &&
                            !(isPaid && membership.disableBannerAd)
                        if (showBanner) {
                            if (binding.bannerAdContainer.visibility != android.view.View.VISIBLE) {
                                // Apply theme-correct background before making visible
                                val isDark = ThemeManager.isDarkMode.value
                                binding.bannerAdContainer.setBackgroundColor(if (isDark) 0xFF0E1828.toInt() else 0xFFFFFFFF.toInt())
                                binding.bannerAdTopBorder.setBackgroundColor(if (isDark) 0xFF22385A.toInt() else 0xFFEAF1FA.toInt())
                                loadBanner(bannerUnit)
                                binding.bannerAdContainer.visibility = android.view.View.VISIBLE
                            }
                        } else {
                            binding.bannerAdContainer.visibility = android.view.View.GONE
                        }
                    }
            }
        }
    }

    // ── Refill ad reward ─────────────────────────────────────────────────────────

    fun showRefillRewardedAd(trapTypeId: String, onNewCountdown: (Long) -> Unit) {
        val ads = gameVm.adSettings.value
        val uses = gameVm.refillAdUses.value
        if (uses >= ads.rewardedRefillAdMaxUsesPerSession) {
            Toast.makeText(this, getString(R.string.ad_rewards_exhausted), Toast.LENGTH_SHORT).show()
            return
        }
        val label = formatRefillRewardLabel(ads)
        AlertDialog.Builder(this)
            .setTitle(getString(R.string.ad_refill_title))
            .setMessage(getString(R.string.ad_refill_msg, label))
            .setPositiveButton(getString(R.string.action_watch_ad)) { _, _ ->
                RewardedAdManager.show(
                    activity = this,
                    onRewarded = {
                        val secs = calculateRefillRewardSeconds(ads)
                        gameVm.applyRewardToRefill(trapTypeId, secs) { remaining ->
                            onNewCountdown(remaining)
                        }
                        gameVm.recordRefillAdUse()
                        Toast.makeText(this, getString(R.string.ad_refill_reduced_toast, label), Toast.LENGTH_SHORT).show()
                    },
                    onNotAvailable = {
                        Toast.makeText(this, getString(R.string.ad_not_available), Toast.LENGTH_SHORT).show()
                    }
                )
            }
            .setNegativeButton(getString(R.string.action_no_thanks), null)
            .show()
    }

    private fun calculateRefillRewardSeconds(ads: AdSettings): Int = when (ads.rewardedRefillAdReductionType) {
        "percent" -> 0  // percent doesn't apply here; refill total varies per trap
        "minutes" -> ads.rewardedRefillAdReductionValue * 60
        "hours"   -> ads.rewardedRefillAdReductionValue * 3600
        else      -> ads.rewardedRefillAdReductionValue // "seconds"
    }

    private fun formatRefillRewardLabel(ads: AdSettings): String = when (ads.rewardedRefillAdReductionType) {
        "minutes" -> resources.getQuantityString(R.plurals.duration_minutes, ads.rewardedRefillAdReductionValue, ads.rewardedRefillAdReductionValue)
        "hours"   -> resources.getQuantityString(R.plurals.duration_hours, ads.rewardedRefillAdReductionValue, ads.rewardedRefillAdReductionValue)
        else      -> resources.getQuantityString(R.plurals.duration_seconds, ads.rewardedRefillAdReductionValue, ads.rewardedRefillAdReductionValue)
    }

    private fun startDisassembleBackground(info: TrapMarkerInfo) {
        pendingDisassembleTrapId = info.trapId
        lifecycleScope.launch {
            try {
                val startResult = functions
                    .getHttpsCallable("startTrapDisarm")
                    .call(mapOf("trapId" to info.trapId))
                    .await()

                @Suppress("UNCHECKED_CAST")
                val data = startResult.getData() as? Map<String, Any>
                    ?: throw Exception("Invalid response")
                val sessionId = data["sessionId"] as? String
                    ?: throw Exception("No sessionId")
                val holdSecs = (data["requiredHoldSeconds"] as? Number)?.toInt() ?: 5

                gameVm.startDisassemblyProgress(sessionId, holdSecs)

            } catch (e: Exception) {
                val serverMsg = e.message ?: ""
                val msg = when {
                    serverMsg.contains("inside the trap zone", ignoreCase = true) ->
                        getString(R.string.error_inside_trap_zone)
                    serverMsg.startsWith("closer:") -> {
                        val parts = serverMsg.split(":")
                        val needed = parts.getOrNull(1)?.toIntOrNull() ?: 0
                        if (needed > 0) getString(R.string.error_too_far_to_disassemble_detail, needed)
                        else getString(R.string.error_too_far_to_disassemble)
                    }
                    serverMsg.contains("Move closer", ignoreCase = true) ||
                    serverMsg.contains("too far", ignoreCase = true) ->
                        getString(R.string.error_too_far_to_disassemble)
                    serverMsg.contains("reveal", ignoreCase = true) ->
                        getString(R.string.label_reveal_first)
                    serverMsg.isNotBlank() -> serverMsg
                    else -> getString(R.string.msg_disassemble_failed)
                }
                gameVm.onDisassembleError(msg)
            }
        }
    }

    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()

    override fun onDestroy() {
        super.onDestroy()
        bannerAd?.destroy()
        stopGpsUpdates()
        stopTrackingService()
        userListener?.remove()
        trapsListener?.remove()
        myTrapsListener?.remove()
        mediaPlayer?.release()
        sonarTone?.release()
    }
}
