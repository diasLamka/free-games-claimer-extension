package io.github.diaslamka.freegames

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.diaslamka.freegames.data.StateStore
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.sources.JSON
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/**
 * L'etat sur le VRAI systeme de fichiers d'Android : les tests de la JVM ne voient ni son renommage, ni ses droits. Le magasin
 * travaille dans un dossier a part, jamais dans l'etat reel de l'appli.
 */
@RunWith(AndroidJUnit4::class)
class StateStoreDeviceTest {
    @get:Rule val emulatorOnly = EmulatorOnly()

    private lateinit var dir: File
    private val file get() = File(dir, "etat.json")

    @Before
    fun makeDir() {
        dir = File(ApplicationProvider.getApplicationContext<Context>().cacheDir, "store-" + System.nanoTime()).also { it.mkdirs() }
    }

    @After
    fun clean() {
        dir.deleteRecursively()
    }

    private fun lastCheckOf(f: File) = JSON.decodeFromString(AppState.serializer(), f.readText()).lastCheck

    @Test
    fun everyWriteKeepsThePreviousGenerationBesideTheFile() = runBlocking {
        val store = StateStore(file)
        for (n in 1L..3L) store.update { it.copy(lastCheck = n) }
        // Trois ecritures : la copie a suivi, ce que java.io.File.renameTo ne ferait pas si la cible existe deja.
        assertEquals(3L, lastCheckOf(file))
        assertEquals(2L, lastCheckOf(File(dir, "etat.json.bak")))
        assertEquals(StateStore.Origin.FILE, StateStore(file).origin)
    }

    @Test
    fun anUnreadableFileIsRecoveredFromTheCopyAndKeptAside() = runBlocking {
        val store = StateStore(file)
        for (n in 1L..3L) store.update { it.copy(lastCheck = n) }
        file.writeText("{ pas du json")
        val recovered = StateStore(file)
        assertEquals(2L, recovered.value.lastCheck)
        assertEquals(StateStore.Origin.COPY, recovered.origin)
        assertEquals("{ pas du json", File(dir, "etat.json.illisible").readText())
    }
}
