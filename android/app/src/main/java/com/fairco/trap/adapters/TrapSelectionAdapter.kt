package com.fairco.trap.adapters

import android.content.Context
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ArrayAdapter
import com.fairco.trap.R
import com.fairco.trap.TrapDefinitionUi
import com.fairco.trap.TrapInventoryItem
import com.fairco.trap.databinding.ItemTrapSelectionBinding

class TrapSelectionAdapter(
    context: Context,
    private val items: List<TrapInventoryItem>,
    private val trapDefinitions: Map<String, TrapDefinitionUi>
) : ArrayAdapter<TrapInventoryItem>(context, 0, items) {

    override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
        val binding: ItemTrapSelectionBinding
        val view: View

        if (convertView == null) {
            binding = ItemTrapSelectionBinding.inflate(LayoutInflater.from(context), parent, false)
            view = binding.root
            view.tag = binding
        } else {
            binding = convertView.tag as ItemTrapSelectionBinding
            view = convertView
        }

        val item = getItem(position) ?: return view
        val def = trapDefinitions[item.trapTypeId]

        val status = when {
            item.blockedBySlots -> " " + context.getString(R.string.label_blocked_slots)
            item.blockedByWeight -> " " + context.getString(R.string.label_blocked_weight)
            else -> ""
        }

        binding.trapName.text = context.getString(R.string.trap_selection_title_format, def?.name ?: context.getString(R.string.trap_unknown), item.bagCount, status)
        
        val placeTime = def?.effectivePlacementHoldSeconds ?: 3
        val damage = def?.damage ?: 0
        binding.trapDetails.text = context.getString(R.string.trap_selection_detail_format, placeTime, damage, "")

        return view
    }
}
