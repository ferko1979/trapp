package com.fairco.trap

import android.os.Bundle
import com.fairco.trap.ui.theme.TrappTheme
import com.fairco.trap.ui.theme.Radar
import androidx.activity.compose.setContent
import androidx.appcompat.app.AppCompatActivity
import com.fairco.trap.BaseActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.material3.TabRowDefaults.tabIndicatorOffset
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.firebase.Firebase
import com.google.firebase.functions.functions
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import java.text.SimpleDateFormat
import java.util.*
import android.widget.Toast

data class CaptureRecord(
    val id: String,
    val trapTypeId: String,
    val iconKey: String,
    val emoji: String,
    val trapName: String,
    val effectKind: String,
    val effectValue: Int?,
    val capturedUserId: String,
    val capturedUsername: String,
    val ownerUid: String,
    val ownerUsername: String,
    val captureDistanceMeters: Int?,
    val capturedAtEpochMs: Long?
)

class CaptureHistoryActivity : BaseActivity() {

    override val radarBars = true
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { TrappTheme {
            CaptureHistoryScreen()
        } }
    }
}

@Composable
private fun CaptureHistoryScreen() {
    var selectedTab by remember { mutableIntStateOf(0) }
    val myCaptures = remember { mutableStateOf<List<CaptureRecord>>(emptyList()) }
    val caughtMe = remember { mutableStateOf<List<CaptureRecord>>(emptyList()) }
    var myLoading by remember { mutableStateOf(true) }
    var caughtLoading by remember { mutableStateOf(true) }
    var myError by remember { mutableStateOf<String?>(null) }
    var caughtError by remember { mutableStateOf<String?>(null) }

    val functions = Firebase.functions("europe-west1")
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        scope.launch {
            try {
                val result = functions.getHttpsCallable("listMyCaptures").call().await()
                @Suppress("UNCHECKED_CAST")
                val data = result.getData() as? Map<String, Any?> ?: return@launch
                @Suppress("UNCHECKED_CAST")
                val items = data["items"] as? List<Map<String, Any?>> ?: emptyList()
                myCaptures.value = items.map { it.toCaptureRecord() }
            } catch (e: Exception) {
                myError = ServerErrorText.of(e)
            } finally {
                myLoading = false
            }
        }
        scope.launch {
            try {
                val result = functions.getHttpsCallable("listPlayersWhoCapturedMe").call().await()
                @Suppress("UNCHECKED_CAST")
                val data = result.getData() as? Map<String, Any?> ?: return@launch
                @Suppress("UNCHECKED_CAST")
                val items = data["items"] as? List<Map<String, Any?>> ?: emptyList()
                caughtMe.value = items.map { it.toCaptureRecord() }
            } catch (e: Exception) {
                caughtError = ServerErrorText.of(e)
            } finally {
                caughtLoading = false
            }
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Radar.Bg)
    ) {
        val activity = LocalContext.current as? android.app.Activity
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .statusBarsPadding()
                .padding(horizontal = 16.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                stringResource(R.string.title_capture_history),
                color = Color.White,
                fontSize = 18.sp,
                fontWeight = FontWeight.ExtraBold,
                letterSpacing = 2.sp,
                modifier = Modifier.weight(1f)
            )
            IconButton(onClick = { activity?.finish() }) {
                Text("✕", color = Radar.TextSec, fontSize = 18.sp)
            }
        }

        TabRow(
            selectedTabIndex = selectedTab,
            containerColor = Radar.Surface,
            contentColor = Radar.Accent,
            indicator = { tabPositions ->
                TabRowDefaults.SecondaryIndicator(
                    Modifier.tabIndicatorOffset(tabPositions[selectedTab]),
                    color = Radar.Accent
                )
            }
        ) {
            listOf(
                stringResource(R.string.tab_my_captures),
                stringResource(R.string.tab_caught_me)
            ).forEachIndexed { index, title ->
                Tab(
                    selected = selectedTab == index,
                    onClick = { selectedTab = index },
                    text = {
                        Text(
                            title,
                            color = if (selectedTab == index) Radar.Accent else Radar.TextMuted,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.SemiBold
                        )
                    }
                )
            }
        }

        when (selectedTab) {
            0 -> CaptureList(
                records = myCaptures.value,
                loading = myLoading,
                error = myError,
                emptyMsg = stringResource(R.string.msg_no_captures_yet),
                isMyCaptures = true
            )
            1 -> CaptureList(
                records = caughtMe.value,
                loading = caughtLoading,
                error = caughtError,
                emptyMsg = stringResource(R.string.msg_no_caught_yet),
                isMyCaptures = false
            )
        }
    }
}

@Composable
private fun CaptureList(
    records: List<CaptureRecord>,
    loading: Boolean,
    error: String?,
    emptyMsg: String,
    isMyCaptures: Boolean
) {
    when {
        loading -> Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator(color = Radar.Accent)
        }
        error != null -> Box(modifier = Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
            Text(error, color = Radar.Trap, fontSize = 14.sp, textAlign = TextAlign.Center)
        }
        records.isEmpty() -> Box(modifier = Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
            Text(emptyMsg, color = Radar.TextMuted, fontSize = 15.sp, textAlign = TextAlign.Center)
        }
        else -> LazyColumn(modifier = Modifier.fillMaxSize()) {
            items(records) { record ->
                CaptureRow(record = record, isMyCapture = isMyCaptures)
                HorizontalDivider(color = Radar.Surface2, thickness = 0.5.dp)
            }
        }
    }
}

