package com.fairco.trap

import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.fairco.trap.ui.theme.TrappTheme
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.launch

class InboxActivity : BaseActivity() {

    override val radarBars = true

    private val badgeVm: InboxBadgeViewModel by viewModels()
    private val messagingVm: MessagingViewModel by viewModels()
    private val supportVm: SupportViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Open directly to Support tab if launched from a ticket action
        val openTab = intent.getIntExtra("openTab", 0)

        setContent {
            TrappTheme {
                InboxScreen(
                    initialTab = openTab,
                    messagingVm = messagingVm,
                    supportVm = supportVm,
                    badgeVm = badgeVm,
                    onBack = { finish() },
                    onOpenConversation = ::openConversation,
                    onOpenTicket = { t -> openTicket(t.id, t.ticketNo) },
                    onNewMessage = ::pickFriend,
                    onTicketCreated = { no ->
                        if (no != null) {
                            Toast.makeText(this, getString(R.string.support_ticket_submitted_detail, no), Toast.LENGTH_LONG).show()
                        }
                        supportVm.loadTickets()
                    },
                )
            }
        }

        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                launch { messagingVm.error.filterNotNull().collect { toast(it); messagingVm.error.value = null } }
                launch { supportVm.error.filterNotNull().collect { toast(it); supportVm.error.value = null } }
            }
        }
    }

    override fun onStart() {
        super.onStart()
        badgeVm.startPolling()
    }

    override fun onStop() {
        badgeVm.stopPolling()
        super.onStop()
    }

    override fun onRestart() {
        super.onRestart()
        // Back from a chat / ticket: refresh unread state and previews
        messagingVm.loadConversations()
        supportVm.loadTickets()
    }

    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()

    private fun openConversation(conv: Conversation) {
        if (conv.kind == "support") {
            openTicket(conv.supportTicketId, conv.supportTicketNo)
        } else {
            openChat(conv.id, conv.otherUsername, conv.otherUid)
        }
    }

    private fun openTicket(id: String, no: String) {
        startActivity(
            Intent(this, SupportThreadActivity::class.java)
                .putExtra("ticketId", id)
                .putExtra("ticketNo", no)
        )
    }

    private fun openChat(conversationId: String, otherUsername: String, otherUid: String) {
        startActivity(
            Intent(this, ChatActivity::class.java)
                .putExtra("conversationId", conversationId)
                .putExtra("otherUsername", otherUsername)
                .putExtra("otherUid", otherUid)
        )
    }

    private fun pickFriend() {
        FriendsBottomSheet { friend ->
            val id = listOf(messagingVm.myUid(), friend.uid).sorted().joinToString("__")
            openChat(id, friend.username, friend.uid)
        }.show(supportFragmentManager, FriendsBottomSheet.TAG)
    }
}
