package com.fairco.trap

import android.content.Intent
import com.fairco.trap.ui.theme.TrappTheme
import com.fairco.trap.ui.theme.Radar
import android.net.Uri
import android.os.Bundle
import androidx.browser.customtabs.CustomTabsIntent
import android.widget.Toast
import androidx.activity.compose.setContent
import androidx.appcompat.app.AppCompatActivity
import com.fairco.trap.BaseActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.firebase.Firebase
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.functions.functions
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import java.text.SimpleDateFormat
import java.util.*

data class PaymentPackage(
    val id: String,
    val name: String,
    val description: String,
    val duration: String,
    val durationDays: Int,
    val price: Int,           // minor units
    val currency: String,
    val trialDays: Int,
    val isRecurring: Boolean,
    // Level benefit details — populated from user_levels via backend join
    val levelId: String = "",
    val levelName: String = "",
    val levelBagKg: Float = 0f,
    val levelDailyTraps: Int = 0,
    val levelRadiusMeters: Int = 0,
    val levelSpeedPercent: Int = 0,
    val levelDisableBanner: Boolean = false,
    val levelDisableInterstitial: Boolean = false,
    val levelDisableRewarded: Boolean = false,
)

data class SubscriptionInfo(
    val id: String,
    val packageName: String?,
    val status: String,
    val trialEnd: Long?,
    val currentPeriodEnd: Long?,
    val cancelAtPeriodEnd: Boolean,
    val amount: Int,
    val currency: String,
)

class SubscriptionActivity : BaseActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val uid = FirebaseAuth.getInstance().currentUser?.uid ?: ""

        setContent { TrappTheme {
            SubscriptionScreen(uid = uid)
        } }
    }
}

enum class PaymentGateway { REVOLUT, STRIPE }

