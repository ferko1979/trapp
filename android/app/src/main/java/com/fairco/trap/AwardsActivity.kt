package com.fairco.trap

import android.os.Bundle
import androidx.activity.viewModels
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.platform.ComposeView

class AwardsActivity : BaseActivity() {

    private val vm: AwardsViewModel by viewModels { AwardsViewModel.Factory(this) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        vm.load()
        setContentView(ComposeView(this).apply {
            setContent {
                MaterialTheme {
                    AwardsScreen(viewModel = vm, onBack = { finish() })
                }
            }
        })
    }
}
