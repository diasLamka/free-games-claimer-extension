package io.github.diaslamka.freegames.data

import java.text.NumberFormat
import java.util.Currency
import java.util.Locale

/**
 * Les valeurs telles que les magasins les ecrivent : « 23,99 € », « $19.99 »,
 * « 9.99 EUR ». On lit le montant et la devise ; ce qu'on ne sait pas lire ne
 * compte pas, plutot que de compter faux.
 */
object Money {
    data class Amount(val value: Double, val currency: String?)

    private val SYMBOLS = mapOf("€" to "EUR", "$" to "USD", "£" to "GBP", "zł" to "PLN", "CHF" to "CHF", "C$" to "CAD", "CA$" to "CAD")

    fun parse(raw: String?): Amount? {
        val s = raw?.trim().orEmpty()
        if (s.isEmpty()) return null
        val code = Regex("\\b([A-Z]{3})\\b").find(s)?.groupValues?.get(1)
            ?: SYMBOLS.entries.sortedByDescending { it.key.length }.firstOrNull { s.contains(it.key) }?.value
        val num = Regex("\\d[\\d\\s.,\\u00a0\\u202f]*").find(s)?.value?.trim() ?: return null
        val compact = num.replace(Regex("[\\s\\u00a0\\u202f]"), "").trimEnd('.', ',')
        val value = when {
            compact.contains(',') && compact.contains('.') ->
                if (compact.lastIndexOf(',') > compact.lastIndexOf('.')) compact.replace(".", "").replace(',', '.') else compact.replace(",", "")
            compact.contains(',') -> {
                val parts = compact.split(',')
                if (parts.size == 2 && parts[1].length in 1..2) compact.replace(',', '.') else compact.replace(",", "")
            }
            else -> {
                val parts = compact.split('.')
                if (parts.size > 2 || (parts.size == 2 && parts[1].length == 3)) compact.replace(".", "") else compact
            }
        }.toDoubleOrNull() ?: return null
        if (value <= 0) return null
        return Amount(value, code)
    }

    fun format(value: Double, currency: String?, locale: Locale = Locale.getDefault()): String = try {
        val f = NumberFormat.getCurrencyInstance(locale)
        if (currency != null) f.currency = Currency.getInstance(currency)
        f.format(value)
    } catch (_: Exception) {
        String.format(locale, "%.2f %s", value, currency.orEmpty()).trim()
    }

    /** La somme dans la devise la plus representee, et le nombre de valeurs comptees. */
    fun total(raws: List<String?>, preferred: String?): Triple<Double, String?, Int>? {
        val amounts = raws.mapNotNull { parse(it) }
        if (amounts.isEmpty()) return null
        val byCurrency = amounts.groupBy { it.currency ?: preferred }
        val main = byCurrency.maxByOrNull { (k, v) -> v.size * 10 + if (k == preferred) 5 else 0 }!!
        return Triple(main.value.sumOf { it.value }, main.key, main.value.size)
    }
}
