package io.github.diaslamka.freegames.ui

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.Typeface
import androidx.core.content.res.ResourcesCompat
import io.github.diaslamka.freegames.R

/**
 * L'image de « Mon annee en jeux gratuits » (1.6.0) : 1080 x 1350, la meme que
 * celle de l'extension (lib/year-card.js) -- fond noir, jaune cyber, billet
 * poinconne, tampons de travers, Archivo Black et Space Mono.
 */
object YearCard {
    const val W = 1080
    const val H = 1350
    private const val ACCENT = 0xFFE8FF00.toInt()
    private const val NOIR = 0xFF000000.toInt()
    private const val BLANC = 0xFFFFFFFF.toInt()

    /** Les textes, deja traduits. */
    data class Texts(
        val kicker: String, val title: String, val subtitle: String, val valueLabel: String, val value: String,
        val gamesStamp: String, val stores: List<String>, val topLabel: String, val top: List<Pair<String, String>>,
        val lines: List<String>, val footer: String, val stamp: String,
    )

    private fun font(context: Context, id: Int, fallback: Typeface): Typeface =
        runCatching { ResourcesCompat.getFont(context, id) }.getOrNull() ?: fallback

    /** La plus grande taille, de `max` a `min`, ou le texte tient. */
    private fun fit(p: Paint, text: String, width: Float, max: Float, min: Float) {
        var size = max
        while (size > min) {
            p.textSize = size
            if (p.measureText(text) <= width) return
            size -= 2f
        }
        p.textSize = min
    }

    private fun cut(p: Paint, text: String, width: Float): String {
        if (p.measureText(text) <= width) return text
        var t = text
        while (t.length > 1 && p.measureText("$t…") > width) t = t.dropLast(1)
        return t.trimEnd() + "…"
    }

    private fun block(c: Canvas, x: Float, y: Float, w: Float, h: Float, fill: Int, shadow: Int?, line: Int = NOIR) {
        val p = Paint(Paint.ANTI_ALIAS_FLAG)
        if (shadow != null) { p.color = shadow; c.drawRect(x + 14, y + 14, x + w + 14, y + h + 14, p) }
        p.color = fill
        c.drawRect(x, y, x + w, y + h, p)
        p.style = Paint.Style.STROKE
        p.strokeWidth = 6f
        p.color = line
        c.drawRect(x + 3, y + 3, x + w - 3, y + h - 3, p)
    }

    private fun stamp(c: Canvas, text: String, cx: Float, cy: Float, angle: Float, size: Float, fill: Int, display: Typeface) {
        val p = Paint(Paint.ANTI_ALIAS_FLAG).apply { typeface = display; textSize = size }
        val w = p.measureText(text) + 48
        val h = size + 34
        c.save()
        c.rotate(angle, cx, cy)
        val box = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = fill }
        c.drawRect(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2, box)
        box.style = Paint.Style.STROKE
        box.color = NOIR
        box.strokeWidth = 5f
        c.drawRect(cx - w / 2 + 2.5f, cy - h / 2 + 2.5f, cx + w / 2 - 2.5f, cy + h / 2 - 2.5f, box)
        box.strokeWidth = 3f
        c.drawRect(cx - w / 2 + 12, cy - h / 2 + 12, cx + w / 2 - 12, cy + h / 2 - 12, box)
        p.color = NOIR
        p.textAlign = Paint.Align.CENTER
        c.drawText(text, cx, cy + size * 0.36f, p)
        c.restore()
    }

    fun draw(context: Context, t: Texts): Bitmap {
        val bmp = Bitmap.createBitmap(W, H, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        val display = font(context, R.font.archivo_black, Typeface.DEFAULT_BOLD)
        val mono = font(context, R.font.space_mono_regular, Typeface.MONOSPACE)
        val monoBold = font(context, R.font.space_mono_bold, Typeface.MONOSPACE)
        val m = 72f
        c.drawColor(NOIR)
        val p = Paint(Paint.ANTI_ALIAS_FLAG)

        p.typeface = monoBold; p.textSize = 26f; p.color = ACCENT
        c.drawText(t.kicker, m, 104f, p)
        p.typeface = display; p.color = BLANC
        val title = t.title
        fit(p, title, W - 2 * m, 118f, 60f)
        c.drawText(title, m, 230f, p)
        p.color = ACCENT
        val sub = t.subtitle
        fit(p, sub, W - 2 * m, 64f, 34f)
        c.drawText(sub, m, 306f, p)

        val hy = 350f
        val hh = 240f
        block(c, m, hy, W - 2 * m - 14, hh, ACCENT, BLANC)
        p.color = NOIR; p.typeface = monoBold; p.textSize = 26f
        c.drawText(t.valueLabel, m + 36, hy + 64, p)
        p.typeface = display
        fit(p, t.value, W - 2 * m - 90, 132f, 56f)
        c.drawText(t.value, m + 36, hy + 200, p)
        stamp(c, t.gamesStamp, W - m - 150, hy + hh + 6, -6f, 40f, BLANC, display)

        var x = m
        val py = hy + hh + 100
        p.typeface = monoBold; p.textSize = 26f
        val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 4f; color = BLANC }
        for (s in t.stores.take(5)) {
            val text = s
            val w = p.measureText(text) + 36
            if (x + w > W - m) break
            c.drawRect(x + 2, py - 38, x + w - 2, py + 18, stroke)
            p.color = BLANC
            c.drawText(text, x + 18, py, p)
            x += w + 16
        }

        val ty = py + 50
        val th = 84f + 70f * maxOf(1, t.top.size)
        block(c, m, ty, W - 2 * m - 14, th, BLANC, ACCENT)
        p.color = NOIR
        c.drawCircle(m, ty + 58, 18f, p)
        c.drawCircle(W - m - 14, ty + 58, 18f, p)
        val dash = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = NOIR; strokeWidth = 5f; style = Paint.Style.STROKE; pathEffect = DashPathEffect(floatArrayOf(18f, 12f), 0f)
        }
        c.drawLine(m + 30, ty + 58, W - m - 44, ty + 58, dash)
        p.typeface = monoBold; p.textSize = 24f
        c.drawText(t.topLabel, m + 36, ty + 42, p)
        t.top.forEachIndexed { i, (name, worth) ->
            val y = ty + 120 + i * 70
            p.typeface = display; p.textSize = 28f
            val lp = p.measureText(worth)
            c.drawText(cut(p, "${i + 1}. ${name}", W - 2 * m - 110 - lp), m + 36, y, p)
            p.textAlign = Paint.Align.RIGHT
            c.drawText(worth, W - m - 50, y, p)
            p.textAlign = Paint.Align.LEFT
        }

        var ly = ty + th + 70
        for (l in t.lines.take(3)) {
            p.typeface = monoBold; p.textSize = 30f; p.color = ACCENT
            c.drawText(">", m, ly, p)
            p.color = BLANC
            fit(p, l, W - 2 * m - 44, 30f, 20f)
            c.drawText(cut(p, l, W - 2 * m - 44), m + 40, ly, p)
            ly += 50
        }

        p.typeface = mono; p.textSize = 24f; p.color = BLANC
        c.drawText(t.footer, m, H - 60f, p)
        stamp(c, t.stamp, W - m - 150, H - 100f, -10f, 34f, ACCENT, display)
        return bmp
    }
}
