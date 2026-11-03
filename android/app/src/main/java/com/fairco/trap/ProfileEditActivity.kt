package com.fairco.trap

import android.os.Bundle
import com.fairco.trap.ui.theme.TrappTheme
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.appcompat.app.AppCompatActivity
import com.fairco.trap.BaseActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.compose.ui.platform.ComposeView
import com.google.android.material.snackbar.Snackbar
import com.google.firebase.Firebase
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.firestore
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

class ProfileEditActivity : BaseActivity() {

    override val radarBars = true

    private val viewModel: ProfileViewModel by viewModels()

    private val pickImageLauncher = registerForActivityResult(
        ActivityResultContracts.GetContent()
    ) { uri ->
        uri?.let { viewModel.uploadAndSavePhoto(it) }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val composeView = ComposeView(this).apply {
            setContent { TrappTheme {
                ProfileScreenContent(
                    viewModel = viewModel,
                    onFinish = { finish() },
                    onChangePhoto = { pickImageLauncher.launch("image/*") }
                )
            } }
        }
        setContentView(composeView)

        observeViewModel()
        loadInitialData()
    }

    private fun observeViewModel() {
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                launch {
                    viewModel.saveState.collect { state ->
                        if (state is SaveState.Saved) {
                            Snackbar.make(findViewById(android.R.id.content), R.string.msg_profile_updated, Snackbar.LENGTH_SHORT).show()
                            viewModel.resetSaveState()
                        } else if (state is SaveState.Error) {
                            Toast.makeText(this@ProfileEditActivity, state.detail ?: getString(state.msgRes), Toast.LENGTH_LONG).show()
                            viewModel.resetSaveState()
                        }
                    }
                }
                launch {
                    viewModel.event.collectLatest { event ->
                        when (event) {
                            is ProfileEvent.ShowMessage -> {
                                Snackbar.make(findViewById(android.R.id.content), event.msg, Snackbar.LENGTH_SHORT).show()
                            }
                        }
                    }
                }
            }
        }
    }

    private fun loadInitialData() {
        val user = FirebaseAuth.getInstance().currentUser ?: return
        val uid = user.uid
        val email = user.email ?: ""

        Firebase.firestore.collection("users").document(uid).get()
            .addOnSuccessListener { doc ->
                if (!doc.exists()) return@addOnSuccessListener

                val membershipLevelId = doc.getString("levelId") ?: "free"

                // Build user data with a placeholder membership name; fetch the real
                // name from user_levels in a follow-up read.
                val baseData = UserData(
                    id = uid,
                    displayName = doc.getString("displayName") ?: doc.getString("name") ?: "",
                    username = doc.getString("username") ?: "",
                    photoUrl = doc.getString("photoUrl"),
                    birthDate = doc.getString("birthDate"),
                    phoneNumber = doc.getString("phoneNumber"),
                    timeZone = doc.getString("timeZone"),
                    ageGroup = doc.getString("ageGroup"),
                    createdAtEpochMs = doc.getLong("createdAtEpochMs"),
                    membership = doc.getString("membership"),
                    membershipLevelName = membershipLevelId.replaceFirstChar { it.uppercase() },
                    playerLevelName = doc.getString("levelName")?.takeIf { it.isNotBlank() },
                    playerLevelNumber = doc.getLong("level")?.toInt(),
                    trapCount = doc.getLong("trapsPlaced")?.toInt(),
                    captureCount = doc.getLong("captureCount")?.toInt(),
                    timesCaught = doc.getLong("timesCaught")?.toInt(),
                    score = doc.getLong("score")?.toInt(),
                    xp = doc.getLong("xp")?.toInt(),
                    currentStreak = doc.getLong("streak")?.toInt(),
                    longestStreak = doc.getLong("longestStreak")?.toInt(),
                    totalDaysPlayed = doc.getLong("totalDaysPlayed")?.toInt(),
                    lastCapturedUsername = doc.getString("lastCapturedUsername"),
                    lastTrappedByUsername = doc.getString("lastTrappedByUsername")
                )
                viewModel.initData(baseData, email)

                // Fetch the human-readable membership level name
                Firebase.firestore.collection("user_levels").document(membershipLevelId).get()
                    .addOnSuccessListener { levelDoc ->
                        val levelName = levelDoc.getString("name")?.takeIf { it.isNotBlank() }
                            ?: membershipLevelId.replaceFirstChar { it.uppercase() }
                        viewModel.initData(baseData.copy(membershipLevelName = levelName), email)
                    }
            }
    }
}

