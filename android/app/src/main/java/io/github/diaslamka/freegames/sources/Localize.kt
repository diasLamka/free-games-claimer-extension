package io.github.diaslamka.freegames.sources

/**
 * Les adresses des magasins dans la langue et le pays du reglage.
 *
 * Copie Kotlin de `watch/localize.js`. La table d'or
 * `src/test/resources/localize-golden.tsv` est regeneree depuis le module JS
 * (test/localize.test.mjs) puis relue par `LocalizeTest` : une divergence fait
 * echouer un test, pas un telephone.
 *
 *  - Epic : le segment de langue du chemin, ou `?lang=` quand il n'y en a pas.
 *  - GOG : le prefixe de langue du chemin (six langues seulement).
 *  - Luna : le domaine du pays -- ou celui ou une session a ete vue.
 *  - Steam, les autres hotes, le http : rendus tels quels.
 *
 * Pour OUVRIR une page que le moteur va lire (`forClaim`), la langue Epic est
 * ramenee au francais ou a l'anglais, les seules dont il connait les boutons.
 */
object Localize {
    private val EPIC_SEGMENTS = mapOf(
        "fr" to "fr", "en" to "en-US", "de" to "de", "es" to "es-ES", "it" to "it", "pt" to "pt-BR", "pl" to "pl",
    )
    private val EPIC_KNOWN = setOf(
        "ar", "de", "en-us", "es-es", "es-mx", "fr", "it", "ja", "ko", "pl", "pt-br", "ru", "th", "tr", "zh-cn", "zh-hant",
    )
    private val EPIC_CLAIM_LANGS = setOf("fr", "en")
    private val GOG_LANGS = setOf("en", "de", "fr", "pl", "ru", "zh")
    private val GOG_HEADS = setOf("game", "games", "redeem")
    private val LUNA_FORM = Regex("""^luna\.amazon\.(com|fr|de|co\.uk|it|es|ca|com\.au|co\.jp|in|com\.mx|com\.br|nl|se|pl|com\.tr)$""")

    private val URL_FORM = Regex("""^https://([^/?#:@]+)(:\d+)?([^?#]*)(\?[^#]*)?(#.*)?$""", RegexOption.IGNORE_CASE)
    private val EPIC_SEGMENT = Regex("""^/([A-Za-z]{2}(?:-[A-Za-z]{2,4})?)(?=/|$)""")
    private val GOG_SEGMENT = Regex("""^/(en|de|fr|pl|ru|zh)(?=/|$)""")

    /** Un domaine Luna connu, ou null. Jamais un hote quelconque. */
    fun lunaHostOrNull(raw: String?): String? =
        raw?.trim()?.lowercase()?.takeIf { LUNA_FORM.matches(it) }

    /** La langue d'une page Epic : celle du pays, ramenee au lisible si on reclame. */
    fun epicPageLang(lang: String, forClaim: Boolean): String =
        if (forClaim) lang.takeIf { it in EPIC_CLAIM_LANGS } ?: "en"
        else lang.takeIf { it in EPIC_SEGMENTS } ?: "en"

    /** Cette adresse dans la langue du pays ; telle quelle si rien ne change. */
    fun url(raw: String?, country: String?, lunaHost: String? = null, forClaim: Boolean = false): String? {
        if (raw.isNullOrEmpty()) return raw
        val m = URL_FORM.matchEntire(raw) ?: return raw
        val c = Countries.of(country)
        val lang = c.lang
        val host = m.groupValues[1].lowercase()
        var newHost = host
        var path = m.groupValues[3].ifEmpty { "/" }
        var query = m.groupValues[4]

        when {
            host == "store.epicgames.com" -> {
                val page = epicPageLang(lang, forClaim)
                val first = EPIC_SEGMENT.find(path)
                if (first != null && first.groupValues[1].lowercase() in EPIC_KNOWN) {
                    val segment = EPIC_SEGMENTS[page]
                    if (segment != null && first.groupValues[1] != segment) {
                        path = "/" + segment + path.substring(first.value.length)
                    }
                } else {
                    query = withLang(query, page)
                }
            }
            host == "www.gog.com" || host == "gog.com" -> {
                if (lang !in GOG_LANGS) return raw
                val first = GOG_SEGMENT.find(path)
                if (first != null) {
                    if (first.groupValues[1] != lang) path = "/" + lang + path.substring(first.value.length)
                } else {
                    val head = path.split("/").getOrNull(1).orEmpty()
                    if (head.isEmpty() || head in GOG_HEADS) path = "/" + lang + (if (path == "/") "/" else path)
                }
            }
            host.startsWith("luna.amazon.") -> {
                if (!Regex("""^/claims(/|$)""").containsMatchIn(path)) return raw
                newHost = lunaHostOrNull(lunaHost) ?: Countries.lunaHost(c.code)
            }
            else -> return raw
        }

        val out = "https://" + newHost + m.groupValues[2] + path + query + m.groupValues[5]
        return if (out == raw || out == "$raw/") raw else out
    }

    /** `?lang=` pose ou remplace, les autres parametres gardes dans leur ordre. */
    private fun withLang(query: String, page: String): String {
        val parts = if (query.isEmpty()) emptyList() else query.substring(1).split("&")
        val firstLang = parts.firstOrNull { it.substringBefore("=") == "lang" }
        if (firstLang != null && firstLang.substringAfter("=", "") == page) return query
        var placed = false
        val out = ArrayList<String>()
        for (p in parts) {
            if (p.substringBefore("=") == "lang") {
                if (!placed) { out.add("lang=$page"); placed = true }
            } else {
                out.add(p)
            }
        }
        if (!placed) out.add("lang=$page")
        return "?" + out.joinToString("&")
    }
}
