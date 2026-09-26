package io.github.diaslamka.freegames.data

import io.github.diaslamka.freegames.BuildConfig
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.ImportedWish
import io.github.diaslamka.freegames.model.LibraryEntry
import io.github.diaslamka.freegames.model.Titles
import io.github.diaslamka.freegames.sources.Countries
import io.github.diaslamka.freegames.sources.arr
import io.github.diaslamka.freegames.sources.get
import io.github.diaslamka.freegames.sources.num
import io.github.diaslamka.freegames.sources.obj
import io.github.diaslamka.freegames.sources.parseJson
import io.github.diaslamka.freegames.sources.str
import io.github.diaslamka.freegames.sources.text
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.Instant

/**
 * L'aller-retour avec l'extension, par fichier : la sauvegarde de l'extension
 * (bouton « Exporter », ou celle de la semaine) s'importe ici, et l'appli
 * ecrit un fichier que la restauration de l'extension relit
 * (watch/full-backup.js). Les deux cotes FUSIONNENT : rien n'est ecrase.
 *
 * Jamais de secret : ni cookie, ni code d'echange, ni reglage de telephone.
 */
object BackupIO {
    const val KEY_LIBRARY = "veille:bibliotheque"
    const val KEY_WISHLIST = "veille:souhaits"
    const val KEY_STEAM_WISHLIST = "veille:souhaits-steam"
    const val KEY_GOG_WISHLIST = "veille:souhaits-gog"
    const val KEY_COUNTRY = "FGC_epic_country"

    /** Ce que le moteur garde et relit : l'historique par magasin, les libelles appris. */
    private val ENGINE_KEYS = Regex("^FGC_(history_.+|taught_labels|seen_labels)$")

    data class Report(val library: Int, val wishes: Int, val imported: Int, val engine: Int)

    private fun backupBlock(root: JsonElement?): JsonObject? {
        root.obj ?: return null
        root["backup"].obj?.let { return it }
        return null
    }

    /** Une valeur que le moteur ecrit en texte JSON, ou deja un objet. */
    private fun lire(v: JsonElement?): JsonElement? = if (v is JsonPrimitive && v.isString) parseJson(v.content) ?: v else v

    fun import(state: AppState, text: String, now: Long): Pair<AppState, Report>? {
        val bloc = backupBlock(parseJson(text)) ?: return null

        var library = state.library
        var libAdded = 0
        lire(bloc[KEY_LIBRARY]).obj?.forEach { (k, e) ->
            val store = e["store"].str ?: return@forEach
            val ts = e["ts"].num?.toLong() ?: return@forEach
            val id = e["id"].text ?: k.substringAfter(':')
            if (k !in library) libAdded++
            val prev = library[k]
            library = library + (k to LibraryEntry(
                store = store, id = id,
                title = e["title"].str ?: prev?.title, url = e["url"].str ?: prev?.url,
                worth = e["worth"].str ?: prev?.worth, image = e["image"].str ?: prev?.image,
                ts = minOf(ts, prev?.ts ?: ts), status = e["status"].str ?: prev?.status ?: "claimed",
                via = prev?.via ?: "extension",
            ))
        }

        val known = state.wishlist.map { Titles.normalise(it) }.toMutableSet()
        val added = mutableListOf<String>()
        lire(bloc[KEY_WISHLIST]).arr?.forEach { w ->
            val title = (w.str ?: w["title"].str)?.trim().orEmpty()
            if (title.isNotEmpty() && known.add(Titles.normalise(title))) added += title
        }

        val imported = buildList {
            for ((key, store) in listOf(KEY_STEAM_WISHLIST to "steam", KEY_GOG_WISHLIST to "gog")) {
                lire(bloc[key])["wishes"].arr?.forEach { w ->
                    val title = w["title"].str?.trim().orEmpty()
                    val id = w["id"].text ?: w["appid"].text
                    if (title.isNotEmpty() || id != null) add(ImportedWish(title, store, id))
                }
            }
        }

        val engine = bloc.filterKeys { ENGINE_KEYS.matches(it) }
        val country = bloc[KEY_COUNTRY].str?.let { Countries.of(it).code }

        val next = state.copy(
            library = library,
            wishlist = state.wishlist + added,
            importedWishes = if (imported.isNotEmpty()) imported else state.importedWishes,
            engine = mergeEngine(state.engine, engine),
            settings = if (country != null) state.settings.copy(country = country) else state.settings,
            importedAt = now,
        )
        return next to Report(libAdded, added.size, imported.size, engine.size)
    }

    /** L'historique du moteur : on garde les entrees des deux cotes. */
    private fun mergeEngine(local: Map<String, JsonElement>, incoming: Map<String, JsonElement>): Map<String, JsonElement> {
        val out = local.toMutableMap()
        for ((k, v) in incoming) {
            val a = lire(local[k]).obj
            val b = lire(v).obj
            out[k] = if (a != null && b != null) JsonPrimitive(JsonObject(b + a).toString()) else (local[k] ?: v)
        }
        return out
    }

    /** Le fichier que la restauration de l'extension sait relire (format 2). */
    fun export(state: AppState, now: Long): String {
        val library = buildJsonObject {
            for ((k, e) in state.library) put(k, buildJsonObject {
                put("store", e.store); put("id", e.id)
                e.title?.let { put("title", it) }; e.url?.let { put("url", it) }
                e.worth?.let { put("worth", it) }; e.image?.let { put("image", it) }
                put("ts", e.ts ?: now); put("status", e.status)
            })
        }
        val wishes = buildJsonArray {
            for (t in state.wishlist) add(buildJsonObject { put("title", t); put("key", Titles.normalise(t)) })
        }
        val backup = buildJsonObject {
            put(KEY_LIBRARY, library)
            put(KEY_WISHLIST, wishes)
            put(KEY_COUNTRY, state.settings.country)
            for ((k, v) in state.engine) if (k.startsWith("FGC_history_")) put(k, v)
        }
        return buildJsonObject {
            put("exportFormat", 2)
            put("exportedAt", Instant.ofEpochMilli(now).toString())
            put("extensionVersion", "android-${BuildConfig.VERSION_NAME}")
            put("backup", backup)
        }.toString()
    }
}
