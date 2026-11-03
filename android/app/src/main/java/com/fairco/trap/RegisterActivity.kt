package com.fairco.trap

import android.app.DatePickerDialog
import android.os.Bundle
import android.widget.Toast
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.fairco.trap.ui.RadarPrimaryButton
import com.fairco.trap.ui.theme.Radar
import com.fairco.trap.ui.theme.TrappTheme
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.SetOptions
import com.google.firebase.firestore.firestore
import com.google.firebase.functions.FirebaseFunctionsException
import com.google.firebase.functions.functions
import com.fairco.trap.util.LocaleManager
import com.google.firebase.Firebase
import java.text.SimpleDateFormat
import java.util.Calendar

class RegisterActivity : BaseActivity() {
    override val radarBars = true

    private lateinit var auth: FirebaseAuth
    private val functions by lazy { Firebase.functions("europe-west1") }
    private var selectedBirthdate: Calendar? = null
    private var referralCode: String? = null
    private var currentTermsVersion = "v1"

    private var firstName by mutableStateOf("")
    private var lastName by mutableStateOf("")
    private var nickname by mutableStateOf("")
    private var username by mutableStateOf("")
    private var birthdateText by mutableStateOf("")
    private var genderIndex by mutableIntStateOf(0)
    private var email by mutableStateOf("")
    private var password by mutableStateOf("")
    private var confirm by mutableStateOf("")
    private var termsAccepted by mutableStateOf(false)
    private var message by mutableStateOf("")
    private var busy by mutableStateOf(false)
    /** Terms dialog content (title to body) while it is open. */
    private var termsDialog by mutableStateOf<Pair<String, String>?>(null)

    companion object {
        /** Minimum age required to register. Must be 18 for GDPR / location-tracking compliance. */
        private const val MINIMUM_AGE = 18
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        // Extract referral code from deep link intent (if opened via invite URL)
        referralCode = intent.data
            ?.getQueryParameter("ref")
            ?.takeIf { it.isNotBlank() }

        super.onCreate(savedInstanceState)
        auth = FirebaseAuth.getInstance()

        // Fetch terms metadata — pass device locale so the correct translation is returned
        val deviceLocale = java.util.Locale.getDefault().language
        functions.getHttpsCallable("getTermsAndConditions").call(hashMapOf("locale" to deviceLocale))
            .addOnSuccessListener { result ->
                val data = result.getData() as? Map<*, *>
                currentTermsVersion = data?.get("version") as? String ?: "v1"
            }

        setContent { TrappTheme { RegisterScreen() } }
    }

