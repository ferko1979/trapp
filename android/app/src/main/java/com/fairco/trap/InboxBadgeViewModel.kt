package com.fairco.trap

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.ListenerRegistration
import com.google.firebase.firestore.firestore
import com.google.firebase.functions.functions
import com.google.firebase.Firebase
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch

class InboxBadgeViewModel : ViewModel() {

    private val db = Firebase.firestore
    private val auth = FirebaseAuth.getInstance()

    // Separate counters
    val unreadMessages = MutableStateFlow(0)   // direct chats from friends
    val unreadTickets  = MutableStateFlow(0)   // support tickets with admin reply

    // Combined — drives the top-bar badge
    val unreadCount: StateFlow<Int> = combine(unreadMessages, unreadTickets) { m, t ->
        m + t
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), 0)

    private var messagesListener: ListenerRegistration? = null
    private var ticketsListener: ListenerRegistration? = null

    /** Call this from onStart() of your main activity. */
    fun startPolling() {
        if (messagesListener != null || ticketsListener != null) return
        
        val uid = auth.currentUser?.uid ?: return

        // Real-time listener for unread messages (direct conversations)
        messagesListener = db.collection("conversations")
            .whereArrayContains("participants", uid)
            .addSnapshotListener { snap, err ->
                if (err != null || snap == null) return@addSnapshotListener
                
                // We need to count where unread is true AND kind is "direct"
                // and where the unread state is specifically for THIS user.
                // Usually, 'unread' might be a map or there might be a specific field.
                // Based on previous code, it looked like a simple "unread" boolean.
                unreadMessages.value = snap.documents.count { doc ->
                    doc.getBoolean("unread") == true && 
                    doc.getString("kind") == "direct" &&
                    doc.getString("lastMessageBy") != uid // Only unread if last message was NOT by me
                }
            }

        // Real-time listener for unread support tickets
        ticketsListener = db.collection("support_tickets")
            .whereEqualTo("uid", uid)
            .whereEqualTo("hasUnreadUser", true)
            .addSnapshotListener { snap, err ->
                if (err != null || snap == null) return@addSnapshotListener
                unreadTickets.value = snap.size()
            }
    }

    /** Call this from onStop() of your main activity. */
    fun stopPolling() {
        messagesListener?.remove()
        ticketsListener?.remove()
        messagesListener = null
        ticketsListener = null
    }

    override fun onCleared() {
        super.onCleared()
        stopPolling()
    }
}
