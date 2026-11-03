package com.fairco.trap

import android.os.Bundle
import android.text.format.DateUtils
import android.widget.Toast
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.lifecycleScope
import com.fairco.trap.ui.*
import com.fairco.trap.ui.theme.Radar
import com.fairco.trap.ui.theme.RadarFonts
import com.fairco.trap.ui.theme.TrappTheme
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.*

class ChatActivity : BaseActivity() {

    override val radarBars = true
    private val viewModel: MessagingViewModel by viewModels()
    private lateinit var conversationId: String
    private lateinit var otherUid: String
    private lateinit var otherUsername: String

    private var refreshJob: Job? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        conversationId = intent.getStringExtra("conversationId") ?: ""
        otherUid = intent.getStringExtra("otherUid") ?: ""
        otherUsername = intent.getStringExtra("otherUsername") ?: getString(R.string.chat_title_fallback)

        setContent {
            TrappTheme {
                val messages by viewModel.messages.collectAsState()
                val loading by viewModel.isLoading.collectAsState()
                val err by viewModel.error.collectAsState()
                LaunchedEffect(err) {
                    err?.let {
                        Toast.makeText(this@ChatActivity, it, Toast.LENGTH_SHORT).show()
                        viewModel.error.value = null
                    }
                }
                ChatScreen(
                    otherName = otherUsername,
                    myUid = viewModel.myUid(),
                    messages = messages,
                    loading = loading && messages.isEmpty(),
                    onBack = { finish() },
                    onSend = ::sendMessage,
                )
            }
        }
    }

    override fun onStart() {
        super.onStart()
        refreshJob = lifecycleScope.launch {
            while (true) {
                viewModel.openConversation(conversationId)
                delay(20_000)
            }
        }
    }

    override fun onStop() {
        super.onStop()
        refreshJob?.cancel()
    }

    private fun sendMessage(raw: String) {
        val text = raw.trim()
        if (text.isBlank()) return

        // Optimistic update
        val tempMsg = ChatMessage(
            id = "temp_${System.currentTimeMillis()}",
            senderUid = viewModel.myUid(),
            senderUsername = "Me",
            text = text,
            createdAtEpochMs = System.currentTimeMillis()
        )
        viewModel.messages.value = viewModel.messages.value + tempMsg

        viewModel.sendMessage(otherUid, text) {
            viewModel.openConversation(conversationId)
        }
    }
}

@Composable
private fun ChatScreen(
    otherName: String,
    myUid: String,
    messages: List<ChatMessage>,
    loading: Boolean,
    onBack: () -> Unit,
    onSend: (String) -> Unit,
) {
    val listState = rememberLazyListState()
    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) listState.animateScrollToItem(messages.lastIndex)
    }

    Column(Modifier.fillMaxSize().background(Radar.Bg).imePadding()) {
        RadarHeader(otherName, stringResource(R.string.chat_direct_subtitle), onBack) {
            PlayerAvatar(null, otherName, 38.dp)
            Spacer(Modifier.width(6.dp))
        }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            when {
                loading -> RadarLoading(Modifier.align(Alignment.Center))
                messages.isEmpty() -> RadarEmptyState(
                    emoji = "👋",
                    title = stringResource(R.string.chat_thread_empty, otherName),
                    hint = stringResource(R.string.chat_thread_empty_hint),
                    modifier = Modifier.align(Alignment.Center),
                )
                else -> LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    itemsIndexed(messages, key = { i, m -> m.id.ifEmpty { "i$i" } }) { i, msg ->
                        val prev = messages.getOrNull(i - 1)
                        if (msg.createdAtEpochMs != null &&
                            (prev?.createdAtEpochMs == null || !sameDay(prev.createdAtEpochMs, msg.createdAtEpochMs))
                        ) {
                            DaySeparator(msg.createdAtEpochMs)
                        }
                        val mine = msg.senderUid == myUid
                        val groupedWithPrev = prev != null && prev.senderUid == msg.senderUid
                        if (!groupedWithPrev) Spacer(Modifier.height(6.dp))
                        MessageBubble(msg, mine)
                    }
                }
            }
        }
        ChatInputBar(onSend)
    }
}