@Composable
private fun SubscriptionScreen(uid: String) {
    val context = LocalContext.current
    val activity = context as? SubscriptionActivity
    val fns = Firebase.functions("europe-west1")
    val scope = rememberCoroutineScope()

    var packages by remember { mutableStateOf<List<PaymentPackage>>(emptyList()) }
    var subscription by remember { mutableStateOf<SubscriptionInfo?>(null) }
    var loading by remember { mutableStateOf(true) }
    var discountCode by remember { mutableStateOf("") }
    var checkoutLoading by remember { mutableStateOf(false) }
    var cancelLoading by remember { mutableStateOf(false) }
    var recurringConsentPkg by remember { mutableStateOf<PaymentPackage?>(null) }

    // Payment gateway availability
    var revolutEnabled by remember { mutableStateOf(true) }
    var stripeEnabled by remember { mutableStateOf(false) }
    // If both gateways are enabled, show a picker before checkout
    var gatewayPickerPkg by remember { mutableStateOf<PaymentPackage?>(null) }

    // Load packages, subscription, and payment settings in parallel
    LaunchedEffect(uid) {
        loading = true
        try {
            val pkgResult = fns.getHttpsCallable("getAvailablePackages").call().await()
            @Suppress("UNCHECKED_CAST")
            val pkgData = pkgResult.getData() as? Map<String, Any?> ?: emptyMap()
            @Suppress("UNCHECKED_CAST")
            val pkgList = pkgData["packages"] as? List<Map<String, Any?>> ?: emptyList()
            packages = pkgList.map { m ->
                PaymentPackage(
                    id                    = m["id"] as? String ?: "",
                    name                  = m["name"] as? String ?: "",
                    description           = m["description"] as? String ?: "",
                    duration              = m["duration"] as? String ?: "1m",
                    durationDays          = (m["durationDays"] as? Number)?.toInt() ?: 30,
                    price                 = (m["price"] as? Number)?.toInt() ?: 0,
                    currency              = m["currency"] as? String ?: "EUR",
                    trialDays             = (m["trialDays"] as? Number)?.toInt() ?: 0,
                    isRecurring           = m["isRecurring"] as? Boolean ?: false,
                    levelId               = m["levelId"] as? String ?: "",
                    levelName             = m["levelName"] as? String ?: "",
                    levelBagKg            = (m["levelBagKg"] as? Number)?.toFloat() ?: 0f,
                    levelDailyTraps       = (m["levelDailyTraps"] as? Number)?.toInt() ?: 0,
                    levelRadiusMeters     = (m["levelRadiusMeters"] as? Number)?.toInt() ?: 0,
                    levelSpeedPercent     = (m["levelSpeedPercent"] as? Number)?.toInt() ?: 0,
                    levelDisableBanner    = m["levelDisableBanner"] as? Boolean ?: false,
                    levelDisableInterstitial = m["levelDisableInterstitial"] as? Boolean ?: false,
                    levelDisableRewarded  = m["levelDisableRewarded"] as? Boolean ?: false,
                )
            }

            val subResult = fns.getHttpsCallable("getMySubscription").call().await()
            @Suppress("UNCHECKED_CAST")
            val subData = (subResult.getData() as? Map<String, Any?>)?.get("subscription") as? Map<String, Any?>
            subscription = subData?.let { s ->
                SubscriptionInfo(
                    id               = s["id"] as? String ?: "",
                    packageName      = s["packageName"] as? String,
                    status           = s["status"] as? String ?: "expired",
                    trialEnd         = (s["trialEnd"] as? Number)?.toLong(),
                    currentPeriodEnd = (s["currentPeriodEnd"] as? Number)?.toLong(),
                    cancelAtPeriodEnd= s["cancelAtPeriodEnd"] as? Boolean ?: false,
                    amount           = (s["amount"] as? Number)?.toInt() ?: 0,
                    currency         = s["currency"] as? String ?: "EUR",
                )
            }

            // Fetch payment gateway availability
            try {
                val settingsResult = fns.getHttpsCallable("getPublicGameSettings").call().await()
                @Suppress("UNCHECKED_CAST")
                val settingsData = (settingsResult.getData() as? Map<String, Any?>)
                    ?.get("settings") as? Map<String, Any?>
                revolutEnabled = settingsData?.get("revolutPaymentEnabled") as? Boolean ?: true
                stripeEnabled  = settingsData?.get("stripePaymentEnabled")  as? Boolean ?: false
            } catch (_: Exception) { /* use defaults */ }
        } catch (e: Exception) {
            Toast.makeText(context, "Failed to load: ${e.message}", Toast.LENGTH_SHORT).show()
        } finally {
            loading = false
        }
    }

    // Helper: perform checkout via a specific gateway
    suspend fun doCheckout(pkg: PaymentPackage, gateway: PaymentGateway) {
        checkoutLoading = true
        try {
            val params = buildMap<String, Any> {
                put("packageId", pkg.id)
                if (discountCode.isNotBlank()) put("discountCode", discountCode)
            }
            when (gateway) {
                PaymentGateway.REVOLUT -> {
                    val result = fns.getHttpsCallable("createRevolutCheckout").call(params).await()
                    @Suppress("UNCHECKED_CAST")
                    val data = result.getData() as? Map<String, Any?> ?: emptyMap()
                    val isTrial = data["isTrial"] as? Boolean ?: false
                    val checkoutUrl = data["checkoutUrl"] as? String
                    if (isTrial) {
                        val trialDays = (data["trialDays"] as? Number)?.toInt() ?: 0
                        Toast.makeText(context, "🎉 Your $trialDays-day free trial has started!", Toast.LENGTH_LONG).show()
                        activity?.finish()
                    } else if (!checkoutUrl.isNullOrBlank()) {
                        // Open in Chrome Custom Tabs so Google Pay is available on the checkout page
                        val tabsIntent = CustomTabsIntent.Builder().build()
                        tabsIntent.intent.setPackage("com.android.chrome")
                        try {
                            tabsIntent.launchUrl(context, Uri.parse(checkoutUrl))
                        } catch (_: Exception) {
                            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(checkoutUrl)))
                        }
                    } else {
                        Toast.makeText(context, "No checkout URL returned.", Toast.LENGTH_SHORT).show()
                    }
                }
                PaymentGateway.STRIPE -> {
                    val result = fns.getHttpsCallable("createCheckoutSession").call(params).await()
                    @Suppress("UNCHECKED_CAST")
                    val data = result.getData() as? Map<String, Any?> ?: emptyMap()
                    val url = data["url"] as? String
                    if (!url.isNullOrBlank()) {
                        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                    } else {
                        Toast.makeText(context, "No Stripe checkout URL returned.", Toast.LENGTH_SHORT).show()
                    }
                }
            }
        } catch (e: Exception) {
            Toast.makeText(context, "Error: ${e.message}", Toast.LENGTH_LONG).show()
        } finally {
            checkoutLoading = false
        }
    }

    // Helper: trigger checkout — picks gateway or shows picker
    fun startCheckout(pkg: PaymentPackage) {
        val bothEnabled = revolutEnabled && stripeEnabled
        if (bothEnabled) {
            gatewayPickerPkg = pkg
            return
        }
        scope.launch {
            val gateway = if (stripeEnabled) PaymentGateway.STRIPE else PaymentGateway.REVOLUT
            doCheckout(pkg, gateway)
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Radar.Bg)
    ) {
        // Top bar
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .statusBarsPadding()
                .padding(horizontal = 16.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                "Premium",
                color = Color.White,
                fontSize = 20.sp,
                fontWeight = FontWeight.ExtraBold,
                letterSpacing = 2.sp,
                modifier = Modifier.weight(1f)
            )
            IconButton(onClick = { activity?.finish() }) {
                Text("✕", color = Radar.TextSec, fontSize = 18.sp)
            }
        }

        if (loading) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = Radar.Accent)
            }
            return@Column
        }

        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            // ── Active subscription banner ──────────────────────────────────
            subscription?.let { sub ->
                val isActive = sub.status in listOf("active", "trialing")
                if (isActive || (sub.status == "cancelled" && (sub.currentPeriodEnd ?: 0L) > System.currentTimeMillis())) {
                    item {
                        ActiveSubscriptionCard(
                            sub = sub,
                            cancelLoading = cancelLoading,
                            onCancel = {
                                scope.launch {
                                    cancelLoading = true
                                    try {
                                        fns.getHttpsCallable("cancelMySubscription")
                                            .call(mapOf("subscriptionId" to sub.id))
                                            .await()
                                        Toast.makeText(context, "Subscription cancelled. Access continues until period end.", Toast.LENGTH_LONG).show()
                                        activity?.finish()
                                    } catch (e: Exception) {
                                        Toast.makeText(context, "Cancel failed: ${e.message}", Toast.LENGTH_LONG).show()
                                    } finally {
                                        cancelLoading = false
                                    }
                                }
                            }
                        )
                    }
                    return@LazyColumn
                }
            }

            // ── Header ─────────────────────────────────────────────────────
            item {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text("💎", fontSize = 44.sp)
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "Choose Your Level",
                        color = Color.White,
                        fontSize = 24.sp,
                        fontWeight = FontWeight.ExtraBold,
                        textAlign = TextAlign.Center
                    )
                    Text(
                        "Bigger bag · Faster actions · No ads",
                        color = Radar.TextMuted,
                        fontSize = 13.sp,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.padding(top = 6.dp)
                    )
                }
            }

            // ── Free tier reference card ────────────────────────────────────
            item {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(Radar.Bg)
                        .border(1.dp, Radar.Surface, RoundedCornerShape(12.dp))
                        .padding(14.dp)
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column {
                            Text("FREE", color = Radar.TextMuted, fontWeight = FontWeight.ExtraBold, fontSize = 16.sp, letterSpacing = 1.sp)
                            Text("Your current plan", color = Radar.Line, fontSize = 12.sp, modifier = Modifier.padding(top = 2.dp))
                        }
                        Text("€0", color = Radar.TextMuted, fontWeight = FontWeight.Bold, fontSize = 18.sp)
                    }
                    Spacer(Modifier.height(10.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        BenefitChip("Bag", "4 kg", Radar.TextMuted, Modifier.weight(1f))
                        BenefitChip("Traps/day", "2", Radar.TextMuted, Modifier.weight(1f))
                        BenefitChip("Radius", "200 m", Radar.TextMuted, Modifier.weight(1f))
                        BenefitChip("Speed", "+0%", Radar.TextMuted, Modifier.weight(1f))
                    }
                    Spacer(Modifier.height(6.dp))
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(8.dp))
                            .background(Color(0xFF1C0A0A).copy(alpha = 0.6f))
                            .padding(horizontal = 10.dp, vertical = 6.dp),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("Ads:", color = Radar.TextMuted, fontSize = 11.sp)
                        Text("Banner · Interstitial · Rewarded", color = Radar.TrapSoft, fontSize = 10.sp, fontWeight = FontWeight.SemiBold,
                            modifier = Modifier.background(Color(0xFF1C0A0A), RoundedCornerShape(999.dp)).padding(horizontal = 7.dp, vertical = 3.dp))
                    }
                }
            }

            // ── Discount code field ─────────────────────────────────────────
            item {
                OutlinedTextField(
                    value = discountCode,
                    onValueChange = { discountCode = it.uppercase() },
                    label = { Text("Discount code (optional)", color = Radar.TextMuted) },
                    modifier = Modifier.fillMaxWidth(),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = Radar.Accent,
                        unfocusedBorderColor = Radar.Line,
                        focusedTextColor = Color.White,
                        unfocusedTextColor = Color.White,
                    ),
                    singleLine = true,
                    shape = RoundedCornerShape(10.dp)
                )
            }

            // ── Payment unavailable notice ─────────────────────────────────
            if (!loading && !revolutEnabled && !stripeEnabled) {
                item {
                    androidx.compose.foundation.layout.Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .background(Radar.Surface)
                            .padding(20.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text("🔧", fontSize = 28.sp)
                            Text("Payment Temporarily Unavailable", color = Radar.Text, fontWeight = FontWeight.Bold, fontSize = 15.sp, textAlign = TextAlign.Center)
                            Text("Please check back shortly.", color = Radar.TextMuted, fontSize = 13.sp, textAlign = TextAlign.Center)
                        }
                    }
                }
                return@LazyColumn
            }

            // ── Packages ───────────────────────────────────────────────────
            if (packages.isEmpty()) {
                item {
                    Text(
                        "No premium packages available yet.",
                        color = Radar.TextMuted,
                        fontSize = 14.sp,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth().padding(32.dp)
                    )
                }
            } else {
                items(packages) { pkg ->
                    PackageCard(
                        pkg = pkg,
                        loading = checkoutLoading,
                        revolutEnabled = revolutEnabled,
                        stripeEnabled = stripeEnabled,
                        onSelect = {
                            if (pkg.isRecurring) {
                                recurringConsentPkg = pkg
                                return@PackageCard
                            }
                            startCheckout(pkg)
                        }
                    )
                }
            }

            item {
                Text(
                    "Cancel at any time. No charge if cancelled before the billing date. Prices shown in package currency.",
                    color = Radar.Line,
                    fontSize = 11.sp,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp)
                )
            }
        }

        // ── Recurring consent dialog ────────────────────────────────────────
        recurringConsentPkg?.let { pkg ->
            AlertDialog(
                onDismissRequest = { recurringConsentPkg = null },
                containerColor = Radar.Bg,
                title = {
                    Text("🔄 Recurring Subscription", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 18.sp)
                },
                text = {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text(
                            "${pkg.name} is a recurring subscription that automatically renews every ${formatDuration(pkg.duration).removePrefix("per ")}.",
                            color = Radar.Text, fontSize = 14.sp, lineHeight = 20.sp
                        )
                        Text(
                            "You will be charged ${formatPrice(pkg.price, pkg.currency)} at the start of each period.",
                            color = Radar.TextSec, fontSize = 13.sp
                        )
                        Text(
                            "✅ You can cancel at any time from the app (Profile → Subscription → Cancel). Cancellation takes effect at the end of the current period — you keep access until then.",
                            color = Radar.Safe, fontSize = 13.sp, lineHeight = 19.sp
                        )
                        if (pkg.trialDays > 0) {
                            Text(
                                "🔬 Your first ${pkg.trialDays} days are FREE. No charge if you cancel before the trial ends.",
                                color = Radar.Accent, fontSize = 13.sp
                            )
                        }
                    }
                },
                confirmButton = {
                    Button(
                        onClick = {
                            val confirmedPkg = pkg
                            recurringConsentPkg = null
                            startCheckout(confirmedPkg)
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = Radar.AccentDeep)
                    ) {
                        Text("I Understand — Continue", color = Color.White, fontWeight = FontWeight.Bold)
                    }
                },
                dismissButton = {
                    TextButton(onClick = { recurringConsentPkg = null }) {
                        Text("Cancel", color = Radar.TextMuted)
                    }
                }
            )
        }

        // ── Payment gateway picker ─────────────────────────────────────────────
        gatewayPickerPkg?.let { pkg ->
            AlertDialog(
                onDismissRequest = { gatewayPickerPkg = null },
                containerColor = Radar.Bg,
                title = {
                    Text("Choose Payment Method", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 18.sp)
                },
                text = {
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        if (revolutEnabled) {
                            Button(
                                onClick = {
                                    val p = pkg
                                    gatewayPickerPkg = null
                                    scope.launch { doCheckout(p, PaymentGateway.REVOLUT) }
                                },
                                colors = ButtonDefaults.buttonColors(containerColor = Radar.AccentDeep),
                                modifier = Modifier.fillMaxWidth(),
                                shape = RoundedCornerShape(10.dp)
                            ) {
                                Text("🏦  Pay with Revolut", color = Color.White, fontWeight = FontWeight.Bold)
                            }
                        }
                        if (stripeEnabled) {
                            Button(
                                onClick = {
                                    val p = pkg
                                    gatewayPickerPkg = null
                                    scope.launch { doCheckout(p, PaymentGateway.STRIPE) }
                                },
                                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF7C3AED)),
                                modifier = Modifier.fillMaxWidth(),
                                shape = RoundedCornerShape(10.dp)
                            ) {
                                Text("💳  Pay with Card (Stripe)", color = Color.White, fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                },
                confirmButton = {},
                dismissButton = {
                    TextButton(onClick = { gatewayPickerPkg = null }) {
                        Text("Cancel", color = Radar.TextMuted)
                    }
                }
            )
        }
    }
}

