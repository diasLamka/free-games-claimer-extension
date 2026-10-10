package io.github.diaslamka.freegames.model

import java.net.URI
import java.net.URLDecoder
import java.text.Normalizer
import java.util.Locale

/**
 * Les titres et les magasins, lus comme l'extension les lit (watch/offer.js,
 * watch/context-wish.js). Les tests verifient les memes cas.
 */
object Titles {
    private val DIACRITICS = Regex("[\\u0300-\\u036f]")
    private val PARENS = Regex("\\s*\\([^)]*\\)\\s*")
    private val GIVEAWAY = Regex("\\b(key\\s+)?giveaway\\b")
    private val NON_ALNUM = Regex("[^a-z0-9]+")

    /** « Hollow Knight: Silksong » et « hollow knight silksong » sont le meme jeu. */
    fun normalise(title: String?): String =
        Normalizer.normalize(title.orEmpty(), Normalizer.Form.NFD)
            .replace(DIACRITICS, "")
            .lowercase(Locale.ROOT)
            .replace(PARENS, " ")
            .replace(GIVEAWAY, " ")
            .replace(NON_ALNUM, " ")
            .trim()

    private fun rx(p: String) = Regex(p, RegexOption.IGNORE_CASE)

    private val TITLE_SUFFIXES = listOf(
        rx("\\bepic\\s*games?\\b") to Stores.EPIC,
        rx("\\bgog\\b") to Stores.GOG,
        rx("\\bsteam\\b") to Stores.STEAM,
        rx("\\bitch\\.?\\s*io\\b") to Stores.ITCHIO,
        rx("\\bindie\\s*gala\\b") to Stores.INDIEGALA,
        rx("\\bfanatical\\b") to Stores.FANATICAL,
        rx("\\bhumble\\b") to Stores.HUMBLE,
        rx("\\bprime\\s*gaming\\b|\\bamazon\\b|\\bluna\\b") to Stores.AMAZON,
        rx("\\bmicrosoft\\b|\\bxbox\\b|\\bwindows\\s*store\\b") to Stores.MICROSOFT,
        rx("\\bubisoft\\b|\\buplay\\b") to Stores.UBISOFT,
        rx("\\borigin\\b|\\bea\\s*(app|play)\\b") to Stores.EA,
        rx("\\bbattle\\.?net\\b|\\bblizzard\\b") to Stores.BLIZZARD,
        rx("\\blegacy\\s*games?\\b") to Stores.LEGACY,
    )

    /** Le titre a afficher : sans « (Epic Games) », sans « Giveaway ». */
    fun display(title: String?): String {
        val brut = title.orEmpty()
        val propre = Regex("\\s*\\(([^)]*)\\)").replace(brut) { m ->
            if (TITLE_SUFFIXES.any { it.first.containsMatchIn(m.groupValues[1]) }) "" else m.value
        }
            .replace(rx("\\s+(key\\s+)?giveaway\\s*$"), "")
            .replace(Regex("\\s{2,}"), " ")
            .trim()
        return propre.ifEmpty { brut.trim() }
    }

    fun storeFromTitle(title: String?): String? {
        for (block in Regex("\\(([^)]*)\\)").findAll(title.orEmpty())) {
            for ((motif, store) in TITLE_SUFFIXES) if (motif.containsMatchIn(block.value)) return store
        }
        return null
    }

    fun storeFromPlatforms(platforms: String?): String? {
        for (p in platforms.orEmpty().split(',').map { it.trim() }) {
            if (p.isEmpty()) continue
            for ((motif, store) in TITLE_SUFFIXES) if (motif.containsMatchIn(p)) return store
        }
        return null
    }

    private val STORE_HOSTS = listOf(
        rx("(^|\\.)epicgames\\.com$") to Stores.EPIC,
        rx("(^|\\.)fab\\.com$") to Stores.FAB,
        rx("(^|\\.)gog\\.com$") to Stores.GOG,
        rx("(^|\\.)steampowered\\.com$|(^|\\.)steamcommunity\\.com$") to Stores.STEAM,
        rx("(^|\\.)itch\\.io$") to Stores.ITCHIO,
        rx("(^|\\.)indiegala\\.com$") to Stores.INDIEGALA,
        rx("(^|\\.)fanatical\\.com$") to Stores.FANATICAL,
        rx("(^|\\.)humblebundle\\.com$") to Stores.HUMBLE,
        rx("(^|\\.)amazon\\.[a-z.]+$") to Stores.AMAZON,
        rx("(^|\\.)microsoft\\.com$|(^|\\.)xbox\\.com$") to Stores.MICROSOFT,
        rx("(^|\\.)ubisoft\\.com$|(^|\\.)ubi\\.com$") to Stores.UBISOFT,
        rx("(^|\\.)ea\\.com$|(^|\\.)origin\\.com$") to Stores.EA,
        rx("(^|\\.)battle\\.net$|(^|\\.)blizzard\\.com$") to Stores.BLIZZARD,
    )

    fun storeFromUrl(url: String?): String? {
        val host = hostOf(url) ?: return null
        for ((motif, store) in STORE_HOSTS) if (motif.containsMatchIn(host)) return store
        return null
    }

