package io.github.diaslamka.freegames

import android.app.Application
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.xmlpull.v1.XmlPullParser

/** Les raccourcis d'icone (1.12.0) : le fichier que le lanceur lit, et ou chaque action mene. */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [35], application = Application::class, qualifiers = "fr-rFR")
class RaccourcisTest {
    private data class Raccourci(val id: String, val action: String, val cls: String, val pkg: String, val court: Int, val long: Int, val icone: Int)

    private fun lire(): List<Raccourci> {
        val app = ApplicationProvider.getApplicationContext<Application>()
        val x = app.resources.getXml(R.xml.shortcuts)
        val out = mutableListOf<Raccourci>()
        var id = ""; var court = 0; var long = 0; var icone = 0
        val ns = "http://schemas.android.com/apk/res/android"
        while (x.eventType != XmlPullParser.END_DOCUMENT) {
            if (x.eventType == XmlPullParser.START_TAG) when (x.name) {
                "shortcut" -> {
                    id = x.getAttributeValue(ns, "shortcutId")
                    court = x.getAttributeResourceValue(ns, "shortcutShortLabel", 0)
                    long = x.getAttributeResourceValue(ns, "shortcutLongLabel", 0)
                    icone = x.getAttributeResourceValue(ns, "icon", 0)
                }
                "intent" -> out += Raccourci(
                    id, x.getAttributeValue(ns, "action"), x.getAttributeValue(ns, "targetClass"),
                    x.getAttributeValue(ns, "targetPackage"), court, long, icone,
                )
            }
            x.next()
        }
        return out
    }

    @Test
    fun threeShortcutsLeadToTheMainActivityWithAKnownAction() {
        val r = lire()
        assertEquals(listOf("recuperer", "ce_soir", "souhait"), r.map { it.id })
        for (s in r) {
            assertEquals(BuildConfig.APPLICATION_ID, s.pkg)
            assertEquals(MainActivity::class.java.name, s.cls)
            assertNotNull(s.id, Raccourcis.destination(s.action))
            assertTrue(s.id, s.court != 0 && s.long != 0 && s.icone != 0)
        }
        assertEquals(Raccourcis.RECUPERER, r[0].action)
        assertEquals(Raccourcis.CE_SOIR, r[1].action)
        assertEquals(Raccourcis.SOUHAIT, r[2].action)
    }

    @Test
    fun eachActionLeadsToItsTab() {
        assertEquals(Raccourcis.Destination.CLAIM_NOW, Raccourcis.destination(Raccourcis.RECUPERER))
        assertTrue(Raccourcis.destination(Raccourcis.RECUPERER)!!.claim)
        assertEquals(0, Raccourcis.Destination.CLAIM_NOW.tab)
        assertEquals(1, Raccourcis.destination(Raccourcis.CE_SOIR)!!.tab)
        assertFalse(Raccourcis.destination(Raccourcis.CE_SOIR)!!.claim)
        assertEquals(2, Raccourcis.destination(Raccourcis.SOUHAIT)!!.tab)
        assertNull(Raccourcis.destination("android.intent.action.MAIN"))
        assertNull(Raccourcis.destination(null))
        assertNull(Raccourcis.destination("io.github.diaslamka.freegames.NIMPORTE_QUOI"))
    }

    @Test
    fun shortLabelsFitTheLauncher() {
        // Un lanceur coupe autour de dix caracteres : l'etiquette courte tient, dans chaque langue.
        val app = ApplicationProvider.getApplicationContext<Application>()
        for (s in lire()) assertTrue(app.getString(s.court), app.getString(s.court).length <= 11)
    }

    @Test
    fun theManifestPointsTheMainActivityAtTheShortcuts() {
        val app = ApplicationProvider.getApplicationContext<Application>()
        val info = app.packageManager.getActivityInfo(
            android.content.ComponentName(app, MainActivity::class.java), android.content.pm.PackageManager.GET_META_DATA,
        )
        assertEquals(R.xml.shortcuts, info.metaData.getInt("android.app.shortcuts"))
    }
}
