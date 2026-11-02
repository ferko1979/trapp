package com.fairco.trap

import androidx.compose.foundation.background
import com.fairco.trap.ui.theme.Radar
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
        colors = CardDefaults.cardColors(containerColor = Radar.Bg),
        shape = RoundedCornerShape(16.dp)
    ) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                stringResource(R.string.label_rank_summary),
                color = Radar.TextSec,
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
                    color = Radar.Gold
                )
                if (summary.globalRank != null && summary.globalTotal != null) {
                    RankChip(
                        label = "🌍",
                        value = "#${summary.globalRank}/${summary.globalTotal}",
                        color = Radar.Accent
                    )
                }
                if (summary.hasFriends && summary.friendsRank != null && summary.friendsTotal != null) {
                    RankChip(
                        label = "👥",
                        value = "#${summary.friendsRank}/${summary.friendsTotal}",
                        color = Radar.Safe
                    )
                }
                if (summary.allyRank != null && summary.allyTotal != null) {
                    RankChip(
                        label = "🤝",
                        value = "#${summary.allyRank}/${summary.allyTotal}",
                        color = Radar.Gold
                    )
                }
            }
            if (!summary.allyGroupName.isNullOrBlank()) {
                Text(
                    stringResource(R.string.label_alliance_name, summary.allyGroupName),
                    color = Radar.Gold,
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
                CircularProgressIndicator(color = Radar.Accent)
            }
        }
        is LeaderboardState.Empty -> {
            Box(modifier = Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
                Text(
                    state.message,
                    color = Radar.TextMuted,
                    fontSize = 15.sp,
                    textAlign = TextAlign.Center
                )
            }
        }
        is LeaderboardState.Error -> {
            Box(modifier = Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
                Text(state.message, color = Radar.Trap, fontSize = 14.sp, textAlign = TextAlign.Center)
            }
        }
        is LeaderboardState.Loaded -> {
            Column {
                state.subtitle?.let {
                    Text(
                        it,
                        color = Radar.Gold,
                        fontSize = 12.sp,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)
                    )
                }
                LazyColumn(modifier = Modifier.fillMaxSize()) {
                    itemsIndexed(state.entries) { _, entry ->
                        LeaderboardRow(entry = entry, isMe = entry.uid == myUid)
                        HorizontalDivider(color = Radar.Surface2, thickness = 0.5.dp)
                    }
                }
            }
        }
    }
}

@Composable
private fun LeaderboardRow(entry: LeaderboardEntry, isMe: Boolean) {
    val bgColor = if (isMe) Radar.Surface2 else Color.Transparent
    val rankColor = when (entry.rank) {
        1 -> Radar.Gold
        2 -> Color(0xFFC0C0C0)
        3 -> Color(0xFFCD7F32)
        else -> Radar.TextMuted
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
                .background(if (entry.rank <= 3) rankColor.copy(alpha = 0.15f) else Radar.Surface2),
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
                    color = if (isMe) Radar.Accent else Radar.Text,
                    fontSize = 14.sp,
                    fontWeight = if (isMe) FontWeight.Bold else FontWeight.Normal
                )
                if (isMe) {
                    Spacer(Modifier.width(6.dp))
                    Text(
                        stringResource(R.string.label_rank_you),
                        color = Radar.Accent,
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold
                    )
                }
            }
            Text(
                stringResource(R.string.label_captures_count, entry.captureCount),
                color = Radar.TextMuted,
                fontSize = 11.sp
            )
        }

        // Score
        Text(
            stringResource(R.string.label_score_pts, entry.score),
            color = Radar.Gold,
            fontSize = 13.sp,
            fontWeight = FontWeight.Bold
        )
    }
}
