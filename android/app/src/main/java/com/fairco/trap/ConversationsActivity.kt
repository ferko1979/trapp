package com.fairco.trap

import android.content.Intent
import android.os.Bundle
import android.view.LayoutInflater
import android.view.ViewGroup
import android.widget.Toast
import androidx.activity.viewModels
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import com.fairco.trap.BaseActivity
import androidx.core.view.isVisible
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.fairco.trap.databinding.ActivityConversationsBinding
import com.fairco.trap.databinding.ItemConversationBinding
import com.google.firebase.functions.functions
import com.google.firebase.Firebase
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import java.text.SimpleDateFormat
import java.util.*

class ConversationsActivity : BaseActivity() {

    private lateinit var binding: ActivityConversationsBinding
    private val viewModel: MessagingViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityConversationsBinding.inflate(layoutInflater)
        setContentView(binding.root)

        setSupportActionBar(binding.toolbar)
        supportActionBar?.setDisplayHomeAsUpEnabled(true)
        binding.toolbar.setNavigationOnClickListener { finish() }

        setupRecyclerView()
        observeViewModel()

        binding.swipeRefresh.setOnRefreshListener {
            viewModel.loadConversations()
        }

        binding.fabNewMessage.setOnClickListener {
            showNewMessageDialog()
        }

        viewModel.loadConversations()
    }

    private fun setupRecyclerView() {
        binding.rvConversations.layoutManager = LinearLayoutManager(this)
    }

    private fun observeViewModel() {
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                launch {
                    viewModel.conversations.collectLatest { list ->
                        val direct = viewModel.directConversations
                        binding.rvConversations.adapter = ConversationsAdapter(direct) { conv ->
                            openChat(conv.id, conv.otherUsername, conv.otherUid)
                        }
                        binding.tvEmpty.isVisible = direct.isEmpty()
                        binding.swipeRefresh.isRefreshing = false
                    }
                }
                launch {
                    viewModel.isLoading.collectLatest { loading ->
                        binding.progressBar.isVisible = loading && !binding.swipeRefresh.isRefreshing
                    }
                }
                launch {
                    viewModel.error.collectLatest { err ->
                        if (err != null) {
                            Toast.makeText(this@ConversationsActivity, err, Toast.LENGTH_SHORT).show()
                            viewModel.error.value = null
                            binding.swipeRefresh.isRefreshing = false
                        }
                    }
                }
            }
        }
    }

    private fun openChat(id: String, username: String, uid: String) {
        val intent = Intent(this, ChatActivity::class.java).apply {
            putExtra("conversationId", id)
            putExtra("otherUsername", username)
            putExtra("otherUid", uid)
        }
        startActivity(intent)
    }

    private fun showNewMessageDialog() {
        binding.progressBar.isVisible = true
        lifecycleScope.launch {
            try {
                // Load friends detailed
                val result = Firebase.functions("europe-west1").getHttpsCallable("listMyFriendsDetailed")
                    .call().await()
                val data = result.getData() as? Map<String, Any>
                @Suppress("UNCHECKED_CAST")
                val items = data?.get("items") as? List<Map<String, Any>> ?: emptyList()
                
                val friends = items.map {
                    Friend(
                        uid = it["uid"] as? String ?: "",
                        username = it["username"] as? String ?: "",
                        name = it["name"] as? String ?: "User",
                        createdAtEpochMs = (it["createdAtEpochMs"] as? Number)?.toLong()
                    )
                }

                if (friends.isEmpty()) {
                    Toast.makeText(this@ConversationsActivity, getString(R.string.msg_no_friends_to_message), Toast.LENGTH_SHORT).show()
                    return@launch
                }

                val friendNames = friends.map { "${it.name} (@${it.username})" }.toTypedArray()
                
                AlertDialog.Builder(this@ConversationsActivity)
                    .setTitle(getString(R.string.title_new_message))
                    .setItems(friendNames) { _, which ->
                        val friend = friends[which]
                        // Conversation ID for direct messages = [uid1, uid2].sorted().joinToString("__")
                        val myUid = viewModel.myUid()
                        val conversationId = listOf(myUid, friend.uid).sorted().joinToString("__")
                        openChat(conversationId, friend.username, friend.uid)
                    }
                    .show()

            } catch (e: Exception) {
                Toast.makeText(this@ConversationsActivity, getString(R.string.chat_load_friends_failed, e.message ?: ""), Toast.LENGTH_SHORT).show()
            } finally {
                binding.progressBar.isVisible = false
            }
        }
    }

    private inner class ConversationsAdapter(
        private val list: List<Conversation>,
        private val onClick: (Conversation) -> Unit
    ) : RecyclerView.Adapter<ConversationViewHolder>() {
        
        private val dateFormat = SimpleDateFormat("HH:mm", Locale.getDefault())
        private val dateFullFormat = SimpleDateFormat("MMM dd", Locale.getDefault())

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) = ConversationViewHolder(
            ItemConversationBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        )

        override fun onBindViewHolder(holder: ConversationViewHolder, position: Int) {
            val item = list[position]
            holder.binding.tvOtherUsername.text = item.otherUsername
            holder.binding.tvLastMessage.text = item.lastMessageText
            holder.binding.unreadIndicator.isVisible = item.unread
            
            item.lastMessageAtEpochMs?.let {
                val date = Date(it)
                val isToday = android.text.format.DateUtils.isToday(it)
                holder.binding.tvTime.text = if (isToday) dateFormat.format(date) else dateFullFormat.format(date)
            }
            
            holder.itemView.setOnClickListener { onClick(item) }
        }

        override fun getItemCount() = list.size
    }

    private inner class ConversationViewHolder(val binding: ItemConversationBinding) : RecyclerView.ViewHolder(binding.root)
}

