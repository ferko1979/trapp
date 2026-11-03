package com.fairco.trap

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.google.firebase.Firebase
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.firestore
import com.google.firebase.functions.functions
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import java.util.Locale

enum class PlacementPhase { IDLE, AWAITING_TRAP, CONFIRMING, PLACING }

data class CaptureVictoryEvent(
    val trapTypeId: String,
    val emoji: String,
    val imageUrl: String?,
    val soundKey: String?,
    val effectKind: String,
    val capturedUsername: String
)

data class AdSettings(
    val bannerAdEnabled: Boolean = true,
    val bannerAdUnitId: String = "",
    val interstitialAdEnabled: Boolean = true,
    val rewardedAdEnabled: Boolean = true,
    /** "seconds" | "minutes" | "hours" | "percent" */
    val rewardedReductionType: String = "seconds",
    val rewardedReductionValue: Int = 30,
    val rewardedMaxUsesPerSession: Int = 1,
    /** Refill time-reduction reward (separate from placement/disassembly) */
    val rewardedRefillAdEnabled: Boolean = true,
    val rewardedRefillAdReductionType: String = "minutes",
    val rewardedRefillAdReductionValue: Int = 30,
    val rewardedRefillAdMaxUsesPerSession: Int = 1,
    val revolutPaymentEnabled: Boolean = true,
    val stripePaymentEnabled: Boolean = false,
    val loaded: Boolean = false,
)

data class PlacementProgressState(
    val sessionId: String,
    val totalSeconds: Int,
    val elapsedSeconds: Int = 0,
    val outOfRadiusCountdown: Int = -1,
    val metersToClose: Int = 0,
    val leaveSeconds: Int = 15,
    val isComplete: Boolean = false,
    val isWaitingForServer: Boolean = false,
    val error: String? = null
)

data class DisassemblyProgressState(
    val sessionId: String,
    val totalSeconds: Int,
    val elapsedSeconds: Int = 0,
    val outOfZoneCountdown: Int = -1,
    val leaveSeconds: Int = 15,
    val isComplete: Boolean = false,
    val isWaitingForServer: Boolean = false,
    val error: String? = null
)

data class TrapMarkerInfo(
    val trapId: String,
    val ownerUid: String?,
    val isMine: Boolean,
    val lat: Double,
    val lng: Double,
    val trapTypeId: String = ""
)

data class DisassembleUiState(
    val info: TrapMarkerInfo? = null,
    val countdown: Int = -1,
    val isComplete: Boolean = false,
    val error: String? = null
)

data class BagUiState(
    val items: List<TrapInventoryItem> = emptyList(),
    val currentWeightKg: Float = 0f,
    val maxWeightKg: Float = 100f,
    val loading: Boolean = true,
    val error: String? = null,
    /** Epoch ms of last successful server fetch — used to trigger re-sync every 5 min */
    val lastServerSyncMs: Long = 0L,
    /**
     * Google Maps minZoomPreference for this user.
     * Lower value = can zoom out more (wider area visible).
     * Resolved by backend: user_levels.mapMinZoom → mapVisibilityRadiusMeters → game_settings.defaultMapMinZoom → 10
     */
    val mapMinZoom: Float = 10f,
)

/**
 * Current membership status read directly from Firestore.
 * Updated on app load and re-checked every hour in the background.
 */
data class MembershipState(
    /** "free" or "paid" */
    val membership: String = "free",
    /** Firestore levelId — e.g. "free", "monthly", "annual" */
    val levelId: String = "free",
    /**
     * Human-readable display name fetched from user_levels/{levelId}.name
     * e.g. "Free", "Monthly Plan", "Annual Plan"
     */
    val levelDisplayName: String = "Free",
    /** Epoch ms of membership expiry (null = indefinite / no expiry set) */
    val membershipExpiresAtMs: Long? = null,
    /** true if expired (expiresAt < now) */
    val isExpired: Boolean = false,
    /** Per-package ad disable flags — only meaningful when membership == "paid" */
    val disableBannerAd: Boolean = false,
    val disableInterstitialAd: Boolean = false,
    val disableRewardedAd: Boolean = false,
    /** true while the first check hasn't completed yet */
    val loading: Boolean = true,
    /** Set when a Firestore error occurs during check */
    val error: String? = null,
)

class GameViewModel : ViewModel() {

    private val _bagState = MutableStateFlow(BagUiState())
    val bagState: StateFlow<BagUiState> = _bagState.asStateFlow()

    private val _adSettings = MutableStateFlow(AdSettings())
    val adSettings: StateFlow<AdSettings> = _adSettings.asStateFlow()

    private val _placementAdUses = MutableStateFlow(0)
    val placementAdUses: StateFlow<Int> = _placementAdUses.asStateFlow()

    private val _disassemblyAdUses = MutableStateFlow(0)
    val disassemblyAdUses: StateFlow<Int> = _disassemblyAdUses.asStateFlow()

