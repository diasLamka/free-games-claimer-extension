package io.github.diaslamka.freegames.data

import android.content.Context
import io.github.diaslamka.freegames.claim.SessionProbe
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.Offer
import io.github.diaslamka.freegames.model.SourceStatus
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.notify.Digest
import io.github.diaslamka.freegames.notify.Notifier
import io.github.diaslamka.freegames.sources.Countries
import io.github.diaslamka.freegames.sources.EpicMobileSource
import io.github.diaslamka.freegames.sources.EpicSource
import io.github.diaslamka.freegames.sources.GamerPowerSource
import io.github.diaslamka.freegames.sources.GogSource
import io.github.diaslamka.freegames.sources.Localize
import io.github.diaslamka.freegames.sources.SourceResult
import io.github.diaslamka.freegames.sources.SteamSource
import io.github.diaslamka.freegames.work.Scheduler
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.time.ZoneId

/**
 * Un passage de la veille : lire les sources, fusionner, annoncer ce qui est
 * nouveau, rappeler ce qui se termine, noter les jeux. Rejouable a volonte :
 * ce qui a ete annonce est note, jamais annonce deux fois.
 */
object Watcher {
    private val running = Mutex()
    private const val DAY_MS = 24 * 3_600_000L

    data class Summary(val offers: Int, val fresh: Int, val errors: List<String>)

    /** Les offres d'agregateur deja vues par la source du magasin lui-meme sont des doublons. */
    fun merge(previous: Map<String, Offer>, results: List<SourceResult>, now: Long): Map<String, Offer> {
        val out = LinkedHashMap<String, Offer>()
        val okSources = results.filter { it.ok }.map { it.name }.toSet()
        // Une source en panne ne vide rien : on garde ce qu'elle avait dit, tant que ce n'est pas fini.
        previous.values.filter { it.source !in okSources && !it.isExpired(now) }.forEach { out[it.key] = it }
        for (r in results.filter { it.ok }) for (o in r.offers) {
            val before = previous[o.key]
            out[o.key] = o.copy(firstSeen = before?.firstSeen ?: now, lastSeen = now)
        }
        val native = out.values.filter { it.source != GamerPowerSource.NAME }
            .map { "${it.store}:${it.normalisedTitle}" }.toSet()
        return out.filterValues { o ->
            !o.isExpired(now) && !(o.source == GamerPowerSource.NAME && "${o.store}:${o.normalisedTitle}" in native)
        }
    }

    suspend fun check(context: Context, reason: String): Summary = withContext(Dispatchers.IO) { running.withLock { checkLocked(context) } }

