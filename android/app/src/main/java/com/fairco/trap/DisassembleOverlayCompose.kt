package com.fairco.trap

import androidx.compose.foundation.background
import com.fairco.trap.ui.theme.Radar
import androidx.compose.foundation.gestures.awaitEachGesture
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
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.foundation.layout.size
import androidx.compose.material3.LinearProgressIndicator
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

@Composable
fun DisassembleProgressOverlay(
    state: DisassemblyProgressState,
    onCancel: () -> Unit,
    trapItem: TrapInventoryItem? = null,
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

            if (trapItem != null) {
                TrapImage(item = trapItem, size = 64.dp)
            } else {
                Text(text = "🪤", fontSize = 56.sp)
            }

            Text(
                text = stringResource(R.string.label_disassembling),
                color = Radar.Text,
                fontSize = 18.sp,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center
            )

            if (state.isWaitingForServer) {
                Spacer(Modifier.height(16.dp))
                CircularProgressIndicator(
                    color = Radar.Gold,
                    trackColor = Color(0xFF3B1E00),
                    modifier = Modifier.size(56.dp)
                )
                Spacer(Modifier.height(16.dp))
                Text(
                    text = stringResource(R.string.disarm_communicating),
                    color = Radar.TextSec,
                    fontSize = 15.sp,
                    textAlign = TextAlign.Center
                )
                Spacer(Modifier.height(8.dp))
            } else {
                Text(
                    text = remainingSecs.toString(),
                    color = Radar.Gold,
                    fontSize = 56.sp,
                    fontWeight = FontWeight.ExtraBold
                )

                LinearProgressIndicator(
                    progress = { progress },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(8.dp),
                    color = Radar.Gold,
                    trackColor = Color(0xFF3B1E00)
                )

                if (state.outOfZoneCountdown >= 0) {
                    Spacer(Modifier.height(4.dp))
                    Text(
                        text = stringResource(R.string.warning_return_to_zone, state.outOfZoneCountdown),
                        color = Radar.Trap,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.SemiBold,
                        textAlign = TextAlign.Center
                    )
                }

                Spacer(Modifier.height(8.dp))

                if (cardCount > 0 && !state.isComplete && state.outOfZoneCountdown < 0) {
                    TextButton(
                        onClick = onUseCard,
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(Color(0xFF1A2E1A), shape = androidx.compose.foundation.shape.RoundedCornerShape(10.dp))
                            .padding(vertical = 2.dp)
                    ) {
                        Text(
                            text = stringResource(R.string.disarm_use_card_skip) + (if (cardCount > 1) "  " + stringResource(R.string.disarm_n_left, cardCount) else ""),
                            color = Radar.Safe,
                            fontSize = 14.sp,
                            fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold
                        )
                    }
                    Spacer(Modifier.height(4.dp))
                }

                if (rewardedAdEnabled && adUsesRemaining > 0 && !state.isComplete && state.outOfZoneCountdown < 0) {
                    TextButton(
                        onClick = onWatchAd,
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(Color(0xFF3B1E00), shape = androidx.compose.foundation.shape.RoundedCornerShape(10.dp))
                            .padding(vertical = 2.dp)
                    ) {
                        Text(
                            text = stringResource(R.string.disarm_watch_ad_skip, rewardedLabel) + (if (adUsesRemaining > 1) "  " + stringResource(R.string.disarm_n_left, adUsesRemaining) else ""),
                            color = Radar.Gold,
                            fontSize = 14.sp,
                            fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold
                        )
                    }
                    Spacer(Modifier.height(4.dp))
                }

                TextButton(onClick = onCancel) {
                    Text(
                        text = stringResource(R.string.action_cancel),
                        color = Radar.TextMuted,
                        fontSize = 14.sp
                    )
                }
            }
        }
    }
}

