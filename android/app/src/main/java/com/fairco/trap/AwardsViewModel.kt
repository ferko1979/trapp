package com.fairco.trap

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.fairco.trap.util.LocaleManager
import com.google.firebase.Firebase
import com.google.firebase.functions.functions
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await

data class CardEntry(
    val id: String,
    val type: String,
    val earnedFrom: String,
    val earnedAtMs: Long,
    val usedAtMs: Long? = null
)

data class MilestoneContent(
    val day: Int,
    val emoji: String,
    val name: String,
    val description: String,
    val rewards: MilestoneRewards,
)

data class MilestoneRewards(val cards: Int, val xp: Int, val bagRefills: Int, val freezeCards: Int = 0)

data class CardTypeContent(
    val id: String,
    val emoji: String,
    val valueDisplay: String,
    val name: String,
    val unitLabel: String,
    val heroTitle: String,
    val heroSubtitle: String,
    val tipText: String,
    val readyLabel: String,
    val usedLabel: String,
)

data class AwardsUiState(
    val loading: Boolean = true,
    val error: String? = null,
    val unusedCards: List<CardEntry> = emptyList(),
    val usedCards: List<CardEntry> = emptyList(),
    val loginStreak: Int = 0,
    val longestStreak: Int = 0,
    val totalDaysPlayed: Int = 0,
    val milestones: List<MilestoneContent> = emptyList(),
    val cardTypes: List<CardTypeContent> = emptyList(),
)

private fun tsMs(map: Map<*, *>?): Long? =
    (map?.get("seconds") as? Number)?.toLong()?.times(1000)

class AwardsViewModel(private val locale: String) : ViewModel() {

    private val functions = Firebase.functions("europe-west1")

    private val _state = MutableStateFlow(AwardsUiState())
    val state: StateFlow<AwardsUiState> = _state.asStateFlow()

    fun load() {
        viewModelScope.launch {
            _state.value = AwardsUiState(loading = true)
            try {
                // Both network calls run in parallel
                val inventoryDeferred = async {
                    @Suppress("UNCHECKED_CAST")
                    functions.getHttpsCallable("getUserInventory").call().await()
                        .getData() as? Map<String, Any?> ?: emptyMap()
                }
                val contentDeferred = async {
                    @Suppress("UNCHECKED_CAST")
                    functions.getHttpsCallable("getAwardsContent")
                        .call(mapOf("locale" to locale)).await()
                        .getData() as? Map<String, Any?> ?: emptyMap()
                }

                val inv = inventoryDeferred.await()
                val cnt = contentDeferred.await()

                // ── Inventory ──────────────────────────────────────────────
                fun parseCards(key: String): List<CardEntry> =
                    (inv[key] as? List<*>)
                        ?.filterIsInstance<Map<String, Any>>()
                        ?.map { c ->
                            CardEntry(
                                id         = c["id"]         as? String ?: "",
                                type       = c["type"]       as? String ?: "",
                                earnedFrom = c["earnedFrom"] as? String ?: "",
                                earnedAtMs = tsMs(c["earnedAt"] as? Map<*, *>) ?: 0L,
                                usedAtMs   = tsMs(c["usedAt"]   as? Map<*, *>)
                            )
                        } ?: emptyList()

                val unused = parseCards("unusedCards")
                val used   = parseCards("usedCards").sortedByDescending { it.usedAtMs }
                val streak  = (inv["loginStreak"]     as? Number)?.toInt() ?: 0
                val longest = (inv["longestStreak"]   as? Number)?.toInt() ?: 0
                val days    = (inv["totalDaysPlayed"] as? Number)?.toInt() ?: 0

                // ── Awards content ─────────────────────────────────────────
                @Suppress("UNCHECKED_CAST")
                val milestones = (cnt["milestones"] as? List<*>)
                    ?.filterIsInstance<Map<String, Any>>()
                    ?.map { m ->
                        val r = m["rewards"] as? Map<*, *>
                        MilestoneContent(
                            day         = (m["day"]         as? Number)?.toInt() ?: 0,
                            emoji       = m["emoji"]        as? String ?: "🎁",
                            name        = m["name"]         as? String ?: "",
                            description = m["description"]  as? String ?: "",
                            rewards     = MilestoneRewards(
                                cards       = (r?.get("cards")       as? Number)?.toInt() ?: 0,
                                xp          = (r?.get("xp")          as? Number)?.toInt() ?: 0,
                                bagRefills  = (r?.get("bagRefills")  as? Number)?.toInt() ?: 0,
                                freezeCards = (r?.get("freezeCards") as? Number)?.toInt() ?: 0,
                            )
                        )
                    } ?: emptyList()

                @Suppress("UNCHECKED_CAST")
                val cardTypes = (cnt["cardTypes"] as? List<*>)
                    ?.filterIsInstance<Map<String, Any>>()
                    ?.map { ct ->
                        CardTypeContent(
                            id           = ct["id"]           as? String ?: "",
                            emoji        = ct["emoji"]        as? String ?: "⏱️",
                            valueDisplay = ct["valueDisplay"] as? String ?: "−5",
                            name         = ct["name"]         as? String ?: "",
                            unitLabel    = ct["unitLabel"]    as? String ?: "min",
                            heroTitle    = ct["heroTitle"]    as? String ?: "",
                            heroSubtitle = ct["heroSubtitle"] as? String ?: "",
                            tipText      = ct["tipText"]      as? String ?: "",
                            readyLabel   = ct["readyLabel"]   as? String ?: "READY",
                            usedLabel    = ct["usedLabel"]    as? String ?: "USED",
                        )
                    } ?: emptyList()

                _state.value = AwardsUiState(
                    loading         = false,
                    unusedCards     = unused,
                    usedCards       = used,
                    loginStreak     = streak,
                    longestStreak   = longest,
                    totalDaysPlayed = days,
                    milestones      = milestones,
                    cardTypes       = cardTypes,
                )
            } catch (e: Exception) {
                _state.value = AwardsUiState(loading = false, error = ServerErrorText.of(e))
            }
        }
    }

    class Factory(private val context: Context) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T =
            AwardsViewModel(LocaleManager.apiLang(context)) as T
    }
}