    fun detectStore(title: String?, platforms: String?, url: String?): String =
        storeFromUrl(url) ?: storeFromTitle(title) ?: storeFromPlatforms(platforms) ?: Stores.UNKNOWN

    fun hostOf(url: String?): String? = try {
        URI(url.orEmpty()).host?.lowercase(Locale.ROOT)
    } catch (_: Exception) {
        null
    }

    /** Seules les adresses http(s) passent (watch/offer.js, webUrl). */
    fun webUrl(value: String?): String? {
        if (value.isNullOrBlank()) return null
        return try {
            val s = URI(value.trim()).scheme?.lowercase(Locale.ROOT)
            if (s == "http" || s == "https") value.trim() else null
        } catch (_: Exception) {
            null
        }
    }

    /* ------------------------------------------------ fiches (partage) */

    /** Le magasin d'une adresse de fiche, ou null (watch/context-wish.js, storeOfUrl). */
    fun storeOfGamePage(url: String?): String? {
        val u = try { URI(url.orEmpty().trim()) } catch (_: Exception) { return null }
        if (u.scheme != "https") return null
        val host = u.host.orEmpty().lowercase(Locale.ROOT)
        val path = u.rawPath.orEmpty()
        if (host == "store.steampowered.com" && Regex("^/app/\\d+").containsMatchIn(path)) return Stores.STEAM
        if (host == "store.epicgames.com" && Regex("(^|/)p/[^/]+").containsMatchIn(path)) return Stores.EPIC
        if (Regex("^(www\\.)?gog\\.com$").matches(host) && Regex("(^|/)game/[^/]+").containsMatchIn(path)) return Stores.GOG
        return null
    }

    /** Le nom que porte l'adresse d'une fiche : `/app/393380/Squad/`, `/p/astrea-six-sided-oracles`. */
    fun slugTitle(url: String?): String {
        val store = storeOfGamePage(url) ?: return ""
        val path = URI(url!!.trim()).rawPath.orEmpty()
        val brut = when (store) {
            Stores.STEAM -> Regex("^/app/\\d+/([^/?#]+)").find(path)?.groupValues?.get(1).orEmpty()
            Stores.EPIC -> Regex("/p/([^/?#]+)").find(path)?.groupValues?.get(1).orEmpty()
                .replace(Regex("-(?=[0-9a-f]*\\d)[0-9a-f]{5,}$"), "")
            else -> Regex("/game/([^/?#]+)").find(path)?.groupValues?.get(1).orEmpty()
        }
        var texte = try { URLDecoder.decode(brut, "UTF-8") } catch (_: Exception) { brut }
        texte = texte.replace(Regex("[_-]+"), " ").replace(Regex("\\s+"), " ").trim()
        return if (store == Stores.STEAM) texte
        else Regex("(^|\\s)(\\p{Ll})").replace(texte) { m -> m.groupValues[1] + m.groupValues[2].uppercase(Locale.ROOT) }
    }

    /** L'identifiant Steam d'une fiche, ou null. */
    fun steamAppId(url: String?): String? =
        if (storeOfGamePage(url) == Stores.STEAM) Regex("/app/(\\d+)").find(url!!)?.groupValues?.get(1) else null

    /**
     * Ce qu'une autre appli partage : une adresse de fiche, un titre, ou un
     * texte qui contient l'une ou l'autre. Rend le titre a retenir, ou "".
     */
    fun titleFromShared(subject: String?, text: String?): Pair<String, String?> {
        val all = listOfNotNull(text, subject).joinToString(" ")
        val url = Regex("https://\\S+").find(all)?.value?.trimEnd('.', ',', ')', ']')
        val fromUrl = if (url != null && storeOfGamePage(url) != null) slugTitle(url) else ""
        if (fromUrl.isNotEmpty()) return fromUrl to url
        val sujet = subject?.trim().orEmpty()
        if (sujet.isNotEmpty() && sujet.length <= 140) return display(cleanDocTitle(sujet)) to url
        val brut = text.orEmpty().replace(Regex("https?://\\S+"), " ").replace(Regex("\\s+"), " ").trim()
        return (if (brut.length in 2..140) display(cleanDocTitle(brut)) else "") to url
    }

    /** « Save 50% on Squad on Steam » -> « Squad » (watch/context-wish.js, cleanDocTitle). */
    fun cleanDocTitle(title: String?): String {
        var s = title.orEmpty().replace(Regex("\\s+"), " ").trim()
        s = s.split(Regex("\\s+[|–—]\\s+"))[0]
        s = s.replace(rx("\\s+-\\s+Epic Games Store$"), "")
        s = s.replace(rx("\\s+(on|sur|auf|en|su)\\s+(Steam|GOG\\.com)$"), "")
        s = s.replace(rx("^(Save|Économisez|Economisez|Spare|Ahorra|Risparmia)\\s+\\d+\\s*%\\s+(on|sur|bei|en|su)\\s+"), "")
        s = s.replace(rx("\\s+-?\\d+\\s*%\\s*(off|de réduction|de reduction|rabatt|de descuento|di sconto)$"), "")
        return s.trim()
    }
}
