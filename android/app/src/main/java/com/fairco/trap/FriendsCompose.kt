package com.fairco.trap

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.rememberNestedScrollInteropConnection
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.fairco.trap.ui.*
import com.fairco.trap.ui.theme.Radar
import com.fairco.trap.ui.theme.RadarFonts
import java.text.DateFormat
import java.util.Date

/*
 * Radar UI for Friends (FriendsActivity), the friend picker (FriendsBottomSheet)
 * and the invite screen (InviteFriendsActivity). All logic stays in the view models;
 * the host activities only supply navigation, toasts and share intents.
 */

private const val TAB_FRIENDS = 0
private const val TAB_REQUESTS = 1
private const val TAB_SEARCH = 2

// ── Friends screen ───────────────────────────────────────────────────────────

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FriendsScreen(
    vm: FriendsViewModel,
    onBack: () -> Unit,
    onInvite: () -> Unit,
    onMessage: (Friend) -> Unit,
    toast: (String) -> Unit,
) {
    val friends by vm.friends.collectAsState()
    val incoming by vm.incomingRequests.collectAsState()
    val outgoing by vm.outgoingRequests.collectAsState()
    val loading by vm.isLoading.collectAsState()
    val error by vm.error.collectAsState()

    var tab by rememberSaveable { mutableIntStateOf(TAB_FRIENDS) }
    var query by rememberSaveable { mutableStateOf("") }
    var byId by rememberSaveable { mutableStateOf(false) }
    var refreshing by remember { mutableStateOf(false) }
    var removeTarget by remember { mutableStateOf<Friend?>(null) }

    fun refresh(t: Int) {
        when (t) {
            TAB_FRIENDS -> vm.loadFriends()
            TAB_REQUESTS -> vm.loadFriendRequests()
            else -> {
                vm.loadFriendRequests()
                if (!byId && query.length >= 2) vm.searchUsers(query)
            }
        }
    }

    LaunchedEffect(Unit) {
        vm.loadFriends()
        vm.loadFriendRequests()
    }
    LaunchedEffect(loading) { if (!loading) refreshing = false }
    LaunchedEffect(error) {
        error?.let { toast(it); vm.error.value = null }
    }

    Column(Modifier.fillMaxSize().background(Radar.Bg)) {
        RadarHeader(
            title = stringResource(R.string.title_friends),
            subtitle = pluralStringResource(R.plurals.friends_count, friends.size, friends.size),
            onBack = onBack,
        ) {
            IconButton(onClick = onInvite) {
                Icon(Icons.Outlined.PersonAddAlt, stringResource(R.string.invite_title), tint = Radar.Accent)
            }
        }
        RadarTabs(
            labels = listOf(
                stringResource(R.string.tab_friends),
                stringResource(R.string.friends_tab_requests),
                stringResource(R.string.friends_tab_search),
            ),
            selected = tab,
            onSelect = { tab = it; refresh(it) },
            badges = listOf(0, incoming.size, 0),
        )
        PullToRefreshBox(
            isRefreshing = refreshing && loading,
            onRefresh = { refreshing = true; refresh(tab) },
            modifier = Modifier.fillMaxSize(),
        ) {
            when (tab) {
                TAB_FRIENDS -> FriendsTab(
                    friends = friends, loading = loading, onInvite = onInvite,
                    onMessage = onMessage, onRemove = { removeTarget = it },
                )
                TAB_REQUESTS -> RequestsTab(
                    incoming = incoming, outgoing = outgoing, loading = loading,
                    onAccept = { vm.respondToRequest(it.id, true) },
                    onDecline = { vm.respondToRequest(it.id, false) },
                )
                else -> SearchTab(
                    vm = vm, query = query, byId = byId, friends = friends,
                    incoming = incoming, outgoing = outgoing, loading = loading, toast = toast,
                    onQuery = { q ->
                        query = q
                        if (byId) vm.clearIdentifierResult()
                        else if (q.length >= 2) vm.searchUsers(q)
                        else vm.searchResults.value = emptyList()
                    },
                    onMode = { id ->
                        byId = id
                        query = ""
                        vm.searchResults.value = emptyList()
                        vm.clearIdentifierResult()
                    },
                )
            }
        }
    }

    removeTarget?.let { f ->
        AlertDialog(
            onDismissRequest = { removeTarget = null },
            containerColor = Radar.Surface,
            titleContentColor = Radar.Text,
            textContentColor = Radar.TextSec,
            title = { Text(stringResource(R.string.title_remove_friend)) },
            text = { Text(stringResource(R.string.msg_confirm_remove_friend, "${f.name} (@${f.username})")) },
            confirmButton = {
                TextButton(onClick = { vm.removeFriend(f.uid); removeTarget = null }) {
                    Text(stringResource(R.string.action_remove), color = Radar.Trap, fontWeight = FontWeight.Bold)
                }
            },
            dismissButton = {
                TextButton(onClick = { removeTarget = null }) {
                    Text(stringResource(R.string.action_cancel), color = Radar.TextSec)
                }
            },
        )
    }
}

