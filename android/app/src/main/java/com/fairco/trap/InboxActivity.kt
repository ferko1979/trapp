package com.fairco.trap

import android.os.Bundle
import androidx.activity.viewModels
import androidx.appcompat.app.AppCompatActivity
import com.fairco.trap.BaseActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.viewpager2.adapter.FragmentStateAdapter
import com.fairco.trap.databinding.ActivityInboxBinding
import com.google.android.material.tabs.TabLayoutMediator
import kotlinx.coroutines.launch

class InboxActivity : BaseActivity() {

    private lateinit var binding: ActivityInboxBinding
    private val badgeVm: InboxBadgeViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityInboxBinding.inflate(layoutInflater)
        setContentView(binding.root)

        setSupportActionBar(binding.inboxToolbar)
        supportActionBar?.setDisplayHomeAsUpEnabled(true)
        binding.inboxToolbar.setNavigationOnClickListener { finish() }

        binding.inboxPager.adapter = object : FragmentStateAdapter(this) {
            override fun getItemCount() = 2
            override fun createFragment(position: Int) = when (position) {
                0 -> MessagesListFragment()
                else -> SupportTicketsFragment()
            }
        }

        TabLayoutMediator(binding.inboxTabs, binding.inboxPager) { tab, pos ->
            tab.text = if (pos == 0) "💬 Messages" else "🎫 Support"
        }.attach()

        setupTabBadges()

        // Open directly to Support tab if launched from a ticket action
        val openTab = intent.getIntExtra("openTab", 0)
        binding.inboxPager.currentItem = openTab
    }

    private fun setupTabBadges() {
        lifecycleScope.launch {
            lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
                launch {
                    badgeVm.unreadMessages.collect { count ->
                        val tab = binding.inboxTabs.getTabAt(0) ?: return@collect
                        tab.orCreateBadge.apply {
                            isVisible = count > 0
                            number = count
                            backgroundColor = ContextCompat.getColor(this@InboxActivity, R.color.accent_red)
                        }
                    }
                }
                launch {
                    badgeVm.unreadTickets.collect { count ->
                        val tab = binding.inboxTabs.getTabAt(1) ?: return@collect
                        tab.orCreateBadge.apply {
                            isVisible = count > 0
                            number = count
                            backgroundColor = ContextCompat.getColor(this@InboxActivity, R.color.accent_red)
                        }
                    }
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        // badgeVm.refresh() // No longer needed with real-time listeners
    }
}

