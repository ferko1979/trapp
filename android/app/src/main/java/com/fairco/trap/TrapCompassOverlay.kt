package com.fairco.trap

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Navigation
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.*

/**
 * Compact compass widget shown in the corner when a nearby trap is detected.
 *
 * The arrow rotates to point toward [trap] relative to the device's current
 * compass heading [deviceAzimuthDeg]. Smoothly animates as the player turns.
 *
 * @param trap              The nearest detected trap with lat/lng coordinates.
 * @param playerLat         Player's current latitude.
 * @param playerLng         Player's current longitude.
 * @param deviceAzimuthDeg  Device magnetic/true heading in degrees (0 = North).
 */
@Composable
fun TrapCompassOverlay(
    trap: NearbyTrap,
    playerLat: Double,
    playerLng: Double,
    deviceAzimuthDeg: Float,
) {
    val bearing = remember(playerLat, playerLng, trap.lat, trap.lng) {
        bearingTo(playerLat, playerLng, trap.lat, trap.lng)
    }

    // Arrow rotation: bearing from player to trap, adjusted for device heading
    val arrowTarget = ((bearing - deviceAzimuthDeg) + 360f) % 360f

    val arrowRotation by animateFloatAsState(
        targetValue = arrowTarget,
        animationSpec = tween(durationMillis = 200),
        label = "compassArrow"
    )

    val distanceText = if (trap.distanceMeters < 1000) {
        "${trap.distanceMeters}m"
    } else {
        "${"%.1f".format(trap.distanceMeters / 1000.0)}km"
    }

    Box(
        modifier = Modifier
            .size(88.dp)
            .background(Color(0xCC1A0A00), shape = RoundedCornerShape(12.dp))
            .padding(8.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            // Compass arrow in a circle
            Box(
                modifier = Modifier
                    .size(48.dp)
                    .background(Color(0x33FF3300), shape = CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = Icons.Default.Navigation,
                    contentDescription = "Direction to trap",
                    tint = Color(0xFFFF4400),
                    modifier = Modifier
                        .size(32.dp)
                        .rotate(arrowRotation),
                )
            }

            Text(
                text = distanceText,
                color = Color.White,
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
            )

            Text(
                text = "⚠ TRAP",
                color = Color(0xFFFF4400),
                fontSize = 9.sp,
                fontWeight = FontWeight.Bold,
            )
        }
    }
}

/** Bearing in degrees [0, 360) from (fromLat, fromLng) to (toLat, toLng). */
private fun bearingTo(
    fromLat: Double, fromLng: Double,
    toLat: Double,   toLng: Double,
): Float {
    val lat1 = Math.toRadians(fromLat)
    val lat2 = Math.toRadians(toLat)
    val dLng = Math.toRadians(toLng - fromLng)
    val y = sin(dLng) * cos(lat2)
    val x = cos(lat1) * sin(lat2) - sin(lat1) * cos(lat2) * cos(dLng)
    return ((Math.toDegrees(atan2(y, x)).toFloat() + 360f) % 360f)
}
