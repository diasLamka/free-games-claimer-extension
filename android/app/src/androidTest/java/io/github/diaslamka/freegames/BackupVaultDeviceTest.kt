package io.github.diaslamka.freegames

import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.diaslamka.freegames.data.BackupVault
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.LibraryEntry
import io.github.diaslamka.freegames.model.Settings
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * La sauvegarde chiffree sur le VRAI Android, au cout de production (210 000 iterations) : PBKDF2-HMAC-SHA256 y existe-t-il, et
 * le chiffrement reste-t-il supportable pour celui qui attend ? Les tests de la JVM ne repondent ni a l'un ni a l'autre.
 */
@RunWith(AndroidJUnit4::class)
class BackupVaultDeviceTest {
    @get:Rule val emulatorOnly = EmulatorOnly()

    private val now = 1_790_000_000_000L
    private val phrase = "une phrase de passe assez longue"

    @Test
    fun aRealBackupSealsAndOpensAtTheRealCostOnThisAndroid() {
        val state = AppState(library = mapOf("epic:x" to LibraryEntry("epic", "x", "X")), settings = Settings(checkHours = 6, wifiOnly = true))

        val t0 = System.nanoTime()
        val sealed = BackupVault.seal(state, phrase, now)
        val sealMs = (System.nanoTime() - t0) / 1_000_000
        val t1 = System.nanoTime()
        val opened = BackupVault.open(sealed, phrase)
        val openMs = (System.nanoTime() - t1) / 1_000_000

        assertEquals(BackupVault.snapshot(state), opened)
        // Lent a dessein, mais pas au point de faire croire a un blocage : une dizaine de secondes au plus, meme sur un emulateur.
        assertTrue("chiffrement : $sealMs ms", sealMs < 20_000)
        assertTrue("lecture : $openMs ms", openMs < 20_000)
        android.util.Log.i("FGC", "sauvegarde chiffree : $sealMs ms pour chiffrer, $openMs ms pour lire, ${sealed.size} octets")
    }

    @Test
    fun aWrongPassphraseIsRefusedOnThisAndroidToo() {
        val sealed = BackupVault.seal(AppState(), phrase, now, iterations = 1_000)
        assertNull(BackupVault.open(sealed, "une autre phrase de passe"))
    }
}