@Composable
private fun ActiveSubscriptionCard(
    sub: SubscriptionInfo,
    cancelLoading: Boolean,
    onCancel: () -> Unit
) {
    val statusLabel = when (sub.status) {
        "trialing" -> "🔬 Free Trial"
        "active"   -> "✅ Active"
        "cancelled" -> "⏸ Cancelled"
        else       -> sub.status
    }
    val statusColor = when (sub.status) {
        "trialing" -> Radar.Accent
        "active"   -> Radar.Safe
        else       -> Radar.TextSec
    }
    val fmt = SimpleDateFormat("dd MMM yyyy", Locale.getDefault())

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(Radar.Bg)
            .border(1.dp, Radar.Line, RoundedCornerShape(16.dp))
            .padding(20.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("🏆", fontSize = 28.sp)
            Spacer(Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(sub.packageName ?: "Premium", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 18.sp)
                Text(statusLabel, color = statusColor, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            }
        }
        Spacer(Modifier.height(16.dp))

        if (sub.status == "trialing" && sub.trialEnd != null) {
            InfoRow("Trial ends", fmt.format(Date(sub.trialEnd)))
        }
        sub.currentPeriodEnd?.let {
            InfoRow(if (sub.cancelAtPeriodEnd) "Access until" else "Renews", fmt.format(Date(it)))
        }

        Spacer(Modifier.height(16.dp))

        if (sub.status in listOf("active", "trialing") && !sub.cancelAtPeriodEnd) {
            Button(
                onClick = onCancel,
                enabled = !cancelLoading,
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF7F1D1D)),
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(10.dp)
            ) {
                Text(if (cancelLoading) "Cancelling…" else "Cancel Subscription", color = Radar.TrapSoft)
            }
            Spacer(Modifier.height(6.dp))
            Text(
                "Your access continues until the end of the current period.",
                color = Radar.TextMuted,
                fontSize = 11.sp,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth()
            )
        } else if (sub.cancelAtPeriodEnd) {
            Text(
                "Subscription cancelled — access continues until ${sub.currentPeriodEnd?.let { fmt.format(Date(it)) } ?: "period end"}.",
                color = Radar.TextSec,
                fontSize = 13.sp,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth()
            )
        }
    }
}

