package com.fairco.trap

import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.core.view.isVisible
import androidx.fragment.app.viewModels
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.fairco.trap.databinding.BottomSheetFriendsBinding
import com.fairco.trap.databinding.ItemFriendBinding
import com.google.android.material.bottomsheet.BottomSheetDialogFragment
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

class FriendsBottomSheet(private val onFriendSelected: (Friend) -> Unit) : BottomSheetDialogFragment() {

    private var _binding: BottomSheetFriendsBinding? = null
    private val binding get() = _binding!!
    private val viewModel: FriendsViewModel by viewModels()

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = BottomSheetFriendsBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        
        binding.rvFriends.layoutManager = LinearLayoutManager(requireContext())
        
        observeViewModel()
        
        binding.etSearchFriends.addTextChangedListener(object : TextWatcher {
            override fun afterTextChanged(s: Editable?) {
                filterFriends(s?.toString() ?: "")
            }
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
        })

        viewModel.loadFriends()
    }

    private fun observeViewModel() {
        lifecycleScope.launch {
            viewModel.friends.collectLatest { list ->
                binding.rvFriends.adapter = FriendsAdapter(list)
                binding.progressBar.isVisible = false
            }
        }
        lifecycleScope.launch {
            viewModel.isLoading.collectLatest { loading ->
                binding.progressBar.isVisible = loading
            }
        }
    }

    private fun filterFriends(query: String) {
        val filtered = viewModel.friends.value.filter {
            it.username.contains(query, ignoreCase = true) || it.name.contains(query, ignoreCase = true)
        }
        binding.rvFriends.adapter = FriendsAdapter(filtered)
    }

    private inner class FriendsAdapter(private val list: List<Friend>) : RecyclerView.Adapter<FriendViewHolder>() {
        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) = FriendViewHolder(
            ItemFriendBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        )
        override fun onBindViewHolder(holder: FriendViewHolder, position: Int) {
            val friend = list[position]
            holder.binding.tvFriendName.text = friend.name
            holder.binding.tvFriendHandle.text = "@${friend.username}"
            holder.binding.tvDistance.isVisible = false
            holder.itemView.setOnClickListener {
                onFriendSelected(friend)
                dismiss()
            }
        }
        override fun getItemCount() = list.size
    }

    private inner class FriendViewHolder(val binding: ItemFriendBinding) : RecyclerView.ViewHolder(binding.root)

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }

    companion object {
        const val TAG = "FriendsBottomSheet"
    }
}
