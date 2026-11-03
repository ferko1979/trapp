package com.fairco.trap

import android.graphics.Color
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.ViewCompositionStrategy
import androidx.fragment.app.viewModels
import com.fairco.trap.ui.theme.TrappTheme
import com.google.android.material.bottomsheet.BottomSheetDialog
import com.google.android.material.bottomsheet.BottomSheetDialogFragment

/** Friend picker for starting a conversation (Radar UI, see FriendPickerSheet). */
class FriendsBottomSheet(private val onFriendSelected: (Friend) -> Unit) : BottomSheetDialogFragment() {

    private val viewModel: FriendsViewModel by viewModels()

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View =
        ComposeView(requireContext()).apply {
            setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnViewTreeLifecycleDestroyed)
            setContent {
                TrappTheme {
                    FriendPickerSheet(viewModel) { friend ->
                        onFriendSelected(friend)
                        dismiss()
                    }
                }
            }
        }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        viewModel.loadFriends()
    }

    override fun onStart() {
        super.onStart()
        // Let the Compose surface draw its own rounded Radar background
        (dialog as? BottomSheetDialog)
            ?.findViewById<View>(com.google.android.material.R.id.design_bottom_sheet)
            ?.setBackgroundColor(Color.TRANSPARENT)
    }

    companion object {
        const val TAG = "FriendsBottomSheet"
    }
}
