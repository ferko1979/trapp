package com.fairco.trap

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.google.firebase.Firebase
import com.google.firebase.firestore.SetOptions
import com.google.firebase.firestore.firestore
import com.google.firebase.functions.functions
import com.google.firebase.storage.storage
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow

sealed class UsernameCheckState {
    object Idle      : UsernameCheckState()
    object Checking  : UsernameCheckState()
    object Available : UsernameCheckState()
    object Taken     : UsernameCheckState()
    object Unchanged : UsernameCheckState()   // same as current username
    data class Error(val msg: String) : UsernameCheckState()
}

sealed class SaveState {
    object Idle    : SaveState()
    object Saving  : SaveState()
    object Saved   : SaveState()
    data class Error(val msg: String) : SaveState()
}

sealed class ProfileEvent {
    data class ShowMessage(val msg: String) : ProfileEvent()
}

data class UserData(
    val id: String = "",
    val displayName: String = "",
    val username: String = "",
    val photoUrl: String? = null,
    val birthDate: String? = null,
    val phoneNumber: String? = null,
    val timeZone: String? = null,
    val ageGroup: String? = null,
    val createdAtEpochMs: Long? = null,
    val membership: String? = null,
    /** The user_levels doc name for this user's tier — e.g. "Free", "Monthly Plan" */
    val membershipLevelName: String? = null,
    val playerLevelName: String? = null,
    val playerLevelNumber: Int? = null,
    val trapCount: Int? = null,
    val captureCount: Int? = null,
    val timesCaught: Int? = null,
    val score: Int? = null,
    val xp: Int? = null,
    val currentStreak: Int? = null,
    val longestStreak: Int? = null,
    val totalDaysPlayed: Int? = null,
    val lastCapturedUsername: String? = null,
    val lastTrappedByUsername: String? = null
)

class ProfileViewModel : ViewModel() {

    private val _username = MutableStateFlow("")
    val username: StateFlow<String> = _username.asStateFlow()

    private val _displayName = MutableStateFlow("")
    val displayName: StateFlow<String> = _displayName.asStateFlow()

    private val _photoUrl = MutableStateFlow<String?>(null)
    val photoUrl: StateFlow<String?> = _photoUrl.asStateFlow()

    private val _uploadingPhoto = MutableStateFlow(false)
    val uploadingPhoto: StateFlow<Boolean> = _uploadingPhoto.asStateFlow()

    private val _userData = MutableStateFlow<UserData?>(null)
    val userData: StateFlow<UserData?> = _userData.asStateFlow()

    private val _usernameCheckState = MutableStateFlow<UsernameCheckState>(UsernameCheckState.Idle)
    val usernameCheckState: StateFlow<UsernameCheckState> = _usernameCheckState.asStateFlow()

    private val _saveState = MutableStateFlow<SaveState>(SaveState.Idle)
    val saveState: StateFlow<SaveState> = _saveState.asStateFlow()

    private val _event = MutableSharedFlow<ProfileEvent>()
    val event: SharedFlow<ProfileEvent> = _event.asSharedFlow()

    private val _emailChangeLoading = MutableStateFlow(false)
    val emailChangeLoading: StateFlow<Boolean> = _emailChangeLoading.asStateFlow()

    var userEmail: String = ""
    var userUid: String = ""

    private var currentUsername: String = ""
    private var usernameCheckJob: Job? = null

    fun initData(data: UserData, email: String) {
        _displayName.value = data.displayName
        _username.value = data.username
        _photoUrl.value = data.photoUrl
        currentUsername = data.username
        _userData.value = data
        userEmail = email
        userUid = data.id
        _usernameCheckState.value = UsernameCheckState.Unchanged
    }

    fun uploadAndSavePhoto(uri: Uri) {
        if (userUid.isBlank()) return
        viewModelScope.launch {
            _uploadingPhoto.value = true
            try {
                val ref = Firebase.storage.reference.child("profile_images/$userUid/profile.jpg")
                ref.putFile(uri).await()
                val downloadUrl = ref.downloadUrl.await().toString()

                Firebase.firestore.collection("users").document(userUid)
                    .set(mapOf("photoUrl" to downloadUrl), SetOptions.merge())
                    .await()

                _photoUrl.value = downloadUrl
                _event.emit(ProfileEvent.ShowMessage("Profile photo updated!"))
            } catch (e: Exception) {
                _event.emit(ProfileEvent.ShowMessage("Failed to update photo: ${e.message}"))
            } finally {
                _uploadingPhoto.value = false
            }
        }
    }

