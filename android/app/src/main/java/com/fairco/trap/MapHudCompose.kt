package com.fairco.trap

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Backpack
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Group
import androidx.compose.material.icons.outlined.KeyboardArrowUp
import androidx.compose.material.icons.outlined.Leaderboard
import androidx.compose.material.icons.outlined.Map
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.fairco.trap.ui.theme.Radar
import com.fairco.trap.ui.theme.RadarFonts

/**
 * Map-screen HUD state. GameActivity writes these from its listeners
 * (user doc, GPS, trap snapshots); the Compose HUD reads them.
 */
class MapHudState {
    var level by mutableIntStateOf(1)
    var levelProgress by mutableFloatStateOf(0f)
    var points by mutableIntStateOf(0)
    /** Non-null for a moment after an XP gain — shown in the level pill. */
    var xpFlash by mutableStateOf<Int?>(null)
    /** Other players' active traps within 100 m. */
    var nearbyCount by mutableIntStateOf(0)
    var gpsAccuracyM by mutableStateOf<Int?>(null)
    var selectedTrapTypeId by mutableStateOf<String?>(null)
    var navInsetPx by mutableIntStateOf(0)
    var pickerOpen by mutableStateOf(false)
    /** Context line for the hold-to-arm sheet (nearest trap etc.). */
    var placementInfo by mutableStateOf<String?>(null)

    // Player card + sheets hosted in the bottom dock
    var displayName by mutableStateOf("")
    var username by mutableStateOf<String?>(null)
    var photoUrl by mutableStateOf<String?>(null)
    var membershipLabel by mutableStateOf<String?>(null)
    var membershipPaid by mutableStateOf(false)
    var meOpen by mutableStateOf(false)
    var layersOpen by mutableStateOf(false)
    var settingsOpen by mutableStateOf(false)
}

enum class MapTab { MAP, BAG, RANK, SOCIAL, ME }

/** The trap the dock shows: the player's pick if still in the bag, else the first one available. */
fun resolveSelectedTrap(items: List<TrapInventoryItem>, selectedId: String?): TrapInventoryItem? =
    items.firstOrNull { it.trapTypeId == selectedId && it.bagCount > 0 }
        ?: items.firstOrNull { it.bagCount > 0 }
        ?: items.firstOrNull { it.trapTypeId == selectedId }
        ?: items.firstOrNull()

// ── Top HUD ──────────────────────────────────────────────────────────────────

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun MapTopHud(
    hud: MapHudState,
    unreadCount: Int,
    onLevelClick: () -> Unit,
    onLevelLongClick: () -> Unit,
    onNearbyClick: () -> Unit,
    onBellClick: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            // Level ring + points
            HudPill(
                modifier = Modifier.combinedClickable(onClick = onLevelClick, onLongClick = onLevelLongClick)
            ) {
                LevelRing(level = hud.level, progress = hud.levelProgress)
                Spacer(Modifier.width(10.dp))
                val flash = hud.xpFlash
                if (flash != null) {
                    Text(
                        "+$flash XP",
                        color = Radar.Safe,
                        fontFamily = RadarFonts.Mono,
                        fontSize = 17.sp
                    )
                } else {
                    Text(
                        "%,d".format(hud.points).replace(',', ' '),
                        color = Radar.Text,
                        fontFamily = RadarFonts.Mono,
                        fontSize = 17.sp
                    )
                    Spacer(Modifier.width(4.dp))
                    Text(
                        stringResource(R.string.mh_pts),
                        color = Radar.TextMuted,
                        fontFamily = RadarFonts.Label,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 11.sp,
                        letterSpacing = 1.sp
                    )
                }
                Spacer(Modifier.width(6.dp))
            }

            Spacer(Modifier.weight(1f))

            // Inbox bell — round button; the count is a corner badge so the bell never moves.
            Box(Modifier.size(48.dp)) {
                Box(
                    contentAlignment = Alignment.Center,
                    modifier = Modifier
                        .align(Alignment.Center)
                        .size(44.dp)
                        .clip(CircleShape)
                        .background(Radar.Bg.copy(alpha = 0.88f))
                        .border(1.dp, Radar.Line, CircleShape)
                        .clickable(onClick = onBellClick)
                ) {
                    Icon(
                        Icons.Outlined.Notifications,
                        contentDescription = stringResource(R.string.mh_inbox),
                        tint = if (unreadCount > 0) Radar.Gold else Radar.TextSec,
                        modifier = Modifier.size(22.dp)
                    )
                }
                if (unreadCount > 0) {
                    Box(
                        contentAlignment = Alignment.Center,
                        modifier = Modifier
                            .align(Alignment.TopEnd)
                            .height(18.dp)
                            .widthIn(min = 18.dp)
                            .clip(RoundedCornerShape(9.dp))
                            .background(Radar.Trap)
                            .border(1.5.dp, Radar.Bg, RoundedCornerShape(9.dp))
                            .padding(horizontal = 4.dp)
                    ) {
                        Text(
                            if (unreadCount > 99) "99+" else unreadCount.toString(),
                            color = Color.White,
                            fontFamily = RadarFonts.Label,
                            fontWeight = FontWeight.Bold,
                            fontSize = 10.sp,
                            lineHeight = 10.sp,
                            maxLines = 1
                        )
                    }
                }
            }
        }

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            val near = hud.nearbyCount
            HudChip(
                color = if (near > 0) Radar.Trap else Radar.TextMuted,
                text = if (near > 0) stringResource(R.string.mh_near_count, near) else stringResource(R.string.mh_near_none),
                modifier = Modifier.clickable(onClick = onNearbyClick)
            )
            val acc = hud.gpsAccuracyM
            HudChip(
                color = when {
                    acc == null -> Radar.TextMuted
                    acc <= 20 -> Radar.Safe
                    acc <= 50 -> Radar.Gold
                    else -> Radar.Trap
                },
                text = if (acc == null) stringResource(R.string.mh_gps_wait) else stringResource(R.string.mh_gps_acc, acc)
            )
        }
    }
}