    fun recordPlacementAdUse() { _placementAdUses.update { it + 1 } }
    fun recordDisassemblyAdUse() { _disassemblyAdUses.update { it + 1 } }

    private val _membershipState = MutableStateFlow(MembershipState())
    val membershipState: StateFlow<MembershipState> = _membershipState.asStateFlow()

    private val _placementPhase = MutableStateFlow(PlacementPhase.IDLE)
    val placementPhase: StateFlow<PlacementPhase> = _placementPhase.asStateFlow()

    private val _selectedTrapForPlacement = MutableStateFlow<TrapInventoryItem?>(null)
    val selectedTrapForPlacement: StateFlow<TrapInventoryItem?> = _selectedTrapForPlacement.asStateFlow()

    private val _disassembleUiState = MutableStateFlow(DisassembleUiState())
    val disassembleUiState: StateFlow<DisassembleUiState> = _disassembleUiState.asStateFlow()

    private val _placementProgress = MutableStateFlow<PlacementProgressState?>(null)
    val placementProgress: StateFlow<PlacementProgressState?> = _placementProgress.asStateFlow()

    /** Non-null while the "Confirming placement…" network call has returned an error. */
    private val _placementStartError = MutableStateFlow<String?>(null)
    val placementStartError: StateFlow<String?> = _placementStartError.asStateFlow()

    private val _disassemblyProgress = MutableStateFlow<DisassemblyProgressState?>(null)
    val disassemblyProgress: StateFlow<DisassemblyProgressState?> = _disassemblyProgress.asStateFlow()

    // Card inventory — list of unused time-deduction cards fetched from user_inventories
    private val _unusedCards = MutableStateFlow<List<Map<String, Any>>>(emptyList())
    private val _unusedTimeCardCount = MutableStateFlow(0)
    val unusedTimeCardCount: StateFlow<Int> = _unusedTimeCardCount.asStateFlow()
    private val _cardUseInProgress = MutableStateFlow(false)
    val cardUseInProgress: StateFlow<Boolean> = _cardUseInProgress.asStateFlow()

    private val _trappedEvent = MutableStateFlow<TrappedEvent?>(null)
    val trappedEvent: StateFlow<TrappedEvent?> = _trappedEvent.asStateFlow()

    fun showTrappedEvent(event: TrappedEvent) {
        _trappedEvent.value = event
    }

    fun dismissTrappedEvent() {
        _trappedEvent.value = null
    }

    private val functions = Firebase.functions("europe-west1")
    private var placementJob: Job? = null
    private var disassemblyJob: Job? = null
    private var membershipCheckJob: Job? = null
    private var loadBagJob: Job? = null
    @Volatile private var bagReloadPending = false
    private var bagReloadLang: String? = null

    /**
     * Reads the user's membership fields directly from Firestore and updates
     * [membershipState].  Called once on ViewModel init and every hour.
     *
     * If the membership status has changed since the last bag load (e.g. a
     * subscription was revoked by the backend), this also triggers a bag reload
     * so that [BagUiState.mapMinZoom] is refreshed immediately.
     */
    fun checkMembership(lang: String? = null) {
        val uid = FirebaseAuth.getInstance().currentUser?.uid ?: return
        viewModelScope.launch {
            try {
                val db = Firebase.firestore
                val snap      = db.collection("users").document(uid).get().await()
                val membership = snap.getString("membership") ?: "free"
                val levelId    = snap.getString("levelId")    ?: "free"
                val expiresTs  = snap.getTimestamp("membershipExpiresAt")
                val expiresMs  = expiresTs?.toDate()?.time
                val isExpired  = expiresMs != null && expiresMs < System.currentTimeMillis()

                // Fetch level doc — provides display name and per-level ad flags
                var levelDisplayName = levelId.replaceFirstChar { it.uppercase() }
                var disableBannerAd = false
                var disableInterstitialAd = false
                var disableRewardedAd = false
                try {
                    val levelSnap = db.collection("user_levels").document(levelId).get().await()
                    levelSnap.getString("name")?.takeIf { it.isNotBlank() }?.let {
                        levelDisplayName = it
                    }
                    disableBannerAd       = levelSnap.getBoolean("disableBannerAd")       ?: false
                    disableInterstitialAd = levelSnap.getBoolean("disableInterstitialAd") ?: false
                    disableRewardedAd     = levelSnap.getBoolean("disableRewardedAd")     ?: false
                } catch (_: Exception) { /* non-fatal — use defaults */ }

                val previous = _membershipState.value
                _membershipState.value = MembershipState(
                    membership            = membership,
                    levelId               = levelId,
                    levelDisplayName      = levelDisplayName,
                    membershipExpiresAtMs = expiresMs,
                    isExpired             = isExpired,
                    disableBannerAd       = disableBannerAd,
                    disableInterstitialAd = disableInterstitialAd,
                    disableRewardedAd     = disableRewardedAd,
                    loading               = false,
                )

                // If membership or level changed, force a bag reload so mapMinZoom
                // and trap allowances are immediately updated.
                if (previous.membership != membership || previous.levelId != levelId) {
                    loadBag(lang)
                }
            } catch (e: Exception) {
                _membershipState.update { it.copy(loading = false, error = ServerErrorText.of(e)) }
            }
        }
    }

