package com.fairco.trap

/**
 * Represents a contact read from the device.
 */
data class DeviceContact(
    val id: Long,
    val displayName: String,
    val phoneNumbers: List<String>,
    val primaryPhone: String = phoneNumbers.firstOrNull() ?: "",
    var isSelected: Boolean = false
)
