package com.fairco.trap

import android.os.Bundle
import com.fairco.trap.ui.theme.TrappTheme
import androidx.activity.viewModels
import androidx.compose.ui.platform.ComposeView

class AwardsActivity : BaseActivity() {

    override val radarBars = true

    private val vm: AwardsViewModel by viewModels { AwardsViewModel.Factory(this) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        vm.load()
        setContentView(ComposeView(this).apply {
            setContent {
                TrappTheme {
                    AwardsScreen(viewModel = vm, onBack = { finish() })
                }
            }
        })
    }
}
