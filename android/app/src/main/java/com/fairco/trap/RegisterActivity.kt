package com.fairco.trap

import android.annotation.SuppressLint
import android.app.DatePickerDialog
import android.content.Intent
import android.os.Bundle
import android.widget.*
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

    private lateinit var auth: FirebaseAuth
    private val functions by lazy { Firebase.functions("europe-west1") }
    private var selectedBirthdate: Calendar? = null

    companion object {
        /** Minimum age required to register. Must be 18 for GDPR / location-tracking compliance. */
        private const val MINIMUM_AGE = 18
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        // Extract referral code from deep link intent (if opened via invite URL)
        val referralCode: String? = intent.data
            ?.getQueryParameter("ref")
            ?.takeIf { it.isNotBlank() }

        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_register)

        auth = FirebaseAuth.getInstance()

        val etFirstName = findViewById<EditText>(R.id.etFirstName)
        val etLastName = findViewById<EditText>(R.id.etLastName)
        val etNickname = findViewById<EditText>(R.id.etNickname)
        val etUsername = findViewById<EditText>(R.id.etUsername)
        val etBirthdate = findViewById<EditText>(R.id.etBirthdate)
        val spGender = findViewById<Spinner>(R.id.spGender)
        val etEmail = findViewById<EditText>(R.id.etEmail)
        val etPassword = findViewById<EditText>(R.id.etPassword)
        val etConfirmPassword = findViewById<EditText>(R.id.etConfirmPassword)
        val cbTerms = findViewById<CheckBox>(R.id.cbTerms)
        val tvViewTerms = findViewById<TextView>(R.id.tvViewTerms)
        val tvError = findViewById<TextView>(R.id.tvError)
        val btnRegister = findViewById<Button>(R.id.btnDoRegister)

        var currentTermsVersion = "v1"

        // Fetch terms metadata — pass device locale so the correct translation is returned
        val deviceLocale = java.util.Locale.getDefault().language
        functions.getHttpsCallable("getTermsAndConditions").call(hashMapOf("locale" to deviceLocale))
            .addOnSuccessListener { result ->
                val data = result.getData() as? Map<*, *>
                currentTermsVersion = data?.get("version") as? String ?: "v1"
            }

        tvViewTerms.setOnClickListener {
            showTermsDialog()
        }

        // Setup Gender Spinner (Optional)
        val adapter = ArrayAdapter.createFromResource(this, R.array.gender_options, android.R.layout.simple_spinner_item)
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
        spGender.adapter = adapter

        // Setup Date Picker for Birthdate (Mandatory)
        etBirthdate.setOnClickListener {
            val calendar = Calendar.getInstance()
            val year = calendar.get(Calendar.YEAR)
            val month = calendar.get(Calendar.MONTH)
            val day = calendar.get(Calendar.DAY_OF_MONTH)

            DatePickerDialog(this, { _, y, m, d ->
                val selected = Calendar.getInstance()
                selected.set(y, m, d)
                selectedBirthdate = selected
                val format = SimpleDateFormat("yyyy-MM-dd", java.util.Locale.getDefault())
                etBirthdate.setText(format.format(selected.time))
            }, year, month, day).show()
        }

        btnRegister.setOnClickListener {
            tvError.text = ""

            val firstName = etFirstName.text.toString().trim()
            val lastName = etLastName.text.toString().trim()
            val nickname = etNickname.text.toString().trim()
            val username = etUsername.text.toString().trim().lowercase()
            val birthdateStr = etBirthdate.text.toString().trim()
            val gender = if (spGender.selectedItemPosition == 0) null else spGender.selectedItem.toString()
            val email = etEmail.text.toString().trim()
            val password = etPassword.text.toString()
            val confirm = etConfirmPassword.text.toString()

            // Validation
            if (firstName.isBlank() || lastName.isBlank() || nickname.isBlank() || username.isBlank() || birthdateStr.isBlank() || email.isBlank() || password.isBlank()) {
                tvError.text = getString(R.string.error_register_fields_empty)
                return@setOnClickListener
            }

            if (!cbTerms.isChecked) {
                tvError.text = getString(R.string.error_terms_not_accepted)
                return@setOnClickListener
            }

            if (password.length < 8) {
                tvError.text = getString(R.string.error_password_too_short)
                return@setOnClickListener
            }

            if (password != confirm) {
                tvError.text = getString(R.string.error_passwords_dont_match)
                return@setOnClickListener
            }

            val birthdate = selectedBirthdate
            if (birthdate == null) {
                tvError.text = getString(R.string.error_birthdate_mandatory)
                return@setOnClickListener
            }

            val age = calculateAge(birthdate)
            if (age < 0) {
                tvError.text = getString(R.string.error_invalid_birthdate)
                return@setOnClickListener
            }

            // Enforce minimum age. The game involves real-world location tracking and
            // player-vs-player interactions, so we require players to be at least 18.
            if (age < MINIMUM_AGE) {
                tvError.text = getString(R.string.error_too_young, MINIMUM_AGE)
                return@setOnClickListener
            }

            btnRegister.isEnabled = false
            tvError.text = getString(R.string.status_checking_username)

            // 1. Check if username is unique
            functions.getHttpsCallable("checkUsernameAvailability").call(mapOf("username" to username))
                .addOnSuccessListener { availabilityResult ->
                    val available = (availabilityResult.getData() as? Map<*, *>)?.get("available") as? Boolean ?: false
                    
                    if (!available) {
                        btnRegister.isEnabled = true
                        tvError.text = getString(R.string.error_username_taken)
                        return@addOnSuccessListener
                    }

                    // 2. If available, proceed with Firebase Auth creation
                    tvError.text = getString(R.string.status_registering)
                    auth.createUserWithEmailAndPassword(email, password)
                        .addOnSuccessListener { result ->
                            val user = result.user
                            // Send locale-aware verification email via backend custom template.
                            val locale = LocaleManager.getLocale(this)
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
                                                if (!referralCode.isNullOrBlank()) {
                                                    functions.getHttpsCallable("claimReferral")
                                                        .call(mapOf("referralCode" to referralCode))
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
                            btnRegister.isEnabled = true
                            tvError.text = it.message ?: getString(R.string.error_registration_failed_plain)
                        }
                }
                .addOnFailureListener {
                    btnRegister.isEnabled = true
                    tvError.text = getString(R.string.error_username_verify_failed, extractError(it))
                }
        }

        findViewById<Button>(R.id.btnBack).setOnClickListener {
            finish()
        }
    }

    private fun showTermsDialog() {
        val deviceLocale = java.util.Locale.getDefault().language
        functions.getHttpsCallable("getTermsAndConditions").call(hashMapOf("locale" to deviceLocale))
            .addOnSuccessListener { result ->
                val data = result.getData() as? Map<*, *>
                val content = data?.get("content") as? String ?: getString(R.string.msg_no_terms_available)
                val title = data?.get("title") as? String ?: getString(R.string.title_terms_conditions)
                
                val tv = TextView(this).apply {
                    text = content
                    setPadding(40, 40, 40, 40)
                    textSize = 14f
                }
                
                val scrollView = ScrollView(this).apply {
                    addView(tv)
                }

                android.app.AlertDialog.Builder(this)
                    .setTitle(title)
                    .setView(scrollView)
                    .setPositiveButton(getString(R.string.action_close), null)
                    .show()
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
            throwable.details?.toString() ?: throwable.message ?: "Unknown error"
        } else {
            throwable.message ?: "Unknown error"
        }
    }
}
