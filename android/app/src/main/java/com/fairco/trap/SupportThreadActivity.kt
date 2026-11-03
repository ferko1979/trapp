package com.fairco.trap

import android.os.Bundle
import android.widget.Toast
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.fairco.trap.ui.theme.TrappTheme
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.launch

class SupportThreadActivity : BaseActivity() {

    override val radarBars = true

    private val viewModel: SupportViewModel by viewModels()
    private lateinit var ticketId: String
    private lateinit var ticketNo: String

    private var refreshJob: Job? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        ticketId = intent.getStringExtra("ticketId") ?: ""
        ticketNo = intent.getStringExtra("ticketNo") ?: ""

        setContent {
            TrappTheme {
                var showNewTicket by rememberSaveable { mutableStateOf(false) }
                SupportThreadScreen(
                    ticketNo = ticketNo,
                    vm = viewModel,
                    onBack = { finish() },
                    onSend = ::sendReply,
                    onNewTicket = { showNewTicket = true },
                )
                if (showNewTicket) {
                    NewTicketSheet(
                        vm = viewModel,
                        onDismiss = { showNewTicket = false },
                        onCreated = { no ->
                            showNewTicket = false
                            if (no != null) {
                                Toast.makeText(this, getString(R.string.support_ticket_submitted_detail, no), Toast.LENGTH_LONG).show()
                            }
                        },
                    )
                }
            }
        }

        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                viewModel.error.filterNotNull().collect {
                    Toast.makeText(this@SupportThreadActivity, it, Toast.LENGTH_SHORT).show()
                    viewModel.error.value = null
                }
            }
        }
    }

    override fun onStart() {
        super.onStart()
        refreshJob = lifecycleScope.launch {
            while (true) {
                viewModel.openTicket(ticketId)
                delay(20_000)
            }
        }
    }

    override fun onStop() {
        super.onStop()
        refreshJob?.cancel()
    }

    private fun sendReply(text: String) {
        if (text.isBlank()) return

        // Optimistic update
        val tempMsg = TicketMessage(
            id = "temp_${System.currentTimeMillis()}",
            senderType = "user",
            senderName = "Me",
            text = text,
            isInternal = false,
            createdAtEpochMs = System.currentTimeMillis()
        )
        viewModel.threadMessages.value = viewModel.threadMessages.value + tempMsg

        viewModel.replyToTicket(ticketId, text) { success ->
            if (!success) {
                viewModel.openTicket(ticketId)
            }
        }
    }
}
