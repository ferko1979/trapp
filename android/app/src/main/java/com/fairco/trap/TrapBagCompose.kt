package com.fairco.trap

import androidx.compose.animation.AnimatedVisibility
import com.fairco.trap.ui.theme.Radar
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import coil.compose.AsyncImage
import coil.request.ImageRequest

@Composable
fun TrapBagCard(
    viewModel: GameViewModel,
    peekMode: Boolean = false,
    onPlaceTrap: (TrapInventoryItem) -> Unit,
    onWatchRefillAd: ((trapTypeId: String) -> Unit)? = null,
    onOpenAwards: (() -> Unit)? = null,
) {
    val state by viewModel.bagState.collectAsState()
    val adSettings by viewModel.adSettings.collectAsState()
    val refillAdUses by viewModel.refillAdUses.collectAsState()
    val cardCount by viewModel.unusedTimeCardCount.collectAsState()
    val refillAdUsesRemaining = (adSettings.rewardedRefillAdMaxUsesPerSession - refillAdUses).coerceAtLeast(0)
    var showWeightInfo by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(Radar.Surface)
            .animateContentSize()
            .padding(horizontal = 12.dp, vertical = if (peekMode) 8.dp else 10.dp)
    ) {
        BagHeader(state, cardCount = cardCount, onInfoClick = { showWeightInfo = true }, onOpenAwards = onOpenAwards)

        // Collapsed peek hint
        AnimatedVisibility(visible = peekMode) {
            Text(
                stringResource(R.string.hint_tap_map_to_place),
                color = Radar.TextMuted,
                fontSize = 10.sp,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 4.dp, bottom = 2.dp)
            )
        }

        // Full bag contents
        AnimatedVisibility(
            visible = !peekMode,
            enter = expandVertically(),
            exit = shrinkVertically()
        ) {
            Column {
                Spacer(Modifier.height(8.dp))
                if (state.loading && state.items.isEmpty()) {
                    Box(
                        modifier = Modifier.fillMaxWidth().height(56.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        CircularProgressIndicator(
                            color = Radar.Accent,
                            modifier = Modifier.size(24.dp),
                            strokeWidth = 2.dp
                        )
                    }
                } else if (state.items.all { it.bagCount == 0 && (it.secondsUntilNextRefill ?: 0L) == 0L }) {
                    Box(
                        modifier = Modifier.fillMaxWidth().height(48.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            stringResource(R.string.msg_bag_empty_refill),
                            color = Radar.TextMuted,
                            fontSize = 12.sp
                        )
                    }
                } else {
                    val visibleItems = state.items.filter {
                        it.bagCount > 0 || (it.secondsUntilNextRefill ?: 0L) > 0
                            || it.blockedBySlots || it.blockedByWeight
                    }
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        visibleItems.forEach { item ->
                            TrapChip(
                                item = item,
                                onPlaceTrap = onPlaceTrap,
                                showRefillAd = adSettings.rewardedRefillAdEnabled && refillAdUsesRemaining > 0 && onWatchRefillAd != null,
                                onWatchRefillAd = onWatchRefillAd,
                            )
                        }
                    }
                }
            }
        }
    }

    // Weight info dialog
    if (showWeightInfo) {
        AlertDialog(
            onDismissRequest = { showWeightInfo = false },
            containerColor = Radar.Surface,
            title = {
                Text(
                    stringResource(R.string.label_bag_weight_info_title),
                    color = Radar.Text,
                    fontWeight = FontWeight.Bold
                )
            },
            text = {
                Text(
                    stringResource(R.string.msg_bag_weight_info),
                    color = Radar.TextSec,
                    fontSize = 14.sp,
                    lineHeight = 20.sp
                )
            },
            confirmButton = {
                TextButton(onClick = { showWeightInfo = false }) {
                    Text(stringResource(R.string.action_close), color = Radar.Accent)
                }
            }
        )
    }
}