    /**
     * Starts a background coroutine that re-checks membership status every hour.
     * Call this once when the Activity starts (or ViewModel is initialized).
     * The job is automatically cancelled when the ViewModel is cleared.
     */
    fun startHourlyMembershipCheck(lang: String? = null) {
        membershipCheckJob?.cancel()
        membershipCheckJob = viewModelScope.launch {
            // Immediate check on start
            checkMembership(lang)
            // Then repeat every hour
            while (true) {
                delay(60 * 60 * 1000L)  // 1 hour
                checkMembership(lang)
            }
        }
    }

    /** Fetches ad + payment settings from the backend game settings doc. */
    fun fetchAdSettings() {
        viewModelScope.launch {
            try {
                @Suppress("UNCHECKED_CAST")
                val result = functions.getHttpsCallable("getPublicGameSettings").call().await()
                val settings = (result.getData() as? Map<String, Any?>)
                    ?.get("settings") as? Map<String, Any?> ?: return@launch
                _adSettings.value = AdSettings(
                    bannerAdEnabled = settings["bannerAdEnabled"] as? Boolean ?: true,
                    bannerAdUnitId = settings["admobBannerAdUnitId"] as? String ?: "",
                    interstitialAdEnabled = settings["interstitialAdEnabled"] as? Boolean ?: true,
                    rewardedAdEnabled = settings["rewardedAdEnabled"] as? Boolean ?: true,
                    rewardedReductionType =
                        settings["rewardedAdReductionType"] as? String ?: "seconds",
                    rewardedReductionValue =
                        (settings["rewardedAdReductionValue"] as? Number)?.toInt() ?: 30,
                    rewardedMaxUsesPerSession =
                        (settings["rewardedAdMaxUsesPerSession"] as? Number)?.toInt() ?: 1,
                    rewardedRefillAdEnabled =
                        settings["rewardedRefillAdEnabled"] as? Boolean ?: true,
                    rewardedRefillAdReductionType =
                        settings["rewardedRefillAdReductionType"] as? String ?: "minutes",
                    rewardedRefillAdReductionValue =
                        (settings["rewardedRefillAdReductionValue"] as? Number)?.toInt() ?: 30,
                    rewardedRefillAdMaxUsesPerSession =
                        (settings["rewardedRefillAdMaxUsesPerSession"] as? Number)?.toInt() ?: 1,
                    revolutPaymentEnabled = settings["revolutPaymentEnabled"] as? Boolean ?: true,
                    stripePaymentEnabled = settings["stripePaymentEnabled"] as? Boolean ?: false,
                    loaded = true,
                )
                // Apply ad unit IDs from backend — no-ops if blank or unchanged
                (settings["admobRewardedInterstitialAdUnitId"] as? String)
                    ?.let { AdManager.configure(it) }
                (settings["admobRewardedAdUnitId"] as? String)
                    ?.let { RewardedAdManager.configure(it) }
            } catch (_: Exception) {
                _adSettings.update { it.copy(loaded = true) }
            }
        }
    }

    /**
     * Credits [seconds] to the current placement session on the server and jumps the
     * local progress forward — called after a rewarded ad completes.
     */
    fun applyRewardToPlacement(seconds: Int) {
        val progress = _placementProgress.value ?: return
        val sessionId = progress.sessionId
        // Jump UI forward immediately
        _placementProgress.update { current ->
            current?.let {
                val newElapsed = (it.elapsedSeconds + seconds).coerceAtMost(it.totalSeconds)
                it.copy(elapsedSeconds = newElapsed)
            }
        }
        // Sync to server in batches of max 5 (server cap per call)
        viewModelScope.launch {
            var remaining = seconds
            while (remaining > 0 && _placementProgress.value != null) {
                val batch = minOf(remaining, 5)
                try {
                    @Suppress("UNCHECKED_CAST")
                    val result = functions.getHttpsCallable("tapTrapPlacement")
                        .call(mapOf("sessionId" to sessionId, "incrementSeconds" to batch))
                        .await()
                    val data = result.getData() as? Map<String, Any?>
                    if (data?.get("completed") as? Boolean == true) {
                        _placementProgress.update { it?.copy(elapsedSeconds = it?.totalSeconds ?: 0, isComplete = true, outOfRadiusCountdown = -1) }
                        _placementPhase.value = PlacementPhase.IDLE
                        _selectedTrapForPlacement.value = null
                        return@launch
                    }
                } catch (_: Exception) {}
                remaining -= batch
            }
        }
    }

