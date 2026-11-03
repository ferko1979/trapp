package com.fairco.trap

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.automirrored.outlined.VolumeUp
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.fairco.trap.ui.theme.Radar
import com.fairco.trap.ui.theme.RadarFonts

// ── Shared pieces ────────────────────────────────────────────────────────────

@Composable
fun PlayerAvatar(photoUrl: String?, name: String, size: Dp, ring: Color = Radar.Accent) {
    Box(
        contentAlignment = Alignment.Center,
        modifier = Modifier
            .size(size)
            .clip(CircleShape)
            .background(Brush.linearGradient(listOf(ring, Radar.AccentDeep)))
            .padding(2.dp)
            .clip(CircleShape)
            .background(Radar.Surface2)
    ) {
        if (!photoUrl.isNullOrBlank()) {
            AsyncImage(
                model = photoUrl,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize().clip(CircleShape)
            )
        } else {
            val initials = name.split(" ").filter { it.isNotEmpty() }.take(2)
                .joinToString("") { it[0].uppercase() }
            Text(
                initials.ifEmpty { "?" },
                color = Radar.Text,
                fontFamily = RadarFonts.Label,
                fontWeight = FontWeight.Bold,
                fontSize = (size.value * 0.36f).sp
            )
        }
    }
}

@Composable
fun SheetSectionLabel(text: String, modifier: Modifier = Modifier) {
    Text(
        text.uppercase(),
        color = Radar.TextMuted,
        fontFamily = RadarFonts.Label,
        fontWeight = FontWeight.SemiBold,
        fontSize = 12.sp,
        letterSpacing = 2.sp,
        modifier = modifier.padding(start = 4.dp, top = 18.dp, bottom = 8.dp)
    )
}

/** Rounded group that holds rows separated by hairlines. */
@Composable
fun SheetGroup(content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(18.dp))
            .background(Radar.Surface2)
            .border(1.dp, Radar.Line, RoundedCornerShape(18.dp)),
        content = content
    )
}

@Composable
fun SheetDivider() {
    HorizontalDivider(color = Radar.Line, thickness = 1.dp, modifier = Modifier.padding(start = 60.dp))
}

@Composable
fun SheetIconBadge(icon: ImageVector, tint: Color) {
    Box(
        contentAlignment = Alignment.Center,
        modifier = Modifier
            .size(36.dp)
            .clip(RoundedCornerShape(11.dp))
            .background(tint.copy(alpha = 0.14f))
    ) {
        Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(20.dp))
    }
}

@Composable
fun SheetRow(
    icon: ImageVector,
    title: String,
    subtitle: String? = null,
    tint: Color = Radar.Accent,
    titleColor: Color = Radar.Text,
    onClick: (() -> Unit)? = null,
    trailing: @Composable (() -> Unit)? = {
        Icon(Icons.Outlined.ChevronRight, contentDescription = null, tint = Radar.TextMuted)
    },
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .heightIn(min = 60.dp)
            .padding(horizontal = 12.dp, vertical = 10.dp)
    ) {
        SheetIconBadge(icon, tint)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(
                title,
                color = titleColor,
                fontFamily = RadarFonts.Body,
                fontWeight = FontWeight.SemiBold,
                fontSize = 15.sp
            )
            if (subtitle != null) {
                Text(
                    subtitle,
                    color = Radar.TextMuted,
                    fontFamily = RadarFonts.Body,
                    fontSize = 12.sp,
                    lineHeight = 16.sp
                )
            }
        }
        if (trailing != null) {
            Spacer(Modifier.width(8.dp))
            trailing()
        }
    }
}

@Composable
fun radarSwitchColors() = SwitchDefaults.colors(
    checkedThumbColor = Radar.OnAccent,
    checkedTrackColor = Radar.Accent,
    checkedBorderColor = Radar.Accent,
    uncheckedThumbColor = Radar.TextMuted,
    uncheckedTrackColor = Radar.Surface,
    uncheckedBorderColor = Radar.Line,
)

@Composable
private fun SheetGrabber() {
    Box(
        Modifier
            .padding(top = 10.dp, bottom = 6.dp)
            .size(width = 40.dp, height = 4.dp)
            .clip(RoundedCornerShape(2.dp))
            .background(Radar.Line)
    )
}

// ── Me sheet (bottom tab "Me") ───────────────────────────────────────────────

