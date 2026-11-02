package com.fairco.trap.adapters

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import com.fairco.trap.R
import com.fairco.trap.TrapDefinitionUi
import com.fairco.trap.TrapInventoryItem
import com.fairco.trap.databinding.ItemTrapSelectionHorizontalBinding

import androidx.recyclerview.widget.DiffUtil

class TrapSelectionHorizontalAdapter(
    private var items: List<TrapInventoryItem>,
    private var trapDefinitions: Map<String, TrapDefinitionUi>,
    private val onTrapSelected: (String) -> Unit,
) : RecyclerView.Adapter<TrapSelectionHorizontalAdapter.ViewHolder>() {

    private var selectedTrapId: String? = null

    class ViewHolder(val binding: ItemTrapSelectionHorizontalBinding) : RecyclerView.ViewHolder(binding.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val binding = ItemTrapSelectionHorizontalBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        return ViewHolder(binding)
    }

    @android.annotation.SuppressLint("DiscouragedApi")
    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        val item = items[position]
        val def = trapDefinitions[item.trapTypeId]
        
        if (def == null) {
            android.util.Log.w("TrapAdapter", "No definition found for trapTypeId: ${item.trapTypeId}. Available: ${trapDefinitions.keys}")
        }

        holder.binding.tvTrapName.text = def?.name ?: "Trap"
        holder.binding.tvTrapCount.text = item.bagCount.toString()

        // Handle Refill Countdown
        val secondsRemaining = item.secondsUntilNextRefill ?: 0
        if (secondsRemaining > 0 && item.bagCount < item.maxBagSlots) {
            holder.binding.tvRefillTime.visibility = android.view.View.VISIBLE
            val h = secondsRemaining / 3600
            val m = (secondsRemaining % 3600) / 60
            val s = secondsRemaining % 60
            val timeStr = if (h > 0) {
                String.format(java.util.Locale.US, "%02d:%02d:%02d", h, m, s)
            } else {
                String.format(java.util.Locale.US, "%02d:%02d", m, s)
            }
            holder.binding.tvRefillTime.text = timeStr
        } else {
            holder.binding.tvRefillTime.visibility = android.view.View.GONE
        }

        val iconKey = def?.iconKey
        if (iconKey != null) {
            val resId = holder.itemView.context.resources.getIdentifier(iconKey, "drawable", holder.itemView.context.packageName)
            if (resId != 0) {
                holder.binding.ivTrapIcon.setImageResource(resId)
            } else {
                holder.binding.ivTrapIcon.setImageResource(R.drawable.ic_trap_logo)
            }
        } else {
            holder.binding.ivTrapIcon.setImageResource(R.drawable.ic_trap_logo)
        }

        val isSelected = item.trapTypeId == selectedTrapId
        holder.binding.cardTrap.strokeWidth = if (isSelected) 4 else 2
        holder.binding.cardTrap.strokeColor = if (isSelected) {
            holder.itemView.context.getColor(R.color.accent_cyan)
        } else {
            holder.itemView.context.getColor(R.color.border_default)
        }

        holder.itemView.setOnClickListener {
            val oldSelectedId = selectedTrapId
            selectedTrapId = item.trapTypeId
            
            if (oldSelectedId != selectedTrapId) {
                val oldPos = items.indexOfFirst { it.trapTypeId == oldSelectedId }
                if (oldPos != -1) notifyItemChanged(oldPos)
                notifyItemChanged(position)
            }
            
            onTrapSelected(item.trapTypeId)
        }
    }

    override fun getItemCount() = items.size

    fun updateData(newItems: List<TrapInventoryItem>, newDefinitions: Map<String, TrapDefinitionUi>) {
        val diffCallback = object : DiffUtil.Callback() {
            override fun getOldListSize() = items.size
            override fun getNewListSize() = newItems.size
            override fun areItemsTheSame(oldItemPosition: Int, newItemPosition: Int): Boolean {
                return items[oldItemPosition].id == newItems[newItemPosition].id
            }
            override fun areContentsTheSame(oldItemPosition: Int, newItemPosition: Int): Boolean {
                return items[oldItemPosition] == newItems[newItemPosition]
            }
        }
        val diffResult = DiffUtil.calculateDiff(diffCallback)
        items = newItems
        trapDefinitions = newDefinitions
        diffResult.dispatchUpdatesTo(this)
    }

    fun setSelectedTrap(trapId: String?) {
        if (selectedTrapId == trapId) return
        
        val oldSelectedId = selectedTrapId
        selectedTrapId = trapId
        
        val oldPos = items.indexOfFirst { it.trapTypeId == oldSelectedId }
        val newPos = items.indexOfFirst { it.trapTypeId == selectedTrapId }
        
        if (oldPos != -1) notifyItemChanged(oldPos)
        if (newPos != -1) notifyItemChanged(newPos)
    }
}
