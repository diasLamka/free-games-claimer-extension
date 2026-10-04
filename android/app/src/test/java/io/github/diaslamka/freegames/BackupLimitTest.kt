package io.github.diaslamka.freegames

import io.github.diaslamka.freegames.data.BackupIO
import io.github.diaslamka.freegames.data.StateStore
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.io.InputStream

/**
 * Importer une sauvegarde ne doit pas charger un fichier de n'importe quelle taille en memoire (readBytes, puis un controle
 * de longueur : un fichier de 500 Mo etait lu en entier avant d'etre refuse), ni faire son travail sur le fil principal.
 */
class BackupLimitTest {
    @get:Rule val tmp = TemporaryFolder()

    /** Un flux de `size` octets, qui compte ce qu'on lui a lu. */
    private class Counting(private val size: Int) : InputStream() {
        var read = 0
        override fun read(): Int = if (read < size) { read++; 'a'.code } else -1
        override fun read(b: ByteArray, off: Int, len: Int): Int {
            if (read >= size) return -1
            val n = minOf(len, size - read)
            b.fill('a'.code.toByte(), off, off + n)
            read += n
            return n
        }
    }

    @Test
    fun aFileOverTheLimitIsRefusedWithoutReadingItAll() {
        val three = 3 * 1024 * 1024
        val stream = Counting(three)
        assertNull(BackupIO.readLimited(stream, limit = 1024 * 1024))
        // Il s'arrete peu apres la limite : pas les trois Mo.
        assertTrue("a lu ${stream.read} octets", stream.read <= 1024 * 1024 + 128 * 1024)
    }

    @Test
    fun aFileUnderTheLimitIsReadWhole() {
        val text = "{\"veille:bibliotheque\":[]} é"
        assertEquals(text, BackupIO.readLimited(text.byteInputStream(), limit = 1024))
        // Pile a la limite : accepte.
        val exact = "x".repeat(1024)
        assertEquals(exact, BackupIO.readLimited(exact.byteInputStream(), limit = 1024))
        assertNull(BackupIO.readLimited((exact + "x").byteInputStream(), limit = 1024))
    }

    @Test
    fun theUpdateBlockDoesItsWorkOffTheCallerThread() = runBlocking {
        // L'import d'une sauvegarde (parse JSON de plusieurs Mo) tournait dans le bloc de update, donc sur le fil de l'ecran.
        val store = StateStore(File(tmp.root, "etat.json"))
        val caller = Thread.currentThread()
        var inBlock: Thread? = null
        store.update { s -> inBlock = Thread.currentThread(); s.copy(lastCheck = 5L) }
        assertNotEquals(caller, inBlock)
        assertEquals(5L, store.value.lastCheck)
    }
}