enum class MeAction { PROFILE, AWARDS, HISTORY, INBOX, SETTINGS, LOGOUT }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MeSheet(
    hud: MapHudState,
    unreadCount: Int,
    onAction: (MeAction) -> Unit,
    onDismiss: () -> Unit,
) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = Radar.Surface,
        shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
        dragHandle = { SheetGrabber() },
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp)
                .padding(bottom = 20.dp)
        ) {
            // Player card
            Column(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(22.dp))
                    .background(
                        Brush.verticalGradient(listOf(Radar.AccentDeep.copy(alpha = 0.45f), Radar.Surface2))
                    )
                    .border(1.dp, Radar.Line, RoundedCornerShape(22.dp))
                    .clickable { onAction(MeAction.PROFILE) }
                    .padding(16.dp)
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    PlayerAvatar(hud.photoUrl, hud.displayName, 64.dp)
                    Spacer(Modifier.width(14.dp))
                    Column(Modifier.weight(1f)) {
                        Text(
                            hud.displayName.ifBlank { stringResource(R.string.default_display_name) },
                            color = Radar.Text,
                            fontFamily = RadarFonts.Body,
                            fontWeight = FontWeight.Bold,
                            fontSize = 20.sp,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                        hud.username?.takeIf { it.isNotBlank() }?.let {
                            Text(
                                "@$it",
                                color = Radar.TextSec,
                                fontFamily = RadarFonts.Mono,
                                fontSize = 14.sp,
                                maxLines = 1
                            )
                        }
                        Spacer(Modifier.height(6.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            MeChip(stringResource(R.string.me_level, hud.level), Radar.Accent)
                            hud.membershipLabel?.let {
                                MeChip(it, if (hud.membershipPaid) Radar.Gold else Radar.TextSec)
                            }
                        }
                    }
                    Column(horizontalAlignment = Alignment.End) {
                        Text(
                            "%,d".format(hud.points).replace(',', ' '),
                            color = Radar.Text,
                            fontFamily = RadarFonts.Mono,
                            fontSize = 20.sp
                        )
                        Text(
                            stringResource(R.string.mh_pts),
                            color = Radar.TextMuted,
                            fontFamily = RadarFonts.Label,
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 11.sp,
                            letterSpacing = 1.sp
                        )
                    }
                }
                Spacer(Modifier.height(14.dp))
                LinearProgressIndicator(
                    progress = { hud.levelProgress.coerceIn(0f, 1f) },
                    color = Radar.Accent,
                    trackColor = Radar.Bg.copy(alpha = 0.6f),
                    strokeCap = androidx.compose.ui.graphics.StrokeCap.Round,
                    modifier = Modifier.fillMaxWidth().height(6.dp)
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    stringResource(R.string.me_to_next, (hud.levelProgress.coerceIn(0f, 1f) * 100).toInt()),
                    color = Radar.TextMuted,
                    fontFamily = RadarFonts.Body,
                    fontSize = 12.sp
                )
            }

            Spacer(Modifier.height(12.dp))

            // Quick tiles
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                MeTile(Icons.Outlined.Person, stringResource(R.string.me_profile), stringResource(R.string.me_profile_sub),
                    Radar.Accent, Modifier.weight(1f)) { onAction(MeAction.PROFILE) }
                MeTile(Icons.Outlined.EmojiEvents, stringResource(R.string.me_awards), stringResource(R.string.me_awards_sub),
                    Radar.Gold, Modifier.weight(1f)) { onAction(MeAction.AWARDS) }
            }
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                MeTile(Icons.Outlined.History, stringResource(R.string.me_history), stringResource(R.string.me_history_sub),
                    Radar.Trap, Modifier.weight(1f)) { onAction(MeAction.HISTORY) }
                MeTile(Icons.Outlined.Notifications, stringResource(R.string.me_inbox), stringResource(R.string.me_inbox_sub),
                    Radar.Safe, Modifier.weight(1f), badge = unreadCount) { onAction(MeAction.INBOX) }
            }

            Spacer(Modifier.height(12.dp))
            SheetGroup {
                SheetRow(
                    Icons.Outlined.Settings,
                    stringResource(R.string.me_settings),
                    stringResource(R.string.me_settings_sub),
                    tint = Radar.TextSec,
                    onClick = { onAction(MeAction.SETTINGS) }
                )
                SheetDivider()
                SheetRow(
                    Icons.AutoMirrored.Outlined.Logout,
                    stringResource(R.string.me_logout),
                    tint = Radar.Trap,
                    titleColor = Radar.TrapSoft,
                    onClick = { onAction(MeAction.LOGOUT) },
                    trailing = null
                )
            }
        }
    }
}

