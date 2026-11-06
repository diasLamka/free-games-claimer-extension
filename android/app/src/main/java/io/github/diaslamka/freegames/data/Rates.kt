package io.github.diaslamka.freegames.data

import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.RateTable
import io.github.diaslamka.freegames.sources.Fetcher
import io.github.diaslamka.freegames.sources.get
import io.github.diaslamka.freegames.sources.num
import io.github.diaslamka.freegames.sources.obj
import io.github.diaslamka.freegames.sources.parseJson
import io.github.diaslamka.freegames.sources.str
import java.util.Locale

/**
 * Le taux du jour, pour lire des euros (1.43.0) ce qui est publie en dollars -- comme `watch/rates.js` dans l'extension.
 *
 * Trois regles tiennent l'honnetete de la chose :
 *   1. la donnee STOCKEE ne bouge pas : on convertit a l'affichage, jamais dans l'etat ;
 *   2. un montant converti se DIT approximatif (« ≈ ») ;
 *   3. sans taux (jamais lu, ou vieux de plus de trente jours), le montant d'origine garde sa devise : une approximation
 *      sans taux serait un chiffre invente.
 *
 * Source : la Banque centrale europeenne, via api.frankfurter.dev (sans cle). Les taux sont donnes POUR UNE unite de la
 * devise de base -- « USD: 1.12 » veut dire qu'un euro vaut 1,12 dollar --, donc on DIVISE pour revenir a la base.
 * La devise de base est celle du pays choisi.
 */
object Rates {
    const val REFRESH_MS = 24 * 3_600_000L
    const val TRUST_MS = 30 * 24 * 3_600_000L

    fun url(base: String) = "https://api.frankfurter.dev/v1/latest?base=$base"

    /** Une reponse de l'API, validee avant d'etre gardee : une reponse illisible n'ecrase jamais un taux qui marchait. */
    fun parse(body: String?, now: Long): RateTable? {
        val root = parseJson(body).obj ?: return null
        val table = root["rates"].obj ?: return null
        val rates = table.entries.mapNotNull { (k, v) -> v.num?.takeIf { it > 0 }?.let { k to it } }.toMap()
        if (rates.isEmpty()) return null
        return RateTable(base = root["base"].str ?: "EUR", date = root["date"].str, rates = rates, at = now)
    }

    /** Assez vieux pour redemander ? Un changement de pays (autre devise de base) redemande aussi. */
    fun due(t: RateTable?, base: String, now: Long): Boolean = t == null || t.base != base || now - t.at >= REFRESH_MS

    fun tooOld(t: RateTable?, now: Long): Boolean = t == null || now - t.at >= TRUST_MS

    /** Vers la devise de BASE ; null quand on ne SAIT pas. */
    fun toBase(amount: Double, currency: String?, t: RateTable?, now: Long): Double? {
        if (currency == null || t == null) return null
        if (currency == t.base) return amount
        if (tooOld(t, now)) return null
        val perBase = t.rates[currency] ?: return null
        return amount / perBase
    }

    /** « ≈ 17,76 € » quand on sait convertir ; le montant d'origine sinon. */
    fun show(amount: Double, currency: String?, t: RateTable?, base: String, now: Long, locale: Locale = Locale.getDefault()): String {
        if (currency == null || currency == base) return Money.format(amount, currency ?: base, locale)
        val converted = toBase(amount, currency, t, now)
        return if (converted != null && t != null && t.base == base) "≈ " + Money.format(converted, base, locale) else Money.format(amount, currency, locale)
    }

    /** Une valeur ecrite par une source (« $19.99 ») : convertie quand elle se lit, telle quelle sinon. */
    fun showWorth(raw: String?, t: RateTable?, base: String, now: Long, locale: Locale = Locale.getDefault()): String? {
        if (raw == null) return null
        val a = Money.parse(raw) ?: return raw
        val cur = a.currency ?: return raw
        return show(a.value, cur, t, base, now, locale)
    }

    /** Une somme de valeurs de sources, ramenee a la devise de base : ce qui n'a pas pu l'etre reste dans sa devise, a cote. */
    data class Total(val value: Double, val count: Int, val approx: Boolean, val rest: Map<String, Double>)

    /**
     * Les valeurs (« $19.99 », « 23,99 € ») additionnees DANS la devise de base (1.47.0). Ce qu'on sait convertir y entre, et la somme
     * est marquee approximative ; ce qu'on ne sait pas convertir reste dans sa devise, a cote, plutot que de disparaitre. Une valeur
     * sans devise compte comme celle de la base. Null quand rien ne se lit, ou quand rien n'entre dans la base (pas de taux) :
     * l'appelant garde alors son ancien comportement.
     */
    fun total(raws: List<String?>, t: RateTable?, base: String, now: Long): Total? {
        val amounts = raws.mapNotNull { Money.parse(it) }
        if (amounts.isEmpty()) return null
        var sum = 0.0
        var approx = false
        var inBase = 0
        val rest = linkedMapOf<String, Double>()
        for (a in amounts) {
            val cur = a.currency
            if (cur == null || cur == base) { sum += a.value; inBase++; continue }
            val converted = if (t != null && t.base == base) toBase(a.value, cur, t, now) else null
            if (converted != null) { sum += converted; approx = true; inBase++ } else rest[cur] = (rest[cur] ?: 0.0) + a.value
        }
        if (inBase == 0) return null
        return Total(sum, amounts.size, approx, rest)
    }

    /** Le total des valeurs, ecrit en devise de base (« ≈ 91,76 € ») ; l'ancien calcul quand aucun taux ne sert. */
    fun showTotal(raws: List<String?>, t: RateTable?, base: String, now: Long, locale: Locale = Locale.getDefault()): String? {
        val tot = total(raws, t, base, now)
        if (tot == null) {
            val old = Money.total(raws, base) ?: return null
            return Money.format(old.first, old.second ?: base, locale)
        }
        val head = (if (tot.approx) "≈ " else "") + Money.format(tot.value, base, locale)
        return (listOf(head) + tot.rest.map { (c, v) -> Money.format(v, c, locale) }).joinToString(" + ")
    }

    /** Les totaux PAR DEVISE du verificateur, ramenes a la devise de base quand on sait ; le reste garde sa devise. */
    fun showTotals(bag: Map<String?, Double>, t: RateTable?, base: String, now: Long, locale: Locale = Locale.getDefault()): String? {
        if (bag.isEmpty()) return null
        var sum = 0.0
        var approx = false
        var inBase = 0
        val rest = linkedMapOf<String, Double>()
        for ((cur, v) in bag) {
            if (cur == null || cur == base) { sum += v; inBase++; continue }
            val converted = if (t != null && t.base == base) toBase(v, cur, t, now) else null
            if (converted != null) { sum += converted; approx = true; inBase++ } else rest[cur] = (rest[cur] ?: 0.0) + v
        }
        val parts = mutableListOf<String>()
        if (inBase > 0) parts += (if (approx) "≈ " else "") + Money.format(sum, base, locale)
        parts += rest.entries.sortedByDescending { it.value }.map { Money.format(it.value, it.key, locale) }
        return parts.joinToString(" + ")
    }

    /** Relit le taux s'il est vieux. Une panne ne perd jamais l'ancien. */
    suspend fun refresh(fetcher: Fetcher, s: AppState, now: Long, base: String): RateTable? {
        if (!due(s.rates, base, now)) return s.rates
        val fresh = runCatchingSuspend { fetcher.get(url(base)).let { if (it.ok) parse(it.body, now) else null } }.getOrNull()
        return fresh ?: s.rates?.takeIf { it.base == base }
    }
}
