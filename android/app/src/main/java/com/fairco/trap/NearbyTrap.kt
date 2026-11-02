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
)