    /**
     * Credits [seconds] to the current disassembly session on the server and jumps the
     * local progress forward — called after a rewarded ad completes.
     */
    fun applyRewardToDisassembly(seconds: Int) {
        val progress = _disassemblyProgress.value ?: return
        val sessionId = progress.sessionId
        // Jump UI forward immediately
        _disassemblyProgress.update { current ->
            current?.let {
                val newElapsed = (it.elapsedSeconds + seconds).coerceAtMost(it.totalSeconds)
                it.copy(elapsedSeconds = newElapsed)
            }
        }
        // Sync to server in batches of max 5 (server cap per call)
        viewModelScope.launch {
            var remaining = seconds
            while (remaining > 0 && _disassemblyProgress.value != null) {
                val batch = minOf(remaining, 5)
                try {
                    @Suppress("UNCHECKED_CAST")
                    val result = functions.getHttpsCallable("tapTrapDisarm")
                        .call(mapOf("sessionId" to sessionId, "incrementSeconds" to batch))
                        .await()
                    val data = result.getData() as? Map<String, Any?>
                    if (data?.get("disarmed") as? Boolean == true) {
                        _disassemblyProgress.update { it?.copy(elapsedSeconds = it?.totalSeconds ?: 0, isComplete = true, outOfZoneCountdown = -1) }
                        _disassembleUiState.update { it.copy(isComplete = true) }
                        return@launch
                    }
                } catch (_: Exception) {}
                remaining -= batch
            }
        }
    }

    // ── Refill ad reward ─────────────────────────────────────────────────────────

    private val _refillAdUses = MutableStateFlow(0)
    val refillAdUses: StateFlow<Int> = _refillAdUses.asStateFlow()

    fun recordRefillAdUse() { _refillAdUses.update { it + 1 } }

    /**
     * Calls [applyRefillAdReward] on the backend to shift the refill timer for
     * [trapTypeId] back by [seconds], then invokes [onResult] with the new
     * secondsUntilNextRefill so the UI can refresh the countdown immediately.
     */
    fun applyRewardToRefill(trapTypeId: String, seconds: Int, onResult: (Long) -> Unit) {
        viewModelScope.launch {
            try {
                @Suppress("UNCHECKED_CAST")
                val result = functions.getHttpsCallable("applyRefillAdReward")
                    .call(mapOf("trapTypeId" to trapTypeId, "incrementSeconds" to seconds))
                    .await()
                val data = result.getData() as? Map<String, Any?>
                val remaining = (data?.get("secondsUntilNextRefill") as? Number)?.toLong()
                if (remaining != null) onResult(remaining)
            } catch (_: Exception) { /* silent — countdown stays as-is */ }
        }
    }

    fun onLocationChosen() {
        if (_placementPhase.value == PlacementPhase.IDLE) {
            _placementPhase.value = PlacementPhase.AWAITING_TRAP
        }
    }

    fun onTrapChosenForPlacement(item: TrapInventoryItem) {
        _selectedTrapForPlacement.value = item
        _placementPhase.value = PlacementPhase.CONFIRMING
    }

    fun cancelPlacement() {
        _placementPhase.value = PlacementPhase.IDLE
        _selectedTrapForPlacement.value = null
        _placementStartError.value = null
    }

    /** Called when startTrapPlacement network call fails — keeps overlay visible so user sees the error. */
    fun notifyPlacementStartFailed(msg: String) {
        _placementStartError.value = msg
    }

    /** User tapped the Close button on the placement-failed overlay — dismiss and reset. */
    fun dismissPlacementStartError() {
        _placementStartError.value = null
        cancelPlacement()
    }

    fun onPlacementConfirmed() {
        _placementPhase.value = PlacementPhase.IDLE
        _selectedTrapForPlacement.value = null
    }

