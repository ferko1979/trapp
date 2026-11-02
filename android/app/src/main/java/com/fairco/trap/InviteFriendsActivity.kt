package com.fairco.trap

import android.Manifest
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.View
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.appcompat.app.AppCompatActivity
import com.fairco.trap.BaseActivity
import androidx.core.widget.doOnTextChanged
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import com.fairco.trap.databinding.FragmentInviteFriendsBinding
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.snackbar.Snackbar
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch
import java.util.Locale

class InviteFriendsActivity : BaseActivity() {

    private lateinit var binding: FragmentInviteFriendsBinding
    private val vm: InviteViewModel by viewModels()
    private lateinit var adapter: ContactsAdapter

    private val requestPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted) vm.loadContacts() else showPermissionRationale()
        }

    private val prefs by lazy {
        getSharedPreferences("invite_prefs", Context.MODE_PRIVATE)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = FragmentInviteFriendsBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.toolbar.setNavigationOnClickListener { finish() }

        // RecyclerView
        adapter = ContactsAdapter { contact -> vm.toggleContact(contact) }
        binding.rvContacts.layoutManager = LinearLayoutManager(this)
        binding.rvContacts.adapter = adapter

        // Search
        binding.etSearch.doOnTextChanged { text, _, _, _ ->
            vm.setSearchQuery(text?.toString() ?: "")
        }

        binding.btnSelectAll.setOnClickListener { vm.selectAll() }
        binding.btnClearAll.setOnClickListener  { vm.clearSelection() }

        // Share channel buttons
        binding.btnSendSms.setOnClickListener     { sendSms() }
        binding.btnShare.setOnClickListener       { openShareSheet() }
        binding.btnShareWhatsapp.setOnClickListener { shareViaWhatsApp() }
        binding.btnShareViber.setOnClickListener    { shareViaViber() }
        binding.btnShareEmail.setOnClickListener    { shareViaEmail() }

        // Observe state
        lifecycleScope.launch {
            vm.displayContacts.collect { list ->
                adapter.submitList(list.toList())
            }
        }

        lifecycleScope.launch {
            vm.selectedCount.collect { count ->
                binding.tvSelectedCount.text =
                    if (count == 0) getString(R.string.msg_tap_contacts_to_select)
                    else if (count == 1) getString(R.string.msg_contacts_selected, count)
                    else getString(R.string.msg_contacts_selected_plural, count)

                val hasSelection = count > 0
                binding.btnSendSms.isEnabled     = hasSelection
                binding.btnShare.isEnabled       = hasSelection
                binding.btnShareWhatsapp.isEnabled = hasSelection
                binding.btnShareViber.isEnabled    = hasSelection
                binding.btnShareEmail.isEnabled    = hasSelection
            }
        }

        lifecycleScope.launch {
            vm.inviteConfig.collect { cfg ->
                binding.tvMessagePreview.text =
                    cfg?.buildFullMessage() ?: getString(R.string.msg_loading_invite)
            }
        }

        // Load invite config with current locale
        val lang = Locale.getDefault().language.take(2)
        vm.loadInviteConfig(lang)

        checkAndLoadContacts()
    }

    // ── Contacts permission ───────────────────────────────────────────────────

    private fun checkAndLoadContacts() {
        val seen = prefs.getBoolean("contacts_disclosure_seen", false)
        if (!seen) {
            MaterialAlertDialogBuilder(this)
                .setTitle(getString(R.string.title_contacts_disclosure))
                .setMessage(getString(R.string.msg_contacts_disclosure))
                .setPositiveButton(getString(R.string.action_got_it_continue)) { _, _ ->
                    prefs.edit().putBoolean("contacts_disclosure_seen", true).apply()
                    requestPermissionLauncher.launch(Manifest.permission.READ_CONTACTS)
                }
                .setNegativeButton(getString(R.string.action_cancel), null)
                .show()
        } else {
            when {
                ContactPermissionHelper.hasPermission(this) -> vm.loadContacts()
                else -> requestPermissionLauncher.launch(Manifest.permission.READ_CONTACTS)
            }
        }
    }

    private fun showPermissionRationale() {
        MaterialAlertDialogBuilder(this)
            .setTitle(getString(R.string.title_contacts_permission))
            .setMessage(getString(R.string.msg_contacts_permission_rationale))
            .setPositiveButton(getString(R.string.action_allow)) { _, _ ->
                requestPermissionLauncher.launch(Manifest.permission.READ_CONTACTS)
            }
            .setNegativeButton(getString(R.string.action_not_now), null)
            .show()
    }

    // ── Share channels ────────────────────────────────────────────────────────

    private fun sendSms() {
        val selected = vm.getSelectedContacts()
        if (selected.isEmpty()) return
        val message = vm.buildInviteMessage(forSms = true)

        if (selected.size == 1) {
            val uri = Uri.parse("smsto:${selected.first().primaryPhone}")
            startActivity(Intent(Intent.ACTION_SENDTO, uri).apply {
                putExtra("sms_body", message)
            })
        } else {
            MaterialAlertDialogBuilder(this)
                .setTitle(getString(R.string.msg_send_to_contacts_title, selected.size))
                .setMessage(getString(R.string.msg_send_to_contacts_body, message))
                .setPositiveButton(getString(R.string.action_send_sms)) { _, _ ->
                    sendSmsToQueue(selected, message)
                }
                .setNegativeButton(getString(R.string.action_cancel), null)
                .show()
        }
    }

    private fun sendSmsToQueue(contacts: List<DeviceContact>, message: String) {
        val first = contacts.first()
        startActivity(Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:${first.primaryPhone}")).apply {
            putExtra("sms_body", message)
        })
        if (contacts.size > 1) {
            Snackbar.make(binding.root,
                getString(R.string.msg_sent_to_next_contact, first.displayName),
                Snackbar.LENGTH_LONG).show()
        }
    }

    private fun openShareSheet() {
        val message  = vm.buildInviteMessage(forSms = false)
        val phones = vm.getSelectedContacts().joinToString(", ") { it.primaryPhone }
        startActivity(Intent.createChooser(
            Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_TEXT, message)
                putExtra(Intent.EXTRA_PHONE_NUMBER, phones)
            },
            getString(R.string.action_invite_via)
        ))
    }

    /**
     * Opens WhatsApp with the invite message pre-filled.
     * If a single contact is selected, opens a direct chat to their number.
     * Otherwise opens WhatsApp's share chooser.
     */
    private fun shareViaWhatsApp() {
        val message = vm.buildInviteMessage(forSms = false)
        val selected = vm.getSelectedContacts()

        try {
            if (selected.size == 1) {
                // Direct chat to a specific number (international format)
                val phone = selected.first().primaryPhone.replace(Regex("[^\\d+]"), "")
                val intent = Intent(Intent.ACTION_VIEW,
                    Uri.parse("https://wa.me/$phone?text=${Uri.encode(message)}"))
                intent.setPackage("com.whatsapp")
                startActivity(intent)
            } else {
                // Generic WhatsApp share sheet
                startActivity(Intent(Intent.ACTION_SEND).apply {
                    type = "text/plain"
                    putExtra(Intent.EXTRA_TEXT, message)
                    setPackage("com.whatsapp")
                })
            }
        } catch (e: Exception) {
            // WhatsApp not installed — fall back to generic share
            openShareSheet()
            Snackbar.make(binding.root, getString(R.string.msg_whatsapp_not_installed), Snackbar.LENGTH_SHORT).show()
        }
    }

    /**
     * Opens Viber with the invite message pre-filled.
     */
    private fun shareViaViber() {
        val message = vm.buildInviteMessage(forSms = false)
        try {
            startActivity(Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_TEXT, message)
                setPackage("com.viber.voip")
            })
        } catch (e: Exception) {
            openShareSheet()
            Snackbar.make(binding.root, getString(R.string.msg_viber_not_installed), Snackbar.LENGTH_SHORT).show()
        }
    }

    /**
     * Opens the device email client with the invite message.
     */
    private fun shareViaEmail() {
        val message = vm.buildInviteMessage(forSms = false)
        val selected = vm.getSelectedContacts()
        // Use email addresses if contacts have them; otherwise blank To:
        val intent = Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:")).apply {
            putExtra(Intent.EXTRA_SUBJECT, getString(R.string.invite_email_subject))
            putExtra(Intent.EXTRA_TEXT, message)
        }
        startActivity(Intent.createChooser(intent, getString(R.string.action_invite_via_email)))
    }
}

