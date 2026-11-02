package com.fairco.trap

/**
 * Represents a trap detected within proximity (typically 200m).
 */
data class NearbyTrap(
    val trapId: String,
    val trapTypeId: String,
    val iconKey: String,
    val distanceMeters: Int,
    val radiusMeters: Int,          // capture zone — step in = trapped
    val disarmRadiusMeters: Int,    // max distance to reveal/disarm (must be > radiusMeters)
    val disarmLeaveSeconds: Int = 15,    // consecutive out-of-disarm-zone seconds before cancel
    val placementLeaveSeconds: Int = 15, // consecutive out-of-placement-zone seconds before cancel
    val lat: Double = 0.0,
    val lng: Double = 0.0
) {
    companion object {
        /** Danger alerts are only raised for traps this close (matches the backend). */
        const val ALERT_RADIUS_M = 250

        /** Parses one `nearbyTraps` entry of the updatePlayerLocation response. */
        fun fromServer(it: Map<String, Any>): NearbyTrap? {
            val trapId = it["trapId"] as? String ?: ""
            if (trapId.isBlank()) return null
            val radius = (it["radiusMeters"] as? Number)?.toInt() ?: 25
            // Older backends sent every trap in the level's visibility radius (up to 5 km).
            val distance = (it["distanceMeters"] as? Number)?.toInt() ?: 999
            if (distance > ALERT_RADIUS_M) return null
            return NearbyTrap(
                trapId             = trapId,
                trapTypeId         = it["trapTypeId"] as? String ?: "",
                iconKey            = it["iconKey"] as? String ?: "",
                distanceMeters     = distance,
                radiusMeters       = radius,
                disarmRadiusMeters = (it["disarmRadiusMeters"] as? Number)?.toInt()
                    ?.takeIf { v -> v > radius } ?: (radius + 1),
                disarmLeaveSeconds = (it["disarmLeaveSeconds"] as? Number)?.toInt()
                    ?.coerceAtLeast(1) ?: 15,
                placementLeaveSeconds = (it["placementLeaveSeconds"] as? Number)?.toInt()
                    ?.coerceAtLeast(1) ?: 15,
                lat                = (it["lat"] as? Number)?.toDouble() ?: 0.0,
                lng                = (it["lng"] as? Number)?.toDouble() ?: 0.0,
            )
        }
    }
}
