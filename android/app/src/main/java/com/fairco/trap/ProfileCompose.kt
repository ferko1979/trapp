package com.fairco.trap

import android.util.Patterns
import android.widget.Toast
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.fairco.trap.ui.theme.Radar
import com.fairco.trap.ui.theme.RadarFonts
import java.text.SimpleDateFormat
import java.util.*

@Composable
fun ProfileScreenContent(
    viewModel: ProfileViewModel,
    onFinish: () -> Unit,
    onChangePhoto: () -> Unit = {}
) {
    val username by viewModel.username.collectAsState()
    val displayName by viewModel.displayName.collectAsState()
    val photoUrl by viewModel.photoUrl.collectAsState()
    val uploadingPhoto by viewModel.uploadingPhoto.collectAsState()
    val usernameCheckState by viewModel.usernameCheckState.collectAsState()
    val saveState by viewModel.saveState.collectAsState()
    val userData by viewModel.userData.collectAsState()
    val emailChangeLoading by viewModel.emailChangeLoading.collectAsState()
    val userEmail = viewModel.userEmail
    val userUid = viewModel.userUid

    var showEmailChangeDialog by remember { mutableStateOf(false) }

    if (showEmailChangeDialog) {
        EmailChangeDialog(
            userUid = userUid,
            userEmail = userEmail,
            onSubmit = { viewModel.requestEmailChange(it); showEmailChangeDialog = false },
            onDismiss = { showEmailChangeDialog = false },
        )
    }

    Column(Modifier.fillMaxSize().background(Radar.Bg)) {
        // Top bar
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp)
        ) {
            IconButton(
                onClick = onFinish,
                modifier = Modifier.size(40.dp).clip(CircleShape).background(Radar.Surface2)
            ) {
                Icon(Icons.AutoMirrored.Outlined.ArrowBack, stringResource(R.string.action_back), tint = Radar.Text)
            }
            Text(
                stringResource(R.string.title_profile).uppercase(),
                color = Radar.Text,
                fontFamily = RadarFonts.Label,
                fontWeight = FontWeight.Bold,
                fontSize = 18.sp,
                letterSpacing = 2.sp,
                modifier = Modifier.padding(start = 14.dp)
            )
        }

        Column(
            Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp)
        ) {
            ProfileHero(
                photoUrl = photoUrl,
                displayName = displayName,
                username = username,
                data = userData,
                uploading = uploadingPhoto,
                onChangePhoto = onChangePhoto,
            )

            userData?.let { data ->
                SheetSectionLabel(stringResource(R.string.section_game_stats))
                val days = stringResource(R.string.label_days)
                val stats = listOf(
                    Triple("🪤", R.string.label_traps_placed, "${data.trapCount ?: 0}"),
                    Triple("🎯", R.string.label_players_caught, "${data.captureCount ?: 0}"),
                    Triple("😵", R.string.label_times_caught, "${data.timesCaught ?: 0}"),
                    Triple("⚡", R.string.label_total_score, "${data.score ?: 0}"),
                    Triple("🧠", R.string.label_xp, "${data.xp ?: 0}"),
                    Triple("📅", R.string.label_days_played, "${data.totalDaysPlayed ?: 0}"),
                    Triple("🔥", R.string.label_current_streak, "${data.currentStreak ?: 0} $days"),
                    Triple("🏆", R.string.label_longest_streak, "${data.longestStreak ?: 0} $days"),
                )
                stats.chunked(2).forEach { pair ->
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.padding(bottom = 10.dp)) {
                        pair.forEach { (emoji, label, value) ->
                            StatTile(emoji, stringResource(label), value, Modifier.weight(1f))
                        }
                    }
                }
                val none = stringResource(R.string.label_none)
                SheetGroup {
                    ProfileInfoRow(Icons.Outlined.GpsFixed, stringResource(R.string.label_last_caught),
                        data.lastCapturedUsername?.let { "@$it" } ?: none, tint = Radar.Safe)
                    SheetDivider()
                    ProfileInfoRow(Icons.Outlined.Warning, stringResource(R.string.label_last_caught_by),
                        data.lastTrappedByUsername?.let { "@$it" } ?: none, tint = Radar.Trap)
                }
            }

            SheetSectionLabel(stringResource(R.string.section_identity))
            SheetGroup {
                Column(Modifier.padding(14.dp)) {
                    RadarTextField(
                        value = displayName,
                        onValueChange = viewModel::onDisplayNameChanged,
                        label = stringResource(R.string.label_display_name),
                        icon = Icons.Outlined.Badge,
                    )
                    Spacer(Modifier.height(12.dp))
                    RadarTextField(
                        value = username,
                        onValueChange = viewModel::onUsernameChanged,
                        label = stringResource(R.string.label_username_field),
                        icon = Icons.Outlined.AlternateEmail,
                        isError = usernameCheckState is UsernameCheckState.Taken,
                        supporting = when (usernameCheckState) {
                            UsernameCheckState.Checking -> stringResource(R.string.msg_checking_availability) to Radar.TextMuted
                            UsernameCheckState.Available -> stringResource(R.string.msg_username_available) to Radar.Safe
                            UsernameCheckState.Taken -> stringResource(R.string.msg_username_taken) to Radar.Trap
                            else -> null
                        },
                    )
                }
            }

            userData?.let { data ->
                SheetSectionLabel(stringResource(R.string.prof_details))
                SheetGroup {
                    if (!data.birthDate.isNullOrBlank()) {
                        ProfileInfoRow(Icons.Outlined.Cake, stringResource(R.string.label_date_of_birth),
                            "${formatDate(data.birthDate)} · ${stringResource(R.string.prof_years, calculateAge(data.birthDate))}")
                        SheetDivider()
                    }
                    if (!data.phoneNumber.isNullOrBlank()) {
                        ProfileInfoRow(Icons.Outlined.PhoneIphone, stringResource(R.string.label_phone), data.phoneNumber)
                        SheetDivider()
                    }
                    ProfileInfoRow(Icons.Outlined.Public, stringResource(R.string.label_time_zone),
                        data.timeZone ?: stringResource(R.string.label_not_specified))
                    SheetDivider()
                    ProfileInfoRow(Icons.Outlined.Person, stringResource(R.string.label_age_group),
                        when (data.ageGroup) {
                            "adult" -> stringResource(R.string.label_age_adult)
                            "minor" -> stringResource(R.string.label_age_minor)
                            else -> stringResource(R.string.label_not_specified)
                        })
                    SheetDivider()
                    ProfileInfoRow(Icons.Outlined.CalendarMonth, stringResource(R.string.label_member_since),
                        formatEpoch(data.createdAtEpochMs))
                }
            }

            SheetSectionLabel(stringResource(R.string.section_account))
            SheetGroup {
                SheetRow(
                    icon = Icons.Outlined.Email,
                    title = userEmail,
                    subtitle = stringResource(R.string.msg_email_change_support),
                    onClick = if (emailChangeLoading) null else ({ showEmailChangeDialog = true }),
                    trailing = {
                        if (emailChangeLoading) {
                            CircularProgressIndicator(Modifier.size(18.dp), color = Radar.Accent, strokeWidth = 2.dp)
                        } else {
                            Text(stringResource(R.string.action_request_change), color = Radar.Accent,
                                fontFamily = RadarFonts.Body, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                        }
                    },
                )
                SheetDivider()
                CopyRow(stringResource(R.string.label_user_id), userUid)
            }

            Spacer(Modifier.height(24.dp))
        }

        // Save bar only appears once a text field differs from the stored profile.
        val dirty = userData?.let { d ->
            displayName.trim() != d.displayName.trim() ||
                username.trim().lowercase() != d.username.lowercase()
        } == true
        val canSave = saveState !is SaveState.Saving &&
            usernameCheckState !is UsernameCheckState.Taken &&
            usernameCheckState !is UsernameCheckState.Checking
        AnimatedVisibility(
            visible = dirty || saveState is SaveState.Saving,
            enter = slideInVertically { it },
            exit = slideOutVertically { it },
        ) { Box(
            Modifier
                .fillMaxWidth()
                .background(Radar.Surface)
                .padding(horizontal = 16.dp, vertical = 12.dp)
        ) {
            Button(
                onClick = { viewModel.saveProfile() },
                enabled = canSave,
                shape = RoundedCornerShape(16.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = Radar.Accent, contentColor = Radar.OnAccent,
                    disabledContainerColor = Radar.Surface2, disabledContentColor = Radar.TextMuted,
                ),
                modifier = Modifier.fillMaxWidth().height(54.dp)
            ) {
                if (saveState is SaveState.Saving) {
                    CircularProgressIndicator(color = Radar.OnAccent, strokeWidth = 2.dp, modifier = Modifier.size(20.dp))
                } else {
                    Icon(Icons.Outlined.Check, contentDescription = null, modifier = Modifier.size(20.dp))
                    Spacer(Modifier.width(8.dp))
                    Text(stringResource(R.string.action_save_changes), fontFamily = RadarFonts.Label,
                        fontWeight = FontWeight.Bold, fontSize = 16.sp, letterSpacing = 1.sp)
                }
            }
        } }
    }
}

