package com.fairco.trap.views

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.*
import android.util.AttributeSet
import android.view.View
import android.view.animation.LinearInterpolator

class SplashGridView @JvmOverloads constructor(
    context: Context, attrs: AttributeSet? = null, defStyleAttr: Int = 0
) : View(context, attrs, defStyleAttr) {

    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE; strokeWidth = 1f
        color = Color.argb(12, 0, 229, 255)
    }
    private val step = 38f
    private var offset = 0f
    private val animator = ValueAnimator.ofFloat(0f, step).apply {
        duration = 3200; repeatCount = ValueAnimator.INFINITE
        interpolator = LinearInterpolator()
        addUpdateListener { offset = it.animatedValue as Float; invalidate() }
    }

    override fun onAttachedToWindow()   {
        super.onAttachedToWindow()
        animator.start()
    }
    override fun onDetachedFromWindow() { super.onDetachedFromWindow(); animator.cancel() }

    override fun onDraw(canvas: Canvas) {
        var x = -step + offset; while (x <= width + step)  { canvas.drawLine(x, 0f, x, height.toFloat(), paint); x += step }
        var y = -step + offset; while (y <= height + step) { canvas.drawLine(0f, y, width.toFloat(), y, paint); y += step }
    }
}
