package com.fairco.trap

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import androidx.viewpager2.widget.ViewPager2
import com.fairco.trap.databinding.ActivityIntroBinding
import com.google.firebase.auth.FirebaseAuth

// ─── Slide data (resource IDs, resolved at runtime for correct locale) ────────

internal data class SlideRes(
    val iconRes: Int,
    val titleRes: Int,
    val descRes: Int,
    val tipIconRes: Int,
    val tipRes: Int,
)

private val SLIDE_RES = listOf(
    SlideRes(R.string.intro_s1_icon, R.string.intro_s1_title, R.string.intro_s1_desc, R.string.intro_s1_tip_icon, R.string.intro_s1_tip),
    SlideRes(R.string.intro_s2_icon, R.string.intro_s2_title, R.string.intro_s2_desc, R.string.intro_s2_tip_icon, R.string.intro_s2_tip),
    SlideRes(R.string.intro_s3_icon, R.string.intro_s3_title, R.string.intro_s3_desc, R.string.intro_s3_tip_icon, R.string.intro_s3_tip),
    SlideRes(R.string.intro_s4_icon, R.string.intro_s4_title, R.string.intro_s4_desc, R.string.intro_s4_tip_icon, R.string.intro_s4_tip),
    SlideRes(R.string.intro_s5_icon, R.string.intro_s5_title, R.string.intro_s5_desc, R.string.intro_s5_tip_icon, R.string.intro_s5_tip),
    SlideRes(R.string.intro_s6_icon, R.string.intro_s6_title, R.string.intro_s6_desc, R.string.intro_s6_tip_icon, R.string.intro_s6_tip),
)

// ─── Adapter ─────────────────────────────────────────────────────────────────

internal class IntroSlideAdapter(private val slides: List<SlideRes>) :
    RecyclerView.Adapter<IntroSlideAdapter.SlideViewHolder>() {

    inner class SlideViewHolder(view: View) : RecyclerView.ViewHolder(view) {
        val icon: TextView    = view.findViewById(R.id.tvSlideIcon)
        val title: TextView   = view.findViewById(R.id.tvSlideTitle)
        val desc: TextView    = view.findViewById(R.id.tvSlideDesc)
        val tipBox: View      = view.findViewById(R.id.tipBox)
        val tipIcon: TextView = view.findViewById(R.id.tvTipIcon)
        val tipText: TextView = view.findViewById(R.id.tvTipText)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): SlideViewHolder {
        val view = LayoutInflater.from(parent.context)
            .inflate(R.layout.item_intro_slide, parent, false)
        return SlideViewHolder(view)
    }

    override fun onBindViewHolder(holder: SlideViewHolder, position: Int) {
        val res   = slides[position]
        val ctx   = holder.itemView.context
        holder.icon.text  = ctx.getString(res.iconRes)
        holder.title.text = ctx.getString(res.titleRes)
        holder.desc.text  = ctx.getString(res.descRes)
        holder.tipIcon.text = ctx.getString(res.tipIconRes)
        holder.tipText.text = ctx.getString(res.tipRes)
        holder.tipBox.visibility = View.VISIBLE
    }

    override fun getItemCount() = slides.size
}

// ─── Activity ─────────────────────────────────────────────────────────────────

class IntroActivity : BaseActivity() {

    private lateinit var b: ActivityIntroBinding
    private val dots = mutableListOf<View>()

    companion object {
        private const val PREFS     = "Settings"
        private const val KEY_SHOWN = "intro_shown_v1"

        fun shouldShow(context: Context): Boolean =
            !context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getBoolean(KEY_SHOWN, false)

        fun markShown(context: Context) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit().putBoolean(KEY_SHOWN, true).apply()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        b = ActivityIntroBinding.inflate(layoutInflater)
        setContentView(b.root)

        setupViewPager()
        setupDots()
        updateState(0)

        b.btnNext.setOnClickListener {
            val current = b.viewPager.currentItem
            if (current < SLIDE_RES.lastIndex) {
                b.viewPager.setCurrentItem(current + 1, true)
            } else {
                finishIntro()
            }
        }

        b.tvSkip.setOnClickListener { finishIntro() }
    }

    private fun setupViewPager() {
        b.viewPager.adapter = IntroSlideAdapter(SLIDE_RES)
        b.viewPager.registerOnPageChangeCallback(object : ViewPager2.OnPageChangeCallback() {
            override fun onPageSelected(position: Int) = updateState(position)
        })
    }

    private fun setupDots() {
        b.dotsContainer.removeAllViews()
        dots.clear()
        val dp6  = (6  * resources.displayMetrics.density).toInt()
        val dp10 = (10 * resources.displayMetrics.density).toInt()
        repeat(SLIDE_RES.size) {
            val dot = View(this).apply {
                layoutParams = LinearLayout.LayoutParams(dp10, dp10).also { lp ->
                    lp.marginStart = dp6
                    lp.marginEnd   = dp6
                }
            }
            dots.add(dot)
            b.dotsContainer.addView(dot)
        }
    }

    private fun updateState(position: Int) {
        val isLast = position == SLIDE_RES.lastIndex

        b.btnNext.text = getString(if (isLast) R.string.intro_btn_start else R.string.intro_btn_next)
        b.tvSkip.text  = getString(if (isLast) R.string.intro_dont_show else R.string.intro_skip)

        val density = resources.displayMetrics.density
        dots.forEachIndexed { i, dot ->
            val active = i == position
            dot.background = getDrawable(if (active) R.drawable.bg_dot_active else R.drawable.bg_dot_inactive)
            val sizePx = ((if (active) 10 else 8) * density).toInt()
            dot.layoutParams = (dot.layoutParams as LinearLayout.LayoutParams).also {
                it.width  = sizePx
                it.height = sizePx
            }
        }
    }

    private fun finishIntro() {
        markShown(this)
        val user = FirebaseAuth.getInstance().currentUser
        val dest = if (user != null && user.isEmailVerified)
            Intent(this, GameActivity::class.java)
        else
            Intent(this, LandingActivity::class.java)

        startActivity(dest)
        if (android.os.Build.VERSION.SDK_INT >= 34) {
            overrideActivityTransition(OVERRIDE_TRANSITION_OPEN,
                android.R.anim.fade_in, android.R.anim.fade_out)
        } else {
            @Suppress("DEPRECATION")
            overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out)
        }
        finish()
    }
}
