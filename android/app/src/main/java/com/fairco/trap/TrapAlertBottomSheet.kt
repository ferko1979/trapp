package com.fairco.trap

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.ViewCompositionStrategy
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.fragment.app.FragmentManager
import androidx.fragment.app.activityViewModels
import androidx.lifecycle.lifecycleScope
import com.fairco.trap.ui.theme.Radar
import com.fairco.trap.ui.theme.RadarFonts
import com.fairco.trap.ui.theme.TrappTheme
import com.google.android.material.bottomsheet.BottomSheetBehavior
import com.google.android.material.bottomsheet.BottomSheetDialog
import com.google.android.material.bottomsheet.BottomSheetDialogFragment
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

class TrapAlertBottomSheet : BottomSheetDialogFragment() {

    private val disarmVm: TrapDisarmViewModel by activityViewModels()

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View =
        ComposeView(requireContext()).apply {
            setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnViewTreeLifecycleDestroyed)
            setContent {
                TrappTheme {
                    val state by disarmVm.disarmState.collectAsState()
                    TrapAlertSheet(
                        state = state,
                        onHoldStart = ::onHoldStart,
                        onHoldEnd = ::onHoldEnd,
                        onActionClick = ::onActionClick,
                        onIgnore = {
                            disarmVm.cancelReveal()
                            dismiss()
                        },
                    )
                }
            }
        }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        // Prevent accidental dismiss by back-tap
        isCancelable = false

        // Side effects only; the Compose content renders every state itself.
        viewLifecycleOwner.lifecycleScope.launch {
            disarmVm.disarmState.collect { state ->
                when (state) {
                    is DisarmState.Idle -> dismiss()
                    is DisarmState.DisarmComplete -> showAdThenDismiss()
                    else -> {}
                }
            }
        }
    }

    override fun onStart() {
        super.onStart()
        // Let the Compose surface draw its own rounded Radar background, fully expanded.
        (dialog as? BottomSheetDialog)
            ?.findViewById<View>(com.google.android.material.R.id.design_bottom_sheet)
            ?.let { sheet ->
                sheet.setBackgroundColor(android.graphics.Color.TRANSPARENT)
                BottomSheetBehavior.from(sheet).apply {
                    state = BottomSheetBehavior.STATE_EXPANDED
                    skipCollapsed = true
                }
            }
    }

    private fun onHoldStart() {
        val state = disarmVm.disarmState.value
        if (state is DisarmState.NearbyDetected &&
            state.trap.distanceMeters <= state.trap.disarmRadiusMeters
        ) {
            disarmVm.startReveal(state.trap)
        }
    }

    private fun onHoldEnd() {
        when (disarmVm.disarmState.value) {
            is DisarmState.Revealing -> disarmVm.cancelReveal()
            is DisarmState.Disarming -> disarmVm.cancelDisarm()
            else -> {}
        }
    }

    private fun onActionClick() {
        when (disarmVm.disarmState.value) {
            is DisarmState.CapturedWhileDisarming, is DisarmState.DisarmComplete -> {
                disarmVm.dismissSuccess()
                dismiss()
            }
            is DisarmState.Error -> disarmVm.dismissSuccess()
            else -> {}
        }
    }

    private fun showAdThenDismiss() {
        // Show an interstitial ad during the success screen — natural wait moment.
        // If no ad is ready, fall back to auto-dismissing after 3 seconds.
        val activity = activity ?: return
        AdManager.showIfReady(activity) {
            // Called after the ad is dismissed (or immediately if none was ready).
            if (view == null) return@showIfReady
            viewLifecycleOwner.lifecycleScope.launch {
                delay(3000)
                if (isAdded) {
                    disarmVm.dismissSuccess()
                    dismiss()
                }
            }
        }
    }

    companion object {
        fun show(fragmentManager: FragmentManager) {
            if (fragmentManager.findFragmentByTag("TrapAlert") == null) {
                TrapAlertBottomSheet().show(fragmentManager, "TrapAlert")
            }
        }
    }
}

// ─── UI ───────────────────────────────────────────────────────────────────────

/** How the main button reacts: a press-and-hold gesture, a plain tap, or nothing. */
private enum class ActionMode { Hold, Click, Disabled }

private data class AlertUi(
    val title: String,
    val titleColor: Color,
    val subtitle: String?,
    val progress: Float?,
    val progressColor: Color,
    val instructions: String,
    val countdown: String?,
    val options: Pair<String, String>?,
    val actionLabel: String,
    val actionMode: ActionMode,
    val ignoreLabel: String?,
)

