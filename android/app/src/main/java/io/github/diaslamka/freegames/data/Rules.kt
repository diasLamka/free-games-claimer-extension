package io.github.diaslamka.freegames.data

import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.Attempt
import io.github.diaslamka.freegames.model.LibraryEntry
import io.github.diaslamka.freegames.model.Offer
import io.github.diaslamka.freegames.model.Seen
import io.github.diaslamka.freegames.model.Settings
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.model.Titles
import io.github.diaslamka.freegames.sources.GamerPowerSource

/** Les verdicts, avec le vocabulaire du moteur et de watch/claim.js. */
object Verdicts {
    const val CLAIMED = "claimed"
    const val REDEEMED = "redeemed"
    const val ALREADY_REDEEMED = "already_redeemed"
    const val CODE_PENDING = "code_pending_gog"
    const val CODE_COPIED = "code_copied"
    const val LINK_ACCOUNT = "needs_link"
    const val SKIPPED = "skipped"
    const val BAD_URL = "bad_url"
    const val FAILURE = "failed"
    const val LOGIN = "needs_login"
    const val CHALLENGE = "challenge"
    /** Le moteur a lu la page sans reconnaitre de bouton (2.102.0) : un clic de l'utilisateur le lui apprend. */
    const val TEACH = "needs_teaching"
    const val OUT_OF_SCOPE = "out_of_scope"
    const val EXPIRED = "expired"
    const val NEEDS_BASE = "needs_base_game"
    const val UNDETERMINED = "undetermined"
    /** Le compte du magasin, ou toi, dit que le jeu est deja a toi (1.24.0) : definitif, rien n'est ouvert. */
    const val OWNED = "owned"
    /** La page ne propose plus rien a prendre (1.24.0) : deux constats espaces le rendent definitif. */
    const val GONE = "gone"

    val ACQUIRED = setOf(CLAIMED, REDEEMED, ALREADY_REDEEMED)
    val FINAL = setOf(CLAIMED, REDEEMED, ALREADY_REDEEMED, SKIPPED, OUT_OF_SCOPE, BAD_URL, EXPIRED, OWNED)
    /**
     * « Montre-moi le bouton » n'y est PLUS (1.24.0) : il ne s'abandonnait jamais, et un jeu deja a toi le
     * redemandait a l'infini. La question est posee une fois (ASK_WAIT_MS pour y repondre), puis l'offre suit
     * le recul ordinaire et l'abandon au cinquieme essai.
     */
    val HUMAN = setOf(LOGIN, LINK_ACCOUNT, CHALLENGE)

    const val ASK_WAIT_MS = 24 * 3_600_000L
    const val GONE_CONFIRM_MS = 2 * 3_600_000L
    const val GONE_RECHECK_MS = 3 * 3_600_000L
    const val MAX_DEJA = 500

    /** Quinze minutes, une heure, quatre heures, douze heures ; cinq essais au plus. */
    val BACKOFF_MS = listOf(15 * 60_000L, 60 * 60_000L, 4 * 3_600_000L, 12 * 3_600_000L)
    const val MAX_ATTEMPTS = 5
    const val WAITING_RECHECK_MS = 12 * 3_600_000L

    fun nextAttemptAt(attempts: Int, now: Long): Long? {
        if (attempts >= MAX_ATTEMPTS) return null
        val rang = (attempts - 1).coerceIn(0, BACKOFF_MS.size - 1)
        return now + BACKOFF_MS[rang]
    }
}

object Rules {
    fun libraryKey(store: String, id: String) = "$store:${id.removePrefix("slug:").removePrefix("offer:")}"

    fun libraryKeyOf(o: Offer) = libraryKey(o.store, o.storeId ?: o.sourceId ?: o.normalisedTitle)

    /** Deja recupere : par identifiant chez son magasin, ou par titre dans le meme magasin. */
    fun claimedEntry(o: Offer, library: Map<String, LibraryEntry>): LibraryEntry? {
        library[libraryKeyOf(o)]?.let { return it }
        val t = o.normalisedTitle
        if (t.isEmpty()) return null
        return library.values.firstOrNull { it.store == o.store && it.normalisedTitle == t }
    }

    /**
     * « Deuxieme chance » (1.12.0) : cette offre, en cours, porte un jeu qu'on
     * avait deja VU offert sans jamais l'avoir -- le meme calcul que
     * secondChance (watch/recurrence.js). Rend le passage precedent le plus
     * recent, ou null.
     *
     *   - un jeu deja a nous, sur n'importe quel magasin (registre ou Ma
     *     collection), n'a pas de deuxieme chance a saisir ;
     *   - le passage doit dater d'un jour au moins AVANT le debut de cette
     *     offre : `passes` retient une entree par offre, donc l'offre en cours
     *     se croiserait elle-meme sinon. Sans debut connu, trois jours.
     */
    private const val DAY_MS = 24 * 3_600_000L

    fun secondChance(o: Offer, s: AppState, now: Long): Seen? {
        val vus = s.passes[o.normalisedTitle].orEmpty()
        if (vus.isEmpty()) return null
        val n = o.normalisedTitle
        if (s.library.values.any { it.status in Verdicts.ACQUIRED && Titles.normalise(it.title) == n }) return null
        if (s.owned.values.any { Titles.normalise(it.title) == n }) return null
        val debut = listOfNotNull(o.start, o.firstSeen.takeIf { it > 0 }).minOrNull()
        val limite = if (debut != null) debut - DAY_MS else now - 3 * DAY_MS
        return vus.filter { it.ts <= limite }.maxByOrNull { it.ts }
    }

    fun ownedOnSteam(o: Offer, s: AppState): Boolean =
        o.store == Stores.STEAM && o.storeId != null && s.steamOwned.contains(o.storeId)

