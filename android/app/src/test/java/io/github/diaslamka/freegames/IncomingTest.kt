package io.github.diaslamka.freegames

import android.app.Application
import android.content.Intent
import android.net.Uri
import android.os.BadParcelableException
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/**
 * MainActivity est exportee : n'importe quelle appli peut lui envoyer un intent. Ce qu'il demande est lu sans jamais lever,
 * et une demande invalide ne demande rien.
 */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [35], application = Application::class)
class IncomingTest {
    private val tabs = 4

    private fun read(i: Intent) = Incoming.read(i, tabs)

    @Test
    fun aLinkToFinishAGameCarriesItsAddress() {
        val link = "fgclaimer://finir?s=epic&i=abc&t=Hades"
        assertEquals(Incoming.AppLink(link), read(Intent(Intent.ACTION_VIEW, Uri.parse(link))))
    }

    @Test
    fun aViewOfAnotherSchemeAsksNothing() {
        assertEquals(Incoming.Nothing, read(Intent(Intent.ACTION_VIEW, Uri.parse("https://example.test/"))))
    }

    @Test
    fun aSharedTextCarriesItsSubjectAndItsText() {
        val i = Intent(Intent.ACTION_SEND).putExtra(Intent.EXTRA_SUBJECT, "Hades").putExtra(Intent.EXTRA_TEXT, "Hades sur Epic")
        assertEquals(Incoming.Share("Hades", "Hades sur Epic"), read(i))
    }

    @Test
    fun theThreeShortcutsOfTheLauncherAreKnown() {
        assertEquals(Incoming.Shortcut(Raccourcis.Destination.CLAIM_NOW), read(Intent(Raccourcis.RECUPERER)))
        assertEquals(Incoming.Shortcut(Raccourcis.Destination.TONIGHT), read(Intent(Raccourcis.CE_SOIR)))
        assertEquals(Incoming.Shortcut(Raccourcis.Destination.ADD_WISH), read(Intent(Raccourcis.SOUHAIT)))
    }

    @Test
    fun aClaimRequestCarriesTheGameOrEverything() {
        assertEquals(Incoming.Claim("epic:abc"), read(Intent().putExtra(MainActivity.EXTRA_CLAIM, "epic:abc")))
        assertEquals(Incoming.Claim("*"), read(Intent().putExtra(MainActivity.EXTRA_CLAIM, "*")))
    }

    @Test
    fun aTabThatExistsIsOpened() {
        for (t in 0 until tabs) assertEquals(Incoming.OpenTab(t), read(Intent().putExtra(MainActivity.EXTRA_TAB, t)))
    }

    @Test
    fun aTabThatDoesNotExistAsksNothing() {
        // Avant : l'onglet etait pris tel quel, et tout numero hors des trois premiers ouvrait les Reglages sans onglet choisi.
        for (t in listOf(-1, tabs, 99, Int.MAX_VALUE, Int.MIN_VALUE)) {
            assertEquals("onglet $t", Incoming.Nothing, read(Intent().putExtra(MainActivity.EXTRA_TAB, t)))
        }
    }

    @Test
    fun anIntentWithNothingToAskAsksNothing() {
        assertEquals(Incoming.Nothing, read(Intent()))
        assertEquals(Incoming.Nothing, read(Intent("une.action.inconnue")))
    }

    @Test
    fun anIntentWhoseExtrasCannotBeReadAsksNothingInsteadOfCrashing() {
        // Un paquet d'extras qu'on ne sait pas lire (classe inconnue) fait lever hasExtra / getXxxExtra : avant, l'exception
        // sortait de la coroutine de l'ecran, donc de l'appli.
        val hostile = object : Intent() {
            override fun hasExtra(name: String?): Boolean = throw BadParcelableException("classe inconnue")
            override fun getStringExtra(name: String?): String = throw BadParcelableException("classe inconnue")
            override fun getIntExtra(name: String?, defaultValue: Int): Int = throw BadParcelableException("classe inconnue")
        }
        assertEquals(Incoming.Nothing, read(hostile))
        assertEquals(Incoming.Nothing, read(object : Intent(Intent.ACTION_SEND) {
            override fun getStringExtra(name: String?): String = throw BadParcelableException("classe inconnue")
        }))
    }
}
