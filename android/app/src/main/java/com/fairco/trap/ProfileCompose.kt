package com.fairco.trap

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import android.util.Patterns
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ContentCopy
import androidx.compose.material.icons.rounded.Email
import androidx.compose.material3.*
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
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
    var newEmailInput by remember { mutableStateOf("") }
    var emailInputError by remember { mutableStateOf(false) }

    if (showEmailChangeDialog) {
        AlertDialog(
            onDismissRequest = { showEmailChangeDialog = false; newEmailInput = ""; emailInputError = false },
            title = { Text(stringResource(R.string.title_request_email_change)) },
            text = {
                Column {
                    Text(stringResource(R.string.label_user_id), fontSize = 11.sp, color = Color(0xFF64748B))
                    Text(userUid, fontSize = 12.sp, color = Color(0xFF475569), fontFamily = FontFamily.Monospace)
                    Spacer(Modifier.height(8.dp))
                    Text(stringResource(R.string.label_email_address), fontSize = 11.sp, color = Color(0xFF64748B))
                    Text(userEmail, fontSize = 14.sp, color = Color(0xFF1E293B))
                    Spacer(Modifier.height(12.dp))
                    OutlinedTextField(
                        value = newEmailInput,
                        onValueChange = { newEmailInput = it; emailInputError = false },
                        label = { Text(stringResource(R.string.label_new_email)) },
                        placeholder = { Text(stringResource(R.string.hint_new_email)) },
                        isError = emailInputError,
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(8.dp)
                    )
                    if (emailInputError) {
                        Text(stringResource(R.string.error_invalid_email), color = Color(0xFFEF4444), fontSize = 11.sp)
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    val trimmed = newEmailInput.trim()
                    if (!Patterns.EMAIL_ADDRESS.matcher(trimmed).matches()) {
                        emailInputError = true
                    } else {
                        viewModel.requestEmailChange(trimmed)
                        showEmailChangeDialog = false
                        newEmailInput = ""
                        emailInputError = false
                    }
                }) {
                    Text(stringResource(R.string.action_submit))
                }
            },
            dismissButton = {
                TextButton(onClick = { showEmailChangeDialog = false; newEmailInput = ""; emailInputError = false }) {
                    Text(stringResource(R.string.action_cancel))
                }
            }
        )
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.White)
            .verticalScroll(rememberScrollState())
            .padding(16.dp)
    ) {
        // Avatar + Change Photo
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Box(
                modifier = Modifier.size(88.dp),
                contentAlignment = Alignment.Center
            ) {
                if (!photoUrl.isNullOrBlank()) {
                    AsyncImage(
                        model = photoUrl,
                        contentDescription = "Profile photo",
                        contentScale = ContentScale.Crop,
                        modifier = Modifier
                            .size(88.dp)
                            .clip(CircleShape)
                    )
                } else {
                    val initials = displayName.split(" ").filter { it.isNotEmpty() }
                        .take(2).joinToString("") { it[0].uppercase() }
                    Box(
                        modifier = Modifier
                            .size(88.dp)
                            .background(Color(0xFFF1F5F9), CircleShape),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            initials.ifEmpty { "?" },
                            fontSize = 30.sp,
                            fontWeight = FontWeight.Bold,
                            color = Color(0xFF64748B)
                        )
                    }
                }
                if (uploadingPhoto) {
                    Box(
                        modifier = Modifier
                            .size(88.dp)
                            .background(Color(0x80000000), CircleShape),
                        contentAlignment = Alignment.Center
                    ) {
                        CircularProgressIndicator(
                            color = Color.White,
                            modifier = Modifier.size(28.dp),
                            strokeWidth = 3.dp
                        )
                    }
                }
            }
            TextButton(
                onClick = onChangePhoto,
                enabled = !uploadingPhoto
            ) {
                Text(
                    if (uploadingPhoto) stringResource(R.string.label_uploading) else stringResource(R.string.label_change_photo),
                    color = Color(0xFF3B82F6),
                    fontSize = 14.sp
                )
            }
        }

        Spacer(Modifier.height(16.dp))

        // IDENTITY
        ProfileSectionHeader(stringResource(R.string.section_identity))
        OutlinedTextField(
            value = displayName,
            onValueChange = { viewModel.onDisplayNameChanged(it) },
            label = { Text(stringResource(R.string.label_display_name)) },
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp)
        )
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(
            value = username,
            onValueChange = { viewModel.onUsernameChanged(it) },
            label = { Text(stringResource(R.string.label_username_field)) },
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
            isError = usernameCheckState is UsernameCheckState.Taken,
            supportingText = {
                when (usernameCheckState) {
                    UsernameCheckState.Checking -> Text(stringResource(R.string.msg_checking_availability))
                    UsernameCheckState.Available -> Text(stringResource(R.string.msg_username_available), color = Color(0xFF22C55E))
                    UsernameCheckState.Taken -> Text(stringResource(R.string.msg_username_taken), color = Color(0xFFEF4444))
                    else -> {}
                }
            }
        )

        HorizontalDivider(modifier = Modifier.padding(vertical = 16.dp), color = Color(0xFFF1F5F9))

        // PERSONAL DETAILS
        val adultLabel = stringResource(R.string.label_age_adult)
        val minorLabel = stringResource(R.string.label_age_minor)
        val notSpecifiedLabel = stringResource(R.string.label_not_specified)
        userData?.let { data ->
            ProfileSectionHeader(stringResource(R.string.section_personal_details))
            if (!data.birthDate.isNullOrBlank()) {
                ProfileReadRow("🎂", stringResource(R.string.label_age), "${calculateAge(data.birthDate)} years old")
                ProfileReadRow("📅", stringResource(R.string.label_date_of_birth), formatDate(data.birthDate))
            }
            if (!data.phoneNumber.isNullOrBlank()) {
                ProfileReadRow("📱", stringResource(R.string.label_phone), data.phoneNumber)
            }
            ProfileReadRow("🌍", stringResource(R.string.label_time_zone), data.timeZone ?: "Not set")
            ProfileReadRow("👤", stringResource(R.string.label_age_group),
                when (data.ageGroup) {
                    "adult" -> adultLabel
                    "minor" -> minorLabel
                    else    -> notSpecifiedLabel
                }
            )
            ProfileReadRow("📆", stringResource(R.string.label_member_since), formatEpoch(data.createdAtEpochMs))

            HorizontalDivider(modifier = Modifier.padding(vertical = 16.dp), color = Color(0xFFF1F5F9))
        }

        // ACCOUNT
        ProfileSectionHeader(stringResource(R.string.section_account))
        Column(modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(R.string.label_email_address), color = Color(0xFF64748B), fontSize = 12.sp,
                modifier = Modifier.padding(bottom = 2.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    userEmail,
                    color = Color(0xFF1E293B),
                    fontSize = 15.sp,
                    modifier = Modifier.weight(1f)
                )
                TextButton(
                    onClick = { showEmailChangeDialog = true },
                    enabled = !emailChangeLoading
                ) {
                    if (emailChangeLoading) {
                        CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp, color = Color(0xFF3B82F6))
                    } else {
                        Icon(Icons.Rounded.Email, contentDescription = null,
                            modifier = Modifier.size(16.dp), tint = Color(0xFF3B82F6))
                    }
                    Spacer(Modifier.width(4.dp))
                    Text(stringResource(R.string.action_request_change), color = if (emailChangeLoading) Color(0xFF94A3B8) else Color(0xFF3B82F6), fontSize = 13.sp)
                }
            }

            Text(
                stringResource(R.string.msg_email_change_support),
                color = Color(0xFF94A3B8),
                fontSize = 11.sp,
                lineHeight = 15.sp
            )
        }
        Spacer(Modifier.height(8.dp))
        ProfileCopyRow("🔑", stringResource(R.string.label_user_id), userUid)
        userData?.let { data ->
            // Show the membership tier name (e.g. "Free", "Monthly Plan") from user_levels
            ProfileReadRow(
                "🏅",
                stringResource(R.string.label_membership),
                data.membershipLevelName ?: data.membership?.replaceFirstChar { it.uppercase() } ?: "Free"
            )
            // XP-based game progression level — blank when not yet set by backend
            val xpLevelLabel = when {
                data.playerLevelName != null -> "${data.playerLevelName} (Lv. ${data.playerLevelNumber ?: 1})"
                (data.playerLevelNumber ?: 1) > 1 -> "Lv. ${data.playerLevelNumber}"
                else -> "Lv. 1"   // brand-new player, no named tier yet
            }
            ProfileReadRow("⭐", stringResource(R.string.label_player_level), xpLevelLabel)
        }

        HorizontalDivider(modifier = Modifier.padding(vertical = 16.dp), color = Color(0xFFF1F5F9))

        // GAME STATS
        val daysLabel = stringResource(R.string.label_days)
        val noneLabel = stringResource(R.string.label_none)
        userData?.let { data ->
            ProfileSectionHeader(stringResource(R.string.section_game_stats))
            ProfileStatRow("🪤", stringResource(R.string.label_traps_placed),    data.trapCount      ?: 0)
            ProfileStatRow("🎯", stringResource(R.string.label_players_caught),  data.captureCount   ?: 0)
            ProfileStatRow("😵", stringResource(R.string.label_times_caught),    data.timesCaught    ?: 0)
            ProfileStatRow("⚡", stringResource(R.string.label_total_score),     data.score          ?: 0)
            ProfileStatRow("🧠", stringResource(R.string.label_xp),             data.xp             ?: 0)
            ProfileStatRow("🔥", stringResource(R.string.label_current_streak), data.currentStreak  ?: 0, suffix = daysLabel)
            ProfileStatRow("🏆", stringResource(R.string.label_longest_streak), data.longestStreak  ?: 0, suffix = daysLabel)
            ProfileStatRow("📅", stringResource(R.string.label_days_played),    data.totalDaysPlayed ?: 0)

            HorizontalDivider(modifier = Modifier.padding(vertical = 8.dp), color = Color(0xFFE2E8F0))

            ProfileTextRow("👤", stringResource(R.string.label_last_caught),    data.lastCapturedUsername?.let { "@$it" } ?: noneLabel)
            ProfileTextRow("🚨", stringResource(R.string.label_last_caught_by), data.lastTrappedByUsername?.let { "@$it" } ?: noneLabel)
        }

        Spacer(Modifier.height(24.dp))

        // Bottom button row
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            OutlinedButton(
                onClick = onFinish,
                modifier = Modifier.weight(1f).height(52.dp),
                border = BorderStroke(1.dp, Color(0xFFCBD5E1)),
                shape = RoundedCornerShape(12.dp),
            ) {
                Text(stringResource(R.string.action_discard), color = Color(0xFF64748B), fontWeight = FontWeight.SemiBold)
            }

            Button(
                onClick = { viewModel.saveProfile() },
                modifier = Modifier.weight(2f).height(52.dp),
                enabled = saveState !is SaveState.Saving
                        && usernameCheckState !is UsernameCheckState.Taken
                        && usernameCheckState !is UsernameCheckState.Checking,
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF2563EB))
            ) {
                if (saveState is SaveState.Saving) {
                    CircularProgressIndicator(color = Color.White, modifier = Modifier.size(18.dp))
                } else {
                    Text(stringResource(R.string.action_save_changes), fontWeight = FontWeight.Bold)
                }
            }
        }
        
        Spacer(Modifier.height(32.dp))
    }
}

