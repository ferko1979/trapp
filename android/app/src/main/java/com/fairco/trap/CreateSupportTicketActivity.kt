package com.fairco.trap

import android.os.Bundle
import android.widget.Toast
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import com.fairco.trap.ui.theme.TrappTheme

class CreateSupportTicketActivity : BaseActivity() {

    override val radarBars = true

    private val viewModel: SupportViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val initialSubject = intent.getStringExtra("subject") ?: ""
        val initialMessage = intent.getStringExtra("message") ?: ""

        setContent {
            TrappTheme {
                CreateTicketScreen(
                    vm = viewModel,
                    initialSubject = initialSubject,
                    initialMessage = initialMessage,
                    onClose = { finish() },
                    onCreated = { _, msg ->
                        Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
                        finish()
                    },
                )
            }
        }
    }
}
