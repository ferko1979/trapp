package com.fairco.trap

import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.animation.*
import com.fairco.trap.ui.theme.Radar
import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.material3.TabRowDefaults.tabIndicatorOffset
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import java.text.SimpleDateFormat
import java.util.*
import kotlin.random.Random
import kotlinx.coroutines.delay

private val BG           = Radar.Bg
private val SURFACE      = Radar.Surface
private val SURFACE2     = Radar.Surface2
private val SURFACE3     = Radar.Bg
private val ACCENT_BLUE  = Radar.Accent
private val ACCENT_GREEN = Radar.Safe
private val MUTED        = Radar.TextMuted
private val TEXT         = Radar.Text
private val TEXT_SEC     = Radar.TextSec
private val AMBER        = Radar.Gold
private val CARD_GREEN1  = Color(0xFF064E3B)
private val CARD_GREEN2  = Color(0xFF065F46)
private val CARD_ICE1    = Color(0xFF0C2D48)
private val CARD_ICE2    = Color(0xFF0E3A5C)
private val ACCENT_ICE   = Radar.Accent
private val CARD_USED    = Radar.Bg

// Confetti colours
private val CONFETTI_COLORS = listOf(
    Radar.Gold, Radar.Safe, Radar.Accent,
    Color(0xFFEC4899), Color(0xFFA855F7), Color(0xFFF97316),
)

// ── Default card-type copies (used before backend loads) ──────────────────────

@Composable
private fun defaultTimeCard() = CardTypeContent(
    id           = "card_time_deduction_5min",
    emoji        = "⏱️",
    valueDisplay = "−5",
    name         = stringResource(R.string.award_time_card_name),
    unitLabel    = stringResource(R.string.award_unit_min),
    heroTitle    = stringResource(R.string.award_time_card_title),
    heroSubtitle = stringResource(R.string.award_time_card_subtitle),
    tipText      = stringResource(R.string.award_time_card_tip),
    readyLabel   = stringResource(R.string.award_label_ready),
    usedLabel    = stringResource(R.string.award_label_used),
)

@Composable
private fun defaultFreezeCard() = CardTypeContent(
    id           = "card_streak_freeze",
    emoji        = "🧊",
    valueDisplay = "1",
    name         = stringResource(R.string.award_freeze_card_name),
    unitLabel    = stringResource(R.string.award_unit_day),
    heroTitle    = stringResource(R.string.award_freeze_card_title),
    heroSubtitle = stringResource(R.string.award_freeze_card_subtitle),
    tipText      = stringResource(R.string.award_freeze_card_tip),
    readyLabel   = stringResource(R.string.award_label_ready),
    usedLabel    = stringResource(R.string.award_label_used),
)

private fun isFreeze(ct: CardTypeContent) = ct.id == "card_streak_freeze"

// ── Confetti ──────────────────────────────────────────────────────────────────

private data class ConfettiParticle(
    val x: Float, val y: Float,        // start position (0..1 fraction of screen)
    val vx: Float, val vy: Float,      // horizontal drift, fall speed (fractions/s)
    val rot: Float, val rotV: Float,   // initial rotation, rotation speed (deg/s)
    val color: Color,
    val w: Float, val h: Float,        // size in px
    val isRect: Boolean,
)

