package com.fairco.trap

import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay

/**
 * Data describing a capture event received from [updatePlayerLocation].
 */
data class TrappedEvent(
    val trapTypeId: String = "",
    val iconKey: String = "",
    val emoji: String = "",
    val imageUrl: String? = null,
    val soundKey: String? = null,
    val effectKind: String = "",
    val effectValue: Double = 0.0,
    val ownerUsername: String = "",
    val ownerUid: String = ""
)

/**
 * Full-screen overlay shown when the local player walks into someone else's trap.
 * Displays trap image/emoji, effect description, trapper name, and auto-dismisses
 * after [autoDismissSeconds].
 */
@Composable
fun TrappedOverlay(
    event: TrappedEvent,
    onDismiss: () -> Unit,
    autoDismissSeconds: Int = 8,
    onEnemyAction: ((uid: String, action: EnemyAction) -> Unit)? = null
) {
    // Pulse animation for the icon
    val infiniteTransition = rememberInfiniteTransition(label = "trapped_pulse")
    val scale by infiniteTransition.animateFloat(
        initialValue = 1f,
        targetValue = 1.15f,
        animationSpec = infiniteRepeatable(
            animation = tween(700, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "pulse_scale"
    )

    // Countdown to auto-dismiss
    var remaining by remember { mutableIntStateOf(autoDismissSeconds) }
    LaunchedEffect(Unit) {
        while (remaining > 0) {
            delay(1000)
            remaining--
        }
        onDismiss()
    }

    val effectLabel = effectLabel(event.effectKind, event.effectValue)
    val effectColor = effectColor(event.effectKind)

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(
                    colors = listOf(Color(0xFF1A0000), Color(0xFF3B0000), Color(0xFF1A0000))
                )
            ),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp),
            modifier = Modifier.padding(horizontal = 32.dp)
        ) {

            // ── TRAPPED title ────────────────────────────────────────────
            Text(
                text = stringResource(R.string.label_trapped_title),
                color = Color(0xFFEF4444),
                fontSize = 42.sp,
                fontWeight = FontWeight.ExtraBold,
                letterSpacing = 4.sp,
                textAlign = TextAlign.Center
            )

            Spacer(Modifier.height(4.dp))

            // ── Trap image / emoji (pulsing) ─────────────────────────────
            Box(
                modifier = Modifier
                    .scale(scale)
                    .size(120.dp),
                contentAlignment = Alignment.Center
            ) {
                // Build a minimal stub TrapInventoryItem for TrapImage display only
                val displayItem = TrapInventoryItem(
                    id = "",
                    trapTypeId = event.trapTypeId,
                    bagCount = 0,
                    maxBagSlots = 1,
                    weight = 0f,
                    effectiveRefillHours = 0.0,
                    secondsUntilNextRefill = null,
                    canRefillNow = false,
                    blockedBySlots = false,
                    blockedByWeight = false,
                    name = "",
                    iconKey = event.iconKey,
                    effectKind = event.effectKind,
                    emoji = event.emoji,
                    imageUrl = event.imageUrl
                )
                TrapImage(item = displayItem, size = 120.dp)
            }

            Spacer(Modifier.height(4.dp))

            // ── Trapper (enemy) link ─────────────────────────────────────
            if (event.ownerUsername.isNotBlank()) {
                var showEnemyMenu by remember { mutableStateOf(false) }
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        text = "Set by",
                        color = Color(0xFF94A3B8),
                        fontSize = 12.sp
                    )
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(20.dp))
                            .background(Color(0xFF450A0A))
                            .clickable(enabled = event.ownerUid.isNotBlank()) { showEnemyMenu = true }
                            .padding(horizontal = 16.dp, vertical = 6.dp)
                    ) {
                        Text(
                            text = "⚔️ @${event.ownerUsername}",
                            color = Color(0xFFFCA5A5),
                            fontSize = 15.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }
                }
                if (showEnemyMenu) {
                    EnemyActionsDialog(
                        username = event.ownerUsername,
                        onAction = { action ->
                            showEnemyMenu = false
                            onEnemyAction?.invoke(event.ownerUid, action)
                        },
                        onDismiss = { showEnemyMenu = false }
                    )
                }
            }

            // ── Effect chip ──────────────────────────────────────────────
            if (effectLabel.isNotBlank()) {
                Surface(
                    color = effectColor.copy(alpha = 0.2f),
                    shape = RoundedCornerShape(24.dp),
                    border = ButtonDefaults.outlinedButtonBorder
                ) {
                    Text(
                        text = effectLabel,
                        color = effectColor,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
                        textAlign = TextAlign.Center
                    )
                }
            }

            Spacer(Modifier.height(16.dp))

            // ── Dismiss button + countdown ───────────────────────────────
            Button(
                onClick = onDismiss,
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF374151)),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth(0.6f)
            ) {
                Text(
                    text = stringResource(R.string.action_close) + " ($remaining)",
                    color = Color(0xFFCBD5E1),
                    fontWeight = FontWeight.SemiBold
                )
            }
        }
    }
}

// ── Enemy linking ─────────────────────────────────────────────────────────────

enum class EnemyAction { ADD_FRIEND, MESSAGE }

@Composable
fun EnemyActionsDialog(username: String, onAction: (EnemyAction) -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Color(0xFF0D1626),
        titleContentColor = Color(0xFFFCA5A5),
        title = { Text("⚔️ @$username", fontWeight = FontWeight.Bold, fontSize = 16.sp) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(
                    onClick = { onAction(EnemyAction.ADD_FRIEND) },
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1E3A5F))
                ) { Text("👥 Add Friend", color = Color.White) }
                Button(
                    onClick = { onAction(EnemyAction.MESSAGE) },
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF374151))
                ) { Text("💬 Send Message", color = Color.White) }
            }
        },
        confirmButton = {},
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel", color = Color(0xFF64748B)) }
        }
    )
}

/** Tappable enemy username chip for use in lists. */
@Composable
fun EnemyUsernameChip(username: String, enabled: Boolean = true, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(12.dp))
            .background(if (enabled) Color(0xFF450A0A) else Color(0xFF1E293B))
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 4.dp)
    ) {
        Text(
            text = "⚔️ @$username",
            color = if (enabled) Color(0xFFFCA5A5) else Color(0xFF64748B),
            fontSize = 13.sp,
            fontWeight = FontWeight.SemiBold
        )
    }
}

/** Human-readable effect label for TRAPPED overlay. */
private fun effectLabel(effectKind: String, effectValue: Double): String = when (effectKind) {
    "timeout"  -> "⏱ Timeout: ${effectValue.toInt()}s"
    "laughter" -> "😂 Laughter trap — 5s stun"
    "slowdown" -> "🐌 Slowdown: ${effectValue.toInt()}%"
    "penalty"  -> "⚡ Score penalty: ${effectValue.toInt()} pts"
    else       -> ""
}

/** Accent colour for the effect chip. */
private fun effectColor(effectKind: String): Color = when (effectKind) {
    "timeout"  -> Color(0xFFF59E0B)
    "laughter" -> Color(0xFF22C55E)
    "slowdown" -> Color(0xFF60A5FA)
    "penalty"  -> Color(0xFFEF4444)
    else       -> Color(0xFF94A3B8)
}
