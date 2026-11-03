package com.fairco.trap

import android.content.Intent
import android.content.res.ColorStateList
import android.os.Bundle
import android.text.format.DateUtils
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.core.content.ContextCompat
import androidx.core.view.isVisible
import androidx.fragment.app.Fragment
import androidx.fragment.app.viewModels
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.fairco.trap.databinding.FragmentSupportTicketsBinding
import com.fairco.trap.databinding.ItemSupportTicketBinding
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import java.util.*

class SupportTicketsFragment : Fragment() {

    private var _binding: FragmentSupportTicketsBinding? = null
    private val binding get() = _binding!!
    private val viewModel: SupportViewModel by viewModels()

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = FragmentSupportTicketsBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        setupRecyclerView()
        observeViewModel()

        binding.swipeRefresh.setOnRefreshListener {
            viewModel.loadTickets()
        }

        binding.cardNewTicket.setOnClickListener {
            val bottomSheet = NewTicketBottomSheet()
            bottomSheet.show(childFragmentManager, NewTicketBottomSheet.TAG)
        }

        viewModel.loadTickets()
    }

    private fun setupRecyclerView() {
        binding.rvTickets.layoutManager = LinearLayoutManager(requireContext())
    }

    private fun observeViewModel() {
        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
                launch {
                    viewModel.tickets.collectLatest { list ->
                        binding.rvTickets.adapter = TicketsAdapter(list) { ticket ->
                            val intent = Intent(requireContext(), SupportThreadActivity::class.java)
                            intent.putExtra("ticketId", ticket.id)
                            intent.putExtra("ticketNo", ticket.ticketNo)
                            startActivity(intent)
                        }
                        binding.tvEmpty.isVisible = list.isEmpty()
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
                            Toast.makeText(requireContext(), err, Toast.LENGTH_SHORT).show()
                            viewModel.error.value = null
                            binding.swipeRefresh.isRefreshing = false
                        }
                    }
                }
            }
        }
    }

    private inner class TicketsAdapter(
        private val list: List<TicketSummary>,
        private val onClick: (TicketSummary) -> Unit
    ) : RecyclerView.Adapter<TicketViewHolder>() {

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) = TicketViewHolder(
            ItemSupportTicketBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        )

        override fun onBindViewHolder(holder: TicketViewHolder, position: Int) {
            val item = list[position]
            holder.binding.tvTicketNo.text = item.ticketNo
            holder.binding.tvSubject.text = item.subject
            holder.binding.tvStatus.text = item.status.uppercase()
            holder.binding.unreadIndicator.isVisible = item.hasUnreadUser

            val categoryLabel = TicketCategory.entries.find { it.value == item.category }?.let { getString(it.labelRes) } ?: item.category
            holder.binding.tvCategory.text = categoryLabel

            val statusColor = when (item.status) {
                "open", "waiting_admin" -> R.color.accent_cyan
                "answered" -> R.color.accent_green
                "waiting_user" -> R.color.accent_gold
                "closed" -> R.color.text_muted
                else -> R.color.text_muted
            }
            holder.binding.tvStatus.backgroundTintList = ColorStateList.valueOf(ContextCompat.getColor(requireContext(), statusColor))

            val timeMs = item.lastMessageAtEpochMs ?: item.createdAtEpochMs
            timeMs?.let {
                holder.binding.tvLastMessageAt.text = DateUtils.getRelativeTimeSpanString(it)
            }

            holder.itemView.setOnClickListener { onClick(item) }
        }

        override fun getItemCount() = list.size
    }

    private inner class TicketViewHolder(val binding: ItemSupportTicketBinding) : RecyclerView.ViewHolder(binding.root)

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
