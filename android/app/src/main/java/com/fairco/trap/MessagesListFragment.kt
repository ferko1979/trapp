package com.fairco.trap

import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.text.format.DateUtils
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.core.view.isVisible
import androidx.fragment.app.Fragment
import androidx.fragment.app.viewModels
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.fairco.trap.databinding.FragmentMessagesListBinding
import com.fairco.trap.databinding.ItemConversationBinding
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

class MessagesListFragment : Fragment() {

    private var _binding: FragmentMessagesListBinding? = null
    private val binding get() = _binding!!
    private val viewModel: MessagingViewModel by viewModels()

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = FragmentMessagesListBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        
        setupRecyclerView()
        observeViewModel()

        binding.swipeRefresh.setOnRefreshListener {
            viewModel.loadConversations()
        }

        binding.fabNewMessage.setOnClickListener {
            showNewMessageBottomSheet()
        }

        binding.etSearch.addTextChangedListener(object : TextWatcher {
            override fun afterTextChanged(s: Editable?) {
                filterConversations(s?.toString() ?: "")
            }
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
        })

        viewModel.loadConversations()
    }

    private fun setupRecyclerView() {
        binding.rvConversations.layoutManager = LinearLayoutManager(requireContext())
    }

    private fun observeViewModel() {
        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
                launch {
                    viewModel.conversations.collectLatest { list ->
                        updateAdapter(list)
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
                            Toast.makeText(requireContext(), err, Toast.LENGTH_SHORT).show()
                            viewModel.error.value = null
                            binding.swipeRefresh.isRefreshing = false
                        }
                    }
                }
            }
        }
    }

    private fun updateAdapter(list: List<Conversation>) {
        binding.rvConversations.adapter = ConversationsAdapter(list) { conv ->
            if (conv.kind == "support") {
                val intent = Intent(requireContext(), SupportThreadActivity::class.java)
                intent.putExtra("ticketId", conv.supportTicketId)
                intent.putExtra("ticketNo", conv.supportTicketNo)
                startActivity(intent)
            } else {
                openChat(conv.id, conv.otherUsername, conv.otherUid)
            }
        }
        binding.tvEmpty.isVisible = list.isEmpty()
        binding.swipeRefresh.isRefreshing = false
    }

    private fun filterConversations(query: String) {
        val filtered = viewModel.conversations.value.filter {
            it.otherUsername.contains(query, ignoreCase = true) || 
            it.lastMessageText.contains(query, ignoreCase = true)
        }
        updateAdapter(filtered)
    }

    private fun openChat(id: String, username: String, uid: String) {
        val intent = Intent(requireContext(), ChatActivity::class.java).apply {
            putExtra("conversationId", id)
            putExtra("otherUsername", username)
            putExtra("otherUid", uid)
        }
        startActivity(intent)
    }

    private fun showNewMessageBottomSheet() {
        val bottomSheet = FriendsBottomSheet { friend ->
            val myUid = viewModel.myUid()
            val conversationId = listOf(myUid, friend.uid).sorted().joinToString("__")
            openChat(conversationId, friend.username, friend.uid)
        }
        bottomSheet.show(childFragmentManager, FriendsBottomSheet.TAG)
    }

    private inner class ConversationsAdapter(
        private val list: List<Conversation>,
        private val onClick: (Conversation) -> Unit
    ) : RecyclerView.Adapter<ConversationViewHolder>() {

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) = ConversationViewHolder(
            ItemConversationBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        )

        override fun onBindViewHolder(holder: ConversationViewHolder, position: Int) {
            val item = list[position]
            
            with(holder.binding) {
                if (item.kind == "support") {
                    tvAvatarInitial.text = "🛡"
                    avatarBg.backgroundTintList = android.content.res.ColorStateList.valueOf(requireContext().getColor(R.color.adminBlue))
                    tvOtherUsername.text = "Support · ${item.supportTicketNo}"
                } else {
                    tvAvatarInitial.text = item.otherUsername.take(1).uppercase()
                    avatarBg.backgroundTintList = android.content.res.ColorStateList.valueOf(getAvatarColor(item.otherUid))
                    tvOtherUsername.text = item.otherUsername
                }

                tvLastMessage.text = item.lastMessageText
                unreadIndicator.isVisible = item.unread
                
                if (item.unread) {
                    tvOtherUsername.setTextColor(requireContext().getColor(R.color.accent_cyan))
                    tvOtherUsername.setTypeface(null, Typeface.BOLD)
                } else {
                    tvOtherUsername.setTextColor(requireContext().getColor(R.color.text_primary))
                    tvOtherUsername.setTypeface(null, Typeface.NORMAL)
                }

                item.lastMessageAtEpochMs?.let {
                    tvTime.text = DateUtils.getRelativeTimeSpanString(it)
                }
                
                root.setOnClickListener { onClick(item) }
            }
        }

        private fun getAvatarColor(uid: String): Int {
            val colors = arrayOf("#EF4444", "#F59E0B", "#10B981", "#3B82F6", "#6366F1", "#8B5CF6", "#EC4899")
            val index = Math.abs(uid.hashCode()) % colors.size
            return Color.parseColor(colors[index])
        }

        override fun getItemCount() = list.size
    }

    private inner class ConversationViewHolder(val binding: ItemConversationBinding) : RecyclerView.ViewHolder(binding.root)

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
