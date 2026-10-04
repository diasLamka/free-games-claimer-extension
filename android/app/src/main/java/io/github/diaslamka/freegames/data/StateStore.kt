package io.github.diaslamka.freegames.data

import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.sources.JSON
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File
import java.nio.file.Files
import java.nio.file.StandardCopyOption

/**
 * Tout l'etat dans un fichier JSON, ecrit d'un bloc : on ecrit a cote, puis
 * on renomme. Une coupure au milieu d'une ecriture laisse l'ancien fichier
 * intact, jamais un fichier a moitie ecrit.
 *
 * Un seul ecrivain a la fois (le verrou) : la veille de fond et l'ecran
 * peuvent modifier l'etat en meme temps, chacun part de la derniere version.
 */
class StateStore(private val file: File) {
    /** D'ou vient l'etat au demarrage : le fichier, rien (premiere ouverture), une copie, ou plus rien de lisible. */
    enum class Origin { FILE, NEW, COPY, RESET }

    @Volatile var origin: Origin = Origin.FILE
        private set

    private val mutex = Mutex()
    private val temp = File(file.parentFile, file.name + ".tmp")
    private val backup = File(file.parentFile, file.name + ".bak")
    private val flow = MutableStateFlow(load())

    val state: StateFlow<AppState> = flow
    val value: AppState get() = flow.value

    /** La derniere ecriture qui a echoue (disque plein, droits), ou null : l'ecran voit le changement, le fichier non. */
    @Volatile var lastSaveError: String? = null
        private set

    suspend fun update(block: (AppState) -> AppState): AppState = mutex.withLock {
        // Tout d'un bloc, hors du fil de l'appelant et sans annulation possible : le bloc peut etre lourd (l'import d'une
        // sauvegarde lit plusieurs Mo de JSON) et l'appelant est souvent l'ecran ; il est pur (etat -> etat) et le verrou
        // le garde seul. Une mise a jour commencee va jusqu'au bout -- calcul, publication, ecriture -- : sinon la memoire
        // (ce que voient l'ecran et la veille) divergeait du fichier. L'annulation est constatee au retour.
        withContext(NonCancellable + Dispatchers.Default) {
            val next = block(flow.value)
            if (next != flow.value) {
                flow.value = next
                // Un disque qui refuse (plein, droits) ne fait pas planter l'appelant : l'echec est retenu, le prochain
                // changement reecrit tout l'etat.
                withContext(Dispatchers.IO) {
                    try {
                        save(next)
                        lastSaveError = null
                    } catch (e: Exception) {
                        lastSaveError = e.message ?: e.javaClass.simpleName
                    }
                }
            }
            next
        }
    }

    private fun decode(f: File): AppState? =
        if (!f.exists()) null else try {
            JSON.decodeFromString(AppState.serializer(), f.readText())
        } catch (_: Exception) {
            null
        }

    private fun load(): AppState {
        if (!file.exists() && !temp.exists() && !backup.exists()) {
            origin = Origin.NEW
            return AppState()
        }
        decode(file)?.let { return it }
        // Illisible (ou perdu entre les deux renommages d'une ecriture) : l'ancien fichier est garde a cote, pour qu'on puisse
        // le relire, et l'etat repart de la copie lisible la plus recente -- le fichier temporaire s'il est complet, sinon la
        // generation precedente -- plutot que de zero. Rien de lisible nulle part : zero, plutot que planter a chaque ouverture.
        if (file.exists()) runCatching { file.copyTo(File(file.parentFile, file.name + ".illisible"), overwrite = true) }
        val copy = decode(temp) ?: decode(backup)
        origin = if (copy != null) Origin.COPY else Origin.RESET
        return copy ?: AppState()
    }

    private fun save(s: AppState) {
        val tmp = temp
        tmp.writeText(JSON.encodeToString(AppState.serializer(), s))
        // La generation precedente reste a cote : si le nouveau fichier se revele illisible, on repart d'elle plutot que de zero.
        if (file.exists()) runCatching { Files.move(file.toPath(), backup.toPath(), StandardCopyOption.REPLACE_EXISTING) }
        if (!tmp.renameTo(file)) {
            file.delete()
            tmp.renameTo(file)
        }
    }
}