@Composable
private fun DaySeparator(epochMs: Long) {
    val context = LocalContext.current
    val label = when {
        DateUtils.isToday(epochMs) -> stringResource(R.string.chat_today)
        DateUtils.isToday(epochMs + DateUtils.DAY_IN_MILLIS) -> stringResource(R.string.chat_yesterday)
        else -> DateUtils.formatDateTime(context, epochMs, DateUtils.FORMAT_SHOW_DATE or DateUtils.FORMAT_ABBREV_MONTH)
    }
    Box(Modifier.fillMaxWidth().padding(vertical = 10.dp), contentAlignment = Alignment.Center) {
        Text(
            label.uppercase(),
            modifier = Modifier.clip(RoundedCornerShape(10.dp)).background(Radar.Surface)
                .border(1.dp, Radar.Line, RoundedCornerShape(10.dp)).padding(horizontal = 12.dp, vertical = 4.dp),
            color = Radar.TextMuted, fontFamily = RadarFonts.Label, fontWeight = FontWeight.Bold,
            fontSize = 12.sp, letterSpacing = 1.sp,
        )
    }
}

@Composable
private fun MessageBubble(msg: ChatMessage, mine: Boolean) {
    val pending = msg.id.startsWith("temp_")
    val shape = if (mine) RoundedCornerShape(18.dp, 18.dp, 4.dp, 18.dp) else RoundedCornerShape(18.dp, 18.dp, 18.dp, 4.dp)
    Row(Modifier.fillMaxWidth(), horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start) {
        Column(
            Modifier
                .widthIn(max = 300.dp)
                .padding(start = if (mine) 48.dp else 0.dp, end = if (mine) 0.dp else 48.dp)
                .clip(shape)
                .background(if (mine) Radar.AccentDeep else Radar.Surface2)
                .then(if (mine) Modifier else Modifier.border(1.dp, Radar.Line, shape))
                .padding(start = 14.dp, end = 14.dp, top = 9.dp, bottom = 7.dp),
            horizontalAlignment = Alignment.End,
        ) {
            Text(msg.text, color = Radar.Text, fontSize = 15.sp, lineHeight = 21.sp)
            Spacer(Modifier.height(2.dp))
            Text(
                when {
                    pending -> stringResource(R.string.chat_sending)
                    msg.createdAtEpochMs != null -> SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(msg.createdAtEpochMs))
                    else -> ""
                },
                color = if (mine) Radar.Text.copy(alpha = 0.6f) else Radar.TextMuted,
                fontFamily = RadarFonts.Mono, fontSize = 11.sp,
            )
        }
    }
}

@Composable
private fun ChatInputBar(onSend: (String) -> Unit) {
    var text by rememberSaveable { mutableStateOf("") }
    val canSend = text.isNotBlank()
    Row(
        Modifier.fillMaxWidth().background(Radar.Surface).padding(horizontal = 10.dp, vertical = 8.dp),
        verticalAlignment = Alignment.Bottom,
    ) {
        Box(
            Modifier
                .weight(1f)
                .heightIn(min = 48.dp)
                .clip(RoundedCornerShape(24.dp))
                .background(Radar.Bg)
                .border(1.dp, Radar.Line, RoundedCornerShape(24.dp))
                .padding(horizontal = 16.dp, vertical = 12.dp),
            contentAlignment = Alignment.CenterStart,
        ) {
            if (text.isEmpty()) Text(stringResource(R.string.hint_type_message), color = Radar.TextMuted, fontSize = 15.sp, maxLines = 1)
            BasicTextField(
                value = text,
                onValueChange = { text = it },
                maxLines = 5,
                textStyle = TextStyle(color = Radar.Text, fontSize = 15.sp, fontFamily = RadarFonts.Body),
                cursorBrush = SolidColor(Radar.Accent),
                modifier = Modifier.fillMaxWidth(),
            )
        }
        Spacer(Modifier.width(8.dp))
        FilledIconButton(
            onClick = { onSend(text); text = "" },
            enabled = canSend,
            modifier = Modifier.size(48.dp),
            shape = CircleShape,
            colors = IconButtonDefaults.filledIconButtonColors(
                containerColor = Radar.Accent, contentColor = Radar.OnAccent,
                disabledContainerColor = Radar.Surface2, disabledContentColor = Radar.TextMuted,
            ),
        ) { Icon(Icons.AutoMirrored.Filled.Send, stringResource(R.string.action_send)) }
    }
}

private fun sameDay(a: Long, b: Long): Boolean {
    val ca = Calendar.getInstance().apply { timeInMillis = a }
    val cb = Calendar.getInstance().apply { timeInMillis = b }
    return ca.get(Calendar.YEAR) == cb.get(Calendar.YEAR) && ca.get(Calendar.DAY_OF_YEAR) == cb.get(Calendar.DAY_OF_YEAR)
}