    private suspend fun checkLocked(context: Context): Summary {
        Graph.init(context)
        val store = Graph.store
        val now = System.currentTimeMillis()
        // Le relais avant tout : un jeu deja pris par le PC n'est ni annonce ni retente.
        runCatching { RelayLink.sync(context, now) }
        val st = store.value.settings
        // La page Epic suit la langue du PAYS choisi (francais ou anglais : les deux seules que le moteur lit), pas celle du telephone.
        EpicSource.pageLang = Localize.epicPageLang(Countries.of(st.country).lang, forClaim = true)

        val results = coroutineScope {
            val http = Graph.http
            listOf(
                async { EpicSource.discover(http, now, st.country) },
                async { GogSource.discover(http, now) },
                async { SteamSource.discover(http, now, st.country) },
                async { GamerPowerSource.discover(http, now) },
                async { if (st.showMobile) EpicMobileSource.discover(http, now, st.country) else SourceResult(EpicMobileSource.NAME) },
            ).map { it.await() }
        }

        // Les sessions : Steam dit aussi ce qu'il possede, GOG si on est connecte.
        val accounts = Accounts.STORES.associateWith { store ->
            val first = Accounts.check(store, st.country, now)
            // Un « non » des cookies ou de l'API n'est cru qu'apres la page (1.17.0) : voir claim/SessionProbe.kt.
            runCatching { SessionProbe.confirm(context, store, st.country, first, Graph.store.value.accounts[store], now) }.getOrDefault(first)
        }

        val firstRun = store.value.lastCheck == null
        var fresh: List<Offer> = emptyList()
        val after = store.update { s ->
            val offers = merge(s.offers, results, now)
            val epic = results.first { it.name == EpicSource.NAME }
            val upcoming = (if (epic.ok) epic.upcoming else s.upcoming).filter { it.start > now }
            val steamOwned = accounts[Stores.STEAM]?.second?.toList() ?: s.steamOwned
            val base = s.copy(
                offers = offers,
                upcoming = upcoming,
                steamOwned = steamOwned,
                accounts = s.accounts + accounts.mapValues { (k, v) ->
                    // Une session « presente » ne vaut pas mieux qu'un verdict de connexion recent.
                    val prev = s.accounts[k]
                    if (v.first.status == Accounts.PRESENT && prev?.status == Accounts.LOGGED_OUT && now - prev.checkedAt < DAY_MS) prev else v.first
                },
                sources = s.sources + results.associate { it.name to SourceStatus(now, it.ok, it.offers.size, it.errors.firstOrNull()) },
                lastCheck = now,
                // « Attends, il sera offert » (1.7.0) : qui offre, et ce qui a deja ete offert.
                passes = Odds.recordPasses(s.passes, offers.values),
                givers = Odds.recordGivers(s.givers, offers.values, now),
            )
            fresh = offers.values.filter { o ->
                o.isOpen(now) && o.key !in s.announced && o.keepable != false &&
                    Rules.claimedEntry(o, s.library) == null && !Rules.ownedOnSteam(o, base)
            }
            base.copy(announced = (s.announced + fresh.associate { it.key to now }).filterValues { now - it < 90 * DAY_MS })
        }

        // Les notes Steam, puis « Tes gouts » (1.14.0), AVANT d'annoncer : la notification d'un jeu dit de quoi il se rapproche.
        refreshRatings(now)
        refreshTaste(now)
        val ann = Graph.store.value

        if (after.settings.notifyNew && fresh.isNotEmpty()) {
            // Resume du jour (1.13.0) : ce qui n'est ni souhaite ni une deuxieme chance attend l'heure du resume.
            val plan = Digest.split(fresh, ann, now, firstRun)
            if (plan.held.isNotEmpty()) store.update { st -> st.copy(digestHeld = st.digestHeld + plan.held.associate { it.key to now }) }
            // Ce qu'on attendait d'abord, puis la deuxieme chance (1.12.0), puis le reste.
            val ordered = plan.now.sortedByDescending { (if (Rules.wished(it, after)) 2 else 0) + (if (Rules.secondChance(it, after, now) != null) 1 else 0) }
            // Une deuxieme chance ne se noie pas dans « 5 jeux gratuits » : elle est annoncee a part, au premier lancement pres.
            val chances = if (firstRun) emptyList() else ordered.filter { Rules.secondChance(it, after, now) != null }.take(3)
            chances.forEach { Notifier.newGame(context, it, ann) }
            val reste = ordered - chances.toSet()
            if (reste.isNotEmpty()) {
                if (firstRun || reste.size > 3) Notifier.summary(context, reste, ann)
                else reste.forEach { Notifier.newGame(context, it, ann) }
            }
        }

        remindEnding(context, now)
        // La derniere chance (1.5.0) : ce qui est deja dans la fenetre sonne, le reste est programme.
        io.github.diaslamka.freegames.notify.LastChance.ring(context, now)
        io.github.diaslamka.freegames.notify.LastChance.schedule(context, Graph.store.value, now)
        // « Plus tard » (1.12.0) : ce dont le rappel est venu, meme si l'alarme n'a pas survecu a un redemarrage.
        io.github.diaslamka.freegames.notify.Snooze.ring(context, now)
        // Le resume du jour (1.13.0) : envoye s'il est du, puis reprogramme pour la prochaine heure.
        Digest.ring(context, now)
        Digest.effectiveHour(Graph.store.value).takeIf { Digest.enabled(it) }?.let {
            Scheduler.digestAt(context, Digest.nextSlot(it, now, ZoneId.systemDefault()) + 60_000)
        }
        refreshOdds(now)
        refreshTonight(now)
        runCatching { io.github.diaslamka.freegames.widget.TonightWidget.refresh(context) }
        runCatching { io.github.diaslamka.freegames.widget.FreeNowWidget.refresh(context) }
        after.upcoming.firstOrNull()?.let { Scheduler.checkAt(context, it.start + 90_000) }
        runCatching { RelayLink.alive(context, System.currentTimeMillis()) }
        val errors = results.flatMap { r -> r.errors.map { "${r.name} : $it" } }
        return Summary(after.offers.size, fresh.size, errors)
    }

