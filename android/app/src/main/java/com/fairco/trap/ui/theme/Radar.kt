package com.fairco.trap.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import com.fairco.trap.R

/** "Radar" design tokens — the single colour source for every Compose screen. */
object Radar {
    val Bg = Color(0xFF070E1A)
    val Surface = Color(0xFF0E1828)
    val Surface2 = Color(0xFF15233A)
    val Line = Color(0xFF22385A)

    val Text = Color(0xFFEAF1FA)
    val TextSec = Color(0xFFA7B7CC)
    val TextMuted = Color(0xFF7D91AB)

    val Accent = Color(0xFF38D3F2)
    val OnAccent = Color(0xFF04121C)
    /** Darker cyan for containers that carry white text. */
    val AccentDeep = Color(0xFF0B6C86)

    val Trap = Color(0xFFFF4F62)
    val TrapSoft = Color(0xFFFF8A97)
    val Gold = Color(0xFFFFB648)
    val OnGold = Color(0xFF1A1204)
    val Safe = Color(0xFF3EE08F)

    /** Readable text colour on a filled [bg]: dark on bright fills, white on deep ones. */
    fun contentOn(bg: Color): Color = if (bg.luminance() > 0.4f) OnAccent else Color.White
}

object RadarFonts {
    val Body = FontFamily(
        Font(R.font.exo2_regular, FontWeight.Normal),
        Font(R.font.exo2_extrabold, FontWeight.ExtraBold),
    )
    /** Uppercase labels and buttons. */
    val Label = FontFamily(
        Font(R.font.rajdhani_medium, FontWeight.Medium),
        Font(R.font.rajdhani_semibold, FontWeight.SemiBold),
        Font(R.font.rajdhani_bold, FontWeight.Bold),
    )
    /** Numbers: points, timers, distances. */
    val Mono = FontFamily(Font(R.font.sharetechmono_regular, FontWeight.Normal))
}

private val RadarColors = darkColorScheme(
    primary = Radar.Accent,
    onPrimary = Radar.OnAccent,
    primaryContainer = Radar.AccentDeep,
    onPrimaryContainer = Color.White,
    secondary = Radar.Gold,
    onSecondary = Radar.OnGold,
    tertiary = Radar.Safe,
    error = Radar.Trap,
    onError = Color.White,
    background = Radar.Bg,
    onBackground = Radar.Text,
    surface = Radar.Surface,
    onSurface = Radar.Text,
    surfaceVariant = Radar.Surface2,
    onSurfaceVariant = Radar.TextSec,
    surfaceContainer = Radar.Surface,
    surfaceContainerHigh = Radar.Surface2,
    outline = Radar.Line,
    outlineVariant = Radar.Line,
)

private val RadarTypography = Typography().let { base ->
    fun TextStyle.body() = copy(fontFamily = RadarFonts.Body)
    fun TextStyle.label() = copy(fontFamily = RadarFonts.Label, fontWeight = FontWeight.Bold, letterSpacing = 1.2.sp)
    base.copy(
        displayLarge = base.displayLarge.body(),
        displayMedium = base.displayMedium.body(),
        displaySmall = base.displaySmall.body(),
        headlineLarge = base.headlineLarge.body().copy(fontWeight = FontWeight.ExtraBold),
        headlineMedium = base.headlineMedium.body().copy(fontWeight = FontWeight.ExtraBold),
        headlineSmall = base.headlineSmall.body().copy(fontWeight = FontWeight.ExtraBold),
        titleLarge = base.titleLarge.body().copy(fontWeight = FontWeight.ExtraBold),
        titleMedium = base.titleMedium.body(),
        titleSmall = base.titleSmall.body(),
        bodyLarge = base.bodyLarge.body(),
        bodyMedium = base.bodyMedium.body(),
        bodySmall = base.bodySmall.body(),
        labelLarge = base.labelLarge.label(),
        labelMedium = base.labelMedium.label(),
        labelSmall = base.labelSmall.label(),
    )
}

@Composable
fun TrappTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = RadarColors, typography = RadarTypography, content = content)
}
