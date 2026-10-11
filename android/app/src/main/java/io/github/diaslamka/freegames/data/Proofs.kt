package io.github.diaslamka.freegames.data

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.view.View
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream

/**
 * Le carnet de preuves (1.34.0) : une capture de la page de confirmation, prise au moment ou un jeu est recupere.
 *
 * Elle reste sur ce telephone, dans un dossier prive de l'appli : ni la sauvegarde, ni l'export, ni le diagnostic ne la
 * contiennent (voir BackupVault). Elle est petite (540 px de large, JPEG), bornee (les quarante dernieres), et se coupe dans
 * les Reglages. Les noms de fichier sont derives de la cle du jeu et relus avec une liste blanche : un nom venu d'un fichier
 * restaure ne peut pas sortir du dossier.
 */
object Proofs {
    const val DIR = "preuves"
    const val MAX_FILES = 40

    /** Les captures d'echec (1.37.0) : un dossier a part, et dix seulement -- elles ne chassent jamais une preuve de recuperation. */
    const val FAIL_DIR = "echecs"
    const val FAIL_MAX = 10
    const val MAX_WIDTH = 540
    private const val QUALITY = 70
    private val NAME = Regex("^[a-z0-9-]{1,64}\\.jpg$")

    fun dir(context: Context): File = File(context.filesDir, DIR)

    fun failDir(context: Context): File = File(context.filesDir, FAIL_DIR)

    /** Un nom sur, stable pour un meme jeu : lettres et chiffres, plus une empreinte courte qui evite les collisions. */
    fun fileName(key: String): String {
        val base = key.lowercase().replace(Regex("[^a-z0-9]+"), "-").trim('-').take(50).ifEmpty { "preuve" }
        return "$base-${"%06x".format(key.hashCode() and 0xFFFFFF)}.jpg"
    }

    /** Le fichier d'une preuve, ou null : nom hors liste blanche, ou fichier absent. */
    fun file(dir: File, name: String?): File? {
        if (name == null || !NAME.matches(name)) return null
        return File(dir, name).takeIf { it.isFile }
    }

    /** Enregistre la capture (reduite a 540 px de large), menage le dossier, rend le nom -- ou null si l'ecriture echoue. */
    fun save(dir: File, key: String, bitmap: Bitmap, now: Long, max: Int = MAX_FILES): String? = try {
        dir.mkdirs()
        val scaled = if (bitmap.width > MAX_WIDTH) {
            Bitmap.createScaledBitmap(bitmap, MAX_WIDTH, (bitmap.height.toLong() * MAX_WIDTH / bitmap.width).toInt().coerceAtLeast(1), true)
        } else bitmap
        val name = fileName(key)
        val f = File(dir, name)
        FileOutputStream(f).use { scaled.compress(Bitmap.CompressFormat.JPEG, QUALITY, it) }
        f.setLastModified(now)
        if (scaled !== bitmap) scaled.recycle()
        prune(dir, max)
        name
    } catch (_: Exception) {
        null
    }

    /** Les plus anciennes partent quand il y en a plus de MAX_FILES. */
    private fun prune(dir: File, max: Int) {
        val files = dir.listFiles { f -> f.isFile && NAME.matches(f.name) }?.sortedByDescending { it.lastModified() } ?: return
        files.drop(max).forEach { it.delete() }
    }

    fun clear(dir: File) {
        dir.listFiles()?.forEach { if (it.isFile) it.delete() }
    }

    /**
     * La page affichee par `view`, enregistree sous le nom du jeu. null quand la vue n'est pas a l'ecran (une recuperation de
     * fond n'a pas de fenetre) : mieux vaut pas de preuve qu'une image vide.
     */
    suspend fun capture(context: Context, key: String, view: View, now: Long, dir: File = dir(context), max: Int = MAX_FILES): String? {
        val bitmap = withContext(Dispatchers.Main) {
            runCatching {
                if (view.width <= 0 || view.height <= 0) null
                else Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888).also { view.draw(Canvas(it)) }
            }.getOrNull()
        } ?: return null
        return withContext(Dispatchers.IO) { save(dir, key, bitmap, now, max).also { bitmap.recycle() } }
    }
}
