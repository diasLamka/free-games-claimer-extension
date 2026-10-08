package io.github.diaslamka.freegames

import android.app.Application
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/**
 * Un vrai saut de ligne dans le XML d'une chaine devient une espace a la compilation des ressources : seul `\n` fait un saut de
 * ligne. Le generateur (tools/strings.py) doit donc ecrire `\n`, sans quoi les paragraphes d'un texte se perdent en silence.
 */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [35], application = Application::class)
class StringsLineBreaksTest {
    private val context: Context get() = ApplicationProvider.getApplicationContext()

    @Test
    fun theStepsOfAGuideAreOnSeparateLines() {
        assertEquals(3, context.getString(R.string.guide_oplus).lines().size)
        assertEquals(3, context.getString(R.string.guide_xiaomi).lines().size)
        assertEquals(2, context.getString(R.string.guide_samsung).lines().size)
    }

    @Test
    fun theParagraphsOfAnOlderTextAreKept() {
        // background_text : trois paragraphes, separes par une ligne vide.
        assertTrue(context.getString(R.string.background_text).contains("\n\n"))
    }
}
