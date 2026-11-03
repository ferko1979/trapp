package com.fairco.trap.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.fairco.trap.R
import com.fairco.trap.ui.theme.Radar
import com.fairco.trap.ui.theme.RadarFonts

/*
 * Shared building blocks for full-screen "Radar" pages (Inbox, Friends, Support, …),
 * so every secondary screen has the same header, tabs, search field, cards and states.
 * Host activities set `override val radarBars = true` and wrap content in TrappTheme.
 */

/** Screen header: back arrow, title + optional subtitle, optional trailing actions. */
@Composable
fun RadarHeader(
    title: String,
    subtitle: String? = null,
    onBack: (() -> Unit)? = null,
    actions: @Composable RowScope.() -> Unit = {},
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(Radar.Surface)
            .padding(start = 4.dp, end = 8.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (onBack != null) {
            IconButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.action_back), tint = Radar.Text)
            }
        } else {
            Spacer(Modifier.width(12.dp))
        }
        Column(Modifier.weight(1f).padding(start = 4.dp)) {
            Text(
                title, color = Radar.Text, fontSize = 18.sp, fontWeight = FontWeight.ExtraBold,
                fontFamily = RadarFonts.Body, maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
            if (!subtitle.isNullOrBlank()) {
                Text(subtitle, color = Radar.TextSec, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        actions()
    }
}

/** Pill-style segmented tabs on the header surface; [badges] shows a count per tab when > 0. */
@Composable
fun RadarTabs(
    labels: List<String>,
    selected: Int,
    onSelect: (Int) -> Unit,
    badges: List<Int> = emptyList(),
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(Radar.Surface)
            .padding(horizontal = 14.dp, vertical = 8.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(Radar.Bg)
            .padding(4.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        labels.forEachIndexed { i, label ->
            val on = i == selected
            Row(
                modifier = Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(10.dp))
                    .background(if (on) Radar.Surface2 else Color.Transparent)
                    .clickable { onSelect(i) }
                    .padding(vertical = 10.dp),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    label.uppercase(), color = if (on) Radar.Accent else Radar.TextSec,
                    fontFamily = RadarFonts.Label, fontWeight = FontWeight.Bold, fontSize = 14.sp,
                    letterSpacing = 0.8.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                val n = badges.getOrNull(i) ?: 0
                if (n > 0) {
                    Spacer(Modifier.width(6.dp))
                    RadarCountBadge(n)
                }
            }
        }
    }
}

/** Small red count bubble (99+ capped). */
@Composable
fun RadarCountBadge(count: Int, color: Color = Radar.Trap) {
    Box(
        modifier = Modifier
            .defaultMinSize(minWidth = 18.dp, minHeight = 18.dp)
            .background(color, CircleShape)
            .padding(horizontal = 5.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            if (count > 99) "99+" else count.toString(),
            color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center,
        )
    }
}

/** Rounded dark search field with leading icon and clear button. */
@Composable
fun RadarSearchField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .height(48.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(Radar.Surface)
            .border(1.dp, Radar.Line, RoundedCornerShape(14.dp))
            .padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Filled.Search, null, tint = Radar.TextMuted, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(8.dp))
        Box(Modifier.weight(1f)) {
            if (value.isEmpty()) Text(placeholder, color = Radar.TextMuted, fontSize = 15.sp, maxLines = 1)
            BasicTextField(
                value = value,
                onValueChange = onValueChange,
                singleLine = true,
                textStyle = TextStyle(color = Radar.Text, fontSize = 15.sp, fontFamily = RadarFonts.Body),
                cursorBrush = SolidColor(Radar.Accent),
                modifier = Modifier.fillMaxWidth(),
            )
        }
        if (value.isNotEmpty()) {
            Icon(
                Icons.Filled.Close, stringResource(R.string.action_close), tint = Radar.TextMuted,
                modifier = Modifier.size(20.dp).clip(CircleShape).clickable { onValueChange("") },
            )
        }
    }
}

/** Standard list/content card. [highlight] draws an accent border (e.g. unread). */
@Composable
fun RadarCard(
    modifier: Modifier = Modifier,
    highlight: Boolean = false,
    onClick: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        color = Radar.Surface,
        border = BorderStroke(1.dp, if (highlight) Radar.Accent.copy(alpha = 0.55f) else Radar.Line),
        onClick = onClick ?: {},
        enabled = onClick != null,
    ) {
        Column(Modifier.padding(14.dp), content = content)
    }
}

/** Uppercase section caption above a group of cards. */
@Composable
fun RadarSectionLabel(text: String, modifier: Modifier = Modifier) {
    Text(
        text.uppercase(), modifier = modifier.padding(start = 4.dp, top = 6.dp, bottom = 2.dp),
        color = Radar.TextMuted, fontFamily = RadarFonts.Label, fontWeight = FontWeight.Bold,
        fontSize = 13.sp, letterSpacing = 1.2.sp,
    )
}

/** Centered empty state: big emoji, title, optional hint and action button. */
@Composable
fun RadarEmptyState(
    emoji: String,
    title: String,
    hint: String? = null,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth().padding(horizontal = 32.dp, vertical = 48.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            Modifier.size(84.dp).background(Radar.Surface2, CircleShape).border(1.dp, Radar.Line, CircleShape),
            contentAlignment = Alignment.Center,
        ) { Text(emoji, fontSize = 36.sp) }
        Spacer(Modifier.height(16.dp))
        Text(title, color = Radar.Text, fontSize = 17.sp, fontWeight = FontWeight.ExtraBold, textAlign = TextAlign.Center)
        if (!hint.isNullOrBlank()) {
            Spacer(Modifier.height(6.dp))
            Text(hint, color = Radar.TextSec, fontSize = 14.sp, textAlign = TextAlign.Center, lineHeight = 20.sp)
        }
        if (actionLabel != null && onAction != null) {
            Spacer(Modifier.height(18.dp))
            RadarPrimaryButton(actionLabel, onAction)
        }
    }
}

@Composable
fun RadarPrimaryButton(label: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    Button(
        onClick = onClick, enabled = enabled, modifier = modifier.height(48.dp),
        shape = RoundedCornerShape(14.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = Radar.Accent, contentColor = Radar.OnAccent,
            disabledContainerColor = Radar.Surface2, disabledContentColor = Radar.TextMuted,
        ),
    ) {
        Text(label.uppercase(), fontFamily = RadarFonts.Label, fontWeight = FontWeight.Bold, fontSize = 15.sp, letterSpacing = 0.8.sp)
    }
}

@Composable
fun RadarLoading(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().padding(48.dp), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(color = Radar.Accent, strokeWidth = 3.dp, modifier = Modifier.size(36.dp))
    }
}