    fun onDisplayNameChanged(newName: String) {
        _displayName.value = newName
    }

    fun onUsernameChanged(newUsername: String) {
        _username.value = newUsername
        usernameCheckJob?.cancel()

        val trimmed = newUsername.trim().lowercase()
        if (trimmed == currentUsername.lowercase()) {
            _usernameCheckState.value = UsernameCheckState.Unchanged
            return
        }
        if (!isValidUsernameFormat(trimmed)) {
            _usernameCheckState.value = UsernameCheckState.Idle
            return
        }

        usernameCheckJob = viewModelScope.launch {
            delay(600)
            _usernameCheckState.value = UsernameCheckState.Checking
            try {
                val fn = Firebase.functions("europe-west1")
                    .getHttpsCallable("checkUsernameAvailability")
                val result = fn.call(mapOf("username" to trimmed)).await()
                val available = (result.data as? Map<*, *>)?.get("available") as? Boolean ?: false
                _usernameCheckState.value = if (available)
                    UsernameCheckState.Available else UsernameCheckState.Taken
            } catch (e: Exception) {
                _usernameCheckState.value = UsernameCheckState.Error(e.message ?: "Check failed")
            }
        }
    }

    private fun isValidUsernameFormat(s: String): Boolean =
        s.length in 3..20 && s.matches(Regex("^[a-z0-9_]+$"))

    fun saveProfile() {
        val name     = _displayName.value.trim()
        val username = _username.value.trim()

        if (name.length < 2) {
            _saveState.value = SaveState.Error("Name must be at least 2 characters")
            return
        }
        val checkState = _usernameCheckState.value
        if (checkState == UsernameCheckState.Taken) {
            _saveState.value = SaveState.Error("Username is already taken")
            return
        }
        if (checkState == UsernameCheckState.Checking) {
            _saveState.value = SaveState.Error("Checking username availability…")
            return
        }

        _saveState.value = SaveState.Saving
        viewModelScope.launch {
            try {
                // updateProfile handles name; setMyUsername handles username
                val updateFn = Firebase.functions("europe-west1")
                    .getHttpsCallable("updateProfile")
                updateFn.call(mapOf("name" to name)).await()

                if (checkState == UsernameCheckState.Available) {
                    val usernameFn = Firebase.functions("europe-west1")
                        .getHttpsCallable("setMyUsername")
                    usernameFn.call(mapOf("username" to username.lowercase())).await()
                }

                _saveState.value = SaveState.Saved
            } catch (e: Exception) {
                _saveState.value = SaveState.Error(e.message ?: "Save failed")
            }
        }
    }

    fun requestEmailChange(newEmail: String) {
        if (_emailChangeLoading.value) return
        viewModelScope.launch {
            _emailChangeLoading.value = true
            try {
                val fn = Firebase.functions("europe-west1")
                // Check for existing open email_change tickets
                val listResult = fn.getHttpsCallable("listMySupportTickets").call().await()
                @Suppress("UNCHECKED_CAST")
                val items = ((listResult.data as? Map<*, *>)?.get("items") as? List<Map<String, Any>>) ?: emptyList()
                val hasPending = items.any { ticket ->
                    ticket["category"] == "email_change" &&
                    ticket["status"] !in listOf("closed", "answered")
                }
                if (hasPending) {
                    _event.emit(ProfileEvent.ShowMessage("A change request is already pending. Please wait for it to be resolved."))
                    return@launch
                }
                fn.getHttpsCallable("createSupportTicket").call(mapOf(
                    "subject"  to "Email address change request",
                    "message"  to "I would like to change the email address on my account.\n\nUID: $userUid\nCurrent email: $userEmail\nRequested new email: $newEmail",
                    "category" to "email_change"
                )).await()
                _event.emit(ProfileEvent.ShowMessage("Request submitted. Our team will contact you."))
            } catch (e: Exception) {
                _event.emit(ProfileEvent.ShowMessage("Failed to submit request: ${e.message}"))
            } finally {
                _emailChangeLoading.value = false
            }
        }
    }

    fun resetSaveState() {
        _saveState.value = SaveState.Idle
    }
}
