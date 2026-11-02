package com.fairco.trap

import androidx.compose.foundation.background
import com.fairco.trap.ui.theme.Radar
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LinearProgressIndicator
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

@Composable
fun PlacementProgressOverlay(
    trap: TrapInventoryItem?,
    state: PlacementProgressState,
    onCancel: () -> Unit,
    rewardedAdEnabled: Boolean = false,
    rewardedLabel: String = "30 seconds",
    adUsesRemaining: Int = 0,
    onWatchAd: () -> Unit = {},
    cardCount: Int = 0,
    onUseCard: () -> Unit = {},
) {
    val progress = if (state.totalSeconds > 0)
        (state.elapsedSeconds.toFloat() / state.totalSeconds).coerceIn(0f, 1f)
    else 0f
    val remainingSecs = (state.totalSeconds - state.elapsedSeconds).coerceAtLeast(0)

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Radar.Bg.copy(alpha = 0.93f)),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.padding(horizontal = 32.dp)
        ) {
            Spacer(Modifier.height(16.dp))

            trap?.let {
                TrapImage(item = it, size = 64.dp, dimmed = false)
                Spacer(Modifier.height(4.dp))
                Text(
                    text = it.name,
                    color = Radar.Text,
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Bold,
                    textAlign = TextAlign.Center
                )
            }

            Spacer(Modifier.height(8.dp))

            if (state.isWaitingForServer) {
                Spacer(Modifier.height(16.dp))
                CircularProgressIndicator(
                    color = Radar.Accent,
                    trackColor = Radar.Line,
                    modifier = Modifier.size(56.dp)
                )
                Spacer(Modifier.height(16.dp))
                Text(
                    text = "Communicating with server…",
                    color = Radar.TextSec,
                    fontSize = 15.sp,
                    textAlign = TextAlign.Center
                )
                Spacer(Modifier.height(8.dp))
            } else {
                Text(
                    text = stringResource(R.string.label_placing_trap),
                    color = Radar.TextSec,
                    fontSize = 13.sp,
                    textAlign = TextAlign.Center
                )

                Text(
                    text = remainingSecs.toString(),
                    color = Radar.Accent,
                    fontSize = 56.sp,
                    fontWeight = FontWeight.ExtraBold
                )

                LinearProgressIndicator(
                    progress = { progress },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(8.dp),
                    color = Radar.Accent,
                    trackColor = Radar.Line
                )

                if (state.outOfRadiusCountdown >= 0) {
                    Spacer(Modifier.height(4.dp))
                    val warningText = if (state.metersToClose > 0) {
                        stringResource(R.string.warning_return_to_placement, state.metersToClose, state.outOfRadiusCountdown)
                    } else {
                        stringResource(R.string.warning_return_to_radius, state.outOfRadiusCountdown)
                    }
                    Text(
                        text = warningText,
                        color = Radar.Gold,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.SemiBold,
                        textAlign = TextAlign.Center
                    )
                }

                Spacer(Modifier.height(8.dp))

                if (cardCount > 0 && !state.isComplete && state.outOfRadiusCountdown < 0) {
                    TextButton(
                        onClick = onUseCard,
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(Color(0xFF1A2E1A), shape = androidx.compose.foundation.shape.RoundedCornerShape(10.dp))
                            .padding(vertical = 2.dp)
                    ) {
                        Text(
                            text = "⏱️  Use Card — Skip 5 min${if (cardCount > 1) "  ($cardCount left)" else ""}",
                            color = Radar.Safe,
                            fontSize = 14.sp,
                            fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold
                        )
                    }
                    Spacer(Modifier.height(4.dp))
                }

                if (rewardedAdEnabled && adUsesRemaining > 0 && !state.isComplete && state.outOfRadiusCountdown < 0) {
                    TextButton(
                        onClick = onWatchAd,
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(Radar.Line, shape = androidx.compose.foundation.shape.RoundedCornerShape(10.dp))
                            .padding(vertical = 2.dp)
                    ) {
                        Text(
                            text = "📺  Watch Ad — Skip $rewardedLabel${if (adUsesRemaining > 1) "  ($adUsesRemaining left)" else ""}",
                            color = Radar.Accent,
                            fontSize = 14.sp,
                            fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold
                        )
                    }
                    Spacer(Modifier.height(4.dp))
                }

                TextButton(onClick = onCancel) {
                    Text(
                        text = stringResource(R.string.action_cancel_placement),
                        color = Radar.TextMuted,
                        fontSize = 14.sp
                    )
                }
            }
        }
    }
}

