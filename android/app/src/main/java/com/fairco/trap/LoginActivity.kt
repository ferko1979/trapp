package com.fairco.trap

import android.content.Intent
import android.os.Bundle
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast
import com.fairco.trap.util.LocaleManager
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.Firebase
import com.google.firebase.functions.functions

class LoginActivity : BaseActivity() {

    private lateinit var auth: FirebaseAuth
    private val functions by lazy { Firebase.functions("europe-west1") }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_login)

        auth = FirebaseAuth.getInstance()

        val email = findViewById<EditText>(R.id.etEmail)
        val password = findViewById<EditText>(R.id.etPassword)
        val error = findViewById<TextView>(R.id.tvError)
        val status = findViewById<TextView>(R.id.tvStatus)
        val login = findViewById<Button>(R.id.btnDoLogin)
        val resendBtn = findViewById<Button>(R.id.btnResendVerification)
        val forgotBtn = findViewById<Button>(R.id.btnForgotPassword)
        val spinnerLang = findViewById<Spinner>(R.id.spinnerLanguage)

        val languages = listOf(
            "en" to getString(R.string.lang_en),
            "hu" to getString(R.string.lang_hu),
            "sk" to getString(R.string.lang_sk),
            "ro" to getString(R.string.lang_ro),
            "de" to getString(R.string.lang_de),
            "hr" to getString(R.string.lang_hr),
            "he" to getString(R.string.lang_he)
        )

        val adapter = ArrayAdapter(this, android.R.layout.simple_spinner_item, languages.map { it.second })
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
        spinnerLang.adapter = adapter

        val currentLang = LocaleManager.getLocale(this)
        val initialPosition = languages.indexOfFirst { it.first == currentLang }.coerceAtLeast(0)
        spinnerLang.setSelection(initialPosition)

        var userTriggeredChange = false
        spinnerLang.setOnTouchListener { _, _ ->
            userTriggeredChange = true
            false
        }

        spinnerLang.onItemSelectedListener = object : android.widget.AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: android.widget.AdapterView<*>?, view: android.view.View?, position: Int, id: Long) {
                if (!userTriggeredChange) return
                val selectedLang = languages[position].first
                if (selectedLang != currentLang) {
                    setAppLocale(selectedLang) // saves preference + recreates
                }
            }
            override fun onNothingSelected(parent: android.widget.AdapterView<*>?) {}
        }

        login.setOnClickListener {
            error.text = ""
            status.text = getString(R.string.status_logging_in)
            status.visibility = android.view.View.VISIBLE
            resendBtn.visibility = android.view.View.GONE

            val e = email.text.toString().trim()
            val p = password.text.toString()

            if (e.isBlank() || p.isBlank()) {
                error.text = getString(R.string.error_login_fields_empty)
                status.visibility = android.view.View.GONE
                return@setOnClickListener
            }

            auth.signInWithEmailAndPassword(e, p)
                .addOnSuccessListener { result ->
                    val user = result.user
                    if (user != null && !user.isEmailVerified) {
                        auth.signOut()
                        error.text = getString(R.string.error_email_not_verified)
                        status.visibility = android.view.View.GONE
                        resendBtn.visibility = android.view.View.VISIBLE
                        return@addOnSuccessListener
                    }
                    Toast.makeText(this, getString(R.string.msg_login_success), Toast.LENGTH_SHORT).show()
                    startActivity(Intent(this, GameActivity::class.java))
                    finishAffinity()
                }
                .addOnFailureListener {
                    status.visibility = android.view.View.GONE
                    error.text = it.message ?: getString(R.string.error_login_failed)
                    forgotBtn.visibility = android.view.View.VISIBLE
                }
        }

        findViewById<Button>(R.id.btnBack).setOnClickListener {
            finish()
        }

        resendBtn.setOnClickListener {
            val e = email.text.toString().trim()
            val p = password.text.toString()

            if (e.isBlank() || p.isBlank()) {
                error.text = getString(R.string.error_login_fields_empty)
                return@setOnClickListener
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
                            resendBtn.visibility = android.view.View.GONE
                        }
                        .addOnFailureListener {
                            // Fall back to Firebase built-in
                            user?.sendEmailVerification()
                                ?.addOnSuccessListener {
                                    functions.getHttpsCallable("recordVerificationSent").call()
                                        .addOnFailureListener { /* non-critical */ }
                                    Toast.makeText(this, getString(R.string.msg_verification_email_sent), Toast.LENGTH_LONG).show()
                                    auth.signOut()
                                    resendBtn.visibility = android.view.View.GONE
                                }
                                ?.addOnFailureListener { ex ->
                                    error.text = ex.message ?: "Failed to send verification email."
                                    auth.signOut()
                                }
                        }
                }
                .addOnFailureListener {
                    error.text = it.message ?: getString(R.string.error_login_failed)
                    forgotBtn.visibility = android.view.View.VISIBLE
                }
        }

        forgotBtn.setOnClickListener {
            val e = email.text.toString().trim()
            if (e.isBlank()) {
                val etEmailDialog = EditText(this).apply {
                    inputType = android.text.InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS
                    hint = getString(R.string.label_email)
                }

                android.app.AlertDialog.Builder(this)
                    .setTitle(getString(R.string.action_forgot_password))
                    .setMessage(getString(R.string.error_enter_email))
                    .setView(etEmailDialog)
                    .setPositiveButton(getString(R.string.action_send)) { _, _ ->
                        val emailInput = etEmailDialog.text.toString().trim()
                        if (emailInput.isNotBlank()) {
                            functions.getHttpsCallable("sendPasswordResetCustom")
                                .call(hashMapOf("email" to emailInput, "locale" to currentLang))
                                .addOnSuccessListener {
                                    Toast.makeText(this, getString(R.string.msg_reset_password_sent), Toast.LENGTH_LONG).show()
                                }
                                .addOnFailureListener {
                                    Toast.makeText(this, getString(R.string.msg_reset_password_sent), Toast.LENGTH_LONG).show()
                                }
                        } else {
                            error.text = getString(R.string.error_enter_email)
                        }
                    }
                    .setNegativeButton(getString(R.string.action_cancel), null)
                    .show()
                return@setOnClickListener
            }

            functions.getHttpsCallable("sendPasswordResetCustom")
                .call(hashMapOf("email" to e, "locale" to currentLang))
                .addOnSuccessListener {
                    Toast.makeText(this, getString(R.string.msg_reset_password_sent), Toast.LENGTH_LONG).show()
                }
                .addOnFailureListener {
                    Toast.makeText(this, getString(R.string.msg_reset_password_sent), Toast.LENGTH_LONG).show()
                }
        }
    }
}
