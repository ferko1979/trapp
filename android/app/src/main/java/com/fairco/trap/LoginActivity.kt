package com.fairco.trap

import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.fairco.trap.ui.RadarPrimaryButton
import com.fairco.trap.ui.theme.Radar
import com.fairco.trap.ui.theme.TrappTheme
import com.fairco.trap.util.LocaleManager
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.Firebase
import com.google.firebase.functions.functions

class LoginActivity : BaseActivity() {
    override val radarBars = true

    private lateinit var auth: FirebaseAuth
    private val functions by lazy { Firebase.functions("europe-west1") }
    private lateinit var currentLang: String

    private var email by mutableStateOf("")
    private var password by mutableStateOf("")
    private var error by mutableStateOf("")
    private var statusVisible by mutableStateOf(false)
    private var resendVisible by mutableStateOf(false)
    private var forgotVisible by mutableStateOf(true)
    private var forgotDialog by mutableStateOf(false)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        auth = FirebaseAuth.getInstance()
        currentLang = LocaleManager.getLocale(this)
        // Keep the typed e-mail across the recreate a language change triggers.
        email = savedInstanceState?.getString(KEY_EMAIL).orEmpty()

        setContent {
            TrappTheme {
                AuthPage(title = stringResource(R.string.action_login), onBack = { finish() }) {
                    Text(stringResource(R.string.msg_login_explanation), color = Radar.TextSec, fontSize = 15.sp, lineHeight = 21.sp)
                    Spacer(Modifier.height(4.dp))
                    AuthField(email, { email = it }, stringResource(R.string.label_email), keyboardType = KeyboardType.Email)
                    AuthField(
                        password, { password = it }, stringResource(R.string.label_password),
                        keyboardType = KeyboardType.Password, password = true, imeAction = ImeAction.Done,
                    )
                    if (statusVisible) AuthStatusLine(stringResource(R.string.status_logging_in))
                    if (error.isNotEmpty()) AuthErrorBox(error)
                    RadarPrimaryButton(stringResource(R.string.action_login), ::login, Modifier.fillMaxWidth())
                    if (resendVisible) {
                        RadarSecondaryButton(stringResource(R.string.action_resend_verification), ::resendVerification, Modifier.fillMaxWidth())
                    }
                    if (forgotVisible) {
                        RadarTextAction(stringResource(R.string.action_forgot_password), ::forgotPassword)
                    }
                    Spacer(Modifier.height(12.dp))
                    // Only a user pick reaches here, so a change always recreates in the new locale.
                    AuthLanguagePicker(currentLang) { selected ->
                        if (selected != currentLang) setAppLocale(selected) // saves preference + recreates
                    }
                }
                if (forgotDialog) ForgotPasswordDialog()
            }
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putString(KEY_EMAIL, email)
    }

    private companion object {
        const val KEY_EMAIL = "login_email"
    }

    @Composable
    private fun ForgotPasswordDialog() {
        var input by remember { mutableStateOf("") }
        RadarDialog(
            title = stringResource(R.string.action_forgot_password),
            onDismiss = { forgotDialog = false },
            confirmLabel = stringResource(R.string.action_send),
            onConfirm = {
                forgotDialog = false
                val emailInput = input.trim()
                if (emailInput.isNotBlank()) sendPasswordReset(emailInput)
                else error = getString(R.string.error_enter_email)
            },
            dismissLabel = stringResource(R.string.action_cancel),
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(stringResource(R.string.error_enter_email), color = Radar.TextSec)
                AuthField(input, { input = it }, stringResource(R.string.label_email), keyboardType = KeyboardType.Email, imeAction = ImeAction.Done)
            }
        }
    }

    private fun login() {
        error = ""
        statusVisible = true
        resendVisible = false

        val e = email.trim()
        val p = password

        if (e.isBlank() || p.isBlank()) {
            error = getString(R.string.error_login_fields_empty)
            statusVisible = false
            return
        }

        auth.signInWithEmailAndPassword(e, p)
            .addOnSuccessListener { result ->
                val user = result.user
                if (user != null && !user.isEmailVerified) {
                    auth.signOut()
                    error = getString(R.string.error_email_not_verified)
                    statusVisible = false
                    resendVisible = true
                    return@addOnSuccessListener
                }
                Toast.makeText(this, getString(R.string.msg_login_success), Toast.LENGTH_SHORT).show()
                startActivity(Intent(this, GameActivity::class.java))
                finishAffinity()
            }
            .addOnFailureListener {
                statusVisible = false
                error = ServerErrorText.of(this, it, R.string.error_login_failed)
                forgotVisible = true
            }
    }

    private fun resendVerification() {
        val e = email.trim()
        val p = password

        if (e.isBlank() || p.isBlank()) {
            error = getString(R.string.error_login_fields_empty)
            return
        }

        auth.signInWithEmailAndPassword(e, p)
            .addOnSuccessListener { result ->
                val user = result.user
                // Send locale-aware verification email via backend custom template.
                functions.getHttpsCallable("sendEmailVerificationCustom")
                    .call(hashMapOf("locale" to currentLang))
                    .addOnSuccessListener {
                        functions.getHttpsCallable("recordVerificationSent").call()
                            .addOnFailureListener { /* non-critical */ }
                        Toast.makeText(this, getString(R.string.msg_verification_email_sent), Toast.LENGTH_LONG).show()
                        auth.signOut()
                        resendVisible = false
                    }
                    .addOnFailureListener {
                        // Fall back to Firebase built-in
                        user?.sendEmailVerification()
                            ?.addOnSuccessListener {
                                functions.getHttpsCallable("recordVerificationSent").call()
                                    .addOnFailureListener { /* non-critical */ }
                                Toast.makeText(this, getString(R.string.msg_verification_email_sent), Toast.LENGTH_LONG).show()
                                auth.signOut()
                                resendVisible = false
                            }
                            ?.addOnFailureListener { ex ->
                                error = ServerErrorText.of(this, ex, R.string.auth_verification_send_failed)
                                auth.signOut()
                            }
                    }
            }
            .addOnFailureListener {
                error = ServerErrorText.of(this, it, R.string.error_login_failed)
                forgotVisible = true
            }
    }

    private fun forgotPassword() {
        val e = email.trim()
        if (e.isBlank()) {
            forgotDialog = true
            return
        }
        sendPasswordReset(e)
    }

    private fun sendPasswordReset(address: String) {
        // Same toast either way so the response does not reveal whether the account exists.
        functions.getHttpsCallable("sendPasswordResetCustom")
            .call(hashMapOf("email" to address, "locale" to currentLang))
            .addOnSuccessListener {
                Toast.makeText(this, getString(R.string.msg_reset_password_sent), Toast.LENGTH_LONG).show()
            }
            .addOnFailureListener {
                Toast.makeText(this, getString(R.string.msg_reset_password_sent), Toast.LENGTH_LONG).show()
            }
    }
}