@Composable
private fun HudPill(modifier: Modifier = Modifier, content: @Composable RowScope.() -> Unit) {
    Row(
        modifier = Modifier
            .height(44.dp)
            .clip(RoundedCornerShape(22.dp))
            .background(Radar.Bg.copy(alpha = 0.88f))
            .border(1.dp, Radar.Line, RoundedCornerShape(22.dp))
            .then(modifier)
            .padding(start = 4.dp, end = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        content = content
    )
}

@Composable
private fun HudChip(color: Color, text: String, modifier: Modifier = Modifier) {
    Text(
        text,
        color = color,
        fontFamily = RadarFonts.Label,
        fontWeight = FontWeight.SemiBold,
        fontSize = 12.sp,
        letterSpacing = 1.sp,
        modifier = Modifier
            .clip(RoundedCornerShape(14.dp))
            .background(Radar.Bg.copy(alpha = 0.82f))
            .border(1.dp, color.copy(alpha = 0.45f), RoundedCornerShape(14.dp))
            .then(modifier)
            .padding(horizontal = 10.dp, vertical = 5.dp)
    )
}

@Composable
private fun LevelRing(level: Int, progress: Float) {
    Box(
        contentAlignment = Alignment.Center,
        modifier = Modifier
            .size(36.dp)
            .drawBehind {
                val stroke = 3.dp.toPx()
                val inset = stroke / 2
                val arcSize = Size(size.width - stroke, size.height - stroke)
                drawArc(Radar.Line, 0f, 360f, false, Offset(inset, inset), arcSize, style = Stroke(stroke))
                drawArc(
                    Radar.Accent, -90f, 360f * progress.coerceIn(0f, 1f), false,
                    Offset(inset, inset), arcSize, style = Stroke(stroke, cap = StrokeCap.Round)
                )
            }
    ) {
        Text(
            "LV$level",
            color = Radar.Accent,
            fontFamily = RadarFonts.Label,
            fontWeight = FontWeight.Bold,
            fontSize = 11.sp
        )
    }
}

// ── Bottom dock: one solid panel — trap selector + PLACE + tab bar ──────────

@Composable
fun MapBottomDock(
    hud: MapHudState,
    items: List<TrapInventoryItem>,
    loading: Boolean,
    targetSet: Boolean,
    navInset: Dp,
    onOpenPicker: () -> Unit,
    onPlace: (TrapInventoryItem) -> Unit,
    onCancelTarget: () -> Unit,
    onTab: (MapTab) -> Unit,
) {
    val selected = resolveSelectedTrap(items, hud.selectedTrapTypeId)
    val shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp)
    Column(
        Modifier
            .fillMaxWidth()
            .shadow(16.dp, shape)
            .clip(shape)
            .background(Radar.Surface)
            .border(1.dp, Radar.Line, shape)
    ) {
        if (targetSet) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Radar.Accent.copy(alpha = 0.12f))
                    .clickable(onClick = onCancelTarget)
                    .padding(start = 16.dp, end = 12.dp, top = 10.dp, bottom = 10.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    stringResource(R.string.mh_target_set),
                    color = Radar.Accent,
                    fontFamily = RadarFonts.Body,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 13.sp,
                    modifier = Modifier.weight(1f)
                )
                Icon(
                    Icons.Outlined.Close,
                    contentDescription = stringResource(R.string.mh_clear_target),
                    tint = Radar.TextSec,
                    modifier = Modifier.size(18.dp)
                )
            }
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 12.dp, end = 12.dp, top = 12.dp, bottom = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Trap selector
            Row(
                modifier = Modifier
                    .weight(1f)
                    .height(56.dp)
                    .clip(RoundedCornerShape(16.dp))
                    .background(Radar.Surface2)
                    .clickable(onClick = onOpenPicker)
                    .padding(start = 6.dp, end = 4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(
                    contentAlignment = Alignment.Center,
                    modifier = Modifier
                        .size(44.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(Radar.Trap.copy(alpha = 0.16f))
                ) {
                    when {
                        selected != null -> TrapImage(item = selected, size = 34.dp, dimmed = selected.bagCount == 0)
                        loading -> CircularProgressIndicator(
                            color = Radar.Accent,
                            strokeWidth = 2.dp,
                            modifier = Modifier.size(20.dp)
                        )
                        else -> Text("▲", color = Radar.Trap, fontSize = 20.sp)
                    }
                }
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        when {
                            selected != null -> selected.name
                            loading -> stringResource(R.string.mh_loading_bag)
                            else -> stringResource(R.string.mh_bag_empty)
                        },
                        color = Radar.Text,
                        fontFamily = RadarFonts.Body,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 15.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    Text(
                        if (selected != null) stringResource(R.string.mh_left_switch, selected.bagCount)
                        else stringResource(R.string.mh_open_bag),
                        color = if (selected != null && selected.bagCount == 0) Radar.TrapSoft else Radar.TextMuted,
                        fontFamily = RadarFonts.Body,
                        fontSize = 12.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
                Icon(Icons.Outlined.KeyboardArrowUp, contentDescription = null, tint = Radar.TextMuted)
            }

            // PLACE
            val canPlace = selected != null && selected.bagCount > 0
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier
                    .width(112.dp)
                    .height(56.dp)
                    .clip(RoundedCornerShape(16.dp))
                    .background(if (canPlace) Radar.Trap else Radar.Surface2)
                    .clickable(enabled = selected != null) {
                        if (canPlace) onPlace(selected!!) else onOpenPicker()
                    }
            ) {
                Text(
                    stringResource(R.string.mh_place),
                    color = if (canPlace) Color.White else Radar.TextMuted,
                    fontFamily = RadarFonts.Label,
                    fontWeight = FontWeight.Bold,
                    fontSize = 16.sp,
                    letterSpacing = 1.sp,
                    maxLines = 1
                )
            }
        }

        MapTabBar(active = MapTab.MAP, navInset = navInset, onTab = onTab)
    }
}

