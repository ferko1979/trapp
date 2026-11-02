package com.fairco.trap.views

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Typeface
import android.util.AttributeSet
import android.view.View
import android.view.animation.LinearInterpolator
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin

/** Radar display with three fixed gameplay zones and an optional nearest-trap blip ring. */
class RadarView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0,
) : View(context, attrs, defStyleAttr) {

    // Max radar range in metres — outer ring represents this distance
    private val MAX_RANGE_M = 100

    private val crosshairPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = 0xFF15233A.toInt()
        style = Paint.Style.STROKE
        strokeWidth = 1f
    }

    // 100m warning ring — amber
    private val ring100Paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = 0xFFFFB648.toInt()
        style = Paint.Style.STROKE
        strokeWidth = 2f
        alpha = 140
    }

    // 30m reveal ring — cyan
    private val ring30Paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = 0xFF38D3F2.toInt()
        style = Paint.Style.STROKE
        strokeWidth = 2f
        alpha = 180
    }

    // 25m danger ring — red
    private val ring25Paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = 0xFFFF4F62.toInt()
        style = Paint.Style.STROKE
        strokeWidth = 2f
        alpha = 200
    }

    private val labelPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = 0xFFA7B7CC.toInt()
        textSize = 22f
        typeface = Typeface.MONOSPACE
    }

    // Nearest-trap blip ring — white, semi-transparent
    private val blipPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = 0xCCFFFFFF.toInt()
        style = Paint.Style.STROKE
        strokeWidth = 3f
    }

    // Scan line — dynamic colour via setStatusColor()
    private val scanPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = 0xFF38D3F2.toInt()
        style = Paint.Style.STROKE
        strokeWidth = 4f
    }

    private var scanAngle = 0f
    private var nearestTrapMeters: Int = -1   // -1 = no blip

    private val animator = ValueAnimator.ofFloat(0f, 360f).apply {
        duration = 3000
        repeatCount = ValueAnimator.INFINITE
        repeatMode = ValueAnimator.RESTART
        interpolator = LinearInterpolator()
        addUpdateListener {
            scanAngle = it.animatedValue as Float
            invalidate()
        }
    }

    /** Update the scan line colour to reflect proximity state. */
    fun setStatusColor(color: Int) {
        scanPaint.color = color
        invalidate()
    }

    /** Draw a blip ring at the proportional distance of the nearest trap. Pass -1 to clear. */
    fun setNearestTrapDistance(meters: Int) {
        nearestTrapMeters = meters
        invalidate()
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        animator.start()
    }

    override fun onDetachedFromWindow() {
        super.onDetachedFromWindow()
        animator.cancel()
    }

    override fun onVisibilityChanged(changedView: View, visibility: Int) {
        super.onVisibilityChanged(changedView, visibility)
        if (visibility == VISIBLE) {
            if (!animator.isRunning) animator.start()
        } else {
            animator.pause()
        }
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)

        val cx = width / 2f
        val cy = height / 2f
        val radius = min(cx, cy) - 14f

        // Crosshairs
        canvas.drawLine(cx - radius, cy, cx + radius, cy, crosshairPaint)
        canvas.drawLine(cx, cy - radius, cx, cy + radius, crosshairPaint)

        // Zone rings at fixed real-world distances
        // 100m = full radius
        canvas.drawCircle(cx, cy, radius, ring100Paint)
        drawLabel(canvas, cx, cy, radius, "100m", labelPaint)

        // 30m = 30% of radius
        val r30 = radius * 30f / MAX_RANGE_M
        canvas.drawCircle(cx, cy, r30, ring30Paint)
        drawLabel(canvas, cx, cy, r30, "30m", labelPaint)

        // 25m = 25% of radius
        val r25 = radius * 25f / MAX_RANGE_M
        canvas.drawCircle(cx, cy, r25, ring25Paint)
        drawLabel(canvas, cx, cy, r25, "25m", labelPaint)

        // Nearest trap blip ring
        if (nearestTrapMeters in 1..MAX_RANGE_M) {
            val rBlip = radius * nearestTrapMeters.toFloat() / MAX_RANGE_M
            canvas.drawCircle(cx, cy, rBlip, blipPaint)
        }

        // Rotating scan line
        val rad = Math.toRadians(scanAngle.toDouble())
        val scanX = cx + radius * cos(rad).toFloat()
        val scanY = cy + radius * sin(rad).toFloat()
        canvas.drawLine(cx, cy, scanX, scanY, scanPaint)
    }

    private fun drawLabel(canvas: Canvas, cx: Float, cy: Float, ringRadius: Float, text: String, paint: Paint) {
        val textWidth = paint.measureText(text)
        canvas.drawText(text, cx - textWidth / 2f, cy - ringRadius + paint.textSize, paint)
    }
}
