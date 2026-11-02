package com.fairco.trap

import android.os.Bundle
import android.widget.Toast
import androidx.activity.compose.setContent
import androidx.appcompat.app.AppCompatActivity
import com.fairco.trap.BaseActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.material3.TabRowDefaults.tabIndicatorOffset
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.firebase.Firebase
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.firestore
import com.google.firebase.functions.functions
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await

class RankingActivity : BaseActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val myUid = FirebaseAuth.getInstance().currentUser?.uid ?: ""

        setContent {
            RankingScreen(myUid = myUid)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun RankingScreen(myUid: String) {
    val tabs = listOf(
        stringResource(R.string.tab_global),
        stringResource(R.string.tab_friends_rank),
        stringResource(R.string.tab_alliance)
    )
    var selectedTab by remember { mutableIntStateOf(0) }

    val globalState = remember { mutableStateOf<LeaderboardState>(LeaderboardState.Loading) }
    val friendsState = remember { mutableStateOf<LeaderboardState>(LeaderboardState.Loading) }
    val allianceState = remember { mutableStateOf<LeaderboardState>(LeaderboardState.Loading) }
    val rankSummary = remember { mutableStateOf<RankSummary?>(null) }

    val functions = Firebase.functions("europe-west1")
    val scope = rememberCoroutineScope()

    // Load rank summary
    LaunchedEffect(myUid) {
        if (myUid.isEmpty()) {
            allianceState.value = LeaderboardState.Empty("Sign in to see alliance ranking")
            return@LaunchedEffect
        }
        try {
            val result = functions.getHttpsCallable("getMyRankSummary").call().await()
            @Suppress("UNCHECKED_CAST")
            val data = result.getData() as? Map<String, Any?> ?: run {
                allianceState.value = LeaderboardState.Empty("Not a member of any alliance")
                return@LaunchedEffect
            }
            rankSummary.value = RankSummary(
                globalRank = (data["globalRank"] as? Number)?.toInt(),
                globalTotal = (data["globalTotal"] as? Number)?.toInt(),
                hasFriends = data["hasFriends"] as? Boolean ?: false,
                friendsRank = (data["friendsRank"] as? Number)?.toInt(),
                friendsTotal = (data["friendsTotal"] as? Number)?.toInt(),
                allyGroupName = data["allyGroupName"] as? String,
                allyRank = (data["allyRank"] as? Number)?.toInt(),
                allyTotal = (data["allyTotal"] as? Number)?.toInt(),
                score = (data["xp"] as? Number)?.toInt() ?: 0,
                captureCount = (data["captureCount"] as? Number)?.toInt() ?: 0
            )
        } catch (e: Exception) {
            allianceState.value = LeaderboardState.Error(e.message ?: "Failed to load ranking")
        }
    }

    // Load global leaderboard via Cloud Function (admin SDK bypasses Firestore rules).
    LaunchedEffect(Unit) {
        try {
            val result = functions.getHttpsCallable("getGlobalLeaderboard").call().await()
            @Suppress("UNCHECKED_CAST")
            val data = result.getData() as? Map<String, Any?> ?: return@LaunchedEffect
            @Suppress("UNCHECKED_CAST")
            val topRaw = data["top"] as? List<Map<String, Any?>> ?: emptyList()
            val entries = topRaw.map { item ->
                LeaderboardEntry(
                    rank = (item["rank"] as? Number)?.toInt() ?: 0,
                    uid = item["uid"] as? String ?: "",
                    displayName = item["displayName"] as? String ?: "Anonymous",
                    captureCount = (item["captureCount"] as? Number)?.toInt() ?: 0,
                    score = (item["xp"] as? Number)?.toInt() ?: 0
                )
            }
            globalState.value = if (entries.isEmpty())
                LeaderboardState.Empty("No global rankings yet")
            else
                LeaderboardState.Loaded(entries)
        } catch (e: Exception) {
            globalState.value = LeaderboardState.Error(e.message ?: "Failed to load")
        }
    }

    // Load friends leaderboard
    LaunchedEffect(Unit) {
        if (myUid.isEmpty()) { friendsState.value = LeaderboardState.Empty("Sign in to see friends ranking"); return@LaunchedEffect }
        try {
            val result = functions.getHttpsCallable("getFriendsLeaderboard").call().await()
            @Suppress("UNCHECKED_CAST")
            val data = result.getData() as? Map<String, Any?> ?: return@LaunchedEffect
            val hasFriends = data["hasFriends"] as? Boolean ?: false
            if (!hasFriends) {
                friendsState.value = LeaderboardState.Empty("No friends yet\n\nAdd friends to see how you compare!")
                return@LaunchedEffect
            }
            @Suppress("UNCHECKED_CAST")
            val topRaw = data["top"] as? List<Map<String, Any?>> ?: emptyList()
            val entries = topRaw.map { item ->
                LeaderboardEntry(
                    rank = (item["rank"] as? Number)?.toInt() ?: 0,
                    uid = item["uid"] as? String ?: "",
                    displayName = item["displayName"] as? String ?: "Anonymous",
                    captureCount = (item["captureCount"] as? Number)?.toInt() ?: 0,
                    score = (item["xp"] as? Number)?.toInt() ?: 0,
                    isMe = item["isMe"] as? Boolean ?: false
                )
            }
            friendsState.value = if (entries.isEmpty()) LeaderboardState.Empty("No friends yet")
            else LeaderboardState.Loaded(entries)
        } catch (e: Exception) {
            friendsState.value = LeaderboardState.Error(e.message ?: "Failed to load")
        }
    }

    // Load alliance leaderboard — requires knowing group ID; use rank summary if available
    LaunchedEffect(rankSummary.value) {
        val summary = rankSummary.value ?: return@LaunchedEffect
        if (summary.allyGroupName == null) {
            allianceState.value = LeaderboardState.Empty("Not a member of any alliance")
            return@LaunchedEffect
        }
        // We don't have groupId here directly; it's embedded in the context.
        // Use getMyRankSummary result as a mini-summary instead.
        if (summary.allyRank != null && summary.allyTotal != null) {
            allianceState.value = LeaderboardState.Loaded(
                entries = emptyList(), // full list requires groupId — show summary instead
                subtitle = "${summary.allyGroupName}: You are #${summary.allyRank} of ${summary.allyTotal}"
            )
        } else {
            allianceState.value = LeaderboardState.Empty("Not enough members for ranking")
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF000D1A))
    ) {
        // Top bar
        val activity = LocalContext.current as? android.app.Activity
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .statusBarsPadding()
                .padding(horizontal = 16.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                stringResource(R.string.title_ranking),
                color = Color.White,
                fontSize = 18.sp,
                fontWeight = FontWeight.ExtraBold,
                letterSpacing = 2.sp,
                modifier = Modifier.weight(1f)
            )
            IconButton(onClick = { activity?.finish() }) {
                Text("✕", color = Color(0xFF94A3B8), fontSize = 18.sp)
            }
        }

        // Rank summary card
        rankSummary.value?.let { summary ->
            RankSummaryCard(summary)
        }

        // Tabs
        TabRow(
            selectedTabIndex = selectedTab,
            containerColor = Color(0xFF0D1626),
            contentColor = Color(0xFF3B82F6),
            indicator = { tabPositions ->
                TabRowDefaults.SecondaryIndicator(
                    Modifier.tabIndicatorOffset(tabPositions[selectedTab]),
                    color = Color(0xFF3B82F6)
                )
            }
        ) {
            tabs.forEachIndexed { index, title ->
                Tab(
                    selected = selectedTab == index,
                    onClick = { selectedTab = index },
                    text = {
                        Text(
                            title,
                            color = if (selectedTab == index) Color(0xFF3B82F6) else Color(0xFF64748B),
                            fontSize = 12.sp,
                            fontWeight = FontWeight.SemiBold
                        )
                    }
                )
            }
        }

        // Tab content
        Box(modifier = Modifier.fillMaxSize().background(Color(0xFF000D1A))) {
            when (selectedTab) {
                0 -> LeaderboardTab(state = globalState.value, myUid = myUid)
                1 -> LeaderboardTab(state = friendsState.value, myUid = myUid)
                2 -> AllianceTab(state = allianceState.value)
            }
        }
    }
}

