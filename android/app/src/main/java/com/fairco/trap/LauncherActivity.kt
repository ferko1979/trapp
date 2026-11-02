package com.fairco.trap

import android.content.Intent
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import com.fairco.trap.BaseActivity
import com.google.firebase.auth.FirebaseAuth

class LauncherActivity : BaseActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val next = if (FirebaseAuth.getInstance().currentUser != null) {
            Intent(this, GameActivity::class.java)
        } else {
            Intent(this, LandingActivity::class.java)
        }
        startActivity(next)
        finish()
    }
}

