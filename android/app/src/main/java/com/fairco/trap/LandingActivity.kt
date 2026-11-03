package com.fairco.trap

import android.content.Intent
import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.fairco.trap.ui.RadarPrimaryButton
import com.fairco.trap.ui.theme.Radar
import com.fairco.trap.ui.theme.RadarFonts
import com.fairco.trap.ui.theme.TrappTheme

class LandingActivity : BaseActivity() {
    override val radarBars = true

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            TrappTheme {
                LandingScreen(
                    onLogin = { startActivity(Intent(this, LoginActivity::class.java)) },
                    onRegister = { startActivity(Intent(this, RegisterActivity::class.java)) },
                )
            }
        }
    }
}

@Composable
private fun LandingScreen(onLogin: () -> Unit, onRegister: () -> Unit) {
    Column(
        Modifier.fillMaxSize().background(Radar.Bg).padding(horizontal = 28.dp, vertical = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Box(
            Modifier.size(120.dp).background(Radar.Surface, CircleShape).border(1.dp, Radar.Line, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Image(painterResource(R.drawable.ic_launcher_foreground), stringResource(R.string.app_name), Modifier.size(110.dp))
        }
        Spacer(Modifier.height(18.dp))
        Text(
            stringResource(R.string.app_name).uppercase(), color = Radar.Text, fontFamily = RadarFonts.Label,
            fontWeight = FontWeight.Bold, fontSize = 44.sp, letterSpacing = 4.sp,
        )
        Text(
            stringResource(R.string.splash_tagline), color = Radar.Accent, fontFamily = RadarFonts.Mono,
            fontSize = 11.sp, letterSpacing = 2.5.sp,
        )
        Spacer(Modifier.height(22.dp))
        Text(
            stringResource(R.string.msg_landing_welcome), color = Radar.TextSec, fontSize = 15.sp,
            textAlign = TextAlign.Center, lineHeight = 21.sp,
        )
        Spacer(Modifier.height(32.dp))
        RadarPrimaryButton(stringResource(R.string.action_login), onLogin, Modifier.fillMaxWidth())
        Spacer(Modifier.height(12.dp))
        RadarSecondaryButton(stringResource(R.string.action_register), onRegister, Modifier.fillMaxWidth())
    }
}
