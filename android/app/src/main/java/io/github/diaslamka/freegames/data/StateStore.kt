package io.github.diaslamka.freegames.data

import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.sources.JSON
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File

/**
 * Tout l'etat dans un fichier JSON, ecrit d'un bloc : on ecrit a cote, puis
 * on renomme. Une coupure au milieu d'une ecriture laisse l'ancien fichier
 * intact, jamais un fichier a moitie ecrit.
 *
 * Un seul ecrivain a la fois (le verrou) : la veille de fond et l'ecran
 * peuvent modifier l'etat en meme temps, chacun part de la derniere version.
 */
class StateStore(private val file: File) {
    private val mutex = Mutex()
    private val flow = MutableStateFlow(load())

    val state: StateFlow<AppState> = flow
    val value: AppState get() = flow.value

    suspend fun update(block: (AppState) -> AppState): AppState = mutex.withLock {
        val next = block(flow.value)
        if (next != flow.value) {
            flow.value = next
            withContext(Dispatchers.IO) { save(next) }
        }
        next
    }

    private fun load(): AppState = try {
        if (file.exists()) JSON.decodeFromString(AppState.serializer(), file.readText()) else AppState()
    } catch (_: Exception) {
        // Illisible : on repart de zero plutot que de planter a chaque ouverture.
        // L'ancien fichier est garde a cote, pour qu'on puisse le relire.
        runCatching { file.copyTo(File(file.parentFile, file.name + ".illisible"), overwrite = true) }
        AppState()
    }

    private fun save(s: AppState) {
        val tmp = File(file.parentFile, file.name + ".tmp")
        tmp.writeText(JSON.encodeToString(AppState.serializer(), s))
        if (!tmp.renameTo(file)) {
            file.delete()
            tmp.renameTo(file)
        }
    }
}