@Composable
private fun BagHeader(
    state: BagUiState,
    cardCount: Int = 0,
    onInfoClick: () -> Unit,
    onOpenAwards: (() -> Unit)? = null,
) {
    val fillFraction = if (state.maxWeightKg > 0)
        (state.currentWeightKg / state.maxWeightKg).coerceIn(0f, 1f) else 0f

    val barColor = when {
        fillFraction > 0.9f -> Radar.Trap
        fillFraction > 0.7f -> Radar.Gold
        else -> Radar.Safe
    }

    Column {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                stringResource(R.string.label_trap_bag_title),
                color = Radar.TextSec,
                fontSize = 12.sp,
                fontWeight = FontWeight.Bold
            )
            Spacer(Modifier.width(6.dp))
            // "i" info button for bag weight explanation
            Box(
                modifier = Modifier
                    .size(16.dp)
                    .background(Radar.Line, CircleShape)
                    .clickable { onInfoClick() },
                contentAlignment = Alignment.Center
            ) {
                Text("i", color = Radar.Accent, fontSize = 9.sp, fontWeight = FontWeight.ExtraBold)
            }
            Spacer(Modifier.width(6.dp))
            Box(
                modifier = Modifier
                    .weight(1f)
                    .height(6.dp)
                    .clip(RoundedCornerShape(3.dp))
                    .background(Radar.Surface2)
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxHeight()
                        .fillMaxWidth(fillFraction)
                        .background(barColor)
                )
            }
            Spacer(Modifier.width(8.dp))
            Text(
                "${state.currentWeightKg.toInt()} / ${state.maxWeightKg.toInt()} kg",
                color = Radar.TextMuted,
                fontSize = 11.sp
            )
        }

        // Card count chip — only shown when user has cards
        if (cardCount > 0 && onOpenAwards != null) {
            Spacer(Modifier.height(6.dp))
            Row(
                modifier = Modifier
                    .background(Color(0xFF052E16), RoundedCornerShape(8.dp))
                    .clickable { onOpenAwards() }
                    .padding(horizontal = 10.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(5.dp)
            ) {
                Text("⏱️", fontSize = 12.sp)
                Text(
                    LocalContext.current.resources.getQuantityString(R.plurals.bag_cards_available, cardCount, cardCount),
                    color = Radar.Safe,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.SemiBold
                )
            }
        }
    }
}

