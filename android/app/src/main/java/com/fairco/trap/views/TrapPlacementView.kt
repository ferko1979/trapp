package com.fairco.trap.views

import android.animation.*
import android.content.Context
import android.graphics.*
import android.util.AttributeSet
import android.view.View
import android.view.animation.OvershootInterpolator
import kotlin.math.cos
import kotlin.math.sin

/**
 * Splash screen trap placement animation.
 * Uses hardcoded colours so it works regardless of theme resource availability.
 */
class TrapPlacementView @JvmOverloads constructor(
    context: Context, attrs: AttributeSet? = null, defStyleAttr: Int = 0
) : View(context, attrs, defStyleAttr) {

    private var gridAlpha      = 0f
    private var crosshairY     = -200f
    private var crosshairAlpha = 0f
    private var trapAlpha      = 0f
    private var trapScale      = 0f
    private var jawAngle       = 0f
    private var pulseRadius    = 0f
    private var pulseAlpha     = 0f
    private var scanLineY      = 0f
    private var scanLineAlpha  = 0f

    // Hardcoded night-mode cyan — no R.color dependency
    private val CYAN = Color.parseColor("#00E5FF")

    private val gridPaint  = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE; strokeWidth = 1f
    }
    private val ringPaint  = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE; strokeWidth = 3f
    }
    private val linePaint  = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE; strokeWidth = 2f; strokeCap = Paint.Cap.ROUND
    }
    private val dotPaint   = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val trapPaint  = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE; strokeWidth = 7f
        strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND
    }
    private val fillPaint  = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val pulsePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE; strokeWidth = 2.5f
    }
    private val scanPaint  = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }

    private var animSet: AnimatorSet? = null

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        startSequence()
    }

    override fun onDetachedFromWindow() {
        super.onDetachedFromWindow()
        animSet?.cancel()
    }

    fun startSequence() {
        animSet?.cancel()
        fun fa(prop: String, vararg v: Float) = ObjectAnimator.ofFloat(this, prop, *v)
        AnimatorSet().also { s ->
            s.playSequentially(
                fa("gridAlpha", 0f, 1f).apply { duration = 500 },
                AnimatorSet().apply {
                    playTogether(
                        fa("crosshairY", -280f, 0f).apply { duration = 650; interpolator = OvershootInterpolator(1.2f) },
                        fa("crosshairAlpha", 0f, 1f).apply { duration = 400 }
                    )
                },
                fa("crosshairY", 0f, -7f, 0f).apply { duration = 180 },
                AnimatorSet().apply {
                    playTogether(
                        fa("trapAlpha", 0f, 1f).apply { duration = 320 },
                        fa("trapScale", 0f, 1.12f, 1f).apply { duration = 480; interpolator = OvershootInterpolator(2.5f) }
                    )
                },
                fa("jawAngle", 0f, 40f, 30f, 36f).apply { duration = 520; interpolator = OvershootInterpolator(3f) },
                AnimatorSet().apply {
                    playTogether(
                        fa("pulseRadius", 0f, 220f).apply { duration = 750 },
                        fa("pulseAlpha", 0.85f, 0f).apply { duration = 750 }
                    )
                },
                AnimatorSet().apply {
                    playTogether(
                        fa("scanLineY", 0f, 1f).apply { duration = 650 },
                        fa("scanLineAlpha", 0.5f, 0f).apply { duration = 650 }
                    )
                }
            )
            animSet = s; s.start()
        }
    }

    @Suppress("unused") fun setGridAlpha(v: Float)      { gridAlpha = v;      invalidate() }
    @Suppress("unused") fun setCrosshairY(v: Float)     { crosshairY = v;     invalidate() }
    @Suppress("unused") fun setCrosshairAlpha(v: Float) { crosshairAlpha = v; invalidate() }
    @Suppress("unused") fun setTrapAlpha(v: Float)      { trapAlpha = v;      invalidate() }
    @Suppress("unused") fun setTrapScale(v: Float)      { trapScale = v;      invalidate() }
    @Suppress("unused") fun setJawAngle(v: Float)       { jawAngle = v;       invalidate() }
    @Suppress("unused") fun setPulseRadius(v: Float)    { pulseRadius = v;    invalidate() }
    @Suppress("unused") fun setPulseAlpha(v: Float)     { pulseAlpha = v;     invalidate() }
    @Suppress("unused") fun setScanLineY(v: Float)      { scanLineY = v;      invalidate() }
    @Suppress("unused") fun setScanLineAlpha(v: Float)  { scanLineAlpha = v;  invalidate() }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val cx = width / 2f; val cy = height * 0.58f

        // Grid
        gridPaint.color = Color.argb((gridAlpha * 14).toInt(), 0, 229, 255)
        val step = 38f
        var x = 0f; while (x <= width)  { canvas.drawLine(x, 0f, x, height.toFloat(), gridPaint); x += step }
        var y = 0f; while (y <= height) { canvas.drawLine(0f, y, width.toFloat(), y, gridPaint); y += step }

        // Crosshair
        val ca = (crosshairAlpha * 255).toInt(); val ccy = cy + crosshairY; val cr = 80f
        ringPaint.color = Color.argb((ca * 0.7f).toInt(), 0, 229, 255)
        canvas.drawCircle(cx, ccy, cr, ringPaint)
        ringPaint.color = Color.argb((ca * 0.3f).toInt(), 0, 229, 255)
        canvas.drawCircle(cx, ccy, cr * 0.6f, ringPaint)
        linePaint.color = Color.argb((ca * 0.55f).toInt(), 0, 229, 255)
        canvas.drawLine(cx, ccy - cr, cx, ccy - cr + 16f, linePaint)
        canvas.drawLine(cx, ccy + cr, cx, ccy + cr - 16f, linePaint)
        canvas.drawLine(cx - cr, ccy, cx - cr + 16f, ccy, linePaint)
        canvas.drawLine(cx + cr, ccy, cx + cr - 16f, ccy, linePaint)
        dotPaint.color = Color.argb(ca, 0, 229, 255); canvas.drawCircle(cx, ccy, 5f, dotPaint)
        dotPaint.color = Color.argb(ca, 255, 255, 255); canvas.drawCircle(cx, ccy, 2.5f, dotPaint)

        // Trap
        if (trapAlpha > 0f) {
            canvas.save(); canvas.translate(cx, cy); canvas.scale(trapScale, trapScale)
            val ta = (trapAlpha * 255).toInt()
            trapPaint.color = Color.argb(ta, 0, 229, 255)
            val half = 44f; val h = 26f; val jr = Math.toRadians(jawAngle.toDouble())
            val p1 = Path(); p1.moveTo(0f, 0f); p1.lineTo((-half * cos(jr)).toFloat(), (-h - half * sin(jr)).toFloat())
            canvas.drawPath(p1, trapPaint)
            val p2 = Path(); p2.moveTo(0f, 0f); p2.lineTo((half * cos(jr)).toFloat(), (-h - half * sin(jr)).toFloat())
            canvas.drawPath(p2, trapPaint)
            fillPaint.color = Color.argb(ta, 0, 229, 255)
            canvas.drawRoundRect(-38f, 6f, 38f, 14f, 6f, 6f, fillPaint)
            trapPaint.strokeWidth = 3f
            trapPaint.color = Color.argb((ta * 0.45f).toInt(), 0, 229, 255)
            for (i in -2..2) canvas.drawLine(i * 12f, 14f, i * 12f, 22f, trapPaint)
            trapPaint.strokeWidth = 7f
            fillPaint.color = Color.argb(ta, 0, 229, 255); canvas.drawCircle(0f, -4f, 8f, fillPaint)
            fillPaint.color = Color.WHITE; canvas.drawCircle(0f, -4f, 3.5f, fillPaint)
            canvas.restore()
        }

        // Pulse
        if (pulseAlpha > 0f) {
            pulsePaint.color = Color.argb((pulseAlpha * 200).toInt(), 0, 229, 255)
            canvas.drawCircle(cx, cy, pulseRadius, pulsePaint)
        }

        // Scan line
        if (scanLineAlpha > 0f) {
            val slY = height * scanLineY
            scanPaint.shader = LinearGradient(0f, slY, width.toFloat(), slY,
                intArrayOf(Color.TRANSPARENT, Color.argb((scanLineAlpha * 80).toInt(), 0, 229, 255), Color.TRANSPARENT),
                floatArrayOf(0f, 0.5f, 1f), Shader.TileMode.CLAMP)
            canvas.drawRect(0f, slY - 2f, width.toFloat(), slY + 2f, scanPaint)
        }
    }
}
