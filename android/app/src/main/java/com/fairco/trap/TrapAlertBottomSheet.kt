package com.fairco.trap

import android.annotation.SuppressLint
import android.content.res.ColorStateList
import android.os.Bundle
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentManager
import androidx.fragment.app.activityViewModels
import androidx.lifecycle.lifecycleScope
import com.fairco.trap.databinding.FragmentTrapAlertBinding
import com.google.android.material.bottomsheet.BottomSheetDialogFragment
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

class TrapAlertBottomSheet : BottomSheetDialogFragment() {

    private val disarmVm: TrapDisarmViewModel by activityViewModels()
    private var _binding: FragmentTrapAlertBinding? = null
    private val binding get() = _binding!!

    override fun onCreateView(
        inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?
    ) = FragmentTrapAlertBinding.inflate(inflater, container, false)
        .also { _binding = it }.root

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        // Prevent accidental dismiss by back-tap
        isCancelable = false

        viewLifecycleOwner.lifecycleScope.launch {
            disarmVm.disarmState.collect { state -> render(state) }
        }

        binding.btnIgnore.setOnClickListener {
            disarmVm.cancelReveal()
            dismiss()
        }

        setupTouchAction()
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun setupTouchAction() {
        binding.btnAction.setOnTouchListener { _, event ->
            val state = disarmVm.disarmState.value
            when (event.action) {
                MotionEvent.ACTION_DOWN -> {
                    when (state) {
                        is DisarmState.NearbyDetected -> {
                            if (state.trap.distanceMeters <= state.trap.disarmRadiusMeters) {
                                disarmVm.startReveal(state.trap)
                            }
                        }
                        is DisarmState.Error -> {
                            // On error, let them tap once to reset to detected? 
                            // Or just re-initiate if they hold.
                            // For simplicity, let's treat it as a trigger.
                        }
                        else -> {}
                    }
                    true
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    if (state is DisarmState.Revealing) {
                        disarmVm.cancelReveal()
                    } else if (state is DisarmState.Disarming) {
                        disarmVm.cancelDisarm()
                    }
                    true
                }
                else -> false
            }
        }
    }

