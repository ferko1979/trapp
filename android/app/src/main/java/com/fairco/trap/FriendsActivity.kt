package com.fairco.trap

import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import com.fairco.trap.ui.theme.TrappTheme
import com.google.firebase.auth.FirebaseAuth

/** Friends list, friend requests and player search (Radar UI, see FriendsCompose.kt). */
class FriendsActivity : BaseActivity() {

    override val radarBars = true
    private val viewModel: FriendsViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            TrappTheme {
                FriendsScreen(
                    vm = viewModel,
                    onBack = { finish() },
                    onInvite = { startActivity(Intent(this, InviteFriendsActivity::class.java)) },
                    onMessage = ::openChat,
                    toast = { Toast.makeText(this, it, Toast.LENGTH_SHORT).show() },
                )
            }
        }
    }

    private fun openChat(friend: Friend) {
        val myUid = FirebaseAuth.getInstance().currentUser?.uid ?: return
        val conversationId = listOf(myUid, friend.uid).sorted().joinToString("__")
        startActivity(
            Intent(this, ChatActivity::class.java)
                .putExtra("conversationId", conversationId)
                .putExtra("otherUsername", friend.username)
                .putExtra("otherUid", friend.uid)
        )
    }
}
