package com.fairco.trap

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.google.firebase.Firebase
import com.google.firebase.functions.FirebaseFunctionsException
import com.google.firebase.functions.functions
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await

class TrapDisarmViewModel : ViewModel() {
    private val functions = Firebase.functions("europe-west1")

    val disarmState = MutableStateFlow<DisarmState>(DisarmState.Idle)

    private val alertedTrapIds = mutableSetOf<String>()
    private var tapJob: Job? = null

    /** Live distance to the active trap, updated every location tick. */
    private var liveDistanceM: Int = -1

    /** Consecutive out-of-range taps (each tap = 1 second). Cancel at 5. */
    private var outOfRangeTicks: Int = 0

    // ── Location updates ─────────────────────────────────────────────────────
    fun onLocationUpdateResponse(data: Map<String, Any>, context: Context) {
        @Suppress("UNCHECKED_CAST")
        val nearbyRaw = data["nearbyTraps"] as? List<Map<String, Any>> ?: emptyList()
        val nearbyTraps = nearbyRaw.mapNotNull { NearbyTrap.fromServer(it) }

        val activeTrapId = when (val s = disarmState.value) {
            is DisarmState.NearbyDetected -> s.trap.trapId
            is DisarmState.Revealing      -> s.trap.trapId
            is DisarmState.Disarming      -> s.trap.trapId
            else -> null
        }
        if (activeTrapId != null) {
            val updated = nearbyTraps.find { it.trapId == activeTrapId }
            if (updated != null) {
                liveDistanceM = updated.distanceMeters
                if (disarmState.value is DisarmState.NearbyDetected) {
                    disarmState.value = DisarmState.NearbyDetected(updated)
                }
            }
        }

        for (trap in nearbyTraps) {
            if (trap.trapId !in alertedTrapIds) {
                alertedTrapIds.add(trap.trapId)
                TrapProximityNotifier.notify(context, trap)
                if (disarmState.value is DisarmState.Idle) {
                    disarmState.value = DisarmState.NearbyDetected(trap)
                }
            }
        }

        val currentIds = nearbyTraps.map { it.trapId }.toSet()
        alertedTrapIds.retainAll { id ->
            id in currentIds ||
            (disarmState.value is DisarmState.Disarming &&
             (disarmState.value as DisarmState.Disarming).trap.trapId == id) ||
            (disarmState.value is DisarmState.Revealing &&
             (disarmState.value as DisarmState.Revealing).trap.trapId == id)
        }
    }

    // ── STEP 1: Reveal ────────────────────────────────────────────────────────
    fun startReveal(trap: NearbyTrap) {
        tapJob?.cancel()
        outOfRangeTicks = 0
        disarmState.value = DisarmState.Revealing(trap, 0f, 5f)
        tapJob = viewModelScope.launch {
            while (disarmState.value is DisarmState.Revealing) {
                try {
                    val result = functions.getHttpsCallable("revealNearbyTrap")
                        .call(mapOf("trapId" to trap.trapId, "incrementSeconds" to 1))
                        .await()
                    @Suppress("UNCHECKED_CAST")
                    val resp = result.getData() as? Map<String, Any> ?: break

                    outOfRangeTicks = 0  // successful tap resets counter
                    val current = disarmState.value
                    if (current is DisarmState.Revealing) {
                        disarmState.value = current.copy(tooFar = false, outOfRangeCountdown = null)
                    }

                    if (resp["revealed"] as? Boolean == true) {
                        val disarmSecs = (resp["disarmHoldSeconds"] as? Number)?.toFloat() ?: 5f
                        startDisarm(trap, disarmSecs)
                        break
                    } else {
                        val progress = (resp["progressSeconds"] as? Number)?.toFloat() ?: 0f
                        val required = (resp["requiredHoldSeconds"] as? Number)?.toFloat() ?: 5f
                        disarmState.value = DisarmState.Revealing(trap, progress, required)
                    }
                } catch (e: FirebaseFunctionsException) {
                    val msg = e.message ?: ""
                    when {
                        e.code == FirebaseFunctionsException.Code.FAILED_PRECONDITION
                                && msg.startsWith("inside-trap-zone") -> {
                            // Player stepped into capture zone during reveal
                            tapJob?.cancel()
                            disarmState.value = DisarmState.CapturedWhileDisarming(trap)
                            return@launch
                        }
                        e.code == FirebaseFunctionsException.Code.FAILED_PRECONDITION
                                && msg.startsWith("closer") -> {
                            outOfRangeTicks++
                            val leaveLimit = trap.disarmLeaveSeconds
                            val dist = liveDistanceM.takeIf { it > 0 } ?: trap.distanceMeters
                            val countdown = (leaveLimit - outOfRangeTicks).coerceAtLeast(0)
                            val current = disarmState.value
                            if (current is DisarmState.Revealing) {
                                disarmState.value = current.copy(
                                    tooFar = true,
                                    outOfRangeCountdown = countdown,
                                    trap = current.trap.copy(distanceMeters = dist)
                                )
                            }
                            if (outOfRangeTicks >= leaveLimit) {
                                tapJob?.cancel()
                                disarmState.value = DisarmState.Idle
                                return@launch
                            }
                        }
                        else -> {
                            disarmState.value = DisarmState.Error(msg.ifBlank { "Reveal failed." })
                            break
                        }
                    }
                } catch (e: Exception) {
                    disarmState.value = DisarmState.Error(e.message ?: "Reveal failed.")
                    break
                }
                delay(1000)
            }
        }
    }

    fun cancelReveal() {
        tapJob?.cancel()
        outOfRangeTicks = 0
        disarmState.value = DisarmState.Idle
    }