@Composable
private fun alertUi(state: DisarmState): AlertUi? = when (state) {
    is DisarmState.Idle -> null

    is DisarmState.NearbyDetected -> {
        val dist = state.trap.distanceMeters
        val danger = state.trap.radiusMeters
        val disarmRange = state.trap.disarmRadiusMeters
        val inRange = dist <= disarmRange
        AlertUi(
            title = stringResource(R.string.alert_trap_detected),
            titleColor = Radar.Trap,
            subtitle = stringResource(R.string.alert_distance_danger, dist, danger),
            progress = (200 - dist).coerceAtLeast(0) / 200f,
            progressColor = Radar.Gold,
            instructions = if (inRange) stringResource(R.string.alert_close_enough_hold)
            else stringResource(R.string.alert_walk_within, disarmRange),
            countdown = null,
            options = stringResource(R.string.alert_option_disassemble, disarmRange, state.trap.disarmLeaveSeconds) to
                stringResource(R.string.alert_option_avoid, danger),
            actionLabel = stringResource(if (inRange) R.string.alert_hold_to_reveal else R.string.alert_watching),
            actionMode = if (inRange) ActionMode.Hold else ActionMode.Disabled,
            ignoreLabel = stringResource(R.string.alert_dismiss_avoid),
        )
    }

    is DisarmState.Revealing -> {
        val dist = state.trap.distanceMeters
        val disarmRange = state.trap.disarmRadiusMeters
        val required = state.requiredSeconds.toInt().coerceAtLeast(1)
        AlertUi(
            title = stringResource(R.string.alert_revealing_title),
            titleColor = Radar.Accent,
            subtitle = stringResource(R.string.alert_distance_away, dist),
            progress = state.progressSeconds.toInt() / required.toFloat(),
            progressColor = if (state.tooFar) Radar.Gold else Radar.Accent,
            instructions = if (state.tooFar) {
                stringResource(R.string.alert_left_zone, disarmRange, (dist - disarmRange).coerceAtLeast(1))
            } else {
                stringResource(R.string.alert_stay_still_revealing, state.progressSeconds.toInt(), state.requiredSeconds.toInt())
            },
            countdown = if (state.tooFar) stringResource(R.string.alert_cancelling_in, state.outOfRangeCountdown ?: 5) else null,
            options = null,
            actionLabel = stringResource(R.string.alert_revealing),
            // The old button was disabled here, so lifting the finger did not cancel the reveal.
            actionMode = ActionMode.Disabled,
            ignoreLabel = stringResource(R.string.action_cancel),
        )
    }

    is DisarmState.Disarming -> {
        val remaining = (state.requiredSeconds - state.progressSeconds).toInt().coerceAtLeast(0)
        val required = state.requiredSeconds.toInt().coerceAtLeast(1)
        val progress = state.progressSeconds.toInt() / required.toFloat()
        if (state.tooFar) {
            AlertUi(
                title = stringResource(R.string.alert_move_closer_title),
                titleColor = Radar.Gold,
                subtitle = stringResource(R.string.alert_disassembly_paused, state.trap.distanceMeters),
                progress = progress,
                progressColor = Radar.Gold,
                instructions = stringResource(R.string.alert_move_closer_msg, state.metersToClose, state.trap.disarmRadiusMeters),
                countdown = stringResource(R.string.alert_cancelling_in, state.outOfRangeCountdown ?: 5),
                options = null,
                actionLabel = stringResource(R.string.alert_paused),
                actionMode = ActionMode.Disabled,
                ignoreLabel = null,
            )
        } else {
            AlertUi(
                title = stringResource(R.string.alert_disassembling_title),
                titleColor = Radar.Safe,
                subtitle = stringResource(R.string.alert_stay_in_position),
                progress = progress,
                progressColor = Radar.Safe,
                instructions = stringResource(R.string.alert_hold_position),
                countdown = stringResource(R.string.alert_seconds_remaining, remaining),
                options = null,
                actionLabel = stringResource(R.string.alert_holding),
                actionMode = ActionMode.Hold,
                ignoreLabel = null,
            )
        }
    }

    is DisarmState.CapturedWhileDisarming -> AlertUi(
        title = stringResource(R.string.alert_trapped_title),
        titleColor = Radar.Trap,
        subtitle = stringResource(R.string.alert_stepped_in_zone),
        progress = 1f,
        progressColor = Radar.Trap,
        instructions = stringResource(R.string.alert_entered_danger_zone, state.trap.radiusMeters),
        countdown = null,
        options = null,
        actionLabel = stringResource(R.string.action_dismiss),
        actionMode = ActionMode.Click,
        ignoreLabel = null,
    )

    is DisarmState.DisarmComplete -> AlertUi(
        title = stringResource(R.string.alert_disassembled_title),
        titleColor = Radar.Safe,
        subtitle = null,
        progress = 1f,
        progressColor = Radar.Safe,
        instructions = stringResource(R.string.alert_collected_msg, state.trapName),
        countdown = null,
        options = null,
        actionLabel = stringResource(R.string.alert_great),
        actionMode = ActionMode.Click,
        ignoreLabel = null,
    )

    is DisarmState.Error -> AlertUi(
        title = stringResource(R.string.alert_error_title),
        titleColor = Radar.Trap,
        subtitle = null,
        progress = null,
        progressColor = Radar.Trap,
        instructions = if (state.resId != 0) stringResource(state.resId, *state.args.toTypedArray()) else state.message,
        countdown = null,
        options = null,
        actionLabel = stringResource(R.string.alert_retry),
        actionMode = ActionMode.Click,
        ignoreLabel = stringResource(R.string.action_dismiss),
    )
}

