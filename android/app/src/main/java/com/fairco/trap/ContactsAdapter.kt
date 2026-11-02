package com.fairco.trap

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.fairco.trap.databinding.ItemContactBinding

class ContactsAdapter(
    private val onToggle: (DeviceContact) -> Unit
) : ListAdapter<DeviceContact, ContactsAdapter.VH>(
    object : DiffUtil.ItemCallback<DeviceContact>() {
        override fun areItemsTheSame(a: DeviceContact, b: DeviceContact) = a.id == b.id
        override fun areContentsTheSame(a: DeviceContact, b: DeviceContact) = a == b
    }
) {
    // Avatar palette
    private val colors = listOf(
        0xFF1E3A8A.toInt(), 0xFF065F46.toInt(), 0xFF7C2D12.toInt(),
        0xFF581C87.toInt(), 0xFF0C4A6E.toInt(), 0xFF3F3F46.toInt(),
        0xFF831843.toInt(), 0xFF1C1917.toInt()
    )

    inner class VH(val binding: ItemContactBinding) :
        RecyclerView.ViewHolder(binding.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) =
        VH(ItemContactBinding.inflate(LayoutInflater.from(parent.context), parent, false))

    override fun onBindViewHolder(holder: VH, position: Int) {
        val contact = getItem(position)
        with(holder.binding) {
            // Avatar
            val color = colors[Math.abs(contact.displayName.hashCode()) % colors.size]
            cardAvatar.setCardBackgroundColor(color)
            tvInitial.text = contact.displayName.firstOrNull()?.uppercase() ?: "?"

            // Text
            tvName.text  = contact.displayName
            tvPhone.text = contact.primaryPhone

            // Checkbox
            cbSelect.isChecked = contact.isSelected

            // Click anywhere on the row to toggle
            root.setOnClickListener { onToggle(contact) }
            cbSelect.setOnClickListener { onToggle(contact) }
        }
    }
}
