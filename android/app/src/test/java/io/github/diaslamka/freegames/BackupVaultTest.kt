package io.github.diaslamka.freegames

import io.github.diaslamka.freegames.data.BackupVault
import io.github.diaslamka.freegames.model.AccountState
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.LibraryEntry
import io.github.diaslamka.freegames.model.Mark
import io.github.diaslamka.freegames.model.Member
import io.github.diaslamka.freegames.model.PassRecord
import io.github.diaslamka.freegames.model.RelayState
import io.github.diaslamka.freegames.model.Settings
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * La sauvegarde complete et chiffree : elle se relit avec sa phrase de passe et avec elle seule, elle ne contient jamais de session,
 * de secret ni de jeton, et la restauration fusionne au lieu d'ecraser.
 */
class BackupVaultTest {
    private val now = 1_790_000_000_000L
    private val phrase = "une phrase de passe assez longue"

    // Peu d'iterations : les tests ne mesurent pas la lenteur voulue du chiffrement.
    private fun seal(s: AppState, p: String = phrase) = BackupVault.seal(s, p, now, iterations = 1_000)

    private fun entry(title: String) = LibraryEntry("epic", title.lowercase(), title)

    private val lived = AppState(
        library = mapOf("epic:hades" to entry("Hades")),
        wishlist = listOf("Silksong"),
        marks = mapOf("epic:hades" to Mark("playing", "bien")),
        settings = Settings(checkHours = 6, wifiOnly = true, country = "DE"),
        engine = mapOf(
            "FGC_history_epic" to JsonPrimitive("[1,2]"),
            "FGC_taught_labels" to JsonPrimitive("{}"),
            "FGC_cookie" to JsonPrimitive("SESSION=jeton-confidentiel"),
        ),
        accounts = mapOf("epic" to AccountState("ok", now - 1000, name = "Compte")),
        relay = RelayState(dev = "c0ffee01", pairedAt = now - 5000),
        watchLog = listOf(PassRecord(at = now - 3000, ms = 1000, reason = "fond", outcome = "ok")),
        lastCheck = now - 2000,
        family = listOf(Member(id = "m1", name = "Mamie", library = mapOf("epic:x" to entry("X")), accounts = mapOf("epic" to AccountState("ok", now)))),
    )

    @Test
    fun aSealedBackupOpensWithItsPassphraseAndGivesTheSnapshotBack() {
        val opened = BackupVault.open(seal(lived), phrase)
        assertNotNull(opened)
        assertEquals(BackupVault.snapshot(lived), opened)
        assertEquals(6, opened!!.settings.checkHours)
        assertEquals(setOf("epic:hades"), opened.library.keys)
    }

    @Test
    fun aWrongPassphraseOpensNothing() {
        assertNull(BackupVault.open(seal(lived), "une autre phrase de passe"))
        assertNull(BackupVault.open(seal(lived), ""))
    }

    @Test
    fun aModifiedFileOpensNothing() {
        val bytes = seal(lived)
        // Un octet change n'importe ou : dans le corps, comme dans l'en-tete (nombre d'iterations, sel, vecteur).
        for (at in listOf(bytes.size - 1, bytes.size / 2, 6, 10, 20)) {
            val bad = bytes.copyOf().also { it[at] = (it[at].toInt() xor 1).toByte() }
            assertNull("octet $at", BackupVault.open(bad, phrase))
        }
    }

    @Test
    fun whatIsNotABackupOpensNothing() {
        assertNull(BackupVault.open(ByteArray(0), phrase))
        assertNull(BackupVault.open(ByteArray(10), phrase))
        assertNull(BackupVault.open("{\"exportFormat\":2}".toByteArray(), phrase))
        assertNull(BackupVault.open(seal(lived).copyOf(30), phrase))
    }

    @Test
    fun aFileAskingForAbsurdlyManyIterationsIsRefusedWithoutTryingThem() {
        val bytes = seal(lived).copyOf()
        // Le nombre d'iterations est en tete (apres 4 octets de signature et 1 de version) : 2 milliards.
        bytes[5] = 0x7F; bytes[6] = 0xFF.toByte(); bytes[7] = 0xFF.toByte(); bytes[8] = 0xFF.toByte()
        val started = System.nanoTime()
        assertNull(BackupVault.open(bytes, phrase))
        assertTrue("refuse tout de suite", (System.nanoTime() - started) < 2_000_000_000L)
    }

    @Test
    fun twoBackupsOfTheSameStateDiffer() {
        assertFalse(seal(lived).contentEquals(seal(lived)))
    }

    @Test
    fun theFileDoesNotShowWhatItProtects() {
        val text = String(seal(lived), Charsets.ISO_8859_1)
        for (needle in listOf("Hades", "Silksong", "Mamie", "epic", "settings", "library")) assertFalse(needle, text.contains(needle))
    }

