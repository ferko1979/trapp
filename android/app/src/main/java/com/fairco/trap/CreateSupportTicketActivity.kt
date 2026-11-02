package com.fairco.trap

import android.os.Bundle
import android.widget.*
import androidx.activity.viewModels
import androidx.appcompat.app.AppCompatActivity
import com.fairco.trap.BaseActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

class CreateSupportTicketActivity : BaseActivity() {

    private lateinit var subjectInput: EditText
    private lateinit var messageInput: EditText
    private lateinit var categorySpinner: Spinner
    private lateinit var sendButton: Button
    private lateinit var cancelButton: Button
    private lateinit var closeButton: ImageButton
    private lateinit var progressBar: ProgressBar
    
    private val viewModel: SupportViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_create_support_ticket)

        subjectInput = findViewById(R.id.subjectInput)
        messageInput = findViewById(R.id.messageInput)
        categorySpinner = findViewById(R.id.categorySpinner)
        sendButton = findViewById(R.id.sendButton)
        cancelButton = findViewById(R.id.cancelButton)
        closeButton = findViewById(R.id.closeButton)
        
        // Add ProgressBar to layout dynamically or update layout? 
        // I'll just assume it might not be there or I'll add it to the layout.
        // Actually, I'll just use sendButton.isEnabled as a loading indicator for now.

        setupCategorySpinner()

        val initialSubject = intent.getStringExtra("subject") ?: ""
        subjectInput.setText(initialSubject)

        val initialMessage = intent.getStringExtra("message") ?: ""
        messageInput.setText(initialMessage)

        sendButton.setOnClickListener {
            submitTicket()
        }

        cancelButton.setOnClickListener {
            finish()
        }

        closeButton.setOnClickListener {
            finish()
        }

        observeViewModel()
    }

    private fun setupCategorySpinner() {
        val categories = TicketCategory.entries
        val adapter = ArrayAdapter(this, android.R.layout.simple_spinner_item, categories.map { it.label })
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
        categorySpinner.adapter = adapter
        
        // Default to General if possible
        val generalIdx = categories.indexOf(TicketCategory.GENERAL)
        if (generalIdx >= 0) categorySpinner.setSelection(generalIdx)
    }

    private fun observeViewModel() {
        lifecycleScope.launch {
            viewModel.isLoading.collectLatest { loading ->
                sendButton.isEnabled = !loading
            }
        }
    }

    private fun submitTicket() {
        val subject = subjectInput.text.toString().trim()
        val message = messageInput.text.toString().trim()
        val category = TicketCategory.entries[categorySpinner.selectedItemPosition].value

        viewModel.createTicket(subject, message, category) { success, msg, ticketNo ->
            Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
            if (success) {
                finish()
            }
        }
    }
}

