package com.fairco.trap

import com.fairco.trap.util.LocaleManager
import androidx.lifecycle.AndroidViewModel
import androidx.annotation.StringRes
import android.app.Application
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.google.firebase.auth.auth
import com.google.firebase.functions.FirebaseFunctionsException
import com.google.firebase.functions.functions
import com.google.firebase.Firebase
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await

data class Conversation(
    val id: String,
    val kind: String,           // "direct" or "support"
    val otherUid: String,
    val otherUsername: String,
    val lastMessageText: String,
    val lastMessageSenderUid: String,
    val unread: Boolean,
    val lastMessageAtEpochMs: Long?,
    val supportTicketId: String = "",
    val supportTicketNo: String = ""
)

data class ChatMessage(
    val id: String,
    val senderUid: String,
    val senderUsername: String,
    val text: String,
    val createdAtEpochMs: Long?,
    val kind: String = "direct"
)

class MessagingViewModel(application: Application) : AndroidViewModel(application) {
    private fun str(@StringRes id: Int, vararg args: Any): String =
        LocaleManager.applyLocale(getApplication()).getString(id, *args)
    private val functions = Firebase.functions("europe-west1")
    private val auth = Firebase.auth

    val conversations = MutableStateFlow<List<Conversation>>(emptyList())
    // Only friend direct chats (filter out support threads)
    val directConversations get() = conversations.value.filter { it.kind == "direct" }
    
    val messages = MutableStateFlow<List<ChatMessage>>(emptyList())
    val isLoading = MutableStateFlow(false)
    val error = MutableStateFlow<String?>(null)

    fun loadConversations() = viewModelScope.launch {
        isLoading.value = true
        try {
            val result = functions.getHttpsCallable("listMyConversations")
                .call().await()
            val data = result.getData() as? Map<String, Any> ?: return@launch
            @Suppress("UNCHECKED_CAST")
            val items = data["items"] as? List<Map<String, Any>> ?: emptyList()
            conversations.value = items.map {
                Conversation(
                    id = it["id"] as? String ?: "",
                    kind = it["kind"] as? String ?: "direct",
                    otherUid = it["otherUid"] as? String ?: "",
                    otherUsername = it["otherUsername"] as? String ?: "",
                    lastMessageText = it["lastMessageText"] as? String ?: "",
                    lastMessageSenderUid = it["lastMessageSenderUid"] as? String ?: "",
                    unread = it["unread"] as? Boolean ?: false,
                    lastMessageAtEpochMs = (it["lastMessageAtEpochMs"] as? Number)?.toLong(),
                    supportTicketId = it["supportTicketId"] as? String ?: "",
                    supportTicketNo = it["supportTicketNo"] as? String ?: ""
                )
            }
        } catch (e: Exception) {
            handleError(e)
        } finally {
            isLoading.value = false
        }
    }

    fun openConversation(conversationId: String) = viewModelScope.launch {
        isLoading.value = true
        try {
            val result = functions.getHttpsCallable("getConversationThread")
                .call(mapOf("conversationId" to conversationId)).await()
            val data = result.getData() as? Map<String, Any> ?: return@launch
            @Suppress("UNCHECKED_CAST")
            val msgs = data["messages"] as? List<Map<String, Any>> ?: emptyList()
            messages.value = msgs.map {
                ChatMessage(
                    id = it["id"] as? String ?: "",
                    senderUid = it["senderUid"] as? String ?: "",
                    senderUsername = it["senderUsername"] as? String ?: "",
                    text = it["text"] as? String ?: "",
                    createdAtEpochMs = (it["createdAtEpochMs"] as? Number)?.toLong(),
                    kind = it["kind"] as? String ?: "direct"
                )
            }
        } catch (e: Exception) {
            handleError(e)
        } finally {
            isLoading.value = false
        }
    }

    fun sendMessage(recipientUid: String, text: String, onSent: () -> Unit) =
        viewModelScope.launch {
            if (text.isBlank()) return@launch
            try {
                functions.getHttpsCallable("sendDirectMessageToUid")
                    .call(mapOf("recipientUid" to recipientUid, "message" to text.trim()))
                    .await()
                onSent()
            } catch (e: Exception) {
                handleError(e)
            }
        }

    fun myUid(): String = auth.currentUser?.uid ?: ""

    private fun handleError(e: Exception) {
        error.value = formatErrorMessage(e)
    }

    private fun formatErrorMessage(e: Exception): String {
        return if (e is FirebaseFunctionsException) {
            when (e.code) {
                FirebaseFunctionsException.Code.UNAUTHENTICATED -> str(R.string.error_sign_in_again)
                FirebaseFunctionsException.Code.NOT_FOUND -> str(R.string.error_not_found)
                FirebaseFunctionsException.Code.ALREADY_EXISTS -> str(R.string.error_already_exists)
                FirebaseFunctionsException.Code.PERMISSION_DENIED -> str(R.string.error_permission_denied)
                FirebaseFunctionsException.Code.INTERNAL -> str(R.string.error_internal_retrying)
                else -> e.message ?: str(R.string.error_generic_retry)
            }
        } else {
            e.message ?: str(R.string.error_generic_retry)
        }
    }
}