@Composable
private fun AllianceTab(state: LeaderboardState) {
    when (state) {
        is LeaderboardState.Loading -> {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = androidx.compose.ui.Alignment.Center) {
                CircularProgressIndicator(color = Color(0xFF3B82F6))
            }
        }
        is LeaderboardState.Empty -> {
            Box(modifier = Modifier.fillMaxSize().padding(32.dp), contentAlignment = androidx.compose.ui.Alignment.Center) {
                Text(
                    state.message,
                    color = Color(0xFF64748B),
                    fontSize = 15.sp,
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center
                )
            }
        }
        is LeaderboardState.Error -> {
            Box(modifier = Modifier.fillMaxSize().padding(32.dp), contentAlignment = androidx.compose.ui.Alignment.Center) {
                Text(state.message, color = Color(0xFFEF4444), fontSize = 14.sp)
            }
        }
        is LeaderboardState.Loaded -> {
            Box(modifier = Modifier.fillMaxSize().padding(32.dp), contentAlignment = androidx.compose.ui.Alignment.Center) {
                state.subtitle?.let {
                    Text(
                        it,
                        color = Color(0xFFF59E0B),
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Bold,
                        textAlign = androidx.compose.ui.text.style.TextAlign.Center
                    )
                }
            }
        }
    }
}

