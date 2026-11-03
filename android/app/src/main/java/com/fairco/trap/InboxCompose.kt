package com.fairco.trap

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.outlined.SupportAgent
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.fairco.trap.ui.*
import com.fairco.trap.ui.theme.Radar
import com.fairco.trap.ui.theme.RadarFonts
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

// ── Message center (Inbox): Messages + Support tabs ─────────────────────────

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InboxScreen(
    initialTab: Int,
    messagingVm: MessagingViewModel,
    supportVm: SupportViewModel,
    badgeVm: InboxBadgeViewModel,
    onBack: () -> Unit,
    onOpenConversation: (Conversation) -> Unit,
    onOpenTicket: (TicketSummary) -> Unit,
    onNewMessage: () -> Unit,
    onTicketCreated: (String?) -> Unit,
) {
    var tab by rememberSaveable { mutableIntStateOf(initialTab.coerceIn(0, 1)) }
    val unreadMessages by badgeVm.unreadMessages.collectAsState()
    val unreadTickets by badgeVm.unreadTickets.collectAsState()
    var showNewTicket by rememberSaveable { mutableStateOf(false) }

    Column(Modifier.fillMaxSize().background(Radar.Bg)) {
        RadarHeader(
            title = stringResource(R.string.inbox_title),
            subtitle = stringResource(R.string.inbox_subtitle),
            onBack = onBack,
            actions = {
                if (tab == 0) {
                    HeaderActionButton(Icons.Filled.Edit, stringResource(R.string.title_new_message), onNewMessage)
                } else {
                    HeaderActionButton(Icons.Filled.Add, stringResource(R.string.inbox_new_ticket_cta)) { showNewTicket = true }
                }
            },
        )
        RadarTabs(
            labels = listOf(stringResource(R.string.inbox_tab_messages), stringResource(R.string.inbox_tab_support)),
            selected = tab,
            onSelect = { tab = it },
            badges = listOf(unreadMessages, unreadTickets),
        )
        Box(Modifier.weight(1f)) {
            when (tab) {
                0 -> MessagesTab(messagingVm, onOpenConversation, onNewMessage)
                else -> TicketsList(
                    vm = supportVm,
                    onOpenTicket = onOpenTicket,
                    onNewTicket = { showNewTicket = true },
                )
            }
        }
    }

    if (showNewTicket) {
        NewTicketSheet(
            vm = supportVm,
            onDismiss = { showNewTicket = false },
            onCreated = { no -> showNewTicket = false; onTicketCreated(no) },
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MessagesTab(
    vm: MessagingViewModel,
    onOpenConversation: (Conversation) -> Unit,
    onNewMessage: () -> Unit,
) {
    val all by vm.conversations.collectAsState()
    val loading by vm.isLoading.collectAsState()
    var query by rememberSaveable { mutableStateOf("") }
    var loadedOnce by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { vm.loadConversations() }
    LaunchedEffect(loading) { if (!loading) loadedOnce = true }

    val list = remember(all, query) {
        if (query.isBlank()) all
        else all.filter {
            it.otherUsername.contains(query, ignoreCase = true) ||
                it.supportTicketNo.contains(query, ignoreCase = true) ||
                it.lastMessageText.contains(query, ignoreCase = true)
        }
    }

    Box(Modifier.fillMaxSize()) {
        PullToRefreshBox(
            isRefreshing = loading && loadedOnce,
            onRefresh = { vm.loadConversations() },
            modifier = Modifier.fillMaxSize(),
        ) {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = 14.dp, end = 14.dp, top = 12.dp, bottom = 24.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                item(key = "search") {
                    RadarSearchField(
                        value = query,
                        onValueChange = { query = it },
                        placeholder = stringResource(R.string.inbox_search_hint),
                        modifier = Modifier.fillMaxWidth().padding(bottom = 4.dp),
                    )
                }
                when {
                    list.isEmpty() && loading && !loadedOnce -> item(key = "loading") { RadarLoading() }
                    list.isEmpty() && query.isNotBlank() -> item(key = "noresult") {
                        RadarEmptyState(emoji = "🔍", title = stringResource(R.string.inbox_no_results))
                    }
                    list.isEmpty() -> item(key = "empty") {
                        RadarEmptyState(
                            emoji = "💬",
                            title = stringResource(R.string.inbox_empty_messages),
                            hint = stringResource(R.string.inbox_empty_messages_hint),
                            actionLabel = stringResource(R.string.title_new_message),
                            onAction = onNewMessage,
                        )
                    }
                    else -> items(list, key = { it.id }) { conv ->
                        ConversationRow(conv) { onOpenConversation(conv) }
                    }
                }
            }
        }
    }
}

@Composable
private fun ConversationRow(conv: Conversation, onClick: () -> Unit) {
    val support = conv.kind == "support"
    val preview = remember(conv.lastMessageText, conv.supportTicketNo) {
        cleanPreview(conv.lastMessageText, conv.supportTicketNo)
    }
    RadarCard(highlight = conv.unread, onClick = onClick) {
        Row(verticalAlignment = Alignment.Top) {
            if (support) {
                SupportBadge()
            } else {
                PlayerAvatar(photoUrl = null, name = conv.otherUsername, size = 46.dp, ring = avatarRing(conv.otherUid))
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    if (support) stringResource(R.string.inbox_support_sender) else conv.otherUsername,
                    color = if (conv.unread) Radar.Accent else Radar.Text,
                    fontWeight = if (conv.unread) FontWeight.ExtraBold else FontWeight.SemiBold,
                    fontFamily = RadarFonts.Body, fontSize = 15.sp,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                if (support && conv.supportTicketNo.isNotBlank()) {
                    Spacer(Modifier.height(3.dp))
                    Text(
                        conv.supportTicketNo,
                        modifier = Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .background(Radar.Surface2)
                            .padding(horizontal = 6.dp, vertical = 1.dp),
                        color = Radar.TextMuted, fontFamily = RadarFonts.Mono, fontSize = 11.sp,
                        maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                }
                if (preview.isNotBlank()) {
                    Spacer(Modifier.height(4.dp))
                    Text(
                        preview,
                        color = if (conv.unread) Radar.Text else Radar.TextSec,
                        fontSize = 13.sp, lineHeight = 18.sp, maxLines = 2, overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            Spacer(Modifier.width(10.dp))
            Column(horizontalAlignment = Alignment.End) {
                conv.lastMessageAtEpochMs?.let {
                    Text(
                        listTime(it), color = if (conv.unread) Radar.Accent else Radar.TextMuted,
                        fontSize = 12.sp, fontFamily = RadarFonts.Mono, maxLines = 1,
                    )
                }
                if (conv.unread) {
                    Spacer(Modifier.height(8.dp))
                    Box(Modifier.size(10.dp).background(Radar.Accent, CircleShape))
                }
            }
        }
    }
}

@Composable
private fun HeaderActionButton(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, onClick: () -> Unit) {
    // Plain Box instead of IconButton: its 48dp minimum touch size stretched the filled circle past the edge.
    Box(
        Modifier
            .padding(end = 6.dp)
            .size(40.dp)
            .clip(CircleShape)
            .background(Radar.Accent)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { Icon(icon, label, tint = Radar.OnAccent, modifier = Modifier.size(20.dp)) }
}

@Composable
private fun SupportBadge() {
    Box(
        Modifier
            .size(46.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(Radar.Surface2)
            .border(1.dp, Radar.Accent.copy(alpha = 0.35f), RoundedCornerShape(14.dp)),
        contentAlignment = Alignment.Center,
    ) { Icon(Icons.Outlined.SupportAgent, null, tint = Radar.Accent, modifier = Modifier.size(24.dp)) }
}

/** Drops a leading "[Support TCK-…]" style tag and a bare ticket number from a preview line. */
private fun cleanPreview(text: String, ticketNo: String): String {
    var t = text.trim()
    while (t.startsWith("[")) {
        val close = t.indexOf(']')
        if (close <= 0) break
        t = t.substring(close + 1).trimStart()
    }
    if (ticketNo.isNotBlank() && t.startsWith(ticketNo)) t = t.removePrefix(ticketNo).trimStart(' ', ':', '-', '·', '—')
    return t.replace(Regex("\\s+"), " ")
}

// ── Support ticket list (Inbox tab + standalone screen) ─────────────────────

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TicketsList(
    vm: SupportViewModel,
    onOpenTicket: (TicketSummary) -> Unit,
    onNewTicket: () -> Unit,
) {
    val tickets by vm.tickets.collectAsState()
    val loading by vm.isLoading.collectAsState()
    var loadedOnce by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { vm.loadTickets() }
    LaunchedEffect(loading) { if (!loading) loadedOnce = true }

    PullToRefreshBox(
        isRefreshing = loading && loadedOnce,
        onRefresh = { vm.loadTickets() },
        modifier = Modifier.fillMaxSize(),
    ) {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 14.dp, end = 14.dp, top = 12.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            item(key = "new") { NewTicketCta(onNewTicket) }
            when {
                tickets.isEmpty() && loading && !loadedOnce -> item(key = "loading") { RadarLoading() }
                tickets.isEmpty() -> item(key = "empty") {
                    RadarEmptyState(
                        emoji = "🎫",
                        title = stringResource(R.string.msg_no_tickets),
                        hint = stringResource(R.string.inbox_support_empty_hint),
                    )
                }
                else -> {
                    item(key = "label") { RadarSectionLabel(stringResource(R.string.inbox_your_tickets)) }
                    items(tickets, key = { it.id }) { t -> TicketRow(t) { onOpenTicket(t) } }
                }
            }
        }
    }
}

@Composable
private fun NewTicketCta(onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(16.dp),
        color = Radar.AccentDeep.copy(alpha = 0.28f),
        border = BorderStroke(1.dp, Radar.Accent.copy(alpha = 0.6f)),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.size(44.dp).background(Radar.Accent, CircleShape),
                contentAlignment = Alignment.Center,
            ) { Icon(Icons.Filled.Add, null, tint = Radar.OnAccent) }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    stringResource(R.string.inbox_new_ticket_cta), color = Radar.Text,
                    fontWeight = FontWeight.ExtraBold, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                Text(
                    stringResource(R.string.inbox_new_ticket_cta_hint), color = Radar.TextSec,
                    fontSize = 12.sp, maxLines = 2, overflow = TextOverflow.Ellipsis, lineHeight = 16.sp,
                )
            }
        }
    }
}

@Composable
private fun TicketRow(t: TicketSummary, onClick: () -> Unit) {
    val category = TicketCategory.entries.find { it.value == t.category }
    val categoryLabel = category?.let { stringResource(it.labelRes) } ?: t.category
    RadarCard(highlight = t.hasUnreadUser, onClick = onClick) {
        Row(verticalAlignment = Alignment.Top) {
            EmojiBadge(categoryEmoji(category), Radar.Surface2)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        t.subject.ifBlank { "#${t.ticketNo}" },
                        modifier = Modifier.weight(1f),
                        color = if (t.hasUnreadUser) Radar.Accent else Radar.Text,
                        fontWeight = if (t.hasUnreadUser) FontWeight.ExtraBold else FontWeight.Normal,
                        fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                    (t.lastMessageAtEpochMs ?: t.createdAtEpochMs)?.let {
                        Spacer(Modifier.width(8.dp))
                        Text(listTime(it), color = Radar.TextMuted, fontSize = 12.sp, fontFamily = RadarFonts.Mono, maxLines = 1)
                    }
                }
                Spacer(Modifier.height(3.dp))
                Text(
                    "#${t.ticketNo} · ${stripLeadingEmoji(categoryLabel)}",
                    color = Radar.TextSec, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                Spacer(Modifier.height(8.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    TicketStatusChip(t.status)
                    Spacer(Modifier.weight(1f))
                    if (t.hasUnreadUser) Box(Modifier.size(9.dp).background(Radar.Accent, CircleShape))
                }
            }
        }
    }
}

@Composable
fun TicketStatusChip(status: String) {
    val (labelRes, color) = when (status) {
        "open" -> R.string.support_status_open to Radar.Accent
        "waiting_admin" -> R.string.support_status_awaiting to Radar.Accent
        "waiting_user" -> R.string.support_status_your_turn to Radar.Gold
        "answered" -> R.string.support_status_answered to Radar.Safe
        "closed" -> R.string.support_status_closed to Radar.TextMuted
        else -> null to Radar.TextMuted
    }
    val label = labelRes?.let { stringResource(it) } ?: status
    Text(
        label.uppercase(),
        modifier = Modifier
            .clip(RoundedCornerShape(8.dp))
            .background(color.copy(alpha = 0.14f))
            .border(1.dp, color.copy(alpha = 0.5f), RoundedCornerShape(8.dp))
            .padding(horizontal = 8.dp, vertical = 3.dp),
        color = color, fontFamily = RadarFonts.Label, fontWeight = FontWeight.Bold,
        fontSize = 12.sp, letterSpacing = 0.8.sp, maxLines = 1,
    )
}

/** Standalone "Support tickets" screen (opened from the map menu). */
@Composable
fun SupportTicketsScreen(
    vm: SupportViewModel,
    onBack: () -> Unit,
    onOpenTicket: (TicketSummary) -> Unit,
    onNewTicket: () -> Unit,
) {
    Column(Modifier.fillMaxSize().background(Radar.Bg)) {
        RadarHeader(title = stringResource(R.string.title_support_tickets), onBack = onBack)
        Box(Modifier.weight(1f)) { TicketsList(vm, onOpenTicket, onNewTicket) }
    }
}

// ── New ticket form (bottom sheet + full screen) ────────────────────────────

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NewTicketSheet(
    vm: SupportViewModel,
    onDismiss: () -> Unit,
    onCreated: (ticketNo: String?) -> Unit,
) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = Radar.Surface,
        contentColor = Radar.Text,
        dragHandle = { BottomSheetDefaults.DragHandle(color = Radar.Line) },
    ) {
        Column(Modifier.padding(horizontal = 18.dp).padding(bottom = 24.dp).imePadding()) {
            Text(
                stringResource(R.string.inbox_new_ticket_title), color = Radar.Text,
                fontWeight = FontWeight.ExtraBold, fontSize = 19.sp,
            )
            Spacer(Modifier.height(14.dp))
            TicketForm(vm = vm, initialSubject = "", initialMessage = "", onCreated = { no, _ -> onCreated(no) })
        }
    }
}

@Composable
fun CreateTicketScreen(
    vm: SupportViewModel,
    initialSubject: String,
    initialMessage: String,
    onClose: () -> Unit,
    onCreated: (ticketNo: String?, msg: String) -> Unit,
) {
    Column(Modifier.fillMaxSize().background(Radar.Bg)) {
        RadarHeader(
            title = stringResource(R.string.title_create_ticket),
            subtitle = stringResource(R.string.inbox_new_ticket_title),
            actions = {
                IconButton(onClick = onClose) {
                    Icon(Icons.Filled.Close, stringResource(R.string.action_close), tint = Radar.Text)
                }
            },
        )
        Column(
            Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
        ) {
            TicketForm(vm = vm, initialSubject = initialSubject, initialMessage = initialMessage, onCreated = onCreated)
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TicketForm(
    vm: SupportViewModel,
    initialSubject: String,
    initialMessage: String,
    onCreated: (ticketNo: String?, msg: String) -> Unit,
) {
    val context = LocalContext.current
    val loading by vm.isLoading.collectAsState()
    var category by rememberSaveable { mutableStateOf(TicketCategory.GENERAL.value) }
    var subject by rememberSaveable { mutableStateOf(initialSubject) }
    var message by rememberSaveable { mutableStateOf(initialMessage) }
    var sending by remember { mutableStateOf(false) }

    RadarSectionLabel(stringResource(R.string.inbox_ticket_category))
    Spacer(Modifier.height(6.dp))
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        TicketCategory.entries.forEach { c ->
            val on = c.value == category
            Text(
                stringResource(c.labelRes),
                modifier = Modifier
                    .clip(RoundedCornerShape(12.dp))
                    .background(if (on) Radar.Accent.copy(alpha = 0.16f) else Radar.Bg)
                    .border(1.dp, if (on) Radar.Accent else Radar.Line, RoundedCornerShape(12.dp))
                    .clickable { category = c.value }
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                color = if (on) Radar.Accent else Radar.TextSec,
                fontSize = 13.sp, fontWeight = if (on) FontWeight.ExtraBold else FontWeight.Normal, maxLines = 1,
            )
        }
    }
    Spacer(Modifier.height(16.dp))
    RadarTextField(subject, { subject = it }, stringResource(R.string.hint_subject), singleLine = true)
    Spacer(Modifier.height(10.dp))
    RadarTextField(
        message, { message = it }, stringResource(R.string.inbox_ticket_message_hint),
        singleLine = false, minLines = 5,
    )
    Spacer(Modifier.height(18.dp))
    RadarPrimaryButton(
        label = stringResource(R.string.inbox_ticket_send),
        enabled = !loading && !sending && subject.isNotBlank() && message.isNotBlank(),
        modifier = Modifier.fillMaxWidth(),
        onClick = {
            sending = true
            vm.createTicket(subject, message, category) { success, msg, ticketNo ->
                sending = false
                if (success) onCreated(ticketNo, msg)
                else android.widget.Toast.makeText(context, msg, android.widget.Toast.LENGTH_SHORT).show()
            }
        },
    )
}

@Composable
private fun RadarTextField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    singleLine: Boolean,
    minLines: Int = 1,
    modifier: Modifier = Modifier,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        placeholder = { Text(placeholder, color = Radar.TextMuted) },
        singleLine = singleLine,
        minLines = minLines,
        shape = RoundedCornerShape(14.dp),
        modifier = modifier.fillMaxWidth(),
        colors = radarFieldColors(),
    )
}

@Composable
private fun radarFieldColors() = OutlinedTextFieldDefaults.colors(
    focusedTextColor = Radar.Text,
    unfocusedTextColor = Radar.Text,
    focusedContainerColor = Radar.Bg,
    unfocusedContainerColor = Radar.Bg,
    focusedBorderColor = Radar.Accent,
    unfocusedBorderColor = Radar.Line,
    cursorColor = Radar.Accent,
)

// ── Support ticket thread ───────────────────────────────────────────────────

@Composable
fun SupportThreadScreen(
    ticketNo: String,
    vm: SupportViewModel,
    onBack: () -> Unit,
    onSend: (String) -> Unit,
    onNewTicket: () -> Unit,
) {
    val messages by vm.threadMessages.collectAsState()
    val ticket by vm.currentTicket.collectAsState()
    val loading by vm.isLoading.collectAsState()
    val status = ticket?.get("status") as? String ?: "open"
    val subject = ticket?.get("subject") as? String ?: ""
    val number = (ticket?.get("ticketNo") as? String)?.ifBlank { null } ?: ticketNo
    val closed = status == "closed"

    val listState = rememberLazyListState()
    val snackbar = remember { SnackbarHostState() }
    val newReplyText = stringResource(R.string.support_new_reply)
    var previousCount by remember { mutableIntStateOf(0) }
    LaunchedEffect(messages.size) {
        val n = messages.size
        if (n > 0) listState.animateScrollToItem(n - 1)
        val incoming = messages.lastOrNull()?.senderType == "admin"
        if (n > previousCount && previousCount > 0 && incoming) snackbar.showSnackbar(newReplyText)
        previousCount = n
    }

    Box(Modifier.fillMaxSize().background(Radar.Bg)) {
        Column(Modifier.fillMaxSize()) {
            RadarHeader(
                title = stringResource(R.string.support_ticket_title, number),
                subtitle = subject.ifBlank { null },
                onBack = onBack,
            )
            ThreadStatusBar(status)
            Box(Modifier.weight(1f)) {
                if (messages.isEmpty() && loading) {
                    RadarLoading(Modifier.align(Alignment.Center))
                } else {
                    LazyColumn(
                        state = listState,
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 12.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        items(messages, key = { it.id }) { m -> TicketBubble(m) }
                    }
                }
            }
            if (closed) {
                ClosedBar(onNewTicket)
            } else {
                ReplyBar(onSend)
            }
        }
        SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).padding(bottom = 80.dp)) { data ->
            Snackbar(data, containerColor = Radar.Surface2, contentColor = Radar.Text)
        }
    }
}