@Composable
private fun TrapChip(
    item: TrapInventoryItem,
    onPlaceTrap: (TrapInventoryItem) -> Unit,
    showRefillAd: Boolean = false,
    onWatchRefillAd: ((trapTypeId: String) -> Unit)? = null,
) {
    val isEmpty = item.bagCount == 0
    val hasRefill = (item.secondsUntilNextRefill ?: 0L) > 0
    val isFull = item.bagCount >= item.maxBagSlots
    var showDescription by remember { mutableStateOf(false) }

    val borderColor = when {
        isFull  -> Radar.Safe
        isEmpty -> Radar.Line
        else    -> Radar.Accent
    }
    val badgeBg = if (isEmpty) Radar.Line else Radar.Accent

    Card(
        modifier = Modifier.width(90.dp),
        colors = CardDefaults.cardColors(containerColor = Radar.Bg),
        border = BorderStroke(1.dp, borderColor),
        shape = RoundedCornerShape(12.dp)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp, vertical = 8.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            // ── Icon + count badge + info button ──────────────────────────
            Box(modifier = Modifier.fillMaxWidth()) {
                // Trap image (Coil) or emoji fallback — centered
                Box(
                    modifier = Modifier.align(Alignment.Center),
                    contentAlignment = Alignment.BottomEnd
                ) {
                    TrapImage(
                        item = item,
                        size = 32.dp,
                        dimmed = isEmpty
                    )
                    // Count badge
                    Box(
                        modifier = Modifier
                            .size(14.dp)
                            .background(badgeBg, CircleShape),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            "${item.bagCount}",
                            color = if (isEmpty) Color.White else Radar.OnAccent,
                            fontSize = 8.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }
                }
                // "i" info button — top-right corner (always shown for backend traps)
                if (item.trapTypeId.isNotBlank()) {
                    Box(
                        modifier = Modifier
                            .size(14.dp)
                            .align(Alignment.TopEnd)
                            .background(Radar.Line, CircleShape)
                            .clickable { showDescription = true },
                        contentAlignment = Alignment.Center
                    ) {
                        Text("i", color = Radar.Accent, fontSize = 8.sp, fontWeight = FontWeight.ExtraBold)
                    }
                }
            }

            Spacer(Modifier.height(5.dp))

            // ── Trap name ─────────────────────────────────────────────────
            Text(
                text = item.name,
                color = if (isEmpty) Radar.TextMuted else Radar.TextSec,
                fontSize = 9.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 2,
                lineHeight = 11.sp,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth()
            )

            // ── Blocked / refill indicator ────────────────────────────────
            when {
                item.blockedByWeight -> {
                    Spacer(Modifier.height(3.dp))
                    Text(
                        stringResource(R.string.label_blocked_weight),
                        color = Radar.Trap,
                        fontSize = 9.sp,
                        fontWeight = FontWeight.Medium,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
                item.blockedBySlots -> {
                    Spacer(Modifier.height(3.dp))
                    Text(
                        stringResource(R.string.label_blocked_slots),
                        color = Radar.Gold,
                        fontSize = 9.sp,
                        fontWeight = FontWeight.Medium,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
                hasRefill && !isFull -> {
                    Spacer(Modifier.height(3.dp))
                    Text(
                        "⏳ ${formatCountdown(item.secondsUntilNextRefill!!)}",
                        color = Radar.Gold,
                        fontSize = 9.sp,
                        fontWeight = FontWeight.Medium,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth()
                    )
                    if (showRefillAd && onWatchRefillAd != null) {
                        Spacer(Modifier.height(2.dp))
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .background(Radar.Line, RoundedCornerShape(4.dp))
                                .clickable { onWatchRefillAd(item.trapTypeId) }
                                .padding(vertical = 3.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                "📺 " + stringResource(R.string.bag_speed_up),
                                color = Radar.Accent,
                                fontSize = 8.sp,
                                fontWeight = FontWeight.SemiBold,
                                textAlign = TextAlign.Center,
                            )
                        }
                    }
                }
            }

            Spacer(Modifier.height(8.dp))

            // ── Place button ───────────────────────────────────────────────
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(
                        if (isEmpty) Radar.Surface else Radar.AccentDeep,
                        RoundedCornerShape(5.dp)
                    )
                    .clickable(enabled = !isEmpty) { onPlaceTrap(item) }
                    .padding(vertical = 5.dp),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    stringResource(R.string.action_place_trap),
                    color = if (isEmpty) Radar.TextMuted else Color.White,
                    fontSize = 8.sp,
                    fontWeight = FontWeight.Bold
                )
            }
        }
    }

    // Description dialog
    if (showDescription) {
        TrapDescriptionDialog(item = item, onDismiss = { showDescription = false })
    }
}

