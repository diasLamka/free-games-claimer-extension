package io.github.diaslamka.freegames.sources

/** Le pays de la boutique, comme dans watch/locale.js. */
object Countries {
    data class Country(val code: String, val lang: String, val currency: String, val label: String)

    val ALL = listOf(
        Country("FR", "fr", "EUR", "France"),
        Country("BE", "fr", "EUR", "Belgique"),
        Country("LU", "fr", "EUR", "Luxembourg"),
        Country("CH", "fr", "CHF", "Suisse"),
        Country("CA", "en", "CAD", "Canada"),
        Country("US", "en", "USD", "United States"),
        Country("GB", "en", "GBP", "United Kingdom"),
        Country("IE", "en", "EUR", "Ireland"),
        Country("DE", "de", "EUR", "Deutschland"),
        Country("ES", "es", "EUR", "España"),
        Country("IT", "it", "EUR", "Italia"),
        Country("PT", "pt", "EUR", "Portugal"),
        Country("NL", "nl", "EUR", "Nederland"),
        Country("PL", "pl", "PLN", "Polska"),
    )

    const val DEFAULT = "FR"

    fun of(code: String?): Country =
        ALL.firstOrNull { it.code == code?.trim()?.uppercase() } ?: ALL.first { it.code == DEFAULT }

    /** Le domaine Luna du pays : les recuperations Amazon s'y font. */
    fun lunaHost(code: String?): String = when (of(code).code) {
        "FR", "BE", "LU", "CH" -> "luna.amazon.fr"
        "DE" -> "luna.amazon.de"
        "GB", "IE" -> "luna.amazon.co.uk"
        "IT" -> "luna.amazon.it"
        "ES" -> "luna.amazon.es"
        "CA" -> "luna.amazon.ca"
        "NL" -> "luna.amazon.nl"
        "PL" -> "luna.amazon.pl"
        else -> "luna.amazon.com"
    }
}