private fun tierAccentColor(levelId: String): Color = when (levelId) {
    "silver"  -> Radar.TextSec
    "gold"    -> Radar.Gold
    "pro"     -> Radar.Accent
    "elite"   -> Color(0xFF8B5CF6)
    "diamond" -> Radar.Accent
    else      -> Radar.TextMuted
}

private fun tierBgColor(levelId: String): Color = when (levelId) {
    "silver"  -> Radar.Surface
    "gold"    -> Color(0xFF1C1600)
    "pro"     -> Radar.Surface
    "elite"   -> Color(0xFF150C29)
    "diamond" -> Color(0xFF001A20)
    else      -> Radar.Bg
}

@Composable
private fun PackageCard(
    pkg: PaymentPackage,
    loading: Boolean,
    revolutEnabled: Boolean = true,
    stripeEnabled: Boolean = false,
    onSelect: () -> Unit,
) {
    val priceDisplay = formatPrice(pkg.price, pkg.currency)
    val durationLabel = formatDuration(pkg.duration)
    val accent = tierAccentColor(pkg.levelId)
    val bg = tierBgColor(pkg.levelId)
    val isPopular = pkg.levelId == "gold"
    val hasBenefits = pkg.levelBagKg > 0f || pkg.levelDailyTraps > 0

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(bg)
            .border(
                width = if (isPopular) 2.dp else 1.dp,
                color = if (isPopular) accent else accent.copy(alpha = 0.35f),
                shape = RoundedCornerShape(16.dp)
            )
            .clickable(enabled = !loading) { onSelect() }
            .padding(18.dp)
    ) {
        // ── "Most popular" badge ────────────────────────────────────────────
        if (isPopular) {
            Text(
                "★  Most popular",
                color = accent,
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier
                    .background(accent.copy(alpha = 0.15f), RoundedCornerShape(999.dp))
                    .padding(horizontal = 10.dp, vertical = 3.dp)
            )
            Spacer(Modifier.height(10.dp))
        }

        // ── Tier name + price row ───────────────────────────────────────────
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(modifier = Modifier.weight(1f)) {
                val displayName = pkg.levelName.takeIf { it.isNotBlank() } ?: pkg.name
                Text(displayName, color = accent, fontWeight = FontWeight.ExtraBold, fontSize = 20.sp, letterSpacing = 1.sp)
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    modifier = Modifier.padding(top = 4.dp)
                ) {
                    if (pkg.trialDays > 0) {
                        Text(
                            "${pkg.trialDays}d free trial",
                            color = Radar.Accent,
                            fontSize = 11.sp,
                            fontWeight = FontWeight.SemiBold,
                            modifier = Modifier
                                .background(Radar.Line, RoundedCornerShape(999.dp))
                                .padding(horizontal = 8.dp, vertical = 2.dp)
                        )
                    }
                    if (pkg.isRecurring) {
                        Text(
                            "Auto-renews",
                            color = Radar.TextMuted,
                            fontSize = 11.sp,
                            modifier = Modifier
                                .background(Radar.Surface, RoundedCornerShape(999.dp))
                                .padding(horizontal = 8.dp, vertical = 2.dp)
                        )
                    }
                }
            }
            Column(horizontalAlignment = Alignment.End) {
                Text(priceDisplay, color = Color.White, fontWeight = FontWeight.ExtraBold, fontSize = 20.sp)
                Text(durationLabel, color = Radar.TextMuted, fontSize = 12.sp)
            }
        }

        // ── Benefits grid ───────────────────────────────────────────────────
        if (hasBenefits) {
            Spacer(Modifier.height(14.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                BenefitChip(label = "Bag", value = "${pkg.levelBagKg.toInt()} kg", accent = accent, modifier = Modifier.weight(1f))
                BenefitChip(label = "Traps/day", value = "${pkg.levelDailyTraps}", accent = accent, modifier = Modifier.weight(1f))
                BenefitChip(label = "Radius", value = formatRadius(pkg.levelRadiusMeters), accent = accent, modifier = Modifier.weight(1f))
                BenefitChip(label = "Speed", value = "+${pkg.levelSpeedPercent}%", accent = accent, modifier = Modifier.weight(1f))
            }

            Spacer(Modifier.height(8.dp))
            AdStatusRow(
                disableBanner = pkg.levelDisableBanner,
                disableInterstitial = pkg.levelDisableInterstitial,
                disableRewarded = pkg.levelDisableRewarded,
            )
        }

        Spacer(Modifier.height(14.dp))

        // ── CTA button ──────────────────────────────────────────────────────
        Button(
            onClick = onSelect,
            enabled = !loading,
            colors = ButtonDefaults.buttonColors(containerColor = accent),
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(10.dp)
        ) {
            if (loading) {
                CircularProgressIndicator(color = Radar.contentOn(accent), modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                Spacer(Modifier.width(8.dp))
            }
            val gatewayLabel = when {
                revolutEnabled && stripeEnabled -> " · Revolut or Card"
                stripeEnabled -> " · Pay by Card"
                else -> ""
            }
            val label = if (pkg.trialDays > 0)
                "Start ${pkg.trialDays}-Day Free Trial"
            else {
                val n = pkg.levelName.takeIf { it.isNotBlank() } ?: pkg.name
                "Get $n$gatewayLabel"
            }
            Text(label, fontWeight = FontWeight.Bold, color = Radar.contentOn(accent))
        }
    }
}

