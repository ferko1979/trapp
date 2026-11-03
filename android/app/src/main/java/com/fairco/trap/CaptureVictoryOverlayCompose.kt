package com.fairco.trap

import androidx.compose.ui.res.stringResource
import androidx.compose.animation.core.*
import com.fairco.trap.ui.theme.Radar
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import kotlinx.coroutines.delay

/**
 * Full-screen celebration overlay shown to the trap owner when someone walks into their trap.
 * Auto-dismisses after [AUTO_DISMISS_MS] ms.
 */
@Composable
fun CaptureVictoryOverlay(
    event: CaptureVictoryEvent,
    onDismiss: () -> Unit
) {
    // Auto-dismiss
    LaunchedEffect(event) {
        delay(AUTO_DISMISS_MS)
        onDismiss()
    }

    // Entry scale spring
    val scaleAnim = remember { Animatable(0.6f) }
    LaunchedEffect(Unit) {
        scaleAnim.animateTo(
            targetValue = 1f,
            animationSpec = spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessMedium)
        )
    }

    // Pulsing glow on trophy emoji
    val infiniteTransition = rememberInfiniteTransition(label = "glow")
    val glowScale by infiniteTransition.animateFloat(
        initialValue = 1f,
        targetValue  = 1.12f,
        animationSpec = infiniteRepeatable(
            animation = tween(700, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "glowScale"
    )

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xCC001020)),
        contentAlignment = Alignment.Center
    ) {
        Column(
            modifier = Modifier
                .scale(scaleAnim.value)
                .padding(horizontal = 32.dp)
                .clip(RoundedCornerShape(24.dp))
                .background(
                    Brush.verticalGradient(
                        listOf(Color(0xFF0D2B4A), Radar.Bg)
                    )
                )
                .padding(32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Trophy header
            Text(
                text = "🎉",
                fontSize = 52.sp,
                modifier = Modifier.scale(glowScale)
            )

            Text(
                text = stringResource(R.string.capture_your_trap_fired),
                fontSize = 20.sp,
                fontWeight = FontWeight.ExtraBold,
                color = Radar.Gold,
                letterSpacing = 2.sp
            )

            // Trap image or emoji
            TrapImageOrEmoji(event)

            // Victim name
            Text(
                text = stringResource(R.string.capture_caught),
                fontSize = 13.sp,
                color = Radar.TextSec
            )
            Text(
                text = "@${event.capturedUsername}",
                fontSize = 22.sp,
                fontWeight = FontWeight.Bold,
                color = Color.White,
                textAlign = TextAlign.Center
            )

            // Effect tag
            EffectTag(event.effectKind)

            Spacer(Modifier.height(4.dp))

            // Tap to dismiss hint
            Text(
                text = stringResource(R.string.capture_tap_to_dismiss),
                fontSize = 11.sp,
                color = Radar.TextMuted
            )
        }

        // Full-screen tap target to dismiss early (no ripple — the content card is what's visible)
        Box(
            modifier = Modifier
                .fillMaxSize()
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null
                ) { onDismiss() }
        )
    }
}

@Composable
private fun TrapImageOrEmoji(event: CaptureVictoryEvent) {
    Box(
        modifier = Modifier
            .size(100.dp)
            .clip(CircleShape)
            .background(Radar.Line),
        contentAlignment = Alignment.Center
    ) {
        if (!event.imageUrl.isNullOrBlank()) {
            AsyncImage(
                model            = event.imageUrl,
                contentDescription = event.trapTypeId,
                modifier         = Modifier.fillMaxSize().clip(CircleShape)
            )
        } else {
            Text(text = event.emoji.ifBlank { "🪤" }, fontSize = 44.sp)
        }
    }
}

@Composable
private fun EffectTag(effectKind: String) {
    val (bg, label) = when (effectKind) {
        "timeout"  -> Radar.AccentDeep to stringResource(R.string.capture_tag_timeout)
        "laughter" -> Color(0xFF7C3AED) to stringResource(R.string.capture_tag_prank)
        "score"    -> Color(0xFF065F46) to stringResource(R.string.capture_tag_xp)
        else       -> Radar.Line to stringResource(R.string.capture_tag_sprung)
    }
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(50))
            .background(bg)
            .padding(horizontal = 16.dp, vertical = 6.dp)
    ) {
        Text(text = label, fontSize = 13.sp, color = Color.White, fontWeight = FontWeight.SemiBold)
    }
}

private const val AUTO_DISMISS_MS = 7_000L
