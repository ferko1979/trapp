package com.fairco.trap

import androidx.compose.foundation.background
import com.fairco.trap.ui.theme.Radar
import com.fairco.trap.ui.theme.RadarFonts
import androidx.compose.foundation.border
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.unit.Dp
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
    onClose: () -> Unit = {},
    targetInfo: String? = null,
    navInset: Dp = 0.dp,
) {
    var isHeld by remember { mutableStateOf(false) }
    var progress by remember { mutableFloatStateOf(0f) }
    // Once confirmed, the ring is replaced by a "Processing…" state
    // to prevent the user from pressing again while the network call is in flight.
    var confirmed by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    var holdJob by remember { mutableStateOf<Job?>(null) }
    val haptic = LocalHapticFeedback.current

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
                    confirmed = true   // lock UI immediately — no more presses
                    haptic.performHapticFeedback(HapticFeedbackType.LongPress)
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
            .background(Radar.Bg.copy(alpha = 0.72f))
    ) {
        // ── Top: what is happening + neutral context about the target ──
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier
                .align(Alignment.TopCenter)
                .fillMaxWidth()
                .statusBarsPadding()
                .padding(horizontal = 24.dp, vertical = 24.dp)
        ) {
            Text(
                text = stringResource(R.string.mh_hold_placing, trap.name.uppercase()),
                color = Radar.Accent,
                fontFamily = RadarFonts.Label,
                fontWeight = FontWeight.Bold,
                fontSize = 13.sp,
                letterSpacing = 2.sp,
                textAlign = TextAlign.Center
            )
            Text(
                text = stringResource(R.string.mh_hold_title),
                color = Radar.Text,
                fontWeight = FontWeight.Bold,
                fontSize = 24.sp,
                textAlign = TextAlign.Center
            )
            if (!targetInfo.isNullOrBlank()) {
                Text(
                    text = targetInfo,
                    color = Radar.TextSec,
                    fontFamily = RadarFonts.Body,
                    fontSize = 13.sp,
                    textAlign = TextAlign.Center,
                    modifier = Modifier
                        .background(Radar.Surface2, RoundedCornerShape(14.dp))
                        .border(1.dp, Radar.Line, RoundedCornerShape(14.dp))
                        .padding(horizontal = 12.dp, vertical = 6.dp)
                )
            }
        }

        // ── Bottom sheet: trap, hold ring, cancel ──
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(14.dp),
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .background(Radar.Surface, RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp))
                .border(1.dp, Radar.Line, RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp))
                .padding(start = 20.dp, end = 20.dp, top = 20.dp, bottom = 16.dp + navInset)
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth()
            ) {
                Box(
                    contentAlignment = Alignment.Center,
                    modifier = Modifier
                        .size(44.dp)
                        .background(Radar.Trap.copy(alpha = 0.18f), RoundedCornerShape(12.dp))
                ) {
                    TrapImage(item = trap, size = 34.dp)
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        text = trap.name,
                        color = Radar.Text,
                        fontWeight = FontWeight.Bold,
                        fontSize = 16.sp
                    )
                    Text(
                        text = stringResource(R.string.mh_hold_left, trap.bagCount),
                        color = Radar.TextMuted,
                        fontSize = 12.sp
                    )
                }
            }

            if (confirmed && startError != null) {
                // ── Error state — placement call failed, show message + close button ──
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(Radar.Trap.copy(alpha = 0.20f), shape = RoundedCornerShape(12.dp))
                        .padding(16.dp)
                ) {
                    Text(text = "⚠", color = Radar.TrapSoft, fontSize = 28.sp)
                    Text(
                        text = startError,
                        color = Radar.TrapSoft,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.SemiBold,
                        textAlign = TextAlign.Center
                    )
                }
                TextButton(
                    onClick = onClose,
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(Color(0xFF7F1D1D), shape = RoundedCornerShape(12.dp))
                        .padding(vertical = 4.dp)
                ) {
                    Text(
                        text = stringResource(R.string.mh_hold_close),
                        color = Radar.TrapSoft,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Bold
                    )
                }
            } else {
                // ── Hold ring (or the armed state while the server confirms) ──
                Box(
                    contentAlignment = Alignment.Center,
                    modifier = Modifier
                        .size(148.dp)
                        .then(
                            if (confirmed) Modifier else Modifier.pointerInput(Unit) {
                                awaitEachGesture {
                                    awaitFirstDown(requireUnconsumed = false)
                                    isHeld = true
                                    waitForUpOrCancellation()
                                    isHeld = false
                                }
                            }
                        )
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
                            val sweep = if (confirmed) 1f else progress
                            if (sweep > 0f) {
                                drawArc(
                                    color = if (confirmed) Radar.Safe else Radar.Trap,
                                    startAngle = -90f,
                                    sweepAngle = 360f * sweep,
                                    useCenter = false,
                                    topLeft = arcTopLeft,
                                    size = arcSize,
                                    style = Stroke(width = strokePx, cap = StrokeCap.Round)
                                )
                            }
                            val innerRadius = size.minDimension / 2 - strokePx - 6.dp.toPx()
                            drawCircle(
                                color = if (isHeld || confirmed) Radar.Trap else Radar.Trap.copy(alpha = 0.85f),
                                radius = innerRadius
                            )
                        }
                ) {
                    when {
                        confirmed -> Text(
                            text = "✓",
                            color = Color.White,
                            fontSize = 36.sp,
                            fontWeight = FontWeight.ExtraBold
                        )
                        progress > 0f -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(
                                text = stringResource(R.string.mh_hold_arming),
                                color = Color.White,
                                fontFamily = RadarFonts.Label,
                                fontWeight = FontWeight.Bold,
                                fontSize = 12.sp,
                                letterSpacing = 2.sp
                            )
                            Text(
                                text = String.format(java.util.Locale.US, "%.1f s", 2f * (1f - progress)),
                                color = Color.White,
                                fontFamily = RadarFonts.Mono,
                                fontWeight = FontWeight.Bold,
                                fontSize = 22.sp
                            )
                        }
                        else -> Text(
                            text = stringResource(R.string.mh_hold_hold),
                            color = Color.White,
                            fontFamily = RadarFonts.Label,
                            fontWeight = FontWeight.ExtraBold,
                            fontSize = 22.sp,
                            letterSpacing = 2.sp
                        )
                    }
                }

                Text(
                    text = if (confirmed) stringResource(R.string.label_confirming_placement)
                           else stringResource(R.string.mh_hold_footer),
                    color = Radar.TextMuted,
                    fontSize = 12.sp,
                    textAlign = TextAlign.Center
                )

                if (!confirmed) {
                    TextButton(onClick = onCancel) {
                        Text(
                            text = stringResource(R.string.action_cancel_placement),
                            color = Radar.TextSec,
                            fontSize = 14.sp
                        )
                    }
                }
            }
        }
    }
}
