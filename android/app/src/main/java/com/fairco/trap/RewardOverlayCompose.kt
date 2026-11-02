package com.fairco.trap

import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

data class RewardEvent(
    val streak: Int,
    val isDay1: Boolean,
    val awards: List<AwardItem>,
    /** null = daily login, 1–8 = Day 1 hourly bonus */
    val hourIndex: Int? = null
)

data class AwardItem(
    val iconEmoji: String,
    val label: String,
    val cardsGranted: Int,
    val xpGranted: Int,
    val bagRefillGranted: Int
)

private val DARK_BG = Color(0xFF060D18)
private val CARD_BG = Color(0xFF0E1A2E)
private val ACCENT_GREEN = Color(0xFF22C55E)
private val ACCENT_GOLD  = Color(0xFFFCD34D)
private val ACCENT_BLUE  = Color(0xFF3B82F6)
private val TEXT_PRIMARY = Color(0xFFE2E8F0)
private val TEXT_DIM     = Color(0xFF64748B)

@Composable
fun RewardOverlay(event: RewardEvent, onDismiss: () -> Unit) {
    // Animate in
    var visible by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { visible = true }

    val bgAlpha by animateFloatAsState(
        targetValue = if (visible) 0.92f else 0f,
        animationSpec = tween(400),
        label = "bgAlpha"
    )
    val contentScale by animateFloatAsState(
        targetValue = if (visible) 1f else 0.85f,
        animationSpec = spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessLow),
        label = "contentScale"
    )

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(DARK_BG.copy(alpha = bgAlpha)),
        contentAlignment = Alignment.Center
    ) {
        Column(
            modifier = Modifier
                .scale(contentScale)
                .padding(24.dp)
                .fillMaxWidth()
                .clip(RoundedCornerShape(24.dp))
                .background(
                    Brush.verticalGradient(listOf(Color(0xFF0F1F38), Color(0xFF060D18)))
                )
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Header
            val headerEmoji = if (event.hourIndex != null) "⏰" else "🔥"
            val headerText  = if (event.hourIndex != null)
                "Hour ${event.hourIndex} Bonus!"
            else
                "Day ${event.streak} Reward!"

            Text(
                text = headerEmoji,
                fontSize = 56.sp
            )
            Text(
                text = headerText,
                fontSize = 26.sp,
                fontWeight = FontWeight.Bold,
                color = ACCENT_GOLD,
                textAlign = TextAlign.Center
            )

            if (event.hourIndex == null && event.streak > 0) {
                StreakBadge(streak = event.streak, isDay1 = event.isDay1)
            }

            Divider(color = Color(0xFF1E3A5F), thickness = 1.dp)

            // Award list
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                event.awards.forEach { award ->
                    AwardRow(award)
                }
            }

            if (event.awards.isEmpty()) {
                Text(
                    text = "Keep playing every day to unlock bigger rewards!",
                    fontSize = 13.sp,
                    color = TEXT_DIM,
                    textAlign = TextAlign.Center
                )
            }

            Spacer(Modifier.height(4.dp))

            // Collect button
            Button(
                onClick = onDismiss,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(52.dp),
                shape = RoundedCornerShape(14.dp),
                colors = ButtonDefaults.buttonColors(containerColor = ACCENT_GREEN)
            ) {
                Text(
                    text = "Collect! 🎉",
                    fontSize = 17.sp,
                    fontWeight = FontWeight.Bold,
                    color = Color.White
                )
            }

            if (event.isDay1 && event.hourIndex == null) {
                Text(
                    text = "Come back every hour today for bonus rewards!",
                    fontSize = 12.sp,
                    color = ACCENT_BLUE,
                    textAlign = TextAlign.Center
                )
            }
        }
    }
}

@Composable
private fun StreakBadge(streak: Int, isDay1: Boolean) {
    val pulseAnim = rememberInfiniteTransition(label = "pulse")
    val scale by pulseAnim.animateFloat(
        initialValue = 1f, targetValue = 1.08f,
        animationSpec = infiniteRepeatable(
            animation = tween(900, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "streakPulse"
    )
    Box(
        modifier = Modifier
            .scale(scale)
            .clip(RoundedCornerShape(50.dp))
            .background(
                Brush.horizontalGradient(
                    listOf(Color(0xFF7C3AED), Color(0xFF3B82F6))
                )
            )
            .padding(horizontal = 20.dp, vertical = 8.dp)
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Text("🔥", fontSize = 18.sp)
            Text(
                text = "$streak day streak",
                fontSize = 15.sp,
                fontWeight = FontWeight.Bold,
                color = Color.White
            )
            if (isDay1) {
                Text(
                    text = "· New!",
                    fontSize = 13.sp,
                    color = ACCENT_GOLD,
                    fontWeight = FontWeight.SemiBold
                )
            }
        }
    }
}

@Composable
private fun AwardRow(award: AwardItem) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(CARD_BG)
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        // Emoji bubble
        Box(
            modifier = Modifier
                .size(44.dp)
                .clip(CircleShape)
                .background(Color(0xFF1E3A5F)),
            contentAlignment = Alignment.Center
        ) {
            Text(award.iconEmoji, fontSize = 22.sp)
        }

        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = award.label,
                fontSize = 14.sp,
                fontWeight = FontWeight.SemiBold,
                color = TEXT_PRIMARY
            )
            val extras = buildList {
                if (award.cardsGranted  > 0) add("🃏 ${award.cardsGranted} card${if (award.cardsGranted > 1) "s" else ""}")
                if (award.xpGranted     > 0) add("⚡ +${award.xpGranted} XP")
                if (award.bagRefillGranted > 0) add("🎒 +${award.bagRefillGranted} bag")
            }
            if (extras.isNotEmpty()) {
                Text(
                    text = extras.joinToString("  "),
                    fontSize = 12.sp,
                    color = ACCENT_GREEN
                )
            }
        }

        // Card count badge
        if (award.cardsGranted > 0) {
            Box(
                modifier = Modifier
                    .clip(RoundedCornerShape(8.dp))
                    .background(Color(0xFF1A2E1A))
                    .padding(horizontal = 10.dp, vertical = 4.dp),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = "+${award.cardsGranted}",
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold,
                    color = ACCENT_GREEN
                )
            }
        }
    }
}
