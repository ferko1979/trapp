package com.fairco.trap

import android.content.Intent
import android.content.res.ColorStateList
import android.os.Bundle
import android.view.LayoutInflater
import android.view.ViewGroup
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
import com.fairco.trap.databinding.ActivitySupportTicketsBinding
import com.fairco.trap.databinding.ItemSupportTicketBinding
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.*

class SupportTicketsActivity : BaseActivity() {

    private lateinit var binding: ActivitySupportTicketsBinding
    private val viewModel: SupportViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivitySupportTicketsBinding.inflate(layoutInflater)
        setContentView(binding.root)

        setSupportActionBar(binding.toolbar)
        supportActionBar?.setDisplayHomeAsUpEnabled(true)
        binding.toolbar.setNavigationOnClickListener { finish() }

        setupRecyclerView()
        observeViewModel()

        binding.swipeRefresh.setOnRefreshListener {
            viewModel.loadTickets()
        }

        binding.fabNewTicket.setOnClickListener {
            startActivity(Intent(this, CreateSupportTicketActivity::class.java))
        }

        viewModel.loadTickets()
    }

    private fun setupRecyclerView() {
        binding.rvTickets.layoutManager = LinearLayoutManager(this)
    }

    private fun observeViewModel() {
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                launch {
                    viewModel.tickets.collectLatest { list ->
                        binding.rvTickets.adapter = TicketsAdapter(list) { ticket ->
                            val intent = Intent(this@SupportTicketsActivity, SupportThreadActivity::class.java)
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
                            Toast.makeText(this@SupportTicketsActivity, err, Toast.LENGTH_SHORT).show()
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

        private val dateFormat = SimpleDateFormat("MMM dd, HH:mm", Locale.getDefault())

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) = TicketViewHolder(
            ItemSupportTicketBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        )

        override fun onBindViewHolder(holder: TicketViewHolder, position: Int) {
            val item = list[position]
            holder.binding.tvTicketNo.text = "#${item.ticketNo}"
            holder.binding.tvSubject.text = item.subject
            holder.binding.tvStatus.text = item.status.uppercase()
            holder.binding.unreadIndicator.isVisible = item.hasUnreadUser

            val categoryLabel = TicketCategory.entries.find { it.value == item.category }?.let { getString(it.labelRes) } ?: item.category
            holder.binding.tvCategory.text = categoryLabel

            val statusColor = when (item.status) {
                "open", "waiting_admin" -> R.color.accent_cyan
                "waiting_user" -> R.color.accent_red
                "answered" -> R.color.accent_green
                "closed" -> R.color.text_muted
                else -> R.color.text_muted
            }
            holder.binding.tvStatus.backgroundTintList = ColorStateList.valueOf(ContextCompat.getColor(this@SupportTicketsActivity, statusColor))

            item.lastMessageAtEpochMs?.let {
                holder.binding.tvLastMessageAt.text = getString(R.string.support_last_update, dateFormat.format(Date(it)))
            } ?: run {
                item.createdAtEpochMs?.let {
                    holder.binding.tvLastMessageAt.text = getString(R.string.support_created, dateFormat.format(Date(it)))
                }
            }

            holder.itemView.setOnClickListener { onClick(item) }
        }

        override fun getItemCount() = list.size
    }

    private inner class TicketViewHolder(val binding: ItemSupportTicketBinding) : RecyclerView.ViewHolder(binding.root)
}

