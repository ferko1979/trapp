package com.fairco.trap

import android.content.Intent
import android.os.Bundle
import android.text.format.DateUtils
import android.widget.Toast
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.lifecycleScope
import com.fairco.trap.ui.*
import com.fairco.trap.ui.theme.Radar
import com.fairco.trap.ui.theme.RadarFonts
import com.fairco.trap.ui.theme.TrappTheme
import com.google.firebase.Firebase
import com.google.firebase.functions.functions
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import java.text.SimpleDateFormat
import java.util.*

class ConversationsActivity : BaseActivity() {

    override val radarBars = true
    private val viewModel: MessagingViewModel by viewModels()

    private val friendsLoading = mutableStateOf(false)
    private val friendPicker = mutableStateOf<List<Friend>?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            TrappTheme {
                val all by viewModel.conversations.collectAsState()
                val loading by viewModel.isLoading.collectAsState()
                val err by viewModel.error.collectAsState()
                LaunchedEffect(err) {
                    err?.let {
                        Toast.makeText(this@ConversationsActivity, it, Toast.LENGTH_SHORT).show()
                        viewModel.error.value = null
                    }
                }
                ConversationsScreen(
                    conversations = all.filter { it.kind == "direct" },
                    loading = loading || friendsLoading.value,
                    onBack = { finish() },
                    onRefresh = { viewModel.loadConversations() },
                    onOpen = { openChat(it.id, it.otherUsername, it.otherUid) },
                    onNew = { showNewMessagePicker() },
                )
                friendPicker.value?.let { friends ->
                    FriendPickerDialog(
                        friends = friends,
                        onDismiss = { friendPicker.value = null },
                        onPick = { friend ->
                            friendPicker.value = null
                            // Conversation ID for direct messages = [uid1, uid2].sorted().joinToString("__")
                            val conversationId = listOf(viewModel.myUid(), friend.uid).sorted().joinToString("__")
                            openChat(conversationId, friend.username, friend.uid)
                        },
                    )
                }
            }
        }
        viewModel.loadConversations()
    }

    private fun openChat(id: String, username: String, uid: String) {
        val intent = Intent(this, ChatActivity::class.java).apply {
            putExtra("conversationId", id)
            putExtra("otherUsername", username)
            putExtra("otherUid", uid)
        }
        startActivity(intent)
    }

    private fun showNewMessagePicker() {
        if (friendsLoading.value) return
        friendsLoading.value = true
        lifecycleScope.launch {
            try {
                val result = Firebase.functions("europe-west1").getHttpsCallable("listMyFriendsDetailed")
                    .call().await()
                @Suppress("UNCHECKED_CAST")
                val data = result.getData() as? Map<String, Any>
                @Suppress("UNCHECKED_CAST")
                val items = data?.get("items") as? List<Map<String, Any>> ?: emptyList()
                val friends = items.map {
                    Friend(
                        uid = it["uid"] as? String ?: "",
                        username = it["username"] as? String ?: "",
                        name = it["name"] as? String ?: "User",
                        createdAtEpochMs = (it["createdAtEpochMs"] as? Number)?.toLong()
                    )
                }
                if (friends.isEmpty()) {
                    Toast.makeText(this@ConversationsActivity, getString(R.string.msg_no_friends_to_message), Toast.LENGTH_SHORT).show()
                } else {
                    friendPicker.value = friends
                }
            } catch (e: Exception) {
                Toast.makeText(this@ConversationsActivity, getString(R.string.chat_load_friends_failed, e.message ?: ""), Toast.LENGTH_SHORT).show()
            } finally {
                friendsLoading.value = false
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ConversationsScreen(
    conversations: List<Conversation>,
    loading: Boolean,
    onBack: () -> Unit,
    onRefresh: () -> Unit,
    onOpen: (Conversation) -> Unit,
    onNew: () -> Unit,
) {
    var query by rememberSaveable { mutableStateOf("") }
    val shown = remember(conversations, query) {
        val q = query.trim()
        if (q.isEmpty()) conversations
        else conversations.filter { it.otherUsername.contains(q, true) || it.lastMessageText.contains(q, true) }
    }
    val unread = conversations.count { it.unread }
    val subtitle = if (conversations.isEmpty()) null else {
        val count = pluralStringResource(R.plurals.chat_conversation_count, conversations.size, conversations.size)
        if (unread > 0) count + " · " + pluralStringResource(R.plurals.chat_unread_count, unread, unread) else count
    }

    Scaffold(
        containerColor = Radar.Bg,
        contentWindowInsets = WindowInsets(0),
        topBar = { RadarHeader(stringResource(R.string.title_conversations), subtitle, onBack) },
        floatingActionButton = {
            FloatingActionButton(
                onClick = onNew,
                containerColor = Radar.Accent,
                contentColor = Radar.OnAccent,
                shape = RoundedCornerShape(18.dp),
            ) { Icon(Icons.Filled.Edit, stringResource(R.string.title_new_message)) }
        },
    ) { pad ->
        PullToRefreshBox(
            isRefreshing = loading && conversations.isNotEmpty(),
            onRefresh = onRefresh,
            modifier = Modifier.fillMaxSize().padding(pad),
        ) {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = 14.dp, end = 14.dp, top = 12.dp, bottom = 96.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (conversations.isNotEmpty()) {
                    item(key = "search") {
                        RadarSearchField(
                            query, { query = it }, stringResource(R.string.chat_search_hint),
                            Modifier.fillMaxWidth().padding(bottom = 4.dp),
                        )
                    }
                }
                when {
                    conversations.isEmpty() && loading -> item(key = "loading") { RadarLoading() }
                    conversations.isEmpty() -> item(key = "empty") {
                        RadarEmptyState(
                            emoji = "💬",
                            title = stringResource(R.string.msg_no_conversations),
                            hint = stringResource(R.string.chat_empty_hint),
                            actionLabel = stringResource(R.string.title_new_message),
                            onAction = onNew,
                        )
                    }
                    shown.isEmpty() -> item(key = "noresults") {
                        RadarEmptyState(emoji = "🔍", title = stringResource(R.string.chat_no_results))
                    }
                    else -> items(shown, key = { it.id }) { conv -> ConversationRow(conv) { onOpen(conv) } }
                }
            }
        }
    }
}

@Composable
private fun ConversationRow(conv: Conversation, onClick: () -> Unit) {
    val context = LocalContext.current
    RadarCard(highlight = conv.unread, onClick = onClick) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            PlayerAvatar(null, conv.otherUsername, 46.dp)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        conv.otherUsername, modifier = Modifier.weight(1f),
                        color = Radar.Text, fontSize = 16.sp,
                        fontWeight = if (conv.unread) FontWeight.ExtraBold else FontWeight.Bold,
                        maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                    conv.lastMessageAtEpochMs?.let {
                        Spacer(Modifier.width(8.dp))
                        Text(
                            chatShortTime(context, it), color = if (conv.unread) Radar.Accent else Radar.TextMuted,
                            fontFamily = RadarFonts.Mono, fontSize = 12.sp, maxLines = 1,
                        )
                    }
                }
                Spacer(Modifier.height(3.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        conv.lastMessageText, modifier = Modifier.weight(1f),
                        color = if (conv.unread) Radar.Text else Radar.TextSec, fontSize = 14.sp,
                        maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                    if (conv.unread) {
                        Spacer(Modifier.width(8.dp))
                        Box(Modifier.size(10.dp).clip(CircleShape).background(Radar.Accent))
                    }
                }
            }
        }
    }
}

