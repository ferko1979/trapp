package com.fairco.trap

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.widget.Toast
import androidx.activity.compose.setContent
import androidx.appcompat.app.AppCompatActivity
import com.fairco.trap.BaseActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
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

class DonationActivity : BaseActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val uid = FirebaseAuth.getInstance().currentUser?.uid ?: ""
        setContent { DonationScreen(uid = uid) }
    }
}

@Composable
private fun DonationScreen(uid: String) {
    val context = LocalContext.current
    val activity = context as? DonationActivity
    val fns = Firebase.functions("europe-west1")
    val scope = rememberCoroutineScope()

    // Suggested amounts in cents (€1, €5, €15, €30)
    val suggestedAmounts = listOf(100, 500, 1500, 3000)
    var selectedAmount by remember { mutableIntStateOf(500) }   // default €5
    var customAmountText by remember { mutableStateOf("") }
    var useCustom by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    var resultState by remember { mutableStateOf<DonationResult?>(null) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF000D1A))
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
                "Support the App",
                color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.ExtraBold,
                letterSpacing = 2.sp, modifier = Modifier.weight(1f)
            )
            IconButton(onClick = { activity?.finish() }) {
                Text("✕", color = Color(0xFF94A3B8), fontSize = 18.sp)
            }
        }

        when (val r = resultState) {
            is DonationResult.Success -> {
                // Thank-you screen
                Column(
                    modifier = Modifier.fillMaxSize().padding(32.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center
                ) {
                    Text("🎉", fontSize = 64.sp)
                    Spacer(Modifier.height(16.dp))
                    Text("Thank You!", color = Color(0xFF4ADE80), fontSize = 28.sp, fontWeight = FontWeight.ExtraBold)
                    Spacer(Modifier.height(10.dp))
                    Text(
                        "Your donation of ${formatPrice(r.amount, "EUR")} has been received. We truly appreciate your support — it keeps the game alive!",
                        color = Color(0xFF94A3B8), fontSize = 15.sp, textAlign = TextAlign.Center, lineHeight = 22.sp
                    )
                    Spacer(Modifier.height(28.dp))
                    Button(
                        onClick = { activity?.finish() },
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1D4ED8)),
                        shape = RoundedCornerShape(12.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) { Text("Close", fontWeight = FontWeight.Bold, color = Color.White) }
                }
            }
            is DonationResult.Failed -> {
                // Failure screen with retry
                Column(
                    modifier = Modifier.fillMaxSize().padding(32.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center
                ) {
                    Text("😞", fontSize = 64.sp)
                    Spacer(Modifier.height(16.dp))
                    Text("Payment Failed", color = Color(0xFFF87171), fontSize = 24.sp, fontWeight = FontWeight.ExtraBold)
                    Spacer(Modifier.height(10.dp))
                    Text(
                        "Your donation could not be processed. Would you like to try again?",
                        color = Color(0xFF94A3B8), fontSize = 15.sp, textAlign = TextAlign.Center
                    )
                    Spacer(Modifier.height(28.dp))
                    Button(
                        onClick = {
                            // Re-open the checkout URL for the failed donation
                            if (r.checkoutUrl.isNotBlank()) {
                                context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(r.checkoutUrl)))
                            }
                            resultState = null
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1D4ED8)),
                        shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth()
                    ) { Text("🔄 Try Again", fontWeight = FontWeight.Bold, color = Color.White) }
                    Spacer(Modifier.height(12.dp))
                    TextButton(onClick = { activity?.finish() }) {
                        Text("Cancel", color = Color(0xFF64748B))
                    }
                }
            }
            null -> {
                // Donation form
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(horizontal = 20.dp),
                    verticalArrangement = Arrangement.spacedBy(18.dp)
                ) {
                    Spacer(Modifier.height(8.dp))

                    // Header
                    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
                        Text("❤️", fontSize = 40.sp)
                        Spacer(Modifier.height(8.dp))
                        Text("Help Keep Trap Running", color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
                        Text(
                            "Every donation helps us improve the game and add new features. Thank you!",
                            color = Color(0xFF64748B), fontSize = 13.sp, textAlign = TextAlign.Center,
                            modifier = Modifier.padding(top = 6.dp)
                        )
                    }

                    // Amount selector
                    Text("Choose Amount", color = Color(0xFF94A3B8), fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        suggestedAmounts.forEach { amount ->
                            val isSelected = !useCustom && selectedAmount == amount
                            Box(
                                modifier = Modifier
                                    .weight(1f)
                                    .clip(RoundedCornerShape(10.dp))
                                    .background(if (isSelected) Color(0xFF1D4ED8) else Color(0xFF0F172A))
                                    .border(1.dp, if (isSelected) Color(0xFF3B82F6) else Color(0xFF1E3A5F), RoundedCornerShape(10.dp))
                                    .clickable { selectedAmount = amount; useCustom = false; customAmountText = "" }
                                    .padding(vertical = 12.dp),
                                contentAlignment = Alignment.Center
                            ) {
                                Text(
                                    formatPrice(amount, "EUR"),
                                    color = if (isSelected) Color.White else Color(0xFF94A3B8),
                                    fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
                                    fontSize = 15.sp
                                )
                            }
                        }
                    }

                    // Custom amount
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Checkbox(
                            checked = useCustom,
                            onCheckedChange = { useCustom = it; if (!it) customAmountText = "" },
                            colors = CheckboxDefaults.colors(checkedColor = Color(0xFF3B82F6))
                        )
                        Text("Other amount (€)", color = Color(0xFF94A3B8), fontSize = 14.sp)
                        if (useCustom) {
                            OutlinedTextField(
                                value = customAmountText,
                                onValueChange = { customAmountText = it.filter { c -> c.isDigit() || c == '.' } },
                                placeholder = { Text("e.g. 7.50", color = Color(0xFF475569)) },
                                colors = OutlinedTextFieldDefaults.colors(
                                    focusedBorderColor = Color(0xFF3B82F6), unfocusedBorderColor = Color(0xFF1E3A5F),
                                    focusedTextColor = Color.White, unfocusedTextColor = Color.White,
                                ),
                                singleLine = true, modifier = Modifier.width(120.dp),
                                shape = RoundedCornerShape(8.dp)
                            )
                        }
                    }

                    // Optional message
                    OutlinedTextField(
                        value = message,
                        onValueChange = { if (it.length <= 200) message = it },
                        label = { Text("Message (optional, max 200 chars)", color = Color(0xFF64748B)) },
                        modifier = Modifier.fillMaxWidth(),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = Color(0xFF3B82F6), unfocusedBorderColor = Color(0xFF1E3A5F),
                            focusedTextColor = Color.White, unfocusedTextColor = Color.White,
                        ),
                        maxLines = 3, shape = RoundedCornerShape(10.dp)
                    )

                    // Donate button
                    val finalAmount = if (useCustom) {
                        (customAmountText.toDoubleOrNull() ?: 0.0).let { (it * 100).toInt() }
                    } else selectedAmount

                    val isValid = finalAmount >= 50 && finalAmount <= 100000

                    Button(
                        onClick = {
                            if (!isValid) {
                                Toast.makeText(context, "Please enter a valid amount (min €0.50, max €1000)", Toast.LENGTH_SHORT).show()
                                return@Button
                            }
                            scope.launch {
                                loading = true
                                try {
                                    val result = fns.getHttpsCallable("createDonation")
                                        .call(mapOf("amount" to finalAmount, "currency" to "EUR", "message" to message))
                                        .await()
                                    @Suppress("UNCHECKED_CAST")
                                    val data = result.getData() as? Map<String, Any?> ?: emptyMap()
                                    val checkoutUrl = data["checkoutUrl"] as? String ?: ""
                                    val donId = data["donationId"] as? String ?: ""

                                    if (checkoutUrl.isNotBlank()) {
                                        // Open Revolut checkout
                                        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(checkoutUrl)))
                                        // After returning from browser, show thank-you
                                        // (In production you'd use a deep link callback; here we optimistically show success)
                                        resultState = DonationResult.Success(finalAmount, donId)
                                    } else {
                                        Toast.makeText(context, "No checkout URL returned.", Toast.LENGTH_SHORT).show()
                                    }
                                } catch (e: Exception) {
                                    val checkoutUrl = ""
                                    resultState = DonationResult.Failed("${e.message}", checkoutUrl)
                                } finally {
                                    loading = false
                                }
                            }
                        },
                        enabled = !loading && isValid,
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1D4ED8)),
                        shape = RoundedCornerShape(12.dp),
                        modifier = Modifier.fillMaxWidth().height(52.dp)
                    ) {
                        if (loading) {
                            CircularProgressIndicator(color = Color.White, modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                            Spacer(Modifier.width(8.dp))
                        }
                        Text(
                            if (loading) "Processing…" else "Donate ${formatPrice(finalAmount, "EUR")}",
                            fontWeight = FontWeight.Bold, fontSize = 16.sp
                        )
                    }

                    Text(
                        "Donations are one-time payments processed via Revolut. No subscription is created. Thank you for your generosity!",
                        color = Color(0xFF334155), fontSize = 11.sp, textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth().padding(bottom = 16.dp)
                    )
                }
            }
        }
    }
}

private sealed class DonationResult {
    data class Success(val amount: Int, val donationId: String) : DonationResult()
    data class Failed(val error: String, val checkoutUrl: String) : DonationResult()
}

private fun formatPrice(amount: Int, currency: String): String {
    return try {
        java.text.NumberFormat.getCurrencyInstance().apply {
            this.currency = java.util.Currency.getInstance(currency)
            maximumFractionDigits = if (amount % 100 == 0) 0 else 2
        }.format(amount / 100.0)
    } catch (e: Exception) {
        "€${amount / 100}"
    }
}