    /** Le dernier jour d'une offre qu'on n'a pas encore : un rappel, une seule fois. */
    private suspend fun remindEnding(context: Context, now: Long) {
        val s = Graph.store.value
        if (!s.settings.notifyEnding) return
        val due = s.offers.values.filter { o ->
            o.end != null && o.isOpen(now) && o.end - now in 1..DAY_MS && o.key !in s.reminded &&
                o.store != Stores.UNKNOWN && o.keepable != false &&
                Rules.claimedEntry(o, s.library) == null && !Rules.ownedOnSteam(o, s)
        }
        if (due.isEmpty()) return
        Graph.store.update { st -> st.copy(reminded = (st.reminded + due.associate { it.key to now }).filterValues { now - it < 30 * DAY_MS }) }
        due.forEach { Notifier.ending(context, it, s) }
    }

    /** Les fiches Steam des souhaits, huit au plus, une fois par heure au plus. */
    suspend fun refreshOdds(now: Long) {
        val s = Graph.store.value
        if (s.oddsAt != null && now - s.oddsAt < Odds.PASS_EVERY_MS) return
        if (Odds.targets(s).none { Odds.needsInfo(s, it, now) }) return
        val next = Odds.refresh(Graph.http, s, now, Countries.of(s.settings.country).code)
        Graph.store.update { st -> st.copy(odds = next, oddsAt = now) }
    }

    /** « Ce soir je joue a... » (1.8.0) : les fiches Steam de la pile, cent au plus, une fois par heure au plus. */
    suspend fun refreshTonight(now: Long) {
        val s = Graph.store.value
        if (!Tonight.due(s, now) || Tonight.buildPile(s).isEmpty()) return
        val (apps, titles) = Tonight.refresh(Graph.http, s, now, Countries.of(s.settings.country).code)
        Graph.store.update { st -> st.copy(tonightApps = apps, tonightTitles = titles, tonightAt = now) }
    }

    /** « Tes gouts » (1.14.0) : les etiquettes des jeux que tu aimes et des offres en cours, deux lots de cinquante au plus, toutes les six heures. */
    suspend fun refreshTaste(now: Long) {
        val s = Graph.store.value
        if (!Taste.due(s, now)) return
        val next = Taste.refresh(Graph.http, s, now, Countries.of(s.settings.country).code)
        // Le profil de l'extension a pu arriver pendant la lecture : on ne l'ecrase pas.
        Graph.store.update { st -> st.copy(taste = next.copy(imported = st.taste.imported)) }
    }

    /** Huit notes au plus par passage : poli envers Steam. */
    suspend fun refreshRatings(now: Long) {
        val s = Graph.store.value
        if (!s.settings.steamRatings) return
        val todo = s.offers.values.filter { it.isOpen(now) && Ratings.eligible(it) && Ratings.needs(s.ratings[Ratings.key(it)], now) }
            .distinctBy { Ratings.key(it) }.take(Ratings.PER_RUN)
        if (todo.isEmpty()) return
        val found = todo.mapNotNull { o ->
            try {
                Ratings.key(o) to Ratings.fetch(Graph.http, o, s.settings.country, now)
            } catch (_: Exception) {
                null
            }
        }
        Graph.store.update { st ->
            val all = st.ratings + found
            st.copy(ratings = if (all.size > 400) all.entries.sortedByDescending { it.value.at }.take(400).associate { it.toPair() } else all)
        }
    }

    fun openOffers(s: AppState, now: Long): List<Offer> = s.offers.values.filter { it.isOpen(now) }
}
