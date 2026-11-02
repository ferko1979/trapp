package com.fairco.trap

data class GameState(
    val activeGame: Boolean = true,
    val maintenanceMode: Boolean = false,
    val defaultDailyTrapAllowance: Long = 5,
    val defaultBagSize: Long = 5,
    val defaultTrapRefillHours: Long = 24
)