    @Test
    fun aPassphraseMustBeLongEnough() {
        assertFalse(BackupVault.acceptable(""))
        assertFalse(BackupVault.acceptable("1234567"))
        assertTrue(BackupVault.acceptable("12345678"))
        assertTrue(BackupVault.acceptable(phrase))
    }

    @Test
    fun theSnapshotKeepsTheUserDataAndNothingTheSystemOwns() {
        val s = BackupVault.snapshot(lived)
        // Gardes : reglages, bibliotheque, souhaits, etats des jeux, memoire du moteur (la liste blanche), proches.
        assertEquals(lived.settings, s.settings)
        assertEquals(lived.library, s.library)
        assertEquals(lived.wishlist, s.wishlist)
        assertEquals(lived.marks, s.marks)
        assertEquals(setOf("FGC_history_epic", "FGC_taught_labels"), s.engine.keys)
        assertEquals(listOf("m1"), s.family.map { it.id })
        assertEquals(lived.family[0].library, s.family[0].library)
        // Jamais : une session, un secret du relais, le journal, une cle du moteur hors liste blanche.
        assertTrue(s.accounts.isEmpty())
        assertNull(s.relay)
        assertTrue(s.watchLog.isEmpty())
        assertNull(s.lastCheck)
        assertTrue(s.family[0].accounts.isEmpty())
        assertFalse(s.engine.containsKey("FGC_cookie"))
    }

    @Test
    fun theSnapshotLeavesTheDeviceSpecificSettingsBehind() {
        val s = BackupVault.snapshot(lived.copy(settings = lived.settings.copy(backupFolder = "content://tree/secret", backupAt = now)))
        assertNull(s.settings.backupFolder)
        assertNull(s.settings.backupAt)
    }

    @Test
    fun restoringReplacesTheSettingsAndMergesEverythingElse() {
        val phone = AppState(
            library = mapOf("gog:x" to entry("X")),
            wishlist = listOf("Silksong", "Hollow"),
            marks = mapOf("gog:x" to Mark("done")),
            settings = Settings(checkHours = 1, backupFolder = "content://tree/ici", backupAt = now - 10),
            accounts = mapOf("gog" to AccountState("ok", now - 5)),
            relay = RelayState(dev = "neuf", pairedAt = now - 9),
            lastCheck = now - 7,
            watchLog = listOf(PassRecord(at = now - 3, ms = 1, reason = "ecran", outcome = "ok")),
        )
        val back = BackupVault.restore(phone, BackupVault.snapshot(lived))
        // Les reglages de la sauvegarde remplacent ceux du telephone -- sauf ce qui tient a CE telephone.
        assertEquals(6, back.settings.checkHours)
        assertEquals(true, back.settings.wifiOnly)
        assertEquals("content://tree/ici", back.settings.backupFolder)
        assertEquals(now - 10, back.settings.backupAt)
        // Le reste se fusionne : rien de local n'est perdu, la sauvegarde ajoute.
        assertEquals(setOf("gog:x", "epic:hades"), back.library.keys)
        assertEquals(listOf("Silksong", "Hollow"), back.wishlist)
        assertEquals(setOf("gog:x", "epic:hades"), back.marks.keys)
        assertEquals(setOf("FGC_history_epic", "FGC_taught_labels"), back.engine.keys)
        assertEquals(listOf("m1"), back.family.map { it.id })
        // Et ce que le telephone possede reste intact : sessions, relais, journal.
        assertEquals(phone.accounts, back.accounts)
        assertEquals(phone.relay, back.relay)
        assertEquals(phone.lastCheck, back.lastCheck)
        assertEquals(phone.watchLog, back.watchLog)
    }

    @Test
    fun restoringTwiceChangesNothingMore() {
        val snap = BackupVault.snapshot(lived)
        val once = BackupVault.restore(AppState(), snap)
        assertEquals(once, BackupVault.restore(once, snap))
    }

    @Test
    fun aMemberAlreadyHereIsNotDuplicated() {
        val phone = AppState(family = listOf(Member(id = "m1", name = "Mamie (a moi)")))
        val back = BackupVault.restore(phone, BackupVault.snapshot(lived))
        assertEquals(listOf("m1"), back.family.map { it.id })
        assertEquals("Mamie (a moi)", back.family[0].name)
    }

    @Test
    fun theFileNameSaysTheDay() {
        assertEquals("fgc-sauvegarde-2026-09-21.fgcbak", BackupVault.fileName(now))
        assertNotEquals(BackupVault.fileName(now), BackupVault.fileName(now + 86_400_000L))
    }

    @Test
    fun theSameBytesStayTheSameAfterAReadWithTheRightPassphrase() {
        val bytes = seal(lived)
        val copy = bytes.copyOf()
        BackupVault.open(bytes, phrase)
        assertArrayEquals(copy, bytes)
    }
}
