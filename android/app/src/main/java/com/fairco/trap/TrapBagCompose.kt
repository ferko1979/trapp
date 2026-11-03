package com.fairco.trap

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import coil.compose.AsyncImage
import coil.request.ImageRequest
import com.fairco.trap.ui.RadarEmptyState
import com.fairco.trap.ui.RadarLoading
import com.fairco.trap.ui.RadarPrimaryButton
import com.fairco.trap.ui.theme.Radar
import com.fairco.trap.ui.theme.RadarFonts

/**
 * Trap bag contents in the Radar style: header with ready count + weight gauge,
 * optional time-card shortcut, then one card per trap (select / place / speed up).
 * [selectedTrapTypeId] is outlined in accent; [onSelectTrap] makes rows tappable.
 */
@Composable
fun TrapBagCard(
    viewModel: GameViewModel,
    peekMode: Boolean = false,
    onPlaceTrap: (TrapInventoryItem) -> Unit,
    onWatchRefillAd: ((trapTypeId: String) -> Unit)? = null,
    onOpenAwards: (() -> Unit)? = null,
    selectedTrapTypeId: String? = null,
    onSelectTrap: ((TrapInventoryItem) -> Unit)? = null,
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
            .animateContentSize()
            .padding(horizontal = 16.dp, vertical = if (peekMode) 8.dp else 4.dp)
    ) {
        BagHeader(state, onInfoClick = { showWeightInfo = true })

        if (cardCount > 0 && onOpenAwards != null) {
            Spacer(Modifier.height(10.dp))
            TimeCardsRow(cardCount, onOpenAwards)
        }

        // Collapsed peek hint
        AnimatedVisibility(visible = peekMode) {
            Text(
                stringResource(R.string.hint_tap_map_to_place),
                color = Radar.TextMuted,
                fontSize = 12.sp,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 6.dp, bottom = 2.dp)
            )
        }

        // Full bag contents
        AnimatedVisibility(
            visible = !peekMode,
            enter = expandVertically(),
            exit = shrinkVertically()
        ) {
            Column {
                if (state.loading && state.items.isEmpty()) {
                    RadarLoading()
                } else if (state.items.all { it.bagCount == 0 && (it.secondsUntilNextRefill ?: 0L) == 0L }) {
                    RadarEmptyState(
                        emoji = "🎒",
                        title = stringResource(R.string.mh_bag_empty),
                        hint = stringResource(R.string.msg_bag_empty_refill),
                    )
                } else {
                    val visibleItems = state.items.filter {
                        it.bagCount > 0 || (it.secondsUntilNextRefill ?: 0L) > 0
                            || it.blockedBySlots || it.blockedByWeight
                    }
                    BagSectionLabel(
                        if (onSelectTrap != null) stringResource(R.string.bag_hint_select)
                        else stringResource(R.string.bag_section_traps)
                    )
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        visibleItems.forEach { item ->
                            TrapRow(
                                item = item,
                                selected = item.trapTypeId == selectedTrapTypeId,
                                onSelect = onSelectTrap,
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

    if (showWeightInfo) {
        AlertDialog(
            onDismissRequest = { showWeightInfo = false },
            containerColor = Radar.Surface,
            shape = RoundedCornerShape(20.dp),
            title = {
                Text(
                    stringResource(R.string.label_bag_weight_info_title),
                    color = Radar.Text,
                    fontFamily = RadarFonts.Body,
                    fontWeight = FontWeight.ExtraBold,
                    fontSize = 18.sp
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
                    Text(
                        stringResource(R.string.action_close).uppercase(),
                        color = Radar.Accent,
                        fontFamily = RadarFonts.Label,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 0.8.sp
                    )
                }
            }
        )
    }
}

@Composable
private fun BagSectionLabel(text: String) {
    Text(
        text.uppercase(),
        color = Radar.TextMuted,
        fontFamily = RadarFonts.Label,
        fontWeight = FontWeight.SemiBold,
        fontSize = 12.sp,
        letterSpacing = 1.6.sp,
        maxLines = 2,
        overflow = TextOverflow.Ellipsis,
        modifier = Modifier.padding(start = 4.dp, top = 18.dp, bottom = 8.dp)
    )
}

@Composable
private fun BagHeader(state: BagUiState, onInfoClick: () -> Unit) {
    val fillFraction = if (state.maxWeightKg > 0)
        (state.currentWeightKg / state.maxWeightKg).coerceIn(0f, 1f) else 0f
    val barColor = when {
        fillFraction > 0.9f -> Radar.Trap
        fillFraction > 0.7f -> Radar.Gold
        else -> Radar.Safe
    }
    val ready = state.items.sumOf { it.bagCount }

    Column {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(
                    stringResource(R.string.bag_title).uppercase(),
                    color = Radar.Text,
                    fontFamily = RadarFonts.Label,
                    fontWeight = FontWeight.Bold,
                    fontSize = 20.sp,
                    letterSpacing = 1.6.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    pluralStringResource(R.plurals.bag_traps_ready, ready, ready),
                    color = Radar.TextSec,
                    fontSize = 13.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
            IconButton(onClick = onInfoClick) {
                Icon(Icons.Outlined.Info, stringResource(R.string.bag_about_weight), tint = Radar.TextMuted)
            }
        }

        Spacer(Modifier.height(10.dp))

        // Weight gauge
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(16.dp))
                .background(Radar.Surface2)
                .border(1.dp, Radar.Line, RoundedCornerShape(16.dp))
                .clickable(onClick = onInfoClick)
                .padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                stringResource(R.string.bag_weight).uppercase(),
                color = Radar.TextMuted,
                fontFamily = RadarFonts.Label,
                fontWeight = FontWeight.SemiBold,
                fontSize = 12.sp,
                letterSpacing = 1.2.sp,
                maxLines = 1
            )
            Spacer(Modifier.width(12.dp))
            Box(
                modifier = Modifier
                    .weight(1f)
                    .height(8.dp)
                    .clip(RoundedCornerShape(4.dp))
                    .background(Radar.Bg)
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxHeight()
                        .fillMaxWidth(fillFraction)
                        .clip(RoundedCornerShape(4.dp))
                        .background(barColor)
                )
            }
            Spacer(Modifier.width(12.dp))
            Text(
                "${state.currentWeightKg.toInt()} / ${state.maxWeightKg.toInt()} kg",
                color = Radar.Text,
                fontFamily = RadarFonts.Mono,
                fontSize = 14.sp,
                maxLines = 1
            )
        }
    }
}

