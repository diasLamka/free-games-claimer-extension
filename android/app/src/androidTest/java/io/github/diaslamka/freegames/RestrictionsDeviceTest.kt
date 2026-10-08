package io.github.diaslamka.freegames

import android.content.Context
import android.os.Build
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.diaslamka.freegames.data.Restrictions
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Ce qu'Android repond VRAIMENT sur l'appli : la classe de veille, la batterie restreinte, les arrets du processus. */
@RunWith(AndroidJUnit4::class)
class RestrictionsDeviceTest {
    @get:Rule val emulatorOnly = EmulatorOnly()

    private val context: Context get() = ApplicationProvider.getApplicationContext()

    @Test
    fun theSystemAnswersWhatItCanAtThisVersion() {
        val s = Restrictions.read(context)
        if (Build.VERSION.SDK_INT >= 28) {
            assertTrue("classe de veille : ${s.bucket}", s.bucket in listOf(5, 10, 20, 30, 40, 45, 50))
            assertNotNull(s.backgroundRestricted)
        } else {
            assertNull(s.bucket)
            assertNull(s.backgroundRestricted)
        }
        // Les arrets du processus se lisent sans lever ; chaque motif a un nom connu (le diagnostic les dit).
        for (e in s.exits) {
            assertTrue("horodatage : ${e.at}", e.at > 0)
            assertTrue("motif inconnu : ${e.reason}", !Restrictions.reasonName(e.reason).startsWith("unknown"))
        }
        if (Build.VERSION.SDK_INT < 30) assertEquals(emptyList<Restrictions.Exit>(), s.exits)
    }

    @Test
    fun anAppRunningUnderTestIsNotFlaggedAsLimited() {
        val findings = Restrictions.findings(Restrictions.read(context), System.currentTimeMillis())
        // L'appli tourne au premier plan, en test : ni classe « rare », ni batterie restreinte.
        assertEquals(emptyList<Restrictions.Finding>(), findings.filter { it is Restrictions.Finding.BucketLimited || it is Restrictions.Finding.BackgroundRestricted })
    }
}
