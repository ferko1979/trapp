package com.fairco.trap

import com.fairco.trap.util.LocaleManager
import androidx.lifecycle.AndroidViewModel
import androidx.annotation.StringRes
import android.app.Application
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.google.firebase.functions.functions
import com.google.firebase.Firebase
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await

data class Friend(
    val uid: String,
    val username: String,
    val name: String,
    val createdAtEpochMs: Long?
)

data class FriendRequest(
    val id: String,
    val fromUid: String = "",
    val fromUsername: String = "",
    val fromName: String = "",
    val toUid: String = "",
    val toUsername: String = "",
    val toName: String = "",
    val createdAtEpochMs: Long?
)

data class UserSearchResult(
    val uid: String,
    val username: String,
    val name: String
)

sealed class IdentifierSearchState {
    object Idle    : IdentifierSearchState()
    object Loading : IdentifierSearchState()
    data class Found(
        val uid: String,
        val username: String,
        val name: String,
        val friendshipStatus: String   // "none"|"friends"|"outgoing_pending"|"incoming_pending"
    ) : IdentifierSearchState()
    data class NotFound(val reason: String) : IdentifierSearchState()
    data class Error(val message: String)   : IdentifierSearchState()
}

class FriendsViewModel(application: Application) : AndroidViewModel(application) {
    private fun str(@StringRes id: Int, vararg args: Any): String =
        LocaleManager.applyLocale(getApplication()).getString(id, *args)
    private val functions = Firebase.functions("europe-west1")

    val friends = MutableStateFlow<List<Friend>>(emptyList())
    val incomingRequests = MutableStateFlow<List<FriendRequest>>(emptyList())
    val outgoingRequests = MutableStateFlow<List<FriendRequest>>(emptyList())
    val searchResults = MutableStateFlow<List<UserSearchResult>>(emptyList())
    private val _identifierResult = MutableStateFlow<IdentifierSearchState>(IdentifierSearchState.Idle)
    val identifierResult = _identifierResult
    val isLoading = MutableStateFlow(false)
    val error = MutableStateFlow<String?>(null)

    fun loadFriends() = viewModelScope.launch {
        isLoading.value = true
        try {
            val result = functions.getHttpsCallable("listMyFriendsDetailed")
                .call().await()
            val data = result.getData() as? Map<String, Any> ?: return@launch
            @Suppress("UNCHECKED_CAST")
            val items = data["items"] as? List<Map<String, Any>> ?: emptyList()
            friends.value = items.map {
                Friend(
                    uid = it["uid"] as? String ?: "",
                    username = it["username"] as? String ?: "",
                    name = it["name"] as? String ?: "User",
                    createdAtEpochMs = (it["createdAtEpochMs"] as? Number)?.toLong()
                )
            }
        } catch (e: Exception) {
            error.value = e.message
        } finally {
            isLoading.value = false
        }
    }

    fun loadFriendRequests() = viewModelScope.launch {
        try {
            val result = functions.getHttpsCallable("listFriendRequestsDetailed")
                .call().await()
            val data = result.getData() as? Map<String, Any> ?: return@launch
            @Suppress("UNCHECKED_CAST")
            val inc = data["incoming"] as? List<Map<String, Any>> ?: emptyList()
            val out = data["outgoing"] as? List<Map<String, Any>> ?: emptyList()
            incomingRequests.value = inc.map {
                FriendRequest(
                    id = it["id"] as? String ?: "",
                    fromUid = it["fromUid"] as? String ?: "",
                    fromUsername = it["fromUsername"] as? String ?: "",
                    fromName = it["fromName"] as? String ?: "User",
                    createdAtEpochMs = (it["createdAtEpochMs"] as? Number)?.toLong()
                )
            }
            outgoingRequests.value = out.map {
                FriendRequest(
                    id = it["id"] as? String ?: "",
                    toUid = it["toUid"] as? String ?: "",
                    toUsername = it["toUsername"] as? String ?: "",
                    toName = it["toName"] as? String ?: "User",
                    createdAtEpochMs = (it["createdAtEpochMs"] as? Number)?.toLong()
                )
            }
        } catch (e: Exception) {
            error.value = e.message
        }
    }