    fun startPlacementProgress(sessionId: String, totalSeconds: Int, leaveSeconds: Int = 5) {
        placementJob?.cancel()
        _placementStartError.value = null
        _placementAdUses.value = 0
        _placementProgress.value = PlacementProgressState(sessionId = sessionId, totalSeconds = totalSeconds, leaveSeconds = leaveSeconds)
        _placementPhase.value = PlacementPhase.PLACING

        // Device-clock timer: ticks every real second regardless of network.
        // Server sync runs in background — does not block the countdown.
        var outOfRadiusConsecutive = 0
        var serverConfirmedComplete = false

        placementJob = viewModelScope.launch {
            val startMs = System.currentTimeMillis()
            var tick = 0

            while (true) {
                // Sleep until the next exact 1-second wall-clock boundary
                tick++
                val waitMs = (startMs + tick * 1000L) - System.currentTimeMillis()
                if (waitMs > 0L) delay(waitMs)

                val current = _placementProgress.value ?: break
                val newElapsed = (current.elapsedSeconds + 1).coerceAtMost(current.totalSeconds)

                // Update UI immediately — no waiting on the network
                _placementProgress.update { it?.copy(elapsedSeconds = newElapsed, outOfRadiusCountdown = -1) }

                // Sync 1 second to server in the background (fire-and-forget)
                launch {
                    try {
                        @Suppress("UNCHECKED_CAST")
                        val result = functions.getHttpsCallable("tapTrapPlacement")
                            .call(mapOf("sessionId" to sessionId, "incrementSeconds" to 1))
                            .await()
                        val data = result.getData() as? Map<String, Any?>
                        outOfRadiusConsecutive = 0
                        if (data?.get("completed") as? Boolean == true && !serverConfirmedComplete) {
                            serverConfirmedComplete = true
                            _placementProgress.update { it?.copy(elapsedSeconds = it?.totalSeconds ?: 0, isComplete = true, outOfRadiusCountdown = -1) }
                            _placementPhase.value = PlacementPhase.IDLE
                            _selectedTrapForPlacement.value = null
                            placementJob?.cancel()
                        }
                    } catch (e: Exception) {
                        if (e.message?.contains("closer", ignoreCase = true) == true) {
                            outOfRadiusConsecutive++
                            val leaveLim = _placementProgress.value?.leaveSeconds ?: 5
                            val remaining = leaveLim - outOfRadiusConsecutive
                            val parts = e.message?.split(":") ?: emptyList()
                            val meters = parts.getOrNull(1)?.toIntOrNull() ?: 0
                            if (remaining <= 0) {
                                cancelActivePlacement()
                            } else {
                                _placementProgress.update { it?.copy(outOfRadiusCountdown = remaining, metersToClose = meters) }
                            }
                        }
                        // Other transient errors (network timeouts) are silently skipped;
                        // the device timer keeps running so UX stays smooth.
                    }
                }

                // Local timer finished — signal waiting state, then stop ticking
                if (newElapsed >= current.totalSeconds) {
                    _placementProgress.update { it?.copy(isWaitingForServer = true) }
                    break
                }
            }
        }
    }

    fun cancelActivePlacement() {
        placementJob?.cancel()
        placementJob = null
        val sessionId = _placementProgress.value?.sessionId
        _placementProgress.value = null
        _placementPhase.value = PlacementPhase.IDLE
        _selectedTrapForPlacement.value = null
        if (!sessionId.isNullOrBlank()) {
            viewModelScope.launch {
                try {
                    functions.getHttpsCallable("cancelTrapPlacement")
                        .call(mapOf("sessionId" to sessionId))
                        .await()
                } catch (_: Exception) {}
            }
        }
    }

    fun dismissPlacementProgress() {
        _placementProgress.value = null
    }

    fun onTrapMarkerSelected(info: TrapMarkerInfo) {
        _disassembleUiState.value = DisassembleUiState(info = info)
    }

    fun dismissDisassemble() {
        _disassembleUiState.value = DisassembleUiState()
    }

    fun startDisassembleCountdown(seconds: Int) {
        _disassembleUiState.update { it.copy(countdown = seconds) }
        viewModelScope.launch {
            var remaining = seconds
            while (remaining > 0) {
                kotlinx.coroutines.delay(1000)
                remaining--
                _disassembleUiState.update { it.copy(countdown = remaining) }
            }
            _disassembleUiState.update { it.copy(isComplete = true) }
        }
    }

    fun onDisassembleError(msg: String) {
        _disassembleUiState.update { it.copy(error = msg) }
    }

    fun clearDisassembleError() {
        _disassembleUiState.update { it.copy(error = null) }
    }