@Composable
private fun ConfettiBurst(modifier: Modifier = Modifier) {
    val particles = remember {
        List(55) {
            ConfettiParticle(
                x      = Random.nextFloat(),
                y      = Random.nextFloat() * 0.15f - 0.05f,
                vx     = (Random.nextFloat() - 0.5f) * 0.35f,
                vy     = Random.nextFloat() * 0.55f + 0.35f,
                rot    = Random.nextFloat() * 360f,
                rotV   = (Random.nextFloat() - 0.5f) * 540f,
                color  = CONFETTI_COLORS[Random.nextInt(CONFETTI_COLORS.size)],
                w      = Random.nextFloat() * 10f + 6f,
                h      = Random.nextFloat() * 14f + 8f,
                isRect = Random.nextBoolean(),
            )
        }
    }

    val progress = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        progress.animateTo(1f, tween(2800, easing = LinearEasing))
    }

    val t = progress.value
    if (t >= 1f) return

    Canvas(modifier = modifier.fillMaxSize()) {
        val W = size.width; val H = size.height
        particles.forEach { p ->
            val px = (p.x + p.vx * t) * W
            val py = (p.y + p.vy * t + 0.4f * t * t) * H   // mild gravity
            val alpha = (1f - (t * 1.5f).coerceAtMost(1f)).coerceAtLeast(0f)
            val angle = p.rot + p.rotV * t

            withTransform({ rotate(angle, Offset(px, py)) }) {
                if (p.isRect) {
                    drawRect(
                        color = p.color.copy(alpha = alpha),
                        topLeft = Offset(px - p.w / 2f, py - p.h / 2f),
                        size = Size(p.w, p.h),
                    )
                } else {
                    drawCircle(
                        color = p.color.copy(alpha = alpha),
                        radius = p.w / 2f,
                        center = Offset(px, py),
                    )
                }
            }
        }
    }
}

// ── Main screen ───────────────────────────────────────────────────────────────

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AwardsScreen(viewModel: AwardsViewModel, onBack: () -> Unit) {
    val state by viewModel.state.collectAsState()
    var tabIndex by remember { mutableIntStateOf(0) }
    val tabs = listOf("🃏  " + stringResource(R.string.award_tab_cards), "🔥  " + stringResource(R.string.award_tab_streak))
    val haptic = LocalHapticFeedback.current

    // Confetti: trigger once when streak matches any milestone day
    val isMilestoneDay = state.milestones.any { it.day == state.loginStreak }
    var showConfetti by remember { mutableStateOf(false) }
    var confettiDone by remember { mutableStateOf(false) }
    LaunchedEffect(state.loginStreak, state.loading) {
        if (!state.loading && !confettiDone && isMilestoneDay && state.loginStreak > 0) {
            confettiDone = true
            haptic.performHapticFeedback(HapticFeedbackType.LongPress)
            showConfetti = true
            delay(3000)
            showConfetti = false
        }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        Scaffold(
            topBar = {
                TopAppBar(
                    title = {
                        Column {
                            Text(stringResource(R.string.award_screen_title), color = TEXT, fontWeight = FontWeight.Bold, fontSize = 17.sp)
                            Text(stringResource(R.string.award_screen_subtitle), color = TEXT_SEC, fontSize = 11.sp)
                        }
                    },
                    navigationIcon = {
                        IconButton(onClick = onBack) {
                            Icon(Icons.Filled.ArrowBack, contentDescription = stringResource(R.string.action_back), tint = TEXT)
                        }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(containerColor = SURFACE)
                )
            },
            containerColor = BG
        ) { padding ->
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
            ) {
                TabRow(
                    selectedTabIndex = tabIndex,
                    containerColor = SURFACE,
                    contentColor = TEXT,
                    indicator = { tabPositions ->
                        Box(
                            Modifier
                                .tabIndicatorOffset(tabPositions[tabIndex])
                                .height(2.dp)
                                .background(ACCENT_BLUE, RoundedCornerShape(topStart = 2.dp, topEnd = 2.dp))
                        )
                    }
                ) {
                    tabs.forEachIndexed { i, label ->
                        Tab(
                            selected = tabIndex == i,
                            onClick = {
                                haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                                tabIndex = i
                            },
                            text = {
                                Text(
                                    label,
                                    fontSize = 13.sp,
                                    fontWeight = if (tabIndex == i) FontWeight.Bold else FontWeight.Normal,
                                    color = if (tabIndex == i) ACCENT_BLUE else TEXT_SEC
                                )
                            }
                        )
                    }
                }

                when {
                    state.loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(color = ACCENT_BLUE, modifier = Modifier.size(36.dp))
                    }
                    state.error != null -> Box(
                        Modifier.fillMaxSize().padding(32.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Text("⚠️ " + (state.error ?: "").ifBlank { stringResource(R.string.error_generic_retry) }, color = Radar.TrapSoft, textAlign = TextAlign.Center)
                    }
                    tabIndex == 0 -> CardsTab(state)
                    else          -> StreakTab(state)
                }
            }
        }

        // Confetti overlay
        if (showConfetti) {
            ConfettiBurst(modifier = Modifier.fillMaxSize())
        }
    }
}