    fun searchUsers(query: String) = viewModelScope.launch {
        if (query.length < 2) { searchResults.value = emptyList(); return@launch }
        try {
            val result = functions.getHttpsCallable("searchUsersByUsername")
                .call(mapOf("query" to query)).await()
            val data = result.getData() as? Map<String, Any> ?: return@launch
            @Suppress("UNCHECKED_CAST")
            val items = data["items"] as? List<Map<String, Any>> ?: emptyList()
            searchResults.value = items.map {
                UserSearchResult(
                    uid = it["uid"] as? String ?: "",
                    username = it["username"] as? String ?: "",
                    name = it["name"] as? String ?: "User"
                )
            }
        } catch (e: Exception) {
            error.value = e.message
        }
    }

    fun sendFriendRequest(username: String, onDone: (Boolean, String) -> Unit) =
        viewModelScope.launch {
            try {
                functions.getHttpsCallable("sendFriendRequestByUsername")
                    .call(mapOf("username" to username)).await()
                onDone(true, str(R.string.msg_friend_request_sent))
                loadFriendRequests()
            } catch (e: Exception) {
                val msg = when {
                    e.message?.contains("already-exists") == true -> str(R.string.msg_already_friends)
                    e.message?.contains("not-found") == true -> str(R.string.friends_username_not_found)
                    else -> e.message ?: str(R.string.error_request_failed)
                }
                onDone(false, msg)
            }
        }

    fun respondToRequest(requestId: String, accept: Boolean) = viewModelScope.launch {
        try {
            functions.getHttpsCallable("respondToFriendRequest")
                .call(mapOf("requestId" to requestId, "action" to if (accept) "accept" else "decline"))
                .await()
            loadFriendRequests()
            if (accept) loadFriends()
        } catch (e: Exception) {
            error.value = e.message
        }
    }

    fun removeFriend(friendUid: String) = viewModelScope.launch {
        try {
            functions.getHttpsCallable("removeFriend")
                .call(mapOf("friendUid" to friendUid)).await()
            loadFriends()
        } catch (e: Exception) {
            error.value = e.message
        }
    }

    fun searchByIdentifier(identifier: String) {
        val trimmed = identifier.trim()
        if (trimmed.isEmpty()) return

        _identifierResult.value = IdentifierSearchState.Loading
        viewModelScope.launch {
            try {
                val fn = Firebase.functions("europe-west1")
                    .getHttpsCallable("findUserByIdentifier")
                val result = fn.call(mapOf("identifier" to trimmed)).await()

                @Suppress("UNCHECKED_CAST")
                val data = result.data as Map<String, Any?>

                val found = data["found"] as? Boolean ?: false
                if (!found) {
                    val reason = data["reason"] as? String ?: "not_found"
                    _identifierResult.value = IdentifierSearchState.NotFound(reason)
                    return@launch
                }

                @Suppress("UNCHECKED_CAST")
                val user = data["user"] as Map<String, Any?>
                val friendshipStatus = data["friendshipStatus"] as? String ?: "none"

                _identifierResult.value = IdentifierSearchState.Found(
                    uid              = user["uid"] as String,
                    username         = user["username"] as? String ?: "",
                    name             = user["name"] as? String ?: str(R.string.default_display_name),
                    friendshipStatus = friendshipStatus
                )
            } catch (e: Exception) {
                _identifierResult.value = IdentifierSearchState.Error(
                    e.message ?: str(R.string.error_search_failed)
                )
            }
        }
    }

    fun clearIdentifierResult() {
        _identifierResult.value = IdentifierSearchState.Idle
    }

    fun sendFriendRequestByUid(toUid: String) = viewModelScope.launch {
        try {
            functions.getHttpsCallable("sendFriendRequest")
                .call(mapOf("toUid" to toUid)).await()
            
            // Update local state if it's currently a Found result
            val current = _identifierResult.value
            if (current is IdentifierSearchState.Found && current.uid == toUid) {
                _identifierResult.value = current.copy(friendshipStatus = "outgoing_pending")
            }
            
            loadFriendRequests()
        } catch (e: Exception) {
            error.value = e.message ?: str(R.string.error_request_failed)
        }
    }

    fun respondToFriendRequestDetailed(requestId: String, action: String) = viewModelScope.launch {
        try {
            functions.getHttpsCallable("respondToFriendRequest")
                .call(mapOf("requestId" to requestId, "action" to action))
                .await()
            loadFriendRequests()
            loadFriends()
            
            // If we have a search result, we might want to update it, 
            // but the instructions don't strictly require it for accept since it might be complex to find which user it was.
            // For now, clearing search or re-searching would be easier, but let's stick to simple.
            clearIdentifierResult()
        } catch (e: Exception) {
            error.value = e.message
        }
    }
}