    fun startDisassemblyProgress(sessionId: String, totalSeconds: Int) {
        disassemblyJob?.cancel()
        _disassemblyAdUses.value = 0
        _disassemblyProgress.value = DisassemblyProgressState(sessionId = sessionId, totalSeconds = totalSeconds)

        var outOfZoneConsecutive = 0
        var serverConfirmedDisarmed = false

        disassemblyJob = viewModelScope.launch {
            val startMs = System.currentTimeMillis()
            var tick = 0

            while (true) {
                tick++
                val waitMs = (startMs + tick * 1000L) - System.currentTimeMillis()
                if (waitMs > 0L) delay(waitMs)

                val current = _disassemblyProgress.value ?: break
                val newElapsed = (current.elapsedSeconds + 1).coerceAtMost(current.totalSeconds)

                _disassemblyProgress.update { it?.copy(elapsedSeconds = newElapsed, outOfZoneCountdown = -1) }

                launch {
                    try {
                        @Suppress("UNCHECKED_CAST")
                        val result = functions.getHttpsCallable("tapTrapDisarm")
                            .call(mapOf("sessionId" to sessionId, "incrementSeconds" to 1))
                            .await()
                        val data = result.getData() as? Map<String, Any?>
                        outOfZoneConsecutive = 0
                        if (data?.get("disarmed") as? Boolean == true && !serverConfirmedDisarmed) {
                            serverConfirmedDisarmed = true
                            _disassemblyProgress.update { it?.copy(elapsedSeconds = it?.totalSeconds ?: 0, isComplete = true, outOfZoneCountdown = -1) }
                            _disassembleUiState.update { it.copy(isComplete = true) }
                            disassemblyJob?.cancel()
                        }
                    } catch (e: Exception) {
                        val msg = e.message ?: ""
                        val isZoneError = msg.contains("closer", ignoreCase = true) ||
                            msg.startsWith("inside-trap-zone") ||
                            msg.contains("inside the trap zone", ignoreCase = true) ||
                            msg.contains("Move closer", ignoreCase = true)
                        if (isZoneError) {
                            outOfZoneConsecutive++
                            val leaveLim = _disassemblyProgress.value?.leaveSeconds ?: 5
                            val remaining = leaveLim - outOfZoneConsecutive
                            if (remaining <= 0) {
                                cancelActiveDisassembly()
                            } else {
                                _disassemblyProgress.update { it?.copy(outOfZoneCountdown = remaining) }
                            }
                        } else if (msg.contains("session not found", ignoreCase = true) ||
                                   msg.contains("not found", ignoreCase = true) ||
                                   msg.contains("aborted", ignoreCase = true)) {
                            // Session no longer valid — surface to overlay and stop
                            _disassembleUiState.update { it.copy(error = ServerErrorText.ofMessage(msg, R.string.error_session_expired)) }
                            cancelActiveDisassembly()
                        }
                        // Other transient network errors are skipped; device timer keeps running.
                    }
                }

                if (newElapsed >= current.totalSeconds) {
                    _disassemblyProgress.update { it?.copy(isWaitingForServer = true) }
                    break
                }
            }
        }
    }

    fun cancelActiveDisassembly() {
        disassemblyJob?.cancel()
        disassemblyJob = null
        val sessionId = _disassemblyProgress.value?.sessionId
        _disassemblyProgress.value = null
        if (!sessionId.isNullOrBlank()) {
            viewModelScope.launch {
                try {
                    functions.getHttpsCallable("cancelTrapDisarm")
                        .call(mapOf("sessionId" to sessionId))
                        .await()
                } catch (_: Exception) {}
            }
        }
    }

    fun dismissDisassemblyProgress() {
        _disassemblyProgress.value = null
    }

    fun fetchCardInventory() {
        viewModelScope.launch {
            try {
                @Suppress("UNCHECKED_CAST")
                val result = functions.getHttpsCallable("getUserInventory").call().await()
                val data = result.getData() as? Map<String, Any?> ?: return@launch
                // Backend returns { unusedCards: [...], usedCards: [...] } — field is "type" not "cardType"
                val unused = (data["unusedCards"] as? List<*>)
                    ?.filterIsInstance<Map<String, Any>>() ?: emptyList()
                _unusedCards.value = unused
                _unusedTimeCardCount.value = unused.count { it["type"] == "card_time_deduction_5min" }
            } catch (_: Exception) {}
        }
    }

    fun useTimeDeductionCard(context: String) {
        if (_cardUseInProgress.value) return
        val card = _unusedCards.value.firstOrNull { it["type"] == "card_time_deduction_5min" } ?: return
        val cardId = card["id"] as? String ?: return
        _cardUseInProgress.value = true
        viewModelScope.launch {
            try {
                functions.getHttpsCallable("useCard")
                    .call(mapOf("cardId" to cardId, "context" to context))
                    .await()
                // Remove the used card from local list
                val updated = _unusedCards.value.filter { it["id"] != cardId }
                _unusedCards.value = updated
                _unusedTimeCardCount.value = updated.count { it["type"] == "card_time_deduction_5min" }
                // Apply 5-minute (300 s) deduction directly to local state — no batch server calls.
                // The regular second-by-second tick already syncs progress; useCard marks it server-side.
                val deduction = 300
                if (context == "placement") {
                    _placementProgress.update { it?.copy(elapsedSeconds = (it.elapsedSeconds + deduction).coerceAtMost(it.totalSeconds)) }
                } else {
                    _disassemblyProgress.update { it?.copy(elapsedSeconds = (it.elapsedSeconds + deduction).coerceAtMost(it.totalSeconds)) }
                }
            } catch (_: Exception) {
                // Card stays in inventory on failure
            } finally {
                _cardUseInProgress.value = false
            }
        }
    }

    // ── Login / hourly reward claims ──────────────────────────────────────────────

    private val _pendingReward = MutableStateFlow<RewardEvent?>(null)
    val pendingReward: StateFlow<RewardEvent?> = _pendingReward.asStateFlow()

    /** True when the current login is still within the user's first play day. */
    private val _day1Active = MutableStateFlow(false)
    val day1Active: StateFlow<Boolean> = _day1Active.asStateFlow()

    /** Dismiss the reward popup. Returns the reward that was dismissed so callers can act on it. */
    fun dismissReward(): RewardEvent? {
        val reward = _pendingReward.value
        _pendingReward.value = null
        return reward
    }