@Composable
private fun ProfileHero(
    photoUrl: String?,
    displayName: String,
    username: String,
    data: UserData?,
    uploading: Boolean,
    onChangePhoto: () -> Unit,
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 4.dp)
            .clip(RoundedCornerShape(24.dp))
            .background(Brush.verticalGradient(listOf(Radar.AccentDeep.copy(alpha = 0.55f), Radar.Surface)))
            .border(1.dp, Radar.Line, RoundedCornerShape(24.dp))
            .padding(vertical = 22.dp, horizontal = 16.dp)
    ) {
        Box(
            Modifier
                .size(112.dp)
                .clickable(enabled = !uploading, onClick = onChangePhoto)
        ) {
            PlayerAvatar(photoUrl, displayName, 112.dp)
            if (uploading) {
                Box(
                    contentAlignment = Alignment.Center,
                    modifier = Modifier.fillMaxSize().clip(CircleShape).background(Color(0x99000000))
                ) {
                    CircularProgressIndicator(color = Radar.Accent, strokeWidth = 3.dp, modifier = Modifier.size(32.dp))
                }
            }
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .size(36.dp)
                    .clip(CircleShape)
                    .background(Radar.Bg)
                    .padding(3.dp)
                    .clip(CircleShape)
                    .background(Radar.Accent)
            ) {
                Icon(Icons.Outlined.PhotoCamera, stringResource(R.string.label_change_photo),
                    tint = Radar.OnAccent, modifier = Modifier.size(18.dp))
            }
        }
        Spacer(Modifier.height(14.dp))
        Text(
            displayName.ifBlank { "—" },
            color = Radar.Text,
            fontFamily = RadarFonts.Label,
            fontWeight = FontWeight.Bold,
            fontSize = 24.sp,
            textAlign = TextAlign.Center,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        if (username.isNotBlank()) {
            Text("@$username", color = Radar.TextSec, fontFamily = RadarFonts.Mono, fontSize = 14.sp)
        }
        if (data != null) {
            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                val level = data.playerLevelNumber ?: 1
                HeroChip(
                    Icons.Outlined.Star,
                    data.playerLevelName?.let { "$it · ${stringResource(R.string.prof_level, level)}" }
                        ?: stringResource(R.string.prof_level, level),
                    Radar.Accent,
                )
                val paid = data.membership == "paid"
                HeroChip(
                    Icons.Outlined.WorkspacePremium,
                    data.membershipLevelName ?: data.membership?.replaceFirstChar { it.uppercase() }
                        ?: stringResource(R.string.prof_free),
                    if (paid) Radar.Gold else Radar.TextSec,
                )
            }
        }
    }
}

