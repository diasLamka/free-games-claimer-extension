package io.github.diaslamka.freegames

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.diaslamka.freegames.data.BackupVault
import io.github.diaslamka.freegames.data.Proofs
import io.github.diaslamka.freegames.data.Rules
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.LibraryEntry
import io.github.diaslamka.freegames.model.Stores
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Le carnet de preuves (1.34.0) : la capture de la page de confirmation, gardee sur le telephone, bornee, jamais sauvegardee ni
 * exportee. Ces tests tiennent le fichier : son nom, sa taille, son menage, et le refus de tout nom qui sortirait du dossier.
 */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], application = android.app.Application::class)
class ProofsTest {
    @get:Rule
    val tmp = TemporaryFolder()

    private fun bitmap(w: Int = 1080, h: Int = 1920) = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888).apply { eraseColor(0xFF336699.toInt()) }

    @Test
    fun aCaptureIsSavedAsASmallJpegUnderASafeName() {
        val dir = tmp.newFolder("preuves")
        val name = Proofs.save(dir, "epic:abc123", bitmap(), now = 1_000)
        assertNotNull(name)
        assertTrue(Regex("^[a-z0-9-]{1,64}\\.jpg$").matches(name!!))
        val decoded = BitmapFactory.decodeFile(java.io.File(dir, name).path)
        assertEquals("largeur bornee", Proofs.MAX_WIDTH, decoded.width)
        assertTrue("hauteur au meme rapport", decoded.height in 955..965)
    }

    @Test
    fun aSmallCaptureIsNotEnlarged() {
        val dir = tmp.newFolder("preuves")
        val name = Proofs.save(dir, "gog:x", bitmap(300, 200), now = 1_000)!!
        assertEquals(300, BitmapFactory.decodeFile(java.io.File(dir, name).path).width)
    }

    @Test
    fun theSameGameKeepsOneProofTheLatest() {
        val dir = tmp.newFolder("preuves")
        val a = Proofs.save(dir, "epic:abc", bitmap(), now = 1_000)
        val b = Proofs.save(dir, "epic:abc", bitmap(), now = 2_000)
        assertEquals(a, b)
        assertEquals(1, dir.listFiles()!!.size)
    }

    @Test
    fun onlyTheNewestFortyAreKept() {
        val dir = tmp.newFolder("preuves")
        for (i in 1..45) Proofs.save(dir, "epic:g$i", bitmap(100, 100), now = i * 1_000L)
        val kept = dir.listFiles()!!.map { it.name }.toSet()
        assertEquals(Proofs.MAX_FILES, kept.size)
        assertFalse(Proofs.fileName("epic:g1") in kept)
        assertTrue(Proofs.fileName("epic:g45") in kept)
    }

    @Test
    fun aNameThatLeavesTheFolderIsRefused() {
        val dir = tmp.newFolder("preuves")
        val name = Proofs.save(dir, "epic:abc", bitmap(100, 100), now = 1_000)!!
        assertNotNull(Proofs.file(dir, name))
        assertNull(Proofs.file(dir, "../etat.json"))
        assertNull(Proofs.file(dir, "a/b.jpg"))
        assertNull(Proofs.file(dir, "absent.jpg"))
        assertNull(Proofs.file(dir, null))
    }

    @Test
    fun clearingRemovesEveryProof() {
        val dir = tmp.newFolder("preuves")
        Proofs.save(dir, "epic:a", bitmap(100, 100), now = 1)
        Proofs.save(dir, "gog:b", bitmap(100, 100), now = 2)
        Proofs.clear(dir)
        assertEquals(0, dir.listFiles()?.size ?: 0)
    }

    @Test
    fun theBackupNeverCarriesAProofFileName() {
        val entry = LibraryEntry(store = Stores.EPIC, id = "a", title = "A", ts = 1, proof = "epic-a.jpg", proofUrl = "https://store.epicgames.com/x")
        val state = AppState(library = mapOf(Rules.libraryKey(Stores.EPIC, "a") to entry))
        val saved = BackupVault.snapshot(state).library.values.single()
        assertNull("l'image n'est pas dans la sauvegarde", saved.proof)
        assertEquals("A", saved.title)
    }
}
