package com.fairco.trap

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import com.fairco.trap.ui.theme.TrappTheme
import java.util.Locale

/**
 * Share-only invite screen. The recipient is picked in the target app
 * (SMS, WhatsApp, e-mail…), so TRAPP never needs access to the contacts.
 */
class InviteFriendsActivity : BaseActivity() {

    override val radarBars = true
    private val vm: InviteViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            TrappTheme {
                val config by vm.inviteConfig.collectAsState()
                InviteScreen(
                    config = config,
                    onBack = { finish() },
                    onCopyCode = ::copyCode,
                    onShare = ::openShareSheet,
                    onSms = ::sendSms,
                    onWhatsApp = ::shareViaWhatsApp,
                    onViber = ::shareViaViber,
                    onEmail = ::shareViaEmail,
                )
            }
        }

        // Load invite config with current locale
        val lang = Locale.getDefault().language.take(2)
        vm.loadInviteConfig(lang)
    }

    private fun toast(text: String) = Toast.makeText(this, text, Toast.LENGTH_SHORT).show()

    private fun copyCode(code: String) {
        val cm = getSystemService(ClipboardManager::class.java) ?: return
        cm.setPrimaryClip(ClipData.newPlainText(getString(R.string.invite_code_label), code))
        // Android 13+ shows its own clipboard confirmation
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) toast(getString(R.string.invite_code_copied))
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
            toast(getString(R.string.msg_whatsapp_not_installed))
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
            toast(getString(R.string.msg_viber_not_installed))
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