@Composable
private fun TrapAlertSheet(
    state: DisarmState,
    onHoldStart: () -> Unit,
    onHoldEnd: () -> Unit,
    onActionClick: () -> Unit,
    onIgnore: () -> Unit,
) {
    val ui = alertUi(state) ?: return
    val sheetShape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp)

    Column(
        Modifier
            .fillMaxWidth()
            .background(Radar.Surface, sheetShape)
            .border(1.dp, Radar.Line, sheetShape)
            .navigationBarsPadding()
            .padding(horizontal = 20.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(
            Modifier.align(Alignment.CenterHorizontally).size(width = 40.dp, height = 4.dp)
                .background(Radar.Line, RoundedCornerShape(2.dp))
        )

        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.size(52.dp)
                    .background(ui.titleColor.copy(alpha = 0.14f), CircleShape)
                    .border(1.dp, ui.titleColor.copy(alpha = 0.5f), CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Image(painterResource(R.drawable.ic_trap_warning), contentDescription = null, modifier = Modifier.size(30.dp))
            }
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    ui.title, color = ui.titleColor, fontFamily = RadarFonts.Label,
                    fontWeight = FontWeight.Bold, fontSize = 20.sp, letterSpacing = 0.5.sp,
                )
                if (ui.subtitle != null) {
                    Text(ui.subtitle, color = Radar.TextSec, fontFamily = RadarFonts.Mono, fontSize = 12.sp)
                }
            }
        }

        if (ui.progress != null) {
            LinearProgressIndicator(
                progress = { ui.progress.coerceIn(0f, 1f) },
                modifier = Modifier.fillMaxWidth().height(8.dp),
                color = ui.progressColor,
                trackColor = Radar.Line,
                strokeCap = StrokeCap.Round,
            )
        }

        Text(ui.instructions, color = Radar.Text, fontSize = 15.sp, lineHeight = 21.sp)

        if (ui.countdown != null) {
            Text(
                ui.countdown, color = Radar.Gold, fontFamily = RadarFonts.Mono, fontWeight = FontWeight.Bold,
                fontSize = 16.sp, modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center,
            )
        }

        if (ui.options != null) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                OptionCard(stringResource(R.string.alert_option_disassemble_title), ui.options.first, Radar.Accent, Modifier.weight(1f))
                OptionCard(stringResource(R.string.alert_option_avoid_title), ui.options.second, Radar.Gold, Modifier.weight(1f))
            }
        }

        ActionButton(ui.actionLabel, ui.actionMode, onHoldStart, onHoldEnd, onActionClick)

        if (ui.ignoreLabel != null) {
            RadarSecondaryButton(ui.ignoreLabel, onIgnore, Modifier.fillMaxWidth())
        }
        Spacer(Modifier.height(4.dp))
    }
}

@Composable
private fun OptionCard(title: String, body: String, accent: Color, modifier: Modifier = Modifier) {
    val shape = RoundedCornerShape(14.dp)
    Column(
        modifier.background(Radar.Surface2, shape).border(1.dp, Radar.Line, shape).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(title, color = accent, fontFamily = RadarFonts.Label, fontWeight = FontWeight.Bold, fontSize = 15.sp)
        Text(body, color = Radar.TextSec, fontSize = 12.sp, lineHeight = 16.sp)
    }
}

/** Big action button: press-and-hold drives reveal/disarm, otherwise a plain tap. */
@Composable
private fun ActionButton(
    label: String,
    mode: ActionMode,
    onHoldStart: () -> Unit,
    onHoldEnd: () -> Unit,
    onClick: () -> Unit,
) {
    val shape = RoundedCornerShape(14.dp)
    val enabled = mode != ActionMode.Disabled
    // One gesture spans several states (reveal → disarm), so it reads the mode live
    // instead of restarting; like the old disabled button, a disabled one ignores the event.
    val currentMode by rememberUpdatedState(mode)
    val holdStart by rememberUpdatedState(onHoldStart)
    val holdEnd by rememberUpdatedState(onHoldEnd)
    val click by rememberUpdatedState(onClick)

    Box(
        Modifier
            .fillMaxWidth()
            .height(54.dp)
            .background(if (enabled) Radar.Accent else Radar.Surface2, shape)
            .border(1.dp, if (enabled) Radar.Accent else Radar.Line, shape)
            .pointerInput(Unit) {
                awaitEachGesture {
                    awaitFirstDown()
                    if (currentMode == ActionMode.Hold) holdStart()
                    val up = waitForUpOrCancellation()
                    when (currentMode) {
                        ActionMode.Hold -> holdEnd()
                        ActionMode.Click -> if (up != null) click()
                        ActionMode.Disabled -> {}
                    }
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label.uppercase(), color = if (enabled) Radar.OnAccent else Radar.TextMuted,
            fontFamily = RadarFonts.Label, fontWeight = FontWeight.Bold, fontSize = 17.sp, letterSpacing = 1.sp,
        )
    }
}
