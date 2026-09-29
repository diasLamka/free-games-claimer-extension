package io.github.diaslamka.freegames.notify

import android.content.Context
import io.github.diaslamka.freegames.data.Graph
import io.github.diaslamka.freegames.data.Rules
import io.github.diaslamka.freegames.data.Taste
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.Offer
import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime

/**
 * « Resume du jour » (1.13.0) : au lieu d'une notification par jeu, une seule,
 * a l'heure choisie, qui rassemble ce que le jour a apporte.
 *
 * Ce qui ne passe JAMAIS par le resume, parce qu'attendre le ferait rater :
 *   - un jeu souhaite ;
 *   - une deuxieme chance ;
 *   - le rappel du dernier jour, la derniere chance et « Plus tard », qui
 *     ont leur propre chemin.
 *
 * L'ETAT est la source de verite (`digestHeld`) : la planification ne fait que
 * reveiller la veille a l'heure dite, et chaque passage sonne aussi ce qui est
 * du. Couper le resume ne perd rien : ce qui etait retenu part au passage
 * suivant.
 */
object Digest {
    const val OFF = -1
    /** Les heures proposees dans les reglages. */
    val HOURS = listOf(8, 12, 18, 20)
    /** L'heure du resume quand seul le « silence intelligent » en demande un. */
    const val QUIET_HOUR = 20

    fun enabled(hour: Int): Boolean = hour in 0..23

    /** Le silence intelligent est-il en marche ? Il lui faut un profil de gouts. */
    fun quietOn(s: AppState): Boolean = s.settings.tasteQuiet && Taste.effective(s) != null

    /** L'heure du resume : celle qu'on a choisie, sinon 20 h si le silence intelligent en a besoin, sinon aucune. */
    fun effectiveHour(s: AppState): Int = when {
        enabled(s.settings.digestHour) -> s.settings.digestHour
        quietOn(s) -> QUIET_HOUR
        else -> OFF
    }

    /**
     * Ce jeu ne ressemble-t-il PAS a tes gouts, a coup sur ? Douter, c'est
     * sonner : sans profil, sans appid, sans etiquettes lues, l'offre n'est
     * jamais mise de cote. Pure.
     */
    fun notForYou(o: Offer, s: AppState): Boolean {
        val profil = Taste.effective(s) ?: return false
        val tags = Taste.tagsOf(s, Taste.appidOf(o, s))
        if (tags.isEmpty()) return false
        val m = Taste.score(profil, tags) ?: return false
        return m.score < Taste.FOR_YOU
    }

    /** Ce qui part tout de suite, et ce qui attend l'heure du resume. */
    data class Split(val now: List<Offer>, val held: List<Offer>)

    /** Pure. Sans resume, ou au premier lancement (un seul « 5 jeux gratuits » de toute facon), tout part. */
    fun split(fresh: List<Offer>, s: AppState, now: Long, firstRun: Boolean): Split {
        if (!enabled(effectiveHour(s)) || firstRun) return Split(fresh, emptyList())
        val resume = enabled(s.settings.digestHour)
        val silence = quietOn(s)
        val (tout, retenus) = fresh.partition { o ->
            when {
                Rules.wished(o, s) || Rules.secondChance(o, s, now) != null -> true
                // Le resume est choisi : tout y attend, sauf ce qui te ressemble quand le silence intelligent est en marche.
                resume -> silence && Taste.matchFor(s, Taste.appidOf(o, s)) != null
                // Seul le silence intelligent demande un resume : n'attend que ce dont on est sur qu'il ne te ressemble pas.
                else -> !notForYou(o, s)
            }
        }
        return Split(tout, retenus)
    }

    /** La derniere heure de resume echue (au plus tard `now`). Pure. */
    fun lastSlot(hour: Int, now: Long, zone: ZoneId): Long {
        val local = ZonedDateTime.ofInstant(Instant.ofEpochMilli(now), zone)
        var slot = local.toLocalDate().atTime(hour, 0).atZone(zone)
        if (slot.toInstant().toEpochMilli() > now) slot = slot.minusDays(1).toLocalDate().atTime(hour, 0).atZone(zone)
        return slot.toInstant().toEpochMilli()
    }

    /** La prochaine heure de resume, strictement apres `now`. Pure. */
    fun nextSlot(hour: Int, now: Long, zone: ZoneId): Long {
        val local = ZonedDateTime.ofInstant(Instant.ofEpochMilli(now), zone)
        var slot = local.toLocalDate().atTime(hour, 0).atZone(zone)
        if (slot.toInstant().toEpochMilli() <= now) slot = slot.plusDays(1).toLocalDate().atTime(hour, 0).atZone(zone)
        return slot.toInstant().toEpochMilli()
    }

    /**
     * Les jeux retenus dont le resume est du : ceux retenus AVANT la derniere
     * heure echue -- un jeu retenu a 8 h 30 attend le resume de demain, pas
     * celui de 8 h --, ou tous si le resume est coupe : ce qui etait retenu
     * ne doit pas rester dans un tiroir. Pure.
     */
    fun releasable(s: AppState, now: Long, zone: ZoneId): Set<String> {
        val hour = effectiveHour(s)
        if (!enabled(hour)) return s.digestHeld.keys
        val slot = lastSlot(hour, now, zone)
        return s.digestHeld.filterValues { it < slot }.keys
    }

    /** Parmi ces jeux, ceux qui valent encore d'etre annonces, les plus pressants d'abord. Pure. */
    fun pending(s: AppState, keys: Set<String>, now: Long): List<Offer> = keys.mapNotNull { s.offers[it] }.filter { o ->
        o.isOpen(now) && Rules.claimedEntry(o, s.library) == null && !Rules.ownedOnSteam(o, s)
    }.sortedBy { it.end ?: Long.MAX_VALUE }

    /** Envoie le resume s'il est du, une fois, puis vide ce qui partait dedans. */
    suspend fun ring(context: Context, now: Long, zone: ZoneId = ZoneId.systemDefault()) {
        val s = Graph.store.value
        val keys = releasable(s, now, zone)
        if (keys.isEmpty()) return
        val todo = pending(s, keys, now)
        Graph.store.update { st -> st.copy(digestHeld = st.digestHeld - keys) }
        if (todo.isNotEmpty() && s.settings.notifyNew) Notifier.digest(context, todo, s)
    }
}