@Composable
fun DisassembleOverlay(
    info: TrapMarkerInfo,
    countdown: Int,
    isComplete: Boolean,
    onDisassembleConfirmed: () -> Unit,
    onDismiss: () -> Unit,
    trapItem: TrapInventoryItem? = null,
    startError: String? = null,
) {
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

            Text(
                text = if (info.isMine) stringResource(R.string.label_your_trap_info)
                       else stringResource(R.string.label_others_trap_info),
                color = Radar.TextSec,
                fontSize = 13.sp,
                textAlign = TextAlign.Center
            )

            if (trapItem != null) {
                TrapImage(item = trapItem, size = 72.dp)
                Text(
                    text = trapItem.name,
                    color = Radar.TextSec,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold,
                    textAlign = TextAlign.Center
                )
            } else {
                Text(text = "🪤", fontSize = 72.sp)
            }

            when {
                isComplete -> {
                    Text(
                        text = stringResource(R.string.msg_disassemble_success),
                        color = Radar.Safe,
                        fontSize = 20.sp,
                        fontWeight = FontWeight.Bold,
                        textAlign = TextAlign.Center
                    )
                }
                countdown >= 0 -> {
                    Text(
                        text = stringResource(R.string.label_disassembling),
                        color = Radar.Text,
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Bold,
                        textAlign = TextAlign.Center
                    )
                    Text(
                        text = stringResource(R.string.label_disassemble_countdown, countdown),
                        color = Radar.Gold,
                        fontSize = 40.sp,
                        fontWeight = FontWeight.ExtraBold,
                        textAlign = TextAlign.Center
                    )
                }
                else -> {
                    DisassembleHoldButton(onConfirm = onDisassembleConfirmed, resetKey = startError)
                }
            }

            Spacer(Modifier.height(12.dp))

            if (startError != null) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(Radar.Trap.copy(alpha = 0.20f), shape = androidx.compose.foundation.shape.RoundedCornerShape(10.dp))
                        .padding(horizontal = 14.dp, vertical = 10.dp)
                ) {
                    Text(
                        text = "⚠️ $startError",
                        color = Radar.TrapSoft,
                        fontSize = 13.sp,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
                Spacer(Modifier.height(8.dp))
            }

            if (!isComplete && countdown < 0) {
                TextButton(onClick = onDismiss) {
                    Text(
                        text = stringResource(R.string.action_cancel),
                        color = Radar.TextMuted,
                        fontSize = 14.sp
                    )
                }
            }
        }
    }
}

@Composable
private fun DisassembleHoldButton(onConfirm: () -> Unit, resetKey: Any? = null) {
    var isHeld by remember { mutableStateOf(false) }
    var progress by remember { mutableFloatStateOf(0f) }
    // Once confirmed, replace button with "Processing…" to prevent double-press
    var confirmed by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    var holdJob by remember { mutableStateOf<Job?>(null) }

    // When the server rejects the request (error arrives), unblock the button so the user can retry
    LaunchedEffect(resetKey) {
        if (resetKey != null) {
            holdJob?.cancel()
            holdJob = null
            confirmed = false
            progress = 0f
            isHeld = false
        }
    }

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
                    confirmed = true   // lock UI immediately
                    onConfirm()
                }
            }
        } else {
            holdJob?.cancel()
            holdJob = null
            if (!confirmed) {
                scope.launch {
                    while (progress > 0f) {
                        progress = (progress - 0.05f).coerceAtLeast(0f)
                        delay(16)
                    }
                }
            }
        }
    }

    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        if (confirmed) {
            // ── Processing state — no interaction ──
            Text(
                text = stringResource(R.string.label_confirming_disassembly),
                color = Radar.TextSec,
                fontSize = 15.sp,
                textAlign = TextAlign.Center
            )
            Spacer(Modifier.height(8.dp))
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
                            color = Color(0xFF3B1E00),
                            startAngle = 0f,
                            sweepAngle = 360f,
                            useCenter = false,
                            topLeft = arcTopLeft,
                            size = arcSize,
                            style = Stroke(width = strokePx)
                        )
                        drawArc(
                            color = Radar.Gold,
                            startAngle = -90f,
                            sweepAngle = 360f,
                            useCenter = false,
                            topLeft = arcTopLeft,
                            size = arcSize,
                            style = Stroke(width = strokePx, cap = StrokeCap.Round)
                        )
                        val innerRadius = size.minDimension / 2 - strokePx - 6.dp.toPx()
                        drawCircle(color = Color(0xFFB45309), radius = innerRadius)
                    }
            ) {
                Text(
                    text = "✓",
                    color = Color.White,
                    fontSize = 36.sp,
                    fontWeight = FontWeight.ExtraBold
                )
            }
        } else {
            // ── Normal hold-button state ──
            Text(
                text = stringResource(R.string.label_hold_to_disassemble),
                color = Radar.TextMuted,
                fontSize = 13.sp,
                textAlign = TextAlign.Center
            )

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

                        drawArc(
                            color = Radar.Line,
                            startAngle = 0f,
                            sweepAngle = 360f,
                            useCenter = false,
                            topLeft = arcTopLeft,
                            size = arcSize,
                            style = Stroke(width = strokePx)
                        )
                        if (progress > 0f) {
                            drawArc(
                                color = Radar.Gold,
                                startAngle = -90f,
                                sweepAngle = 360f * progress,
                                useCenter = false,
                                topLeft = arcTopLeft,
                                size = arcSize,
                                style = Stroke(width = strokePx, cap = StrokeCap.Round)
                            )
                        }
                        val innerRadius = size.minDimension / 2 - strokePx - 6.dp.toPx()
                        drawCircle(
                            color = if (isHeld) Color(0xFFB45309) else Radar.Gold,
                            radius = innerRadius
                        )
                    }
            ) {
                Text(
                    text = stringResource(R.string.action_disassemble),
                    color = if (isHeld) Color.White else Radar.OnGold,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.ExtraBold,
                    letterSpacing = 1.sp,
                    textAlign = TextAlign.Center
                )
            }
        }
    }
}
