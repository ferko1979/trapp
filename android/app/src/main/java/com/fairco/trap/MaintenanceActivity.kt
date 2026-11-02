package com.fairco.trap

import android.content.Intent
import android.os.Bundle
import android.widget.Button
import androidx.appcompat.app.AppCompatActivity
import com.fairco.trap.BaseActivity
import com.google.firebase.auth.FirebaseAuth

class MaintenanceActivity : BaseActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_maintenance)

        findViewById<Button>(R.id.btnRetry).setOnClickListener {
            startActivity(Intent(this, GameActivity::class.java))
            finish()
        }

        findViewById<Button>(R.id.btnLogout).setOnClickListener {
            FirebaseAuth.getInstance().signOut()
            startActivity(Intent(this, LandingActivity::class.java))
            finishAffinity()
        }
    }
}