@Composable
fun PlacementHoldOverlay(
    trap: TrapInventoryItem,
    startError: String? = null,
    onConfirm: () -> Unit,
    onCancel: () -> Unit,
    onClose: () -> Unit = {}
) {
    var isHeld by remember { mutableStateOf(false) }
    var progress by remember { mutableFloatStateOf(0f) }
    // Once confirmed, the button is replaced by a "Processing…" indicator
    // to prevent the user from pressing again while the network call is in flight.
    var confirmed by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    var holdJob by remember { mutableStateOf<Job?>(null) }

    LaunchedEffect(isHeld) {
        if (isHeld && !confirmed) {
            holdJob?.cancel()
            holdJob = scope.launch {
                val startTime = System.currentTimeMillis()
                while (isActive && progress < 1f) {
                    val elapsed = System.currentTimeMillis() - startTime
                    progress = (elapsed / 2000f).coerceIn(0f, 1f)
                    delay(16)
                }
                if (isActive && progress >= 1f) {
                    confirmed = true   // lock UI immediately — no more button presses
                    onConfirm()
                }
            }
        } else {
            holdJob?.cancel()
            holdJob = null
            if (!confirmed) {
                // Decay back to 0 on release (only if not yet confirmed)
                scope.launch {
                    while (progress > 0f) {
                        progress = (progress - 0.05f).coerceAtLeast(0f)
                        delay(16)
                    }
                }
            }
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Radar.Bg.copy(alpha = 0.93f)),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.padding(horizontal = 32.dp)
        ) {
            Spacer(Modifier.height(16.dp))

            // Trap image (Coil) or emoji fallback
            TrapImage(item = trap, size = 72.dp)

            Spacer(Modifier.height(4.dp))

            // Trap name
            Text(
                text = trap.name,
                color = Radar.Text,
                fontSize = 22.sp,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center
            )

            if (confirmed && startError != null) {
                // ── Error state — placement call failed, show message + close button ──
                Spacer(Modifier.height(16.dp))
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(Radar.Trap.copy(alpha = 0.20f), shape = RoundedCornerShape(12.dp))
                        .padding(16.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(
                            text = "⚠",
                            color = Radar.TrapSoft,
                            fontSize = 28.sp
                        )
                        Text(
                            text = startError,
                            color = Radar.TrapSoft,
                            fontSize = 14.sp,
                            fontWeight = FontWeight.SemiBold,
                            textAlign = TextAlign.Center
                        )
                    }
                }
                Spacer(Modifier.height(20.dp))
                TextButton(
                    onClick = onClose,
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(Color(0xFF7F1D1D), shape = RoundedCornerShape(10.dp))
                        .padding(vertical = 4.dp)
                ) {
                    Text(
                        text = "✕  Close",
                        color = Radar.TrapSoft,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Bold
                    )
                }
                Spacer(Modifier.height(8.dp))
            } else if (confirmed) {
                // ── Processing state — button replaced, no interaction possible ──
                Spacer(Modifier.height(20.dp))
                Text(
                    text = stringResource(R.string.label_confirming_placement),
                    color = Radar.TextSec,
                    fontSize = 15.sp,
                    textAlign = TextAlign.Center
                )
                Spacer(Modifier.height(16.dp))
                // Filled arc to show completion
                Box(
                    contentAlignment = Alignment.Center,
                    modifier = Modifier
                        .size(148.dp)
                        .drawBehind {
                            val strokePx = 10.dp.toPx()
                            val inset = strokePx / 2 + 4.dp.toPx()
                            val arcTopLeft = Offset(inset, inset)
                            val arcSize = Size(size.width - inset * 2, size.height - inset * 2)
                            drawArc(
                                color = Radar.Line,
                                startAngle = 0f,
                                sweepAngle = 360f,
                                useCenter = false,
                                topLeft = arcTopLeft,
                                size = arcSize,
                                style = Stroke(width = strokePx)
                            )
                            drawArc(
                                color = Radar.Accent,
                                startAngle = -90f,
                                sweepAngle = 360f,
                                useCenter = false,
                                topLeft = arcTopLeft,
                                size = arcSize,
                                style = Stroke(width = strokePx, cap = StrokeCap.Round)
                            )
                            val innerRadius = size.minDimension / 2 - strokePx - 6.dp.toPx()
                            drawCircle(color = Radar.AccentDeep, radius = innerRadius)
                        }
                ) {
                    Text(
                        text = "✓",
                        color = Color.White,
                        fontSize = 36.sp,
                        fontWeight = FontWeight.ExtraBold
                    )
                }
                Spacer(Modifier.height(20.dp))
            } else {
                // ── Normal hold-button state ──
                Text(
                    text = stringResource(R.string.label_hold_for_2s),
                    color = Radar.TextMuted,
                    fontSize = 13.sp,
                    textAlign = TextAlign.Center
                )

                Spacer(Modifier.height(20.dp))

                // PUSH hold button with circular progress arc
                Box(
                    contentAlignment = Alignment.Center,
                    modifier = Modifier
                        .size(148.dp)
                        .pointerInput(Unit) {
                            awaitEachGesture {
                                awaitFirstDown(requireUnconsumed = false)
                                isHeld = true
                                waitForUpOrCancellation()
                                isHeld = false
                            }
                        }
                        .drawBehind {
                            val strokePx = 10.dp.toPx()
                            val inset = strokePx / 2 + 4.dp.toPx()
                            val arcTopLeft = Offset(inset, inset)
                            val arcSize = Size(size.width - inset * 2, size.height - inset * 2)

                            // Track ring
                            drawArc(
                                color = Radar.Line,
                                startAngle = 0f,
                                sweepAngle = 360f,
                                useCenter = false,
                                topLeft = arcTopLeft,
                                size = arcSize,
                                style = Stroke(width = strokePx)
                            )
                            // Progress arc
                            if (progress > 0f) {
                                drawArc(
                                    color = Radar.Accent,
                                    startAngle = -90f,
                                    sweepAngle = 360f * progress,
                                    useCenter = false,
                                    topLeft = arcTopLeft,
                                    size = arcSize,
                                    style = Stroke(width = strokePx, cap = StrokeCap.Round)
                                )
                            }
                            // Inner button circle
                            val innerRadius = size.minDimension / 2 - strokePx - 6.dp.toPx()
                            drawCircle(
                                color = Radar.AccentDeep,
                                radius = innerRadius
                            )
                        }
                ) {
                    Text(
                        text = stringResource(R.string.action_push),
                        color = Color.White,
                        fontSize = 22.sp,
                        fontWeight = FontWeight.ExtraBold,
                        letterSpacing = 2.sp
                    )
                }

                Spacer(Modifier.height(20.dp))

                TextButton(onClick = onCancel) {
                    Text(
                        text = stringResource(R.string.action_cancel_placement),
                        color = Radar.TextMuted,
                        fontSize = 14.sp
                    )
                }
            }
        }
    }
}
