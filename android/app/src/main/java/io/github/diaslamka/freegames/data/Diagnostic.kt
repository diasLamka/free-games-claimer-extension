package io.github.diaslamka.freegames.data

import android.content.Context
import android.os.Build
import android.os.PowerManager
import io.github.diaslamka.freegames.BuildConfig
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.notify.Notifier
import io.github.diaslamka.freegames.notify.Watchdog

/**
 * Le diagnostic partageable (1.27.0) : ce qu'il faut pour comprendre une veille qui ne tourne pas, SANS rien de personnel.
 * Il part par le menu « Partager » d'Android : jamais de cookies ni de memoire du moteur, d'identifiant ou de nom de compte, de
 * nom de proche, de souhaits, de titres de la bibliotheque, de secret ou d'adresse du relais -- des comptes, rien d'autre.
 */
object Diagnostic {
    data class Env(
        val appVersion: String,
        val versionCode: Int,
        val engineVersion: String,
        val androidRelease: String,
        val sdk: Int,
        val device: String,
        val notificationsAllowed: Boolean,
        val ignoringBatteryOptimizations: Boolean?,
        val updateSilence: String?,
        val stateOrigin: StateStore.Origin = StateStore.Origin.FILE,
        val restrictions: Restrictions.Snapshot? = null,
    )

    fun env(context: Context): Env = Env(
        appVersion = BuildConfig.VERSION_NAME, versionCode = BuildConfig.VERSION_CODE, engineVersion = BuildConfig.ENGINE_VERSION,
        androidRelease = Build.VERSION.RELEASE, sdk = Build.VERSION.SDK_INT, device = Build.MANUFACTURER + " " + Build.MODEL,
        notificationsAllowed = Notifier.allowed(context),
        ignoringBatteryOptimizations = runCatching { context.getSystemService(PowerManager::class.java)?.isIgnoringBatteryOptimizations(context.packageName) }.getOrNull(),
        updateSilence = runCatching { Install.silence(context).name }.getOrNull(),
        stateOrigin = Graph.store.origin,
        restrictions = Restrictions.read(context),
    )

    private fun iso(t: Long): String = java.time.Instant.ofEpochMilli(t).truncatedTo(java.time.temporal.ChronoUnit.SECONDS).toString()

    /** « 12 min », « 3 h », « 2 j » : depuis combien de temps, sans dependre de la langue. */
    private fun age(then: Long, now: Long): String {
        val min = ((now - then) / 60_000).coerceAtLeast(0)
        return when {
            min < 60 -> "$min min"
            min < 48 * 60 -> "${min / 60} h"
            else -> "${min / (24 * 60)} j"
        }
    }

    private fun yes(b: Boolean) = if (b) "yes" else "no"

