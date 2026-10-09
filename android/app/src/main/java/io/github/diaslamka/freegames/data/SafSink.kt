package io.github.diaslamka.freegames.data

import android.content.Context
import android.net.Uri
import android.provider.DocumentsContract
import java.io.IOException

/**
 * Le dossier choisi par l'utilisateur (Storage Access Framework), vu comme un [AutoBackup.Sink] : l'appli n'a le droit que sur CE
 * dossier, donne par l'utilisateur et gardé d'un lancement a l'autre (takePersistableUriPermission), sans aucune permission de
 * stockage. Sans bibliotheque : l'API du systeme (DocumentsContract) suffit.
 */
class SafSink(context: Context, private val tree: Uri) : AutoBackup.Sink {
    private val resolver = context.applicationContext.contentResolver
    private val rootId = DocumentsContract.getTreeDocumentId(tree)
    private val root: Uri = DocumentsContract.buildDocumentUriUsingTree(tree, rootId)

    /** Les documents du dossier : nom affiche -> identifiant. Leve si le dossier n'est plus lisible (supprime, droit retire). */
    private fun children(): List<Pair<String, String>> {
        val uri = DocumentsContract.buildChildDocumentsUriUsingTree(tree, rootId)
        val out = mutableListOf<Pair<String, String>>()
        val cursor = resolver.query(uri, arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME), null, null, null)
            ?: throw IOException("dossier illisible")
        cursor.use { c -> while (c.moveToNext()) out += c.getString(1) to c.getString(0) }
        return out
    }

    override fun list(): List<String> = children().map { it.first }

    override fun write(name: String, bytes: ByteArray) {
        // createDocument ne remplace pas : il renommerait « nom (1) ». Le fichier du jour, s'il existe, est reecrit sur place.
        val existing = children().firstOrNull { it.first == name }
        val doc = if (existing != null) {
            DocumentsContract.buildDocumentUriUsingTree(tree, existing.second)
        } else {
            DocumentsContract.createDocument(resolver, root, "application/octet-stream", name) ?: throw IOException("creation refusee")
        }
        (resolver.openOutputStream(doc, "wt") ?: throw IOException("ecriture refusee")).use { it.write(bytes) }
    }

    override fun delete(name: String) {
        val doc = children().firstOrNull { it.first == name } ?: return
        DocumentsContract.deleteDocument(resolver, DocumentsContract.buildDocumentUriUsingTree(tree, doc.second))
    }
}