/** Shortcut to the time-deduction cards on the Awards screen. */
@Composable
private fun TimeCardsRow(cardCount: Int, onOpenAwards: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(Radar.Safe.copy(alpha = 0.10f))
            .border(1.dp, Radar.Safe.copy(alpha = 0.35f), RoundedCornerShape(14.dp))
            .clickable(onClick = onOpenAwards)
            .padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text("⏱️", fontSize = 16.sp)
        Spacer(Modifier.width(10.dp))
        Text(
            pluralStringResource(R.plurals.bag_cards_available, cardCount, cardCount),
            color = Radar.Safe,
            fontSize = 14.sp,
            fontWeight = FontWeight.SemiBold,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f)
        )
        Icon(Icons.Outlined.ChevronRight, contentDescription = null, tint = Radar.Safe)
    }
}

@Composable
private fun TrapRow(
    item: TrapInventoryItem,
    selected: Boolean,
    onSelect: ((TrapInventoryItem) -> Unit)?,
    onPlaceTrap: (TrapInventoryItem) -> Unit,
    showRefillAd: Boolean = false,
    onWatchRefillAd: ((trapTypeId: String) -> Unit)? = null,
) {
    val isEmpty = item.bagCount == 0
    val hasRefill = (item.secondsUntilNextRefill ?: 0L) > 0
    val isFull = item.bagCount >= item.maxBagSlots
    var showDescription by remember { mutableStateOf(false) }
    val shape = RoundedCornerShape(16.dp)

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(if (selected) Radar.Accent.copy(alpha = 0.08f) else Radar.Surface2)
            .border(
                BorderStroke(if (selected) 1.5.dp else 1.dp, if (selected) Radar.Accent else Radar.Line),
                shape
            )
            .clickable(enabled = onSelect != null && !isEmpty) { onSelect?.invoke(item) }
            .padding(12.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            // Icon badge — tap for trap details
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier
                    .size(56.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .background(if (isEmpty) Radar.Bg else Radar.Trap.copy(alpha = 0.14f))
                    .clickable(enabled = item.trapTypeId.isNotBlank()) { showDescription = true }
            ) {
                TrapImage(item = item, size = 38.dp, dimmed = isEmpty)
                if (item.trapTypeId.isNotBlank()) {
                    Box(
                        contentAlignment = Alignment.Center,
                        modifier = Modifier
                            .align(Alignment.TopEnd)
                            .padding(3.dp)
                            .size(16.dp)
                            .background(Radar.Bg.copy(alpha = 0.85f), CircleShape)
                    ) {
                        Icon(
                            Icons.Outlined.Info,
                            contentDescription = stringResource(R.string.bag_trap_details),
                            tint = Radar.Accent,
                            modifier = Modifier.size(12.dp)
                        )
                    }
                }
            }

            Spacer(Modifier.width(12.dp))

            Column(Modifier.weight(1f)) {
                Text(
                    item.name,
                    color = if (isEmpty) Radar.TextMuted else Radar.Text,
                    fontFamily = RadarFonts.Body,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 15.sp,
                    lineHeight = 18.sp,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
                // Own line so the chip never squeezes the trap name.
                if (selected) {
                    Spacer(Modifier.height(4.dp))
                    Text(
                        stringResource(R.string.bag_selected).uppercase(),
                        color = Radar.Accent,
                        fontFamily = RadarFonts.Label,
                        fontWeight = FontWeight.Bold,
                        fontSize = 10.sp,
                        letterSpacing = 0.8.sp,
                        maxLines = 1,
                        modifier = Modifier
                            .background(Radar.Accent.copy(alpha = 0.14f), RoundedCornerShape(6.dp))
                            .padding(horizontal = 6.dp, vertical = 2.dp)
                    )
                }

                Spacer(Modifier.height(2.dp))
                val (statusText, statusColor) = when {
                    item.blockedByWeight -> stringResource(R.string.label_blocked_weight) to Radar.Trap
                    item.blockedBySlots -> stringResource(R.string.label_blocked_slots) to Radar.Gold
                    hasRefill && !isFull ->
                        "⏳ " + stringResource(R.string.bag_refill_in, formatCountdown(item.secondsUntilNextRefill!!)) to Radar.Gold
                    isFull -> stringResource(R.string.bag_status_full) to Radar.Safe
                    item.effectKind.isNotBlank() && item.effectKind != "none" ->
                        effectKindName(item.effectKind) to Radar.TextMuted
                    else -> "" to Radar.TextMuted
                }
                if (statusText.isNotEmpty()) {
                    Text(
                        statusText,
                        color = statusColor,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Medium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }

                Spacer(Modifier.height(6.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    val countColor = when {
                        isEmpty -> Radar.TextMuted
                        isFull -> Radar.Safe
                        else -> Radar.Accent
                    }
                    BagChip("${item.bagCount}/${item.maxBagSlots}", countColor)
                    BagChip("${item.weight.toInt()} kg", Radar.TextMuted)
                }
            }

            Spacer(Modifier.width(10.dp))

            // PLACE
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier
                    .widthIn(min = 88.dp)
                    .height(48.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .background(if (isEmpty) Radar.Bg else Radar.Trap)
                    .clickable(enabled = !isEmpty) { onPlaceTrap(item) }
                    .padding(horizontal = 12.dp)
            ) {
                Text(
                    stringResource(R.string.action_place_trap),
                    color = if (isEmpty) Radar.TextMuted else Color.White,
                    fontFamily = RadarFonts.Label,
                    fontWeight = FontWeight.Bold,
                    fontSize = 15.sp,
                    letterSpacing = 1.sp,
                    maxLines = 1
                )
            }
        }

        // Speed up refill with a rewarded ad
        if (hasRefill && !isFull && showRefillAd && onWatchRefillAd != null) {
            Spacer(Modifier.height(10.dp))
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .background(Radar.Gold.copy(alpha = 0.12f))
                    .border(1.dp, Radar.Gold.copy(alpha = 0.45f), RoundedCornerShape(14.dp))
                    .clickable { onWatchRefillAd(item.trapTypeId) },
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("📺", fontSize = 15.sp)
                Spacer(Modifier.width(8.dp))
                Text(
                    stringResource(R.string.bag_speed_up).uppercase(),
                    color = Radar.Gold,
                    fontFamily = RadarFonts.Label,
                    fontWeight = FontWeight.Bold,
                    fontSize = 14.sp,
                    letterSpacing = 1.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }
    }

    if (showDescription) {
        TrapDescriptionDialog(item = item, onDismiss = { showDescription = false })
    }
}

@Composable
private fun BagChip(text: String, color: Color) {
    Text(
        text,
        color = color,
        fontFamily = RadarFonts.Mono,
        fontSize = 12.sp,
        maxLines = 1,
        modifier = Modifier
            .background(Radar.Bg, RoundedCornerShape(8.dp))
            .border(1.dp, Radar.Line, RoundedCornerShape(8.dp))
            .padding(horizontal = 8.dp, vertical = 3.dp)
    )
}

@Composable
fun TrapDescriptionDialog(item: TrapInventoryItem, onDismiss: () -> Unit) {
    Dialog(onDismissRequest = onDismiss) {
        Surface(
            shape = RoundedCornerShape(20.dp),
            color = Radar.Surface,
            border = BorderStroke(1.dp, Radar.Line),
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(
                modifier = Modifier.padding(20.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Box(
                    contentAlignment = Alignment.Center,
                    modifier = Modifier
                        .size(104.dp)
                        .background(Radar.Trap.copy(alpha = 0.14f), CircleShape)
                        .border(1.dp, Radar.Trap.copy(alpha = 0.35f), CircleShape)
                ) {
                    TrapImage(item = item, size = 72.dp, dimmed = false)
                }

                Spacer(Modifier.height(14.dp))

                Text(
                    text = item.name,
                    color = Radar.Text,
                    fontFamily = RadarFonts.Body,
                    fontSize = 20.sp,
                    fontWeight = FontWeight.ExtraBold,
                    textAlign = TextAlign.Center
                )

                if (item.effectKind.isNotBlank() && item.effectKind != "none") {
                    Spacer(Modifier.height(8.dp))
                    Text(
                        text = effectKindName(item.effectKind).uppercase(),
                        color = Radar.Accent,
                        fontFamily = RadarFonts.Label,
                        fontWeight = FontWeight.Bold,
                        fontSize = 12.sp,
                        letterSpacing = 1.sp,
                        modifier = Modifier
                            .background(Radar.Accent.copy(alpha = 0.14f), RoundedCornerShape(8.dp))
                            .padding(horizontal = 10.dp, vertical = 4.dp)
                    )
                }

                if (item.description.isNotBlank()) {
                    Spacer(Modifier.height(12.dp))
                    Text(
                        text = item.description,
                        color = Radar.TextSec,
                        fontSize = 14.sp,
                        lineHeight = 20.sp,
                        textAlign = TextAlign.Center
                    )
                }

                Spacer(Modifier.height(16.dp))

                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    TrapStatTile(stringResource(R.string.bag_weight), "${item.weight.toInt()} kg", Modifier.weight(1f))
                    TrapStatTile(stringResource(R.string.bag_in_bag), "${item.bagCount}/${item.maxBagSlots}", Modifier.weight(1f))
                    if ((item.secondsUntilNextRefill ?: 0L) > 0) {
                        TrapStatTile(
                            stringResource(R.string.bag_refill),
                            formatCountdown(item.secondsUntilNextRefill!!),
                            Modifier.weight(1f),
                            valueColor = Radar.Gold
                        )
                    }
                }

                Spacer(Modifier.height(18.dp))

                RadarPrimaryButton(
                    stringResource(R.string.action_close),
                    onDismiss,
                    modifier = Modifier.fillMaxWidth()
                )
            }
        }
    }
}

@Composable
private fun TrapStatTile(label: String, value: String, modifier: Modifier, valueColor: Color = Radar.Text) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = modifier
            .clip(RoundedCornerShape(12.dp))
            .background(Radar.Surface2)
            .border(1.dp, Radar.Line, RoundedCornerShape(12.dp))
            .padding(vertical = 10.dp, horizontal = 6.dp)
    ) {
        Text(
            label.uppercase(),
            color = Radar.TextMuted,
            fontFamily = RadarFonts.Label,
            fontWeight = FontWeight.SemiBold,
            fontSize = 11.sp,
            letterSpacing = 1.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
        Spacer(Modifier.height(2.dp))
        Text(value, color = valueColor, fontFamily = RadarFonts.Mono, fontSize = 15.sp, maxLines = 1)
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
