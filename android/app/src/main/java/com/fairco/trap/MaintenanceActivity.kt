package com.fairco.trap

import android.content.Intent
import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.fairco.trap.ui.RadarEmptyState
import com.fairco.trap.ui.RadarPrimaryButton
import com.fairco.trap.ui.theme.Radar
import com.fairco.trap.ui.theme.TrappTheme
import com.google.firebase.auth.FirebaseAuth

class MaintenanceActivity : BaseActivity() {
    override val radarBars = true

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            TrappTheme {
                Column(
                    Modifier.fillMaxSize().background(Radar.Bg).padding(horizontal = 28.dp, vertical = 32.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    RadarEmptyState(
                        emoji = "🛠",
                        title = stringResource(R.string.maintenance_title),
                        hint = stringResource(R.string.maintenance_msg),
                    )
                    RadarPrimaryButton(stringResource(R.string.action_retry), ::retry, Modifier.fillMaxWidth())
                    Spacer(Modifier.height(12.dp))
                    RadarSecondaryButton(stringResource(R.string.action_logout), ::logout, Modifier.fillMaxWidth())
                }
            }
        }
    }

    private fun retry() {
        startActivity(Intent(this, GameActivity::class.java))
        finish()
    }

    private fun logout() {
        FirebaseAuth.getInstance().signOut()
        startActivity(Intent(this, LandingActivity::class.java))
        finishAffinity()
    }
}
