package io.github.diaslamka.freegames

import io.github.diaslamka.freegames.data.Restrictions
import io.github.diaslamka.freegames.data.Restrictions.Exit
import io.github.diaslamka.freegames.data.Restrictions.Finding
import io.github.diaslamka.freegames.data.Restrictions.Maker
import io.github.diaslamka.freegames.data.Restrictions.Snapshot
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Ce qu'Android fait de la veille, dit sans cri au loup : un processus en cache tue par manque de memoire est la vie normale
 * d'Android ; une appli arretee a la main ou classee « rare » est ce qui fait taire la veille.
 */
class RestrictionsTest {
    private val now = 1_790_000_000_000L
    private val hour = 3_600_000L
    private val day = 24 * hour

    private fun exit(ago: Long, reason: Int, importance: Int = 100) = Exit(now - ago, reason, importance)

    @Test
    fun aHealthyAppSaysNothing() {
        assertEquals(emptyList<Finding>(), Restrictions.findings(Snapshot(bucket = 10, backgroundRestricted = false), now))
        assertEquals(emptyList<Finding>(), Restrictions.findings(Snapshot(), now))
    }

    @Test
    fun aRareOrRestrictedStandbyBucketDelaysThePasses() {
        assertEquals(listOf(Finding.BucketLimited(40)), Restrictions.findings(Snapshot(bucket = 40), now))
        assertEquals(listOf(Finding.BucketLimited(45)), Restrictions.findings(Snapshot(bucket = 45), now))
        // « Frequent » et « en usage » retardent peu : pas d'alerte.
        assertEquals(emptyList<Finding>(), Restrictions.findings(Snapshot(bucket = 30), now))
        assertEquals(emptyList<Finding>(), Restrictions.findings(Snapshot(bucket = 20), now))
    }

    @Test
    fun restrictedBatteryUsageIsSaid() {
        assertEquals(listOf(Finding.BackgroundRestricted), Restrictions.findings(Snapshot(backgroundRestricted = true), now))
    }

    @Test
    fun aKillWhileWorkingCountsButASleepingProcessDyingDoesNot() {
        // Mort en cache (importance 400) : la vie normale d'Android.
        assertEquals(emptyList<Finding>(), Restrictions.findings(Snapshot(exits = listOf(exit(2 * hour, Restrictions.REASON_LOW_MEMORY, 400))), now))
        // Tue pendant un service (300), ou au premier plan (100, un foreground service 125) : la veille travaillait.
        val worked = Snapshot(exits = listOf(exit(2 * hour, Restrictions.REASON_LOW_MEMORY, 300), exit(5 * hour, Restrictions.REASON_SIGNALED, 125)))
        assertEquals(listOf(Finding.KilledBySystem(count = 2, lastAt = now - 2 * hour)), Restrictions.findings(worked, now))
    }

    @Test
    fun theThreeKindsOfSystemKillAreCounted() {
        for (reason in listOf(Restrictions.REASON_EXCESSIVE_RESOURCE_USAGE, Restrictions.REASON_FREEZER, Restrictions.REASON_OTHER, Restrictions.REASON_DEPENDENCY_DIED)) {
            assertEquals("motif $reason", listOf(Finding.KilledBySystem(1, now - hour)), Restrictions.findings(Snapshot(exits = listOf(exit(hour, reason, 200))), now))
        }
    }

    @Test
    fun crashesAnrsAndNormalExitsAreNotTheSystemsDoing() {
        // CRASH 4, CRASH_NATIVE 5, ANR 6, EXIT_SELF 1, PERMISSION_CHANGE 8, PACKAGE_UPDATED 16 : d'autres sujets.
        val others = listOf(1, 4, 5, 6, 8, 15, 16).map { exit(hour, it, 100) }
        assertEquals(emptyList<Finding>(), Restrictions.findings(Snapshot(exits = others), now))
    }

    @Test
    fun aStopByHandIsSaidWhateverTheProcessWasDoing() {
        // Arret force ou appli retiree des recentes : plus de travail ni d'alarme jusqu'a la prochaine ouverture.
        val s = Snapshot(exits = listOf(exit(3 * hour, Restrictions.REASON_USER_REQUESTED, 400), exit(2 * day, Restrictions.REASON_USER_STOPPED, 100)))
        assertEquals(listOf(Finding.StoppedByUser(count = 2, lastAt = now - 3 * hour)), Restrictions.findings(s, now))
    }

    @Test
    fun onlyTheLastWeekCounts() {
        val old = Snapshot(exits = listOf(exit(8 * day, Restrictions.REASON_USER_REQUESTED), exit(8 * day, Restrictions.REASON_LOW_MEMORY, 300)))
        assertEquals(emptyList<Finding>(), Restrictions.findings(old, now))
    }

    @Test
    fun everythingTogetherComesInAFixedOrder() {
        val s = Snapshot(
            bucket = 45, backgroundRestricted = true,
            exits = listOf(exit(hour, Restrictions.REASON_FREEZER, 300), exit(2 * hour, Restrictions.REASON_USER_REQUESTED)),
        )
        assertEquals(
            listOf(Finding.BucketLimited(45), Finding.BackgroundRestricted, Finding.KilledBySystem(1, now - hour), Finding.StoppedByUser(1, now - 2 * hour)),
            Restrictions.findings(s, now),
        )
    }

    @Test
    fun everyExitReasonAndBucketHasAStableName() {
        assertEquals("low-memory", Restrictions.reasonName(Restrictions.REASON_LOW_MEMORY))
        assertEquals("user-requested", Restrictions.reasonName(Restrictions.REASON_USER_REQUESTED))
        assertEquals("freezer", Restrictions.reasonName(Restrictions.REASON_FREEZER))
        assertEquals("signaled", Restrictions.reasonName(Restrictions.REASON_SIGNALED))
        assertEquals("crash", Restrictions.reasonName(4))
        assertEquals("package-updated", Restrictions.reasonName(16))
        assertEquals("unknown(99)", Restrictions.reasonName(99))
        assertEquals("active", Restrictions.bucketName(10))
        assertEquals("working-set", Restrictions.bucketName(20))
        assertEquals("frequent", Restrictions.bucketName(30))
        assertEquals("rare", Restrictions.bucketName(40))
        assertEquals("restricted", Restrictions.bucketName(45))
        assertEquals("never", Restrictions.bucketName(50))
        assertEquals("unknown", Restrictions.bucketName(null))
    }

    @Test
    fun theMakerIsRecognisedFromTheManufacturerOrTheBrand() {
        assertEquals(Maker.OPLUS, Maker.of("OnePlus"))
        assertEquals(Maker.OPLUS, Maker.of("OPPO"))
        assertEquals(Maker.OPLUS, Maker.of("realme"))
        assertEquals(Maker.XIAOMI, Maker.of("Xiaomi"))
        // Poco et Redmi se disent « Xiaomi » en fabricant, mais pas toujours en marque.
        assertEquals(Maker.XIAOMI, Maker.of("unknown", brand = "POCO"))
        assertEquals(Maker.XIAOMI, Maker.of("Xiaomi", brand = "Redmi"))
        assertEquals(Maker.SAMSUNG, Maker.of("samsung"))
        assertEquals(Maker.HUAWEI, Maker.of("HUAWEI"))
        assertEquals(Maker.HUAWEI, Maker.of("HONOR"))
        assertEquals(Maker.GOOGLE, Maker.of("Google"))
        assertEquals(Maker.OTHER, Maker.of("Fairphone"))
        assertEquals(Maker.OTHER, Maker.of(null))
    }
}