    // ── Owner capture victory ─────────────────────────────────────────────────────

    private val _captureVictoryEvent = MutableStateFlow<CaptureVictoryEvent?>(null)
    val captureVictoryEvent: StateFlow<CaptureVictoryEvent?> = _captureVictoryEvent.asStateFlow()

    fun showCaptureVictoryEvent(evt: CaptureVictoryEvent) { _captureVictoryEvent.value = evt }
    fun dismissCaptureVictoryEvent() { _captureVictoryEvent.value = null }

    fun claimLoginReward() {
        viewModelScope.launch {
            try {
                @Suppress("UNCHECKED_CAST")
                val result = functions.getHttpsCallable("claimLoginReward").call().await()
                val data = result.getData() as? Map<String, Any?> ?: return@launch
                val alreadyClaimed = data["alreadyClaimed"] as? Boolean ?: false
                val streak = (data["loginStreak"] as? Number)?.toInt() ?: 0
                val isDay1 = data["isDay1"] as? Boolean ?: false

                if (isDay1) _day1Active.value = true
                if (alreadyClaimed) return@launch

                @Suppress("UNCHECKED_CAST")
                val rawAwards = data["awardsGranted"] as? List<Map<String, Any?>> ?: emptyList()
                val awards = rawAwards.map { a ->
                    AwardItem(
                        iconEmoji        = a["iconEmoji"]        as? String ?: "🎁",
                        label            = a["label"]            as? String ?: "",
                        cardsGranted     = (a["cardsGranted"]     as? Number)?.toInt() ?: 0,
                        xpGranted        = (a["xpGranted"]        as? Number)?.toInt() ?: 0,
                        bagRefillGranted = (a["bagRefillGranted"] as? Number)?.toInt() ?: 0
                    )
                }

                if (awards.isNotEmpty()) {
                    _pendingReward.value = RewardEvent(
                        streak = streak,
                        isDay1 = isDay1,
                        awards = awards
                    )
                    fetchCardInventory()
                }
            } catch (_: Exception) {}
        }
    }

    fun claimHourlyDay1Reward(hour: Int) {
        viewModelScope.launch {
            try {
                @Suppress("UNCHECKED_CAST")
                val result = functions.getHttpsCallable("claimHourlyDay1Reward")
                    .call(mapOf("hour" to hour)).await()
                val data = result.getData() as? Map<String, Any?> ?: return@launch
                if (data["alreadyClaimed"] as? Boolean == true) return@launch

                val cardsGranted = (data["cardsGranted"] as? Number)?.toInt() ?: 0
                val label        = data["label"]      as? String ?: "Hour $hour Bonus"
                val iconEmoji    = data["iconEmoji"]  as? String ?: "⏰"

                if (cardsGranted > 0) {
                    _pendingReward.value = RewardEvent(
                        streak   = 1,
                        isDay1   = true,
                        hourIndex = hour,
                        awards   = listOf(
                            AwardItem(
                                iconEmoji        = iconEmoji,
                                label            = label,
                                cardsGranted     = cardsGranted,
                                xpGranted        = 0,
                                bagRefillGranted = 0
                            )
                        )
                    )
                    fetchCardInventory()
                }
            } catch (_: Exception) {}
        }
    }

    /**
     * Loads bag inventory from server with the user's current locale.
     * Pass [forceServerSync] = true to bypass the client-side ticker and always
     * re-fetch even if we recently loaded.
     */
    fun loadBag(lang: String? = null) {
        // Startup fires several reloads at once; cancelling the in-flight call each
        // time kept the bag on "loading" through a cold start. Coalesce instead:
        // let the running call finish, then reload once more.
        if (loadBagJob?.isActive == true) {
            bagReloadPending = true
            bagReloadLang = lang ?: bagReloadLang
            return
        }
        loadBagJob = viewModelScope.launch {
            _bagState.update { it.copy(loading = true, error = null) }
            try {
                val langCode = lang ?: Locale.getDefault().language.take(2)
                val result = functions.getHttpsCallable("getMyTrapInventory")
                    .call(mapOf("lang" to langCode))
                    .await()

                @Suppress("UNCHECKED_CAST")
                val data = result.getData() as Map<String, Any?>

                @Suppress("UNCHECKED_CAST")
                val rawItems = data["items"] as? List<Map<String, Any?>> ?: emptyList()

                val items = rawItems.map { it.toTrapInventoryItem() }
                val current    = (data["currentBagWeight"] as? Number)?.toFloat() ?: 0f
                val max        = (data["bagWeightCapacity"]  as? Number)?.toFloat() ?: 100f
                val mapMinZoom = (data["mapMinZoom"] as? Number)?.toFloat() ?: 10f

                _bagState.value = BagUiState(
                    items = items,
                    currentWeightKg = current,
                    maxWeightKg = max,
                    loading = false,
                    lastServerSyncMs = System.currentTimeMillis(),
                    mapMinZoom = mapMinZoom,
                )
            } catch (e: Exception) {
                _bagState.update { it.copy(loading = false, error = ServerErrorText.of(e)) }
            }
        }
        loadBagJob?.invokeOnCompletion {
            if (bagReloadPending) {
                bagReloadPending = false
                viewModelScope.launch { loadBag(bagReloadLang) }
            }
        }
    }

