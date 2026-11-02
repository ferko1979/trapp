package com.fairco.trap

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

data class LeaderboardEntry(
    val rank: Int,
    val uid: String,
    val displayName: String,
    val captureCount: Int,
    val score: Int,
    val isMe: Boolean = false
)

data class RankSummary(
    val globalRank: Int?,
    val globalTotal: Int?,
    val hasFriends: Boolean,
    val friendsRank: Int?,
    val friendsTotal: Int?,
    val allyGroupName: String?,
    val allyRank: Int?,
    val allyTotal: Int?,
    val score: Int,
    val captureCount: Int
)

sealed class LeaderboardState {
    object Loading : LeaderboardState()
    data class Loaded(val entries: List<LeaderboardEntry>, val subtitle: String? = null) : LeaderboardState()
    data class Empty(val message: String) : LeaderboardState()
    data class Error(val message: String) : LeaderboardState()
}

@Composable
fun RankSummaryCard(summary: RankSummary) {
    Card(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
        colors = CardDefaults.cardColors(containerColor = Color(0xFF0A1628)),
        shape = RoundedCornerShape(16.dp)
    ) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                stringResource(R.string.label_rank_summary),
                color = Color(0xFF94A3B8),
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 1.sp
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                RankChip(
                    label = "⚡",
                    value = stringResource(R.string.label_score_pts, summary.score),
                    color = Color(0xFFFCD34D)
                )
                if (summary.globalRank != null && summary.globalTotal != null) {
                    RankChip(
                        label = "🌍",
                        value = "#${summary.globalRank}/${summary.globalTotal}",
                        color = Color(0xFF3B82F6)
                    )
                }
                if (summary.hasFriends && summary.friendsRank != null && summary.friendsTotal != null) {
                    RankChip(
                        label = "👥",
                        value = "#${summary.friendsRank}/${summary.friendsTotal}",
                        color = Color(0xFF22C55E)
                    )
                }
                if (summary.allyRank != null && summary.allyTotal != null) {
                    RankChip(
                        label = "🤝",
                        value = "#${summary.allyRank}/${summary.allyTotal}",
                        color = Color(0xFFF59E0B)
                    )
                }
            }
            if (!summary.allyGroupName.isNullOrBlank()) {
                Text(
                    stringResource(R.string.label_alliance_name, summary.allyGroupName),
                    color = Color(0xFFF59E0B),
                    fontSize = 11.sp
                )
            }
        }
    }
}

@Composable
private fun RankChip(label: String, value: String, color: Color) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(label, fontSize = 18.sp)
        Text(value, color = color, fontSize = 12.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
fun LeaderboardTab(state: LeaderboardState, myUid: String) {
    when (state) {
        is LeaderboardState.Loading -> {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = Color(0xFF3B82F6))
            }
        }
        is LeaderboardState.Empty -> {
            Box(modifier = Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
                Text(
                    state.message,
                    color = Color(0xFF64748B),
                    fontSize = 15.sp,
                    textAlign = TextAlign.Center
                )
            }
        }
        is LeaderboardState.Error -> {
            Box(modifier = Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
                Text(state.message, color = Color(0xFFEF4444), fontSize = 14.sp, textAlign = TextAlign.Center)
            }
        }
        is LeaderboardState.Loaded -> {
            Column {
                state.subtitle?.let {
                    Text(
                        it,
                        color = Color(0xFFF59E0B),
                        fontSize = 12.sp,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)
                    )
                }
                LazyColumn(modifier = Modifier.fillMaxSize()) {
                    itemsIndexed(state.entries) { _, entry ->
                        LeaderboardRow(entry = entry, isMe = entry.uid == myUid)
                        HorizontalDivider(color = Color(0xFF1E2D45), thickness = 0.5.dp)
                    }
                }
            }
        }
    }
}

@Composable
private fun LeaderboardRow(entry: LeaderboardEntry, isMe: Boolean) {
    val bgColor = if (isMe) Color(0xFF0F2540) else Color.Transparent
    val rankColor = when (entry.rank) {
        1 -> Color(0xFFFFD700)
        2 -> Color(0xFFC0C0C0)
        3 -> Color(0xFFCD7F32)
        else -> Color(0xFF64748B)
    }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(bgColor)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        // Rank badge
        Box(
            modifier = Modifier
                .size(32.dp)
                .clip(CircleShape)
                .background(if (entry.rank <= 3) rankColor.copy(alpha = 0.15f) else Color(0xFF1E2D45)),
            contentAlignment = Alignment.Center
        ) {
            Text(
                "#${entry.rank}",
                color = rankColor,
                fontSize = if (entry.rank >= 100) 9.sp else 11.sp,
                fontWeight = FontWeight.Bold
            )
        }
        Spacer(Modifier.width(12.dp))

        // Name
        Column(modifier = Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    entry.displayName,
                    color = if (isMe) Color(0xFF93C5FD) else Color(0xFFE2E8F0),
                    fontSize = 14.sp,
                    fontWeight = if (isMe) FontWeight.Bold else FontWeight.Normal
                )
                if (isMe) {
                    Spacer(Modifier.width(6.dp))
                    Text(
                        stringResource(R.string.label_rank_you),
                        color = Color(0xFF3B82F6),
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold
                    )
                }
            }
            Text(
                stringResource(R.string.label_captures_count, entry.captureCount),
                color = Color(0xFF64748B),
                fontSize = 11.sp
            )
        }

        // Score
        Text(
            stringResource(R.string.label_score_pts, entry.score),
            color = Color(0xFFFCD34D),
            fontSize = 13.sp,
            fontWeight = FontWeight.Bold
        )
    }
}
