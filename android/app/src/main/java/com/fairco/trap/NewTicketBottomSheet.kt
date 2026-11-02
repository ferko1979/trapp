package com.fairco.trap

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ArrayAdapter
import android.widget.Toast
import androidx.fragment.app.viewModels
import androidx.lifecycle.lifecycleScope
import com.fairco.trap.databinding.BottomSheetNewTicketBinding
import com.google.android.material.bottomsheet.BottomSheetDialogFragment
import com.google.android.material.snackbar.Snackbar
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

class NewTicketBottomSheet : BottomSheetDialogFragment() {

    private var _binding: BottomSheetNewTicketBinding? = null
    private val binding get() = _binding!!
    private val viewModel: SupportViewModel by viewModels()

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = BottomSheetNewTicketBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        
        setupCategorySpinner()
        
        binding.btnSend.setOnClickListener {
            submitTicket()
        }
        
        observeViewModel()
    }

    private fun setupCategorySpinner() {
        val categories = TicketCategory.entries
        val adapter = ArrayAdapter(requireContext(), android.R.layout.simple_spinner_item, categories.map { it.label })
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
        binding.spinnerCategory.adapter = adapter
        
        val generalIdx = categories.indexOf(TicketCategory.GENERAL)
        if (generalIdx >= 0) binding.spinnerCategory.setSelection(generalIdx)
    }

    private fun observeViewModel() {
        lifecycleScope.launch {
            viewModel.isLoading.collectLatest { loading ->
                binding.btnSend.isEnabled = !loading
            }
        }
    }

    private fun submitTicket() {
        val subject = binding.etSubject.text.toString().trim()
        val message = binding.etMessage.text.toString().trim()
        val category = TicketCategory.entries[binding.spinnerCategory.selectedItemPosition].value

        viewModel.createTicket(subject, message, category) { success, msg, ticketNo ->
            if (success) {
                dismiss()
                val parentView = activity?.findViewById<View>(android.R.id.content)
                if (parentView != null) {
                    Snackbar.make(parentView, "✓ Ticket #$ticketNo submitted. We'll reply shortly.", Snackbar.LENGTH_LONG)
                        .setBackgroundTint(requireContext().getColor(R.color.accent_green))
                        .setTextColor(requireContext().getColor(R.color.white))
                        .show()
                } else {
                    Toast.makeText(requireContext(), msg, Toast.LENGTH_SHORT).show()
                }
            } else {
                Toast.makeText(requireContext(), msg, Toast.LENGTH_SHORT).show()
            }
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }

    companion object {
        const val TAG = "NewTicketBottomSheet"
    }
}
