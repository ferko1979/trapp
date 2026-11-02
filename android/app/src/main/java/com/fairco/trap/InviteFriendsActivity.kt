package com.fairco.trap

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.viewModels
import androidx.lifecycle.lifecycleScope
import com.fairco.trap.databinding.FragmentInviteFriendsBinding
import com.google.android.material.snackbar.Snackbar
import kotlinx.coroutines.launch
import java.util.Locale

/**
 * Share-only invite screen. The recipient is picked in the target app
 * (SMS, WhatsApp, e-mail…), so TRAPP never needs access to the contacts.
 */
class InviteFriendsActivity : BaseActivity() {

    private lateinit var binding: FragmentInviteFriendsBinding
    private val vm: InviteViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = FragmentInviteFriendsBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.toolbar.setNavigationOnClickListener { finish() }

        // Share channel buttons
        binding.btnSendSms.setOnClickListener       { sendSms() }
        binding.btnShare.setOnClickListener         { openShareSheet() }
        binding.btnShareWhatsapp.setOnClickListener { shareViaWhatsApp() }
        binding.btnShareViber.setOnClickListener    { shareViaViber() }
        binding.btnShareEmail.setOnClickListener    { shareViaEmail() }

        lifecycleScope.launch {
            vm.inviteConfig.collect { cfg ->
                binding.tvMessagePreview.text =
                    cfg?.buildFullMessage() ?: getString(R.string.msg_loading_invite)
            }
        }

        // Load invite config with current locale
        val lang = Locale.getDefault().language.take(2)
        vm.loadInviteConfig(lang)
    }

    // ── Share channels ────────────────────────────────────────────────────────

    private fun sendSms() {
        val message = vm.buildInviteMessage(forSms = true)
        try {
            startActivity(Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:")).apply {
                putExtra("sms_body", message)
            })
        } catch (e: Exception) {
            openShareSheet()
        }
    }

    private fun openShareSheet() {
        val message = vm.buildInviteMessage(forSms = false)
        startActivity(Intent.createChooser(
            Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_TEXT, message)
            },
            getString(R.string.action_invite_via)
        ))
    }

    /**
     * Opens WhatsApp with the invite message pre-filled; the user picks the chat there.
     */
    private fun shareViaWhatsApp() {
        val message = vm.buildInviteMessage(forSms = false)
        try {
            startActivity(Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_TEXT, message)
                setPackage("com.whatsapp")
            })
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
        val intent = Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:")).apply {
            putExtra(Intent.EXTRA_SUBJECT, getString(R.string.invite_email_subject))
            putExtra(Intent.EXTRA_TEXT, message)
        }
        startActivity(Intent.createChooser(intent, getString(R.string.action_invite_via_email)))
    }
}