@Composable
private fun FriendsTab(
    friends: List<Friend>,
    loading: Boolean,
    onInvite: () -> Unit,
    onMessage: (Friend) -> Unit,
    onRemove: (Friend) -> Unit,
) {
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item { InviteCard(onInvite) }
        when {
            friends.isEmpty() && loading -> item { RadarLoading() }
            friends.isEmpty() -> item {
                RadarEmptyState(
                    emoji = "👥",
                    title = stringResource(R.string.msg_no_friends_found),
                    hint = stringResource(R.string.friends_empty_hint),
                )
            }
            else -> {
                item {
                    RadarSectionLabel(pluralStringResource(R.plurals.friends_count, friends.size, friends.size))
                }
                items(friends, key = { it.uid }) { f ->
                    PersonRow(
                        name = f.name.ifBlank { f.username },
                        handle = f.username,
                        detail = f.createdAtEpochMs?.let {
                            stringResource(R.string.friends_since, DateFormat.getDateInstance(DateFormat.MEDIUM).format(Date(it)))
                        },
                        onClick = { onMessage(f) },
                    ) {
                        RowIconButton(Icons.Outlined.ChatBubbleOutline, stringResource(R.string.friends_action_message), Radar.Accent) { onMessage(f) }
                        RowIconButton(Icons.Outlined.PersonRemove, stringResource(R.string.action_remove), Radar.TrapSoft) { onRemove(f) }
                    }
                }
            }
        }
    }
}

@Composable
private fun InviteCard(onInvite: () -> Unit) {
    RadarCard(highlight = true, onClick = onInvite) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.size(44.dp).background(Radar.Surface2, CircleShape),
                contentAlignment = Alignment.Center,
            ) { Text("🪤", fontSize = 22.sp) }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    stringResource(R.string.friends_invite_title), color = Radar.Text, fontWeight = FontWeight.Bold,
                    fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                Text(
                    stringResource(R.string.friends_invite_hint), color = Radar.TextSec, fontSize = 13.sp,
                    maxLines = 2, overflow = TextOverflow.Ellipsis,
                )
            }
            Icon(Icons.Outlined.ChevronRight, null, tint = Radar.TextMuted)
        }
    }
}

@Composable
private fun RequestsTab(
    incoming: List<FriendRequest>,
    outgoing: List<FriendRequest>,
    loading: Boolean,
    onAccept: (FriendRequest) -> Unit,
    onDecline: (FriendRequest) -> Unit,
) {
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        if (incoming.isEmpty() && outgoing.isEmpty()) {
            item {
                if (loading) RadarLoading()
                else RadarEmptyState(
                    emoji = "📭",
                    title = stringResource(R.string.msg_no_pending_requests),
                    hint = stringResource(R.string.friends_requests_empty_hint),
                )
            }
            return@LazyColumn
        }
        if (incoming.isNotEmpty()) {
            item { RadarSectionLabel(stringResource(R.string.label_incoming)) }
            items(incoming, key = { "in_" + it.id }) { r ->
                PersonRow(
                    name = r.fromName.ifBlank { r.fromUsername },
                    handle = r.fromUsername,
                    detail = stringResource(R.string.friends_request_incoming),
                    highlight = true,
                ) {
                    RowPill(stringResource(R.string.action_accept_request), Radar.Safe) { onAccept(r) }
                    RowIconButton(Icons.Outlined.Close, stringResource(R.string.action_decline), Radar.TrapSoft) { onDecline(r) }
                }
            }
        }
        if (outgoing.isNotEmpty()) {
            item { RadarSectionLabel(stringResource(R.string.label_outgoing)) }
            items(outgoing, key = { "out_" + it.id }) { r ->
                PersonRow(name = r.toName.ifBlank { r.toUsername }, handle = r.toUsername) {
                    RowPill(stringResource(R.string.action_pending), Radar.Surface2, enabled = false) {}
                }
            }
        }
    }
}

