package com.fairco.trap

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Language
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.fairco.trap.ui.RadarHeader
import com.fairco.trap.ui.theme.Radar
import com.fairco.trap.ui.theme.RadarFonts

/*
 * Shared pieces of the Radar-styled auth screens (Login, Register): page frame,
 * dark text fields, secondary button, status/error lines and the language picker.
 */

/** Header + scrollable column used by every auth form. */
@Composable
fun AuthPage(
    title: String,
    onBack: () -> Unit,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(Modifier.fillMaxSize().background(Radar.Bg)) {
        RadarHeader(title = title, onBack = onBack)
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .imePadding()
                .padding(horizontal = 20.dp, vertical = 18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            content = content,
        )
    }
}

@Composable
fun authFieldColors() = OutlinedTextFieldDefaults.colors(
    focusedTextColor = Radar.Text,
    unfocusedTextColor = Radar.Text,
    disabledTextColor = Radar.Text,
    focusedContainerColor = Radar.Surface,
    unfocusedContainerColor = Radar.Surface,
    disabledContainerColor = Radar.Surface,
    focusedBorderColor = Radar.Accent,
    unfocusedBorderColor = Radar.Line,
    disabledBorderColor = Radar.Line,
    focusedLabelColor = Radar.Accent,
    unfocusedLabelColor = Radar.TextSec,
    disabledLabelColor = Radar.TextSec,
    cursorColor = Radar.Accent,
    focusedTrailingIconColor = Radar.TextSec,
    unfocusedTrailingIconColor = Radar.TextMuted,
    disabledTrailingIconColor = Radar.TextMuted,
)

/** Dark outlined text field; [password] adds a show/hide toggle. */
@Composable
fun AuthField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    keyboardType: KeyboardType = KeyboardType.Text,
    password: Boolean = false,
    imeAction: ImeAction = ImeAction.Next,
) {
    var shown by remember { mutableStateOf(false) }
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(label) },
        singleLine = true,
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        colors = authFieldColors(),
        keyboardOptions = KeyboardOptions(keyboardType = keyboardType, imeAction = imeAction),
        visualTransformation = if (password && !shown) PasswordVisualTransformation() else VisualTransformation.None,
        trailingIcon = if (password) {
            {
                IconButton(onClick = { shown = !shown }) {
                    Icon(if (shown) Icons.Filled.VisibilityOff else Icons.Filled.Visibility, null)
                }
            }
        } else null,
    )
}

/** Read-only field that opens a picker on tap (date, gender…). */
@Composable
fun AuthPickerField(value: String, label: String, onClick: () -> Unit) {
    Box(Modifier.fillMaxWidth()) {
        OutlinedTextField(
            value = value,
            onValueChange = {},
            label = { Text(label) },
            readOnly = true,
            enabled = false,
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(14.dp),
            colors = authFieldColors(),
            trailingIcon = { Icon(Icons.Filled.ArrowDropDown, null) },
        )
        Box(
            Modifier.matchParentSize().clip(RoundedCornerShape(14.dp))
                .clickable(remember { MutableInteractionSource() }, null, onClick = onClick)
        )
    }
}

/** Outlined secondary action on the dark background. */
@Composable
fun RadarSecondaryButton(label: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    OutlinedButton(
        onClick = onClick, modifier = modifier.height(48.dp),
        shape = RoundedCornerShape(14.dp),
        border = BorderStroke(1.dp, Radar.Line),
        colors = ButtonDefaults.outlinedButtonColors(containerColor = Radar.Surface, contentColor = Radar.Text),
    ) {
        Text(label.uppercase(), fontFamily = RadarFonts.Label, fontWeight = FontWeight.Bold, fontSize = 15.sp, letterSpacing = 0.8.sp)
    }
}

/** Plain text link-style action (accent coloured). */
@Composable
fun RadarTextAction(label: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    TextButton(onClick = onClick, modifier = modifier) {
        Text(label, color = Radar.Accent, fontSize = 14.sp, fontWeight = FontWeight.ExtraBold, fontFamily = RadarFonts.Body)
    }
}

@Composable
fun AuthStatusLine(text: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        CircularProgressIndicator(color = Radar.Accent, strokeWidth = 2.dp, modifier = Modifier.size(16.dp))
        Spacer(Modifier.width(10.dp))
        Text(text, color = Radar.TextSec, fontSize = 14.sp)
    }
}

@Composable
fun AuthErrorBox(text: String) {
    Text(
        text,
        color = Radar.TrapSoft,
        fontSize = 14.sp,
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(Radar.Trap.copy(alpha = 0.12f))
            .border(1.dp, Radar.Trap.copy(alpha = 0.45f), RoundedCornerShape(12.dp))
            .padding(12.dp),
    )
}

/** Language picker row over [APP_LANGUAGES]; [onPick] fires only for a user choice. */
@Composable
fun AuthLanguagePicker(current: String, onPick: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Column {
        Text(stringResource(R.string.label_select_language), color = Radar.TextMuted, fontSize = 13.sp)
        Spacer(Modifier.height(6.dp))
        Box {
            Row(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(14.dp))
                    .background(Radar.Surface)
                    .border(1.dp, Radar.Line, RoundedCornerShape(14.dp))
                    .clickable { open = true }
                    .padding(horizontal = 14.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Filled.Language, null, tint = Radar.Accent, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(10.dp))
                Text(appLanguageName(current), color = Radar.Text, fontSize = 15.sp, modifier = Modifier.weight(1f))
                Icon(Icons.Filled.ArrowDropDown, null, tint = Radar.TextMuted)
            }
            DropdownMenu(
                expanded = open,
                onDismissRequest = { open = false },
                modifier = Modifier.heightIn(max = 360.dp).background(Radar.Surface2),
            ) {
                APP_LANGUAGES.forEach { (code, name) ->
                    DropdownMenuItem(
                        text = {
                            Text(
                                name,
                                color = if (code == current) Radar.Accent else Radar.Text,
                                fontWeight = if (code == current) FontWeight.ExtraBold else FontWeight.Normal,
                            )
                        },
                        onClick = { open = false; onPick(code) },
                    )
                }
            }
        }
    }
}

/** Dark-styled alert dialog colours shared by the auth screens. */
@Composable
fun RadarDialog(
    title: String,
    onDismiss: () -> Unit,
    confirmLabel: String,
    onConfirm: () -> Unit,
    dismissLabel: String? = null,
    content: @Composable () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Radar.Surface,
        titleContentColor = Radar.Text,
        textContentColor = Radar.TextSec,
        title = { Text(title, fontWeight = FontWeight.ExtraBold, fontFamily = RadarFonts.Body) },
        text = content,
        confirmButton = { TextButton(onClick = onConfirm) { Text(confirmLabel, color = Radar.Accent) } },
        dismissButton = dismissLabel?.let { { TextButton(onClick = onDismiss) { Text(it, color = Radar.TextSec) } } },
    )
}