// ── Cards tab ─────────────────────────────────────────────────────────────────

@Composable
private fun CardsTab(state: AwardsUiState) {
    // Resolve card types from backend or fall back to defaults; known types keep the
    // localized copy (backend text is English-only), unknown types use backend text.
    val defaultCards = listOf(defaultTimeCard(), defaultFreezeCard())
    val localById = defaultCards.associateBy { it.id }
    val cardTypes = state.cardTypes
        .map { ct -> localById[ct.id]?.copy(emoji = ct.emoji, valueDisplay = ct.valueDisplay) ?: ct }
        .ifEmpty { defaultCards }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(14.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp)
    ) {
        itemsIndexed(cardTypes) { typeIndex, ct ->
            CardTypeSection(ct = ct, state = state, sectionIndex = typeIndex)
        }

        // Show empty state only when every type has zero cards
        val totalUnused = cardTypes.sumOf { ct -> state.unusedCards.count { it.type == ct.id } }
        if (totalUnused == 0 && state.usedCards.isEmpty()) {
            item {
                EmptyState(
                    icon = "🃏",
                    title = stringResource(R.string.award_no_cards_title),
                    subtitle = stringResource(R.string.award_no_cards_subtitle)
                )
            }
        }
    }
}

@Composable
private fun CardTypeSection(ct: CardTypeContent, state: AwardsUiState, sectionIndex: Int) {
    val freeze  = isFreeze(ct)
    val accent  = if (freeze) ACCENT_ICE else ACCENT_GREEN
    val heroGrad = if (freeze)
        Brush.horizontalGradient(listOf(Radar.Surface, Radar.Bg))
    else
        Brush.horizontalGradient(listOf(Color(0xFF052E16), Radar.Bg))

    val unused = state.unusedCards.filter { it.type == ct.id }
    val used   = state.usedCards.filter   { it.type == ct.id }
    val total  = unused.size + used.size

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        // Hero banner
        var bannerVisible by remember { mutableStateOf(false) }
        LaunchedEffect(Unit) { delay(sectionIndex * 120L); bannerVisible = true }
        AnimatedVisibility(
            visible = bannerVisible,
            enter = fadeIn(tween(400)) + slideInVertically(tween(400)) { -it / 2 }
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(heroGrad, RoundedCornerShape(14.dp))
                    .border(1.dp, accent.copy(alpha = 0.28f), RoundedCornerShape(14.dp))
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(ct.heroTitle, color = TEXT, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                    Spacer(Modifier.height(2.dp))
                    Text(ct.heroSubtitle, color = TEXT_SEC, fontSize = 11.sp)
                    if (total > 0) {
                        Spacer(Modifier.height(6.dp))
                        Text(
                            stringResource(R.string.award_available_total, unused.size, total),
                            color = if (unused.isNotEmpty()) accent else MUTED,
                            fontSize = 11.sp, fontWeight = FontWeight.SemiBold
                        )
                    }
                    // Freeze-specific hint
                    if (freeze && unused.isNotEmpty()) {
                        Spacer(Modifier.height(4.dp))
                        Text(stringResource(R.string.award_freeze_hint), color = ACCENT_ICE.copy(alpha = 0.7f), fontSize = 10.sp)
                    }
                }
                Spacer(Modifier.width(12.dp))

                // Count badge with pulse ring
                var badgeVisible by remember { mutableStateOf(false) }
                LaunchedEffect(Unit) { delay(250L + sectionIndex * 120L); badgeVisible = true }
                val badgeScale by animateFloatAsState(
                    targetValue = if (badgeVisible) 1f else 0f,
                    animationSpec = spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessMedium),
                    label = "badge_scale"
                )
                val ringTransition = rememberInfiniteTransition(label = "ring")
                val ringAlpha by ringTransition.animateFloat(
                    initialValue = 0.65f, targetValue = 0f,
                    animationSpec = infiniteRepeatable(tween(1100, easing = FastOutSlowInEasing), RepeatMode.Restart),
                    label = "ring_alpha"
                )
                val ringScale by ringTransition.animateFloat(
                    initialValue = 1f, targetValue = 1.6f,
                    animationSpec = infiniteRepeatable(tween(1100, easing = FastOutSlowInEasing), RepeatMode.Restart),
                    label = "ring_scale"
                )

                Box(contentAlignment = Alignment.Center) {
                    if (unused.isNotEmpty() && badgeVisible) {
                        Box(
                            modifier = Modifier
                                .size(52.dp)
                                .scale(ringScale)
                                .background(Color.Transparent, CircleShape)
                                .border(2.dp, accent.copy(alpha = ringAlpha), CircleShape)
                        )
                    }
                    Box(
                        modifier = Modifier
                            .size(52.dp)
                            .scale(badgeScale)
                            .background(
                                if (unused.isNotEmpty()) accent.copy(alpha = 0.18f) else MUTED.copy(alpha = 0.12f),
                                CircleShape
                            )
                            .border(
                                1.5.dp,
                                if (unused.isNotEmpty()) accent.copy(alpha = 0.5f) else MUTED.copy(alpha = 0.25f),
                                CircleShape
                            ),
                        contentAlignment = Alignment.Center
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(
                                "${unused.size}",
                                color = if (unused.isNotEmpty()) accent else MUTED,
                                fontSize = 20.sp, fontWeight = FontWeight.ExtraBold, lineHeight = 20.sp
                            )
                            Text(
                                stringResource(R.string.award_left),
                                color = if (unused.isNotEmpty()) accent.copy(alpha = 0.7f) else MUTED,
                                fontSize = 9.sp
                            )
                        }
                    }
                }
            }
        }

        // Available grid
        if (unused.isNotEmpty()) {
            SectionLabel(stringResource(R.string.award_section_available) + "  ·  ${unused.size}")
            val cols = 4
            val rows = (unused.size + cols - 1) / cols
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                for (row in 0 until rows) {
                    var rowVisible by remember { mutableStateOf(false) }
                    LaunchedEffect(Unit) { delay(row * 80L + 150L); rowVisible = true }
                    AnimatedVisibility(
                        visible = rowVisible,
                        enter = fadeIn(tween(350)) + slideInHorizontally(tween(350)) { -it / 4 }
                    ) {
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            for (col in 0 until cols) {
                                val idx = row * cols + col
                                if (idx < unused.size) {
                                    CardChip(modifier = Modifier.weight(1f), ct = ct, used = false)
                                } else {
                                    Spacer(Modifier.weight(1f))
                                }
                            }
                        }
                    }
                }
            }

            // Tip row
            var tipVisible by remember { mutableStateOf(false) }
            LaunchedEffect(Unit) { delay(400); tipVisible = true }
            AnimatedVisibility(visible = tipVisible, enter = fadeIn(tween(500))) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(Radar.Bg, RoundedCornerShape(8.dp))
                        .padding(horizontal = 12.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Text(if (freeze) "❄️" else "💡", fontSize = 14.sp)
                    Text(ct.tipText, color = MUTED, fontSize = 11.sp, lineHeight = 15.sp)
                }
            }
        }

        // Used history
        if (used.isNotEmpty()) {
            SectionLabel("${ct.usedLabel}  ·  ${used.size}")
            used.forEachIndexed { index, card ->
                var rowVisible by remember { mutableStateOf(false) }
                LaunchedEffect(Unit) { delay(index * 50L); rowVisible = true }
                AnimatedVisibility(
                    visible = rowVisible,
                    enter = fadeIn(tween(300)) + slideInVertically(tween(300)) { it / 3 }
                ) {
                    UsedCardRow(card, ct)
                }
            }
        }
    }
}

