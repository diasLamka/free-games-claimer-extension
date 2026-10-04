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
