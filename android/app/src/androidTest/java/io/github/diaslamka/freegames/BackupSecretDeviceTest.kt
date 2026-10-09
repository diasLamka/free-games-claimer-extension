package io.github.diaslamka.freegames

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.diaslamka.freegames.data.BackupSecret
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** La phrase de passe de la sauvegarde automatique dans le VRAI Keystore d'Android : elle y entre, elle en ressort, et ne traine jamais en clair. */
@RunWith(AndroidJUnit4::class)
class BackupSecretDeviceTest {
    @get:Rule val emulatorOnly = EmulatorOnly()

    private val context: Context get() = ApplicationProvider.getApplicationContext()
    private val phrase = "une phrase de passe assez longue"

    @After
    fun clean() = BackupSecret.clear(context)

    @Test
    fun aPassphraseSurvivesTheKeystoreRoundTripAndIsNeverOnDiskInTheClear() {
        assertTrue(BackupSecret.save(context, phrase))
        assertTrue(BackupSecret.present(context))
        assertEquals(phrase, BackupSecret.load(context))
        val onDisk = File(context.filesDir, "sauvegarde.bin").readBytes()
        assertFalse("la phrase est en clair dans le fichier", String(onDisk, Charsets.ISO_8859_1).contains("phrase de passe"))
    }

    @Test
    fun clearingItLeavesNothingToRead() {
        BackupSecret.save(context, phrase)
        BackupSecret.clear(context)
        assertFalse(BackupSecret.present(context))
        assertNull(BackupSecret.load(context))
    }

    @Test
    fun aPassphraseThatIsTooShortIsNotKept() {
        assertFalse(BackupSecret.save(context, "court"))
        assertFalse(BackupSecret.present(context))
    }
}
