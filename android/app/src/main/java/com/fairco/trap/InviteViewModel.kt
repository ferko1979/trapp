package com.fairco.trap

import android.app.Application
import android.content.Context
import android.provider.ContactsContract
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.google.firebase.auth.auth
import com.google.firebase.functions.functions
import com.google.firebase.Firebase
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await

class InviteViewModel(application: Application) : AndroidViewModel(application) {

    private val functions = Firebase.functions
    private val auth = Firebase.auth

    val inviteConfig    = MutableStateFlow<InviteConfig?>(null)
    val contacts        = MutableStateFlow<List<DeviceContact>>(emptyList())
    val selectedCount   = MutableStateFlow(0)
    val searchQuery     = MutableStateFlow("")
    val isLoading       = MutableStateFlow(false)
    val error           = MutableStateFlow<String?>(null)

    // Derived: contacts filtered by search query
    val displayContacts = combine(contacts, searchQuery) { list, query ->
        if (query.isBlank()) list
        else list.filter { it.displayName.contains(query, ignoreCase = true) ||
                           it.primaryPhone.contains(query) }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    init {
        loadInviteConfig()
    }

    // ── Backend: fetch invite config ──────────────────────────────────────
    fun loadInviteConfig(lang: String = "en") = viewModelScope.launch {
        try {
            val result = functions.getHttpsCallable("generateInviteLink")
                .call(mapOf("lang" to lang)).await()
            @Suppress("UNCHECKED_CAST")
            val data = result.getData() as? Map<String, Any> ?: return@launch
            inviteConfig.value = InviteConfig(
                androidPlayStoreUrl = data["androidPlayStoreUrl"] as? String ?: "",
                iosAppStoreUrl      = data["iosAppStoreUrl"]      as? String ?: "",
                universalUrl        = data["universalUrl"]        as? String ?: "",
                inviteMessage       = data["inviteMessage"]       as? String ?: "",
                inviteMessageShort  = data["inviteMessageShort"]  as? String ?: "",
                referralCode        = data["referralCode"]        as? String ?: "",
            )
        } catch (e: Exception) {
            // Non-fatal — use defaults so the feature still works
            inviteConfig.value = InviteConfig(
                androidPlayStoreUrl = "",
                iosAppStoreUrl = "",
                universalUrl = "https://playtrapnow.web.app",
                inviteMessage = "Hey! I'm playing TRAPP — come join me! https://playtrapnow.web.app",
                inviteMessageShort = "Join me on TRAPP! https://playtrapnow.web.app",
                referralCode = "",
            )
        }
    }

    // ── Device: load contacts ─────────────────────────────────────────────
    fun loadContacts() = viewModelScope.launch(Dispatchers.IO) {
        isLoading.value = true
        try {
            contacts.value = readDeviceContacts(getApplication())
                .sortedBy { it.displayName }
        } catch (e: Exception) {
            error.value = "Could not read contacts: ${e.message}"
        } finally {
            isLoading.value = false
        }
    }

    private fun readDeviceContacts(context: Context): List<DeviceContact> {
        val result = mutableMapOf<Long, DeviceContact>()

        val projection = arrayOf(
            ContactsContract.CommonDataKinds.Phone.CONTACT_ID,
            ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME_PRIMARY,
            ContactsContract.CommonDataKinds.Phone.NUMBER
        )

        context.contentResolver.query(
            ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
            projection,
            null,
            null,
            "${ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME_PRIMARY} ASC"
        )?.use { cursor ->
            val idCol   = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.CONTACT_ID)
            val nameCol = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME_PRIMARY)
            val numCol  = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER)

            while (cursor.moveToNext()) {
                val id   = cursor.getLong(idCol)
                val name = cursor.getString(nameCol) ?: continue
                val num  = cursor.getString(numCol)
                    ?.replace(Regex("[\\s\\-()]"), "")
                    ?: continue

                if (num.isBlank()) continue

                val existing = result[id]
                if (existing != null) {
                    result[id] = existing.copy(
                        phoneNumbers = (existing.phoneNumbers + num).distinct()
                    )
                } else {
                    result[id] = DeviceContact(
                        id           = id,
                        displayName  = name,
                        phoneNumbers = listOf(num),
                        primaryPhone = num
                    )
                }
            }
        }

        return result.values.filter { it.primaryPhone.isNotBlank() }
    }

    // ── Selection ─────────────────────────────────────────────────────────
    fun toggleContact(contact: DeviceContact) {
        contacts.value = contacts.value.map {
            if (it.id == contact.id) it.copy(isSelected = !it.isSelected) else it
        }
        selectedCount.value = contacts.value.count { it.isSelected }
    }

    fun selectAll() {
        contacts.value = contacts.value.map { it.copy(isSelected = true) }
        selectedCount.value = contacts.value.size
    }

    fun clearSelection() {
        contacts.value = contacts.value.map { it.copy(isSelected = false) }
        selectedCount.value = 0
    }

    fun setSearchQuery(q: String) { searchQuery.value = q }

    // ── Build message ─────────────────────────────────────────────────────
    fun buildInviteMessage(forSms: Boolean = false): String {
        val cfg = inviteConfig.value ?: return "Join me on TRAPP!"
        val senderName = auth.currentUser?.displayName ?: ""
        return if (forSms) cfg.buildShortMessage(senderName)
               else        cfg.buildFullMessage(senderName)
    }

    fun getSelectedContacts(): List<DeviceContact> =
        contacts.value.filter { it.isSelected }
}
