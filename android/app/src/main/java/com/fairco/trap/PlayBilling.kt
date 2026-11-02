package com.fairco.trap

import android.app.Activity
import android.content.Context
import android.os.Build
import com.android.billingclient.api.AcknowledgePurchaseParams
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/**
 * Google Play Billing for Play Store installs. Play policy requires digital
 * goods in a Play-distributed app to be sold through Play Billing, so the
 * Stripe / Revolut checkout is only offered to direct-APK installs.
 *
 * The purchase token is verified, granted and acknowledged server-side by
 * the `verifyPlayPurchase` callable; renewals arrive via Play RTDN.
 */
object PlayBilling {

    /** True when the app was installed by the Play Store. */
    fun isPlayInstall(context: Context): Boolean {
        val pm = context.packageManager
        val installer = try {
            if (Build.VERSION.SDK_INT >= 30) {
                pm.getInstallSourceInfo(context.packageName).installingPackageName
            } else {
                @Suppress("DEPRECATION")
                pm.getInstallerPackageName(context.packageName)
            }
        } catch (_: Exception) {
            null
        }
        return installer == "com.android.vending"
    }

    class BillingException(message: String) : Exception(message)

    class Session(context: Context) : PurchasesUpdatedListener {

        private val client: BillingClient = BillingClient.newBuilder(context.applicationContext)
            .setListener(this)
            .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
            .build()

        private var pending: CompletableDeferred<Pair<BillingResult, List<Purchase>?>>? = null

        override fun onPurchasesUpdated(result: BillingResult, purchases: MutableList<Purchase>?) {
            pending?.complete(result to purchases)
            pending = null
        }

        private suspend fun connect() {
            if (client.isReady) return
            val result = suspendCancellableCoroutine { cont ->
                client.startConnection(object : BillingClientStateListener {
                    override fun onBillingSetupFinished(result: BillingResult) {
                        if (cont.isActive) cont.resume(result)
                    }
                    override fun onBillingServiceDisconnected() { /* reconnect on next call */ }
                })
            }
            if (result.responseCode != BillingClient.BillingResponseCode.OK) {
                throw BillingException("Google Play Billing unavailable (${result.debugMessage}).")
            }
        }

        private suspend fun productDetails(productId: String, subscription: Boolean): ProductDetails? {
            val type = if (subscription) BillingClient.ProductType.SUBS else BillingClient.ProductType.INAPP
            val params = QueryProductDetailsParams.newBuilder()
                .setProductList(listOf(
                    QueryProductDetailsParams.Product.newBuilder()
                        .setProductId(productId)
                        .setProductType(type)
                        .build()
                ))
                .build()
            return suspendCancellableCoroutine { cont ->
                client.queryProductDetailsAsync(params) { _, result ->
                    if (cont.isActive) cont.resume(result.productDetailsList.firstOrNull())
                }
            }
        }

        /** Purchases the user owns (active subscriptions + unconsumed one-time products). */
        suspend fun ownedPurchases(): List<Purchase> {
            connect()
            val all = mutableListOf<Purchase>()
            for (type in listOf(BillingClient.ProductType.SUBS, BillingClient.ProductType.INAPP)) {
                all += suspendCancellableCoroutine<List<Purchase>> { cont ->
                    client.queryPurchasesAsync(
                        QueryPurchasesParams.newBuilder().setProductType(type).build()
                    ) { _, list -> if (cont.isActive) cont.resume(list) }
                }
            }
            return all
        }

        /**
         * Opens the Play purchase sheet. Returns the purchase (it may still be
         * PENDING, e.g. cash payment), or null if the user backed out.
         */
        suspend fun purchase(activity: Activity, productId: String, subscription: Boolean, uid: String): Purchase? {
            connect()
            val details = productDetails(productId, subscription)
                ?: throw BillingException("This package is not available on Google Play yet.")

            val productParams = BillingFlowParams.ProductDetailsParams.newBuilder()
                .setProductDetails(details)
                .apply {
                    if (subscription) {
                        // Play only returns offers the user is eligible for; a
                        // developer offer (e.g. free trial) wins over the base plan.
                        val offers = details.subscriptionOfferDetails.orEmpty()
                        val offer = offers.firstOrNull { it.offerId != null } ?: offers.firstOrNull()
                            ?: throw BillingException("No subscription offer configured on Google Play.")
                        setOfferToken(offer.offerToken)
                    }
                }
                .build()
            val flowParams = BillingFlowParams.newBuilder()
                .setProductDetailsParamsList(listOf(productParams))
                .setObfuscatedAccountId(uid)
                .build()

            val deferred = CompletableDeferred<Pair<BillingResult, List<Purchase>?>>()
            pending = deferred
            val launch = client.launchBillingFlow(activity, flowParams)
            if (launch.responseCode != BillingClient.BillingResponseCode.OK) {
                pending = null
                if (launch.responseCode == BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED) {
                    return ownedPurchases().firstOrNull { productId in it.products }
                }
                throw BillingException("Could not open Google Play (${launch.debugMessage}).")
            }

            val (result, purchases) = deferred.await()
            return when (result.responseCode) {
                BillingClient.BillingResponseCode.OK ->
                    purchases?.firstOrNull { productId in it.products }
                BillingClient.BillingResponseCode.USER_CANCELED -> null
                BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED ->
                    ownedPurchases().firstOrNull { productId in it.products }
                else -> throw BillingException("Google Play purchase failed (${result.debugMessage}).")
            }
        }

        /** Fallback acknowledge in case the server-side acknowledge was skipped. */
        suspend fun acknowledge(purchase: Purchase) {
            if (purchase.isAcknowledged) return
            connect()
            suspendCancellableCoroutine { cont ->
                client.acknowledgePurchase(
                    AcknowledgePurchaseParams.newBuilder().setPurchaseToken(purchase.purchaseToken).build()
                ) { if (cont.isActive) cont.resume(Unit) }
            }
        }

        fun end() {
            pending?.cancel()
            pending = null
            client.endConnection()
        }
    }
}
