package io.github.diaslamka.freegames.data

import android.app.ActivityManager
import android.app.usage.UsageStatsManager
import android.content.Context
import android.os.Build

/**
 * Ce qu'Android a fait de l'appli en arriere-plan (1.28.0) : pourquoi la veille peut s'arreter sans que l'appli y soit pour rien.
 * Lu chez le systeme ; ce qu'il faut en dire est decide ici, sans rien lire.
 */
object Restrictions {
    /** Un arret du processus, tel que le systeme l'a note (ApplicationExitInfo, Android 11 et plus). */
    data class Exit(val at: Long, val reason: Int, val importance: Int)

    data class Snapshot(
        val exits: List<Exit> = emptyList(),
        /** La classe de veille (UsageStatsManager) : 10 actif, 20 en usage, 30 frequent, 40 rare, 45 restreint ; null avant Android 9. */
        val bucket: Int? = null,
        /** L'utilisateur a mis l'appli en « batterie restreinte » ; null avant Android 9. */
        val backgroundRestricted: Boolean? = null,
    )

    sealed interface Finding {
        /** Android retarde les passages de la veille : classe « rare » ou « restreinte ». */
        data class BucketLimited(val bucket: Int) : Finding

        /** « Utilisation de la batterie : restreinte » : Android bloque le fond. */
        data object BackgroundRestricted : Finding

        /** Le systeme a tue le processus pendant qu'il travaillait. */
        data class KilledBySystem(val count: Int, val lastAt: Long) : Finding

        /** Arret force, ou appli retiree des recentes : plus de travail ni d'alarme jusqu'a la prochaine ouverture. */
        data class StoppedByUser(val count: Int, val lastAt: Long) : Finding
    }

    const val BUCKET_RARE = 40
    const val BUCKET_RESTRICTED = 45
    const val WEEK_MS = 7 * 24 * 3_600_000L

    // Les motifs d'ApplicationExitInfo, recopies : les constantes n'existent qu'a partir d'Android 11.
    const val REASON_SIGNALED = 2
    const val REASON_LOW_MEMORY = 3
    const val REASON_EXCESSIVE_RESOURCE_USAGE = 9
    const val REASON_USER_REQUESTED = 10
    const val REASON_USER_STOPPED = 11
    const val REASON_DEPENDENCY_DIED = 12
    const val REASON_OTHER = 13
    const val REASON_FREEZER = 14

    /** Importance « service » (300) ou plus actif : le processus travaillait. Au-dela, il dormait en cache et sa mort ne coute rien. */
    const val IMPORTANCE_SERVICE = 300

    private val KILLING = setOf(REASON_SIGNALED, REASON_LOW_MEMORY, REASON_EXCESSIVE_RESOURCE_USAGE, REASON_DEPENDENCY_DIED, REASON_OTHER, REASON_FREEZER)
    private val BY_USER = setOf(REASON_USER_REQUESTED, REASON_USER_STOPPED)

    /** Le nom d'un motif d'arret, pour le diagnostic (anglais, stable). */
    fun reasonName(reason: Int): String = when (reason) {
        1 -> "exit-self"
        2 -> "signaled"
        3 -> "low-memory"
        4 -> "crash"
        5 -> "native-crash"
        6 -> "anr"
        7 -> "init-failure"
        8 -> "permission-change"
        9 -> "excessive-resource-usage"
        10 -> "user-requested"
        11 -> "user-stopped"
        12 -> "dependency-died"
        13 -> "other"
        14 -> "freezer"
        15 -> "package-state-change"
        16 -> "package-updated"
        else -> "unknown($reason)"
    }

    /** Le nom d'une classe de veille, pour le diagnostic. */
    fun bucketName(bucket: Int?): String = when (bucket) {
        null -> "unknown"
        5 -> "exempted"
        10 -> "active"
        20 -> "working-set"
        30 -> "frequent"
        40 -> "rare"
        45 -> "restricted"
        50 -> "never"
        else -> "bucket($bucket)"
    }

    /**
     * Ce qu'Android dit de l'appli : les arrets recents du processus (Android 11), la classe de veille et la batterie restreinte
     * (Android 9). Avant, ces lectures n'existent pas : le champ reste vide, rien n'est invente. Ne leve jamais.
     */
    fun read(context: Context): Snapshot {
        val sdk = Build.VERSION.SDK_INT
        val am = context.getSystemService(ActivityManager::class.java)
        val exits = if (sdk >= 30 && am != null) {
            // Le processus principal seulement : l'historique d'un paquet contient aussi les processus isoles du moteur de pages (WebView),
            // dont la mort « plus necessaire » est normale -- les prendre pour un arret de la veille crierait au loup.
            runCatching {
                am.getHistoricalProcessExitReasons(context.packageName, 0, 30)
                    .filter { it.processName == context.packageName }
                    .map { Exit(it.timestamp, it.reason, it.importance) }
            }.getOrDefault(emptyList())
        } else emptyList()
        val bucket = if (sdk >= 28) runCatching { context.getSystemService(UsageStatsManager::class.java)?.appStandbyBucket }.getOrNull() else null
        val restricted = if (sdk >= 28 && am != null) runCatching { am.isBackgroundRestricted }.getOrNull() else null
        return Snapshot(exits, bucket, restricted)
    }

    /** Ce qu'il faut dire d'un etat, dans un ordre fixe : classe de veille, batterie restreinte, tue au travail, arrete a la main. */
    fun findings(s: Snapshot, now: Long): List<Finding> = buildList {
        s.bucket?.takeIf { it >= BUCKET_RARE }?.let { add(Finding.BucketLimited(it)) }
        if (s.backgroundRestricted == true) add(Finding.BackgroundRestricted)
        val week = s.exits.filter { now - it.at <= WEEK_MS }
        // Un processus en cache qui meurt est la vie normale d'Android : seul compte celui qui travaillait.
        week.filter { it.reason in KILLING && it.importance <= IMPORTANCE_SERVICE }.takeIf { it.isNotEmpty() }
            ?.let { add(Finding.KilledBySystem(it.size, it.maxOf { e -> e.at })) }
        week.filter { it.reason in BY_USER }.takeIf { it.isNotEmpty() }
            ?.let { add(Finding.StoppedByUser(it.size, it.maxOf { e -> e.at })) }
    }

    /** Le fabricant, pour le guide : chacun cache le reglage « ne pas tuer l'appli » ailleurs. */
    enum class Maker {
        OPLUS, XIAOMI, SAMSUNG, HUAWEI, GOOGLE, OTHER;

        companion object {
            fun of(manufacturer: String?, brand: String? = null): Maker {
                val names = listOfNotNull(manufacturer, brand).map { it.lowercase() }
                fun has(vararg keys: String) = names.any { n -> keys.any { n.contains(it) } }
                return when {
                    has("oneplus", "oppo", "realme") -> OPLUS
                    has("xiaomi", "redmi", "poco") -> XIAOMI
                    has("samsung") -> SAMSUNG
                    has("huawei", "honor") -> HUAWEI
                    has("google") -> GOOGLE
                    else -> OTHER
                }
            }
        }
    }
}
