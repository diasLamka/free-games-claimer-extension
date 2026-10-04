package io.github.diaslamka.freegames

import io.github.diaslamka.freegames.data.StateStore
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.sources.JSON
import java.nio.file.Files
import java.nio.file.StandardCopyOption

/**
 * L'etat de l'appli, dans un fichier. Ce que l'ecran voit (la memoire) et ce que le fichier garde ne doivent pas
 * diverger, et une ecriture qui echoue (disque plein) ne doit pas faire planter celui qui l'a demandee.
 */
class StateStoreTest {
    @get:Rule val tmp = TemporaryFolder()

    @Test
    fun anUpdateIsWrittenAndReadBack() = runBlocking {
        val file = File(tmp.root, "etat.json")
        StateStore(file).update { it.copy(lastCheck = 42L) }
        assertEquals(42L, StateStore(file).value.lastCheck)
    }

    @Test
    fun anUpdateThatIsCancelledOnTheWayStillReachesTheDisk() = runBlocking {
        val file = File(tmp.root, "etat.json")
        val store = StateStore(file)
        lateinit var job: Job
        // L'annulation arrive pendant le calcul du nouvel etat : la memoire a deja change.
        job = launch { store.update { s -> job.cancel(); s.copy(lastCheck = 7L) } }
        job.join()
        assertEquals(7L, store.value.lastCheck)
        // Avant, la sauvegarde partait dans un withContext annule d'emblee : le fichier gardait l'ancien etat.
        assertEquals(7L, StateStore(file).value.lastCheck)
    }

    private val file get() = File(tmp.root, "etat.json")
    private fun sibling(suffix: String) = File(tmp.root, "etat.json$suffix")

    /** Deux ecritures : le fichier garde la deuxieme, la copie a cote la premiere. */
    private fun twoGenerations() = runBlocking {
        val store = StateStore(file)
        store.update { it.copy(lastCheck = 1L) }
        store.update { it.copy(lastCheck = 2L) }
    }

    @Test
    fun aFirstOpeningStartsEmptyAndIsNotARecovery() {
        val store = StateStore(file)
        assertEquals(AppState(), store.value)
        assertEquals(StateStore.Origin.NEW, store.origin)
    }

    @Test
    fun aReadableFileIsUsedAsItIs() {
        twoGenerations()
        val store = StateStore(file)
        assertEquals(2L, store.value.lastCheck)
        assertEquals(StateStore.Origin.FILE, store.origin)
    }

    @Test
    fun everyWriteKeepsThePreviousGenerationBesideTheFile() {
        twoGenerations()
        assertEquals(1L, JSON.decodeFromString(AppState.serializer(), sibling(".bak").readText()).lastCheck)
    }

    @Test
    fun anUnreadableFileFallsBackToThePreviousGenerationAndIsKeptAside() {
        twoGenerations()
        file.writeText("{ pas du json")
        val store = StateStore(file)
        // Avant : l'appli repartait de zero alors qu'une copie lisible existait a cote.
        assertEquals(1L, store.value.lastCheck)
        assertEquals(StateStore.Origin.COPY, store.origin)
        assertEquals("{ pas du json", sibling(".illisible").readText())
    }

    @Test
    fun aFileLostBetweenTheTwoRenamesOfAWriteIsRecoveredFromTheNewestCompleteCopy() {
        twoGenerations()
        // Coupure apres l'ecriture complete du fichier temporaire et le rangement de l'ancien fichier, avant le renommage final.
        Files.move(file.toPath(), sibling(".bak").toPath(), StandardCopyOption.REPLACE_EXISTING)
        sibling(".tmp").writeText(JSON.encodeToString(AppState.serializer(), AppState(lastCheck = 3L)))
        val store = StateStore(file)
        assertEquals(3L, store.value.lastCheck)
        assertEquals(StateStore.Origin.COPY, store.origin)
    }

    @Test
    fun aHalfWrittenTemporaryFileIsNeverPreferredToAReadableCopy() {
        twoGenerations()
        file.delete()
        sibling(".tmp").writeText("{\"lastCheck\": 99")
        val store = StateStore(file)
        assertEquals(1L, store.value.lastCheck)
        assertEquals(StateStore.Origin.COPY, store.origin)
    }

    @Test
    fun withNothingReadableItStartsEmptySaysSoAndKeepsTheOldFile() {
        file.writeText("pas du json")
        val store = StateStore(file)
        assertEquals(AppState(), store.value)
        assertEquals(StateStore.Origin.RESET, store.origin)
        assertEquals("pas du json", sibling(".illisible").readText())
    }

    @Test
    fun theNextUpdateAfterARecoveryWritesAGoodFileAgain() = runBlocking {
        twoGenerations()
        file.writeText("{ pas du json")
        StateStore(file).update { it.copy(lastCheck = 5L) }
        val again = StateStore(file)
        assertEquals(5L, again.value.lastCheck)
        assertEquals(StateStore.Origin.FILE, again.origin)
    }

    @Test
    fun aDiskThatRefusesTheWriteDoesNotCrashTheCaller() = runBlocking {
        // Le dossier du fichier est un fichier : l'ecriture ne peut pas aboutir (disque plein, droits).
        val notADirectory = tmp.newFile("pas-un-dossier")
        val store = StateStore(File(notADirectory, "etat.json"))
        assertNull(store.lastSaveError)
        val next = store.update { it.copy(lastCheck = 9L) }
        assertEquals(9L, next.lastCheck)
        // L'ecran voit le changement, et l'echec est dit au lieu d'etre leve.
        assertEquals(9L, store.value.lastCheck)
        assertNotNull(store.lastSaveError)
    }
}