@Composable
private fun MeChip(text: String, color: Color) {
    Text(
        text.uppercase(),
        color = color,
        fontFamily = RadarFonts.Label,
        fontWeight = FontWeight.SemiBold,
        fontSize = 11.sp,
        letterSpacing = 1.sp,
        maxLines = 1,
        modifier = Modifier
            .clip(RoundedCornerShape(10.dp))
            .background(color.copy(alpha = 0.14f))
            .padding(horizontal = 8.dp, vertical = 3.dp)
    )
}

@Composable
private fun MeTile(
    icon: ImageVector,
    title: String,
    subtitle: String,
    tint: Color,
    modifier: Modifier,
    badge: Int = 0,
    onClick: () -> Unit,
) {
    Column(
        modifier
            .clip(RoundedCornerShape(18.dp))
            .background(Radar.Surface2)
            .border(1.dp, Radar.Line, RoundedCornerShape(18.dp))
            .clickable(onClick = onClick)
            .padding(14.dp)
    ) {
        Box {
            SheetIconBadge(icon, tint)
            if (badge > 0) {
                Box(
                    contentAlignment = Alignment.Center,
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .offset(x = 8.dp, y = (-6).dp)
                        .height(18.dp)
                        .widthIn(min = 18.dp)
                        .clip(RoundedCornerShape(9.dp))
                        .background(Radar.Trap)
                        .border(1.5.dp, Radar.Surface2, RoundedCornerShape(9.dp))
                        .padding(horizontal = 4.dp)
                ) {
                    Text(
                        if (badge > 99) "99+" else badge.toString(),
                        color = Color.White,
                        fontFamily = RadarFonts.Label,
                        fontWeight = FontWeight.Bold,
                        fontSize = 10.sp,
                        lineHeight = 10.sp
                    )
                }
            }
        }
        Spacer(Modifier.height(12.dp))
        Text(title, color = Radar.Text, fontFamily = RadarFonts.Body, fontWeight = FontWeight.SemiBold, fontSize = 15.sp,
            maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(subtitle, color = Radar.TextMuted, fontFamily = RadarFonts.Body, fontSize = 12.sp,
            maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

// ── Map layers sheet ─────────────────────────────────────────────────────────

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LayersSheet(
    heatmapOn: Boolean,
    darkMap: Boolean,
    onToggleHeatmap: () -> Unit,
    onToggleDark: () -> Unit,
    onReload: () -> Unit,
    onDismiss: () -> Unit,
) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = Radar.Surface,
        shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
        dragHandle = { SheetGrabber() },
    ) {
        Column(Modifier.padding(horizontal = 16.dp).padding(bottom = 24.dp)) {
            SheetSectionLabel(stringResource(R.string.layers_title), Modifier.padding(top = 0.dp))
            SheetGroup {
                SheetRow(
                    Icons.Outlined.Whatshot, stringResource(R.string.layers_heatmap), stringResource(R.string.layers_heatmap_sub),
                    tint = Radar.Trap, onClick = onToggleHeatmap,
                    trailing = { Switch(heatmapOn, { onToggleHeatmap() }, colors = radarSwitchColors()) }
                )
                SheetDivider()
                SheetRow(
                    Icons.Outlined.DarkMode, stringResource(R.string.layers_dark), stringResource(R.string.layers_dark_sub),
                    tint = Radar.Accent, onClick = onToggleDark,
                    trailing = { Switch(darkMap, { onToggleDark() }, colors = radarSwitchColors()) }
                )
                SheetDivider()
                SheetRow(
                    Icons.Outlined.Refresh, stringResource(R.string.layers_reload),
                    tint = Radar.Safe, onClick = onReload, trailing = null
                )
            }
        }
    }
}

// ── Settings sheet — every control applies immediately ───────────────────────

/** Values the settings/layers sheets show; GameActivity writes them as it applies each change. */
class SettingsUiState {
    var lang by mutableStateOf("en")
    var theme by mutableStateOf(ThemePreferences.ThemeMode.AUTOMATIC)
    var sound by mutableStateOf(true)
    var notifications by mutableStateOf(true)
    /** null while the server value is still loading. */
    var hideFromNearby by mutableStateOf<Boolean?>(null)
    var heatmap by mutableStateOf(false)
}

/** App languages: code → native name. Codes map to res/values-<code> folders. */
val APP_LANGUAGES = listOf(
    "en" to "English (UK)", "en-US" to "English (US)",
    "hu" to "Magyar", "de" to "Deutsch", "fr" to "Français", "es" to "Español",
    "it" to "Italiano", "pt" to "Português", "nl" to "Nederlands", "pl" to "Polski",
    "cs" to "Čeština", "sk" to "Slovenčina", "sl" to "Slovenščina", "hr" to "Hrvatski",
    "sr" to "Српски", "bs" to "Bosanski", "mk" to "Македонски", "bg" to "Български",
    "ro" to "Română", "el" to "Ελληνικά", "sq" to "Shqip", "tr" to "Türkçe",
    "da" to "Dansk", "sv" to "Svenska", "nb" to "Norsk", "fi" to "Suomi",
    "is" to "Íslenska", "et" to "Eesti", "lv" to "Latviešu", "lt" to "Lietuvių",
    "ga" to "Gaeilge", "cy" to "Cymraeg", "mt" to "Malti", "lb" to "Lëtzebuergesch",
    "ca" to "Català", "eu" to "Euskara", "gl" to "Galego", "be" to "Беларуская",
    "uk" to "Українська", "ru" to "Русский", "zh" to "中文（简体）", "he" to "עברית",
)

fun appLanguageName(code: String) = APP_LANGUAGES.firstOrNull { it.first == code }?.second ?: code

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsSheet(
    lang: String,
    theme: ThemePreferences.ThemeMode,
    sound: Boolean,
    notifications: Boolean,
    /** null while the server value is still loading. */
    hideFromNearby: Boolean?,
    showUpgrade: Boolean,
    versionName: String,
    onLang: (String) -> Unit,
    onTheme: (ThemePreferences.ThemeMode) -> Unit,
    onSound: (Boolean) -> Unit,
    onNotifications: (Boolean) -> Unit,
    onHideFromNearby: (Boolean) -> Unit,
    onUpgrade: () -> Unit,
    onChangeEmail: () -> Unit,
    onSupport: () -> Unit,
    onDeleteAccount: () -> Unit,
    onDismiss: () -> Unit,
) {
    var langPickerOpen by remember { mutableStateOf(false) }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = Radar.Surface,
        shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
        dragHandle = { SheetGrabber() },
    ) {
        Column(Modifier.fillMaxWidth()) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.padding(start = 20.dp, end = 12.dp)
            ) {
                Column(Modifier.weight(1f)) {
                    Text(
                        stringResource(R.string.me_settings),
                        color = Radar.Text,
                        fontFamily = RadarFonts.Body,
                        fontWeight = FontWeight.Bold,
                        fontSize = 22.sp
                    )
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Outlined.CloudDone, null, tint = Radar.Safe, modifier = Modifier.size(14.dp))
                        Spacer(Modifier.width(4.dp))
                        Text(
                            stringResource(R.string.set_instant_hint),
                            color = Radar.TextMuted,
                            fontFamily = RadarFonts.Body,
                            fontSize = 12.sp
                        )
                    }
                }
                CloseCircle(onDismiss)
            }

            Column(
                Modifier
                    .weight(1f, fill = false)
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp)
            ) {
                // Language + theme
                SheetSectionLabel(stringResource(R.string.set_appearance))
                SheetGroup {
                    SheetRow(
                        Icons.Outlined.Language, stringResource(R.string.label_language), appLanguageName(lang),
                        tint = Radar.Accent, onClick = { langPickerOpen = true }
                    )
                }
                Spacer(Modifier.height(10.dp))
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(16.dp))
                        .background(Radar.Surface2)
                        .border(1.dp, Radar.Line, RoundedCornerShape(16.dp))
                        .padding(4.dp)
                ) {
                    listOf(
                        Triple(ThemePreferences.ThemeMode.AUTOMATIC, Icons.Outlined.BrightnessAuto, R.string.set_theme_auto),
                        Triple(ThemePreferences.ThemeMode.ALWAYS_LIGHT, Icons.Outlined.LightMode, R.string.set_theme_light),
                        Triple(ThemePreferences.ThemeMode.ALWAYS_DARK, Icons.Outlined.DarkMode, R.string.set_theme_dark),
                    ).forEach { (mode, icon, label) ->
                        val on = mode == theme
                        Row(
                            horizontalArrangement = Arrangement.Center,
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier
                                .weight(1f)
                                .height(44.dp)
                                .clip(RoundedCornerShape(12.dp))
                                .background(if (on) Radar.Accent.copy(alpha = 0.18f) else Color.Transparent)
                                .clickable { if (!on) onTheme(mode) }
                        ) {
                            Icon(icon, null, tint = if (on) Radar.Accent else Radar.TextMuted, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(6.dp))
                            Text(
                                stringResource(label),
                                color = if (on) Radar.Accent else Radar.TextSec,
                                fontFamily = RadarFonts.Body,
                                fontWeight = if (on) FontWeight.Bold else FontWeight.Medium,
                                fontSize = 14.sp,
                                maxLines = 1
                            )
                        }
                    }
                }
                if (theme == ThemePreferences.ThemeMode.AUTOMATIC) {
                    Text(
                        stringResource(R.string.set_theme_auto_hint),
                        color = Radar.TextMuted,
                        fontFamily = RadarFonts.Body,
                        fontSize = 12.sp,
                        modifier = Modifier.padding(start = 4.dp, top = 6.dp)
                    )
                }

                // Sound, notifications, privacy
                SheetSectionLabel(stringResource(R.string.set_privacy))
                SheetGroup {
                    SheetRow(
                        Icons.AutoMirrored.Outlined.VolumeUp, stringResource(R.string.label_enable_sound),
                        stringResource(R.string.set_sound_sub),
                        tint = Radar.Accent, onClick = { onSound(!sound) },
                        trailing = { Switch(sound, onSound, colors = radarSwitchColors()) }
                    )
                    SheetDivider()
                    SheetRow(
                        Icons.Outlined.NotificationsActive, stringResource(R.string.label_enable_notifications),
                        stringResource(R.string.set_notif_sub),
                        tint = Radar.Gold, onClick = { onNotifications(!notifications) },
                        trailing = { Switch(notifications, onNotifications, colors = radarSwitchColors()) }
                    )
                    SheetDivider()
                    SheetRow(
                        Icons.Outlined.VisibilityOff, stringResource(R.string.label_hide_from_nearby),
                        stringResource(R.string.hint_hide_from_nearby),
                        tint = Radar.Safe,
                        onClick = hideFromNearby?.let { { onHideFromNearby(!it) } },
                        trailing = {
                            if (hideFromNearby == null) {
                                CircularProgressIndicator(color = Radar.Accent, strokeWidth = 2.dp, modifier = Modifier.size(20.dp))
                            } else {
                                Switch(hideFromNearby, onHideFromNearby, colors = radarSwitchColors())
                            }
                        }
                    )
                }

                // Account
                SheetSectionLabel(stringResource(R.string.set_account))
                SheetGroup {
                    if (showUpgrade) {
                        SheetRow(
                            Icons.Outlined.WorkspacePremium,
                            stringResource(R.string.action_upgrade_to_premium).replace("⭐", "").trim(),
                            tint = Radar.Gold, titleColor = Radar.Gold, onClick = onUpgrade
                        )
                        SheetDivider()
                    }
                    SheetRow(Icons.Outlined.AlternateEmail, stringResource(R.string.set_change_email),
                        tint = Radar.Accent, onClick = onChangeEmail)
                    SheetDivider()
                    SheetRow(Icons.Outlined.SupportAgent, stringResource(R.string.title_support_tickets),
                        tint = Radar.Accent, onClick = onSupport)
                }

                // About
                SheetSectionLabel(stringResource(R.string.set_about))
                SheetGroup {
                    SheetRow(
                        Icons.Outlined.Info, "PlayTrap", stringResource(R.string.set_version, versionName) + " · Fairco",
                        tint = Radar.TextSec, trailing = null
                    )
                }

                // Danger zone
                SheetSectionLabel(stringResource(R.string.set_danger))
                OutlinedButton(
                    onClick = onDeleteAccount,
                    border = BorderStroke(1.dp, Radar.Trap.copy(alpha = 0.6f)),
                    shape = RoundedCornerShape(14.dp),
                    modifier = Modifier.fillMaxWidth().height(50.dp)
                ) {
                    Icon(Icons.Outlined.DeleteForever, null, tint = Radar.Trap, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text(stringResource(R.string.action_delete_account), color = Radar.TrapSoft,
                        fontFamily = RadarFonts.Body, fontWeight = FontWeight.SemiBold)
                }
                Spacer(Modifier.height(16.dp))
            }

            // Sticky close
            Box(
                Modifier
                    .fillMaxWidth()
                    .background(Radar.Surface)
                    .padding(horizontal = 16.dp, vertical = 12.dp)
            ) {
                Button(
                    onClick = onDismiss,
                    shape = RoundedCornerShape(14.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = Radar.Surface2, contentColor = Radar.Text),
                    border = BorderStroke(1.dp, Radar.Line),
                    modifier = Modifier.fillMaxWidth().height(52.dp)
                ) {
                    Text(stringResource(R.string.me_close), fontFamily = RadarFonts.Body, fontWeight = FontWeight.Bold,
                        fontSize = 16.sp)
                }
            }
        }
    }

    if (langPickerOpen) {
        LanguagePickerSheet(
            current = lang,
            onPick = { code ->
                langPickerOpen = false
                if (code != lang) onLang(code)
            },
            onDismiss = { langPickerOpen = false }
        )
    }
}