@Composable
private fun MapTabBar(active: MapTab, navInset: Dp, onTab: (MapTab) -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .drawBehind { drawLine(Radar.Line, Offset(0f, 0f), Offset(size.width, 0f), 1.dp.toPx()) }
            .padding(bottom = navInset)
            .height(58.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        val tabs = listOf(
            Triple(MapTab.MAP, Icons.Outlined.Map, R.string.mh_tab_map),
            Triple(MapTab.BAG, Icons.Outlined.Backpack, R.string.mh_tab_bag),
            Triple(MapTab.RANK, Icons.Outlined.Leaderboard, R.string.mh_tab_rank),
            Triple(MapTab.SOCIAL, Icons.Outlined.Group, R.string.mh_tab_social),
            Triple(MapTab.ME, Icons.Outlined.Person, R.string.mh_tab_me),
        )
        tabs.forEach { (tab, icon, label) ->
            TabItem(icon, stringResource(label), tab == active, Modifier.weight(1f)) { onTab(tab) }
        }
    }
}

@Composable
private fun TabItem(icon: ImageVector, label: String, active: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val color = if (active) Radar.Accent else Radar.TextMuted
    Column(
        modifier = modifier
            .fillMaxHeight()
            .clickable(onClick = onClick),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier
                .size(width = 48.dp, height = 28.dp)
                .clip(RoundedCornerShape(14.dp))
                .background(if (active) Radar.Accent.copy(alpha = 0.14f) else Color.Transparent)
        ) {
            Icon(icon, contentDescription = label, tint = color, modifier = Modifier.size(22.dp))
        }
        Spacer(Modifier.height(2.dp))
        Text(
            label.uppercase(),
            color = color,
            fontFamily = RadarFonts.Label,
            fontWeight = FontWeight.SemiBold,
            fontSize = 11.sp,
            letterSpacing = 0.5.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
    }
}

// ── Trap picker sheet ────────────────────────────────────────────────────────

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TrapPickerSheet(
    viewModel: GameViewModel,
    onDismiss: () -> Unit,
    onPlaceTrap: (TrapInventoryItem) -> Unit,
    onWatchRefillAd: (String) -> Unit,
    onOpenAwards: () -> Unit,
) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = Radar.Surface,
        shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
    ) {
        Column(Modifier.padding(bottom = 16.dp)) {
            Text(
                stringResource(R.string.mh_your_bag),
                color = Radar.TextMuted,
                fontFamily = RadarFonts.Label,
                fontWeight = FontWeight.SemiBold,
                fontSize = 13.sp,
                letterSpacing = 2.sp,
                modifier = Modifier.padding(horizontal = 20.dp)
            )
            Spacer(Modifier.height(4.dp))
            TrapBagCard(
                viewModel = viewModel,
                peekMode = false,
                onPlaceTrap = onPlaceTrap,
                onWatchRefillAd = onWatchRefillAd,
                onOpenAwards = onOpenAwards,
            )
        }
    }
}