@Composable
private fun SearchTab(
    vm: FriendsViewModel,
    query: String,
    byId: Boolean,
    friends: List<Friend>,
    incoming: List<FriendRequest>,
    outgoing: List<FriendRequest>,
    loading: Boolean,
    toast: (String) -> Unit,
    onQuery: (String) -> Unit,
    onMode: (Boolean) -> Unit,
) {
    val results by vm.searchResults.collectAsState()
    val idState by vm.identifierResult.collectAsState()
    val requestIdMissing = stringResource(R.string.msg_request_id_not_found)

    LaunchedEffect(idState) {
        (idState as? IdentifierSearchState.Error)?.let { toast(it.message) }
    }

    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            ModeToggle(
                left = stringResource(R.string.friends_mode_username),
                right = stringResource(R.string.friends_mode_id),
                rightSelected = byId,
                onSelect = onMode,
            )
        }
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                RadarSearchField(
                    value = query,
                    onValueChange = onQuery,
                    placeholder = stringResource(
                        if (byId) R.string.friends_hint_search_id else R.string.friends_hint_search_username
                    ),
                    modifier = Modifier.weight(1f),
                )
                if (byId) {
                    Spacer(Modifier.width(8.dp))
                    RadarPrimaryButton(
                        stringResource(R.string.friends_action_find),
                        onClick = { vm.searchByIdentifier(query.trim()) },
                        enabled = query.isNotBlank() && idState !is IdentifierSearchState.Loading,
                    )
                }
            }
        }

        if (!byId) {
            when {
                query.length < 2 -> item {
                    RadarEmptyState("🔎", stringResource(R.string.friends_search_title), stringResource(R.string.friends_search_hint))
                }
                results.isEmpty() && loading -> item { RadarLoading() }
                results.isEmpty() -> item {
                    RadarEmptyState("🤷", stringResource(R.string.msg_no_users_found))
                }
                else -> items(results, key = { it.uid }) { u ->
                    val isFriend = friends.any { it.uid == u.uid }
                    val sent = outgoing.any { it.toUid == u.uid }
                    PersonRow(name = u.name.ifBlank { u.username }, handle = u.username) {
                        when {
                            isFriend -> RowPill(stringResource(R.string.label_friends_confirmed), Radar.Surface2, enabled = false) {}
                            sent -> RowPill(stringResource(R.string.label_request_sent), Radar.Surface2, enabled = false) {}
                            else -> RowPill(stringResource(R.string.action_add_friend_short), Radar.Accent) {
                                vm.sendFriendRequest(u.username) { _, msg -> toast(msg) }
                            }
                        }
                    }
                }
            }
        } else {
            item {
                when (val s = idState) {
                    IdentifierSearchState.Idle, is IdentifierSearchState.Error ->
                        RadarEmptyState("🆔", stringResource(R.string.friends_search_title), stringResource(R.string.friends_id_search_hint))
                    IdentifierSearchState.Loading -> RadarLoading()
                    is IdentifierSearchState.NotFound -> RadarEmptyState(
                        "🤷",
                        stringResource(if (s.reason == "self") R.string.msg_own_account else R.string.msg_user_not_found_id),
                    )
                    is IdentifierSearchState.Found -> PersonRow(
                        name = s.name.ifBlank { s.username },
                        handle = s.username,
                        detail = stringResource(R.string.friends_id_label, s.uid),
                        highlight = true,
                    ) {
                        when (s.friendshipStatus) {
                            "outgoing_pending" -> RowPill(stringResource(R.string.label_request_sent), Radar.Surface2, enabled = false) {}
                            "friends" -> RowPill(stringResource(R.string.label_friends_confirmed), Radar.Surface2, enabled = false) {}
                            "incoming_pending" -> RowPill(stringResource(R.string.label_accept_request), Radar.Safe) {
                                val reqId = incoming.find { it.fromUid == s.uid }?.id
                                if (reqId != null) vm.respondToFriendRequestDetailed(reqId, "accept")
                                else toast(requestIdMissing)
                            }
                            else -> RowPill(stringResource(R.string.action_add_friend_short), Radar.Accent) {
                                vm.sendFriendRequestByUid(s.uid)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ModeToggle(left: String, right: String, rightSelected: Boolean, onSelect: (Boolean) -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(Radar.Surface)
            .border(1.dp, Radar.Line, RoundedCornerShape(12.dp))
            .padding(3.dp),
        horizontalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        listOf(left to false, right to true).forEach { (label, value) ->
            val on = value == rightSelected
            Text(
                label,
                modifier = Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(9.dp))
                    .background(if (on) Radar.Surface2 else Color.Transparent)
                    .clickable { onSelect(value) }
                    .padding(vertical = 9.dp, horizontal = 6.dp),
                color = if (on) Radar.Accent else Radar.TextSec,
                fontSize = 13.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

// ── Shared row pieces ────────────────────────────────────────────────────────

/** Avatar + name/handle/detail column + trailing compact actions; text never overlaps the actions. */
@Composable
private fun PersonRow(
    name: String,
    handle: String,
    detail: String? = null,
    highlight: Boolean = false,
    onClick: (() -> Unit)? = null,
    actions: @Composable RowScope.() -> Unit = {},
) {
    RadarCard(highlight = highlight, onClick = onClick) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            PlayerAvatar(null, name, 44.dp)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    name, color = Radar.Text, fontWeight = FontWeight.Bold, fontSize = 15.sp,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                if (handle.isNotBlank()) {
                    Text(
                        "@$handle", color = Radar.TextSec, fontSize = 13.sp,
                        maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                }
                if (!detail.isNullOrBlank()) {
                    Text(
                        detail, color = Radar.TextMuted, fontSize = 12.sp,
                        maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            Spacer(Modifier.width(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically, content = actions)
        }
    }
}

@Composable
private fun RowIconButton(icon: ImageVector, description: String, tint: Color, onClick: () -> Unit) {
    Box(
        Modifier
            .size(40.dp)
            .clip(CircleShape)
            .background(Radar.Surface2)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { Icon(icon, description, tint = tint, modifier = Modifier.size(20.dp)) }
}

@Composable
private fun RowPill(label: String, color: Color, enabled: Boolean = true, onClick: () -> Unit) {
    Text(
        label.uppercase(),
        modifier = Modifier
            .widthIn(max = 140.dp)
            .clip(RoundedCornerShape(20.dp))
            .background(color)
            .then(if (enabled) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(horizontal = 12.dp, vertical = 8.dp),
        color = if (enabled) Radar.contentOn(color) else Radar.TextMuted,
        fontFamily = RadarFonts.Label, fontWeight = FontWeight.Bold, fontSize = 13.sp, letterSpacing = 0.6.sp,
        maxLines = 1, overflow = TextOverflow.Ellipsis,
    )
}

// ── Friend picker (FriendsBottomSheet) ───────────────────────────────────────

@Composable
fun FriendPickerSheet(vm: FriendsViewModel, onPick: (Friend) -> Unit) {
    val friends by vm.friends.collectAsState()
    val loading by vm.isLoading.collectAsState()
    var query by rememberSaveable { mutableStateOf("") }
    val shown = remember(friends, query) {
        if (query.isBlank()) friends
        else friends.filter { it.name.contains(query, true) || it.username.contains(query, true) }
    }

    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp))
            .background(Radar.Surface)
            .nestedScroll(rememberNestedScrollInteropConnection())
            .navigationBarsPadding()
            .padding(horizontal = 16.dp),
    ) {
        Box(
            Modifier
                .padding(top = 10.dp, bottom = 14.dp)
                .size(width = 40.dp, height = 4.dp)
                .clip(CircleShape)
                .background(Radar.Line)
                .align(Alignment.CenterHorizontally)
        )
        Row(verticalAlignment = Alignment.CenterVertically) {
            SheetIconBadge(Icons.Outlined.Forum, Radar.Accent)
            Spacer(Modifier.width(12.dp))
            Text(
                stringResource(R.string.friends_sheet_title), color = Radar.Text, fontSize = 18.sp,
                fontWeight = FontWeight.ExtraBold, fontFamily = RadarFonts.Body,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
        }
        Spacer(Modifier.height(14.dp))
        RadarSearchField(
            value = query, onValueChange = { query = it },
            placeholder = stringResource(R.string.friends_sheet_hint),
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(10.dp))
        when {
            friends.isEmpty() && loading -> RadarLoading()
            shown.isEmpty() -> RadarEmptyState(
                emoji = "👥",
                title = stringResource(R.string.msg_no_friends_found),
                hint = if (friends.isEmpty()) stringResource(R.string.friends_sheet_empty_hint) else null,
            )
            else -> LazyColumn(
                Modifier.fillMaxWidth().heightIn(max = 480.dp),
                contentPadding = PaddingValues(bottom = 16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(shown, key = { it.uid }) { f ->
                    PersonRow(name = f.name.ifBlank { f.username }, handle = f.username, onClick = { onPick(f) }) {
                        Icon(Icons.Outlined.ChatBubbleOutline, null, tint = Radar.Accent, modifier = Modifier.size(20.dp))
                    }
                }
            }
        }
    }
}

// ── Invite screen ────────────────────────────────────────────────────────────

@Composable
fun InviteScreen(
    config: InviteConfig?,
    onBack: () -> Unit,
    onCopyCode: (String) -> Unit,
    onShare: () -> Unit,
    onSms: () -> Unit,
    onWhatsApp: () -> Unit,
    onViber: () -> Unit,
    onEmail: () -> Unit,
) {
    Column(Modifier.fillMaxSize().background(Radar.Bg)) {
        RadarHeader(title = stringResource(R.string.invite_title), onBack = onBack)
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            RadarCard(highlight = true) {
                Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                    Box(
                        Modifier.size(72.dp).background(Radar.Surface2, CircleShape).border(1.dp, Radar.Line, CircleShape),
                        contentAlignment = Alignment.Center,
                    ) { Text("🪤", fontSize = 34.sp) }
                    Spacer(Modifier.height(12.dp))
                    Text(
                        stringResource(R.string.invite_hero_title), color = Radar.Text, fontSize = 20.sp,
                        fontWeight = FontWeight.ExtraBold, fontFamily = RadarFonts.Body, textAlign = TextAlign.Center,
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        stringResource(R.string.invite_hero_sub), color = Radar.TextSec, fontSize = 14.sp,
                        textAlign = TextAlign.Center,
                    )
                }
            }

            val code = config?.referralCode.orEmpty()
            if (code.isNotBlank()) {
                RadarSectionLabel(stringResource(R.string.invite_code_label))
                RadarCard(onClick = { onCopyCode(code) }) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            code, modifier = Modifier.weight(1f), color = Radar.Accent, fontFamily = RadarFonts.Mono,
                            fontSize = 22.sp, letterSpacing = 3.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        )
                        Icon(Icons.Outlined.ContentCopy, null, tint = Radar.TextSec)
                    }
                }
            }

            RadarSectionLabel(stringResource(R.string.invite_preview_label))
            RadarCard {
                Text(
                    config?.buildFullMessage() ?: stringResource(R.string.msg_loading_invite),
                    color = Radar.TextSec, fontSize = 14.sp, lineHeight = 20.sp,
                )
            }

            Spacer(Modifier.height(4.dp))
            RadarPrimaryButton(stringResource(R.string.invite_share_cta), onShare, Modifier.fillMaxWidth())

            RadarSectionLabel(stringResource(R.string.invite_send_via))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                ChannelTile(Icons.Outlined.Sms, Radar.Accent, stringResource(R.string.invite_ch_sms), onSms, Modifier.weight(1f))
                ChannelTile(Icons.Outlined.Forum, Radar.Safe, stringResource(R.string.invite_ch_whatsapp), onWhatsApp, Modifier.weight(1f))
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                ChannelTile(Icons.Outlined.Call, Color(0xFF8F7CF7), stringResource(R.string.invite_ch_viber), onViber, Modifier.weight(1f))
                ChannelTile(Icons.Outlined.Email, Radar.Gold, stringResource(R.string.invite_ch_email), onEmail, Modifier.weight(1f))
            }

            Text(
                stringResource(R.string.invite_privacy_note), color = Radar.TextMuted, fontSize = 12.sp,
                textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(top = 6.dp, bottom = 8.dp),
            )
        }
    }
}

@Composable
private fun ChannelTile(icon: ImageVector, tint: Color, label: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    RadarCard(modifier = modifier, onClick = onClick) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            SheetIconBadge(icon, tint)
            Spacer(Modifier.width(10.dp))
            Text(
                label, color = Radar.Text, fontWeight = FontWeight.Bold, fontSize = 14.sp,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
        }
    }
}