@Composable
private fun CloseCircle(onClick: () -> Unit) {
    Box(
        contentAlignment = Alignment.Center,
        modifier = Modifier
            .size(40.dp)
            .clip(CircleShape)
            .background(Radar.Surface2)
            .border(1.dp, Radar.Line, CircleShape)
            .clickable(onClick = onClick)
    ) {
        Icon(Icons.Outlined.Close, contentDescription = stringResource(R.string.me_close), tint = Radar.TextSec,
            modifier = Modifier.size(20.dp))
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun LanguagePickerSheet(current: String, onPick: (String) -> Unit, onDismiss: () -> Unit) {
    var query by remember { mutableStateOf("") }
    val shown = remember(query) {
        val q = query.trim().lowercase()
        if (q.isEmpty()) APP_LANGUAGES
        else APP_LANGUAGES.filter { (code, name) -> name.lowercase().contains(q) || code.lowercase().startsWith(q) }
    }
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = Radar.Surface,
        shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
        dragHandle = { SheetGrabber() },
    ) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(start = 4.dp)) {
                Text(
                    stringResource(R.string.label_language),
                    color = Radar.Text,
                    fontFamily = RadarFonts.Body,
                    fontWeight = FontWeight.Bold,
                    fontSize = 22.sp,
                    modifier = Modifier.weight(1f)
                )
                CloseCircle(onDismiss)
            }
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                singleLine = true,
                placeholder = { Text(stringResource(R.string.set_lang_search), color = Radar.TextMuted) },
                leadingIcon = { Icon(Icons.Outlined.Search, null, tint = Radar.TextMuted) },
                shape = RoundedCornerShape(14.dp),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedTextColor = Radar.Text,
                    unfocusedTextColor = Radar.Text,
                    focusedBorderColor = Radar.Accent,
                    unfocusedBorderColor = Radar.Line,
                    focusedContainerColor = Radar.Surface2,
                    unfocusedContainerColor = Radar.Surface2,
                    cursorColor = Radar.Accent,
                ),
                modifier = Modifier.fillMaxWidth()
            )
            Spacer(Modifier.height(10.dp))
            Column(
                Modifier
                    .fillMaxWidth()
                    .heightIn(max = 460.dp)
                    .verticalScroll(rememberScrollState())
                    .padding(bottom = 20.dp)
            ) {
                shown.forEach { (code, name) ->
                    val on = code == current
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(14.dp))
                            .background(if (on) Radar.Accent.copy(alpha = 0.14f) else Color.Transparent)
                            .clickable { onPick(code) }
                            .padding(horizontal = 14.dp, vertical = 13.dp)
                    ) {
                        Text(
                            name,
                            color = if (on) Radar.Accent else Radar.Text,
                            fontFamily = RadarFonts.Body,
                            fontWeight = if (on) FontWeight.Bold else FontWeight.Medium,
                            fontSize = 16.sp,
                            modifier = Modifier.weight(1f)
                        )
                        Text(
                            code.uppercase(),
                            color = Radar.TextMuted,
                            fontFamily = RadarFonts.Mono,
                            fontSize = 12.sp
                        )
                        if (on) {
                            Spacer(Modifier.width(10.dp))
                            Icon(Icons.Outlined.Check, null, tint = Radar.Accent, modifier = Modifier.size(20.dp))
                        }
                    }
                }
            }
        }
    }
}