@Composable
private fun ThreadStatusBar(status: String) {
    Column(
        Modifier
            .fillMaxWidth()
            .background(Radar.Surface)
            .padding(horizontal = 16.dp)
            .padding(bottom = 10.dp),
    ) {
        TicketStatusChip(status)
        if (status == "waiting_user") {
            Spacer(Modifier.height(8.dp))
            Text(
                stringResource(R.string.support_waiting_for_you),
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(10.dp))
                    .background(Radar.Gold.copy(alpha = 0.14f))
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                color = Radar.Gold, fontSize = 13.sp, fontWeight = FontWeight.ExtraBold,
            )
        }
    }
    HorizontalDivider(color = Radar.Line)
}

@Composable
private fun TicketBubble(m: TicketMessage) {
    val admin = m.senderType == "admin"
    val shape = if (admin) RoundedCornerShape(4.dp, 18.dp, 18.dp, 18.dp) else RoundedCornerShape(18.dp, 4.dp, 18.dp, 18.dp)
    Row(Modifier.fillMaxWidth(), horizontalArrangement = if (admin) Arrangement.Start else Arrangement.End) {
        if (!admin) Spacer(Modifier.width(48.dp))
        Column(
            Modifier
                .weight(1f, fill = false)
                .clip(shape)
                .background(if (admin) Radar.Surface2 else Radar.AccentDeep)
                .then(if (admin) Modifier.border(1.dp, Radar.Line, shape) else Modifier)
                .padding(horizontal = 12.dp, vertical = 8.dp),
        ) {
            if (admin) {
                Text(
                    stringResource(R.string.support_sender_admin, m.senderName), color = Radar.Accent,
                    fontSize = 12.sp, fontWeight = FontWeight.ExtraBold, maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                Spacer(Modifier.height(2.dp))
            }
            Text(m.text, color = if (admin) Radar.Text else Color.White, fontSize = 15.sp, lineHeight = 21.sp)
            m.createdAtEpochMs?.let {
                Spacer(Modifier.height(3.dp))
                Text(
                    bubbleTime(it), modifier = Modifier.align(Alignment.End),
                    color = if (admin) Radar.TextMuted else Color.White.copy(alpha = 0.7f),
                    fontSize = 11.sp, fontFamily = RadarFonts.Mono,
                )
            }
        }
        if (admin) Spacer(Modifier.width(48.dp))
    }
}

@Composable
private fun ReplyBar(onSend: (String) -> Unit) {
    var text by rememberSaveable { mutableStateOf("") }
    Row(
        Modifier
            .fillMaxWidth()
            .background(Radar.Surface)
            .padding(horizontal = 10.dp, vertical = 8.dp),
        verticalAlignment = Alignment.Bottom,
    ) {
        OutlinedTextField(
            value = text,
            onValueChange = { text = it },
            placeholder = { Text(stringResource(R.string.hint_type_reply), color = Radar.TextMuted) },
            maxLines = 5,
            shape = RoundedCornerShape(22.dp),
            colors = radarFieldColors(),
            modifier = Modifier.weight(1f),
        )
        Spacer(Modifier.width(8.dp))
        val canSend = text.isNotBlank()
        IconButton(
            onClick = { onSend(text.trim()); text = "" },
            enabled = canSend,
            modifier = Modifier
                .padding(bottom = 4.dp)
                .size(48.dp)
                .background(if (canSend) Radar.Accent else Radar.Surface2, CircleShape),
        ) {
            Icon(
                Icons.AutoMirrored.Filled.Send, stringResource(R.string.action_send),
                tint = if (canSend) Radar.OnAccent else Radar.TextMuted,
            )
        }
    }
}

@Composable
private fun ClosedBar(onNewTicket: () -> Unit) {
    Column(
        Modifier.fillMaxWidth().background(Radar.Surface).padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            stringResource(R.string.inbox_ticket_closed), color = Radar.TextSec, fontSize = 13.sp,
            lineHeight = 18.sp, textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )
        Spacer(Modifier.height(10.dp))
        RadarPrimaryButton(stringResource(R.string.inbox_new_ticket_cta), onNewTicket)
    }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

@Composable
private fun EmojiBadge(emoji: String, bg: Color) {
    Box(
        Modifier.size(46.dp).background(bg, CircleShape).border(1.dp, Radar.Line, CircleShape),
        contentAlignment = Alignment.Center,
    ) { Text(emoji, fontSize = 20.sp) }
}

private val AVATAR_RINGS = listOf(
    Color(0xFF38D3F2), Color(0xFFFFB648), Color(0xFF3EE08F), Color(0xFFFF8A97),
    Color(0xFF8B9CFF), Color(0xFFC77DFF), Color(0xFF5EEAD4),
)

private fun avatarRing(uid: String): Color = AVATAR_RINGS[Math.floorMod(uid.hashCode(), AVATAR_RINGS.size)]

private fun categoryEmoji(c: TicketCategory?): String = when (c) {
    TicketCategory.BUG_REPORT -> "🐛"
    TicketCategory.ACCOUNT -> "👤"
    TicketCategory.EMAIL_CHANGE -> "✉️"
    TicketCategory.BILLING -> "💳"
    TicketCategory.GENERAL -> "💬"
    null -> "🎫"
}

/** Category labels start with an emoji ("🐛 Bug Report"); the row already shows it in the badge. */
private fun stripLeadingEmoji(s: String): String {
    val i = s.indexOf(' ')
    return if (i in 1..3 && !s[0].isLetterOrDigit()) s.substring(i + 1) else s
}

@Composable
private fun appLocale(): Locale = LocalConfiguration.current.locales[0] ?: Locale.getDefault()

/** Today → time, this year → "Apr 14", older → full date; locale-aware. */
@Composable
private fun listTime(epochMs: Long): String {
    val locale = appLocale()
    val now = java.util.Calendar.getInstance()
    val then = java.util.Calendar.getInstance().apply { timeInMillis = epochMs }
    val sameYear = now.get(java.util.Calendar.YEAR) == then.get(java.util.Calendar.YEAR)
    val skeleton = when {
        sameYear && now.get(java.util.Calendar.DAY_OF_YEAR) == then.get(java.util.Calendar.DAY_OF_YEAR) -> "Hm"
        sameYear -> "MMMd"
        else -> "yMMMd"
    }
    return SimpleDateFormat(android.text.format.DateFormat.getBestDateTimePattern(locale, skeleton), locale).format(Date(epochMs))
}

@Composable
private fun bubbleTime(epochMs: Long): String {
    val locale = appLocale()
    val sameDay = System.currentTimeMillis() - epochMs < 24 * 3_600_000L &&
        SimpleDateFormat("yyyyMMdd", locale).let { it.format(Date()) == it.format(Date(epochMs)) }
    val skeleton = if (sameDay) "Hm" else "dMMMHm"
    return SimpleDateFormat(android.text.format.DateFormat.getBestDateTimePattern(locale, skeleton), locale).format(Date(epochMs))
}
