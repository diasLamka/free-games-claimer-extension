package io.github.diaslamka.freegames

import io.github.diaslamka.freegames.data.AutoBackup
import io.github.diaslamka.freegames.data.AutoBackup.Outcome
import io.github.diaslamka.freegames.data.BackupVault
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.LibraryEntry
import io.github.diaslamka.freegames.model.Settings
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * La sauvegarde automatique : un fichier par jour, les sept derniers gardes, rien d'autre jamais supprime, et un echec ne detruit
 * jamais l'ancienne sauvegarde.
 */
class AutoBackupTest {
    private val now = 1_790_000_000_000L
    private val day = 24 * 3_600_000L
    private val phrase = "une phrase de passe assez longue"
    private val state = AppState(library = mapOf("epic:x" to LibraryEntry("epic", "x", "X")))

    /** Un dossier en memoire. */
    private class Folder(
        val files: MutableMap<String, ByteArray> = linkedMapOf(),
        var failList: Throwable? = null,
        var failWrite: Throwable? = null,
    ) : AutoBackup.Sink {
        override fun list(): List<String> = failList?.let { throw it } ?: files.keys.toList()
        override fun write(name: String, bytes: ByteArray) {
            failWrite?.let { throw it }
            files[name] = bytes
        }
        override fun delete(name: String) {
            files.remove(name)
        }
    }

    private fun run(folder: Folder, at: Long = now, keep: Int = AutoBackup.KEEP) = AutoBackup.run(state, phrase, at, folder, keep, iterations = 1_000)

    private fun nameOf(daysAgo: Int) = BackupVault.fileName(now - daysAgo * day)

    @Test
    fun theDaysBackupIsWrittenAndOpensWithThePhrase() {
        val folder = Folder()
        val out = run(folder)
        assertEquals(Outcome.Done(BackupVault.fileName(now), emptyList()), out)
        val opened = BackupVault.open(folder.files.getValue(BackupVault.fileName(now)), phrase)
        assertNotNull(opened)
        assertEquals(setOf("epic:x"), opened!!.library.keys)
    }

    @Test
    fun twoRunsInTheSameDayLeaveOneFile() {
        val folder = Folder()
        run(folder)
        run(folder, now + 3_600_000L)
        assertEquals(listOf(BackupVault.fileName(now)), folder.files.keys.toList())
    }

    @Test
    fun onlyTheSevenNewestAreKeptAndTheOldestGoFirst() {
        val folder = Folder()
        for (d in 1..9) folder.files[nameOf(d)] = byteArrayOf(1)
        val out = run(folder) as Outcome.Done
        assertEquals(7, folder.files.size)
        assertEquals(setOf(BackupVault.fileName(now)) + (1..6).map { nameOf(it) }.toSet(), folder.files.keys)
        assertEquals(listOf(nameOf(9), nameOf(8), nameOf(7)).sorted(), out.deleted.sorted())
    }

    @Test
    fun aFileThatIsNotOursIsNeverDeleted() {
        val folder = Folder()
        for (d in 1..9) folder.files[nameOf(d)] = byteArrayOf(1)
        folder.files["photos-vacances.zip"] = byteArrayOf(2)
        folder.files["fgc-sauvegarde-notes.txt"] = byteArrayOf(3)
        folder.files["fgc-sauvegarde-2026-01-01.fgcbak.bak"] = byteArrayOf(4)
        run(folder)
        assertTrue(folder.files.containsKey("photos-vacances.zip"))
        assertTrue(folder.files.containsKey("fgc-sauvegarde-notes.txt"))
        assertTrue(folder.files.containsKey("fgc-sauvegarde-2026-01-01.fgcbak.bak"))
    }

    @Test
    fun aFailedWriteDeletesNothing() {
        val folder = Folder(failWrite = java.io.IOException("stockage plein"))
        for (d in 1..9) folder.files[nameOf(d)] = byteArrayOf(1)
        assertEquals(Outcome.Failed(AutoBackup.ERR_WRITE), run(folder))
        // L'ancienne sauvegarde est la seule qui compte quand la nouvelle n'a pas pu etre ecrite.
        assertEquals(9, folder.files.size)
    }

    @Test
    fun aFolderThatCannotBeReadIsReportedAsTheFolder() {
        val folder = Folder(failList = SecurityException("permission perdue"))
        assertEquals(Outcome.Failed(AutoBackup.ERR_FOLDER), run(folder))
        assertTrue(folder.files.isEmpty())
    }

    @Test
    fun aWriteRefusedByThePermissionIsReportedAsTheFolder() {
        val folder = Folder(failWrite = SecurityException("permission perdue"))
        assertEquals(Outcome.Failed(AutoBackup.ERR_FOLDER), run(folder))
    }

    @Test
    fun theCountKeptCanBeChanged() {
        val folder = Folder()
        for (d in 1..4) folder.files[nameOf(d)] = byteArrayOf(1)
        run(folder, keep = 3)
        assertEquals(3, folder.files.size)
        assertTrue(folder.files.containsKey(BackupVault.fileName(now)))
    }

    @Test
    fun theFolderIsNamedByItsPathWithoutTheStorageVolume() {
        assertEquals("Download/fgc", AutoBackup.folderLabel("content://com.android.externalstorage.documents/tree/primary%3ADownload%2Ffgc"))
        assertEquals("Backups", AutoBackup.folderLabel("content://com.android.externalstorage.documents/tree/1A2B-3C4D%3ABackups"))
        assertEquals("/", AutoBackup.folderLabel("content://com.android.externalstorage.documents/tree/primary%3A"))
        // Un autre fournisseur de documents : son identifiant, tel quel.
        assertEquals("abc123", AutoBackup.folderLabel("content://com.google.android.apps.docs.storage/tree/abc123"))
        assertEquals("", AutoBackup.folderLabel(null))
        assertEquals("", AutoBackup.folderLabel("pas une adresse"))
    }

    @Test
    fun aBackupIsOverdueOnlyWhenEnabledAndSilentForThreeDays() {
        val off = Settings(backupFolder = null, backupAt = now - 10 * day)
        assertNull(AutoBackup.overdueMs(off, now))
        val fresh = Settings(backupFolder = "content://x", backupAt = now - day)
        assertNull(AutoBackup.overdueMs(fresh, now))
        val stale = Settings(backupFolder = "content://x", backupAt = now - 4 * day)
        assertEquals(4 * day, AutoBackup.overdueMs(stale, now))
        // Jamais reussie : on ne sait pas depuis quand, l'erreur de la page des reglages le dit.
        assertNull(AutoBackup.overdueMs(Settings(backupFolder = "content://x", backupAt = null), now))
    }
}