@Composable
private fun CaptureRow(record: CaptureRecord, isMyCapture: Boolean) {
    val context = LocalContext.current
    val functions = Firebase.functions("europe-west1")
    val scope = rememberCoroutineScope()
    var showEnemyDialog by remember { mutableStateOf(false) }

    // For "My Captures": the enemy is the victim (capturedUserId/capturedUsername).
    // For "Caught Me": the enemy is the trapper (ownerUid/ownerUsername).
    val enemyUid      = if (isMyCapture) record.capturedUserId else record.ownerUid
    val enemyUsername = if (isMyCapture) record.capturedUsername else record.ownerUsername

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        // Trap icon
        Box(
            modifier = Modifier
                .size(44.dp)
                .background(Radar.Bg, RoundedCornerShape(12.dp)),
            contentAlignment = Alignment.Center
        ) {
            Text(trapIcon(record.iconKey, record.emoji), fontSize = 22.sp)
        }
        Spacer(Modifier.width(12.dp))

        Column(modifier = Modifier.weight(1f)) {
            // Tappable enemy chip
            if (enemyUsername.isNotBlank()) {
                val label = if (isMyCapture)
                    stringResource(R.string.capture_caught_user, enemyUsername)
                else
                    stringResource(R.string.capture_caught_by_user, enemyUsername)
                val chipColor = if (isMyCapture) Color(0xFF14532D) else Color(0xFF450A0A)
                val textColor = if (isMyCapture) Radar.Safe else Radar.TrapSoft
                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(12.dp))
                        .background(chipColor)
                        .clickable(enabled = enemyUid.isNotBlank()) { showEnemyDialog = true }
                        .padding(horizontal = 10.dp, vertical = 4.dp)
                ) {
                    Text(label, color = textColor, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                }
                Spacer(Modifier.height(4.dp))
            }
            Text(
                stringResource(R.string.label_trap_used, record.trapName),
                color = Radar.TextSec,
                fontSize = 11.sp
            )
            if (record.captureDistanceMeters != null) {
                Text(
                    stringResource(R.string.label_distance_m, record.captureDistanceMeters),
                    color = Radar.TextMuted,
                    fontSize = 10.sp
                )
            }
            record.capturedAtEpochMs?.let {
                Text(
                    formatCaptureDate(it),
                    color = Radar.TextMuted,
                    fontSize = 10.sp
                )
            }
        }

        // Points badge
        if (record.effectValue != null && record.effectValue > 0) {
            Box(
                modifier = Modifier
                    .background(
                        if (isMyCapture) Color(0xFF14532D) else Color(0xFF450A0A),
                        RoundedCornerShape(8.dp)
                    )
                    .padding(horizontal = 8.dp, vertical = 4.dp)
            ) {
                Text(
                    stringResource(R.string.label_points_earned, record.effectValue),
                    color = if (isMyCapture) Radar.Safe else Radar.TrapSoft,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Bold
                )
            }
        }
    }

    if (showEnemyDialog && enemyUid.isNotBlank()) {
        EnemyActionsDialog(
            username = enemyUsername,
            onAction = { action ->
                showEnemyDialog = false
                scope.launch {
                    try {
                        when (action) {
                            EnemyAction.ADD_FRIEND ->
                                functions.getHttpsCallable("sendFriendRequest")
                                    .call(mapOf("toUid" to enemyUid)).await()
                            EnemyAction.MESSAGE -> {
                                val result = functions.getHttpsCallable("getOrCreateConversation")
                                    .call(mapOf("otherUid" to enemyUid)).await()
                                @Suppress("UNCHECKED_CAST")
                                val convId = (result.getData() as? Map<String, Any?>)?.get("conversationId") as? String
                                if (convId != null) {
                                    val intent = android.content.Intent(context, ChatActivity::class.java)
                                    intent.putExtra("conversationId", convId)
                                    intent.putExtra("otherUid", enemyUid)
                                    context.startActivity(intent)
                                }
                            }
                        }
                        if (action == EnemyAction.ADD_FRIEND) {
                            Toast.makeText(context, context.getString(R.string.capture_friend_request_sent_to, enemyUsername), Toast.LENGTH_SHORT).show()
                        }
                    } catch (e: Exception) {
                        Toast.makeText(context, ServerErrorText.of(context, e), Toast.LENGTH_SHORT).show()
                    }
                }
            },
            onDismiss = { showEnemyDialog = false }
        )
    }
}

private fun Map<String, Any?>.toCaptureRecord(): CaptureRecord {
    val trapTypeId = this["trapTypeId"] as? String ?: ""
    val iconKey = this["iconKey"] as? String ?: trapTypeId.ifBlank { "default" }
    // Use localizedTrapName from backend → fall back to graceful derivation from trapTypeId
    val trapName = (this["localizedTrapName"] as? String
        ?: this["trapName"] as? String
        ?: trapTypeId.replace("_", " ").replaceFirstChar { it.uppercase() }.ifBlank { "Trap" })
    return CaptureRecord(
        id = this["id"] as? String ?: "",
        trapTypeId = trapTypeId,
        iconKey = iconKey,
        emoji = this["emoji"] as? String ?: "",
        trapName = trapName,
        effectKind = this["effectKind"] as? String ?: "",
        effectValue = (this["effectValue"] as? Number)?.toInt(),
        capturedUserId = this["capturedUserId"] as? String ?: "",
        capturedUsername = this["capturedUsername"] as? String ?: "",
        ownerUid = this["ownerUid"] as? String ?: "",
        ownerUsername = this["ownerUsername"] as? String ?: "",
        captureDistanceMeters = (this["captureDistanceMeters"] as? Number)?.toInt(),
        capturedAtEpochMs = (this["capturedAtEpochMs"] as? Number)?.toLong()
    )
}

private fun formatCaptureDate(epochMs: Long): String {
    val sdf = SimpleDateFormat("dd MMM yyyy, HH:mm", Locale.getDefault())
    return sdf.format(Date(epochMs))
}

