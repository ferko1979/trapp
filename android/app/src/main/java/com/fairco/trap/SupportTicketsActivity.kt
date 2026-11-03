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

class SupportTicketsActivity : BaseActivity() {

    override val radarBars = true

    private val viewModel: SupportViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        setContent {
            TrappTheme {
                SupportTicketsScreen(
                    vm = viewModel,
                    onBack = { finish() },
                    onOpenTicket = { ticket ->
                        startActivity(
                            Intent(this, SupportThreadActivity::class.java)
                                .putExtra("ticketId", ticket.id)
                                .putExtra("ticketNo", ticket.ticketNo)
                        )
                    },
                    onNewTicket = { startActivity(Intent(this, CreateSupportTicketActivity::class.java)) },
                )
            }
        }

        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                viewModel.error.filterNotNull().collect {
                    Toast.makeText(this@SupportTicketsActivity, it, Toast.LENGTH_SHORT).show()
                    viewModel.error.value = null
                }
            }
        }
    }

    override fun onRestart() {
        super.onRestart()
        viewModel.loadTickets()
    }
}