@Composable
fun ProfileSectionHeader(title: String) {
    Text(
        title.uppercase(),
        color = Color(0xFF64748B),
        fontSize = 11.sp,
        fontWeight = FontWeight.Bold,
        letterSpacing = 0.08.em,
        modifier = Modifier.padding(start = 4.dp, top = 20.dp, bottom = 8.dp)
    )
}

@Composable
fun ProfileReadRow(icon: String, label: String, value: String) {
    Row(modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically) {
        Text(icon, fontSize = 16.sp, modifier = Modifier.width(28.dp))
        Text(label, color = Color(0xFF64748B), fontSize = 14.sp, modifier = Modifier.weight(1f))
        Text(value, color = Color(0xFF1E293B), fontSize = 14.sp, fontWeight = FontWeight.Medium)
    }
}

@Composable
fun ProfileStatRow(icon: String, label: String, value: Int, suffix: String = "") {
    Row(modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically) {
        Text(icon, fontSize = 16.sp, modifier = Modifier.width(28.dp))
        Text(label, color = Color(0xFF374151), fontSize = 14.sp, modifier = Modifier.weight(1f))
        Text(
            if (suffix.isEmpty()) "$value" else "$value $suffix",
            color = Color(0xFF111827),
            fontSize = 15.sp,
            fontWeight = FontWeight.Bold
        )
    }
}