    /** Un magasin que l'appli sait recuperer, et que l'utilisateur a laisse actif. */
    fun storeEnabled(store: String, st: Settings): Boolean = when (store) {
        Stores.EPIC -> st.claimEpic
        Stores.GOG -> st.claimGog
        Stores.AMAZON -> st.claimAmazon
        Stores.STEAM -> st.claimSteam
        else -> false
    }

    /**
     * Une offre que l'appli sait prendre : un magasin connu du moteur (ou
     * Steam, en option, avec son paquet), quelque chose a garder, et pas du
     * butin d'agregateur -- comme la file de l'extension.
     */
    fun claimable(o: Offer, st: Settings): Boolean {
        if (!storeEnabled(o.store, st)) return false
        if (o.keepable == false) return false
        if (o.source == GamerPowerSource.NAME && o.isExtra) return false
        if (o.store == Stores.STEAM) return o.packageId != null
        return o.url != null || o.resolveUrl != null
    }

    /** Ce qu'il reste a prendre, maintenant. `force` ignore le recul (bouton « Recuperer »). */
    fun pending(s: AppState, now: Long, force: Set<String> = emptySet()): List<Offer> =
        s.offers.values
            .filter { it.isOpen(now) && claimable(it, s.settings) }
            .filter { claimedEntry(it, s.library) == null && !ownedOnSteam(it, s) && !inDeja(it, s) }
            .filter { o ->
                if (o.key in force) return@filter true
                val a = s.attempts[o.key] ?: return@filter true
                if (a.verdict in Verdicts.FINAL) return@filter false
                if (a.count >= Verdicts.MAX_ATTEMPTS) return@filter false
                a.nextAt == null || a.nextAt <= now
            }
            .sortedWith(compareBy<Offer> { it.end ?: Long.MAX_VALUE }.thenBy { it.title })

    /** A-t-on deja pose « montre-moi le bouton » pour cette offre ? (Une offre d'avant la 1.24.0 qui l'attendait compte comme posee.) */
    fun alreadyAsked(a: Attempt?): Boolean = a != null && (a.asks >= 1 || a.verdict == Verdicts.TEACH)

    /** Ce que devient l'essai d'une offre apres un verdict. */
    fun afterVerdict(prev: Attempt?, verdict: String, details: String?, now: Long, unattended: Boolean = false, confirmed: Boolean = false): Attempt {
        val count = (prev?.count ?: 0) + if (verdict in Verdicts.HUMAN) 0 else 1
        val asks = (prev?.asks ?: 0) + if (verdict == Verdicts.TEACH) 1 else 0
        // « Rien a prendre » : un premier constat se reverifie, le second -- espace de GONE_CONFIRM_MS -- clot l'offre.
        val gone = verdict == Verdicts.GONE
        val goneAt = if (gone) (prev?.goneAt ?: now) else null
        // `confirmed` : TU l'as dit sur le panneau (« plus offert ») -- un seul constat suffit alors.
        val goneConfirmed = gone && (confirmed || (prev?.goneAt != null && now - prev.goneAt >= Verdicts.GONE_CONFIRM_MS))
        val next = when {
            verdict in Verdicts.FINAL -> null
            goneConfirmed -> null
            // La journee entiere pour repondre, puis le recul ordinaire : la question ne revient pas.
            verdict == Verdicts.TEACH -> now + Verdicts.ASK_WAIT_MS
            gone -> now + Verdicts.GONE_RECHECK_MS
            // Un defi rencontre sans personne devant : le fond ne revient pas le
            // provoquer a chaque passage. La notification, elle, passe outre.
            verdict == Verdicts.CHALLENGE && unattended -> now + Verdicts.BACKOFF_MS[2]
            verdict in Verdicts.HUMAN -> null
            verdict == Verdicts.NEEDS_BASE -> now + Verdicts.WAITING_RECHECK_MS
            else -> Verdicts.nextAttemptAt(count, now)
        }
        // Clos : le plafond d'essais est atteint, `pending` ne la propose plus (« Recuperer » la rouvre).
        return Attempt(
            count = if (goneConfirmed) Verdicts.MAX_ATTEMPTS else count,
            lastAt = now, verdict = verdict, details = details, nextAt = next, asks = asks, goneAt = goneAt,
        )
    }

    /** La cle de la memoire « deja a toi » : le magasin et le titre normalise, comme ownedKeys de l'extension. */
    fun dejaKey(store: String, title: String?): String? {
        val t = Titles.normalise(title)
        return if (store.isNotEmpty() && t.isNotEmpty()) "$store|$t" else null
    }

    fun inDeja(o: Offer, s: AppState): Boolean = dejaKey(o.store, o.title)?.let { s.deja.containsKey(it) } == true

    /** Ajoute un constat ; la memoire reste bornee, les plus anciens sortent. */
    fun remember(deja: Map<String, Long>, o: Offer, now: Long): Map<String, Long> {
        val k = dejaKey(o.store, o.title) ?: return deja
        if (k in deja) return deja
        val next = deja + (k to now)
        return if (next.size <= Verdicts.MAX_DEJA) next else next.entries.sortedBy { it.value }.drop(next.size - Verdicts.MAX_DEJA).associate { it.key to it.value }
    }

    /** Souhaite : a la main, ou par une liste importee. */
    fun wished(o: Offer, s: AppState): Boolean {
        val t = o.normalisedTitle
        if (t.isEmpty()) return false
        if (t in s.wishedTitles) return true
        return s.importedWishes.any { w -> w.store == o.store && w.id != null && (w.id == o.storeId || w.id == o.sourceId) }
    }
}