@Composable
private fun HeroChip(icon: ImageVector, text: String, tint: Color) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .clip(RoundedCornerShape(50))
            .background(tint.copy(alpha = 0.14f))
            .border(1.dp, tint.copy(alpha = 0.35f), RoundedCornerShape(50))
            .padding(horizontal = 12.dp, vertical = 6.dp)
    ) {
        Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(14.dp))
        Spacer(Modifier.width(6.dp))
        Text(text, color = tint, fontFamily = RadarFonts.Body, fontWeight = FontWeight.SemiBold, fontSize = 12.sp,
            maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun StatTile(emoji: String, label: String, value: String, modifier: Modifier) {
    Column(
        modifier
            .clip(RoundedCornerShape(18.dp))
            .background(Radar.Surface2)
            .border(1.dp, Radar.Line, RoundedCornerShape(18.dp))
            .padding(14.dp)
    ) {
        Text(emoji, fontSize = 18.sp)
        Spacer(Modifier.height(6.dp))
        Text(value, color = Radar.Text, fontFamily = RadarFonts.Mono, fontSize = 22.sp, maxLines = 1)
        Text(label, color = Radar.TextMuted, fontFamily = RadarFonts.Body, fontSize = 12.sp,
            maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun ProfileInfoRow(icon: ImageVector, label: String, value: String, tint: Color = Radar.Accent) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.fillMaxWidth().heightIn(min = 60.dp).padding(horizontal = 12.dp, vertical = 10.dp)
    ) {
        SheetIconBadge(icon, tint)
        Spacer(Modifier.width(12.dp))
        Text(label, color = Radar.TextSec, fontFamily = RadarFonts.Body, fontSize = 14.sp, modifier = Modifier.weight(1f))
        Spacer(Modifier.width(8.dp))
        Text(value, color = Radar.Text, fontFamily = RadarFonts.Body, fontWeight = FontWeight.SemiBold, fontSize = 14.sp,
            textAlign = TextAlign.End, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun CopyRow(label: String, value: String) {
    val clipboard = LocalClipboardManager.current
    val context = LocalContext.current
    val copied = stringResource(R.string.prof_copied)
    SheetRow(
        icon = Icons.Outlined.Key,
        title = label,
        subtitle = value,
        tint = Radar.TextSec,
        onClick = {
            clipboard.setText(AnnotatedString(value))
            Toast.makeText(context, copied, Toast.LENGTH_SHORT).show()
        },
        trailing = { Icon(Icons.Outlined.ContentCopy, contentDescription = null, tint = Radar.Accent, modifier = Modifier.size(18.dp)) },
    )
}

@Composable
private fun radarFieldColors() = OutlinedTextFieldDefaults.colors(
    focusedTextColor = Radar.Text,
    unfocusedTextColor = Radar.Text,
    focusedContainerColor = Radar.Surface,
    unfocusedContainerColor = Radar.Surface,
    focusedBorderColor = Radar.Accent,
    unfocusedBorderColor = Radar.Line,
    errorBorderColor = Radar.Trap,
    focusedLabelColor = Radar.Accent,
    unfocusedLabelColor = Radar.TextMuted,
    errorLabelColor = Radar.Trap,
    cursorColor = Radar.Accent,
    focusedLeadingIconColor = Radar.Accent,
    unfocusedLeadingIconColor = Radar.TextMuted,
)

@Composable
private fun RadarTextField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    icon: ImageVector,
    isError: Boolean = false,
    supporting: Pair<String, Color>? = null,
    keyboardType: KeyboardType = KeyboardType.Text,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(label) },
        leadingIcon = { Icon(icon, contentDescription = null) },
        isError = isError,
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
        supportingText = supporting?.let { (text, color) -> { Text(text, color = color) } },
        shape = RoundedCornerShape(14.dp),
        colors = radarFieldColors(),
        modifier = Modifier.fillMaxWidth()
    )
}

@Composable
private fun EmailChangeDialog(userUid: String, userEmail: String, onSubmit: (String) -> Unit, onDismiss: () -> Unit) {
    var input by remember { mutableStateOf("") }
    var invalid by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Radar.Surface,
        titleContentColor = Radar.Text,
        textContentColor = Radar.TextSec,
        shape = RoundedCornerShape(24.dp),
        title = { Text(stringResource(R.string.title_request_email_change), fontFamily = RadarFonts.Label, fontWeight = FontWeight.Bold) },
        text = {
            Column {
                Text(stringResource(R.string.label_email_address), fontSize = 12.sp, color = Radar.TextMuted)
                Text(userEmail, fontSize = 15.sp, color = Radar.Text)
                Spacer(Modifier.height(6.dp))
                Text(stringResource(R.string.label_user_id), fontSize = 12.sp, color = Radar.TextMuted)
                Text(userUid, fontSize = 12.sp, color = Radar.TextSec, fontFamily = RadarFonts.Mono)
                Spacer(Modifier.height(14.dp))
                RadarTextField(
                    value = input,
                    onValueChange = { input = it; invalid = false },
                    label = stringResource(R.string.label_new_email),
                    icon = Icons.Outlined.Email,
                    isError = invalid,
                    supporting = if (invalid) stringResource(R.string.error_invalid_email) to Radar.Trap else null,
                    keyboardType = KeyboardType.Email,
                )
            }
        },
        confirmButton = {
            TextButton(onClick = {
                val trimmed = input.trim()
                if (Patterns.EMAIL_ADDRESS.matcher(trimmed).matches()) onSubmit(trimmed) else invalid = true
            }) {
                Text(stringResource(R.string.action_submit), color = Radar.Accent, fontWeight = FontWeight.Bold)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text(stringResource(R.string.action_close), color = Radar.TextSec)
            }
        }
    )
}

fun calculateAge(birthDate: String): Int {
    val parts = birthDate.split("-").map { it.toIntOrNull() ?: 0 }
    if (parts.size < 3) return 0
    val today = Calendar.getInstance()
    val birth = Calendar.getInstance().apply {
        set(parts[0], parts[1] - 1, parts[2])
    }
    var age = today.get(Calendar.YEAR) - birth.get(Calendar.YEAR)
    if (today.get(Calendar.DAY_OF_YEAR) < birth.get(Calendar.DAY_OF_YEAR)) {
        age--
    }
    return age
}

fun formatDate(date: String): String {
    return date // Simplified for now
}

fun formatEpoch(epoch: Long?): String {
    if (epoch == null) return "—"
    val sdf = SimpleDateFormat("MMM yyyy", Locale.getDefault())
    return sdf.format(Date(epoch))
}
