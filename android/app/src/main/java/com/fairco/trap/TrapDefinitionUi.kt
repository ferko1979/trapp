package com.fairco.trap

/**
 * UI model representing static properties of a trap type.
 */
data class TrapDefinitionUi(
    val id: String,
    val name: String,
    val iconKey: String,
    val description: String = "",
    val damage: Int = 0,
    val effectivePlacementHoldSeconds: Int = 3
)
