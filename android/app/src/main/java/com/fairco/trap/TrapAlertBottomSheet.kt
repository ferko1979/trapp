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

                binding.tvAlertTitle.text = getString(R.string.alert_trap_detected)
                binding.tvTrapDistance.text = getString(R.string.alert_distance_danger, dist, danger)
                binding.pbProximity.max = 200
                binding.pbProximity.progress = (200 - dist).coerceAtLeast(0)
                binding.pbProximity.progressTintList =
                    ColorStateList.valueOf(android.graphics.Color.parseColor("#FFB648"))

                // Option cards: fill in contextual text
                val disarmRange = state.trap.disarmRadiusMeters
                val leaveLimit = state.trap.disarmLeaveSeconds
                binding.tvDisassembleOption.text =
                    getString(R.string.alert_option_disassemble, disarmRange, leaveLimit)
                binding.tvAvoidOption.text =
                    getString(R.string.alert_option_avoid, danger)
                binding.layoutOptions.visibility = View.VISIBLE

                if (dist <= disarmRange) {
                    binding.tvInstructions.text = getString(R.string.alert_close_enough_hold)
                    binding.btnAction.text = getString(R.string.alert_hold_to_reveal)
                    binding.btnAction.isEnabled = true
                } else {
                    binding.tvInstructions.text = getString(R.string.alert_walk_within, disarmRange)
                    binding.btnAction.text = getString(R.string.alert_watching)
                    binding.btnAction.isEnabled = false
                }

                binding.btnIgnore.text = getString(R.string.alert_dismiss_avoid)
                binding.btnIgnore.visibility = View.VISIBLE
            }

            is DisarmState.Revealing -> {
                val dist = state.trap.distanceMeters
                val disarmRange = state.trap.disarmRadiusMeters
                binding.tvAlertTitle.text = getString(R.string.alert_revealing_title)
                binding.tvTrapDistance.text = getString(R.string.alert_distance_away, dist)
                binding.pbProximity.max = state.requiredSeconds.toInt().coerceAtLeast(1)
                binding.pbProximity.progress = state.progressSeconds.toInt()
                if (state.tooFar) {
                    val countdown = state.outOfRangeCountdown ?: 5
                    val needed = (dist - disarmRange).coerceAtLeast(1)
                    binding.pbProximity.progressTintList =
                        ColorStateList.valueOf(android.graphics.Color.parseColor("#FFB648"))
                    binding.tvInstructions.text =
                        getString(R.string.alert_left_zone, disarmRange, needed)
                    binding.tvDisarmCountdown.text = getString(R.string.alert_cancelling_in, countdown)
                    binding.tvDisarmCountdown.visibility = View.VISIBLE
                } else {
                    binding.pbProximity.progressTintList =
                        ColorStateList.valueOf(
                            ContextCompat.getColor(requireContext(), R.color.accent_cyan)
                        )
                    binding.tvInstructions.text =
                        getString(R.string.alert_stay_still_revealing, state.progressSeconds.toInt(), state.requiredSeconds.toInt())
                }
                binding.btnAction.text = getString(R.string.alert_revealing)
                binding.btnAction.isEnabled = false
                binding.btnIgnore.text = getString(R.string.action_cancel)
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
                    binding.tvAlertTitle.text = getString(R.string.alert_move_closer_title)
                    binding.tvTrapDistance.text = getString(R.string.alert_disassembly_paused, state.trap.distanceMeters)
                    binding.pbProximity.progressTintList =
                        ColorStateList.valueOf(android.graphics.Color.parseColor("#FFB648"))
                    binding.tvInstructions.text =
                        getString(R.string.alert_move_closer_msg, state.metersToClose, disarmRange)
                    binding.tvDisarmCountdown.text = getString(R.string.alert_cancelling_in, countdown)
                    binding.tvDisarmCountdown.visibility = View.VISIBLE
                    binding.btnAction.text = getString(R.string.alert_paused)
                    binding.btnAction.isEnabled = false
                } else {
                    binding.tvAlertTitle.text = getString(R.string.alert_disassembling_title)
                    binding.tvTrapDistance.text = getString(R.string.alert_stay_in_position)
                    binding.pbProximity.progressTintList =
                        ColorStateList.valueOf(
                            ContextCompat.getColor(requireContext(), R.color.accent_green)
                        )
                    binding.tvInstructions.text = getString(R.string.alert_hold_position)
                    binding.tvDisarmCountdown.text = getString(R.string.alert_seconds_remaining, remaining)
                    binding.tvDisarmCountdown.visibility = View.VISIBLE
                    binding.btnAction.text = getString(R.string.alert_holding)
                    binding.btnAction.isEnabled = true
                }
            }

            is DisarmState.CapturedWhileDisarming -> {
                binding.tvAlertTitle.text = getString(R.string.alert_trapped_title)
                binding.tvTrapDistance.text = getString(R.string.alert_stepped_in_zone)
                binding.pbProximity.progress = binding.pbProximity.max
                binding.pbProximity.progressTintList =
                    ColorStateList.valueOf(android.graphics.Color.parseColor("#FF4F62"))
                binding.tvInstructions.text =
                    getString(R.string.alert_entered_danger_zone, state.trap.radiusMeters)
                binding.btnAction.text = getString(R.string.action_dismiss)
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
                binding.tvAlertTitle.text = getString(R.string.alert_error_title)
                binding.tvInstructions.text =
                    if (state.resId != 0) getString(state.resId, *state.args.toTypedArray()) else state.message
                binding.btnAction.text = getString(R.string.alert_retry)
                binding.btnAction.isEnabled = true
                binding.btnIgnore.text = getString(R.string.action_dismiss)
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
        binding.tvTrapDistance.text = getString(R.string.alert_disassembled_title)
        binding.tvInstructions.text =
            getString(R.string.alert_collected_msg, state.trapName)
        binding.pbProximity.progress = binding.pbProximity.max
        binding.pbProximity.progressTintList =
            ColorStateList.valueOf(
                ContextCompat.getColor(requireContext(), R.color.accent_green)
            )
        binding.btnAction.text = getString(R.string.alert_great)
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
