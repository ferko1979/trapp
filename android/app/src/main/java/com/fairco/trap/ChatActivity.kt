package com.fairco.trap

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
import com.fairco.trap.databinding.ActivityChatBinding
import com.fairco.trap.databinding.BubbleMessageItemBinding
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import java.util.*

class ChatActivity : BaseActivity() {

    private lateinit var binding: ActivityChatBinding
    private val viewModel: MessagingViewModel by viewModels()
    private lateinit var conversationId: String
    private lateinit var otherUid: String
    private lateinit var otherUsername: String
    
    private var refreshJob: Job? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityChatBinding.inflate(layoutInflater)
        setContentView(binding.root)

        conversationId = intent.getStringExtra("conversationId") ?: ""
        otherUid = intent.getStringExtra("otherUid") ?: ""
        otherUsername = intent.getStringExtra("otherUsername") ?: "Chat"

        setSupportActionBar(binding.toolbar)
        supportActionBar?.setDisplayHomeAsUpEnabled(true)
        binding.toolbar.setNavigationOnClickListener { finish() }
        supportActionBar?.title = otherUsername

        setupRecyclerView()
        observeViewModel()

        binding.btnSend.setOnClickListener {
            sendMessage()
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

    private fun setupRecyclerView() {
        val layoutManager = LinearLayoutManager(this)
        layoutManager.stackFromEnd = true
        binding.rvMessages.layoutManager = layoutManager
    }

    private fun observeViewModel() {
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                launch {
                    viewModel.messages.collectLatest { list ->
                        binding.rvMessages.adapter = MessagesAdapter(list, viewModel.myUid())
                        if (list.isNotEmpty()) {
                            binding.rvMessages.scrollToPosition(list.size - 1)
                        }
                    }
                }
                launch {
                    viewModel.isLoading.collectLatest { loading ->
                        binding.progressBar.isVisible = loading && viewModel.messages.value.isEmpty()
                    }
                }
                launch {
                    viewModel.error.collectLatest { err ->
                        if (err != null) {
                            Toast.makeText(this@ChatActivity, err, Toast.LENGTH_SHORT).show()
                            viewModel.error.value = null
                        }
                    }
                }
            }
        }
    }

    private fun sendMessage() {
        val text = binding.etMessage.text.toString().trim()
        if (text.isBlank()) return

        // Optimistic update
        val myUid = viewModel.myUid()
        val tempMsg = ChatMessage(
            id = "temp_${System.currentTimeMillis()}",
            senderUid = myUid,
            senderUsername = "Me",
            text = text,
            createdAtEpochMs = System.currentTimeMillis()
        )
        val currentList = viewModel.messages.value.toMutableList()
        currentList.add(tempMsg)
        viewModel.messages.value = currentList
        binding.rvMessages.scrollToPosition(currentList.size - 1)
        binding.etMessage.setText("")

        viewModel.sendMessage(otherUid, text) {
            viewModel.openConversation(conversationId)
        }
    }

    private inner class MessagesAdapter(
        private val list: List<ChatMessage>,
        private val myUid: String
    ) : RecyclerView.Adapter<MessageViewHolder>() {

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) = MessageViewHolder(
            BubbleMessageItemBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        )

        override fun onBindViewHolder(holder: MessageViewHolder, position: Int) {
            val item = list[position]
            val isMe = item.senderUid == myUid

            with(holder.binding) {
                val params = bubbleCard.layoutParams as LinearLayout.LayoutParams
                params.gravity = if (isMe) Gravity.END else Gravity.START
                params.marginStart = if (isMe) dpToPx(56) else dpToPx(8)
                params.marginEnd = if (isMe) dpToPx(8) else dpToPx(56)
                bubbleCard.layoutParams = params

                bubbleCard.setCardBackgroundColor(ContextCompat.getColor(root.context, if (isMe) R.color.bubbleOutgoing else R.color.bubbleIncoming))

                tvSender.visibility = View.GONE
                tvMessage.text = item.text
                tvTime.text = item.createdAtEpochMs?.let { DateUtils.getRelativeTimeSpanString(it) } ?: ""
            }
        }

        private fun dpToPx(dp: Int): Int {
            return TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, dp.toFloat(), resources.displayMetrics).toInt()
        }

        override fun getItemCount() = list.size
    }

    private inner class MessageViewHolder(val binding: BubbleMessageItemBinding) : RecyclerView.ViewHolder(binding.root)
}