@Composable
private fun FriendPickerDialog(friends: List<Friend>, onDismiss: () -> Unit, onPick: (Friend) -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Radar.Surface,
        titleContentColor = Radar.Text,
        title = { Text(stringResource(R.string.title_new_message), fontWeight = FontWeight.ExtraBold) },
        text = {
            LazyColumn(Modifier.heightIn(max = 420.dp)) {
                items(friends, key = { it.uid }) { f ->
                    Row(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable { onPick(f) }
                            .padding(horizontal = 8.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        PlayerAvatar(null, f.name, 40.dp)
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(f.name, color = Radar.Text, fontWeight = FontWeight.Bold, fontSize = 15.sp,
                                maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text("@${f.username}", color = Radar.TextSec, fontSize = 13.sp,
                                maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
            }
        },
        confirmButton = {},
        dismissButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_close), color = Radar.Accent) }
        },
    )
}

/** Today → HH:mm, yesterday → localized "Yesterday", otherwise a short date. */
internal fun chatShortTime(context: android.content.Context, epochMs: Long): String = when {
    DateUtils.isToday(epochMs) -> SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(epochMs))
    DateUtils.isToday(epochMs + DateUtils.DAY_IN_MILLIS) -> context.getString(R.string.chat_yesterday)
    else -> DateUtils.formatDateTime(
        context, epochMs,
        DateUtils.FORMAT_SHOW_DATE or DateUtils.FORMAT_ABBREV_MONTH or DateUtils.FORMAT_NO_YEAR,
    )
}