    @Composable
    private fun RegisterScreen() {
        val genders = remember { resources.getStringArray(R.array.gender_options).toList() }
        AuthPage(title = stringResource(R.string.action_register), onBack = { finish() }) {
            Text(stringResource(R.string.msg_register_explanation), color = Radar.TextSec, fontSize = 15.sp, lineHeight = 21.sp)
            Spacer(Modifier.height(4.dp))
            AuthField(firstName, { firstName = it }, stringResource(R.string.label_first_name))
            AuthField(lastName, { lastName = it }, stringResource(R.string.label_last_name))
            AuthField(nickname, { nickname = it }, stringResource(R.string.label_nickname))
            AuthField(username, { username = it }, stringResource(R.string.label_username))
            AuthPickerField(birthdateText, stringResource(R.string.label_birthdate), ::pickBirthdate)
            GenderPicker(genders)
            TermsRow()
            AuthField(email, { email = it }, stringResource(R.string.label_email), keyboardType = KeyboardType.Email)
            AuthField(password, { password = it }, stringResource(R.string.label_password), keyboardType = KeyboardType.Password, password = true)
            AuthField(
                confirm, { confirm = it }, stringResource(R.string.label_confirm_password),
                keyboardType = KeyboardType.Password, password = true, imeAction = ImeAction.Done,
            )
            if (message.isNotEmpty()) {
                if (busy) AuthStatusLine(message) else AuthErrorBox(message)
            }
            RadarPrimaryButton(stringResource(R.string.action_register), { register(genders) }, Modifier.fillMaxWidth(), enabled = !busy)
        }
        termsDialog?.let { (title, content) ->
            RadarDialog(
                title = title,
                onDismiss = { termsDialog = null },
                confirmLabel = stringResource(R.string.action_close),
                onConfirm = { termsDialog = null },
            ) {
                Text(content, color = Radar.TextSec, fontSize = 14.sp, modifier = Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState()))
            }
        }
    }

    @Composable
    private fun GenderPicker(genders: List<String>) {
        var open by remember { mutableStateOf(false) }
        Box {
            AuthPickerField(genders.getOrElse(genderIndex) { "" }, stringResource(R.string.label_optional_gender)) { open = true }
            DropdownMenu(expanded = open, onDismissRequest = { open = false }, modifier = Modifier.background(Radar.Surface2)) {
                genders.forEachIndexed { i, g ->
                    DropdownMenuItem(
                        text = { Text(g, color = if (i == genderIndex) Radar.Accent else Radar.Text) },
                        onClick = { genderIndex = i; open = false },
                    )
                }
            }
        }
    }

    @Composable
    private fun TermsRow() {
        Column {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(
                    checked = termsAccepted,
                    onCheckedChange = { termsAccepted = it },
                    colors = CheckboxDefaults.colors(
                        checkedColor = Radar.Accent, uncheckedColor = Radar.TextMuted, checkmarkColor = Radar.OnAccent,
                    ),
                )
                Text(stringResource(R.string.label_accept_terms_full), color = Radar.Text, fontSize = 14.sp, modifier = Modifier.weight(1f))
            }
            RadarTextAction(stringResource(R.string.label_view_terms), ::showTermsDialog, Modifier.padding(start = 4.dp))
        }
    }

    private fun pickBirthdate() {
        val calendar = Calendar.getInstance()
        val year = calendar.get(Calendar.YEAR)
        val month = calendar.get(Calendar.MONTH)
        val day = calendar.get(Calendar.DAY_OF_MONTH)

        DatePickerDialog(this, { _, y, m, d ->
            val selected = Calendar.getInstance()
            selected.set(y, m, d)
            selectedBirthdate = selected
            val format = SimpleDateFormat("yyyy-MM-dd", java.util.Locale.getDefault())
            birthdateText = format.format(selected.time)
        }, year, month, day).show()
    }

    private fun register(genders: List<String>) {
        message = ""

        val firstName = firstName.trim()
        val lastName = lastName.trim()
        val nickname = nickname.trim()
        val username = username.trim().lowercase()
        val birthdateStr = birthdateText.trim()
        val gender = if (genderIndex == 0) null else genders[genderIndex]
        val email = email.trim()
        val password = password
        val confirm = confirm

        // Validation
        if (firstName.isBlank() || lastName.isBlank() || nickname.isBlank() || username.isBlank() || birthdateStr.isBlank() || email.isBlank() || password.isBlank()) {
            message = getString(R.string.error_register_fields_empty)
            return
        }

        if (!termsAccepted) {
            message = getString(R.string.error_terms_not_accepted)
            return
        }

        if (password.length < 8) {
            message = getString(R.string.error_password_too_short)
            return
        }

        if (password != confirm) {
            message = getString(R.string.error_passwords_dont_match)
            return
        }

        val birthdate = selectedBirthdate
        if (birthdate == null) {
            message = getString(R.string.error_birthdate_mandatory)
            return
        }

        val age = calculateAge(birthdate)
        if (age < 0) {
            message = getString(R.string.error_invalid_birthdate)
            return
        }

        // Enforce minimum age. The game involves real-world location tracking and
        // player-vs-player interactions, so we require players to be at least 18.
        if (age < MINIMUM_AGE) {
            message = getString(R.string.error_too_young, MINIMUM_AGE)
            return
        }

        busy = true
        message = getString(R.string.status_checking_username)

        // 1. Check if username is unique
        functions.getHttpsCallable("checkUsernameAvailability").call(mapOf("username" to username))
            .addOnSuccessListener { availabilityResult ->
                val available = (availabilityResult.getData() as? Map<*, *>)?.get("available") as? Boolean ?: false

                if (!available) {
                    busy = false
                    message = getString(R.string.error_username_taken)
                    return@addOnSuccessListener
                }

                // 2. If available, proceed with Firebase Auth creation
                message = getString(R.string.status_registering)
                auth.createUserWithEmailAndPassword(email, password)
                    .addOnSuccessListener { result ->
                        val user = result.user
                        // Send locale-aware verification email via backend custom template.
                        val locale = LocaleManager.apiLang(this)
                        functions.getHttpsCallable("sendEmailVerificationCustom")
                            .call(hashMapOf("locale" to locale))
                            .addOnSuccessListener {
                                functions.getHttpsCallable("recordVerificationSent").call()
                                    .addOnFailureListener { /* non-critical */ }
                            }
                            .addOnFailureListener {
                                // Fall back to Firebase built-in if backend call fails
                                user?.sendEmailVerification()
                                    ?.addOnSuccessListener {
                                        functions.getHttpsCallable("recordVerificationSent").call()
                                            .addOnFailureListener { /* non-critical */ }
                                    }
                            }

                        val data = mapOf(
                            "platform" to "android",
                            "firstName" to firstName,
                            "lastName" to lastName,
                            "username" to username,
                            "birthDate" to birthdateStr,
                            "gender" to gender,
                            "age" to age,
                            "acceptedTerms" to true,
                            "acceptedTermsVersion" to currentTermsVersion,
                            "acceptedTermsAt" to System.currentTimeMillis(),
                            "displayName" to nickname
                        )

                        // 3. Save details to Firestore directly
                        if (user != null) {
                            Firebase.firestore.collection("users").document(user.uid)
                                .set(data, SetOptions.merge())
                                .addOnCompleteListener {
                                    // 4. Call bootstrapProfile after Firestore write attempt
                                    functions.getHttpsCallable("bootstrapProfile")
                                        .call(data)
                                        .addOnCompleteListener {
                                            // 5. Claim referral if user came via invite link
                                            val ref = referralCode
                                            if (!ref.isNullOrBlank()) {
                                                functions.getHttpsCallable("claimReferral")
                                                    .call(mapOf("referralCode" to ref))
                                                    .addOnCompleteListener { /* silent — non-critical */ }
                                            }
                                            Toast.makeText(this, getString(R.string.msg_verification_email_sent), Toast.LENGTH_LONG).show()
                                            auth.signOut()
                                            finish()
                                        }
                                }
                        }
                    }
                    .addOnFailureListener {
                        busy = false
                        message = it.message ?: getString(R.string.error_registration_failed_plain)
                    }
            }
            .addOnFailureListener {
                busy = false
                message = getString(R.string.error_username_verify_failed, extractError(it))
            }
    }

    private fun showTermsDialog() {
        val deviceLocale = java.util.Locale.getDefault().language
        functions.getHttpsCallable("getTermsAndConditions").call(hashMapOf("locale" to deviceLocale))
            .addOnSuccessListener { result ->
                val data = result.getData() as? Map<*, *>
                val content = data?.get("content") as? String ?: getString(R.string.msg_no_terms_available)
                val title = data?.get("title") as? String ?: getString(R.string.title_terms_conditions)
                termsDialog = title to content
            }
            .addOnFailureListener {
                Toast.makeText(this, getString(R.string.error_load_terms_failed), Toast.LENGTH_SHORT).show()
            }
    }

    private fun calculateAge(birthdate: Calendar): Int {
        val today = Calendar.getInstance()
        var age = today.get(Calendar.YEAR) - birthdate.get(Calendar.YEAR)
        if (today.get(Calendar.DAY_OF_YEAR) < birthdate.get(Calendar.DAY_OF_YEAR)) {
            age--
        }
        return age
    }

    private fun extractError(throwable: Throwable): String {
        return if (throwable is FirebaseFunctionsException) {
            throwable.details?.toString() ?: throwable.message ?: getString(R.string.error_generic_retry)
        } else {
            throwable.message ?: getString(R.string.error_generic_retry)
        }
    }
}