@Composable
fun ProfileTextRow(icon: String, label: String, value: String) {
    Row(modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically) {
        Text(icon, fontSize = 16.sp, modifier = Modifier.width(28.dp))
        Text(label, color = Color(0xFF64748B), fontSize = 14.sp, modifier = Modifier.weight(1f))
        Text(value, color = Color(0xFF1E293B), fontSize = 14.sp, fontWeight = FontWeight.Medium)
    }
}

@Composable
fun ProfileCopyRow(icon: String, label: String, value: String) {
    val clipboard = LocalClipboardManager.current
    Row(modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically) {
        Text(icon, fontSize = 16.sp, modifier = Modifier.width(28.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(label, color = Color(0xFF64748B), fontSize = 12.sp)
            Text(value, color = Color(0xFF475569), fontSize = 12.sp,
                fontFamily = FontFamily.Monospace)
        }
        IconButton(onClick = {
            clipboard.setText(AnnotatedString(value))
        }) {
            Icon(Icons.Rounded.ContentCopy, contentDescription = "Copy",
                tint = Color(0xFF3B82F6), modifier = Modifier.size(18.dp))
        }
    }
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
    if (epoch == null) return "Unknown"
    val sdf = SimpleDateFormat("MMM yyyy", Locale.getDefault())
    return sdf.format(Date(epoch))
}