    // ── STEP 2: Start disarm session ──────────────────────────────────────────
    private fun startDisarm(trap: NearbyTrap, disarmSecs: Float) {
        viewModelScope.launch {
            try {
                val result = functions.getHttpsCallable("startTrapDisarm")
                    .call(mapOf("trapId" to trap.trapId)).await()
                @Suppress("UNCHECKED_CAST")
                val resp = result.getData() as? Map<String, Any> ?: return@launch
                val sessionId = resp["sessionId"] as? String ?: return@launch
                val required = (resp["requiredHoldSeconds"] as? Number)?.toFloat() ?: disarmSecs
                outOfRangeTicks = 0
                disarmState.value = DisarmState.Disarming(trap, sessionId, 0f, required)
                tapDisarm(trap, sessionId, required)
            } catch (e: Exception) {
                val msg = (e as? FirebaseFunctionsException)?.message ?: e.message ?: ""
                disarmState.value = when {
                    msg.startsWith("inside-trap-zone") ->
                        DisarmState.CapturedWhileDisarming(trap)
                    msg.startsWith("closer") -> {
                        val parts = msg.split(":")
                        val needed = parts.getOrNull(1)?.toIntOrNull() ?: 1
                        val dist   = parts.getOrNull(2)?.toIntOrNull()
                            ?: liveDistanceM.takeIf { it > 0 } ?: trap.distanceMeters
                        val range  = parts.getOrNull(3)?.toIntOrNull() ?: trap.disarmRadiusMeters
                        DisarmState.Error("Move ${needed}m closer — you are ${dist}m away, need ≤ ${range}m")
                    }
                    else -> DisarmState.Error(msg.ifBlank { "Could not start disarm." })
                }
            }
        }
    }

    // ── STEP 3: Tap disarm loop ───────────────────────────────────────────────
    private fun tapDisarm(trap: NearbyTrap, sessionId: String, required: Float) {
        tapJob?.cancel()
        tapJob = viewModelScope.launch {
            while (disarmState.value is DisarmState.Disarming) {
                try {
                    val result = functions.getHttpsCallable("tapTrapDisarm")
                        .call(mapOf("sessionId" to sessionId, "incrementSeconds" to 1))
                        .await()
                    @Suppress("UNCHECKED_CAST")
                    val resp = result.getData() as? Map<String, Any> ?: break

                    outOfRangeTicks = 0
                    if (resp["disarmed"] as? Boolean == true) {
                        val disarmedId = resp["trapId"] as? String ?: trap.trapId
                        collectDisarmedTrap(disarmedId)
                        break
                    } else {
                        val current = disarmState.value
                        if (current is DisarmState.Disarming) {
                            disarmState.value = current.copy(
                                progressSeconds = current.progressSeconds + 1f,
                                tooFar = false,
                                metersToClose = 0,
                                outOfRangeCountdown = null
                            )
                        }
                    }
                } catch (e: FirebaseFunctionsException) {
                    val msg = e.message ?: ""
                    when {
                        e.code == FirebaseFunctionsException.Code.FAILED_PRECONDITION
                                && msg.startsWith("inside-trap-zone") -> {
                            tapJob?.cancel()
                            disarmState.value = DisarmState.CapturedWhileDisarming(trap)
                            return@launch
                        }
                        e.code == FirebaseFunctionsException.Code.FAILED_PRECONDITION
                                && msg.startsWith("closer") -> {
                            outOfRangeTicks++
                            val leaveLimit = trap.disarmLeaveSeconds
                            val parts  = msg.split(":")
                            val needed = parts.getOrNull(1)?.toIntOrNull()
                                ?: run {
                                    val dist = liveDistanceM.takeIf { it > 0 } ?: trap.distanceMeters
                                    (dist - trap.disarmRadiusMeters).coerceAtLeast(1)
                                }
                            val countdown = (leaveLimit - outOfRangeTicks).coerceAtLeast(0)
                            val dist = liveDistanceM.takeIf { it > 0 } ?: trap.distanceMeters
                            val current = disarmState.value
                            if (current is DisarmState.Disarming) {
                                disarmState.value = current.copy(
                                    tooFar = true,
                                    metersToClose = needed,
                                    outOfRangeCountdown = countdown
                                )
                            }
                            if (outOfRangeTicks >= leaveLimit) {
                                tapJob?.cancel()
                                disarmState.value = DisarmState.Idle
                                return@launch
                            }
                        }
                        else -> {
                            disarmState.value = DisarmState.Error(msg.ifBlank { "Disarm failed." })
                            break
                        }
                    }
                } catch (e: Exception) {
                    disarmState.value = DisarmState.Error(e.message ?: "Disarm failed.")
                    break
                }
                delay(1000)
            }
        }
    }

    fun cancelDisarm() {
        tapJob?.cancel()
        outOfRangeTicks = 0
        disarmState.value = DisarmState.Idle
    }

    // ── STEP 4: Collect ───────────────────────────────────────────────────────
    private fun collectDisarmedTrap(trapId: String) = viewModelScope.launch {
        try {
            val result = functions.getHttpsCallable("disarmAndCollectTrap")
                .call(mapOf("trapId" to trapId)).await()
            @Suppress("UNCHECKED_CAST")
            val resp = result.getData() as? Map<String, Any> ?: return@launch
            disarmState.value = DisarmState.DisarmComplete(
                trapId     = trapId,
                trapTypeId = resp["trapTypeId"] as? String ?: "",
                trapName   = resp["trapName"] as? String ?: "Trap",
                iconKey    = resp["iconKey"] as? String ?: ""
            )
        } catch (e: Exception) {
            disarmState.value = DisarmState.DisarmComplete(
                trapId = trapId, trapTypeId = "", trapName = "Trap", iconKey = ""
            )
        }
    }

    fun dismissSuccess() {
        disarmState.value = DisarmState.Idle
    }
}