    private fun render(state: DisarmState) {
        // Reset optional views to gone each render, then show selectively
        binding.layoutOptions.visibility = View.GONE
        binding.tvDisarmCountdown.visibility = View.GONE

        when (state) {
            is DisarmState.Idle -> dismiss()

            is DisarmState.NearbyDetected -> {
                val dist = state.trap.distanceMeters
                val danger = state.trap.radiusMeters

                binding.tvAlertTitle.text = "⚠️ TRAP DETECTED"
                binding.tvTrapDistance.text = "${dist}m away · danger zone: ${danger}m radius"
                binding.pbProximity.max = 200
                binding.pbProximity.progress = (200 - dist).coerceAtLeast(0)
                binding.pbProximity.progressTintList =
                    ColorStateList.valueOf(android.graphics.Color.parseColor("#FFB648"))

                // Option cards: fill in contextual text
                val disarmRange = state.trap.disarmRadiusMeters
                val leaveLimit = state.trap.disarmLeaveSeconds
                binding.tvDisassembleOption.text =
                    "Get within ${disarmRange}m → hold to reveal → hold to disassemble.\nLeave range for >${leaveLimit}s = cancelled. Disassembly time shown after reveal."
                binding.tvAvoidOption.text =
                    "Stay beyond ${danger}m from the trap center and navigate around it. Tap Dismiss to continue walking."
                binding.layoutOptions.visibility = View.VISIBLE

                if (dist <= disarmRange) {
                    binding.tvInstructions.text = "You're close enough — HOLD the button to reveal the trap!"
                    binding.btnAction.text = "HOLD TO REVEAL"
                    binding.btnAction.isEnabled = true
                } else {
                    binding.tvInstructions.text = "Walk to within ${disarmRange}m to reveal the trap type."
                    binding.btnAction.text = "WATCHING…"
                    binding.btnAction.isEnabled = false
                }

                binding.btnIgnore.text = "Dismiss — I'll avoid it"
                binding.btnIgnore.visibility = View.VISIBLE
            }

            is DisarmState.Revealing -> {
                val dist = state.trap.distanceMeters
                val disarmRange = state.trap.disarmRadiusMeters
                binding.tvAlertTitle.text = "🔍 Revealing Trap…"
                binding.tvTrapDistance.text = "${dist}m away"
                binding.pbProximity.max = state.requiredSeconds.toInt().coerceAtLeast(1)
                binding.pbProximity.progress = state.progressSeconds.toInt()
                if (state.tooFar) {
                    val countdown = state.outOfRangeCountdown ?: 5
                    val needed = (dist - disarmRange).coerceAtLeast(1)
                    binding.pbProximity.progressTintList =
                        ColorStateList.valueOf(android.graphics.Color.parseColor("#FFB648"))
                    binding.tvInstructions.text =
                        "⚠️ You left the zone! Return within ${disarmRange}m — move ${needed}m closer"
                    binding.tvDisarmCountdown.text = "⏳ Cancelling in ${countdown}s…"
                    binding.tvDisarmCountdown.visibility = View.VISIBLE
                } else {
                    binding.pbProximity.progressTintList =
                        ColorStateList.valueOf(
                            ContextCompat.getColor(requireContext(), R.color.accent_cyan)
                        )
                    binding.tvInstructions.text =
                        "Stay still — revealing trap type…\n${state.progressSeconds.toInt()}s / ${state.requiredSeconds.toInt()}s"
                }
                binding.btnAction.text = "Revealing…"
                binding.btnAction.isEnabled = false
                binding.btnIgnore.text = "Cancel"
                binding.btnIgnore.visibility = View.VISIBLE
            }

            is DisarmState.Disarming -> {
                val remaining = (state.requiredSeconds - state.progressSeconds).toInt().coerceAtLeast(0)
                val disarmRange = state.trap.disarmRadiusMeters
                binding.pbProximity.max = state.requiredSeconds.toInt().coerceAtLeast(1)
                binding.pbProximity.progress = state.progressSeconds.toInt()
                binding.btnIgnore.visibility = View.GONE

                if (state.tooFar) {
                    val countdown = state.outOfRangeCountdown ?: 5
                    binding.tvAlertTitle.text = "⚠️ Move Closer!"
                    binding.tvTrapDistance.text = "Disassembly paused — ${state.trap.distanceMeters}m away"
                    binding.pbProximity.progressTintList =
                        ColorStateList.valueOf(android.graphics.Color.parseColor("#FFB648"))
                    binding.tvInstructions.text =
                        "⚠️ Move ${state.metersToClose}m closer! Return within ${disarmRange}m"
                    binding.tvDisarmCountdown.text = "⏳ Cancelling in ${countdown}s…"
                    binding.tvDisarmCountdown.visibility = View.VISIBLE
                    binding.btnAction.text = "PAUSED…"
                    binding.btnAction.isEnabled = false
                } else {
                    binding.tvAlertTitle.text = "🛠 Disassembling…"
                    binding.tvTrapDistance.text = "Stay in position!"
                    binding.pbProximity.progressTintList =
                        ColorStateList.valueOf(
                            ContextCompat.getColor(requireContext(), R.color.accent_green)
                        )
                    binding.tvInstructions.text = "HOLD position — do not move!"
                    binding.tvDisarmCountdown.text = "⏱ ${remaining}s remaining"
                    binding.tvDisarmCountdown.visibility = View.VISIBLE
                    binding.btnAction.text = "HOLDING…"
                    binding.btnAction.isEnabled = true
                }
            }

            is DisarmState.CapturedWhileDisarming -> {
                binding.tvAlertTitle.text = "🪤 You've Been Trapped!"
                binding.tvTrapDistance.text = "You stepped into the trap zone"
                binding.pbProximity.progress = binding.pbProximity.max
                binding.pbProximity.progressTintList =
                    ColorStateList.valueOf(android.graphics.Color.parseColor("#FF4F62"))
                binding.tvInstructions.text =
                    "You entered the danger zone (${state.trap.radiusMeters}m) during disassembly — the trap fired!"
                binding.btnAction.text = "Dismiss"
                binding.btnAction.isEnabled = true
                binding.btnAction.setOnClickListener {
                    disarmVm.dismissSuccess()
                    dismiss()
                }
                binding.btnIgnore.visibility = View.GONE
            }

            is DisarmState.DisarmComplete -> {
                showSuccessAndDismiss(state)
            }

            is DisarmState.Error -> {
                binding.tvAlertTitle.text = "⚠️ Error"
                binding.tvInstructions.text = state.message
                binding.btnAction.text = "RETRY"
                binding.btnAction.isEnabled = true
                binding.btnIgnore.text = "Dismiss"
                binding.btnIgnore.visibility = View.VISIBLE
                binding.btnAction.setOnTouchListener(null)
                binding.btnAction.setOnClickListener {
                    disarmVm.dismissSuccess()
                }
            }
        }
    }

    private fun showSuccessAndDismiss(state: DisarmState.DisarmComplete) {
        // Replace bottom sheet content with success card
        binding.tvTrapDistance.text = "✅ Trap Disassembled!"
        binding.tvInstructions.text =
            "You collected: ${state.trapName}\nIt's now in your bag — go set a trap!"
        binding.pbProximity.progress = binding.pbProximity.max
        binding.pbProximity.progressTintList =
            ColorStateList.valueOf(
                ContextCompat.getColor(requireContext(), R.color.accent_green)
            )
        binding.btnAction.text = "Great!"
        binding.btnAction.isEnabled = true
        binding.btnAction.setOnClickListener {
            disarmVm.dismissSuccess()
            dismiss()
        }
        binding.btnIgnore.visibility = View.GONE

        // Show an interstitial ad during the success screen — natural wait moment.
        // If no ad is ready, fall back to auto-dismissing after 3 seconds.
        val activity = activity ?: return
        AdManager.showIfReady(activity) {
            // Called after the ad is dismissed (or immediately if none was ready).
            viewLifecycleOwner.lifecycleScope.launch {
                delay(3000)
                if (isAdded) {
                    disarmVm.dismissSuccess()
                    dismiss()
                }
            }
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }

    companion object {
        fun show(fragmentManager: FragmentManager) {
            if (fragmentManager.findFragmentByTag("TrapAlert") == null) {
                TrapAlertBottomSheet().show(fragmentManager, "TrapAlert")
            }
        }
    }
}
