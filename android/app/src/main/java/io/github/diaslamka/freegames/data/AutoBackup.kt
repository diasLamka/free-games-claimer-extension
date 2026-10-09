package io.github.diaslamka.freegames.data

import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.Settings

/**
 * La sauvegarde automatique (1.28.0) : une fois par jour, une copie chiffree (BackupVault) dans un dossier que l'utilisateur a
 * choisi -- de preference un dossier que son appli de cloud synchronise. Les sept dernieres sont gardees.
 *
 * Ici, la decision, sans rien de l'appareil : le dossier est un `Sink`, le vrai (SAF) comme celui des tests.
 */
object AutoBackup {
    const val KEEP = 7

    /** Trois jours sans sauvegarde reussie, alors qu'elle est activee : quelque chose ne va pas, et personne ne le voit. */
    const val OVERDUE_MS = 3 * 24 * 3_600_000L

    /** Les noms que l'appli ecrit : les seuls qu'elle supprime, jamais un fichier de l'utilisateur. */
    val NAME = Regex("^fgc-sauvegarde-\\d{4}-\\d{2}-\\d{2}\\.fgcbak$")

    const val ERR_FOLDER = "folder"
    const val ERR_WRITE = "write"
    const val ERR_PASSPHRASE = "passphrase"

    interface Sink {
        fun list(): List<String>
        fun write(name: String, bytes: ByteArray)
        fun delete(name: String)
    }

    sealed interface Outcome {
        data class Done(val name: String, val deleted: List<String>) : Outcome
        data class Failed(val reason: String) : Outcome
    }

    /**
     * Ecrit la sauvegarde du jour, puis -- et seulement si elle est ecrite -- supprime les plus anciennes au-dela de `keep`. Un
     * echec d'ecriture ne detruit donc jamais la derniere sauvegarde qui marchait ; une perte de droit sur le dossier (SecurityException)
     * se dit « dossier », le reste « ecriture ».
     */
    fun run(state: AppState, passphrase: String, now: Long, sink: Sink, keep: Int = KEEP, iterations: Int = BackupVault.ITERATIONS): Outcome {
        val existing = try {
            sink.list()
        } catch (_: Exception) {
            return Outcome.Failed(ERR_FOLDER)
        }
        val name = BackupVault.fileName(now)
        try {
            sink.write(name, BackupVault.seal(state, passphrase, now, iterations))
        } catch (_: SecurityException) {
            return Outcome.Failed(ERR_FOLDER)
        } catch (_: Exception) {
            return Outcome.Failed(ERR_WRITE)
        }
        // Les seuls fichiers qu'on supprime sont ceux qu'on a ecrits : leurs noms, a la forme exacte, et rien d'autre.
        val ours = (existing + name).filter { NAME.matches(it) }.distinct().sortedDescending()
        val stale = ours.drop(keep)
        val deleted = stale.filter { old -> runCatching { sink.delete(old) }.isSuccess }
        return Outcome.Done(name, deleted)
    }

    /** Le nom du dossier choisi, lisible : son chemin sans le volume (« primary:Download/fgc » -> « Download/fgc »). */
    fun folderLabel(uri: String?): String {
        val path = uri?.let { runCatching { java.net.URI(it).path }.getOrNull() } ?: return ""
        if (!path.contains("/tree/")) return ""
        val id = path.substringAfter("/tree/")
        // « primary:Download/fgc » : le volume, deux points, le chemin. Un autre fournisseur de documents n'a pas de volume.
        val label = if (id.contains(':')) id.substringAfter(':') else id
        return label.ifEmpty { "/" }
    }

    /** Depuis combien de temps (ms) la sauvegarde automatique ne reussit plus, ou null : coupee, jamais reussie, ou a jour. */
    fun overdueMs(s: Settings, now: Long): Long? {
        if (s.backupFolder == null) return null
        val last = s.backupAt ?: return null
        return (now - last).takeIf { it > OVERDUE_MS }
    }
}
