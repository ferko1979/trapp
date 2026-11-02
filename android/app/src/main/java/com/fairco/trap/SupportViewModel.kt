package com.fairco.trap

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.google.firebase.functions.FirebaseFunctionsException
import com.google.firebase.functions.functions
import com.google.firebase.Firebase
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await

enum class TicketCategory(val value: String, val label: String) {
    BUG_REPORT("bug_report", "🐛 Bug Report"),
    GENERAL("general", "💬 General Question"),
    ACCOUNT("account", "👤 Account Issue"),
    EMAIL_CHANGE("email_change", "✉️ Change Email"),
    BILLING("billing", "💳 Billing")
}

enum class TicketPriority(val value: String) {
    LOW("low"), NORMAL("normal"), HIGH("high"), URGENT("urgent")
}

data class TicketSummary(
    val id: String,
    val ticketNo: String,
    val category: String,
    val subject: String,
    val status: String,
    val hasUnreadUser: Boolean,
    val messagesCount: Int,
    val createdAtEpochMs: Long?,
    val lastMessageAtEpochMs: Long?
)

data class TicketMessage(
    val id: String,
    val senderType: String,      // "user" or "admin"
    val senderName: String,
    val text: String,
    val isInternal: Boolean,     // never show these to the user
    val createdAtEpochMs: Long?
)

class SupportViewModel : ViewModel() {
    private val functions = Firebase.functions("europe-west1")

    val tickets = MutableStateFlow<List<TicketSummary>>(emptyList())
    val threadMessages = MutableStateFlow<List<TicketMessage>>(emptyList())
    val currentTicket = MutableStateFlow<Map<String, Any>?>(null)
    val isLoading = MutableStateFlow(false)
    val error = MutableStateFlow<String?>(null)

    fun loadTickets() = viewModelScope.launch {
        isLoading.value = true
        try {
            val result = functions.getHttpsCallable("listMySupportTickets")
                .call().await()
            val data = result.getData() as? Map<String, Any> ?: return@launch
            @Suppress("UNCHECKED_CAST")
            val items = data["items"] as? List<Map<String, Any>> ?: emptyList()
            tickets.value = items.map {
                TicketSummary(
                    id = it["id"] as? String ?: "",
                    ticketNo = it["ticketNo"] as? String ?: "",
                    category = it["category"] as? String ?: "",
                    subject = it["subject"] as? String ?: "",
                    status = it["status"] as? String ?: "open",
                    hasUnreadUser = it["hasUnreadUser"] as? Boolean ?: false,
                    messagesCount = (it["messagesCount"] as? Number)?.toInt() ?: 0,
                    createdAtEpochMs = (it["createdAtEpochMs"] as? Number)?.toLong(),
                    lastMessageAtEpochMs = (it["lastMessageAtEpochMs"] as? Number)?.toLong()
                )
            }
        } catch (e: Exception) {
            handleError(e)
        } finally {
            isLoading.value = false
        }
    }

    fun openTicket(ticketId: String) = viewModelScope.launch {
        isLoading.value = true
        try {
            // 1. Fetch ticket thread (also clears hasUnreadUser on the ticket)
            val result = functions.getHttpsCallable("getSupportTicketThread")
                .call(mapOf("ticketId" to ticketId)).await()
            val data = result.getData() as? Map<String, Any> ?: return@launch
            currentTicket.value = data["ticket"] as? Map<String, Any>
            
            @Suppress("UNCHECKED_CAST")
            val msgs = data["messages"] as? List<Map<String, Any>> ?: emptyList()
            threadMessages.value = msgs
                .filter { (it["isInternal"] as? Boolean) != true } // hide internal notes
                .map {
                    TicketMessage(
                        id = it["id"] as? String ?: "",
                        senderType = it["senderType"] as? String ?: "user",
                        senderName = it["senderName"] as? String ?: "",
                        text = it["text"] as? String ?: "",
                        isInternal = it["isInternal"] as? Boolean ?: false,
                        createdAtEpochMs = (it["createdAtEpochMs"] as? Number)?.toLong()
                    )
                }
            
            // 2. Also mark the mirrored conversation as read
            try {
                functions.getHttpsCallable("getConversationThread")
                    .call(mapOf("conversationId" to "support__$ticketId")).await()
            } catch (_: Exception) {
                // Conversation mirror may not exist yet
            }

        } catch (e: Exception) {
            handleError(e)
        } finally {
            isLoading.value = false
        }
    }

    fun createTicket(
        subject: String,
        message: String,
        category: String,
        priority: String = "normal",
        onDone: (Boolean, String, String?) -> Unit  // success, msg, ticketNo
    ) = viewModelScope.launch {
        if (subject.isBlank() || message.isBlank()) {
            onDone(false, "Subject and message are required.", null)
            return@launch
        }
        isLoading.value = true
        try {
            val result = functions.getHttpsCallable("createSupportTicket")
                .call(mapOf(
                    "subject" to subject.trim(),
                    "message" to message.trim(),
                    "category" to category,
                    "priority" to priority,
                    "attachments" to emptyList<Any>()
                )).await()
            val data = result.getData() as? Map<String, Any>
            val ticketNo = data?.get("ticketNo") as? String
            onDone(true, "Ticket submitted!", ticketNo)
            loadTickets()
        } catch (e: Exception) {
            onDone(false, formatErrorMessage(e), null)
        } finally {
            isLoading.value = false
        }
    }

    fun replyToTicket(ticketId: String, message: String, onDone: (Boolean) -> Unit) =
        viewModelScope.launch {
            if (message.isBlank()) return@launch
            try {
                functions.getHttpsCallable("replyToSupportTicket")
                    .call(mapOf(
                        "ticketId" to ticketId,
                        "message" to message.trim(),
                        "attachments" to emptyList<Any>()
                    )).await()
                openTicket(ticketId)
                onDone(true)
            } catch (e: Exception) {
                handleError(e)
                onDone(false)
            }
        }

    private fun handleError(e: Exception) {
        error.value = formatErrorMessage(e)
    }

    private fun formatErrorMessage(e: Exception): String {
        return if (e is FirebaseFunctionsException) {
            when (e.code) {
                FirebaseFunctionsException.Code.UNAUTHENTICATED -> "Please sign in again."
                FirebaseFunctionsException.Code.NOT_FOUND -> "Not found."
                FirebaseFunctionsException.Code.ALREADY_EXISTS -> "Already exists."
                FirebaseFunctionsException.Code.PERMISSION_DENIED -> "Permission denied."
                FirebaseFunctionsException.Code.INTERNAL -> "Internal server error. Retrying..."
                else -> e.message ?: "Something went wrong."
            }
        } else {
            e.message ?: "Something went wrong."
        }
    }
}