    /**
     * Client-side ticker called every second.
     * Decrements refill countdowns; re-syncs from server every 5 minutes to
     * correct any drift (client clock errors, background kills, etc.).
     */
    fun tickRefillCountdowns(lang: String? = null) {
        val now = System.currentTimeMillis()
        val state = _bagState.value

        // Server re-sync every 5 minutes
        val syncIntervalMs = 5 * 60 * 1000L
        if (state.lastServerSyncMs > 0 && (now - state.lastServerSyncMs) >= syncIntervalMs) {
            loadBag(lang)  // async — will update state when done
            return
        }

        // Otherwise just tick client-side
        _bagState.update { current ->
            val updatedItems = current.items.map { item ->
                if (item.secondsUntilNextRefill != null && item.secondsUntilNextRefill > 0) {
                    item.copy(secondsUntilNextRefill = item.secondsUntilNextRefill - 1)
                } else {
                    item
                }
            }
            current.copy(items = updatedItems)
        }
    }
}

fun Map<String, Any?>.toTrapInventoryItem(): TrapInventoryItem {
    val trapTypeId = this["trapTypeId"] as? String ?: ""

    // --- Name ---
    val name = (this["localizedName"] as? String
        ?: this["name"] as? String
        ?: trapTypeId.replace("_", " ").replaceFirstChar { it.uppercase() }
        .ifBlank { "Unknown Trap" })

    // --- Effect kind: prefer server value, infer from trapTypeId as fallback ---
    val effectKindRaw = this["effectKind"] as? String ?: ""
    val effectKind = if (effectKindRaw.isNotBlank() && effectKindRaw != "none") {
        effectKindRaw
    } else {
        when {
            trapTypeId.contains("laughter") || trapTypeId.contains("fun") -> "laughter"
            trapTypeId.contains("timeout") -> "timeout"
            trapTypeId.contains("penalty") -> "penalty"
            trapTypeId.contains("slow") -> "slowdown"
            trapTypeId.isNotBlank() -> "warning"
            else -> "none"
        }
    }

    // --- Description: prefer server value, generate locally as fallback ---
    val effectValue = (this["effectValue"] as? Number)?.toDouble() ?: 0.0
    val descFromServer = (this["localizedDescription"] as? String
        ?: this["description"] as? String) ?: ""
    val description = descFromServer.ifBlank {
        buildLocalDescription(name, effectKind, effectValue)
    }

    return TrapInventoryItem(
        id = this["id"] as? String ?: "",
        trapTypeId = trapTypeId,
        bagCount = (this["bagCount"] as? Number)?.toInt() ?: 0,
        maxBagSlots = (this["maxBagSlots"] as? Number)?.toInt() ?: 0,
        weight = (this["weight"] as? Number)?.toFloat() ?: 0f,
        effectiveRefillHours = (this["effectiveRefillHours"] as? Number)?.toDouble() ?: 0.0,
        secondsUntilNextRefill = (this["secondsUntilNextRefill"] as? Number)?.toLong(),
        canRefillNow = this["canRefillNow"] as? Boolean ?: false,
        blockedBySlots = this["blockedBySlots"] as? Boolean ?: false,
        blockedByWeight = this["blockedByWeight"] as? Boolean ?: false,
        name = name,
        iconKey = this["iconKey"] as? String ?: trapTypeId.ifBlank { "default" },
        effectKind = effectKind,
        description = description,
        emoji = this["emoji"] as? String ?: "",
        imageUrl = this["imageUrl"] as? String,
        soundKey = this["soundKey"] as? String,
        nextRefillAtEpochMs = (this["nextRefillAtEpochMs"] as? Number)?.toLong(),
    )
}

/** Generates a human-readable description when the server doesn't provide one. */
private fun buildLocalDescription(name: String, effectKind: String, effectValue: Double): String {
    return when (effectKind) {
        "laughter" -> "$name triggers an uncontrollable burst of laughter, stunning the target for 5 seconds."
        "timeout" -> {
            val mins = (effectValue / 60).toInt()
            if (mins >= 1) "$name freezes the target for ${if (mins == 1) "1 minute" else "$mins minutes"}."
            else "$name freezes the target for ${effectValue.toInt()} seconds."
        }
        "penalty" -> "$name applies a ${effectValue.toInt()} point penalty."
        "slowdown" -> "$name slows the target down by ${effectValue.toInt()}%."
        "warning" -> "$name sends an official warning to the target."
        else -> "Place this trap on the map to surprise other players!"
    }
}