@Composable
fun TrapDescriptionDialog(item: TrapInventoryItem, onDismiss: () -> Unit) {
    Dialog(onDismissRequest = onDismiss) {
        Card(
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(containerColor = Radar.Surface),
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
        ) {
            Column(
                modifier = Modifier.padding(20.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                // Large trap image or emoji
                TrapImage(item = item, size = 80.dp, dimmed = false)

                Spacer(Modifier.height(12.dp))

                Text(
                    text = item.name,
                    color = Radar.Text,
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Bold,
                    textAlign = TextAlign.Center
                )

                if (item.effectKind.isNotBlank() && item.effectKind != "none") {
                    Spacer(Modifier.height(4.dp))
                    Text(
                        text = "✨ " + effectKindName(item.effectKind),
                        color = Radar.Accent,
                        fontSize = 12.sp,
                        textAlign = TextAlign.Center
                    )
                }

                Spacer(Modifier.height(12.dp))

                if (item.description.isNotBlank()) {
                    Text(
                        text = item.description,
                        color = Radar.TextSec,
                        fontSize = 14.sp,
                        lineHeight = 20.sp,
                        textAlign = TextAlign.Center
                    )
                }

                Spacer(Modifier.height(8.dp))

                // Weight info row
                Row(
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    TrapStatChip(label = "⚖️", value = "${item.weight.toInt()} kg")
                    TrapStatChip(label = "📦", value = "${item.bagCount}/${item.maxBagSlots}")
                    if ((item.secondsUntilNextRefill ?: 0L) > 0) {
                        TrapStatChip(label = "⏳", value = formatCountdown(item.secondsUntilNextRefill!!))
                    }
                }

                Spacer(Modifier.height(16.dp))

                TextButton(onClick = onDismiss) {
                    Text(stringResource(R.string.action_close), color = Radar.Accent)
                }
            }
        }
    }
}

@Composable
private fun TrapStatChip(label: String, value: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(label, fontSize = 14.sp)
        Text(value, color = Radar.TextSec, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
    }
}

/**
 * Shared composable that shows the trap's image (via Coil from imageUrl)
 * or falls back to the emoji icon. If imageUrl is set but fails to load
 * (broken URL, auth-protected Storage URL, etc.) the emoji is shown instead.
 */
@Composable
fun TrapImage(
    item: TrapInventoryItem,
    size: androidx.compose.ui.unit.Dp,
    dimmed: Boolean = false,
    modifier: Modifier = Modifier
) {
    val emojiMod = modifier
        .size(size)
        .then(if (dimmed) Modifier.alpha(0.4f) else Modifier)

    val emojiText = trapIcon(item.iconKey, item.emoji)

    if (!item.imageUrl.isNullOrBlank()) {
        var loadFailed by remember(item.imageUrl) { mutableStateOf(false) }
        if (loadFailed) {
            Text(
                text = emojiText,
                fontSize = (size.value * 0.7f).sp,
                modifier = emojiMod,
                textAlign = TextAlign.Center,
            )
        } else {
            AsyncImage(
                model = ImageRequest.Builder(LocalContext.current)
                    .data(item.imageUrl)
                    .crossfade(true)
                    .build(),
                contentDescription = item.name,
                contentScale = ContentScale.Fit,
                onError = { loadFailed = true },
                modifier = emojiMod,
            )
        }
    } else {
        Text(
            text = emojiText,
            fontSize = (size.value * 0.7f).sp,
            modifier = emojiMod,
            textAlign = TextAlign.Center,
        )
    }
}

/**
 * Returns the display emoji for a trap.
 * Priority: [emoji] from backend → pattern match on [iconKey] → fallback 🎯
 * Adding a new trap type only requires setting its [emoji] field in Firestore.
 */
fun trapIcon(iconKey: String, emoji: String = ""): String {
    if (emoji.isNotBlank()) return emoji
    return when {
        iconKey.contains("prank")   || iconKey.contains("fun")                         -> "😈"
        iconKey.contains("iron")    || (iconKey.contains("timeout") && iconKey.contains("major")) -> "⛓️"
        iconKey.contains("snare")   || iconKey.contains("timeout")                     -> "🪤"
        iconKey.contains("spider")                                                     -> "🕷️"
        iconKey.contains("bubble")                                                     -> "🫧"
        iconKey.contains("rainbow") || iconKey.contains("freeze")                      -> "🌈"
        else -> "🎯"
    }
}

fun formatCountdown(totalSeconds: Long): String {
    val h = totalSeconds / 3600
    val m = (totalSeconds % 3600) / 60
    val s = totalSeconds % 60
    return when {
        h > 0 -> "${h}h ${m}m"
        m > 0 -> "${m}m ${s}s"
        else -> "${s}s"
    }
}

/** Localized name of a trap effect kind; unknown kinds fall back to the capitalized key. */
@Composable
private fun effectKindName(kind: String): String = when (kind) {
    "timeout"  -> stringResource(R.string.trap_kind_timeout)
    "laughter" -> stringResource(R.string.trap_kind_laughter)
    "slowdown" -> stringResource(R.string.trap_kind_slowdown)
    "penalty"  -> stringResource(R.string.trap_kind_penalty)
    "warning"  -> stringResource(R.string.trap_kind_warning)
    else       -> kind.replaceFirstChar { it.uppercase() }
}
