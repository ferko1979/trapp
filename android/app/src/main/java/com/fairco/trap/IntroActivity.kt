package com.fairco.trap

import android.content.Context
import android.content.Intent
import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.fairco.trap.ui.RadarPrimaryButton
import com.fairco.trap.ui.theme.Radar
import com.fairco.trap.ui.theme.RadarFonts
import com.fairco.trap.ui.theme.TrappTheme
import com.google.firebase.auth.FirebaseAuth
import kotlinx.coroutines.launch

// ─── Slide data (resource IDs, resolved at runtime for correct locale) ────────

internal data class SlideRes(
    val iconRes: Int,
    val titleRes: Int,
    val descRes: Int,
    val tipIconRes: Int,
    val tipRes: Int,
)

private val SLIDE_RES = listOf(
    SlideRes(R.string.intro_s1_icon, R.string.intro_s1_title, R.string.intro_s1_desc, R.string.intro_s1_tip_icon, R.string.intro_s1_tip),
    SlideRes(R.string.intro_s2_icon, R.string.intro_s2_title, R.string.intro_s2_desc, R.string.intro_s2_tip_icon, R.string.intro_s2_tip),
    SlideRes(R.string.intro_s3_icon, R.string.intro_s3_title, R.string.intro_s3_desc, R.string.intro_s3_tip_icon, R.string.intro_s3_tip),
    SlideRes(R.string.intro_s4_icon, R.string.intro_s4_title, R.string.intro_s4_desc, R.string.intro_s4_tip_icon, R.string.intro_s4_tip),
    SlideRes(R.string.intro_s5_icon, R.string.intro_s5_title, R.string.intro_s5_desc, R.string.intro_s5_tip_icon, R.string.intro_s5_tip),
    SlideRes(R.string.intro_s6_icon, R.string.intro_s6_title, R.string.intro_s6_desc, R.string.intro_s6_tip_icon, R.string.intro_s6_tip),
)

// ─── Activity ─────────────────────────────────────────────────────────────────

class IntroActivity : BaseActivity() {
    override val radarBars = true

    companion object {
        private const val PREFS     = "Settings"
        private const val KEY_SHOWN = "intro_shown_v1"

        fun shouldShow(context: Context): Boolean =
            !context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getBoolean(KEY_SHOWN, false)

        fun markShown(context: Context) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit().putBoolean(KEY_SHOWN, true).apply()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { TrappTheme { IntroScreen(onFinish = ::finishIntro) } }
    }

    private fun finishIntro() {
        markShown(this)
        val user = FirebaseAuth.getInstance().currentUser
        val dest = if (user != null && user.isEmailVerified)
            Intent(this, GameActivity::class.java)
        else
            Intent(this, LandingActivity::class.java)

        startActivity(dest)
        if (android.os.Build.VERSION.SDK_INT >= 34) {
            overrideActivityTransition(OVERRIDE_TRANSITION_OPEN,
                android.R.anim.fade_in, android.R.anim.fade_out)
        } else {
            @Suppress("DEPRECATION")
            overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out)
        }
        finish()
    }
}

@Composable
private fun IntroScreen(onFinish: () -> Unit) {
    val pager = rememberPagerState { SLIDE_RES.size }
    val scope = rememberCoroutineScope()
    val isLast = pager.currentPage == SLIDE_RES.lastIndex

    Column(Modifier.fillMaxSize().background(Radar.Bg)) {
        HorizontalPager(state = pager, modifier = Modifier.weight(1f).fillMaxWidth()) { page ->
            IntroSlide(SLIDE_RES[page])
        }
        Row(
            Modifier.fillMaxWidth().padding(vertical = 12.dp),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            repeat(SLIDE_RES.size) { i ->
                val active = i == pager.currentPage
                val size by animateDpAsState(if (active) 10.dp else 8.dp, label = "dot")
                val color by animateColorAsState(if (active) Radar.Accent else Radar.Line, label = "dotColor")
                Box(Modifier.padding(horizontal = 6.dp).size(size).background(color, CircleShape))
            }
        }
        Column(
            Modifier.fillMaxWidth().padding(start = 24.dp, end = 24.dp, bottom = 20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            RadarPrimaryButton(
                stringResource(if (isLast) R.string.intro_btn_start else R.string.intro_btn_next),
                onClick = {
                    if (pager.currentPage < SLIDE_RES.lastIndex) {
                        scope.launch { pager.animateScrollToPage(pager.currentPage + 1) }
                    } else {
                        onFinish()
                    }
                },
                modifier = Modifier.fillMaxWidth(),
            )
            RadarTextAction(stringResource(if (isLast) R.string.intro_dont_show else R.string.intro_skip), onFinish)
        }
    }
}

@Composable
private fun IntroSlide(res: SlideRes) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 32.dp, vertical = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Box(
            Modifier.size(132.dp).background(Radar.Surface, CircleShape).border(1.dp, Radar.Line, CircleShape),
            contentAlignment = Alignment.Center,
        ) { Text(stringResource(res.iconRes), fontSize = 64.sp) }
        Spacer(Modifier.height(28.dp))
        Text(
            stringResource(res.titleRes), color = Radar.Text, fontSize = 26.sp, fontWeight = FontWeight.ExtraBold,
            fontFamily = RadarFonts.Body, textAlign = TextAlign.Center, lineHeight = 31.sp,
        )
        Spacer(Modifier.height(16.dp))
        Text(
            stringResource(res.descRes), color = Radar.TextSec, fontSize = 15.sp,
            textAlign = TextAlign.Center, lineHeight = 22.sp,
        )
        Spacer(Modifier.height(24.dp))
        Row(
            Modifier
                .fillMaxWidth()
                .background(Radar.Accent.copy(alpha = 0.08f), RoundedCornerShape(14.dp))
                .border(1.dp, Radar.Accent.copy(alpha = 0.35f), RoundedCornerShape(14.dp))
                .padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(stringResource(res.tipIconRes), fontSize = 20.sp)
            Spacer(Modifier.width(10.dp))
            Text(stringResource(res.tipRes), color = Radar.Accent, fontSize = 13.sp, lineHeight = 18.sp, modifier = Modifier.weight(1f))
        }
    }
}