    fun build(s: AppState, env: Env, now: Long): String = buildString {
        fun line(text: String = "") = append(text).append('\n')
        line("Free Games Claimer - diagnostic")
        line("generated: ${iso(now)}")
        line()
        line("== app")
        line("version: ${env.appVersion} (${env.versionCode}), engine ${env.engineVersion}")
        line("android: Android ${env.androidRelease} (API ${env.sdk}), ${env.device}")
        line("notifications: ${if (env.notificationsAllowed) "on" else "off"}")
        line("battery optimisation: " + when (env.ignoringBatteryOptimizations) { true -> "exempt"; false -> "restricted"; null -> "unknown" })
        env.updateSilence?.let { line("update install: $it") }
        env.restrictions?.let { r ->
            line("standby bucket: ${Restrictions.bucketName(r.bucket)}" + (r.bucket?.let { " ($it)" } ?: ""))
            line("background restricted: " + when (r.backgroundRestricted) { true -> "yes"; false -> "no"; null -> "unknown" })
            val week = r.exits.filter { now - it.at <= Restrictions.WEEK_MS }
            line("process exits (last 7 d, ${week.size}):")
            if (week.isEmpty()) line("- none")
            for (e in week.take(10)) line("- ${iso(e.at)} ${Restrictions.reasonName(e.reason)} importance ${e.importance}")
        }
        when (env.stateOrigin) {
            StateStore.Origin.COPY -> line("state file: unreadable, restored from the previous copy")
            StateStore.Origin.RESET -> line("state file: unreadable, started empty (the old file is kept as etat.json.illisible)")
            else -> {}
        }
        line()
        val c = s.settings
        line("== settings")
        line("country ${c.country}, check every ${c.checkHours} h")
        line("claim on open: ${yes(c.claimOnOpen)}")
        line("claim in background: ${yes(c.claimInBackground)}")
        line("claim epic ${yes(c.claimEpic)}, gog ${yes(c.claimGog)}, amazon ${yes(c.claimAmazon)}, steam ${yes(c.claimSteam)}")
        line("notify new ${yes(c.notifyNew)}, ending ${yes(c.notifyEnding)}, last chance ${yes(c.lastChance)}, digest hour ${c.digestHour}")
        line("watchdog: ${yes(c.watchdog)}, auto update: ${yes(c.autoUpdate)}")
        line()
        line("== watch")
        val silent = Watchdog.silentFor(s, now)
        line("last check: " + (s.lastCheck?.let { "${iso(it)} (${age(it, now)} ago)" } ?: "never"))
        line("silent: " + (silent?.let { "yes, ${Watchdog.hoursText(it)} (threshold ${Watchdog.hoursText(Watchdog.thresholdMs(c.checkHours))})" } ?: "no"))
        PassLog.cost(s.watchLog, now).takeIf { it.passes > 0 }?.let { c ->
            line("work last 24 h: " + (if (c.atLeast) "at least " else "") + "${c.passes} passes, ${PassLog.duration(c.ms)}")
        }
        line("passes (newest first, ${s.watchLog.size}):")
        if (s.watchLog.isEmpty()) line("- none recorded")
        for (r in s.watchLog) {
            val extras = buildList {
                if (r.screenOff) add("screen off")
                r.claimed?.let { add("claimed $it") }
                if (r.errors.isNotEmpty()) add("errors: " + r.errors.joinToString(" | "))
            }
            line("- ${iso(r.at)} ${r.reason} ${r.outcome} ${r.offers} offers ${r.fresh} new ${r.ms} ms" + extras.joinToString("") { ", $it" })
        }
        line()
        line("== stores")
        for (store in Accounts.STORES) {
            val a = s.accounts[store]
            line("$store: " + if (a == null) "no reading" else "${a.status}, checked ${age(a.checkedAt, now)} ago" + (a.via?.let { ", via $it" } ?: ""))
        }
        line()
        line("== sources")
        if (s.sources.isEmpty()) line("- none read yet")
        for ((name, st) in s.sources.toSortedMap()) {
            line("$name: " + (if (st.ok) "ok (${st.count})" else "failed" + (st.error?.let { " ($it)" } ?: "")) + ", ${age(st.at, now)} ago")
        }
        line()
        line("== claim attempts")
        val failures = s.attempts.entries.filter { it.value.verdict != null && it.value.verdict !in Verdicts.ACQUIRED }
            .sortedByDescending { it.value.lastAt }.take(10)
        line("tracked: ${s.attempts.size}, failures shown: ${failures.size}")
        for ((key, a) in failures) {
            val o = s.offers[key]
            line("- ${o?.store ?: key.substringBefore(':')} ${o?.shownTitle ?: "?"}: ${a.verdict} x${a.count}, ${age(a.lastAt, now)} ago" + (a.details?.let { " - ${it.take(100)}" } ?: ""))
        }
        line()
        line("== counts")
        line("offers ${s.offers.size}, library ${s.library.size}, wishlist ${s.wishlist.size}, imported wishes ${s.importedWishes.size}, family ${s.family.size}, steam owned ${s.steamOwned.size}")
        val r = s.relay
        line("relay: " + if (r == null) "not paired" else "paired ${age(r.pairedAt, now)} ago, sync ${r.lastSync?.let { age(it, now) + " ago" } ?: "never"}, alive ${r.lastAlive?.let { age(it, now) + " ago" } ?: "never"}")
    }
}
