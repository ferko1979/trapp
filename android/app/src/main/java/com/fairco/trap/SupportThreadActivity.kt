package com.fairco.trap

import android.content.res.ColorStateList
import android.os.Bundle
import android.text.format.DateUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.Toast
import androidx.activity.viewModels
import androidx.appcompat.app.AppCompatActivity
import com.fairco.trap.BaseActivity
import androidx.core.content.ContextCompat
import androidx.core.view.isVisible
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.fairco.trap.databinding.ActivitySupportThreadBinding
import com.fairco.trap.databinding.BubbleMessageItemBinding
import com.google.android.material.snackbar.Snackbar
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import java.util.*

class SupportThreadActivity : BaseActivity() {

    private lateinit var binding: ActivitySupportThreadBinding
    private val viewModel: SupportViewModel by viewModels()
    private lateinit var ticketId: String
    private lateinit var ticketNo: String
    
    private var refreshJob: Job? = null
    private var previousCount = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivitySupportThreadBinding.inflate(layoutInflater)
        setContentView(binding.root)

        ticketId = intent.getStringExtra("ticketId") ?: ""
        ticketNo = intent.getStringExtra("ticketNo") ?: ""

        setSupportActionBar(binding.toolbar)
        supportActionBar?.setDisplayHomeAsUpEnabled(true)
        binding.toolbar.setNavigationOnClickListener { finish() }
        supportActionBar?.title = "Ticket #$ticketNo"

        setupRecyclerView()
        observeViewModel()

        binding.btnSend.setOnClickListener {
            sendReply()
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

    private fun setupRecyclerView() {
        val layoutManager = LinearLayoutManager(this)
        layoutManager.stackFromEnd = true
        binding.rvMessages.layoutManager = layoutManager
    }

    private fun observeViewModel() {
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                launch {
                    viewModel.threadMessages.collectLatest { list ->
                        val newCount = list.size
                        if (newCount > previousCount && previousCount > 0) {
                            Snackbar.make(binding.root, "🛡 New reply from Support", Snackbar.LENGTH_SHORT).show()
                            binding.rvMessages.scrollToPosition(newCount - 1)
                        }
                        previousCount = newCount
                        binding.rvMessages.adapter = MessagesAdapter(list)
                    }
                }
                launch {
                    viewModel.currentTicket.collectLatest { ticket ->
                        if (ticket != null) {
                            bindTicketHeader(ticket)
                        }
                    }
                }
                launch {
                    viewModel.isLoading.collectLatest { loading ->
                        binding.progressBar.isVisible = loading && viewModel.threadMessages.value.isEmpty()
                    }
                }
                launch {
                    viewModel.error.collectLatest { err ->
                        if (err != null) {
                            Toast.makeText(this@SupportThreadActivity, err, Toast.LENGTH_SHORT).show()
                            viewModel.error.value = null
                        }
                    }
                }
            }
        }
    }

    private fun bindTicketHeader(ticket: Map<String, Any>) {
        val ticketNo = ticket["ticketNo"] as? String ?: ""
        val subject = ticket["subject"] as? String ?: ""
        val status = ticket["status"] as? String ?: "open"

        binding.ticketHeaderLayout.tvTicketNo.text = ticketNo
        binding.ticketHeaderLayout.tvTicketSubject.text = subject
        
        val (label, colorRes) = when (status) {
            "open"           -> "Open"            to R.color.statusBlue
            "waiting_admin"  -> "Awaiting reply"  to R.color.statusBlue
            "waiting_user"   -> "Your turn"       to R.color.statusOrange
            "answered"       -> "Answered ✓"      to R.color.statusGreen
            "closed"         -> "Closed"          to R.color.statusGrey
            else             -> status            to R.color.statusGrey
        }
        
        binding.ticketHeaderLayout.chipStatus.text = label
        binding.ticketHeaderLayout.chipStatus.chipBackgroundColor = ColorStateList.valueOf(ContextCompat.getColor(this, colorRes))

        val isClosed = status == "closed"
        binding.inputContainer.isVisible = !isClosed
        binding.tvClosedBanner.isVisible = isClosed

        if (status == "waiting_user") {
            binding.ticketHeaderLayout.bannerReplyPrompt.visibility = View.VISIBLE
            binding.ticketHeaderLayout.bannerReplyPrompt.text = "Support is waiting for your reply."
        } else {
            binding.ticketHeaderLayout.bannerReplyPrompt.visibility = View.GONE
        }
    }

    private fun sendReply() {
        val text = binding.etMessage.text.toString().trim()
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
        val currentList = viewModel.threadMessages.value.toMutableList()
        currentList.add(tempMsg)
        viewModel.threadMessages.value = currentList
        binding.rvMessages.scrollToPosition(currentList.size - 1)
        binding.etMessage.setText("")

        viewModel.replyToTicket(ticketId, text) { success ->
            if (!success) {
                viewModel.openTicket(ticketId)
            }
        }
    }

    private inner class MessagesAdapter(
        private val list: List<TicketMessage>
    ) : RecyclerView.Adapter<MessageViewHolder>() {

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) = MessageViewHolder(
            BubbleMessageItemBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        )

        override fun onBindViewHolder(holder: MessageViewHolder, position: Int) {
            val msg = list[position]
            val isAdmin = msg.senderType == "admin"
            val isMe = !isAdmin

            with(holder.binding) {
                val params = bubbleCard.layoutParams as LinearLayout.LayoutParams
                params.gravity = if (isMe) Gravity.END else Gravity.START
                params.marginStart = if (isMe) dpToPx(56) else dpToPx(8)
                params.marginEnd = if (isMe) dpToPx(8) else dpToPx(56)
                bubbleCard.layoutParams = params

                bubbleCard.setCardBackgroundColor(ContextCompat.getColor(root.context, if (isMe) R.color.bubbleOutgoing else R.color.bubbleIncoming))

                val senderLabel = if (isAdmin) "🛡 ${msg.senderName} (Support)" else "You"
                tvSender.text = senderLabel
                tvSender.setTextColor(ContextCompat.getColor(root.context, if (isAdmin) R.color.adminBlue else R.color.text_muted))
                tvSender.visibility = if (isAdmin) View.VISIBLE else View.GONE

                tvMessage.text = msg.text

                tvTime.text = msg.createdAtEpochMs?.let { DateUtils.getRelativeTimeSpanString(it) } ?: ""
            }
        }

        private fun dpToPx(dp: Int): Int {
            return TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, dp.toFloat(), resources.displayMetrics).toInt()
        }

        override fun getItemCount() = list.size
    }

    private inner class MessageViewHolder(val binding: BubbleMessageItemBinding) : RecyclerView.ViewHolder(binding.root)
}

