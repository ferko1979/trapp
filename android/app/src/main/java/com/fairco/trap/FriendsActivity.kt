package com.fairco.trap

import android.content.Intent
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.LayoutInflater
import android.view.View
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
import com.fairco.trap.databinding.ActivityFriendsBinding
import com.fairco.trap.databinding.ItemFriendBinding
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

class FriendsActivity : BaseActivity() {

    private lateinit var binding: ActivityFriendsBinding
    private val viewModel: FriendsViewModel by viewModels()
    private var currentTabIndex = 0
    private var searchByUidMode = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityFriendsBinding.inflate(layoutInflater)
        setContentView(binding.root)

        setSupportActionBar(binding.toolbar)
        supportActionBar?.setDisplayHomeAsUpEnabled(true)
        binding.toolbar.setNavigationOnClickListener { finish() }

        setupRecyclerView()
        setupTabs()
        setupSearch()
        setupSearchToggle()
        observeViewModel()

        binding.swipeRefresh.setOnRefreshListener {
            refreshData()
        }

        binding.cardInvite.setOnClickListener {
            startActivity(Intent(this, InviteFriendsActivity::class.java))
        }

        refreshData()
    }

    private fun setupRecyclerView() {
        binding.rvFriends.layoutManager = LinearLayoutManager(this)
    }

    private fun setupTabs() {
        binding.tabLayout.addOnTabSelectedListener(object : com.google.android.material.tabs.TabLayout.OnTabSelectedListener {
            override fun onTabSelected(tab: com.google.android.material.tabs.TabLayout.Tab?) {
                currentTabIndex = tab?.position ?: 0
                updateUiForTab()
                refreshData()
            }
            override fun onTabUnselected(tab: com.google.android.material.tabs.TabLayout.Tab?) {}
            override fun onTabReselected(tab: com.google.android.material.tabs.TabLayout.Tab?) {}
        })
    }

    private fun updateUiForTab() {
        binding.toggleGroupSearchMode.isVisible = currentTabIndex == 2
        binding.tilAddFriend.isVisible = currentTabIndex == 2 && !searchByUidMode
        binding.tilSearchByIdentifier.isVisible = currentTabIndex == 2 && searchByUidMode
        binding.cardIdentifierResult.isVisible = currentTabIndex == 2 && searchByUidMode && viewModel.identifierResult.value is IdentifierSearchState.Found
        
        binding.rvFriends.isVisible = currentTabIndex != 2 || !searchByUidMode
        binding.cardInvite.isVisible = currentTabIndex != 2

        binding.radiusChipGroup.isVisible = false // Nearby features temporarily disabled in this view
    }

    private fun setupSearchToggle() {
        binding.toggleGroupSearchMode.addOnButtonCheckedListener { group, checkedId, isChecked ->
            if (isChecked) {
                searchByUidMode = checkedId == R.id.btnSearchByIdentifier
                // Clear inputs
                binding.etAddFriendUsername.text?.clear()
                binding.etSearchByIdentifier.text?.clear()
                viewModel.searchResults.value = emptyList()
                viewModel.clearIdentifierResult()
                updateUiForTab()
            }
        }
    }

    private fun setupSearch() {
        binding.etAddFriendUsername.addTextChangedListener(object : TextWatcher {
            override fun afterTextChanged(s: Editable?) {
                if (currentTabIndex == 2 && !searchByUidMode) {
                    viewModel.searchUsers(s?.toString() ?: "")
                }
            }
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
        })

        binding.etSearchByIdentifier.addTextChangedListener(object : TextWatcher {
            override fun afterTextChanged(s: Editable?) {
                viewModel.clearIdentifierResult()
            }
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
        })

        binding.etSearchByIdentifier.setOnEditorActionListener { v, actionId, event ->
            if (actionId == android.view.inputmethod.EditorInfo.IME_ACTION_SEARCH || 
                actionId == android.view.inputmethod.EditorInfo.IME_ACTION_DONE) {
                viewModel.searchByIdentifier(v.text.toString())
                true
            } else false
        }

        binding.tilSearchByIdentifier.setEndIconOnClickListener {
            viewModel.searchByIdentifier(binding.etSearchByIdentifier.text.toString())
        }
    }

    private fun refreshData() {
        when (currentTabIndex) {
            0 -> viewModel.loadFriends()
            1 -> viewModel.loadFriendRequests()
            2 -> {
                viewModel.loadFriendRequests() // Load requests to identify friendshipStatus
                val query = binding.etAddFriendUsername.text.toString()
                if (!searchByUidMode) {
                    if (query.length >= 2) viewModel.searchUsers(query)
                    else binding.swipeRefresh.isRefreshing = false
                } else {
                    binding.swipeRefresh.isRefreshing = false
                }
            }
        }
    }

    private fun observeViewModel() {
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                launch {
                    viewModel.friends.collectLatest { list ->
                        if (currentTabIndex == 0) {
                            binding.rvFriends.adapter = FriendsListAdapter(list) { friend ->
                                showRemoveFriendDialog(friend)
                            }
                            binding.tvEmpty.isVisible = list.isEmpty()
                            binding.tvEmpty.text = getString(R.string.msg_no_friends_found)
                            binding.swipeRefresh.isRefreshing = false
                        }
                    }
                }
                launch {
                    viewModel.incomingRequests.collectLatest { list ->
                        if (currentTabIndex == 1) {
                            updateRequestsAdapter()
                        }
                    }
                }
                launch {
                    viewModel.outgoingRequests.collectLatest { list ->
                        if (currentTabIndex == 1) {
                            updateRequestsAdapter()
                        }
                    }
                }
                launch {
                    viewModel.searchResults.collectLatest { list ->
                        if (currentTabIndex == 2 && !searchByUidMode) {
                            binding.rvFriends.adapter = SearchResultsAdapter(list) { user ->
                                viewModel.sendFriendRequest(user.username) { success, msg ->
                                    Toast.makeText(this@FriendsActivity, msg, Toast.LENGTH_SHORT).show()
                                }
                            }
                            binding.tvEmpty.isVisible = list.isEmpty() && (binding.etAddFriendUsername.text?.length ?: 0) >= 2
                            binding.tvEmpty.text = getString(R.string.msg_no_users_found)
                            binding.swipeRefresh.isRefreshing = false
                        }
                    }
                }
                launch {
                    viewModel.identifierResult.collectLatest { state ->
                        updateIdentifierResultUi(state)
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
                            Toast.makeText(this@FriendsActivity, err, Toast.LENGTH_SHORT).show()
                            viewModel.error.value = null
                            binding.swipeRefresh.isRefreshing = false
                        }
                    }
                }
            }
        }
    }

    private fun updateRequestsAdapter() {
        val incoming = viewModel.incomingRequests.value
        val outgoing = viewModel.outgoingRequests.value
        
        binding.rvFriends.adapter = RequestsAdapter(incoming, outgoing, 
            onAccept = { req -> viewModel.respondToRequest(req.id, true) },
            onDecline = { req -> viewModel.respondToRequest(req.id, false) }
        )
        binding.tvEmpty.isVisible = incoming.isEmpty() && outgoing.isEmpty()
        binding.tvEmpty.text = getString(R.string.msg_no_pending_requests)
        binding.swipeRefresh.isRefreshing = false
    }

    private fun updateIdentifierResultUi(state: IdentifierSearchState) {
        if (currentTabIndex != 2 || !searchByUidMode) {
            binding.cardIdentifierResult.isVisible = false
            return
        }

        when (state) {
            is IdentifierSearchState.Idle -> {
                binding.cardIdentifierResult.isVisible = false
                binding.progressBar.isVisible = false
            }
            is IdentifierSearchState.Loading -> {
                binding.cardIdentifierResult.isVisible = false
                binding.progressBar.isVisible = true
                binding.etSearchByIdentifier.isEnabled = false
            }
            is IdentifierSearchState.Found -> {
                binding.progressBar.isVisible = false
                binding.etSearchByIdentifier.isEnabled = true
                binding.cardIdentifierResult.isVisible = true
                
                binding.tvResultName.text = "${state.name} (@${state.username})"
                binding.tvResultUid.text = "UID: ${state.uid}"
                
                binding.btnAction.isEnabled = true
                when (state.friendshipStatus) {
                    "none" -> {
                        binding.btnAction.text = getString(R.string.action_add_friend_short)
                        binding.btnAction.setTextColor(androidx.core.content.ContextCompat.getColor(this, R.color.accent_cyan))
                        binding.btnAction.setOnClickListener { viewModel.sendFriendRequestByUid(state.uid) }
                    }
                    "outgoing_pending" -> {
                        binding.btnAction.text = getString(R.string.label_request_sent)
                        binding.btnAction.setTextColor(androidx.core.content.ContextCompat.getColor(this, R.color.text_muted))
                        binding.btnAction.isEnabled = false
                    }
                    "incoming_pending" -> {
                        binding.btnAction.text = getString(R.string.label_accept_request)
                        binding.btnAction.setTextColor(androidx.core.content.ContextCompat.getColor(this, R.color.accent_green))
                        binding.btnAction.setOnClickListener { 
                            // The instructions say use respondToFriendRequestDetailed with "accept"
                            // I need to find the request ID if possible, but the search result doesn't have it.
                            // However, the backend function 'respondToFriendRequest' might handle it if we have the UID?
                            // Wait, if it's incoming_pending, we might need the request ID.
                            // But listFriendRequestsDetailed is already loaded in VM.
                            val reqId = viewModel.incomingRequests.value.find { it.fromUid == state.uid }?.id
                            if (reqId != null) {
                                viewModel.respondToFriendRequestDetailed(reqId, "accept")
                            } else {
                                Toast.makeText(this, getString(R.string.msg_request_id_not_found), Toast.LENGTH_SHORT).show()
                            }
                        }
                    }
                    "friends" -> {
                        binding.btnAction.text = getString(R.string.label_friends_confirmed)
                        binding.btnAction.setTextColor(androidx.core.content.ContextCompat.getColor(this, R.color.accent_green))
                        binding.btnAction.isEnabled = false
                    }
                }
            }
            is IdentifierSearchState.NotFound -> {
                binding.progressBar.isVisible = false
                binding.etSearchByIdentifier.isEnabled = true
                binding.cardIdentifierResult.isVisible = false
                val msg = when (state.reason) {
                    "self" -> getString(R.string.msg_own_account)
                    else -> getString(R.string.msg_user_not_found_id)
                }
                Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
            }
            is IdentifierSearchState.Error -> {
                binding.progressBar.isVisible = false
                binding.etSearchByIdentifier.isEnabled = true
                binding.cardIdentifierResult.isVisible = false
                Toast.makeText(this, state.message, Toast.LENGTH_LONG).show()
            }
        }
    }

    private fun showRemoveFriendDialog(friend: Friend) {
        AlertDialog.Builder(this)
            .setTitle(getString(R.string.title_remove_friend))
            .setMessage(getString(R.string.msg_confirm_remove_friend, "${friend.name} (@${friend.username})"))
            .setPositiveButton(getString(R.string.action_remove)) { _, _ -> viewModel.removeFriend(friend.uid) }
            .setNegativeButton(getString(R.string.action_cancel), null)
            .show()
    }

    // --- Adapters ---

    private inner class FriendsListAdapter(
        private val list: List<Friend>,
        private val onLongClick: (Friend) -> Unit
    ) : RecyclerView.Adapter<FriendViewHolder>() {
        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) = FriendViewHolder(
            ItemFriendBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        )
        override fun onBindViewHolder(holder: FriendViewHolder, position: Int) {
            val item = list[position]
            holder.binding.tvFriendName.text = item.name
            holder.binding.tvFriendHandle.text = "@${item.username}"
            holder.binding.tvDistance.isVisible = false
            holder.itemView.setOnLongClickListener { onLongClick(item); true }
        }
        override fun getItemCount() = list.size
    }

    private inner class RequestsAdapter(
        private val incoming: List<FriendRequest>,
        private val outgoing: List<FriendRequest>,
        private val onAccept: (FriendRequest) -> Unit,
        private val onDecline: (FriendRequest) -> Unit
    ) : RecyclerView.Adapter<RecyclerView.ViewHolder>() {

        private val TYPE_HEADER = 0
        private val TYPE_REQUEST = 1

        override fun getItemViewType(position: Int): Int {
            return if (position == 0 || position == incoming.size + 1) TYPE_HEADER else TYPE_REQUEST
        }

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RecyclerView.ViewHolder {
            return if (viewType == TYPE_HEADER) {
                HeaderViewHolder(com.fairco.trap.databinding.ItemHeaderBinding.inflate(LayoutInflater.from(parent.context), parent, false))
            } else {
                FriendViewHolder(ItemFriendBinding.inflate(LayoutInflater.from(parent.context), parent, false))
            }
        }

        override fun onBindViewHolder(holder: RecyclerView.ViewHolder, position: Int) {
            if (getItemViewType(position) == TYPE_HEADER) {
                val h = holder as HeaderViewHolder
                h.binding.tvHeader.text = if (position == 0) getString(R.string.label_incoming) else getString(R.string.label_outgoing)
                h.binding.root.isVisible = if (position == 0) incoming.isNotEmpty() else outgoing.isNotEmpty()
            } else {
                val h = holder as FriendViewHolder
                if (position <= incoming.size) {
                    val req = incoming[position - 1]
                    h.binding.tvFriendName.text = req.fromName
                    h.binding.tvFriendHandle.text = "@${req.fromUsername}"
                    h.binding.tvDistance.text = getString(R.string.action_accept_request)
                    h.binding.tvDistance.isVisible = true
                    h.binding.tvDistance.setTextColor(androidx.core.content.ContextCompat.getColor(this@FriendsActivity, R.color.accent_green))
                    h.itemView.setOnClickListener { onAccept(req) }
                    h.itemView.setOnLongClickListener { onDecline(req); true }
                } else {
                    val req = outgoing[position - incoming.size - 2]
                    h.binding.tvFriendName.text = req.toName
                    h.binding.tvFriendHandle.text = "@${req.toUsername}"
                    h.binding.tvDistance.text = getString(R.string.action_pending)
                    h.binding.tvDistance.isVisible = true
                    h.binding.tvDistance.setTextColor(androidx.core.content.ContextCompat.getColor(this@FriendsActivity, R.color.text_muted))
                }
            }
        }

        override fun getItemCount(): Int {
            var count = 0
            if (incoming.isNotEmpty()) count += incoming.size + 1
            if (outgoing.isNotEmpty()) count += outgoing.size + 1
            return count
        }
    }

    private inner class HeaderViewHolder(val binding: com.fairco.trap.databinding.ItemHeaderBinding) : RecyclerView.ViewHolder(binding.root)

    private inner class SearchResultsAdapter(
        private val list: List<UserSearchResult>,
        private val onClick: (UserSearchResult) -> Unit
    ) : RecyclerView.Adapter<FriendViewHolder>() {
        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) = FriendViewHolder(
            ItemFriendBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        )
        override fun onBindViewHolder(holder: FriendViewHolder, position: Int) {
            val item = list[position]
            holder.binding.tvFriendName.text = item.name
            holder.binding.tvFriendHandle.text = "@${item.username}"
            holder.binding.tvDistance.text = getString(R.string.action_add_friend_short)
            holder.binding.tvDistance.isVisible = true
            holder.binding.tvDistance.setTextColor(androidx.core.content.ContextCompat.getColor(this@FriendsActivity, R.color.accent_cyan))
            holder.itemView.setOnClickListener { onClick(item) }
        }
        override fun getItemCount() = list.size
    }

    private inner class FriendViewHolder(val binding: ItemFriendBinding) : RecyclerView.ViewHolder(binding.root)
}