@Composable
private fun BenefitChip(label: String, value: String, accent: Color, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(8.dp))
            .background(accent.copy(alpha = 0.08f))
            .padding(horizontal = 6.dp, vertical = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(value, color = accent, fontWeight = FontWeight.Bold, fontSize = 13.sp)
        Text(label, color = Radar.TextMuted, fontSize = 10.sp)
    }
}

@Composable
private fun AdStatusRow(
    disableBanner: Boolean,
    disableInterstitial: Boolean,
    disableRewarded: Boolean,
) {
    val allOff = disableBanner && disableInterstitial
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(
                if (allOff) Color(0xFF052E16).copy(alpha = 0.8f) else Color(0xFF1A1000).copy(alpha = 0.8f)
            )
            .padding(horizontal = 10.dp, vertical = 7.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text("Ads:", color = Radar.TextMuted, fontSize = 11.sp)
        AdChip("Banner", !disableBanner)
        AdChip("Interstitial", !disableInterstitial)
        AdChip("Rewarded", !disableRewarded, optional = disableInterstitial)
    }
}

@Composable
private fun AdChip(label: String, shown: Boolean, optional: Boolean = false) {
    val (bg, fg, prefix) = when {
        !shown && optional -> Triple(Color(0xFF0A1A0A), Radar.Safe, "opt")
        shown              -> Triple(Color(0xFF1C0A0A), Radar.TrapSoft, "✕")
        else               -> Triple(Color(0xFF0A1A0A), Radar.Safe, "✓ off")
    }
    Text(
        "$prefix $label",
        color = fg,
        fontSize = 10.sp,
        fontWeight = FontWeight.SemiBold,
        modifier = Modifier
            .background(bg, RoundedCornerShape(999.dp))
            .padding(horizontal = 7.dp, vertical = 3.dp)
    )
}

private fun formatRadius(meters: Int): String {
    if (meters >= 1000) {
        val km = meters / 1000
        val tenth = (meters % 1000) / 100
        return if (tenth == 0) "$km km" else "$km.$tenth km"
    }
    return "$meters m"
}

@Composable
private fun InfoRow(label: String, value: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(label, color = Radar.TextMuted, fontSize = 13.sp)
        Text(value, color = Radar.Text, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
    }
}

private fun formatPrice(amount: Int, currency: String): String {
    return try {
        java.text.NumberFormat.getCurrencyInstance().apply {
            this.currency = Currency.getInstance(currency)
            maximumFractionDigits = 2
        }.format(amount / 100.0)
    } catch (e: Exception) {
        "${amount / 100}.${amount % 100} $currency"
    }
}

private fun formatDuration(d: String): String = when (d) {
    "1d"  -> "per day"
    "7d"  -> "per week"
    "30d" -> "per month"
    "1m"  -> "per month"
    "3m"  -> "per 3 months"
    "6m"  -> "per 6 months"
    "1y"  -> "per year"
    else  -> d
}