@Composable
private fun CardChip(modifier: Modifier = Modifier, ct: CardTypeContent, used: Boolean = false) {
    val freeze = isFreeze(ct)
    val accent = if (freeze) ACCENT_ICE else ACCENT_GREEN
    val grad   = if (!used) {
        if (freeze) Brush.verticalGradient(listOf(CARD_ICE1, CARD_ICE2))
        else        Brush.verticalGradient(listOf(CARD_GREEN1, CARD_GREEN2))
    } else null

    val infiniteTransition = rememberInfiniteTransition(label = "card_pulse")
    val pulse by infiniteTransition.animateFloat(
        initialValue = 1f, targetValue = 1.04f,
        animationSpec = infiniteRepeatable(tween(1800, easing = FastOutSlowInEasing), RepeatMode.Reverse),
        label = "pulse"
    )

    Box(
        modifier = modifier
            .aspectRatio(0.72f)
            .scale(if (!used) pulse else 1f)
            .clip(RoundedCornerShape(10.dp))
            .then(if (grad != null) Modifier.background(grad) else Modifier.background(CARD_USED))
            .border(
                1.dp,
                if (!used) accent.copy(alpha = 0.45f) else MUTED.copy(alpha = 0.15f),
                RoundedCornerShape(10.dp)
            )
            .padding(6.dp),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Text(ct.emoji, fontSize = 20.sp)
            Spacer(Modifier.height(4.dp))
            Text(
                ct.valueDisplay,
                color = if (!used) accent else MUTED,
                fontSize = 15.sp, fontWeight = FontWeight.ExtraBold, lineHeight = 15.sp
            )
            Text(
                ct.unitLabel,
                color = if (!used) accent.copy(alpha = 0.75f) else MUTED.copy(alpha = 0.6f),
                fontSize = 9.sp, lineHeight = 11.sp
            )
            if (!used) {
                Spacer(Modifier.height(4.dp))
                Box(
                    modifier = Modifier
                        .background(accent.copy(alpha = 0.18f), RoundedCornerShape(4.dp))
                        .padding(horizontal = 4.dp, vertical = 2.dp)
                ) {
                    Text(ct.readyLabel, color = accent, fontSize = 7.sp, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

@Composable
private fun UsedCardRow(card: CardEntry, ct: CardTypeContent) {
    val freeze = isFreeze(ct)
    val dateStr = remember(card.usedAtMs) {
        card.usedAtMs?.let {
            SimpleDateFormat("MMM d, HH:mm", Locale.getDefault()).format(Date(it))
        } ?: "—"
    }
    val earnedLabel = when {
        card.earnedFrom.contains("login")  -> stringResource(R.string.award_from_login)
        card.earnedFrom.contains("hourly") -> stringResource(R.string.award_from_hourly)
        card.earnedFrom.contains("streak") -> stringResource(R.string.award_from_streak)
        else -> card.earnedFrom.replace("_", " ")
    }
    val actionLabel = if (freeze) stringResource(R.string.award_protected_streak_on, dateStr) else stringResource(R.string.award_used_on, dateStr)

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(SURFACE3, RoundedCornerShape(8.dp))
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        Text(ct.emoji, fontSize = 16.sp)
        Column(modifier = Modifier.weight(1f)) {
            Text("${ct.valueDisplay} ${ct.unitLabel} · $earnedLabel", color = TEXT_SEC, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
            Text(actionLabel, color = MUTED, fontSize = 10.sp)
        }
        Box(
            modifier = Modifier
                .background(MUTED.copy(alpha = 0.15f), RoundedCornerShape(4.dp))
                .padding(horizontal = 6.dp, vertical = 2.dp)
        ) {
            Text(ct.usedLabel, color = MUTED, fontSize = 9.sp, fontWeight = FontWeight.Bold)
        }
    }
}

// ── Streak tab ────────────────────────────────────────────────────────────────

@Composable
private fun StreakTab(state: AwardsUiState) {
    val milestones = state.milestones
    val nextMilestone    = milestones.firstOrNull { it.day > state.loginStreak }
    val prevMilestoneDay = milestones.lastOrNull  { it.day <= state.loginStreak }?.day ?: 0
    val nextMilestoneDay = nextMilestone?.day ?: (state.loginStreak + 1)
    val targetProgress = if (nextMilestoneDay > prevMilestoneDay) {
        ((state.loginStreak - prevMilestoneDay).toFloat() / (nextMilestoneDay - prevMilestoneDay)).coerceIn(0f, 1f)
    } else 1f

    // Animated progress bar fill
    var progressTarget by remember { mutableFloatStateOf(0f) }
    val animatedProgress by animateFloatAsState(
        targetValue = progressTarget,
        animationSpec = tween(1200, easing = FastOutSlowInEasing),
        label = "progress_bar"
    )
    LaunchedEffect(state.loginStreak) { delay(500); progressTarget = targetProgress }

    // Count-up streak number
    var displayedStreak by remember { mutableIntStateOf(0) }
    LaunchedEffect(state.loginStreak) {
        val target = state.loginStreak
        val steps = minOf(target, 25)
        if (steps > 0) for (i in 1..steps) { delay(35L); displayedStreak = target * i / steps }
        displayedStreak = target
    }

    // Flame pulse
    val flameTransition = rememberInfiniteTransition(label = "flame")
    val flameScale by flameTransition.animateFloat(
        initialValue = 1f, targetValue = 1.14f,
        animationSpec = infiniteRepeatable(tween(700, easing = FastOutSlowInEasing), RepeatMode.Reverse),
        label = "flame_scale"
    )

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        // Hero banner
        item {
            var heroVisible by remember { mutableStateOf(false) }
            LaunchedEffect(Unit) { heroVisible = true }
            AnimatedVisibility(
                visible = heroVisible,
                enter = fadeIn(tween(500)) + slideInVertically(tween(500)) { -it / 2 }
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(
                            Brush.horizontalGradient(listOf(Color(0xFF431407), Color(0xFF1C0A00))),
                            RoundedCornerShape(16.dp)
                        )
                        .border(1.dp, AMBER.copy(alpha = 0.35f), RoundedCornerShape(16.dp))
                        .padding(horizontal = 20.dp, vertical = 16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(16.dp)
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text("🔥", fontSize = 38.sp, modifier = Modifier.scale(flameScale))
                        Text(
                            "$displayedStreak",
                            color = AMBER, fontSize = 42.sp,
                            fontWeight = FontWeight.ExtraBold, lineHeight = 42.sp
                        )
                        Text(stringResource(R.string.award_day_streak), color = AMBER.copy(alpha = 0.6f), fontSize = 11.sp)
                    }
                    Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            MiniStatChip(Modifier.weight(1f), "📅", "${state.totalDaysPlayed}", stringResource(R.string.award_total_days))
                            MiniStatChip(Modifier.weight(1f), "🏆", "${state.longestStreak}", stringResource(R.string.award_best_streak))
                        }
                        if (nextMilestone != null) {
                            val daysLeft = nextMilestone.day - state.loginStreak
                            Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                    Text(stringResource(R.string.award_next_day, nextMilestone.day), color = AMBER.copy(alpha = 0.8f), fontSize = 10.sp)
                                    Text(pluralStringResource(R.plurals.award_days_left, daysLeft, daysLeft), color = TEXT_SEC, fontSize = 10.sp)
                                }
                                LinearProgressIndicator(
                                    progress = { animatedProgress },
                                    modifier = Modifier.fillMaxWidth().height(5.dp).clip(RoundedCornerShape(3.dp)),
                                    color = AMBER,
                                    trackColor = AMBER.copy(alpha = 0.15f)
                                )
                            }
                        } else {
                            Text(stringResource(R.string.award_all_milestones), color = ACCENT_GREEN, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }
        }

        if (milestones.isNotEmpty()) {
            item { SectionLabel(stringResource(R.string.award_section_milestones)) }
            itemsIndexed(milestones) { index, milestone ->
                MilestoneRow(
                    milestone    = milestone,
                    achieved     = state.loginStreak >= milestone.day,
                    daysLeft     = if (state.loginStreak < milestone.day) milestone.day - state.loginStreak else 0,
                    isCurrent    = nextMilestone == milestone,
                    animIndex    = index
                )
            }
        }
    }
}

@Composable
private fun MiniStatChip(modifier: Modifier, icon: String, value: String, label: String) {
    Column(
        modifier = modifier
            .background(Color(0xFF0A0500), RoundedCornerShape(8.dp))
            .padding(horizontal = 8.dp, vertical = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(icon, fontSize = 14.sp)
        Text(value, color = AMBER, fontSize = 18.sp, fontWeight = FontWeight.ExtraBold, lineHeight = 18.sp)
        Text(label, color = TEXT_SEC, fontSize = 9.sp)
    }
}

@Composable
private fun MilestoneRow(
    milestone: MilestoneContent,
    achieved: Boolean,
    daysLeft: Int = 0,
    isCurrent: Boolean = false,
    animIndex: Int = 0
) {
    var visible by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { delay(animIndex * 65L + 200L); visible = true }

    val checkScale by animateFloatAsState(
        targetValue = if (achieved && visible) 1f else 0f,
        animationSpec = spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessMediumLow),
        label = "check_scale"
    )

    val bgColor = when {
        achieved  -> Color(0xFF052E16)
        isCurrent -> Color(0xFF1C1A02)
        else      -> SURFACE2
    }
    val accentColor = when {
        achieved  -> ACCENT_GREEN
        isCurrent -> AMBER
        else      -> MUTED
    }

    AnimatedVisibility(
        visible = visible,
        enter = fadeIn(tween(350)) + slideInHorizontally(tween(350, easing = FastOutSlowInEasing)) { -it / 4 }
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(bgColor, RoundedCornerShape(10.dp))
                .border(
                    1.dp,
                    if (achieved || isCurrent) accentColor.copy(alpha = 0.35f) else Color.Transparent,
                    RoundedCornerShape(10.dp)
                )
                .padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Box(
                modifier = Modifier
                    .size(36.dp)
                    .background(accentColor.copy(alpha = 0.15f), CircleShape)
                    .border(1.dp, accentColor.copy(alpha = 0.35f), CircleShape),
                contentAlignment = Alignment.Center
            ) {
                Text(milestone.emoji, fontSize = 16.sp)
            }
            Column(modifier = Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(stringResource(R.string.award_day_n, milestone.day), color = accentColor, fontSize = 12.sp, fontWeight = FontWeight.ExtraBold)
                    if (isCurrent) {
                        Box(
                            modifier = Modifier
                                .background(AMBER.copy(alpha = 0.18f), RoundedCornerShape(4.dp))
                                .padding(horizontal = 4.dp, vertical = 1.dp)
                        ) {
                            Text(stringResource(R.string.award_label_next), color = AMBER, fontSize = 8.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                }
                // Built from reward counts so it follows the app language (backend text is English-only)
                val rw = milestone.rewards
                val rewardParts = buildList {
                    if (rw.cards > 0) add(pluralStringResource(R.plurals.award_reward_cards, rw.cards, rw.cards))
                    if (rw.xp > 0) add("${rw.xp} XP")
                    if (rw.bagRefills > 0) add(pluralStringResource(R.plurals.award_reward_bag, rw.bagRefills, rw.bagRefills))
                }
                Text(
                    rewardParts.joinToString(" + ").ifEmpty { milestone.description },
                    color = if (achieved) TEXT else TEXT_SEC, fontSize = 12.sp
                )
                // Show freeze card count if milestone grants any
                if (milestone.rewards.freezeCards > 0) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(3.dp)
                    ) {
                        Text("🧊", fontSize = 10.sp)
                        Text(
                            pluralStringResource(R.plurals.award_freeze_cards_plus, milestone.rewards.freezeCards, milestone.rewards.freezeCards),
                            color = if (achieved) ACCENT_ICE else ACCENT_ICE.copy(alpha = 0.5f),
                            fontSize = 10.sp
                        )
                    }
                }
                if (!achieved && daysLeft > 0) {
                    Text(pluralStringResource(R.plurals.award_days_to_go, daysLeft, daysLeft), color = MUTED, fontSize = 10.sp)
                }
            }
            if (achieved) {
                Text("✓", color = ACCENT_GREEN, fontSize = 16.sp,
                    fontWeight = FontWeight.ExtraBold, modifier = Modifier.scale(checkScale))
            }
        }
    }
}

// ── Shared helpers ────────────────────────────────────────────────────────────

@Composable
private fun SectionLabel(text: String) {
    Text(text, color = MUTED, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.1.em)
}

@Composable
private fun EmptyState(icon: String, title: String, subtitle: String) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(top = 40.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Text(icon, fontSize = 38.sp)
        Text(title, color = TEXT_SEC, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
        Text(subtitle, color = MUTED, fontSize = 12.sp, textAlign = TextAlign.Center, lineHeight = 17.sp)
    }
}
